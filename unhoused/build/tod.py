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


# ── Granular time-of-day buckets ──────────────────────────────────────────────
# A SEPARATE, finer partition of the 24h day than day/night above — it powers the
# hot/cold map's "Time of day" chips. NOTE the granular 'night' (22:00–05:59) is
# NOT the same as the day/night 'night' (20:00–05:59); they are different
# partitions and must not be conflated. The frontend mirrors this exactly in
# shared/transition-map.js (`TIME_BUCKETS`) — keep the two in sync.
TOD_BUCKETS = {
    "morning":   (6, 7, 8, 9, 10, 11),
    "afternoon": (12, 13, 14, 15, 16, 17),
    "evening":   (18, 19, 20, 21),
    "night":     (22, 23, 0, 1, 2, 3, 4, 5),
}
TOD_BUCKET_NAMES = tuple(TOD_BUCKETS)

_HOUR_TO_TOD = {h: name for name, hours in TOD_BUCKETS.items() for h in hours}


def tod_granular_bucket(hour):
    """Map an hour (0–23, or None) to one of the 4 granular buckets. A null/negative
    hour falls into 'night' (same safety net as `tod_bucket`; 0 nulls verified) so the
    per-bucket arrays still sum to the total."""
    if hour is None:
        return "night"
    return _HOUR_TO_TOD.get(hour, "night")
