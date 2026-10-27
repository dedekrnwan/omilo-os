"""
Tests for kb.chunk and kb.embed — pure offline logic, no DB/network.
RED → implement → GREEN.
"""

import math
import pytest

# ---------------------------------------------------------------------------
# chunk tests
# ---------------------------------------------------------------------------

MULTI_SECTION_MD = """\
# Introduction

This is the introduction section. It has some text but not much.

## Background

Here we explain the background in more detail. This section is longer and provides
context for the rest of the document. It includes several paragraphs of information
about the system, its origins, and its purpose. The background section serves as the
foundation for understanding the rest of the document. We want to make sure this is
well-understood before moving on to the details.

## Details

""" + ("This is a detail paragraph with lots of content. " * 20) + """

## Summary

Wrap up here.
"""

LONG_SECTION_MD = """\
# Long Section

""" + ("x" * 900 + " " + "y" * 900 + " " + "z" * 900) + """
"""

TINY_ADJACENT_MD = """\
# Tiny

Hi.

Also hi.

Still tiny.

## Big

""" + ("This is a much bigger section with real content. " * 20) + """
"""


def test_chunk_splits_at_headings():
    from omilo.kb.chunk import chunk

    chunks = chunk(MULTI_SECTION_MD)
    assert isinstance(chunks, list)
    assert len(chunks) >= 2
    # Each item is (heading, text) tuple
    for heading, text in chunks:
        assert isinstance(heading, str)
        assert isinstance(text, str)
        assert text.strip()


def test_chunk_headings_are_tagged():
    from omilo.kb.chunk import chunk

    chunks = chunk(MULTI_SECTION_MD)
    headings = [h for h, _ in chunks]
    # We should see at least one of the headings from the doc
    all_headings_joined = " ".join(headings)
    # At least some chunks should carry a non-empty heading
    assert any(h for h in headings)


def test_chunk_long_section_splits():
    from omilo.kb.chunk import chunk

    chunks = chunk(LONG_SECTION_MD)
    # Long section (>900 chars) should produce multiple chunks
    assert len(chunks) >= 2
    for _, text in chunks:
        # Each chunk should not wildly exceed target (allow some slack)
        assert len(text) < 1200, f"chunk too long: {len(text)}"


def test_chunk_no_tiny_fragments():
    from omilo.kb.chunk import chunk

    chunks = chunk(TINY_ADJACENT_MD)
    # Tiny adjacent chunks should be merged — no 5-char fragments
    for _, text in chunks:
        assert len(text.strip()) > 20, f"tiny chunk found: {text!r}"


def test_chunk_deterministic():
    from omilo.kb.chunk import chunk

    c1 = chunk(MULTI_SECTION_MD)
    c2 = chunk(MULTI_SECTION_MD)
    assert c1 == c2


def test_chunk_empty_string():
    from omilo.kb.chunk import chunk

    result = chunk("")
    assert result == [] or all(text.strip() == "" for _, text in result)


def test_chunk_no_headings():
    from omilo.kb.chunk import chunk

    plain = "Just plain text without any headings whatsoever. " * 10
    chunks = chunk(plain)
    assert isinstance(chunks, list)
    # Heading should be empty string when no heading present
    for heading, _ in chunks:
        assert heading == ""


# ---------------------------------------------------------------------------
# HashEmbedder tests
# ---------------------------------------------------------------------------


def test_hash_embedder_returns_256_floats():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    result = emb.embed(["hello world"])
    assert len(result) == 1
    vec = result[0]
    assert len(vec) == 256
    assert all(isinstance(v, float) for v in vec)


def test_hash_embedder_deterministic_same_instance():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    v1 = emb.embed(["hello world"])[0]
    v2 = emb.embed(["hello world"])[0]
    assert v1 == v2


def test_hash_embedder_deterministic_across_instances():
    """Two separate HashEmbedder instances must produce identical vectors.
    This works because we use hashlib (stable), not Python's built-in hash()
    (which is salted per-process and non-deterministic across runs).
    """
    from omilo.kb.embed import HashEmbedder

    emb_a = HashEmbedder()
    emb_b = HashEmbedder()
    va = emb_a.embed(["determinism test"])[0]
    vb = emb_b.embed(["determinism test"])[0]
    assert va == vb


def test_hash_embedder_different_texts_different_vectors():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    v1 = emb.embed(["hello world"])[0]
    v2 = emb.embed(["completely different text"])[0]
    assert v1 != v2


def test_hash_embedder_l2_norm_approx_one():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    vec = emb.embed(["some reasonable text with multiple words"])[0]
    norm = math.sqrt(sum(v * v for v in vec))
    assert abs(norm - 1.0) < 1e-6, f"L2 norm is {norm}, expected ~1.0"


def test_hash_embedder_empty_text_zero_vector():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    vec = emb.embed([""])[0]
    assert len(vec) == 256
    norm = math.sqrt(sum(v * v for v in vec))
    assert norm == 0.0


def test_hash_embedder_whitespace_text_zero_vector():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    vec = emb.embed(["   \t\n  "])[0]
    norm = math.sqrt(sum(v * v for v in vec))
    assert norm == 0.0


def test_hash_embedder_batch():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    texts = ["alpha", "beta", "gamma"]
    result = emb.embed(texts)
    assert len(result) == 3
    # All distinct
    assert result[0] != result[1]
    assert result[1] != result[2]


def test_hash_embedder_dim_attribute():
    from omilo.kb.embed import HashEmbedder

    emb = HashEmbedder()
    assert emb.dim == 256


# ---------------------------------------------------------------------------
# get_embedder factory tests
# ---------------------------------------------------------------------------


def test_get_embedder_hash_default():
    from omilo.kb.embed import HashEmbedder, get_embedder

    emb = get_embedder({})
    assert isinstance(emb, HashEmbedder)


def test_get_embedder_hash_explicit():
    from omilo.kb.embed import HashEmbedder, get_embedder

    emb = get_embedder({"type": "hash"})
    assert isinstance(emb, HashEmbedder)


def test_get_embedder_fastembed_raises():
    from omilo.kb.embed import EmbedderNotConfigured, get_embedder

    with pytest.raises(EmbedderNotConfigured):
        get_embedder({"type": "fastembed"})


def test_get_embedder_voyage_raises():
    from omilo.kb.embed import EmbedderNotConfigured, get_embedder

    with pytest.raises(EmbedderNotConfigured):
        get_embedder({"type": "voyage"})


def test_get_embedder_openai_raises():
    from omilo.kb.embed import EmbedderNotConfigured, get_embedder

    with pytest.raises(EmbedderNotConfigured):
        get_embedder({"type": "openai"})


def test_get_embedder_unknown_raises():
    from omilo.kb.embed import get_embedder

    with pytest.raises(ValueError):
        get_embedder({"type": "unknown_provider"})
