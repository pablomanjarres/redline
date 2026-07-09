"""Thin dataset inspection (spec section 3).

"We do not write bespoke parsers." This step surfaces the raw material an
AnnData ``.h5ad`` carries (the ``obs`` columns and their types, the stored
``uns`` results and their shape, the cluster label fields, and whether raw
counts are present) and hands it to the claim-extraction agent as context. The
agent does all interpretation; this module only reports what is there, and it
never guesses.

Two hard properties:

1. It NEVER loads the full expression matrix. It reads shape and metadata, and
   it reuses ``gating.find_counts`` (which samples at most a few hundred cells)
   to decide whether raw integer counts are present. scanpy is never imported.
2. Its output is the ``DatasetInventory`` shape from ``redline.contracts``
   (camelCase keys), built THROUGH the contract dataclasses, so it can never
   drift from the TypeScript ``@redline/contracts`` source of truth. Every
   ``obs`` column is validated as one of the three dtypes and every stored
   result as one of the three uns kinds by those dataclasses.

The obs-column classification (dtype, cardinality, sample values) reuses the
same helpers the foundation step uses, so the inventory the agent reads lines up
with the roles the field resolver proposes.
"""

from __future__ import annotations

from typing import Any, Optional

from .contracts import (
    DatasetInventory,
    ObsColumn,
    UnsEntry,
    dataset_inventory,
    obs_column,
    uns_entry,
)
from .foundation import _DERIVED, _dtype_of, _hit, _norm, _summ
from .gating import find_counts

# Cap the gene union reported per stored result. Enough for the agent to route a
# claim; small enough to keep the inventory light on a several-thousand-gene set.
_GENE_CAP = 200
# How many gene identifiers to sample from var_names for the gene-existence check.
_VAR_SAMPLE = 50
# How many top genes to pull per group from a stored marker table before unioning.
_TOP_PER_GROUP = 50

# Statistic column names a stored DE result uses, matched after normalization
# (lowercased, punctuation folded). Broad on purpose: the agent copes with the
# rest, and we only need one hit to recognize a table as a DE result.
_DE_STAT_NAMES = frozenset(
    {
        "pval", "pvalue", "p_val", "pvals", "p_value", "padj", "pvals_adj",
        "p_adj", "qval", "qvalue", "fdr", "log2foldchange", "logfoldchanges",
        "logfc", "lfc", "stat", "statistic", "score", "scores", "basemean",
        "adj_pval", "adjpval", "wald_stat", "t_stat", "z",
    }
)
# Column / key names that carry gene identifiers inside a stored DE result.
_GENE_KEY_NAMES = frozenset(
    {
        "gene", "genes", "gene_name", "gene_names", "gene_id", "gene_ids",
        "names", "name", "symbol", "symbols", "feature", "features",
        "gene_symbol", "gene_symbols", "var_names",
    }
)


# ── small utilities ───────────────────────────────────────────────────────────
def _norm_key(k: Any) -> str:
    """Normalize a column / key name the same way column names are normalized."""
    return str(k).strip().lower().replace(".", "_").replace("-", "_").replace(" ", "_")


def _cap_unique(values: Any, n: int) -> list[str]:
    """First ``n`` distinct non-empty string values, order preserved."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        s = str(v)
        if s and s not in seen:
            seen.add(s)
            out.append(s)
            if len(out) >= n:
                break
    return out


def _is_mapping(v: Any) -> bool:
    """A dict-like stored result (a DE dict-of-arrays, a rank_genes_groups dict).

    A numpy array has ``__getitem__`` but no ``keys``, so it is excluded; a
    pandas DataFrame is dict-like but is handled by the DataFrame path first.
    """
    return hasattr(v, "keys") and hasattr(v, "__getitem__")


def _structured_field_names(arr: Any) -> Optional[list[str]]:
    """The field names of a numpy structured array, or ``None`` when it is not one.

    In a scanpy ``rank_genes_groups`` block, ``['names']`` is a structured array
    whose fields are the group (cluster) labels, so this is how we read the
    groups without importing numpy or scanpy.
    """
    dt = getattr(arr, "dtype", None)
    fields = getattr(dt, "names", None) if dt is not None else None
    return [str(f) for f in fields] if fields else None


def _is_scalar(v: Any) -> bool:
    """True for a value that is not a stored result table (a provenance tag, a
    number, a 0-d array). Such uns entries are not surfaced as stored results."""
    if v is None or isinstance(v, (str, bytes, bytearray, bool, int, float, complex)):
        return True
    return getattr(v, "shape", None) == ()  # a 0-d numpy array / numpy scalar


def _named_keys(mapping: Any) -> list[str]:
    """The string keys of an AnnData aligned mapping (layers, obsm), dropping the
    ``None`` placeholder AnnData surfaces for ``X`` and any other non-name key."""
    if mapping is None:
        return []
    return [str(k) for k in mapping.keys() if k is not None]


def _shape_hint(v: Any) -> str:
    shp = getattr(v, "shape", None)
    if shp is not None:
        return f"shape {tuple(shp)}"
    if _is_mapping(v):
        keys = [str(k) for k in list(v.keys())[:8]]
        return "keys " + ", ".join(keys) if keys else "empty mapping"
    try:
        return f"length {len(v)}"
    except TypeError:
        return "scalar"


# ── stored-result classifiers (never guess) ──────────────────────────────────
def _marker_table(value: Any) -> Optional[tuple[list[str], list[str], list[str]]]:
    """Classify a scanpy ``rank_genes_groups``-shaped mapping as a marker table.

    Signature: a mapping with a ``names`` entry that is a structured array whose
    fields are the group (cluster) labels. We detect by structure, not by the
    key string, so a differently named stored marker table is still recognized.

    Returns ``(groups, columns, genes)`` or ``None``:
      - groups:  the cluster labels (the structured-array field names).
      - columns: the statistic sub-arrays present (names, scores, pvals,
                 pvals_adj, logfoldchanges), which are the marker table's columns.
      - genes:   the union of the top gene names across all groups, capped.
    """
    if not _is_mapping(value) or "names" not in value:
        return None
    names = value["names"]
    groups = _structured_field_names(names)
    if not groups:
        return None
    columns = [str(k) for k in value.keys() if str(k) != "params"]
    gene_union: list[str] = []
    for g in groups:
        try:
            gene_union.extend(str(x) for x in list(names[g])[:_TOP_PER_GROUP])
        except (KeyError, TypeError, ValueError):
            continue
    return groups, columns, _cap_unique(gene_union, _GENE_CAP)


def _pick_genes(colnames: list[str], getter: Any) -> Optional[list[str]]:
    """Gene identifiers from the first gene-naming column, or ``None``."""
    for c in colnames:
        if _norm_key(c) in _GENE_KEY_NAMES:
            try:
                return [str(x) for x in getter(c)]
            except (KeyError, TypeError, ValueError):
                return None
    return None


def _de_from_dataframe(value: Any) -> Optional[tuple[list[str], list[str]]]:
    """A stored DE result held as a DataFrame-like object (columns + index)."""
    cols = getattr(value, "columns", None)
    index = getattr(value, "index", None)
    if cols is None or index is None:
        return None
    colnames = [str(c) for c in list(cols)]
    if not any(_norm_key(c) in _DE_STAT_NAMES for c in colnames):
        return None
    genes = _pick_genes(colnames, lambda c: value[c])
    if genes is None:
        # Fall back to a gene-named index (string labels), not a plain integer range.
        if str(getattr(index, "inferred_type", "")) in ("string", "unicode", "mixed"):
            try:
                genes = [str(x) for x in list(index)]
            except TypeError:
                genes = None
    if not genes:
        return None
    return colnames, _cap_unique(genes, _GENE_CAP)


def _de_from_mapping(value: Any) -> Optional[tuple[list[str], list[str]]]:
    """A stored DE result held as a dict of 1-D arrays (gene ids plus statistics)."""
    if not _is_mapping(value):
        return None
    keys = [str(k) for k in value.keys()]
    if not any(_norm_key(k) in _DE_STAT_NAMES for k in keys):
        return None
    genes = _pick_genes(keys, lambda c: value[c])
    if not genes:
        return None
    return keys, _cap_unique(genes, _GENE_CAP)


def _de_from_structured(value: Any) -> Optional[tuple[list[str], list[str]]]:
    """A stored DE result held as a single numpy structured array (recarray)."""
    fields = _structured_field_names(value)
    if not fields:
        return None
    if not any(_norm_key(f) in _DE_STAT_NAMES for f in fields):
        return None
    genes = _pick_genes(fields, lambda c: value[c])
    if not genes:
        return None
    return fields, _cap_unique(genes, _GENE_CAP)


def _classify_uns(key: str, value: Any) -> UnsEntry:
    """Classify one stored result. Anything not recognized as a marker table or a
    DE result is reported as ``unknown`` with a short preview, never guessed at."""
    marker = _marker_table(value)
    if marker is not None:
        groups, columns, genes = marker
        head = ", ".join(genes[:6])
        preview = (
            f"Stored marker table '{key}' with per-cluster rankings for "
            f"{len(groups)} groups. Top genes include {head}."
        )
        return uns_entry(
            key, "marker_table",
            shape=f"{len(genes)} genes across {len(groups)} groups",
            columns=columns, groups=groups, genes=genes, preview=preview,
        )

    de = _de_from_dataframe(value) or _de_from_mapping(value) or _de_from_structured(value)
    if de is not None:
        columns, genes = de
        head = ", ".join(genes[:6])
        preview = (
            f"Stored differential-expression result '{key}' over {len(genes)} "
            f"genes. Columns: {', '.join(columns)}. Genes include {head}."
        )
        return uns_entry(
            key, "de_result",
            shape=f"{len(genes)} genes by {len(columns)} columns",
            columns=columns, groups=[], genes=genes, preview=preview,
        )

    return uns_entry(
        key, "unknown",
        shape=_shape_hint(value), columns=[], groups=[], genes=[],
        preview=(
            f"Stored entry '{key}' of type {type(value).__name__}. The inspector "
            f"did not recognize it as a marker table or a DE result ({_shape_hint(value)})."
        ),
    )


# ── cluster fields (conservative) ─────────────────────────────────────────────
def _is_cluster_field(norm: str, dtype: str, levels: Optional[int]) -> bool:
    """Whether an obs column plausibly holds cluster / community labels.

    Conservative on purpose: a cluster label is categorical, carries a moderate
    number of levels (at least 2, and at most 100 so a per-cell identifier is
    excluded), AND its name matches a clustering / annotation vocabulary
    (leiden, louvain, cluster, celltype, cell_type, annotation, and so on). We do
    not infer cluster fields from values alone, because mislabeling a real
    covariate as a cluster field would send a downstream check at the wrong target.
    """
    return dtype == "categorical" and levels is not None and 2 <= levels <= 100 and _hit(norm, _DERIVED)


# ── the public entry point ────────────────────────────────────────────────────
def inspect_h5ad(adata: Any, file: str = "") -> dict:
    """Inspect an AnnData and return its ``DatasetInventory`` as camelCase JSON.

    Reads obs columns and their types, the stored ``uns`` results (marker tables,
    DE results, or unknown) with their genes and shape, the cluster label fields,
    whether raw integer counts are present (and where), the layers and obsm keys,
    and a sample of gene identifiers. It never loads the expression matrix.

    ``file`` is the source filename, carried through onto the inventory so the
    agent and the UI can name the dataset; it defaults to empty when the caller
    inspects an in-memory object.
    """
    obs = getattr(adata, "obs", None)
    n_obs = int(getattr(adata, "n_obs", 0) or 0)

    obs_cols: list[ObsColumn] = []
    cluster_fields: list[str] = []
    if obs is not None:
        for name in list(getattr(obs, "columns", [])):
            s = _summ(obs[name], n_obs)
            norm = _norm(name)
            dtype = _dtype_of(norm, s, n_obs)
            levels = None if dtype == "numeric" else int(s["nunique"])
            obs_cols.append(
                obs_column(str(name), dtype, levels, int(s["missing"]), list(s["uniques"]))
            )
            if _is_cluster_field(norm, dtype, levels):
                cluster_fields.append(str(name))

    uns = getattr(adata, "uns", None) or {}
    uns_entries: list[UnsEntry] = []
    for key in list(uns.keys()):
        value = uns[key]
        if _is_scalar(value):
            continue  # a provenance tag or a scalar, not a stored result
        uns_entries.append(_classify_uns(str(key), value))

    matrix, source = find_counts(adata)

    # var_names is a pandas Index, so guard the None case explicitly rather than
    # with ``or`` (an Index has no unambiguous truth value).
    var_names_attr = getattr(adata, "var_names", None)
    var_names = list(var_names_attr) if var_names_attr is not None else []
    layers = getattr(adata, "layers", None)
    obsm = getattr(adata, "obsm", None)

    inv: DatasetInventory = dataset_inventory(
        file=str(file),
        n_cells=int(getattr(adata, "n_obs", 0) or 0),
        n_genes=int(getattr(adata, "n_vars", 0) or 0),
        obs=obs_cols,
        uns=uns_entries,
        cluster_fields=cluster_fields,
        has_raw_counts=matrix is not None,
        counts_source=source,
        # AnnData's .layers keys can include a ``None`` entry standing in for X;
        # drop it so this lists only the genuinely named layers.
        layers=_named_keys(layers),
        obsm=_named_keys(obsm),
        var_names_sample=[str(x) for x in var_names[:_VAR_SAMPLE]],
    )
    return inv.to_json()
