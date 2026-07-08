"""Bedrock Claude transport with record/replay, so the frozen number is
reproducible with zero credentials.

Two modes:

  live     call Bedrock on a cache miss, record the (request -> response) to a
           committed JSONL transcript, reuse the cache on a hit. Idempotent:
           re-running only calls for prompts not already recorded.
  replay   never touch the network. Serve every call from the transcript; a
           miss is an error. This is the default, so anyone can reproduce the
           exact number from the committed transcript without AWS access.

Every call is keyed by a hash of (model, system, user, max_tokens, temperature),
and the full prompt is stored in the transcript, so the eval is fully auditable.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Optional

from . import spec

_LOCK = threading.Lock()
_CACHE: dict[str, dict] = {}
_MODE = "replay"
_CLIENT = None
_LOADED = False
_STATS = {"hits": 0, "live_calls": 0, "in_tokens": 0, "out_tokens": 0}


def set_mode(mode: str) -> None:
    global _MODE
    assert mode in ("live", "replay")
    _MODE = mode


def stats() -> dict:
    with _LOCK:
        return dict(_STATS)


def _key(model: str, system: str, user: str, max_tokens: int, temperature: float) -> str:
    h = hashlib.sha256()
    for part in (model, system, user, str(max_tokens), f"{temperature:.3f}"):
        h.update(part.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:20]


def _load() -> None:
    global _LOADED
    if _LOADED:
        return
    if os.path.exists(spec.TRANSCRIPT_PATH):
        with open(spec.TRANSCRIPT_PATH, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                _CACHE[rec["key"]] = rec
    _LOADED = True


def _client():
    global _CLIENT
    if _CLIENT is None:
        import boto3
        _CLIENT = boto3.client("bedrock-runtime", region_name=spec.AWS_REGION)
    return _CLIENT


def _invoke(model: str, system: str, user: str, max_tokens: int, temperature: float) -> dict:
    body = {
        "anthropic_version": spec.ANTHROPIC_BEDROCK_VERSION,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    last_err: Optional[Exception] = None
    for attempt in range(5):
        try:
            resp = _client().invoke_model(
                modelId=model, contentType="application/json",
                accept="application/json", body=json.dumps(body),
            )
            payload = json.loads(resp["body"].read())
            text = "".join(b.get("text", "") for b in payload.get("content", [])
                           if b.get("type") == "text")
            usage = payload.get("usage", {})
            return {"text": text, "in_tokens": usage.get("input_tokens", 0),
                    "out_tokens": usage.get("output_tokens", 0),
                    "stop_reason": payload.get("stop_reason")}
        except Exception as exc:  # throttling / transient
            last_err = exc
            name = type(exc).__name__
            if "Throttl" in name or "TooManyRequests" in str(exc) or "ServiceUnavailable" in name:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError(f"Bedrock invoke failed after retries: {last_err}")


def call(system: str, user: str, *, model: Optional[str] = None,
         max_tokens: Optional[int] = None, temperature: Optional[float] = None,
         tag: str = "") -> str:
    """One Claude call, cached. Returns the response text."""
    model = model or spec.DEFAULT_MODEL
    max_tokens = max_tokens or spec.LLM_MAX_TOKENS
    temperature = spec.LLM_TEMPERATURE if temperature is None else temperature
    _load()
    k = _key(model, system, user, max_tokens, temperature)
    with _LOCK:
        hit = _CACHE.get(k)
        if hit is not None:
            _STATS["hits"] += 1
            return hit["text"]
    if _MODE == "replay":
        raise RuntimeError(
            f"replay cache miss (tag={tag!r}, key={k}). Run with --live to record this call.")
    result = _invoke(model, system, user, max_tokens, temperature)
    rec = {
        "key": k, "tag": tag, "model": model,
        "max_tokens": max_tokens, "temperature": temperature,
        "system": system, "user": user,
        "text": result["text"], "in_tokens": result["in_tokens"],
        "out_tokens": result["out_tokens"], "stop_reason": result["stop_reason"],
    }
    with _LOCK:
        _CACHE[k] = rec
        _STATS["live_calls"] += 1
        _STATS["in_tokens"] += result["in_tokens"]
        _STATS["out_tokens"] += result["out_tokens"]
        os.makedirs(os.path.dirname(spec.TRANSCRIPT_PATH), exist_ok=True)
        with open(spec.TRANSCRIPT_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    return result["text"]


def extract_json(text: str) -> dict:
    """Tolerant JSON extraction: raw, then a fenced block, then first{..last}."""
    import re
    text = text.strip()
    for candidate in (text,):
        try:
            return json.loads(candidate)
        except Exception:
            pass
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    i, j = text.find("{"), text.rfind("}")
    if 0 <= i < j:
        try:
            return json.loads(text[i:j + 1])
        except Exception:
            pass
    raise ValueError(f"no JSON object found in model output: {text[:200]!r}")
