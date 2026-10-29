"""Tiny standalone HTML pages for links opened from email (one-tap, unsubscribe).

Same look as the mail: stone canvas, one white card, one primary action.
"""
from __future__ import annotations

from html import escape

from fastapi.responses import HTMLResponse

from omilo.emails.layout import BRAND, BTN, BODY, CANVAS, INK, LINE, MUTED, SANS


def page(title: str, message: str, *, action_url: str | None = None, action_label: str | None = None,
         post_to: str | None = None, post_label: str | None = None, secondary: tuple[str, str] | None = None,
         status_code: int = 200) -> HTMLResponse:
    btn = (f"display:inline-block;border:0;border-radius:8px;background:{BTN};color:#fff;"
           f"font:600 15px/20px {SANS};padding:12px 22px;text-decoration:none;cursor:pointer")
    btn2 = (f"display:inline-block;border:1px solid {LINE};border-radius:8px;background:#fff;color:{INK};"
            f"font:500 15px/20px {SANS};padding:11px 21px;text-decoration:none;margin-left:8px")
    actions = ""
    if post_to:
        actions += (f'<form method="post" action="{escape(post_to)}" style="display:inline">'
                    f'<button type="submit" style="{btn}">{escape(post_label or "Confirm")}</button></form>')
    elif action_url:
        actions += f'<a href="{escape(action_url)}" style="{btn}">{escape(action_label or "Open Omilo")}</a>'
    if secondary:
        actions += f'<a href="{escape(secondary[1])}" style="{btn2}">{escape(secondary[0])}</a>'
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{escape(title)} · Omilo</title></head>
<body style="margin:0;background:{CANVAS};font-family:{SANS}">
<main style="max-width:520px;margin:12vh auto;padding:0 16px">
<div style="font:600 16px {BRAND};color:{INK};padding:0 4px 20px">Omilo</div>
<div style="background:#fff;border:1px solid {LINE};border-radius:12px;padding:36px 32px">
<h1 style="margin:0 0 12px;font:500 26px/31px {BRAND};letter-spacing:-.5px;color:{INK}">{escape(title)}</h1>
<p style="margin:0 0 24px;font:400 15px/24px {SANS};color:{BODY}">{escape(message)}</p>
{actions}</div>
<p style="margin:16px 4px;font:400 12px/18px {SANS};color:{MUTED}">Omilo · Saga OS — open source AI staff</p>
</main></body></html>"""
    return HTMLResponse(html, status_code=status_code)
