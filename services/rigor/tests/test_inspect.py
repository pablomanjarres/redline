"""Inspection tests: the thin ``inspect_h5ad`` step over three synthesized fixtures.

Builds the case fixtures into a tmp directory (deterministic, seeded), then
asserts the inventory the inspector reads matches what each fixture actually
carries. These prove the inspector adapts to the data (case_a and case_b have
different obs columns and different stored results), classifies both stored
shapes correctly, and reports the honest empty state (case_c has nothing to
audit). The last test proves the inventory never carries a key the contract
mirror does not declare.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ad = pytest.importorskip("anndata")
pytest.importorskip("pandas")
pytest.importorskip("numpy")

from redline.contracts import dataset_inventory  # noqa: E402
from redline.inspect import inspect_h5ad  # noqa: E402

_RIGOR_ROOT = Path(__file__).resolve().parent.parent  # services/rigor
_BUILDER_PATH = _RIGOR_ROOT / "data" / "build_case_fixtures.py"


def _load_builder():
    """Load the fixture builder by file path (it lives under data/, not the
    installed ``redline`` package, so it is not importable by module name)."""
    spec = importlib.util.spec_from_file_location("redline_case_fixtures", _BUILDER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def inventories(tmp_path_factory):
    out = tmp_path_factory.mktemp("fixtures")
    paths = _load_builder().build_fixtures(out)
    return {
        name: inspect_h5ad(ad.read_h5ad(path), file=Path(path).name)
        for name, path in paths.items()
    }


# ── Case A: Marson-shaped foil (marker table AND de_result) ───────────────────
def test_case_a_finds_expected_obs_columns(inventories):
    a = inventories["case_a"]
    names = {c["name"] for c in a["obs"]}
    assert {"donor_id", "condition", "lane", "leiden"} <= names
    assert a["hasRawCounts"] is True
    assert a["countsSource"]  # non-null: raw counts were located
    assert "leiden" in a["clusterFields"]


def test_case_a_obs_dtypes(inventories):
    by = {c["name"]: c for c in inventories["case_a"]["obs"]}
    assert by["donor_id"]["dtype"] == "categorical" and by["donor_id"]["levels"] == 4
    assert by["condition"]["dtype"] == "categorical" and by["condition"]["levels"] == 2
    assert by["leiden"]["dtype"] == "categorical" and by["leiden"]["levels"] == 5
    assert by["cell_barcode"]["dtype"] == "identifier"


def test_case_a_classifies_both_stored_results(inventories):
    a = inventories["case_a"]
    kinds = {u["kind"] for u in a["uns"]}
    assert "marker_table" in kinds
    assert "de_result" in kinds

    de = next(u for u in a["uns"] if u["kind"] == "de_result")
    assert any(g.upper() == "FOXP3" for g in de["genes"])

    marker = next(u for u in a["uns"] if u["kind"] == "marker_table")
    assert {"TNFRSF9", "ICOS", "TIGIT", "CTLA4"} <= set(marker["genes"])
    # The marker table is keyed on the five leiden clusters.
    assert len(marker["groups"]) == 5


# ── Case B: deliberately different, DE result only, no marker table ───────────
def test_case_b_has_different_columns_and_one_de_result(inventories):
    b = inventories["case_b"]
    names = {c["name"] for c in b["obs"]}
    assert {"mouse_id", "treatment", "batch", "cell_type"} <= names
    # Genuinely different from case A, so the extractor cannot be a template.
    assert "donor_id" not in names and "leiden" not in names

    kinds = [u["kind"] for u in b["uns"]]
    assert kinds.count("de_result") == 1
    assert kinds.count("marker_table") == 0

    de = next(u for u in b["uns"] if u["kind"] == "de_result")
    assert {"BDNF", "ARC", "NPAS4"} <= set(de["genes"])
    # The DE result uses different statistic column names than case A.
    lowered = {c.lower() for c in de["columns"]}
    assert "log2foldchange" in lowered and "pvalue" in lowered


def test_case_a_and_case_b_report_different_genes(inventories):
    """The inspection adapts to the data: the two datasets share no gene sample."""
    genes_a = {g.upper() for g in inventories["case_a"]["varNamesSample"]}
    genes_b = {g.upper() for g in inventories["case_b"]["varNamesSample"]}
    assert "FOXP3" in genes_a and "FOXP3" not in genes_b
    assert "BDNF" in genes_b and "BDNF" not in genes_a


# ── Case C: bare object, the honest no-claims state ───────────────────────────
def test_case_c_has_empty_uns(inventories):
    c = inventories["case_c"]
    assert c["uns"] == []  # the provenance tag is not a stored result
    assert c["hasRawCounts"] is True  # counts are present, there is just nothing stored


# ── Determinism: a rebuild reproduces the same inventory (and the same counts) ─
def test_rebuild_is_deterministic(tmp_path):
    """A rebuild from the same seeds reproduces the same inventory the agent and
    UI read AND the same counts matrix the heavy checks load.

    The fixtures are gitignored (the repo's global ``*.h5ad`` rule) and kept
    generated rather than committed. That is only honest if two builds are
    interchangeable, so this asserts it: build the three cases twice into
    separate directories and compare. The inventory equality is the portable
    guarantee (it holds regardless of the h5py/anndata version); on this
    toolchain the written files are byte-identical too, but the inventory is what
    every consumer actually reads."""
    import numpy as np

    builder = _load_builder()
    first = builder.build_fixtures(tmp_path / "build1")
    second = builder.build_fixtures(tmp_path / "build2")
    assert set(first) == set(second)

    for name in first:
        a = ad.read_h5ad(first[name])
        b = ad.read_h5ad(second[name])
        # The inventory (what the extraction agent and the UI read) is identical.
        inv_a = inspect_h5ad(a, file=Path(first[name]).name)
        inv_b = inspect_h5ad(b, file=Path(second[name]).name)
        assert inv_a == inv_b, f"{name}: inventory changed across a rebuild"
        # The counts matrix (what the heavy pillars load) is identical too.
        assert np.array_equal(a.X, b.X), f"{name}: X changed across a rebuild"
        assert np.array_equal(
            a.layers["counts"], b.layers["counts"]
        ), f"{name}: counts layer changed across a rebuild"
        assert list(a.var_names) == list(b.var_names), f"{name}: var_names changed"


# ── Contract invariant: never emit a key the mirror does not declare ──────────
def test_inventory_declares_only_contract_keys(inventories):
    reference = set(dataset_inventory(file="x.h5ad", n_cells=0, n_genes=0).to_json().keys())
    obs_keys = {"name", "dtype", "levels", "missing", "sample"}
    uns_keys = {"key", "kind", "shape", "columns", "groups", "genes", "preview"}
    for inv in inventories.values():
        assert set(inv.keys()) == reference
        for col in inv["obs"]:
            assert set(col.keys()) == obs_keys
        for entry in inv["uns"]:
            assert set(entry.keys()) == uns_keys


def test_inspect_opens_the_file_backed_and_never_reads_X(tmp_path, monkeypatch):
    """The thin inspection must not pull the expression matrix into memory.

    It once did: `inspect_dataset` shared `load_adata`'s full-read cache slot, so a
    plain `read_h5ad` materialized X before inspection ran. On a 161 MB matrix that
    cost +158 MB of RSS for an inventory that reads obs, uns, var_names, and a
    few-hundred-cell sample.
    """
    import anndata
    import numpy as np
    import pandas as pd

    from redline import job_runner

    n, g = 60, 8
    X = np.rint(np.random.default_rng(0).poisson(3, (n, g))).astype("float32")
    obs = pd.DataFrame({"leiden": np.random.default_rng(1).integers(0, 3, n).astype(str)})
    var = pd.DataFrame(index=[f"g{i}" for i in range(g)])
    path = tmp_path / "small.h5ad"
    anndata.AnnData(X=X, obs=obs, var=var).write_h5ad(path)

    # Empty the shared cache so the backed path is the one exercised.
    job_runner._ADATA_CACHE.pop("entry", None)

    seen = {}
    real = anndata.read_h5ad

    def spy(p, *args, **kwargs):
        seen["backed"] = kwargs.get("backed")
        return real(p, *args, **kwargs)

    monkeypatch.setattr(anndata, "read_h5ad", spy)
    inventory = job_runner.inspect_dataset(str(path))

    assert seen["backed"] == "r", "inspect must open the .h5ad backed, not read X into memory"
    assert inventory["hasRawCounts"] is True
    assert inventory["nCells"] == n and inventory["nGenes"] == g
    # And it must not have poisoned the full-read cache with a backed object.
    assert "entry" not in job_runner._ADATA_CACHE
