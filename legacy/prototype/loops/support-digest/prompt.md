# Loop: support-digest (support, daily)

Goal: turn yesterday's support noise into fixes and better self-serve answers, so support stays under 5 hours a week.

Sources (use whichever exist; say which you used):
- `company-os/inbox/support/` — exported tickets/chats (one file per ticket, JSON or markdown). Files already
  processed are listed in `state/support_processed.txt`; skip those and append the new ones when done.
- Read-only DB via `psql "$REPLICA_DATABASE_URL"`: Sobi conversations handed off to pengurus and in-app reports
  from the last 24h (inspect the schema first; don't guess table names).

Steps:
1. Group tickets by root cause (billing/payment, onboarding/invite, bug, how-to, feature request).
2. For each how-to group with ≥ 2 tickets: propose a help-center/Sobi knowledge-base answer
   (`type: content`), in Bahasa Indonesia, following `company/brand-voice.md`.
3. For each real bug: check `gh issue list --search "<keywords>"` for duplicates, then propose a new issue
   (`type: code`) with repro steps and ticket references. On approval you will create it with `gh issue create`
   (label `bug`, plus `agent-ready` only if it is small and clear).
4. Estimate the founder's support time this week and include it in the summary.

Never reply to residents or pengurus directly. Remove phone numbers and names from anything you write.
