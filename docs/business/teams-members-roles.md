# Teams, Members & Roles

> Track: **business**. How humans join a Company, what each role can and can't do, how a
> person is scoped to specific areas, and how one person works across several companies. This
> is the *behavior* doc; the tables and enforcement live in
> [`../technical/07-multitenancy-auth.md`](../technical/07-multitenancy-auth.md) and
> [`../technical/01-data-model.md`](../technical/01-data-model.md). Money and seats are in
> [`subscription-plans.md`](subscription-plans.md).

---

## 1. The one distinction that matters: people vs AI

omilo has two kinds of "staff," and they are *never* the same entity:

- **Members are people.** A Member is a human login (a `User`) attached to one Company with a
  role. Members sign in, set goals, approve the AI's proposals, pay the bill, invite other
  people. They occupy **seats** (the thing the Plan sells).
- **Helpers are the AI staff.** A Helper (`hlp_…`) is an AI worker — the **Chief** leads the
  **Helpers** who actually do the work. Helpers do *not* occupy seats, do *not* have logins,
  and are not in the Members table. They are created by the operator (or proposed by the
  Chief), run on the company's AI engine, and bill **credits**, not seats.

> Rule of thumb: if it can be fired by HR, it's a **Member**. If it can be paused in the AI
> engine, it's a **Helper**. The Members & roles screen (Control-Panel → *Members & roles*)
> lists only humans. Helpers live on the AI/Office side.

The operator (a human Member) sets **Goals**; the **Chief** (an AI Helper, `is_chief = true`,
exactly one per company) leads the other Helpers to pursue them. So "who can manage the team"
below always means *the human's authority over the AI team*, never one human over another.

---

## 2. Membership: User ↔ Company

- A **User** is a global identity — one email, one password (or Google SSO), reused everywhere.
  Users are **not** tenant-scoped.
- A **Member** is the join row: `(company_id, user_id, role, channel_scope, status)`, unique per
  `(company_id, user_id)`. The same User can hold Member rows in many Companies, each with a
  different role and scope.
- `status` on a Member is `active | invited | suspended`:
  - **invited** — an `Invite` was sent; the row becomes `active` on accept.
  - **active** — can sign in and act within role + scope.
  - **suspended** — login works but the company is read-only / access withheld; the seat is
    still consumed until the Member is removed.

Authorization at every request is the **AND** of three gates (see `07` §4):

```
allowed  =  role permits the capability
        AND channel_scope includes the target area/channel
        AND RLS confirms the row is in this company
```

No single gate is trusted alone. A Member can't reach another company's data even by guessing
IDs — RLS makes isolation a database guarantee, not app discipline.

---

## 3. The three roles

`MemberRole = owner | admin | member` (from
[`01` §2](../technical/01-data-model.md)). Roles are **cumulative**: `owner ⊇ admin ⊇ member`.

### Plain-language summary

| Role | Who it's for | Headline authority |
|---|---|---|
| **member** | Everyday operators in one or two areas | Use the product, set goals, approve the AI's work **in their own channels**. Can't reconfigure the company or the AI team. |
| **admin** | Team leads / ops managers | Everything a member does, **plus** manage the AI team (Helpers, routines, flows, connectors), members & roles, safety limits, and the AI engine. Cannot touch billing or delete the company. |
| **owner** | Founder / account holder | Everything, **plus** billing, plan changes, data export/delete, and deleting the company. The buck stops here. |

### Capability matrix (the authoritative view)

This mirrors `07` §4 exactly; the business framing is in the right column.

| Capability | member | admin | owner | Why it lands where it does |
|---|---|---|---|---|
| Use chat; set Goals; approve proposals **in own channels** | ✓ | ✓ | ✓ | The core operator loop. Scoped by `channel_scope`. |
| Manage **Helpers** (hire/pause/edit the AI staff) | – | ✓ | ✓ | Changing the AI team is a team-management act, not daily use. |
| Manage **Routines & Flows** (standing automations) | – | ✓ | ✓ | These run unattended and spend credits; needs a lead's judgment. |
| Manage **Connectors** (Gmail, Slack, WhatsApp, CRM, payments…) | – | ✓ | ✓ | Grants the AI reach into outside systems → admin+. |
| **Members & roles** (invite, change role, scope, suspend) | – | ✓ | ✓ | Admins run the team; only owner touches *owner* seats (see §3.1). |
| **Safety & limits** (SafetyLimit caps, autonomy defaults) | – | ✓ | ✓ | Guardrails on the AI; admin-level control surface. |
| **AI engine / AI accounts** (which model, which pool) | – | ✓ | ✓ | Infra for the whole team; not a per-user setting. |
| **Billing, plan change, overage policy** | – | – | ✓ | Real money leaves the company here. Owner only. |
| **Delete company; export/delete all data** | – | – | ✓ | Irreversible, company-wide. Owner only. |

### 3.1 Guardrails on role changes

- Only **owners** can grant or revoke the **owner** role. An admin can manage member↔admin but
  cannot create another owner or demote an owner.
- A company must always have **at least one owner**. The last owner cannot be demoted or
  removed — the UI blocks it. Transferring ownership is "promote the new owner, then step down."
- Destructive member actions (suspend, remove, demote-last-admin) confirm through a
  ConfirmDialog with the **sad Mascot** — never a bare icon — consistent with the platform's
  negative-action pattern.
- Role changes are written to `AuditEvent` (`actor: user:…`, `action: member.role_changed`),
  visible in Control-Panel → Activity log.

---

## 4. `channel_scope` — restricting a Member to specific areas

A **Channel** is an **Area** (Engineering, Marketing, Sales, General, …). `channel_scope` on
the Member row is either `all` or a list of channel ids. It narrows *where* a role applies
without changing the role itself.

- A **member** scoped to `["Engineering","General"]` can set goals and approve proposals in
  those two areas only. Marketing goals, Marketing Helpers' proposals, Marketing analytics — all
  invisible/forbidden, even though the role "member" would otherwise allow the action in
  principle.
- Scope is enforced **in addition to** role: an admin scoped to Marketing still can't approve
  an Engineering proposal, because scope gates the *target channel* of every action.
- Scope does **not** relax a role. A scoped member is not "admin for their channel" — they're a
  member who simply can't see the rest.

This is the "Engineering, General" / "Marketing, General" text shown in the Members table (see
`PEOPLE` in `control-panel/data.ts`). Scope also shapes the sidebar: a scoped Member sees only
their areas across Goals, Flows, Docs, Analytics, and Routines boards.

> **Why scope matters for AI:** a Helper's proposals land in the Inbox of the channel it serves.
> If a Member can't see that channel, they can't approve that Helper's consequential work — so
> scope is also how you decide *who signs off on which AI actions*.

---

## 5. Inviting Members (the Invite flow)

The flow, as behavior:

1. An **admin or owner** opens Control-Panel → *Members & roles* → **Invite**.
2. They enter an **email**, pick a **role** (`member`/`admin`; only owner may pick `owner`), and
   optionally set **channel_scope** (default `all`).
3. The server checks **seat availability** against the Plan (see §7). If the Company is at its
   seat limit, the invite is blocked with an upgrade prompt — the owner must add seats / change
   plan first.
4. An `Invite` row is created `{email, role, token_hash, expires_at}` and an email goes out. A
   `Member` row may be pre-created with `status = invited` (shown greyed in the table).
5. The invitee clicks the link:
   - **No omilo account** → sign-up (password or Google SSO), creating a `User`, then the
     Member row flips to `active`.
   - **Existing User** → the link just adds/activates the Member row for this Company; they can
     switch into it immediately (see §6).
6. `Invite.accepted_at` is stamped; `token_hash` is single-use and expires. Pending invites can
   be **revoked** (delete the `Invite` + the `invited` Member row) or **resent**.

Constraints and edges:

- **Google domain sign-in**: a Company may restrict sign-in to an allowlisted email domain. An
  invite to an off-domain address hits the `google-not-allowed` screen; the admin must add the
  domain or invite a matching address. (Domain allowlist is a Growth/Business-tier feature — see
  [`subscription-plans.md`](subscription-plans.md).)
- **Re-invite of an existing Member**: no duplicate row (unique `(company_id, user_id)`); the
  UI offers "already a member" instead.
- Every invite/accept/revoke is audited.

---

## 6. Multi-company membership & switching

Because a **User** is global and **Member** rows are per-company, one person can belong to many
Companies at once — e.g. an agency operator who runs five client workspaces, or a contractor
who is `admin` in one company and `member` (scoped) in another.

How it behaves:

- At sign-in the session picks an **active company** (last-used, or the only one). The JWT
  carries `cmp = company_id` and the `role` **for that company**.
- **Switching** companies (`POST /v1/companies/{id}/switch`, or `X-Company-Id` per request) is
  allowed **iff** the User has a Member row there. Switching re-issues context: new
  `company_id` for RLS, new `role`, new `channel_scope`. Nothing from the old company leaks —
  the switch is a hard tenant boundary.
- Each company shows its **own** Helpers, Goals, Inbox, usage, and bill. The same human can be
  an owner paying the bill in Company A and a scoped member who can't even see billing in
  Company B — role is per-membership, not per-person.
- Removing a person from one Company (delete their Member row) never touches their `User` or
  their membership elsewhere.

---

## 7. Seats tie-in to the Plan

- **Seats** = the max number of **active human Members** the Plan allows. Helpers never count.
- `Plan.seats` is the cap (e.g. free = 1, Team/Growth = 5, Business/Scale = 25 — *illustrative,
  to be set by the business*). The onboarding plan cards show this as "1 seat / 5 seats / 25
  seats."
- Inviting or activating a Member that would exceed `Plan.seats` is blocked until the owner adds
  seats or upgrades. The seat/plan change takes effect in omilo immediately; if a payment
  provider is wired it also prorates the charge (otherwise it's reconciled offline). See
  [`subscription-plans.md`](subscription-plans.md) and `08` §6.
- **Suspended** Members still consume a seat (their access is withheld, not released). To free a
  seat, **remove** the Member.
- Self-host editions don't meter seats for payment; seat limits (if any) are license terms,
  not a live gate. See `07` §6.

---

## 8. Onboarding a new Company

A Company is born in the onboarding wizard (`src/features/auth/*` → `/auth/onboarding/*`). As
behavior, the founder:

1. **Signs up** → creates the `User` (first human).
2. **Creates the company** (`CreateCompanyPage`, `/auth/onboarding/company`): name, **industry**,
   **team size**, **region** (defaults timezone + currency), **currency**, and the founder's
   **role** (`pic_role`). These seed the company handbook + the Chief's context so Helpers tailor
   to this business and this person; `currency`+`region`+`timezone` set the locale for money/dates.
   A `Company` row is created and the founder becomes its **owner** automatically (the first Member).
3. **Connects the AI** (onboarding "Your AI" step, `onboarding/data.ts` → `AI_MODES`): choose
   **self-host** (BYO sign-in / subscription / API key, no credits) or **cloud** (omilo
   credits). This sets `Company.edition` and the default AI engine. Billing hinges on this —
   see [`subscription-plans.md`](subscription-plans.md).
4. **Chooses a plan** (`ChoosePlanPage`, cloud only) and **optionally pays** (`PaymentPage`):
   picks a tier and starts a trial; the subscription is activated in omilo immediately. The
   payment step only appears when a payment provider is configured — otherwise billing is
   offline/manual. Self-host skips payment entirely. See [`08` §6](../technical/08-billing-ai-credits.md).
5. **Talks about the business** → the Chief interviews the founder and writes the company
   handbook (Company, Customers, Goals, Offer, Rules, Systems, Voice).
6. **Meets the team** → the Chief proposes a starting roster of **Helpers** (Builder, Grower,
   Support, Finance…) tuned to the stated goals; the founder toggles them on/off. These are AI
   Helpers, not seats.
7. **Approves first jobs** → the first Inbox fills with proposed routines (morning brief, weekly
   growth review, WhatsApp drafts…), each showing its credit cost.
8. **Invites teammates** (optional, from the getting-started checklist) → the Invite flow in §5,
   which immediately enforces the chosen Plan's seat cap.

From here the founder can create *additional* companies later (each its own tenant, its own
plan) and switch between them per §6.

---

## 9. Worked example — Sahabat Warga's four people

Taken from `PEOPLE` in `control-panel/data.ts`. One Company, four human Members, a mix of roles
and scopes:

| Person | Role | channel_scope | What they can actually do |
|---|---|---|---|
| **Dede Kurniawan** (`dede@`) | **Owner** | All channels | Everything: sets company-wide goals, manages Helpers/routines/flows/connectors, members & roles, safety, the AI engine — **and** billing, plan changes, overage policy, data export, deleting the company. The only person who sees the invoice. |
| **Rina Ayu** (`rina@`) | **Admin** | All channels | Runs the AI team company-wide: hires/pauses Helpers, edits routines & flows, connects WhatsApp/CRM/email, invites members and sets their roles (but can't mint an owner), tunes safety limits and the AI engine. **Cannot** see or change billing, and can't delete the company. |
| **Bayu Pratama** (`bayu@`) | **Member** | Operations, General | Works the Operations + General areas: sets Goals there, approves the Helpers' proposals in those channels, chats. **Cannot** see Marketing goals or approve the Grower's campaigns, can't manage Helpers or connectors, can't touch billing. |
| **Sari Nur** (`sari@`) | **Member** | Marketing, General | Mirror image of Bayu on the Marketing side: owns Marketing + General goals and approves the Grower/Support Helpers' consequential actions there. Engineering is invisible to her. No team-management or billing powers. |

Reading the example:

- **Bayu and Sari have the same role** (`member`) but **different reach** because of
  `channel_scope`. Role sets the *verbs*; scope sets the *nouns*. A Builder proposal to deploy
  lands in Bayu's Inbox, not Sari's.
- **Rina (admin) can reorganize the AI team** — hire a Finance Helper, add a Stripe connector,
  write a new routine — but the moment she opens *Usage & billing* to change the plan, she's
  blocked: that's **owner-only**. She'd ask Dede.
- **Dede (owner)** is the single human who can turn overage from soft to hard, add seats to
  invite a fifth teammate, or export/delete everything.
- If Dede later spins up a **second company** for another product, he's its owner too — but his
  membership here is untouched, and switching between them re-scopes everything (RLS, role,
  channels) at the boundary (§6).

---

## See also

- [`subscription-plans.md`](subscription-plans.md) — seats, plan tiers, credits, overage, the
  owner-only billing surface.
- [`../technical/07-multitenancy-auth.md`](../technical/07-multitenancy-auth.md) — roles table,
  RLS, auth, channel_scope enforcement, self-host edition.
- [`../technical/08-billing-ai-credits.md`](../technical/08-billing-ai-credits.md) — how seats +
  credits are billed (provider-independent; optional `PaymentProvider`).
- [`../technical/01-data-model.md`](../technical/01-data-model.md) — `User`, `Member`, `Invite`,
  `Company`, `Channel`, `Helper`.
- [`../integrations/README.md`](../integrations/README.md) — connectors admins grant to the AI
  team, and the ELv2 cloud/self-host edition split.

> **Illustrative values.** Any concrete seat counts, tier names, or plan labels in this doc are
> *illustrative placeholders, to be set by the business.*
