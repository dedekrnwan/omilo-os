"""An example cloud plugin for the test suite (and a template for your own).

The real Omilo Cloud catalog and payment gateway live in a private plugin;
these plans and prices are illustrative only. Enable a plugin with
``OMILO_CLOUD_PLUGIN=<module>`` — see omilo.cloud_plugin.
"""
from __future__ import annotations

from decimal import Decimal

from omilo.cloud_plugin import CloudPlugin


def _plan(pid: str, name: str, idr: int, gb: int, bullets: list[str], badge: str | None = None) -> dict:
    feats = {"max_seats": None, "max_helpers": None, "storage_gb": gb, "seat_price_idr": None, "bullets": bullets}
    if badge:
        feats["badge"] = badge
    return {
        "id": pid, "tier": pid.removeprefix("plan_"), "name": name,
        "monthly_price_usd": Decimal(idr) / 16000, "monthly_price_idr": idr,
        "yearly_price_usd": Decimal(idr * 10) / 16000, "yearly_price_idr": idr * 10,
        "included_credits": 0, "credit_overage_usd": Decimal("0"), "seats": 9999, "features": feats,
    }


PLANS = [
    _plan("plan_starter", "Starter", 100_000, 5, ["5 GB for docs, files and knowledge", "Unlimited people and helpers"]),
    _plan("plan_team", "Team", 300_000, 50, ["50 GB for docs, files and knowledge", "Unlimited people and helpers"],
          badge="Most popular"),
    _plan("plan_business", "Business", 900_000, 250, ["250 GB for docs, files and knowledge", "Unlimited people and helpers"]),
]

PACKS = [
    {"id": "2000", "credits": 2_000, "amount_idr": 100_000, "label": "2,000 credits", "sub": "Example pack", "badge": None},
    {"id": "5000", "credits": 5_000, "amount_idr": 238_000, "label": "5,000 credits", "sub": "Example pack", "badge": None},
    {"id": "20000", "credits": 20_000, "amount_idr": 800_000, "label": "20,000 credits", "sub": "Example pack", "badge": None},
]


def plugin() -> CloudPlugin:
    return CloudPlugin(
        name="example",
        plans=PLANS,
        packs=PACKS,
        trial_plan_id="plan_team",
        idr_per_credit=50,
        plan_aliases={"plan_cloud": "plan_team", "cloud": "plan_team", "starter": "plan_starter",
                      "team": "plan_team", "business": "plan_business"},
        pack_aliases={"small": "2000", "medium": "5000", "large": "20000"},
    )
