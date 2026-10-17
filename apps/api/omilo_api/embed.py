"""Embeddings for the knowledge base: text → a list of numbers, so similar meaning lands close together in pgvector.

Providers (pick in Settings → Knowledge; the default comes from OMILO_EMBED_PROVIDER):
- local:  a small open model that runs inside Omilo (fastembed / ONNX, no GPU). Free, private, works offline once
          downloaded (~120–500 MB, cached in <data_dir>/models). Default: paraphrase-multilingual-MiniLM-L12-v2, which
          understands Indonesian and English.
- voyage: Voyage AI (Anthropic's recommended embeddings), needs a Voyage API key.
- openai: OpenAI text-embedding-3, needs an OpenAI API key.
- hash:   no model at all: words and letter groups hashed into a vector. Only for tests and as a last resort.

Every chunk records the model and size it was embedded with; switching provider re-embeds everything in the background.
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import threading
from dataclasses import dataclass

import httpx

log = logging.getLogger("omilo.embed")

LOCAL_MODELS: dict[str, dict] = {
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": {"dim": 384, "label": "Multilingual MiniLM (fast, 50+ languages incl. Indonesian)", "size_mb": 220},
    "intfloat/multilingual-e5-large": {"dim": 1024, "label": "Multilingual E5 large (best local quality, slower)", "size_mb": 2240},
    "BAAI/bge-small-en-v1.5": {"dim": 384, "label": "BGE small (English only, smallest)", "size_mb": 67},
}
VOYAGE_MODELS = {"voyage-3.5-lite": 1024, "voyage-3.5": 1024, "voyage-3-large": 1024}
OPENAI_MODELS = {"text-embedding-3-small": 1536, "text-embedding-3-large": 3072}
DEFAULT_MODEL = {"local": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", "voyage": "voyage-3.5-lite",
                 "openai": "text-embedding-3-small", "hash": "hash-384"}
PROVIDERS = {
    "local": {"label": "On this computer", "needs_key": False, "models": {k: v["label"] for k, v in LOCAL_MODELS.items()}},
    "voyage": {"label": "Voyage AI", "needs_key": True, "models": {k: f"{k} ({d} dims)" for k, d in VOYAGE_MODELS.items()}},
    "openai": {"label": "OpenAI", "needs_key": True, "models": {k: f"{k} ({d} dims)" for k, d in OPENAI_MODELS.items()}},
    "hash": {"label": "No model (word matching only)", "needs_key": False, "models": {"hash-384": "Hashed words, 384 dims"}},
}


class EmbedError(RuntimeError):
    pass


@dataclass
class Embedder:
    provider: str
    model: str
    dim: int
    key: str | None = None

    @property
    def tag(self) -> str:
        return f"{self.provider}:{self.model}"

    def ready(self) -> bool:
        """False while a local model is still loading (the worker loads it; searches use words meanwhile)."""
        return self.provider != "local" or self.model in _local_models

    def embed(self, texts: list[str], kind: str = "doc") -> list[list[float]]:
        """kind: doc (things to find) or query (what someone searches for)."""
        if not texts:
            return []
        texts = [t[:8000] for t in texts]
        if self.provider == "hash":
            return [_hash_vec(t, self.dim) for t in texts]
        if self.provider == "local":
            return _local(self.model, texts, kind)
        if self.provider == "voyage":
            return _remote("https://api.voyageai.com/v1/embeddings", self.key,
                           {"model": self.model, "input": texts, "input_type": "query" if kind == "query" else "document"}, self.dim)
        if self.provider == "openai":
            return _remote("https://api.openai.com/v1/embeddings", self.key, {"model": self.model, "input": texts}, self.dim)
        raise EmbedError(f"unknown embedding provider {self.provider!r}")


def current(db) -> Embedder:
    """The embedder this company uses (Settings → Knowledge, else OMILO_EMBED_PROVIDER)."""
    from . import services as S
    from .config import get_settings

    cfg = S.get_setting(db, "kb_embedder", None) or {}
    provider = cfg.get("provider") or get_settings().embed_provider
    if provider not in PROVIDERS:
        provider = "local"
    model = cfg.get("model") or DEFAULT_MODEL[provider]
    if provider == "local":
        dim = LOCAL_MODELS.get(model, {}).get("dim") or 384
    elif provider == "voyage":
        dim = VOYAGE_MODELS.get(model, 1024)
    elif provider == "openai":
        dim = OPENAI_MODELS.get(model, 1536)
    else:
        dim = 384
    key = S.ai_api_key(db, provider) if PROVIDERS[provider]["needs_key"] else None
    if PROVIDERS[provider]["needs_key"] and not key:
        raise EmbedError(f"{PROVIDERS[provider]['label']} needs an API key (Settings → Knowledge)")
    return Embedder(provider, model, dim, key)


# ------------------------------------------------------------------ providers
_local_models: dict[str, object] = {}
_local_lock = threading.Lock()
_local_errors: dict[str, str] = {}


def _local(model: str, texts: list[str], kind: str) -> list[list[float]]:
    m = _local_models.get(model)
    if m is None:
        with _local_lock:
            m = _local_models.get(model)
            if m is None:
                try:
                    from fastembed import TextEmbedding

                    from .config import get_settings

                    cfg = get_settings()
                    from pathlib import Path

                    cache = Path(cfg.models_dir) if cfg.models_dir else cfg.data_dir / "models"
                    cache.mkdir(parents=True, exist_ok=True)
                    m = TextEmbedding(model, cache_dir=str(cache))
                    _local_models[model] = m
                    _local_errors.pop(model, None)
                except Exception as e:  # noqa: BLE001 - shown in Settings and Docs → Knowledge
                    _local_errors[model] = str(e)[:300]
                    raise EmbedError(f"the local model could not load ({str(e)[:200]}); it downloads once from Hugging Face") from e
    if "e5" in model:  # E5 models want these prefixes
        texts = [("query: " if kind == "query" else "passage: ") + t for t in texts]
    return [[float(x) for x in v] for v in m.embed(texts, batch_size=32)]


def local_status(model: str) -> dict:
    return {"loaded": model in _local_models, "error": _local_errors.get(model)}


def _remote(url: str, key: str | None, body: dict, dim: int) -> list[list[float]]:
    try:
        r = httpx.post(url, json=body, headers={"Authorization": f"Bearer {key}"}, timeout=60)
    except httpx.HTTPError as e:
        raise EmbedError(f"could not reach {url.split('/')[2]}: {type(e).__name__}") from e
    if r.status_code >= 400:
        raise EmbedError(f"{url.split('/')[2]} answered {r.status_code}: {r.text[:200]}")
    data = sorted(r.json().get("data", []), key=lambda d: d.get("index", 0))
    out = [d["embedding"] for d in data]
    if out and len(out[0]) != dim:
        raise EmbedError(f"expected {dim} numbers per text, got {len(out[0])}")
    return out


_TOKEN = re.compile(r"\w+", re.UNICODE)


def _hash_vec(text: str, dim: int) -> list[float]:
    """Words and 3-letter groups, hashed into `dim` signed buckets and normalized (cosine works on word overlap)."""
    v = [0.0] * dim
    words = [w.lower() for w in _TOKEN.findall(text)]
    feats = words + [w[i:i + 3] for w in words if len(w) > 3 for i in range(len(w) - 2)]
    for f in feats:
        h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
        v[h % dim] += 1.0 if (h >> 40) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]
