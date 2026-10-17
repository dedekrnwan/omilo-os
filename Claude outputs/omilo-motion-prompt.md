# Omilo product video: prompt for Claude Motion

Paste everything below the line into a new Motion artifact. Attach these files with it so the visuals match the product:
`saga-os/apps/web/app/globals.css`, `saga-os/apps/web/components/Avatar.tsx`, `saga-os/apps/web/public/saga.svg`, and 3–4 screenshots (Inbox board, Monitor › Office, Team, Workspace).

---

Make a 60-second product video for **Omilo**, an open source platform that gives a growing business a team of AI helpers. Each helper owns a recurring job, works on a schedule, reports back and proposes the next step. The owner approves before anything important happens. Omilo is free to self-host; the team also offers onboarding, support and a managed cloud.

**Audience:** owners of small and growing businesses, not developers. Keep every line plain and short.
**Format:** 16:9, 1920×1080, 30 fps, about 60 seconds. On-screen text only, no voiceover. Leave room for a soft music bed.
**Tone:** calm, confident, a little playful through the mascots. Never hype.

## Visual system (match the real app exactly)
- Background stone-100 `#f5f5f4`; panels white `#ffffff` with 1px borders `#e7e5e4`; quiet panels `#fafaf9`.
- Text `#0c0a09`, secondary `#44403c`, muted `#78716c`. Primary buttons are near-black `#171717` with white text.
- Status chips (small, 6px radius, tinted fill + matching border): green ok `#15803d` on `#f0fdf4`, amber waiting `#b45309` on `#fffbeb`, blue running `#1d4ed8` on `#eff6ff`, red `#b91c1c` on `#fef2f2`.
- Corners 8–12px on cards, 16–18px on the app window. Very soft shadows only.
- Type: Bricolage Grotesque (500–600, tight tracking) for headlines; Inter for UI; IBM Plex Mono for numbers and times.
- No gradients, no neon, no glassmorphism, no stock 3D.

**The app frame** (reuse it in most scenes): a left sidebar on stone background and a white inset workspace on the right. Sidebar from top: the Omilo mascot mark + "Omilo"; a company switcher showing "Kopi Senja"; then grouped menu items with small line icons and uppercase grey group labels:
- WORK: Inbox (black count badge "1"), Workspace, Plan, Docs, Monitor
- COMPANY: Team, Hire, Company, Settings
- CAPABILITIES: Harness, Connectors, Skills, Computer
- CONTROL: Pause all helpers
The active item has a light grey pill. The workspace has a top bar with the page icon and title.

**The helpers are mascots.** Draw them exactly like the attached Avatar.tsx: a rounded "blob", "box" or "bean" body in one color, two dark eyes with white highlights, a small smile, faint white cheeks, on a rounded tile tinted with the same color. Each wears a prop for its job:
- Chief of Staff: indigo `#6366f1` blob, gold crown
- Ops: sky `#0ea5e9` box, gear
- Support: pink `#ec4899` bean, headset
- Finance: green `#65a30d` box, gold coin
- Marketing: orange `#f97316` blob, megaphone
- Sales: violet `#8b5cf6` bean, red tie
- Dev: teal `#14b8a6` blob, round glasses

The brand mark is the indigo blob with a small amber four-point spark on top. Mascots blink now and then, their eyes follow the action, and they do a small hop when they finish something. This is the one place for personality; keep the UI itself still and precise.

## Motion language
Ease-out entrances of 250–400ms. Cards slide up 12px while fading in, and a staggered list moves 60ms per row. The camera moves only as slow pushes or pans across the app frame, with no spins or zoom blasts. A cursor (simple black arrow) clicks buttons with a small press. Status changes happen in place: the chip color and text cross-fade.

## Scenes
1. **0–5s · The problem.** Stone background. One by one, small task cards pile up around a single person icon: "Reply to customers", "Post on Instagram", "Check orders", "Weekly numbers", "Follow up leads". Headline: **"You're running everything yourself."**
2. **5–10s · Meet the team.** The cards fly into a row of seven mascot tiles that pop in left to right, each with its name under it. Headline: **"Meet your AI staff."** Small line: "Each helper owns one job that repeats."
3. **10–18s · The schedule.** A clean table slides in: helper mascot + name, "Runs" in mono, job, and an outcome chip. Rows: Ops · Hourly · "Checks site, orders, payments" · *Alert if off*; Support · Daily 06:30 · "Groups yesterday's messages" · *Themes + draft replies*; Finance · Mon 07:00 · "Updates revenue and runway" · *KPI scorecard*; Marketing · Mon 08:00 · "Plans posts from real questions" · *Content proposals*; Sales · Tue · Thu 09:00 · "Drafts follow-ups" · *Drafts, never sent*. A small clock ticks; rows light up as their time passes. Headline: **"They work on a schedule."**
4. **18–30s · The Inbox (hero moment).** The full app frame with Inbox active. Three columns with small headers: **Needs you · Running · Done**. A card moves from Running to Needs you: Marketing mascot, "Publish 3 posts about the new delivery area", amber chip "Waiting". It expands to show the reason in a grey box: *Why: "do you deliver to my area?" was the top customer question this week (from Support).* Buttons: **Approve** (black), **Reject with note**, **Adjust with AI**. The cursor clicks Approve, a green note appears ("Approved. Marketing drafts the posts on its next run."), and the card slides to Done while the Marketing mascot hops. Headline over the frame: **"They propose. You decide."**
5. **30–38s · Watch them work.** Switch to Monitor, then the "Office" toggle: a top-down pixel-style office with rooms labelled Leadership, Marketing, Sales, Support, Engineering & Ops, Finance. Mascots sit at desks; a "Live" pill at top left; a legend at the bottom (Working, Waiting on you, Failed, Up next, Idle, Paused). Ops walks a short path to Dev with a dotted "working together" line. Headline: **"See every helper, live."**
6. **38–46s · Guardrails.** Two side-by-side cards. Left, on a quiet panel, "Never without you" with red ✕ chips: Send anything to customers · Spend money · Publish or deploy · Change your production data. Right, "Always on" with green ✓ chips: Locked permissions and budgets · Audit log of every action · Social posting set to "Ask me first". Then the sidebar's "Pause all helpers" is clicked: every mascot greys out and a "Paused" chip appears. Headline: **"Nothing important happens without your yes."**
7. **46–54s · Open source, with help when you want it.** Three plan cards rise in: **Self-host it** (Open source chip: "Free on your own server"); **Onboarding & support** (black Consulting chip, slightly raised: "We set up helpers that fit your business"); **Managed by us** (Cloud chip: "We host, update and back it up"). Headline: **"Open source at the core. Help when you want it."**
8. **54–60s · Close.** Stone background. The Chief of Staff mascot hops once in the center, then the Omilo mark and wordmark. A serif line (Fraunces, 500): **"Hire your first AI staff."** Under it a black pill button "Join the waitlist" and the small line "omilo · open source". Hold for 2 seconds.

## Data and honesty rules
- The business shown is **Kopi Senja**, a fictional coffee shop. Never show real customer names, email addresses, file paths, account IDs or "Sahabat Warga".
- Don't show revenue numbers, user counts, ratings or testimonials. Schedules, chips and UI labels are fine.
- Use the menu names and page names exactly as listed above.
- English on screen. Keep each headline under 8 words and on screen for at least 2.5 seconds.

**Optional Indonesian version** (same timing; swap the headlines):
1 "Semua masih Anda kerjakan sendiri." · 2 "Kenalan dengan staf AI Anda." · 3 "Mereka bekerja sesuai jadwal." · 4 "Mereka mengusulkan. Anda memutuskan." · 5 "Lihat setiap helper, secara langsung." · 6 "Tidak ada hal penting tanpa persetujuan Anda." · 7 "Inti open source. Bantuan saat Anda butuh." · 8 "Rekrut staf AI pertama Anda." / button "Gabung waitlist".
