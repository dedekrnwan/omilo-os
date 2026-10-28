"""Omilo transactional-email layout (pen "Email Templates").

Renders the shared shell — stone canvas, brand header with the mascot mark, one
white card, a focal action (big code block OR primary button), a helper
sign-off, and the footer — as **table-based, inline-styled HTML** so it survives
Gmail/Outlook (which strip <style>, SVG, and most flex/grid).

Design tokens (from the pen):
  canvas #FAFAF9 · card-area #F5F5F4 · card #FFFFFF, radius 12, 1px #E7E5E4
  ink #0C0A09 · body #44403C · muted #78716C · faint #A8A29E · line #E7E5E4
  button #171717, radius 8, 44px · fonts Bricolage→Inter→system, Inter, IBM Plex Mono

Fonts are requested via @import (progressive enhancement) but every element
also carries an inline font stack, so clients without web fonts fall back
cleanly (Bricolage→Inter→system, IBM Plex Mono→monospace).
"""
from __future__ import annotations

from html import escape

# ── font stacks ───────────────────────────────────────────────────────────────
BRAND = "'Bricolage Grotesque', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# ── colours ───────────────────────────────────────────────────────────────────
CANVAS = "#FAFAF9"
CARD_AREA = "#F5F5F4"
CARD = "#FFFFFF"
INK = "#0C0A09"
BODY = "#44403C"
MUTED = "#78716C"
FAINT = "#A8A29E"
LINE = "#E7E5E4"
BTN = "#171717"

_FONTS_IMPORT = (
    "@import url('https://fonts.googleapis.com/css2?"
    "family=Bricolage+Grotesque:wght@400;500;600&"
    "family=Inter:wght@400;500;600&"
    "family=IBM+Plex+Mono:wght@400;500&display=swap');"
)


def _mascot(size: int, accent: str, tint: str) -> str:
    """The Chief-of-Staff mascot (indigo blob + crown) as a tinted rounded tile.

    The inline SVG renders in clients that allow it; where SVG is stripped
    (Gmail) the tinted rounded <div> remains as a branded placeholder.
    """
    r = round(size * 0.28, 1)
    return (
        f'<div style="width:{size}px;height:{size}px;border-radius:{r}px;'
        f'background:{tint};display:inline-block;overflow:hidden;line-height:0">'
        f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" '
        f'xmlns="http://www.w3.org/2000/svg" style="display:block">'
        f'<path d="M10 70c0-36 9-54 22-54 13 0 22 18 22 54z" fill="{accent}"/>'
        f'<path d="M21.4 34a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z m14 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z" fill="#1C1917"/>'
        f'<path d="M25 32.8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z m14 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z" fill="#FFFFFF"/>'
        f'<path d="M27.5 42.5q4.5 4.5 9 0" fill="none" stroke="#1C1917" stroke-width="1.2" stroke-linecap="round"/>'
        f'<path d="M21 19l2.5-10.5 5 5.5 3.5-7 3.5 7 5-5.5 2.5 10.5z" fill="#FACC15" stroke="#1C1917" stroke-width="1"/>'
        f'</svg></div>'
    )


# Chief-of-Staff palette (indigo).
_ACCENT = "#6366F1"
_TINT = "#EEEFFE"


def code_block(code: str) -> str:
    """Focal slot: the big monospace OTP block."""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        '<td align="center" style="padding:4px 0 2px">'
        f'<div style="font-family:{MONO};font-size:30px;font-weight:600;'
        f'letter-spacing:8px;color:{INK};background:{CARD_AREA};border-radius:10px;'
        f'padding:16px 8px 16px 16px;text-align:center">{escape(code)}</div>'
        '</td></tr></table>'
    )


def button(label: str, url: str) -> str:
    """Focal slot: the primary action button."""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td align="center" bgcolor="{BTN}" style="border-radius:8px">'
        f'<a href="{escape(url, quote=True)}" style="display:inline-block;'
        f'padding:13px 22px;font-family:{SANS};font-size:15px;font-weight:600;'
        f'color:#FFFFFF;text-decoration:none;border-radius:8px">{escape(label)}</a>'
        '</td></tr></table>'
    )


def render_email(
    *,
    preheader: str,
    headline: str,
    paragraphs: list[str],
    focal: str = "",
    note: str | None = None,
    company: str | None = None,
    signoff_name: str = "Chief of Staff",
    signoff_role: str = "Your Omilo helper",
) -> str:
    """Render the full HTML document for one transactional email."""
    company_cell = (
        f'<td align="right" style="font-family:{SANS};font-size:12px;color:{MUTED}">'
        f"{escape(company)}</td>"
        if company
        else "<td></td>"
    )

    paras = "".join(
        f'<p style="margin:0 0 16px;font-family:{SANS};font-size:15px;'
        f'line-height:24px;color:{BODY}">{escape(p)}</p>'
        for p in paragraphs
    )

    note_html = (
        f'<p style="margin:16px 0 0;font-family:{SANS};font-size:12.5px;'
        f'line-height:18px;color:{MUTED}">{escape(note)}</p>'
        if note
        else ""
    )

    return f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<style>{_FONTS_IMPORT}
body{{margin:0;padding:0;background:{CANVAS}}}
a{{color:#2563EB}}
</style>
</head>
<body style="margin:0;padding:0;background:{CANVAS}">
<span style="display:none!important;opacity:0;color:{CANVAS};height:0;width:0;overflow:hidden">{escape(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{CANVAS}">
<tr><td align="center" style="padding:32px 16px 48px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%">
  <!-- card area -->
  <tr><td style="background:{CARD_AREA};border-radius:12px;padding:28px 32px 36px">

    <!-- header -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="36" style="vertical-align:middle">{_mascot(28, _ACCENT, _TINT)}</td>
      <td style="vertical-align:middle;font-family:{BRAND};font-size:16px;font-weight:600;letter-spacing:-0.16px;color:{INK};padding-left:8px">Omilo</td>
      {company_cell}
    </tr></table>

    <!-- card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;background:{CARD};border:1px solid {LINE};border-radius:12px">
      <tr><td style="padding:36px 40px 32px">
        <h1 style="margin:0 0 16px;font-family:{BRAND};font-size:28px;font-weight:600;letter-spacing:-0.6px;line-height:33px;color:{INK}">{escape(headline)}</h1>
        {paras}
        {focal}
        {note_html}

        <!-- signoff -->
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr>
          <td style="vertical-align:middle">{_mascot(32, _ACCENT, _TINT)}</td>
          <td style="vertical-align:middle;padding-left:10px">
            <div style="font-family:{SANS};font-size:13px;font-weight:500;color:{INK}">{escape(signoff_name)}</div>
            <div style="font-family:{SANS};font-size:12px;color:{MUTED}">{escape(signoff_role)}</div>
          </td>
        </tr></table>
      </td></tr>
    </table>

    <!-- footer -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="padding:0 4px">
      <p style="margin:0 0 8px;font-family:{SANS};font-size:12px;line-height:18px;color:{MUTED}">
        You're getting this because of your account on Omilo{(" · " + escape(company)) if company else ""}.
      </p>
      <p style="margin:0 0 8px;font-family:{SANS};font-size:12px;color:{BODY}">
        <a href="#" style="color:{BODY};text-decoration:none">Notification settings</a>&nbsp;&nbsp;
        <a href="#" style="color:{BODY};text-decoration:none">Unsubscribe</a>&nbsp;&nbsp;
        <a href="#" style="color:{BODY};text-decoration:none">Open Omilo</a>
      </p>
      <p style="margin:0;font-family:{MONO};font-size:11px;color:{FAINT}">
        Omilo · Saga OS — open source AI staff · Jakarta, Indonesia
      </p>
    </td></tr></table>

  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""
