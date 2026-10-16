"""Previews of the pages helpers visited, for the Browser panel: the page's title, description and image, and a
screenshot taken by a headless browser on this computer when one is available.

Only public http(s) addresses are fetched (never this computer, the local network or cloud metadata), with short
timeouts and a size limit. Results are cached per company for an hour.
"""
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import sys
import time
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from .config import get_settings

TTL = 3600
MAX_HTML = 1_500_000
UA = "Mozilla/5.0 (compatible; SagaOS-preview/0.3; +https://github.com/super-saga/os)"


class PreviewError(Exception):
    pass


def _cache() -> Path:
    d = get_settings().company_dir / "browser-cache"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _key(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:24]


def check_url(url: str) -> str:
    """Refuse anything that is not a public web address."""
    u = urlparse((url or "").strip())
    if u.scheme not in ("http", "https") or not u.hostname:
        raise PreviewError("only http and https pages can be previewed")
    try:
        infos = socket.getaddrinfo(u.hostname, u.port or (443 if u.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except OSError as e:
        if _proxy():  # behind a proxy the name is resolved there
            return u.geturl()
        raise PreviewError(f"cannot find {u.hostname}") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
            raise PreviewError("pages on this computer or the local network are not previewed")
    return u.geturl()


def _proxy() -> str:
    return os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy") or ""


def _meta(html: str, base: str) -> dict:
    def tag(*names: str) -> str:
        for n in names:
            m = re.search(rf'<meta[^>]+(?:property|name)=["\']{re.escape(n)}["\'][^>]*content=["\']([^"\']*)', html, re.I) or \
                re.search(rf'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']{re.escape(n)}["\']', html, re.I)
            if m and m.group(1).strip():
                return unescape(m.group(1).strip())
        return ""
    title = tag("og:title", "twitter:title")
    if not title and (m := re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)):
        title = unescape(re.sub(r"\s+", " ", m.group(1)).strip())
    icon = ""
    if m := re.search(r'<link[^>]+rel=["\'][^"\']*icon[^"\']*["\'][^>]*href=["\']([^"\']+)', html, re.I):
        icon = urljoin(base, unescape(m.group(1)))
    image = tag("og:image", "og:image:url", "twitter:image")
    return {"title": title[:300], "description": tag("og:description", "description", "twitter:description")[:500],
            "image": urljoin(base, image) if image else "", "site": tag("og:site_name")[:120],
            "icon": icon or urljoin(base, "/favicon.ico")}


async def meta(url: str) -> dict:
    url = check_url(url)
    f = _cache() / f"{_key(url)}.json"
    if f.exists() and time.time() - f.stat().st_mtime < TTL:
        return json.loads(f.read_text())
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers={"User-Agent": UA, "Accept": "text/html,*/*"}) as h:
            async with h.stream("GET", url) as r:
                final = str(r.url)
                check_url(final)
                body = b""
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_HTML:
                        break
                ctype = r.headers.get("content-type", "")
                status = r.status_code
    except PreviewError:
        raise
    except Exception as e:  # noqa: BLE001
        raise PreviewError(f"could not open the page: {(str(e) or type(e).__name__)[:160]}") from e
    out = {"url": url, "final_url": final, "status": status, "type": ctype.split(";")[0]}
    if "html" in ctype:
        out.update(_meta(body.decode(errors="replace"), final))
    out["shot"] = shot_available()
    f.write_text(json.dumps(out))
    return out


# ------------------------------------------------------------------ screenshots
def _chrome() -> str | None:
    env = os.environ.get("SAGA_CHROME") or os.environ.get("AGENT_BROWSER_EXECUTABLE_PATH")
    if env and Path(env).exists():
        return env
    for p in ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
              "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"):
        if Path(p).exists():
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"):
        if found := shutil.which(name):
            return found
    roots = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or "", "/opt/pw-browsers",
             str(Path.home() / ("Library/Caches/ms-playwright" if sys.platform == "darwin" else ".cache/ms-playwright"))]
    for root in filter(None, roots):
        rp = Path(root)
        if (rp / "chromium").exists() and (rp / "chromium").is_file():
            return str(rp / "chromium")
        for pattern in ("chromium-*/chrome-linux*/chrome", "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
                        "chromium-*/chrome-mac*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chromium-*/chrome-win/chrome.exe"):
            for hit in sorted(rp.glob(pattern), reverse=True) if rp.exists() else []:
                return str(hit)
    return None


def shot_available() -> bool:
    return _chrome() is not None


_sem = asyncio.Semaphore(2)


async def screenshot(url: str, fresh: bool = False) -> Path:
    """A PNG of the page as a 1280×800 browser sees it (headless Chrome on this computer)."""
    url = check_url(url)
    out = _cache() / f"{_key(url)}.png"
    if not fresh and out.exists() and time.time() - out.stat().st_mtime < TTL:
        return out
    chrome = _chrome()
    if not chrome:
        raise PreviewError("no Chrome or Chromium on this computer for screenshots")
    tmp = out.with_suffix(".tmp.png")
    args = [chrome, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
            "--mute-audio", "--window-size=1280,800", "--virtual-time-budget=6000", f"--user-data-dir={_cache() / 'profile'}",
            f"--screenshot={tmp}", url]
    if _proxy():
        args.insert(1, f"--proxy-server={_proxy()}")
    if os.geteuid() == 0 if hasattr(os, "geteuid") else False:
        args.insert(1, "--no-sandbox")
    async with _sem:
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        try:
            await asyncio.wait_for(proc.wait(), timeout=25)
        except TimeoutError:
            proc.kill()
            raise PreviewError("the page took too long to load") from None
    if not tmp.exists() or tmp.stat().st_size < 200:
        raise PreviewError("the browser could not take a screenshot of this page")
    tmp.replace(out)
    return out
