"""
Markdown-aware text chunker.

Strategy
--------
1. Split the document at markdown headings (lines starting with one or more `#`).
2. Each section becomes one or more chunks of ~TARGET_CHARS characters.
3. Consecutive chunks within a section share ~OVERLAP_CHARS of text.
4. Sections shorter than MIN_CHUNK_CHARS are merged into the previous chunk
   so we never emit tiny fragments.

Public API
----------
    chunk(body: str) -> list[tuple[str, str]]

Each tuple is (heading, text) where `heading` is the nearest markdown heading
above the chunk (empty string if none).  Output is fully deterministic.
"""

from __future__ import annotations

import re

TARGET_CHARS: int = 900
OVERLAP_CHARS: int = 120
MIN_CHUNK_CHARS: int = 100  # merge chunks below this length

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)", re.MULTILINE)


def _split_sections(body: str) -> list[tuple[str, str]]:
    """Return [(heading, text), ...] — raw, before size-based splitting."""
    if not body:
        return []

    matches = list(_HEADING_RE.finditer(body))
    if not matches:
        return [("", body)]

    sections: list[tuple[str, str]] = []
    # Text before the first heading
    pre = body[: matches[0].start()]
    if pre.strip():
        sections.append(("", pre))

    for i, m in enumerate(matches):
        heading = m.group(0).lstrip("#").strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        text = body[start:end]
        sections.append((heading, text))

    return sections


def _split_on_size(heading: str, text: str) -> list[tuple[str, str]]:
    """Split a single section's text into TARGET_CHARS chunks with OVERLAP_CHARS overlap."""
    text = text.strip()
    if not text:
        return []

    if len(text) <= TARGET_CHARS:
        return [(heading, text)]

    chunks: list[tuple[str, str]] = []
    start = 0
    while start < len(text):
        end = start + TARGET_CHARS
        if end >= len(text):
            chunk_text = text[start:]
        else:
            # Try to break at a whitespace boundary near `end`
            boundary = text.rfind(" ", start, end)
            if boundary == -1 or boundary <= start:
                boundary = end
            chunk_text = text[start:boundary]

        if chunk_text.strip():
            chunks.append((heading, chunk_text.strip()))

        if end >= len(text):
            break

        # Next chunk starts TARGET_CHARS - OVERLAP_CHARS forward (so we overlap)
        advance = max(1, TARGET_CHARS - OVERLAP_CHARS)
        start += advance

    return chunks


def _merge_tiny(chunks: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Merge chunks shorter than MIN_CHUNK_CHARS into their predecessor."""
    if not chunks:
        return chunks

    merged: list[tuple[str, str]] = [chunks[0]]
    for heading, text in chunks[1:]:
        prev_heading, prev_text = merged[-1]
        if len(text.strip()) < MIN_CHUNK_CHARS:
            # Absorb into previous chunk
            merged[-1] = (prev_heading, (prev_text + "\n\n" + text).strip())
        elif len(prev_text.strip()) < MIN_CHUNK_CHARS:
            # Previous was tiny — absorb current into it
            merged[-1] = (prev_heading, (prev_text + "\n\n" + text).strip())
        else:
            merged.append((heading, text))

    return merged


def chunk(body: str) -> list[tuple[str, str]]:
    """
    Split *body* into citeable (heading, text) chunks.

    - Markdown headings act as natural section boundaries.
    - Sections larger than ~TARGET_CHARS are split further with ~OVERLAP_CHARS overlap.
    - Adjacent tiny chunks (< MIN_CHUNK_CHARS) are merged so no fragment is emitted.
    - Output is fully deterministic (no randomness, no process-level state).

    Parameters
    ----------
    body:
        Raw markdown or plain-text string.

    Returns
    -------
    list of (heading, text) tuples.  `heading` is "" when no heading is above the chunk.
    """
    if not body or not body.strip():
        return []

    sections = _split_sections(body)

    raw_chunks: list[tuple[str, str]] = []
    for heading, text in sections:
        raw_chunks.extend(_split_on_size(heading, text))

    return _merge_tiny(raw_chunks)
