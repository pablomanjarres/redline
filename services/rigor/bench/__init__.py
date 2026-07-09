"""Redline detection benchmark (Add-on 5).

A small, open benchmark of single-cell analyses with known planted statistical
errors, plus clean controls, run through two arms:

  Redline arm    the four deterministic checks + an LLM critic (the real engine)
  Baseline arm   a single Claude call given the same analysis write-up

Ground truth comes from construction and is validated by an INDEPENDENT
numpy/scipy labeler (``bench.labeler``), never from the Redline engine, so the
score is a real measurement and not a tautology. See ``bench/README.md``.
"""
