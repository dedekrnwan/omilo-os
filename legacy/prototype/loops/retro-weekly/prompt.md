# Loop: retro-weekly (meta, Fridays)

Goal: make every loop a little better each week, based on evidence.

1. Read `state/runs/*/run.json` and `report.md` for the last 7 days, and every decided approval in
   `state/approvals/` from the last 7 days, especially **rejections and their notes**.
2. Per loop, compute: runs, failures/timeouts, est. cost, proposals made, approval rate.
3. Find patterns: repeated rejections for the same reason, recurring failures, wasted turns, missing data sources.
4. For each loop that needs it, propose a concrete change to its `loops/<id>/prompt.md` or `loop.json`
   (`type: prompt-change`) as a unified diff, with the evidence that motivates it. At most 3 proposals per week.
5. Executing approved items: apply exactly the approved diff, nothing else.
6. Report a one-line health verdict per loop.
