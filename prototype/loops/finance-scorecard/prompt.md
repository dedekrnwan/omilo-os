# Loop: finance-scorecard (business, Mondays)

Goal: one honest view of how the company is doing against `company/goals.md`, plus 3 actions.

1. Query the read-only replica: `psql "$REPLICA_DATABASE_URL"`. Inspect the schema first (`\dt`, `\d <table>`);
   never guess column meanings. Compute for the last full week:
   - MRR (Rp): active paid subscriptions (B2C + B2B), monthly-equivalent.
   - Paying communities, total communities, active residents (logged in or paid in the last 30 days).
   - Digital dues share: dues paid via QRIS/VA ÷ all dues recorded.
   - Monthly churn: paying communities lost ÷ paying communities at start of month.
   - Support hours: take from the latest support-digest report in `state/runs/` if present.
   - Loop cost: sum `cost_usd` from `state/runs/*/run.json` for the week.
   If a number cannot be computed, use `null` and explain why. Never estimate silently.
2. Write `state/kpis.json`:
   `{"updated_at": "<ISO>", "week": "<YYYY-Www>", "mrr_idr": n, "paying_communities": n, "communities": n,
     "active_residents": n, "digital_share": 0.0-1.0, "churn_monthly": 0.0-1.0, "support_hours": n, "loop_cost_usd": n}`
3. Add a row to the table in `company/scorecard.md` and replace "Latest memo" with:
   where we are vs. the current goal phase, the biggest risk, and exactly **3 actions for this week**.
4. Propose (`type: finance`) anything that needs a decision (e.g. a pricing test, chasing an overdue B2B invoice).
