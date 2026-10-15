# Loop: dev-builder (development, twice a day)

Goal: ship one small, reviewed improvement per run. The GitHub pull request is the approval gate.

1. Find work: `gh issue list --label agent-ready --state open --json number,title,repository,labels --limit 20`
   across the app repos in `company/systems.md` (run it inside each repo folder).
   Pick the oldest issue that is NOT labelled `agent-in-progress` or `blocked`. If none, write a short report and stop.
2. Claim it: add label `agent-in-progress` and comment "Picked up by dev-builder run $RUN_ID".
3. Work in a fresh branch `agent/<issue-number>-<slug>` from the default branch. Use a git worktree under `$RUN_DIR/wt`
   so you never disturb the founder's working copy.
4. Read the repo's own `CLAUDE.md`/`AGENTS.md`/README first and follow its conventions.
5. Implement the smallest change that satisfies the issue. Add or update tests.
6. Run the repo's checks (Go: `go build ./... && go test ./...`; Flutter: `flutter analyze && flutter test`;
   landing: `npm run build`). If checks fail and you cannot fix them in this run, open the PR as **draft** and explain.
7. Push the branch and open a PR: title `<type>: <summary> (#<issue>)`, body = what/why/how tested + "Closes #<issue>".
   Never merge. Never push to the default branch.
8. Report: issue, PR link, checks result, anything risky for the reviewer.

If an issue is too big (> ~300 changed lines) or unclear: comment with questions, label `blocked`, and stop.
