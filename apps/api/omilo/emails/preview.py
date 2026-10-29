"""Render every email with the pen's sample data to standalone HTML files.

    python -m omilo.emails.preview [out_dir]      # default: <tmp>/omilo-email-preview

Inline ``cid:`` images are swapped for data URIs so the files open in a browser.
"""
from __future__ import annotations

import base64
import sys
import tempfile
from pathlib import Path

from omilo.emails import templates as t
from omilo.emails.layout import Button

LINKS = t.Links.for_base("https://app.omilo.app")


def samples() -> dict[str, t.RenderedEmail]:
    return {
        "01-waitlist": t.render_waitlist(first_name="Rina", links=t.Links(app="https://omilo.app",
                                         unsubscribe="https://omilo.app/unsubscribe")),
        "02-welcome": t.render_welcome(first_name="Rina", company="Sahabat Warga",
                                       timezone="Asia/Jakarta", links=LINKS),
        "03-approval": t.render_approval(
            helper="sales", helper_name="Sales", company="Sahabat Warga", kind="Proposal",
            waiting_since="09:14 WIB", question="Offer Toko Maju 10% to close this week?",
            reasoning=("They've asked twice about bulk pricing and their budget closes Friday. "
                       "A 10% discount keeps us above our 30% margin floor. If you'd rather not, "
                       "I'll follow up Thursday with the standard terms."),
            facts=[t.Fact("Customer", "Toko Maju · Bandung"), t.Fact("Order", "120 × Paket Usaha"),
                   t.Fact("Discount", "10% · Rp 3.600.000", True),
                   t.Fact("Deal value", "Rp 32.400.000", True), t.Fact("Margin after", "31.5%", True)],
            approve_url="https://app.omilo.app/a/approve", reject_url="https://app.omilo.app/a/reject",
            adjust_url="https://app.omilo.app/inbox", counterparty="Toko Maju", links=LINKS),
        "04-digest": t.render_digest(
            company="Sahabat Warga", week_label="Week 42 · 11–17 October",
            stats=[t.Stat("Jobs finished", "128", "+12%", "green"),
                   t.Stat("Waiting on you", "3", "oldest 2d", "amber"),
                   t.Stat("Spent", "Rp 228rb", "−4%", "neutral")],
            summary=("126 of 128 jobs succeeded (98%). You answered decisions in about 14 minutes "
                     "on average — the fastest week yet."),
            busiest=[t.HelperWeek("support", "Support", 54, "412k tok", "Rp 96.200"),
                     t.HelperWeek("finance", "Finance", 31, "268k tok", "Rp 61.500"),
                     t.HelperWeek("marketing", "Marketing", 22, "190k tok", "Rp 44.100")],
            approved=["Sales · 6 of 7 proposals approved · Rp 4.100 per approved item",
                      "Marketing · 4 of 5 posts approved"],
            budget_note=("Support is at 84% of its monthly budget. Most common failure: Zendesk rate "
                         "limit (3×) — spread the morning loop over 30 minutes."),
            waiting=3, monitor_url="https://app.omilo.app/analytics",
            inbox_url="https://app.omilo.app/inbox", links=LINKS,
            subject_tail="128 jobs finished",
            preheader="3 waiting on you · Support was the busiest helper · Rp 228.000 spent"),
        "05-alert": t.render_alert(
            company="Sahabat Warga", helper="support", helper_name="Support",
            subject="Action needed: Gmail disconnected — Support is paused",
            preheader="6 replies are on hold until you reconnect. Takes about a minute.",
            headline_text="Gmail disconnected, so Support is paused.",
            explanation=("Google signed Omilo out of support@sahabatwarga.id this morning, most likely "
                         "after a password change. Support stopped before sending anything, and "
                         "nothing was lost."),
            at="Today · 07:42 WIB",
            impacts=[t.Impact("mail", "6 drafted replies on hold", "Held", "amber"),
                     t.Impact("repeat", "Morning ticket loop skipped", "Skipped", "red"),
                     t.Impact("users", "Other helpers unaffected", "Running", "green")],
            primary=Button("Reconnect Gmail", "https://app.omilo.app/control-panel/connectors"),
            secondary=Button("View run log", "https://app.omilo.app/analytics", primary=False),
            details=["run_8f2a · connector gmail · 07:42:10 WIB",
                     "invalid_grant: Token has been expired or revoked."],
            signoff_role="Paused · waiting on you", links=LINKS),
        "10-verify-email": t.render_verify_email(code="482913", links=LINKS),
        "11-signin-code": t.render_signin_code(code="482913", links=LINKS),
        "12-two-factor": t.render_two_factor_code(code="482913", links=LINKS),
        "13-password-reset": t.render_password_reset(link="https://app.omilo.app/auth/reset-password?token=x",
                                                     links=LINKS),
        "14-invite": t.render_invite(link="https://app.omilo.app/auth/invite?token=x",
                                     company="Sahabat Warga", inviter_name="Rina", role="member",
                                     links=LINKS),
    }


def inline_images(mail: t.RenderedEmail) -> str:
    html = mail.html
    for cid, data in mail.images.items():
        html = html.replace(f"cid:{cid}", "data:image/png;base64," + base64.b64encode(data).decode())
    return html


def main(out: str | None = None) -> None:
    out = out or str(Path(tempfile.gettempdir()) / "omilo-email-preview")
    d = Path(out)
    d.mkdir(parents=True, exist_ok=True)
    for name, mail in samples().items():
        (d / f"{name}.html").write_text(inline_images(mail), encoding="utf-8")
        (d / f"{name}.txt").write_text(f"Subject: {mail.subject}\nFrom: {mail.from_name}\n\n{mail.text}",
                                       encoding="utf-8")
    print(f"wrote {len(samples())} emails to {d}/")


if __name__ == "__main__":
    main(*sys.argv[1:2])
