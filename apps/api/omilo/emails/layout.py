"""Omilo email layout parts — built from the pen "Email Templates" board.

600px single column, stone canvas, one white card, one primary action, and the
helper who wrote the mail signs it.  Everything is **table-based and inline
styled** so it survives Gmail and Outlook, which strip ``<style>``, SVG and
most flex/grid.  Mascots and icons are PNGs (exported from the pen at 3x)
referenced as ``cid:`` images and attached inline by the mailer, so they show
up without remote-image loading or a public asset host.

Each part returns an HTML string; templates compose them with :func:`stack`
and :func:`card`, and :func:`document` wraps the result in the shared shell.

Pen tokens:
  canvas #F5F5F4 · card #FFFFFF, radius 12, 1px #E7E5E4 · soft #FAFAF9
  ink #0C0A09 · body #44403C · muted #78716C · faint #A8A29E
  hairline #E7E5E4A6 (≈ #EDEBEA on white) · button #171717, radius 8, 44px
  Inter → system sans · Bricolage → Inter · Fraunces → Georgia · IBM Plex Mono
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from html import escape
from pathlib import Path
from typing import Literal, Sequence

# ── fonts ─────────────────────────────────────────────────────────────────────
SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
BRAND = "'Bricolage Grotesque', " + SANS
SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

# ── colours ───────────────────────────────────────────────────────────────────
CANVAS = "#F5F5F4"
CARD = "#FFFFFF"
SOFT = "#FAFAF9"
INK = "#0C0A09"
INK_WARM = "#1C1917"
BODY = "#44403C"
MUTED = "#78716C"
FAINT = "#A8A29E"
LINE = "#E7E5E4"
# The pen's hairline is #E7E5E4 at 65% — flattened so Outlook (no alpha) agrees.
HAIRLINE = "#EDECEB"
BTN = "#171717"
LINK = "#2563EB"

Tone = Literal["amber", "red", "green", "neutral"]
_TONES: dict[str, tuple[str, str, str]] = {  # bg, border, ink
    "amber": ("#FFFBEB", "#FDE68A", "#B45309"),
    "red": ("#FEF2F2", "#FECACA", "#B91C1C"),
    "green": ("#F0FDF4", "#BBF7D0", "#15803D"),
    "neutral": (SOFT, LINE, BODY),
}

ASSETS = Path(__file__).parent / "assets"
_CID_RE = re.compile(r"cid:([a-z0-9-]+)@omilo")

_FONTS_IMPORT = (
    "@import url('https://fonts.googleapis.com/css2?"
    "family=Bricolage+Grotesque:opsz,wght@12..96,500..600&family=Fraunces:wght@500&"
    "family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');"
)

# ── primitives ────────────────────────────────────────────────────────────────

_T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'


def e(s: object) -> str:
    return escape(str(s), quote=True)


def font(family: str, size: float, weight: int = 400, color: str = INK,
         line: float | None = None, spacing: float = 0) -> str:
    """Inline font declaration; ``line`` defaults to the pen's 'normal'."""
    if line is None:
        line = round(size * (1.3 if family is MONO else 1.22))
    ls = f"letter-spacing:{spacing}px;" if spacing else ""
    return (f"font-family:{family};font-size:{size}px;font-weight:{weight};"
            f"line-height:{line}px;color:{color};{ls}")


def table(rows: str, width: str | None = "100%", style: str = "") -> str:
    w = f' width="{width}"' if width else ""
    st = f' style="{style}"' if style else ""
    return f"<table {_T}{w}{st}>{rows}</table>"


def hrow(cells: Sequence[str | tuple], gap: int = 0, valign: str = "middle",
         width: str | None = None) -> str:
    """A horizontal row.  Each cell is HTML, or ``(html, td_style[, td_attrs])``."""
    tds = []
    for i, c in enumerate(cells):
        html, style, attrs = (c, "", "") if isinstance(c, str) else (tuple(c) + ("", ""))[:3]
        pad = f"padding-left:{gap}px;" if i and gap else ""
        a = f" {attrs}" if attrs else ""
        tds.append(f'<td valign="{valign}"{a} style="{pad}{style}">{html}</td>')
    return table(f"<tr>{''.join(tds)}</tr>", width=width)


def even_row(cells: Sequence[str], gap: int = 8, valign: str = "top") -> str:
    """Equal-width columns with ``gap`` between them (split as half-gaps so every
    column gets the same width)."""
    n = len(cells)
    pct = f"{100 / max(n, 1):.4g}%"
    h = gap / 2
    tds = "".join(
        f'<td valign="{valign}" width="{pct}" style="padding-left:{0 if i == 0 else h}px;'
        f'padding-right:{0 if i == n - 1 else h}px">{c}</td>'
        for i, c in enumerate(cells)
    )
    return table(f"<tr>{tds}</tr>", style="table-layout:fixed")


def stack(blocks: Sequence[str], gap: int = 20) -> str:
    """Vertical stack with a fixed gap (the pen's auto-layout ``gap``)."""
    blocks = [b for b in blocks if b]
    rows = "".join(
        f'<tr><td style="{"padding-top:%dpx;" % gap if i else ""}">{b}</td></tr>'
        for i, b in enumerate(blocks)
    )
    return table(rows)


def img(name: str, size: int, alt: str = "", radius: float = 0) -> str:
    """An inline (cid:) PNG from ``assets/``."""
    r = f"border-radius:{radius}px;" if radius else ""
    return (f'<img src="cid:{name}@omilo" width="{size}" height="{size}" alt="{e(alt)}" '
            f'style="display:block;width:{size}px;height:{size}px;border:0;outline:none;{r}">')


def mascot(helper: str, size: int, mood: str | None = None) -> str:
    """A helper mascot tile (pen ``Helper/*``): brand, ops, dev, support, finance,
    marketing, sales.  ``mood='worried'`` exists for support (alerts)."""
    name = f"mascot-{helper}-{mood}" if mood else f"mascot-{helper}"
    if not (ASSETS / f"{name}.png").exists():
        name = f"mascot-{helper}" if (ASSETS / f"mascot-{helper}.png").exists() else "mascot-brand"
    return img(name, size)


def icon(name: str, size: int = 16) -> str:
    return img(f"icon-{name}", size)


# ── text ──────────────────────────────────────────────────────────────────────

def paragraph(text: str, size: int = 15, color: str = BODY) -> str:
    line = 24 if size >= 15 else 22
    return f'<p style="margin:0;{font(SANS, size, 400, color, line)}">{text}</p>'


def eyebrow(text: str, color: str = MUTED, size: int = 12, spacing: float = 0.72) -> str:
    return (f'<div style="{font(MONO, size, 500, color, spacing=spacing)}'
            f'text-transform:uppercase">{e(text)}</div>')


HeadlineKind = Literal["display", "title", "serif"]


def headline(text: str, kind: HeadlineKind = "display") -> str:
    """display = Bricolage 32 · title = Bricolage 26 · serif = Fraunces 34."""
    if kind == "serif":
        st = font(SERIF, 34, 500, INK_WARM, 39, -0.68)
    elif kind == "title":
        st = font(BRAND, 26, 500, INK, 31, -0.52)
    else:
        st = font(BRAND, 32, 500, INK, 37, -0.8)
    return f'<h1 style="margin:0;{st}">{e(text)}</h1>'


def subhead(text: str) -> str:
    return f'<div style="{font(SANS, 14, 600, INK)}">{e(text)}</div>'


def inline_code(text: str) -> str:
    return (f'<span style="{font(MONO, 12, 400, INK, 16)}background:{SOFT};'
            f'border:1px solid {HAIRLINE};border-radius:4px;padding:1px 4px;'
            f'white-space:nowrap">{e(text)}</span>')


def text_link(label: str, url: str) -> str:
    return (f'<a href="{e(url)}" style="{font(SANS, 13, 500, LINK)}'
            f'text-decoration:none">{e(label)}</a>')


def lead_with(lead: str, trailing: str) -> str:
    """'Running it yourself? Start the helpers with `omilo up`' style line."""
    return (f'<div style="{font(SANS, 13, 400, MUTED, 20)}">{e(lead)}&nbsp;{trailing}</div>')


# ── controls ──────────────────────────────────────────────────────────────────

@dataclass
class Button:
    label: str
    url: str
    primary: bool = True


def _button_cell(b: Button, full: bool) -> str:
    w = "width:100%;" if full else ""
    if b.primary:
        return (f'<table {_T} style="{w}"><tr><td align="center" bgcolor="{BTN}" '
                f'style="border-radius:8px;background:{BTN}">'
                f'<a href="{e(b.url)}" style="display:block;padding:12px 22px;'
                f'{font(SANS, 15, 600, "#FFFFFF", 20)}text-decoration:none;'
                f'border-radius:8px;text-align:center">{e(b.label)}</a></td></tr></table>')
    return (f'<table {_T} style="{w}"><tr><td align="center" bgcolor="#FFFFFF" '
            f'style="border-radius:8px;background:#FFFFFF;border:1px solid {LINE}">'
            f'<a href="{e(b.url)}" style="display:block;padding:11px 21px;'
            f'{font(SANS, 15, 500, INK, 20)}text-decoration:none;'
            f'border-radius:8px;text-align:center">{e(b.label)}</a></td></tr></table>')


def actions(buttons: Sequence[Button], fill: bool = False, top: int = 0) -> str:
    """A row of buttons, 8px apart.  ``fill`` splits the row evenly (Approve/Reject)."""
    if not buttons:
        return ""
    if fill:
        html = even_row([_button_cell(b, True) for b in buttons], gap=8)
    else:
        html = hrow([_button_cell(b, False) for b in buttons], gap=8)
    return f'<div style="padding-top:{top}px">{html}</div>' if top else html


def pill(label: str, tone: Tone = "amber") -> str:
    bg, border, ink = _TONES[tone]
    return (f'<span style="display:inline-block;background:{bg};border:1px solid {border};'
            f'border-radius:6px;padding:2px 7px;{font(SANS, 12, 500, ink, 16)}'
            f'white-space:nowrap">{e(label)}</span>')


def signoff(helper: str, name: str, role: str, mood: str | None = None) -> str:
    """The helper who wrote the mail signs it (pen ``Email/Signoff``)."""
    return '<div style="padding-top:4px">' + hrow([
        mascot(helper, 32, mood),
        f'<div style="{font(SANS, 13, 500, INK, 16)}">{e(name)}</div>'
        f'<div style="{font(SANS, 12, 400, MUTED, 15)}">{e(role)}</div>',
    ], gap=10) + "</div>"


# ── containers ────────────────────────────────────────────────────────────────

def soft_panel(inner: str, padding: str = "0 16px", radius: int = 12,
               bg: str = SOFT, border: str = HAIRLINE) -> str:
    return table(
        f'<tr><td style="background:{bg};border:1px solid {border};'
        f'border-radius:{radius}px;padding:{padding}">{inner}</td></tr>'
    )


def divided(rows: Sequence[str], padding: str = "10px 0", top_rule: bool = False,
            last_rule: bool = True) -> str:
    """Rows separated by hairlines (pen lists: steps, busiest helpers, facts)."""
    out = []
    for i, r in enumerate(rows):
        last = i == len(rows) - 1
        rule = "" if (last and not last_rule) else f"border-bottom:1px solid {HAIRLINE};"
        top = f"border-top:1px solid {HAIRLINE};" if (i == 0 and top_rule) else ""
        out.append(f'<tr><td style="padding:{padding};{top}{rule}">{r}</td></tr>')
    return table("".join(out))


def code_block(code: str) -> str:
    """Focal OTP block: big monospace digits on the soft panel."""
    return soft_panel(
        f'<div style="{font(MONO, 30, 600, INK, 36, 8)}text-align:center">{e(code)}</div>',
        padding="18px 8px 18px 16px",
    )


def mono_block(lines: Sequence[str]) -> str:
    body = "<br>".join(e(x) for x in lines)
    return soft_panel(f'<div style="{font(MONO, 11.5, 400, INK, 19)}word-break:break-all">{body}</div>',
                      padding="12px")


def callout(text: str, icon_name: str | None = None, tone: Tone = "amber") -> str:
    bg, border, _ink = _TONES[tone]
    body = f'<div style="{font(SANS, 13, 400, INK, 19)}">{text}</div>'
    inner = hrow([(icon(icon_name, 16), "padding-top:1px", 'width="16"'), body], gap=10, valign="top") \
        if icon_name else body
    return soft_panel(inner, padding="12px 14px", bg=bg, border=border)


@dataclass
class Section:
    """One band of the card (hero, who, body, alert band, security note…)."""
    html: str
    padding: str = "40px 40px 36px"
    bg: str | None = None
    gradient: str | None = None
    rule_below: str | None = None  # colour of a 1px rule under the band
    rule_above: str | None = None


def card(sections: Sequence[Section], border: str = LINE) -> str:
    rows = []
    n = len(sections)
    for i, s in enumerate(sections):
        radius = ""
        if s.bg or s.gradient:
            tl = "11px" if i == 0 else "0"
            bl = "11px" if i == n - 1 else "0"
            radius = f"border-radius:{tl} {tl} {bl} {bl};"
        bg = f"background-color:{s.bg};" if s.bg else ""
        attr = f' bgcolor="{s.bg}"' if s.bg else ""
        if s.gradient:
            bg += f"background-image:{s.gradient};"
        rule = f"border-bottom:1px solid {s.rule_below};" if s.rule_below else ""
        if s.rule_above:
            rule += f"border-top:1px solid {s.rule_above};"
        rows.append(f'<tr><td class="px"{attr} style="padding:{s.padding};{bg}{rule}{radius}">{s.html}</td></tr>')
    return table("".join(rows), style=(
        f"background:{CARD};border:1px solid {border};border-radius:12px;"
        "border-collapse:separate"))


# ── shell ─────────────────────────────────────────────────────────────────────

@dataclass
class Footer:
    reason: str
    links: list[tuple[str, str]] = field(default_factory=list)


def _header(company: str | None) -> str:
    right = (f'<td align="right" valign="middle" style="{font(SANS, 12, 400, MUTED, 15)}">'
             f'{e(company)}</td>') if company else "<td></td>"
    return table(
        f'<tr><td width="28" valign="middle">{img("mark", 28, "Omilo")}</td>'
        f'<td valign="middle" style="padding-left:10px;{font(BRAND, 16, 600, INK, 20, -0.16)}">Omilo</td>'
        f"{right}</tr>",
        style="margin:0",
    )


def _footer(f: Footer) -> str:
    links = "&nbsp;&nbsp;&nbsp;".join(
        f'<a href="{e(u)}" style="color:{BODY};text-decoration:none">{e(label)}</a>'
        for label, u in f.links
    )
    return stack([
        f'<div style="{font(SANS, 12, 400, MUTED, 18)}">{e(f.reason)}</div>',
        f'<div style="{font(SANS, 12, 400, BODY, 15)}">{links}</div>' if links else "",
        f'<div style="{font(MONO, 11, 400, FAINT, 14)}">'
        "Omilo · Saga OS — open source AI staff · Jakarta, Indonesia</div>",
    ], gap=8)


def document(*, preheader: str, card_html: str, footer: Footer, company: str | None = None,
             title: str = "Omilo") -> str:
    """Wrap a card in the shared shell: header, card, footer on the stone canvas."""
    # Pad the preheader so clients don't pull body copy into the inbox preview.
    pad = "&#847;&zwnj;&nbsp;" * 40
    return f"""\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{e(title)}</title>
<style>{_FONTS_IMPORT}
body{{margin:0;padding:0;background:{CANVAS};-webkit-text-size-adjust:100%}}
img{{-ms-interpolation-mode:bicubic}}
@media (max-width:620px){{
  .outer{{padding:20px 12px 32px!important}}
  .px{{padding-left:24px!important;padding-right:24px!important}}
}}
</style>
</head>
<body style="margin:0;padding:0;background:{CANVAS}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:{CANVAS}">{e(preheader)}{pad}</div>
<table {_T} width="100%" bgcolor="{CANVAS}" style="background:{CANVAS}">
<tr><td class="outer" align="center" style="padding:32px 40px 40px">
<table {_T} width="600" style="width:600px;max-width:100%">
<tr><td style="padding:0 4px 20px">{_header(company)}</td></tr>
<tr><td>{card_html}</td></tr>
<tr><td style="padding:24px 4px 0">{_footer(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def used_images(html: str) -> dict[str, bytes]:
    """Every ``cid:<name>@omilo`` the HTML references → the PNG bytes to attach."""
    out: dict[str, bytes] = {}
    for name in dict.fromkeys(_CID_RE.findall(html)):
        out[f"{name}@omilo"] = (ASSETS / f"{name}.png").read_bytes()
    return out
