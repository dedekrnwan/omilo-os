"""Role templates and team presets (templates/roles.yaml)."""
from functools import lru_cache
from pathlib import Path

import yaml

FILE = Path(__file__).parent / "templates" / "roles.yaml"


@lru_cache
def catalog() -> dict:
    return yaml.safe_load(FILE.read_text())


def role(rid: str) -> dict | None:
    return catalog()["roles"].get(rid)


def staff_from_role(rid: str, company: str, engine: dict) -> dict:
    r = role(rid)
    if r is None:
        raise KeyError(rid)
    return {"id": rid, "name": r["name"], "role": rid, "is_chief": bool(r.get("is_chief")),
            "job": r["job"].replace("{company}", company or "the company").strip(),
            "engine": dict(engine), "permissions": r.get("permissions", {}), "shifts": list(r.get("shifts", []))}
