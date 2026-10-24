# feat/ui-full SDD ledger
Method: per group → implementer → I verify `bun run build` + Playwright → fresh reviewer (spec+quality+regression) → fix-loop → accept. Verify real session id = sess-passkey (NOT sess-eng-1; renamed in main rebuild).
Wave 1 (Chat): COMPLETE — new chat, archived, create-channel, folder, docs, goals, flows, session (menus/popovers/dialogs/results/browser/goal states). Build green, 87 tests.
Waves 2-7: built via 10 parallel foreground agents + 1 opus integration (commit c1d2e61). Build green, 106 tests + 7 route smoke tests. Visually verified: Team, Control panel, Auth(standalone), Onboarding(standalone), Chief DM(global), Command menu ⌘K(global), Office goals/inbox-states. (Background Workflow tool failed with 403 auth; foreground Agent dispatches used instead.)
