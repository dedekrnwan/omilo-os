"""omilo.scheduler.cadence — routine cadence maths shared by the API and the tick.

Everything that turns a routine's (freq, at, days, monthly, timezone) into
concrete fire times lives here so the write API, the scheduler tick, the
schedule/preview endpoints and the Chief suggestions all agree.

Conventions
-----------
- ``freq``    : "daily" | "weekdays" | "weekly" | "monthly" (case-insensitive;
                the UI historically sent "Weekly"/"Weekdays" — normalised here).
- ``days``    : 0=Mon … 6=Sun (weekly only).
- ``monthly`` : "date" (the 1st) | "last_working_day" ("last-working-day" accepted).
- Times are wall-clock in the routine's IANA ``timezone``; results are UTC.
"""
from __future__ import annotations

import zoneinfo
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

from croniter import croniter

FREQS = ("daily", "weekdays", "weekly", "monthly")

# Fixed-date Indonesian national holidays (month, day). Moveable feasts (Eid,
# Nyepi, Vesak, Chinese New Year, …) need a lunar calendar we don't ship yet;
# see the sweep report. Good enough for "Skip public holidays" on fixed dates.
_FIXED_HOLIDAYS_ID: set[tuple[int, int]] = {
    (1, 1),    # New Year's Day
    (5, 1),    # Labour Day
    (6, 1),    # Pancasila Day
    (8, 17),   # Independence Day
    (12, 25),  # Christmas Day
}


def normalize_freq(freq: str | None) -> str:
    f = (freq or "daily").strip().lower().replace(" ", "")
    if f in ("everyday", "day"):
        return "daily"
    if f in ("weekday",):
        return "weekdays"
    return f if f in FREQS else "daily"


def normalize_monthly(monthly: str | None) -> str | None:
    if monthly is None:
        return None
    m = monthly.strip().lower().replace("-", "_")
    return "last_working_day" if m == "last_working_day" else "date"


def build_cron(freq: str, at: str, days: list[int] | None, monthly: str | None) -> str:
    """5-field cron for the cadence (filters like last-working-day are applied
    on top by :func:`iter_fires`)."""
    h, m = at.split(":")
    h, m = str(int(h)), str(int(m))
    freq = normalize_freq(freq)
    if freq == "weekdays":
        return f"{m} {h} * * 1-5"
    if freq == "weekly":
        cron_days = sorted({(int(d) % 7) + 1 for d in (days or [0])})
        # croniter: 1=Mon … 7=Sun
        return f"{m} {h} * * {','.join(str(d) for d in cron_days)}"
    if freq == "monthly":
        if normalize_monthly(monthly) == "last_working_day":
            # Candidates: the last 7 days of any month; filtered to the last
            # weekday (that isn't a holiday) by iter_fires.
            return f"{m} {h} 22-31 * *"
        return f"{m} {h} 1 * *"
    return f"{m} {h} * * *"


def is_holiday(d: date) -> bool:
    return (d.month, d.day) in _FIXED_HOLIDAYS_ID


def _is_working_day(d: date) -> bool:
    return d.weekday() < 5 and not is_holiday(d)


def last_working_day(year: int, month: int) -> date:
    nxt = date(year + (month // 12), (month % 12) + 1, 1)
    d = nxt - timedelta(days=1)
    while not _is_working_day(d):
        d -= timedelta(days=1)
    return d


def _tz(name: str | None) -> zoneinfo.ZoneInfo:
    try:
        return zoneinfo.ZoneInfo(name or "UTC")
    except (zoneinfo.ZoneInfoNotFoundError, KeyError, ValueError):
        return zoneinfo.ZoneInfo("UTC")


def _field(r: Any, name: str, default: Any = None) -> Any:
    if isinstance(r, dict):
        return r.get(name, default)
    return getattr(r, name, default)


def iter_fires(
    r: Any,
    start: datetime,
    end: datetime,
    *,
    include_holidays: bool = False,
    limit: int = 500,
) -> list[datetime]:
    """All fire times of routine-like ``r`` with ``start < t <= end`` (UTC).

    ``r`` may be an ORM Routine or a dict with freq/at/days/monthly/timezone
    (+ optional skip_holidays). Holidays are dropped when the routine skips
    them unless ``include_holidays`` (the tick needs them to record skips).
    """
    freq = normalize_freq(_field(r, "freq"))
    at = _field(r, "at") or "09:00"
    days = _field(r, "days") or []
    monthly = normalize_monthly(_field(r, "monthly"))
    skip_holidays = bool(_field(r, "skip_holidays", False))
    tz = _tz(_field(r, "timezone"))
    cron = build_cron(freq, at, days, monthly)

    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)

    cit = croniter(cron, start.astimezone(tz).replace(tzinfo=None))
    out: list[datetime] = []
    guard = 0
    while len(out) < limit and guard < limit * 40:
        guard += 1
        naive = cit.get_next(datetime)
        aware = naive.replace(tzinfo=tz).astimezone(timezone.utc)
        if aware > end:
            break
        local_d = naive.date()
        if freq == "monthly" and monthly == "last_working_day":
            if local_d != last_working_day(local_d.year, local_d.month):
                continue
        if skip_holidays and not include_holidays and is_holiday(local_d):
            continue
        out.append(aware)
    return out


def next_fire(r: Any, after: datetime | None = None) -> datetime | None:
    """First fire time strictly after ``after`` (default: now)."""
    after = after or datetime.now(timezone.utc)
    # A year is enough for every supported cadence (monthly = 12 candidates).
    fires = iter_fires(r, after, after + timedelta(days=400), limit=1)
    return fires[0] if fires else None


def minutes_of(at: str) -> int:
    h, m = at.split(":")
    return int(h) * 60 + int(m)


def at_of(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def local_weekdays(r: Any) -> set[int]:
    """Weekdays (0=Mon) on which the routine can fire (approximation for monthly)."""
    freq = normalize_freq(_field(r, "freq"))
    if freq == "weekdays":
        return {0, 1, 2, 3, 4}
    if freq == "weekly":
        return {int(d) % 7 for d in (_field(r, "days") or [0])}
    if freq == "monthly":
        return set()
    return set(range(7))


def describe(r: Any) -> str:
    """Short human cadence label, e.g. "Weekdays · 07:30", "Mon & Thu · 09:00"."""
    freq = normalize_freq(_field(r, "freq"))
    at = _field(r, "at") or "09:00"
    if freq == "daily":
        return f"Every day · {at}"
    if freq == "weekdays":
        return f"Weekdays · {at}"
    if freq == "monthly":
        if normalize_monthly(_field(r, "monthly")) == "last_working_day":
            return f"Last working day · {at}"
        return f"Monthly · {at}"
    names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    days = sorted({int(d) % 7 for d in (_field(r, "days") or [0])})
    plural = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"]
    if len(days) == 1:
        return f"{plural[days[0]]} · {at}"
    return f"{' & '.join(names[d] for d in days)} · {at}"


def iter_days(start: date, end: date) -> Iterable[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)
