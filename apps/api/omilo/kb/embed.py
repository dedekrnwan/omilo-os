"""
Pluggable embedding providers.

Public API
----------
    class Embedder(Protocol): ...
    class HashEmbedder: ...
    class EmbedderNotConfigured(Exception): ...
    get_embedder(cfg: dict) -> Embedder

HashEmbedder is a **pure, deterministic, offline** fallback.  It uses
hashlib.blake2b (stable across Python processes and versions) — NOT the
built-in hash() which is salted per-process and non-deterministic.

Algorithm (per text):
    1. Tokenise: lowercase, split on non-alphanumeric runs.
    2. For each token t:
         raw   = int.from_bytes(blake2b(t, digest_size=8).digest(), 'little')
         index = raw % dim                   → which bucket to update
         sign  = 1 if (raw >> 63) & 1 else -1  → signed feature (hashing trick)
         vec[index] += sign
    3. L2-normalise the resulting float vector (leave as zeros if all-zero).

Same text + same dim → identical vector everywhere.
"""

from __future__ import annotations

import hashlib
import math
import re
from typing import Protocol, runtime_checkable

_TOKEN_RE = re.compile(r"[a-z0-9]+")


@runtime_checkable
class Embedder(Protocol):
    dim: int

    def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class EmbedderNotConfigured(Exception):
    """Raised when a non-hash provider is requested but not yet configured."""


class HashEmbedder:
    """Deterministic word-hash embedder — pure offline, no IO."""

    dim: int = 256

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(t) for t in texts]

    def _embed_one(self, text: str) -> list[float]:
        tokens = _TOKEN_RE.findall(text.lower())
        if not tokens:
            return [0.0] * self.dim

        vec = [0.0] * self.dim
        for token in tokens:
            digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
            raw = int.from_bytes(digest, "little")
            index = raw % self.dim
            sign = 1.0 if (raw >> 63) & 1 else -1.0
            vec[index] += sign

        # L2-normalise
        norm = math.sqrt(sum(v * v for v in vec))
        if norm == 0.0:
            return vec  # all-zero (shouldn't happen with tokens, but be safe)
        return [v / norm for v in vec]


def get_embedder(cfg: dict) -> Embedder:
    """
    Resolve an Embedder from *cfg*.

    cfg keys
    --------
    type : str, default "hash"
        "hash"       → HashEmbedder (always available)
        "fastembed"  → EmbedderNotConfigured (P4)
        "voyage"     → EmbedderNotConfigured (P4)
        "openai"     → EmbedderNotConfigured (P4)
        anything else → ValueError
    """
    provider = cfg.get("type", "hash")

    if provider == "hash":
        return HashEmbedder()

    if provider in ("fastembed", "voyage", "openai"):
        raise EmbedderNotConfigured(
            f"Embedder provider '{provider}' is not yet configured. "
            "Set it up in Control-Panel → Knowledge (P4)."
        )

    raise ValueError(f"Unknown embedder type: {provider!r}")
