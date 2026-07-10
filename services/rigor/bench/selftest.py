"""Self-tests for the benchmark harness. Runnable with no credentials:

    python -m bench.selftest

These prove the harness can FAIL, not just pass: the labeler discriminates
errors from clean data, the scorer reflects a null arm as 0% detection and a
flag-everything arm as 100% false positives, generation and labeling are
deterministic, and replay mode never fabricates a missing LLM call. If any of
these did not hold, the headline number would not be trustworthy.
"""

from __future__ import annotations

import sys

import numpy as np
import pandas as pd

from . import generate, labeler, llm, score, spec


def _toy(seed: int, p1_error: bool, confounded: bool):
    """A tiny synthetic case with knobs for the pseudorep and confound errors."""
    rng = np.random.default_rng(seed)
    donors = [f"D{i+1}" for i in range(6)]
    cond = {d: ("control" if i < 3 else "treated") for i, d in enumerate(donors)}
    n_per = 100
    dcol, ccol = [], []
    for d in donors:
        dcol += [d] * n_per
        ccol += [cond[d]] * n_per
    dcol, ccol = np.array(dcol), np.array(ccol)
    n = dcol.size
    # enough background genes that library-size normalization preserves the focus
    # gene's signal (matches the real generator's gene composition)
    var = ["G0"] + [f"BG{i}" for i in range(100)]
    X = rng.poisson(1.0, size=(n, len(var))).astype(np.int64)
    if p1_error:
        lam = {d: float(rng.uniform(2, 3)) for d in donors}
        lam[donors[5]] = 14.0
        X[:, 0] = rng.poisson([lam[d] for d in dcol])
    else:
        X[:, 0] = rng.poisson(np.where(ccol == "treated", 9.0, 2.5))
    nuis = np.where(ccol == "treated", "A", "B") if confounded else rng.choice(["A", "B"], size=n)
    obs = {"condition": ccol, "donor_id": dcol,
           "cell_state": np.array(["S"] * n), "batch": nuis}
    return X.astype(np.float64), var, obs


def test_labeler_discriminates() -> None:
    # pseudoreplication: present when planted, absent for a real donor-consistent effect
    X, var, obs = _toy(1, p1_error=True, confounded=False)
    r = labeler.label_pseudoreplication(X, var, "G0", obs["condition"], obs["donor_id"])
    assert r["present"] is True, r
    X, var, obs = _toy(2, p1_error=False, confounded=False)
    r = labeler.label_pseudoreplication(X, var, "G0", obs["condition"], obs["donor_id"])
    assert r["present"] is False, r
    # confounding: present when collinear, absent when balanced
    _, _, obs = _toy(3, p1_error=False, confounded=True)
    assert labeler.label_confounding(obs["condition"], obs["batch"])["present"] is True
    _, _, obs = _toy(4, p1_error=False, confounded=False)
    assert labeler.label_confounding(obs["condition"], obs["batch"])["present"] is False
    print("PASS test_labeler_discriminates")


def _synth_per_case(detected_fn):
    """Two present + two absent pillar-instances per case, detection set by fn."""
    per_case = {}
    truth = {"pseudoreplication": True, "double_dipping": True,
             "fragility": False, "confounding": False}
    for i in range(5):
        cid = f"c{i}"
        det = {k: detected_fn(k, truth[k]) for k in spec.PILLAR_KEYS}
        per_case[cid] = {"family": "x", "truth": dict(truth),
                         "arms": {a: {"detected": dict(det)} for a in score.ARMS}}
    return per_case


def test_scorer_null_and_everything_arms() -> None:
    # a null arm (never flags) -> 0% detection, 0% FP
    pc = _synth_per_case(lambda k, t: False)
    o = score._rates(score._confusion(pc, "baseline", None))
    assert o["detection"] == 0.0 and o["fp_rate"] == 0.0, o
    # a flag-everything arm -> 100% detection AND 100% FP (this is the never-cry-wolf trap)
    pc = _synth_per_case(lambda k, t: True)
    o = score._rates(score._confusion(pc, "baseline", None))
    assert o["detection"] == 1.0 and o["fp_rate"] == 1.0, o
    # a perfect arm -> 100% detection, 0% FP
    pc = _synth_per_case(lambda k, t: t)
    o = score._rates(score._confusion(pc, "baseline", None))
    assert o["detection"] == 1.0 and o["fp_rate"] == 0.0 and o["youden_j"] == 1.0, o
    print("PASS test_scorer_null_and_everything_arms")


def test_scorer_arithmetic() -> None:
    # one present pillar, detected; one absent pillar, wrongly detected
    per_case = {"c": {"family": "x",
                      "truth": {"pseudoreplication": True, "double_dipping": False,
                                "fragility": False, "confounding": False},
                      "arms": {"baseline": {"detected": {
                          "pseudoreplication": True, "double_dipping": True,
                          "fragility": False, "confounding": False}}}}}
    c = score._confusion(per_case, "baseline", None)
    assert c == {"tp": 1, "fp": 1, "fn": 0, "tn": 2}, c
    r = score._rates(c)
    assert r["detection"] == 1.0 and abs(r["fp_rate"] - 1 / 3) < 1e-9 and r["precision"] == 0.5, r
    print("PASS test_scorer_arithmetic")


def test_generation_deterministic() -> None:
    a = generate._build("p1", "pos", 12345)
    b = generate._build("p1", "pos", 12345)
    assert np.array_equal(np.asarray(a.adata.layers["counts"]),
                          np.asarray(b.adata.layers["counts"])), "generation not deterministic"
    la = generate._truth_of(a.adata, a.claim)["truth"]
    lb = generate._truth_of(b.adata, b.claim)["truth"]
    assert la == lb, "labeling not deterministic"
    print("PASS test_generation_deterministic")


def test_replay_miss_is_strict() -> None:
    llm.set_mode("replay")
    try:
        llm.call("a never-before-seen system prompt zzz", "a never-before-seen user prompt zzz",
                 tag="selftest")
    except RuntimeError as exc:
        assert "replay cache miss" in str(exc)
        print("PASS test_replay_miss_is_strict")
        return
    raise AssertionError("replay mode did not raise on a cache miss (would fabricate silently)")


def main() -> int:
    tests = [test_labeler_discriminates, test_scorer_null_and_everything_arms,
             test_scorer_arithmetic, test_generation_deterministic,
             test_replay_miss_is_strict]
    failed = 0
    for t in tests:
        try:
            t()
        except Exception as exc:
            failed += 1
            print(f"FAIL {t.__name__}: {type(exc).__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
