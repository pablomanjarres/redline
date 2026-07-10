"""Fixtures for the correction acceptance harness.

These fixtures are the whole generality story. Four AnnData objects, each written
to a temp ``.h5ad``, exercise the modules on structurally different designs:

- ``case_a``: the canonical schema (donor / condition / cell_state / lane). The
  happy path where checks fire and correct.
- ``case_b``: a structurally different design (mouse_id / treatment / state /
  seq_batch), different gene names, a different number of units. Nothing about it
  lines up with case A, so the emitted code proves it reads resolved roles rather
  than hardcoded column names.
- ``case_confounded``: the grouping and the technical variable are perfectly
  collinear (every unit of one condition on one lane). The unsalvageable case.
- ``case_underpowered``: n=1 unit per group. The hard-stop case.

Heavy imports are guarded with ``pytest.importorskip`` in the house style. Only
numpy, pandas and anndata are needed to build the fixtures; scanpy and pydeseq2
are needed only by the ``slow`` subprocess tests, which skip when they are absent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import pytest

np = pytest.importorskip("numpy")
ad = pytest.importorskip("anndata")
pytest.importorskip("pandas")
import pandas as pd  # noqa: E402


def pytest_configure(config: Any) -> None:
    config.addinivalue_line(
        "markers",
        "slow: runs an emitted script in a subprocess; needs the heavy stats stack.",
    )


# ── The resolved-design carrier ──────────────────────────────────────────────
@dataclass
class Case:
    """One test dataset plus the design a scientist would confirm for it.

    ``fields`` is an explicit list of resolved field dicts (the foundation
    output), so a module reads the right roles without depending on the field
    resolver's heuristics. ``config_for`` returns the per-check knob config,
    built from this case's own field names and levels, never from constants.
    """

    name: str
    path: str
    adata: Any
    fields: list[dict]
    unit: str
    grouping: str
    derived: str
    technical: str
    ref: str
    alt: str
    gene: str
    markers: list[str]
    target_group: str
    track: str
    all_genes: list[str] = field(default_factory=list)

    @property
    def field_names(self) -> set[str]:
        return {str(f["id"]) for f in self.fields}

    def config_for(self, check_id: int) -> dict:
        cid = int(check_id)
        common = {
            "unit": self.unit,
            "grouping": self.grouping,
            "ref": self.ref,
            "alt": self.alt,
            "alpha": 0.05,
            "h5ad": self.path,
        }
        if cid == 1:
            return {**common, "gene": self.gene, "covariates": [], "kind": "de", "genes": [self.gene]}
        if cid == 2:
            return {
                "grouping": self.derived,
                "target_group": self.target_group,
                "markers": list(self.markers),
                "split": 0.5,
                "seed": 0,
                "kind": "marker",
                "h5ad": self.path,
            }
        if cid == 3:
            return {
                "track": self.track,
                "min": 0.2,
                "max": 1.0,
                "step": 0.2,
                "seed": 0,
                "kind": "cluster",
                "h5ad": self.path,
            }
        if cid == 4:
            return {
                "interest": self.grouping,
                "technical": self.technical,
                "nuisance": [self.technical],
                "h5ad": self.path,
            }
        if cid == 5:
            return {**common, "method": "bh", "kind": "de"}
        if cid == 6:
            return {
                "interest": self.grouping,
                "covariate": self.technical,
                "ref": self.ref,
                "alt": self.alt,
                "unit": self.unit,
                "alpha": 0.05,
                "kind": "de",
                "h5ad": self.path,
            }
        if cid == 7:
            return {
                "min": 0.2,
                "max": 1.0,
                "step": 0.2,
                "criterion": "silhouette",
                "chosen": 1.0,
                "seed": 0,
                "kind": "cluster",
                "h5ad": self.path,
            }
        if cid == 8:
            return {
                **common,
                "claimed_test": "t",
                "claimedTest": "t",
                "kind": "de",
            }
        return dict(common)


# ── field-dict helper ────────────────────────────────────────────────────────
def _field(fid: str, dtype: str, levels: Optional[int], role: str, sample: Optional[str] = None) -> dict:
    d: dict = {
        "id": fid,
        "dtype": dtype,
        "levels": levels,
        "missing": 0,
        "role": role,
        "confidence": "high",
        "reason": "fixture-resolved",
    }
    if sample is not None:
        d["sample"] = sample
    return d


def _write(adata: Any, tmp_path: Any, name: str) -> str:
    p = tmp_path / f"{name}.h5ad"
    adata.write_h5ad(str(p))
    return str(p)


# ── case A: the canonical schema ─────────────────────────────────────────────
def _build_case_a(seed: int = 0):
    """4 donors x 2 conditions x 300 cells, 30 genes.

    FOXP3 carries between-donor structure (inflated at the cell level, collapses
    at the donor level). Naive/Effector are real, separable states. ``lane``
    correlates with condition without being collinear (a separable batch that
    perturbs g5..g9), so the covariate check has a real correction to make.
    """
    rng = np.random.default_rng(seed)
    donors = ["dA", "dB", "dC", "dD"]
    cond = {"dA": "NT", "dB": "NT", "dC": "KD", "dD": "KD"}
    foxp3_lambda = {"dA": 3.0, "dB": 7.0, "dC": 4.0, "dD": 8.0}
    n_per = 300
    n_genes = 30

    donor_col, cond_col, state_col = [], [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond[d]] * n_per
        state_col += ["Naive"] * (n_per // 2) + ["Effector"] * (n_per - n_per // 2)
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    state_col = np.array(state_col)
    n = donor_col.size

    X = rng.poisson(1.0, size=(n, n_genes)).astype(int)
    X[:, 0] = rng.poisson(np.array([foxp3_lambda[d] for d in donor_col]))

    naive = state_col == "Naive"
    eff = ~naive
    X[naive, 10:15] = rng.poisson(15.0, size=(int(naive.sum()), 5))
    X[eff, 10:15] = rng.poisson(0.3, size=(int(eff.sum()), 5))
    X[eff, 15:20] = rng.poisson(6.0, size=(int(eff.sum()), 5))
    X[naive, 15:20] = rng.poisson(0.3, size=(int(naive.sum()), 5))
    X[eff, 20:30] = rng.poisson(2.0, size=(int(eff.sum()), 10))
    X[naive, 20:30] = rng.poisson(0.2, size=(int(naive.sum()), 10))

    # lane correlates with condition (80/20) without being collinear: separable.
    lane = np.empty(n, dtype=object)
    for i in range(n):
        pL1 = 0.8 if cond_col[i] == "NT" else 0.2
        lane[i] = "L1" if rng.random() < pL1 else "L2"
    lane_is_2 = lane == "L2"
    X[lane_is_2, 5:10] += rng.poisson(5.0, size=(int(lane_is_2.sum()), 5))

    barcodes = [f"cell_{i}" for i in range(n)]
    genes = ["FOXP3"] + [f"g{i}" for i in range(1, n_genes)]
    obs = pd.DataFrame(
        {
            "donor": donor_col,
            "condition": cond_col,
            "cell_barcode": barcodes,
            "lane": lane,
            "guide_batch": np.where(cond_col == "KD", "gb1", "gb0"),
            "leiden": np.where(naive, "0", "1"),
            "cell_state": state_col,
            "n_genes": (X > 0).sum(axis=1),
            "pct_mito": rng.uniform(0, 8, size=n),
            "phase": rng.choice(["G1", "S", "G2M"], size=n),
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(float), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(float)

    fields = [
        _field("donor", "categorical", 4, "unit", "dA · dB · dC · dD"),
        _field("condition", "categorical", 2, "grouping", "NT · KD"),
        _field("cell_barcode", "identifier", None, "observation"),
        _field("lane", "categorical", 2, "nuisance", "L1 · L2"),
        _field("guide_batch", "categorical", 2, "ignore", "gb0 · gb1"),
        _field("cell_state", "categorical", 2, "derived", "Naive · Effector"),
        _field("leiden", "categorical", 2, "derived", "0 · 1"),
        _field("n_genes", "numeric", None, "covariate"),
        _field("pct_mito", "numeric", None, "covariate"),
        _field("phase", "categorical", 3, "nuisance", "G1 · S · G2M"),
    ]
    return adata, fields, genes


# ── case B: a structurally different design ──────────────────────────────────
def _build_case_b(seed: int = 1):
    """6 mice x 2 treatments x 200 cells, different gene names.

    Nothing lines up with case A. Il2ra carries between-mouse structure (six
    overlapping means across the two arms), state is Resting/Activated, and
    seq_batch is a separable batch perturbing b5..b9. Six mice (three per arm)
    give valid replicates, and a different unit count than case A.
    """
    rng = np.random.default_rng(seed)
    mice = ["m1", "m2", "m3", "m4", "m5", "m6"]
    treat = {"m1": "vehicle", "m2": "vehicle", "m3": "vehicle", "m4": "drug", "m5": "drug", "m6": "drug"}
    il2ra_lambda = {"m1": 3.0, "m2": 7.0, "m3": 5.0, "m4": 4.0, "m5": 8.0, "m6": 6.0}
    n_per = 200
    n_genes = 30

    mouse_col, treat_col, state_col = [], [], []
    for m in mice:
        mouse_col += [m] * n_per
        treat_col += [treat[m]] * n_per
        state_col += ["Resting"] * (n_per // 2) + ["Activated"] * (n_per - n_per // 2)
    mouse_col = np.array(mouse_col)
    treat_col = np.array(treat_col)
    state_col = np.array(state_col)
    n = mouse_col.size

    X = rng.poisson(1.0, size=(n, n_genes)).astype(int)
    X[:, 0] = rng.poisson(np.array([il2ra_lambda[m] for m in mouse_col]))

    resting = state_col == "Resting"
    active = ~resting
    X[resting, 10:15] = rng.poisson(15.0, size=(int(resting.sum()), 5))
    X[active, 10:15] = rng.poisson(0.3, size=(int(active.sum()), 5))
    X[active, 15:20] = rng.poisson(6.0, size=(int(active.sum()), 5))
    X[resting, 15:20] = rng.poisson(0.3, size=(int(resting.sum()), 5))
    X[active, 20:30] = rng.poisson(2.0, size=(int(active.sum()), 10))
    X[resting, 20:30] = rng.poisson(0.2, size=(int(resting.sum()), 10))

    seq_batch = np.empty(n, dtype=object)
    for i in range(n):
        pB1 = 0.8 if treat_col[i] == "vehicle" else 0.2
        seq_batch[i] = "B1" if rng.random() < pB1 else "B2"
    b2 = seq_batch == "B2"
    X[b2, 5:10] += rng.poisson(5.0, size=(int(b2.sum()), 5))

    cell_ids = [f"bc{i}" for i in range(n)]
    genes = ["Il2ra"] + [f"b{i}" for i in range(1, n_genes)]
    obs = pd.DataFrame(
        {
            "mouse_id": mouse_col,
            "treatment": treat_col,
            "cell_id": cell_ids,
            "seq_batch": seq_batch,
            "state": state_col,
            "n_features": (X > 0).sum(axis=1),
            "pct_mt": rng.uniform(0, 8, size=n),
            "cycle": rng.choice(["G1", "S", "G2M"], size=n),
        },
        index=cell_ids,
    )
    adata = ad.AnnData(X=X.astype(float), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(float)

    fields = [
        _field("mouse_id", "categorical", 6, "unit", "m1 · m2 · m3 · m4 · m5 · m6"),
        _field("treatment", "categorical", 2, "grouping", "vehicle · drug"),
        _field("cell_id", "identifier", None, "observation"),
        _field("seq_batch", "categorical", 2, "nuisance", "B1 · B2"),
        _field("state", "categorical", 2, "derived", "Resting · Activated"),
        _field("n_features", "numeric", None, "covariate"),
        _field("pct_mt", "numeric", None, "covariate"),
        _field("cycle", "categorical", 3, "nuisance", "G1 · S · G2M"),
    ]
    return adata, fields, genes


# ── case confounded: grouping perfectly collinear with the technical variable ─
def _build_case_confounded(seed: int = 2):
    """4 donors, condition, and lane == condition exactly (Cramer's V = 1.00).

    The condition effect is not identifiable from the lane effect. There is no
    valid statistical fix, so check 4 is flag_only and unsalvageable.
    """
    rng = np.random.default_rng(seed)
    donors = ["dA", "dB", "dC", "dD"]
    cond = {"dA": "NT", "dB": "NT", "dC": "KD", "dD": "KD"}
    n_per = 200
    n_genes = 20

    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    X = rng.poisson(1.0, size=(n, n_genes)).astype(int)
    X[cond_col == "KD", 0] += rng.poisson(5.0, size=int((cond_col == "KD").sum()))

    barcodes = [f"cell_{i}" for i in range(n)]
    genes = ["FOXP3"] + [f"g{i}" for i in range(1, n_genes)]
    obs = pd.DataFrame(
        {
            "donor": donor_col,
            "condition": cond_col,
            "cell_barcode": barcodes,
            # Perfectly aligned with condition: every NT on Lane-A, every KD on Lane-B.
            "lane": np.where(cond_col == "KD", "Lane-B", "Lane-A"),
            "cell_state": np.where(np.arange(n) % 2 == 0, "Naive", "Effector"),
            "n_genes": (X > 0).sum(axis=1),
            "pct_mito": rng.uniform(0, 8, size=n),
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(float), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(float)

    fields = [
        _field("donor", "categorical", 4, "unit", "dA · dB · dC · dD"),
        _field("condition", "categorical", 2, "grouping", "NT · KD"),
        _field("cell_barcode", "identifier", None, "observation"),
        _field("lane", "categorical", 2, "nuisance", "Lane-A · Lane-B"),
        _field("cell_state", "categorical", 2, "derived", "Naive · Effector"),
        _field("n_genes", "numeric", None, "covariate"),
        _field("pct_mito", "numeric", None, "covariate"),
    ]
    return adata, fields, genes


# ── case underpowered: n=1 unit per group ────────────────────────────────────
def _build_case_underpowered(seed: int = 3):
    """One donor per condition. No valid differential expression by any method."""
    rng = np.random.default_rng(seed)
    donors = ["dA", "dB"]
    cond = {"dA": "NT", "dB": "KD"}
    n_per = 300
    n_genes = 20

    donor_col, cond_col = [], []
    for d in donors:
        donor_col += [d] * n_per
        cond_col += [cond[d]] * n_per
    donor_col = np.array(donor_col)
    cond_col = np.array(cond_col)
    n = donor_col.size

    X = rng.poisson(1.0, size=(n, n_genes)).astype(int)
    X[cond_col == "KD", 0] += rng.poisson(5.0, size=int((cond_col == "KD").sum()))

    barcodes = [f"cell_{i}" for i in range(n)]
    genes = ["FOXP3"] + [f"g{i}" for i in range(1, n_genes)]
    obs = pd.DataFrame(
        {
            "donor": donor_col,
            "condition": cond_col,
            "cell_barcode": barcodes,
            "cell_state": np.where(np.arange(n) % 2 == 0, "Naive", "Effector"),
            "n_genes": (X > 0).sum(axis=1),
            "pct_mito": rng.uniform(0, 8, size=n),
        },
        index=barcodes,
    )
    adata = ad.AnnData(X=X.astype(float), obs=obs)
    adata.var_names = genes
    adata.layers["counts"] = X.astype(float)

    fields = [
        _field("donor", "categorical", 2, "unit", "dA · dB"),
        _field("condition", "categorical", 2, "grouping", "NT · KD"),
        _field("cell_barcode", "identifier", None, "observation"),
        _field("cell_state", "categorical", 2, "derived", "Naive · Effector"),
        _field("n_genes", "numeric", None, "covariate"),
        _field("pct_mito", "numeric", None, "covariate"),
    ]
    return adata, fields, genes


# ── fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture
def case_a(tmp_path) -> Case:
    adata, fields, genes = _build_case_a()
    path = _write(adata, tmp_path, "case_a")
    return Case(
        name="case_a",
        path=path,
        adata=adata,
        fields=fields,
        unit="donor",
        grouping="condition",
        derived="cell_state",
        technical="lane",
        ref="NT",
        alt="KD",
        gene="FOXP3",
        markers=["g10", "g11", "g12", "g13", "g14"],
        target_group="Naive",
        track="Naive",
        all_genes=genes,
    )


@pytest.fixture
def case_b(tmp_path) -> Case:
    adata, fields, genes = _build_case_b()
    path = _write(adata, tmp_path, "case_b")
    return Case(
        name="case_b",
        path=path,
        adata=adata,
        fields=fields,
        unit="mouse_id",
        grouping="treatment",
        derived="state",
        technical="seq_batch",
        ref="vehicle",
        alt="drug",
        gene="Il2ra",
        markers=["b10", "b11", "b12", "b13", "b14"],
        target_group="Resting",
        track="Resting",
        all_genes=genes,
    )


@pytest.fixture
def case_confounded(tmp_path) -> Case:
    adata, fields, genes = _build_case_confounded()
    path = _write(adata, tmp_path, "case_confounded")
    return Case(
        name="case_confounded",
        path=path,
        adata=adata,
        fields=fields,
        unit="donor",
        grouping="condition",
        derived="cell_state",
        technical="lane",
        ref="NT",
        alt="KD",
        gene="FOXP3",
        markers=["g1", "g2", "g3"],
        target_group="Naive",
        track="Naive",
        all_genes=genes,
    )


@pytest.fixture
def case_underpowered(tmp_path) -> Case:
    adata, fields, genes = _build_case_underpowered()
    path = _write(adata, tmp_path, "case_underpowered")
    return Case(
        name="case_underpowered",
        path=path,
        adata=adata,
        fields=fields,
        unit="donor",
        grouping="condition",
        derived="cell_state",
        technical=None,  # type: ignore[arg-type]
        ref="NT",
        alt="KD",
        gene="FOXP3",
        markers=["g1", "g2", "g3"],
        target_group="Naive",
        track="Naive",
        all_genes=genes,
    )
