# Omilo v2 — Full UI (all screens, per mode)

**Branch:** feat/ui-full (from main). **Reference:** omilo-v2.pen (via pencil MCP). Each screen is built to match its exported PNG reference. Many entries are interactive *states* of a base screen, not separate routes.

Legend: [x] done · [ ] todo. IDs are pen.dev node ids (export PNG for reference).

## WAVE 1 — CHAT mode
- [x] gTI4y New chat (General)
- [ ] PHRy6 Archived chats
- [ ] W0f1Ji Create channel (dialog)
- [ ] A8lWSN Folder
- [x] k1bhz Docs (Engineering, in chat)
- [x] b3vqC5 Session (base)
- [ ] Session states on base: qx8jA @mention · DKIFQ /command · ON7HK #context · eqdjl Model menu · HoEHX Thinking menu · C9Glat Context menu · gHFPG Context almost full · GNF2E Compacted · P334a Share · ERnYB Chat menu · n9NI9G Tasks created
- [ ] SP6gy Session + Results · Zdjc7 Dropping files · CnBzj Output preview
- [ ] E5554m Session + Browser · ocar6 Browser you-took-over
- [ ] AQW5x Session from Office (Goal) · E8dtI Edit goal · aUAIu Add agent
- [x] SdvDS Chat · Goals (Engineering)
- [x] v8l9N6 Chat · Flows + Mspam Suggested · vwC5x Templates · VgVEV Runs

## WAVE 2 — OFFICE mode
- [x] hR0PJ Inbox (base)
- [ ] PuFIB Inbox · Review one by one · U6qpL8 Approved · mw1zT Change amount
- [ ] qDPJo Office · Goals · DlkiJ New goal
- [ ] Cv9lg Flows New flow · ck4Kt Canvas · emtFw Canvas test result · SgKgq Draft from Suggested · GMEPK Runs

## WAVE 3 — GLOBAL core
- [ ] iUTk2 Notifications
- [ ] Command menu ⌘K: d0lBaO Hint · RGVME Open · JdRi5 Typing · aNecq Ask Chief fallback · dcWIN Action step
- [ ] Chief DM: ozMOv Closed · pHj0k Nudge · nkqAN Open · N30qNb Full screen · hM9k9 Threads

## WAVE 4 — TEAM
- [ ] XaOds Team · jEooC Hire·Pick · hkw1l Hire·Set up · JYwEe Roles & models
- [ ] Helper (Support) tabs: XB1kX Job · vDIEL PLAYBOOK.md · dcvvQ Model menu · wwL68 Channels · GwcDV Telegram · pyuhG WhatsApp · WruOn Email · e4QAdg Tools · C5M5HG Behavior · dXeCS Skills · uvNJ3 Browse skills · JVnGn Profile · HX7PZ Let go
- [ ] Agent jobs: ZOLDU Chief · mM9lI Builder · TVKhl Grower · koZok Sales · w6dUO3 Finance

## WAVE 5 — CONTROL PANEL (gear)
- [ ] Sections (each container has nested Screens): soG6Y Workspace · RRq49 AI · cS3C9 Tools · FNVlM Data · EovsC You · STGRk Global

## WAVE 6 — AUTH + ONBOARDING
- [ ] Auth: YBOIE Sign in · S517J Google-not-allowed · eAlcQ Sign up · GuMJL Confirm email · OsWDG Create company · eWPwo Choose plan · rK2oH Payment · CXuxX All set · frQuc Forgot pw · g4ord Reset sent · gweHj Set new pw · WUakJ Pw updated · GMMNj Reset expired · A4bMp Check email · cewrH 2-step · Ltj2k Choose company · kIAtu Accept invite
- [ ] Onboarding: VYHu4 1 Welcome · InMeZ 2 AI Self-host · CbbZR 2 AI Cloud · sG2L3 3 Get to know you · M1ZiO 4 Check · V7szb 5 Your team · FZ9LR 6 Team ready

## WAVE 7 — DOCS
- [ ] Notes pxBeD · Graph Czmj0 · Knowledge off ZDuRA / on eU7Fc / answer WZycb / drop files TBJls / reading cUtde / add sources o3rK0g / added igY8b · Ask Chief n8N6dT typing / j5pVM answer · Handbook Jrggy / N4uuSY POLICIES.md

## Method
Per screen-group: export PNG ref(s) from .pen → build on the existing src/ui/ds design system → verify vs PNG via Playwright screenshot → commit. Reuse DS components; add routes under the correct mode. Build sub-states as interactive states/variants of the base screen, not duplicate routes. Keep build + tests green each commit.
