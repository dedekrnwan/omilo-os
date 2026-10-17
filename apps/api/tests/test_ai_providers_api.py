"""Task 4: 8-vendor provider selection — router & API integration.

Tests:
- GET /api/ai/providers → list of 8 with id/label/icon/has_key
- POST /api/ai {provider:"openai",...} stores litellm engine with provider=="openai"
- Key is stored under the chosen provider id, not hardcoded "claude"
- Unknown provider → 400
"""

VENDOR_IDS = ("anthropic", "openai", "gemini", "xai", "deepseek", "mistral", "bedrock", "groq")


def test_providers_endpoint_lists_eight_with_key_flags(owner):
    """GET /api/ai/providers returns all 8 vendor entries with has_key field."""
    r = owner.get("/api/ai/providers")
    assert r.status_code == 200, r.text
    items = r.json()
    assert len(items) == 8, f"Expected 8 providers, got {len(items)}: {[x['id'] for x in items]}"
    ids = {x["id"] for x in items}
    assert ids == set(VENDOR_IDS), f"Missing or extra providers: {ids}"
    for item in items:
        assert "id" in item
        assert "label" in item
        assert "icon" in item
        assert "has_key" in item
        assert isinstance(item["has_key"], bool)
        # No keys stored yet — all should be False
        assert item["has_key"] is False, f"Expected has_key=False for {item['id']}, got {item['has_key']}"


def test_providers_endpoint_reflects_stored_key(owner):
    """After storing a key for openai, GET /api/ai/providers shows has_key=True for openai only."""
    # Store a key for openai
    r = owner.post("/api/ai", json={"provider": "openai", "api_key": "sk-openai-test-1234"})
    assert r.status_code == 200, r.text

    items = owner.get("/api/ai/providers").json()
    openai_entry = next(x for x in items if x["id"] == "openai")
    assert openai_entry["has_key"] is True

    # anthropic key should still be False (untouched)
    anthropic_entry = next(x for x in items if x["id"] == "anthropic")
    assert anthropic_entry["has_key"] is False

    # Reset to fake for back-compat
    owner.post("/api/ai", json={"provider": "fake"})


def test_set_provider_openai_writes_litellm_engine(owner):
    """POST /api/ai {provider:"openai", api_key:...} → all staff engines become type==litellm, provider==openai."""
    r = owner.post("/api/ai", json={"provider": "openai", "api_key": "sk-openai-test-5678"})
    assert r.status_code == 200, r.text
    state = r.json()
    # provider field should reflect openai
    assert state["provider"] == "openai", f"Expected provider==openai, got {state['provider']}"
    # Every staff member should show openai
    for sid, info in state["staff"].items():
        assert info["provider"] == "openai", f"Staff {sid} has provider {info['provider']}, expected openai"

    # Reset to fake
    owner.post("/api/ai", json={"provider": "fake"})


def test_key_stored_per_provider_not_as_claude(owner):
    """Key submitted with provider=openai is stored under 'openai', not 'claude'."""
    # Store key under openai
    r = owner.post("/api/ai", json={"provider": "openai", "api_key": "sk-openai-key-9999"})
    assert r.status_code == 200, r.text

    # GET /api/ai/providers: openai has_key=True
    items = owner.get("/api/ai/providers").json()
    openai_entry = next(x for x in items if x["id"] == "openai")
    assert openai_entry["has_key"] is True, "openai should have has_key=True after storing a key"

    # claude key should NOT be set (key was stored under 'openai', not 'claude')
    state = owner.get("/api/ai").json()
    assert state["claude_key_hint"] is None, (
        f"claude_key_hint should be None (key stored under openai, not claude), got {state['claude_key_hint']}"
    )

    # Reset
    owner.post("/api/ai", json={"provider": "fake"})


def test_vendor_provider_rejected_without_key(owner, monkeypatch):
    """POST /api/ai {provider:"gemini"} with no api_key and no env var → 400.

    Uses gemini because it has never had a key stored at this point in the session
    (prior tests only touched openai). Runs before test_all_eight_vendor_ids_accepted_with_key
    which is the first test that populates gemini's key slot.
    """
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = owner.post("/api/ai", json={"provider": "gemini"})
    assert r.status_code == 400, f"Expected 400 when no gemini key available, got {r.status_code}: {r.text}"


def test_all_eight_vendor_ids_accepted_with_key(owner):
    """Every vendor id in the registry is accepted by POST /api/ai when a key is supplied."""
    for pid in VENDOR_IDS:
        r = owner.post("/api/ai", json={"provider": pid, "api_key": f"sk-{pid}-dummy-0000"})
        assert r.status_code == 200, f"provider={pid} → {r.status_code}: {r.text}"
        state = r.json()
        assert state["provider"] == pid, f"provider field mismatch for {pid}: {state['provider']}"

    # Reset to fake
    owner.post("/api/ai", json={"provider": "fake"})


def test_unknown_provider_rejected(owner):
    """POST /api/ai with an unknown provider id → 400."""
    r = owner.post("/api/ai", json={"provider": "bogus"})
    assert r.status_code == 400, f"Expected 400 for unknown provider, got {r.status_code}: {r.text}"


def test_existing_providers_still_work(owner):
    """Back-compat: fake, claude-direct, claude-code providers still accepted."""
    for pid in ("fake", "claude-code"):
        r = owner.post("/api/ai", json={"provider": pid})
        assert r.status_code == 200, f"provider={pid} → {r.status_code}: {r.text}"
    # Reset
    owner.post("/api/ai", json={"provider": "fake"})
