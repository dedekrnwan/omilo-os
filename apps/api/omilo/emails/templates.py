"""Omilo email templates (pen "Email Templates" 01–05, plus the auth mails).

Each ``render_*`` function takes plain data and returns a :class:`RenderedEmail`
(subject, preheader, From name, HTML, plain text and the inline images the HTML
references).  Hand it to :func:`omilo.emails.send` to deliver.

Designed in the pen:
  01 waitlist   — landing · POST /api/waitlist            From: Omilo
  02 welcome    — auth · owner account created            From: Chief of Staff via Omilo
  03 approval   — inbox · proposal · one-tap signed link  From: <Helper> via Omilo
  04 digest     — Monday 08:00 local, once per ISO week   From: Chief of Staff via Omilo
  05 alert      — job_failed · connector auth · critical  From: Omilo alerts

Auth mails (codes, reset, invite) aren't drawn in the pen; they reuse the
Welcome composition — mascot + eyebrow + headline, one focal block, sign-off.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

from omilo.emails.layout import (
    BODY, FAINT, INK, MONO, MUTED, SANS, SOFT, HAIRLINE, Button, Footer, Section, Tone,
    actions, callout, even_row, card, code_block, divided, document, e, eyebrow, font, headline,
    hrow, icon, img, inline_code, lead_with, mascot, mono_block, paragraph, pill,
    signoff, soft_panel, stack, subhead, table, text_link, used_images,
)

HERO_GRADIENT = "linear-gradient(180deg,#E0E7FF 0%,#E0F2FE 55%,#FFFFFF 100%)"


@dataclass
class RenderedEmail:
    subject: str
    preheader: str
    from_name: str
    html: str
    text: str
    images: dict[str, bytes] = field(default_factory=dict)


@dataclass
class Links:
    """Where footer links point; built from ``frontend_base`` by the senders."""
    app: str
    notification_settings: str | None = None
    unsubscribe: str | None = None

    @classmethod
    def for_base(cls, base: str, unsubscribe: str | None = None) -> "Links":
        base = base.rstrip("/")
        return cls(app=base, notification_settings=f"{base}/control-panel/notifications",
                   unsubscribe=unsubscribe or f"{base}/control-panel/notifications")


def _owner_footer(company: str, links: Links) -> Footer:
    out = []
    if links.notification_settings:
        out.append(("Notification settings", links.notification_settings))
    if links.unsubscribe:
        out.append(("Unsubscribe", links.unsubscribe))
    out.append(("Open Omilo", links.app))
    what = company if company.lower().endswith("workspace") else f"the {company} workspace"
    return Footer(f"You're getting this because you own {what} in Omilo.", out)


def _finish(subject: str, preheader: str, from_name: str, card_html: str, footer: Footer,
            text: str, company: str | None = None) -> RenderedEmail:
    html = document(preheader=preheader, card_html=card_html, footer=footer,
                    company=company, title=subject)
    return RenderedEmail(subject, preheader, from_name, html, text.strip() + "\n",
                         used_images(html))


def _hello(helper: str, eyebrow_text: str, title: str, mood: str | None = None) -> str:
    """Mascot 56 + eyebrow + display headline (pen Welcome ``Hello``)."""
    return hrow([
        (mascot(helper, 56, mood), "", 'width="56"'),
        stack([eyebrow(eyebrow_text), headline(title, "display")], gap=2),
    ], gap=16)


def _rows_text(rows: Sequence[tuple[str, str]]) -> str:
    return "\n".join(f"- {k}: {v}" for k, v in rows)


# ── 01 · Waitlist confirmation ───────────────────────────────────────────────

@dataclass
class Step:
    title: str
    desc: str


WAITLIST_STEPS = [
    Step("We read your note", "Tell us what your business does by replying to this email. Two lines is plenty."),
    Step("Your spot opens", "Usually within two weeks. You'll get a sign-in link and a 20-minute setup call."),
    Step("Hire your first two helpers", "Most teams start with Support and Finance. You can let them go any time."),
]

CREW = ["brand", "ops", "dev", "support", "finance", "marketing", "sales"]


def _step(n: int, s: Step) -> str:
    num = (f'<div style="width:24px;height:24px;border:1px solid {"#E7E5E4"};border-radius:999px;'
           f'background:{SOFT};text-align:center;{font(MONO, 12, 500, BODY, 24)}">{n}</div>')
    text = (f'<div style="{font(SANS, 15, 500, INK, 18)}">{e(s.title)}</div>'
            f'<div style="padding-top:2px;{font(SANS, 14, 400, MUTED, 21)}">{e(s.desc)}</div>')
    return hrow([(num, "", 'width="26"'), text], gap=14, valign="top")


def render_waitlist(*, first_name: str, links: Links, how_it_works_url: str | None = None,
                    steps: Sequence[Step] = WAITLIST_STEPS,
                    team_role: str = "Saga OS, Jakarta") -> RenderedEmail:
    subject = "You're on the Omilo waitlist"
    pre = "We'll email you when your spot opens — usually within two weeks."
    intro = (f"Hi {first_name} — thanks for joining. Omilo gives your business a Chief of Staff "
             "and six helpers that take on the work that repeats every week, and check in only "
             "when a decision is yours.")
    crew = hrow([(mascot(h, 40), "", 'width="40"') for h in CREW], gap=6)
    hero = Section(stack([crew, headline("You're on the list.", "serif")], gap=16),
                   padding="36px 40px 28px", bg="#EEF2FF", gradient=HERO_GRADIENT)
    body = Section(stack([
        paragraph(e(intro)),
        eyebrow("What happens next"),
        divided([_step(i + 1, s) for i, s in enumerate(steps)], padding="14px 0", top_rule=True),
        actions([Button("See how it works", how_it_works_url or links.app)], top=4),
        signoff("brand", "The Omilo team", team_role),
    ]), padding="8px 40px 36px")
    footer = Footer("You're getting this because you joined the Omilo waitlist at omilo.app.",
                    [l for l in [("Unsubscribe", links.unsubscribe), ("Open Omilo", links.app)] if l[1]])
    text = f"""{intro}

What happens next
""" + "\n".join(f"{i + 1}. {s.title} — {s.desc}" for i, s in enumerate(steps)) + f"""

See how it works: {how_it_works_url or links.app}

— The Omilo team"""
    return _finish(subject, pre, "Omilo", card([hero, body]), footer, text)


# ── 02 · Welcome ─────────────────────────────────────────────────────────────

@dataclass
class ChecklistItem:
    title: str
    desc: str
    done: bool = False
    time: str | None = None


def _checklist(items: Sequence[ChecklistItem]) -> str:
    rows = []
    for it in items:
        box = (img("checkbox-on", 18) if it.done else
               '<div style="width:16px;height:16px;border:1px solid #A8A29E;border-radius:4px;'
               'background:#FFFFFF"></div>')
        title_color = MUTED if it.done else INK
        text = (f'<div style="{font(SANS, 14, 500, title_color, 17)}">{e(it.title)}</div>'
                f'<div style="padding-top:2px;{font(SANS, 13, 400, MUTED, 16)}">{e(it.desc)}</div>')
        cells = [(box, "", 'width="18"'), text]
        if it.time:
            cells.append((f'<span style="{font(MONO, 11, 400, FAINT, 14)}white-space:nowrap">'
                          f'{e(it.time)}</span>', "", 'align="right" width="48"'))
        rows.append(hrow(cells, gap=12, width="100%"))
    return soft_panel(divided(rows, padding="14px 16px", last_rule=False), padding="0")


def render_welcome(*, first_name: str, company: str, timezone: str, links: Links,
                   hire_url: str | None = None) -> RenderedEmail:
    subject = "Welcome to Omilo — let's hire your first helper"
    pre = "Three steps, about ten minutes. Your Chief of Staff is already here."
    intro = (f"Hi {first_name}, I'm your Chief of Staff. I keep the other helpers on track and "
             "bring you only the decisions that need you. Here's how to get the first week running:")
    items = [
        ChecklistItem("Create your workspace", f"{company} · {timezone}", done=True),
        ChecklistItem("Connect one tool", "Gmail, WhatsApp Business or Google Drive", time="2 min"),
        ChecklistItem("Hire a helper and give it a loop",
                      "e.g. Support answers new tickets every morning", time="5 min"),
    ]
    hire = hire_url or f"{links.app}/team"
    body = Section(stack([
        _hello("brand", "Welcome to Omilo", "Your company is open."),
        paragraph(e(intro)),
        _checklist(items),
        actions([Button("Hire your first helper", hire)], top=4),
        lead_with("Running it yourself? Start the helpers with", inline_code("omilo up")),
        signoff("brand", "Chief of Staff", "Your Omilo helper"),
    ]), padding="40px 40px 36px")
    text = f"""{intro}

[x] Create your workspace — {company} · {timezone}
[ ] Connect one tool — Gmail, WhatsApp Business or Google Drive (2 min)
[ ] Hire a helper and give it a loop — e.g. Support answers new tickets every morning (5 min)

Hire your first helper: {hire}

Running it yourself? Start the helpers with `omilo up`.

— Chief of Staff, your Omilo helper"""
    return _finish(subject, pre, "Chief of Staff via Omilo", card([body]),
                   _owner_footer(company, links), text, company=company)


# ── 03 · Approval needed ─────────────────────────────────────────────────────

@dataclass
class Fact:
    key: str
    value: str
    mono: bool = False


def _facts(facts: Sequence[Fact]) -> str:
    rows = []
    for f in facts:
        fam = MONO if f.mono else SANS
        rows.append(hrow([
            (f'<span style="{font(SANS, 13, 400, MUTED, 17)}">{e(f.key)}</span>', "", 'width="140"'),
            (f'<span style="{font(fam, 14, 500, INK, 17)}">{e(f.value)}</span>', "", 'align="right"'),
        ], gap=12, width="100%"))
    return soft_panel(divided(rows, padding="9px 0", last_rule=False), padding="6px 16px")


def _nothing_sent(counterparty: str | None) -> str:
    return (f"Nothing is sent to {counterparty} until you approve." if counterparty
            else "Nothing happens until you approve.")


def render_approval(*, helper: str, helper_name: str, company: str, kind: str, waiting_since: str,
                    question: str, reasoning: str, facts: Sequence[Fact], approve_url: str,
                    reject_url: str, adjust_url: str, counterparty: str | None, links: Links,
                    expires_hours: int = 72, adjust_lead: str = "Want a different number?",
                    adjust_label: str = "Adjust in Omilo →") -> RenderedEmail:
    subject = f"{helper_name} needs your approval"
    who = hrow([
        (mascot(helper, 40), "", 'width="40"'),
        f'<div style="{font(SANS, 16, 500, INK, 19)}">{e(subject)}</div>'
        f'<div style="padding-top:2px;{font(SANS, 13, 400, MUTED, 16)}">'
        f'{e(kind)} · waiting since {e(waiting_since)}</div>',
        (pill("Needs you", "amber"), "", 'align="right"'),
    ], gap=12, width="100%")
    body = stack([
        headline(question, "title"),
        paragraph(e(reasoning)),
        _facts(facts) if facts else "",
        actions([Button("Approve", approve_url), Button("Reject", reject_url, primary=False)], fill=True),
        hrow([f'<span style="{font(SANS, 13, 400, MUTED, 16)}">{e(adjust_lead)}</span>',
              text_link(adjust_label, adjust_url)], gap=6),
        signoff(helper, helper_name, f"Helper at {company}"),
    ])
    note = hrow([(icon("shield", 16), "", 'width="16"'),
                 f'<div style="{font(SANS, 12, 400, MUTED, 18)}">One-tap buttons are signed for your '
                 f'account and expire in {expires_hours} hours. {e(_nothing_sent(counterparty))}</div>'], gap=10)
    c = card([
        Section(who, padding="28px 32px 20px", rule_below=HAIRLINE),
        Section(body, padding="28px 32px 32px"),
        Section(note, padding="14px 32px", bg=SOFT, rule_above=HAIRLINE),
    ])
    text = f"""{subject} — {kind.lower()}, waiting since {waiting_since}.

{question}

{reasoning}

{_rows_text([(f.key, f.value) for f in facts])}

Approve: {approve_url}
Reject:  {reject_url}
{adjust_lead} {adjust_label.rstrip(" →")}: {adjust_url}

One-tap links are signed for your account and expire in {expires_hours} hours. {_nothing_sent(counterparty)}

— {helper_name}, helper at {company}"""
    return _finish(subject, question, f"{helper_name} via Omilo", c,
                   _owner_footer(company, links), text, company=company)


# ── 04 · Weekly digest ───────────────────────────────────────────────────────

@dataclass
class Stat:
    label: str
    value: str
    delta: str
    tone: Tone = "neutral"


@dataclass
class HelperWeek:
    helper: str
    name: str
    jobs: int
    tokens: str
    cost: str


def _stats(stats: Sequence[Stat]) -> str:
    tiles = []
    for s in stats:
        tiles.append(table(
            f'<tr><td style="border:1px solid {HAIRLINE};border-radius:12px;padding:12px 14px">'
            f'<div style="{font(SANS, 13, 400, MUTED, 16)}">{e(s.label)}</div>'
            f'<div style="{font(MONO, 22, 400, INK, 28)}white-space:nowrap">{e(s.value)}</div>'
            f'<div style="padding-top:2px">{pill(s.delta, s.tone)}</div></td></tr>'))
    return even_row(tiles, gap=8)


def _busiest(rows: Sequence[HelperWeek]) -> str:
    out = []
    for r in rows:
        out.append(hrow([
            (mascot(r.helper, 24), "", 'width="24"'),
            (f'<span style="{font(SANS, 14, 500, INK, 17)}">{e(r.name)}</span>', "", 'width="110"'),
            f'<span style="{font(SANS, 13, 400, MUTED, 16)}">{r.jobs} jobs</span>',
            (f'<span style="{font(MONO, 12, 400, MUTED, 16)}white-space:nowrap">{e(r.tokens)}</span>',
             "", 'align="right"'),
            (f'<span style="{font(MONO, 12, 400, INK, 16)}white-space:nowrap">{e(r.cost)}</span>',
             "", 'align="right" width="90"'),
        ], gap=10, width="100%"))
    return divided(out, padding="10px 0", top_rule=True)


def render_digest(*, company: str, week_label: str, stats: Sequence[Stat], summary: str,
                  busiest: Sequence[HelperWeek], approved: Sequence[str], budget_note: str | None,
                  waiting: int, monitor_url: str, inbox_url: str, links: Links,
                  subject_tail: str, preheader: str) -> RenderedEmail:
    subject = f"Your week in Omilo · {subject_tail}"
    approved_rows = stack([
        hrow([(icon("check", 14), "", 'width="14"'),
              f'<span style="{font(SANS, 14, 400, BODY, 17)}">{e(a)}</span>'], gap=8)
        for a in approved
    ], gap=8)
    body = stack([
        stack([eyebrow(week_label), headline("Your week in Omilo", "display")], gap=6),
        _stats(stats),
        paragraph(e(summary), size=14),
        stack([subhead("Busiest helpers"), _busiest(busiest)], gap=8) if busiest else "",
        stack([subhead("What got approved"), approved_rows], gap=8) if approved else "",
        callout(e(budget_note), "alert-triangle", "amber") if budget_note else "",
        actions([Button("Open Monitor", monitor_url),
                 Button(f"Review {waiting} waiting", inbox_url, primary=False)] if waiting
                else [Button("Open Monitor", monitor_url)]),
        signoff("brand", "Chief of Staff", "Your Omilo helper"),
    ], gap=24)
    text = f"""{week_label} — Your week in Omilo

""" + "\n".join(f"{s.label}: {s.value} ({s.delta})" for s in stats) + f"""

{summary}

Busiest helpers
""" + "\n".join(f"- {r.name}: " + " · ".join(x for x in (f"{r.jobs} jobs", r.tokens, r.cost) if x)
            for r in busiest) + """

What got approved
""" + "\n".join(f"- {a}" for a in approved) + (f"\n\n{budget_note}" if budget_note else "") + f"""

Open Monitor: {monitor_url}
""" + (f"Review {waiting} waiting: {inbox_url}\n" if waiting else "") + """
— Chief of Staff, your Omilo helper"""
    return _finish(subject, preheader, "Chief of Staff via Omilo",
                   card([Section(body, padding="36px 32px 32px")]),
                   _owner_footer(company, links), text, company=company)


# ── 05 · Critical alert ──────────────────────────────────────────────────────

@dataclass
class Impact:
    icon: str
    text: str
    status: str
    tone: Tone


def render_alert(*, company: str, helper: str, helper_name: str, subject: str, preheader: str,
                 headline_text: str, explanation: str, at: str, impacts: Sequence[Impact],
                 primary: Button, secondary: Button | None, details: Sequence[str],
                 signoff_role: str, links: Links) -> RenderedEmail:
    band = hrow([
        (icon("alert-circle", 18), "", 'width="18"'),
        f'<span style="{font(SANS, 13, 600, "#B91C1C", 16)}">Action needed</span>',
        (f'<span style="{font(MONO, 11, 400, "#B91C1C", 14)}white-space:nowrap">{e(at)}</span>',
         "", 'align="right"'),
    ], gap=12, width="100%")
    impact_rows = [
        hrow([(icon(i.icon, 16), "", 'width="16"'),
              f'<span style="{font(SANS, 14, 400, INK, 17)}">{e(i.text)}</span>',
              (pill(i.status, i.tone), "", 'align="right"')], gap=10, width="100%")
        for i in impacts
    ]
    body = stack([
        hrow([(mascot(helper, 56, "worried"), "", 'width="56"'), headline(headline_text, "title")], gap=16),
        paragraph(e(explanation)),
        soft_panel(divided(impact_rows, padding="10px 0", last_rule=False), padding="4px 16px")
        if impacts else "",
        actions([primary] + ([secondary] if secondary else [])),
        stack([eyebrow("Technical details", FAINT, 11, 0.66), mono_block(details)], gap=6)
        if details else "",
        signoff(helper, helper_name, signoff_role),
    ])
    c = card([
        Section(band, padding="16px 32px", bg="#FEF2F2", rule_below="#FECACA"),
        Section(body, padding="32px"),
    ], border="#FECACA")
    text = f"""ACTION NEEDED · {at}

{headline_text}

{explanation}

""" + "\n".join(f"- {i.text} — {i.status}" for i in impacts) + f"""

{primary.label}: {primary.url}
""" + (f"{secondary.label}: {secondary.url}\n" if secondary else "") + """
Technical details
""" + "\n".join(details) + f"""

— {helper_name} ({signoff_role})"""
    return _finish(subject, preheader, "Omilo alerts", c, _owner_footer(company, links), text,
                   company=company)


# ── Auth mails (Welcome composition) ─────────────────────────────────────────

def _auth_footer(reason: str, links: Links) -> Footer:
    return Footer(reason, [("Open Omilo", links.app)])


def _auth(*, subject: str, preheader: str, eyebrow_text: str, title: str, intro: str,
          focal: str, note: str, links: Links, reason: str, text: str,
          company: str | None = None) -> RenderedEmail:
    body = Section(stack([
        _hello("brand", eyebrow_text, title),
        paragraph(e(intro)),
        focal,
        f'<div style="{font(SANS, 13, 400, MUTED, 20)}">{e(note)}</div>',
        signoff("brand", "Chief of Staff", "Your Omilo helper"),
    ]), padding="40px 40px 36px")
    return _finish(subject, preheader, "Chief of Staff via Omilo", card([body]),
                   _auth_footer(reason, links), text, company=company)


def render_verify_email(*, code: str, links: Links) -> RenderedEmail:
    return _auth(
        subject="Confirm your email · Omilo",
        preheader=f"Your code is {code} — expires in 10 minutes.",
        eyebrow_text="Confirm your email", title="Here's your code.",
        intro="Enter this 6-digit code in Omilo to confirm this email address is yours.",
        focal=code_block(code),
        note="Expires in 10 minutes. If you didn't sign up, you can ignore this email.",
        links=links, reason="You're getting this because this address was used to sign up for Omilo.",
        text=f"Confirm your email for Omilo.\n\nYour 6-digit code is: {code}\n\n"
             "It expires in 10 minutes. If you didn't sign up, ignore this email.",
    )


def render_signin_code(*, code: str, links: Links) -> RenderedEmail:
    return _auth(
        subject="Your sign-in code · Omilo",
        preheader=f"Your sign-in code is {code} — expires in 10 minutes.",
        eyebrow_text="Sign in to Omilo", title="Your sign-in code.",
        intro="Use this 6-digit code to sign in to Omilo.",
        focal=code_block(code),
        note="Expires in 10 minutes. If you didn't request it, you can ignore this email.",
        links=links, reason="You're getting this because someone asked to sign in to Omilo with this address.",
        text=f"Your Omilo sign-in code is: {code}\n\n"
             "It expires in 10 minutes. If you didn't request it, ignore this email.",
    )


def render_two_factor_code(*, code: str, links: Links) -> RenderedEmail:
    return _auth(
        subject="Your verification code · Omilo",
        preheader=f"Your verification code is {code} — expires in 10 minutes.",
        eyebrow_text="Two-step verification", title="Finish signing in.",
        intro="Enter this 6-digit code to finish signing in to Omilo.",
        focal=code_block(code),
        note="Expires in 10 minutes. If this wasn't you, change your password.",
        links=links, reason="You're getting this because two-step verification is on for your Omilo account.",
        text=f"Your Omilo two-step verification code is: {code}\n\nIt expires in 10 minutes.",
    )


def render_password_reset(*, link: str, links: Links) -> RenderedEmail:
    return _auth(
        subject="Reset your password · Omilo",
        preheader="Choose a new password — the link works for 30 minutes.",
        eyebrow_text="Password reset", title="Choose a new password.",
        intro="Click the button to choose a new password. The link works for 30 minutes.",
        focal=actions([Button("Set a new password", link)]),
        note="If you didn't request this, ignore this email — your password is unchanged.",
        links=links, reason="You're getting this because a password reset was requested for this address.",
        text=f"Reset your Omilo password.\n\nOpen this link to choose a new one (valid for 30 minutes):\n"
             f"{link}\n\nIf you didn't request this, ignore this email — your password is unchanged.",
    )


def render_invite(*, link: str, company: str, inviter_name: str | None, role: str,
                  links: Links) -> RenderedEmail:
    who = f"{inviter_name} invited you" if inviter_name else "You've been invited"
    return _auth(
        subject=f"Join {company} on Omilo",
        preheader=f"{who} to join {company} as a {role}.",
        eyebrow_text="You're invited", title=f"Join {company}.",
        intro=f"{who} to join {company} on Omilo. You'll come in as a {role}.",
        focal=actions([Button("Accept invite", link)]),
        note="This invite expires in 7 days.",
        links=links, company=company,
        reason=f"You're getting this because {inviter_name or 'someone'} invited this address to {company} on Omilo.",
        text=f"{who} to join {company} on Omilo as a {role}.\n\nAccept your invite (valid for 7 days):\n{link}",
    )
