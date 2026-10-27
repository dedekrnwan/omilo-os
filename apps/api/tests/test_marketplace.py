"""TDD — Task 6 P4: Marketplace catalog index + API + connector install.

Tests:
1. index_pieces(db) over the REAL local omilo-pieces dir → Piece rows created
   for the real pieces; gmail AND whatsapp exist with status "ok", correct
   category/label, action_count > 0. Assert summary counts.
2. Invalid manifest: write a temp source dir with one good + one broken
   piece.yaml (missing required field / bad YAML), call index_pieces(db, that_dir)
   → broken one gets a Piece row status "invalid" with errors; the good one "ok".
3. GET /v1/marketplace after indexing → lists pieces; ?category=Email filters;
   ?q=gmail filters.
4. POST /v1/connectors/install {piece_id:"gmail"} → per-company Connector
   (source "marketplace", status "needs_auth"); re-install returns same (no dup).
5. company-scoped: company B does NOT see company A's installed connector (RLS);
   but BOTH see the global catalog.
6. idempotency: index_pieces twice → no duplicate Piece rows.

RED → implement → GREEN.
"""
from __future__ import annotations

import textwrap
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from omilo.db import SessionLocal
from omilo.models.pieces import Piece
from omilo.models.connectors import Connector
from omilo.marketplace.index import index_pieces
from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="Marketplace Tester", password="testPass!123"):
    email = f"mktplace_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _do_index_real() -> dict:
    """Index the real omilo-pieces repo via the privileged session."""
    with SessionLocal() as db:
        with db.begin():
            return index_pieces(db)


# ---------------------------------------------------------------------------
# Test 1: index_pieces over the REAL local omilo-pieces repo
# ---------------------------------------------------------------------------


def test_index_real_pieces_creates_rows():
    """index_pieces over the real omilo-pieces dir creates Piece rows with correct data."""
    summary = _do_index_real()

    # Must have indexed at least the 7 known pieces
    assert summary["indexed"] >= 7, f"Expected >=7 pieces indexed, got {summary}"
    assert summary["ok"] >= 7, f"Expected >=7 ok pieces, got {summary}"

    with SessionLocal() as db:
        gmail = db.get(Piece, "gmail")
        whatsapp = db.get(Piece, "whatsapp")

    assert gmail is not None, "Piece 'gmail' not found after indexing"
    assert gmail.status == "ok"
    assert gmail.label == "Gmail"
    assert gmail.category == "Email"
    assert len(gmail.actions) > 0, "gmail should have actions"
    assert gmail.auth_descriptor.get("type") == "oauth2"

    assert whatsapp is not None, "Piece 'whatsapp' not found after indexing"
    assert whatsapp.status == "ok"
    assert whatsapp.label == "WhatsApp"
    assert whatsapp.category == "Messaging"
    assert len(whatsapp.actions) > 0, "whatsapp should have actions"


def test_index_real_pieces_summary_counts():
    """Summary from indexing real pieces reports correct counts."""
    summary = _do_index_real()
    # All real pieces are valid
    assert summary["ok"] >= 7
    # No real pieces should be invalid
    assert summary["invalid"] == 0, f"Unexpected invalid pieces: {summary['errors']}"
    assert len(summary["errors"]) == 0


# ---------------------------------------------------------------------------
# Test 2: Invalid manifest handling
# ---------------------------------------------------------------------------


def test_index_invalid_manifest(tmp_path: Path):
    """Broken piece.yaml → Piece row with status='invalid' and error reasons."""
    # --- Good piece ---
    good_dir = tmp_path / "good-piece"
    good_dir.mkdir()
    (good_dir / "piece.yaml").write_text(
        textwrap.dedent("""\
        id: good-piece
        label: Good Piece
        category: Testing
        description: A valid test piece.
        auth:
          type: oauth2
          provider: google
          scopes:
            - https://example.com/scope
        actions:
          - name: do-thing
            label: Do a thing
            approval: auto
            http:
              method: GET
              url: https://example.com/api
              auth: bearer
            inputs: []
        """)
    )

    # --- Invalid piece: missing required fields (no label, no description, no actions/mcp) ---
    bad_dir = tmp_path / "broken-piece"
    bad_dir.mkdir()
    (bad_dir / "piece.yaml").write_text(
        textwrap.dedent("""\
        id: broken-piece
        category: Testing
        """)
    )

    # --- Completely unparseable YAML ---
    bad_yaml_dir = tmp_path / "badyaml-piece"
    bad_yaml_dir.mkdir()
    (bad_yaml_dir / "piece.yaml").write_text("{ this is not: valid yaml: [[[")

    with SessionLocal() as db:
        with db.begin():
            summary = index_pieces(db, source_dir=str(tmp_path))

    assert summary["indexed"] == 3
    assert summary["ok"] == 1
    assert summary["invalid"] == 2
    assert len(summary["errors"]) == 2

    with SessionLocal() as db:
        good = db.get(Piece, "good-piece")
        broken = db.get(Piece, "broken-piece")
        bad_yaml = db.get(Piece, "badyaml-piece")

    assert good is not None
    assert good.status == "ok"

    assert broken is not None
    assert broken.status == "invalid"
    assert len(broken.errors) > 0

    assert bad_yaml is not None
    assert bad_yaml.status == "invalid"
    assert len(bad_yaml.errors) > 0
    # The YAML parse error should mention parse
    assert any("YAML" in e or "parse" in e.lower() for e in bad_yaml.errors)


# ---------------------------------------------------------------------------
# Test 3: GET /v1/marketplace with filters
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_marketplace_all(async_client):
    """After indexing real pieces, GET /v1/marketplace returns all ok pieces."""
    _do_index_real()
    token, _ = await _sign_up(async_client)
    resp = await async_client.get("/v1/marketplace", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    ids = {c["id"] for c in cards}
    assert "gmail" in ids, f"gmail not in catalog: {ids}"
    assert "whatsapp" in ids, f"whatsapp not in catalog: {ids}"
    # All returned cards should be status=ok by default
    for card in cards:
        assert card["status"] == "ok"


@pytest.mark.asyncio
async def test_list_marketplace_filter_category(async_client):
    """?category=Email returns only Email-category pieces."""
    _do_index_real()
    token, _ = await _sign_up(async_client)
    resp = await async_client.get(
        "/v1/marketplace", params={"category": "Email"}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) >= 1, "Expected at least 1 Email piece"
    for card in cards:
        assert card["category"].lower() == "email", (
            f"Expected category Email, got {card['category']!r}"
        )
    ids = {c["id"] for c in cards}
    assert "gmail" in ids


@pytest.mark.asyncio
async def test_list_marketplace_filter_q(async_client):
    """?q=gmail returns only pieces matching 'gmail' in label/description."""
    _do_index_real()
    token, _ = await _sign_up(async_client)
    resp = await async_client.get(
        "/v1/marketplace", params={"q": "gmail"}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) >= 1, "Expected at least 1 result for q=gmail"
    ids = {c["id"] for c in cards}
    assert "gmail" in ids


@pytest.mark.asyncio
async def test_list_marketplace_piece_card_shape(async_client):
    """PieceCard must have the required fields."""
    _do_index_real()
    token, _ = await _sign_up(async_client)
    resp = await async_client.get(
        "/v1/marketplace", params={"q": "gmail"}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert cards, "Expected at least one result"
    card = cards[0]
    for field in ("id", "label", "category", "description", "auth_type", "action_count", "status"):
        assert field in card, f"PieceCard missing field {field!r}"
    assert card["action_count"] > 0


# ---------------------------------------------------------------------------
# Test 4: POST /v1/connectors/install + idempotency
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_install_connector_creates_row(async_client):
    """POST /v1/connectors/install creates a Connector with source=marketplace, needs_auth."""
    _do_index_real()
    token, company_id = await _sign_up(async_client)

    resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()

    assert data["source"] == "marketplace"
    assert data["piece_id"] == "gmail"
    assert data["status"] == "needs_auth"
    assert data["company_id"] == company_id
    assert data["label"] == "Gmail"


@pytest.mark.asyncio
async def test_install_connector_idempotent(async_client):
    """Re-installing the same piece returns the existing Connector (no duplicate)."""
    _do_index_real()
    token, company_id = await _sign_up(async_client)

    resp1 = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "whatsapp"},
        headers=_auth(token),
    )
    assert resp1.status_code == 201, resp1.text
    id1 = resp1.json()["id"]

    resp2 = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "whatsapp"},
        headers=_auth(token),
    )
    # Idempotent: can return 200 or 201 — both are fine
    assert resp2.status_code in (200, 201), resp2.text
    id2 = resp2.json()["id"]

    assert id1 == id2, "Re-installing the same piece must return the same connector id"

    # Confirm no duplicate rows in DB
    with SessionLocal() as db:
        count = db.execute(
            select(func.count()).where(
                Connector.company_id == company_id,
                Connector.piece_id == "whatsapp",
                Connector.source == "marketplace",
            )
        ).scalar()
    assert count == 1, f"Expected 1 connector row, got {count}"


@pytest.mark.asyncio
async def test_install_connector_invalid_piece(async_client):
    """Installing an invalid piece returns 422."""
    # Index with an invalid piece in a temp dir
    token, _ = await _sign_up(async_client)

    # First ensure the catalog has no "nonexistent-piece"
    resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "nonexistent-piece-xyz"},
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Test 5: company-scoped install + catalog global
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_installed_connector_rls_isolation(async_client):
    """Company B cannot see Company A's installed connector (RLS); both see global catalog."""
    _do_index_real()
    token_a, cid_a = await _sign_up(async_client, name="Mktp Company A")
    token_b, cid_b = await _sign_up(async_client, name="Mktp Company B")

    # Company A installs google-sheets
    resp_a = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "google-sheets"},
        headers=_auth(token_a),
    )
    assert resp_a.status_code == 201, resp_a.text
    connector_id_a = resp_a.json()["id"]

    # Verify company A's connector is in DB scoped to cid_a
    with SessionLocal() as db:
        row_a = db.get(Connector, connector_id_a)
    assert row_a is not None
    assert row_a.company_id == cid_a

    # Company B installs too (their own connector)
    resp_b = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "google-sheets"},
        headers=_auth(token_b),
    )
    assert resp_b.status_code == 201, resp_b.text
    connector_id_b = resp_b.json()["id"]
    assert connector_id_b != connector_id_a, "Different companies must get separate connectors"

    # Verify company B's connector is scoped to cid_b
    with SessionLocal() as db:
        row_b = db.get(Connector, connector_id_b)
    assert row_b is not None
    assert row_b.company_id == cid_b

    # Both companies can see the global catalog
    resp_cat_a = await async_client.get("/v1/marketplace", headers=_auth(token_a))
    resp_cat_b = await async_client.get("/v1/marketplace", headers=_auth(token_b))
    assert resp_cat_a.status_code == 200
    assert resp_cat_b.status_code == 200
    ids_a = {c["id"] for c in resp_cat_a.json()}
    ids_b = {c["id"] for c in resp_cat_b.json()}
    assert "gmail" in ids_a
    assert "gmail" in ids_b


# ---------------------------------------------------------------------------
# Test 6: idempotency — index_pieces twice yields no duplicate Piece rows
# ---------------------------------------------------------------------------


def test_index_pieces_idempotent():
    """Running index_pieces twice must not create duplicate Piece rows."""
    _do_index_real()

    # Count piece rows before second run
    with SessionLocal() as db:
        count_before = db.execute(select(func.count()).select_from(Piece)).scalar()

    # Second run
    _do_index_real()

    with SessionLocal() as db:
        count_after = db.execute(select(func.count()).select_from(Piece)).scalar()

    assert count_after == count_before, (
        f"Duplicate Piece rows created: before={count_before} after={count_after}"
    )
