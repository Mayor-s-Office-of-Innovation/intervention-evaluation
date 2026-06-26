"""Day/Night cutoff — the single build-side source of truth (plan-time-of-day.md §2).

DAY  = 06:00–19:59   (DAY_START <= hour < NIGHT_START)
NIGHT = 20:00–05:59  (everything else)

The frontend mirrors this in shared/transition-map.js (`todBucket`). Verified against the data
(2026-06): every signal is fully time-stamped (0 null hours), so day + night == total exactly — no
"unknown" bucket. A null/negative hour, if one ever appears, falls into 'night' and is still caught
by the build's `day + night == total` assertion.

The server-side arrest signals (no raw rows locally) reproduce this split in SoQL with
`CASE WHEN date_extract_hh(<dt>) >= 6 AND date_extract_hh(<dt>) < 20 THEN 'day' ELSE 'night' END` —
keep that expression in sync with DAY_START / NIGHT_START below (see `tod_case_sql`).
"""

DAY_START = 6      # 06:00 inclusive
NIGHT_START = 20   # 20:00 inclusive

BUCKETS = ("day", "night")


def tod_bucket(hour):
    """Map an hour (0–23, or None) to 'day' / 'night'."""
    if hour is None:
        return "night"  # never happens in practice (0 nulls verified); safety net for the assertion
    return "day" if DAY_START <= hour < NIGHT_START else "night"


def tod_case_sql(date_col):
    """SoQL CASE expression bucketing `date_col`'s hour into 'day'/'night' (server-side signals)."""
    hh = f"date_extract_hh({date_col})"
    return f"(CASE WHEN {hh} >= {DAY_START} AND {hh} < {NIGHT_START} THEN 'day' ELSE 'night' END)"
