"""Real-toolchain tests: exercise the actual scverse stack, not the fallbacks.

The rest of the suite (``test_pillars.py``) runs on the numpy/scipy/scikit-learn
degrade paths so it passes with only the base install. That leaves the real
engine the whole "depth" story rides on (decoupler pseudobulk + PyDESeq2, scanpy
Leiden) untested. This module fills that gap. Every test here is skipped unless
the ``[stats]`` extra is installed, and when it runs it asserts the REAL engine
ran, so a silent PyDESeq2 -> Welch downgrade (a missing dep, or a decoupler API
change) fails the suite instead of passing quietly.

It also wires the Pillar 1 correctness oracle (``data/oracle.py``) into pytest,
offline, on a synthetic answer key so the pseudobulk path is checked end to end
without network or the 1.7 TB reference set.
"""

from __future__ import annotations

import importlib.util
import pathlib

import pytest

# Skip the whole module unless the real statistical stack is installed.
pytest.importorskip("scanpy")
pytest.importorskip("decoupler")
pytest.importorskip("pydeseq2")
ad = pytest.importorskip("anndata")
np = pytest.importorskip("numpy")
pd = pytest.importorskip("pandas")

from redline import job_runner  # noqa: E402  (after importorskip)

RIGOR_ROOT = pathlib.Path(__file__).resolve().parents[1]


def _synthetic_adata(seed: int = 0):
    """6 donors, 3 per condition, raw counts. A strong donor-consistent effect is
    planted in gene_0 (up in 'stim') and gene_1 is a true null. So the honest
    (pseudobulk) test must FLAG gene_0's inflated cell-level significance and call
    gene_1 clean: a small real answer key."""
    rng = np.random.default_rng(seed)
    n_genes = 24
    donors = [f"d{i}" for i in range(6)]
    cond_of = {d: ("stim" if i < 3 else "rest") for i, d in enumerate(donors)}
    blocks, obs_rows = [], []
    for d in donors:
        ncell = 120
        base = rng.poisson(5, size=(ncell, n_genes)).astype(float)
        if cond_of[d] == "stim":
            base[:, 0] += rng.poisson(18, size=ncell)  # planted, donor-consistent
        blocks.append(base)
        obs_rows += [(d, cond_of[d]) for _ in range(ncell)]
    X = np.vstack(blocks).astype("float32")
    obs = pd.DataFrame(obs_rows, columns=["donor_id", "condition"])
    var = pd.DataFrame(index=[f"gene_{i}" for i in range(n_genes)])
    adata = ad.AnnData(X=X, obs=obs, var=var)
    adata.layers["counts"] = X.copy()
    return adata


@pytest.fixture()
def synth_h5ad(tmp_path):
    path = tmp_path / "synth.h5ad"
    _synthetic_adata().write_h5ad(path)
    return str(path)


def _stat(result: dict, label: str):
    for s in result["stats"]:
        if s["label"] == label:
            return s["value"]
    return None


def test_pillar1_real_pydeseq2_detects_replicate_level_effect(synth_h5ad):
    """The keystone. gene_0 carries a strong, donor-consistent effect, so the
    honest pseudobulk refit must (a) run on the REAL PyDESeq2 path, not the Welch
    fallback, and (b) still call it significant once aggregated to the 6 donors.
    This doubles as the regression guard for the pseudobulk-sum: the decoupler-2.x
    phantom-row bug nulled this exact effect (honest p came back ~0.96)."""
    cfg = {"unit": "donor_id", "grouping": "condition", "gene": "gene_0", "alpha": 0.05}
    result = job_runner.compute_result(1, synth_h5ad, cfg)

    # The real engine ran. If the pseudobulk path ever degrades to Welch this flips
    # to "Welch t (pseudobulk means)" and fails loudly.
    assert _stat(result, "Honest engine") == "PyDESeq2 pseudobulk"
    # A real replicate-level effect survives aggregation (correct pseudobulk sum).
    assert result["chart"]["honest"]["sig"] is True
    assert result["chart"]["honest"]["n"] == 6  # aggregated to the 6 donors
    assert result["state"] == "clean"


def test_pillar1_real_pydeseq2_clears_true_null_gene(synth_h5ad):
    """Never cry wolf: a true-null gene must not come back significant from the
    honest pseudobulk refit. The real DESeq2 path still runs."""
    cfg = {"unit": "donor_id", "grouping": "condition", "gene": "gene_1", "alpha": 0.05}
    result = job_runner.compute_result(1, synth_h5ad, cfg)

    assert _stat(result, "Honest engine") == "PyDESeq2 pseudobulk"
    assert result["chart"]["honest"]["sig"] is False


def test_pillar3_runs_real_leiden_sweep(synth_h5ad):
    """Pillar 3 must actually sweep Leiden across resolutions (scanpy), producing a
    fragility chart with one step per setting."""
    cfg = {"min": 0.2, "max": 1.0, "step": 0.2}
    result = job_runner.compute_result(3, synth_h5ad, cfg)

    assert result["chart"]["kind"] == "fragility"
    steps = result["chart"]["steps"]
    assert len(steps) >= 3
    # Every step reports a real cluster count from the re-clustering.
    assert all(s["clusters"] >= 1 for s in steps)
    # The point of this module is the real toolchain. Without this the KMeans
    # fallback satisfies every assertion above and the test name is a lie.
    engine = next(s["value"] for s in result["stats"] if s["label"] == "Clustering engine")
    assert engine == "Leiden (scanpy)", f"expected real Leiden, got {engine!r}"


def test_pillar3_kmeans_fallback_is_seeded_and_labeled(synth_h5ad, monkeypatch):
    """When leiden is unavailable the fallback must still honor the seed, and must
    say so. A zero-variance fallback silently masquerading as a resolution sweep is
    exactly the failure this tool exists to catch."""
    from redline.pillars import fragility

    emb = np.random.default_rng(0).normal(size=(80, 6))
    resolutions = [0.2, 0.4, 0.6]

    def _no_leiden(*_a, **_k):
        raise ImportError("No module named 'leidenalg'", name="leidenalg")

    monkeypatch.setattr("scanpy.tl.leiden", _no_leiden)

    labels_a, engine_a = fragility._cluster_sweep(emb, resolutions, seed=1)
    labels_b, engine_b = fragility._cluster_sweep(emb, resolutions, seed=2)

    assert "KMeans fallback" in engine_a and "leidenalg" in engine_a
    assert engine_a == engine_b
    # Different seeds must produce different partitions somewhere in the sweep,
    # otherwise a repeated "stochastic" check collapses to one deterministic run.
    assert any(not np.array_equal(a, b) for a, b in zip(labels_a, labels_b))


def _load_oracle():
    """Import data/oracle.py by path (it lives outside the redline package)."""
    path = RIGOR_ROOT / "data" / "oracle.py"
    spec = importlib.util.spec_from_file_location("redline_oracle", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def oracle_subset(tmp_path):
    """A synthetic 'subset' the oracle's end-to-end check (B) can run offline:
    donor_id + guide_id, 4 donors, an IL2RA-KD arm and a non-targeting arm, counts.
    """
    rng = np.random.default_rng(1)
    n_genes = 24
    donors = [f"donor{i}" for i in range(4)]
    blocks, obs_rows = [], []
    for d in donors:
        for guide, up in (("IL2RA-sg1", True), ("non-targeting-1", False)):
            ncell = 80
            base = rng.poisson(6, size=(ncell, n_genes)).astype(float)
            if up:
                base[:, 0] += rng.poisson(12, size=ncell)  # signal on gene_0
            blocks.append(base)
            obs_rows += [(d, guide) for _ in range(ncell)]
    X = np.vstack(blocks).astype("float32")
    obs = pd.DataFrame(obs_rows, columns=["donor_id", "guide_id"])
    var = pd.DataFrame(index=[f"gene_{i}" for i in range(n_genes)])
    adata = ad.AnnData(X=X, obs=obs, var=var)
    adata.layers["counts"] = X.copy()
    path = tmp_path / "oracle_subset.h5ad"
    adata.write_h5ad(path)
    return str(path)


def test_oracle_check_b_passes_offline(oracle_subset):
    """Wire the Pillar 1 correctness oracle into the suite: its end-to-end check
    (subset -> decoupler pseudobulk -> PyDESeq2) must run and pass offline. This is
    the only automated exercise of the real answer-key path."""
    oracle = _load_oracle()
    rc = oracle.main(
        ["--skip-remote", "--subset", oracle_subset, "--kd-target", "IL2RA", "--focus-gene", "gene_0"]
    )
    assert rc == 0
