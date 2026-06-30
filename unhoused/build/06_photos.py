"""Stage 6 — fetch and cache 311 photo URLs from the live API.

Pulls the last 24h of reports from the CloudFront cache, extracts photo URLs,
and merges them into a persistent cache. Run daily (or on each build) to
accumulate photo coverage over time.

The cache is keyed by a location+date composite since we don't have service_request_id
in the marker data. Format: {lat_lng_date: {id, photos, address, category}}
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "..", "data", "photos", "photo_cache.json")
API_URL = "https://d2rrrzgumh0cu9.cloudfront.net/map-cache/sf/reports-24h.json"


def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, separators=(",", ":"))


def fetch_reports():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "intervention-evaluation"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def make_key(lat, lng, date):
    """Create a location+date key for matching markers to photos."""
    # Round to ~110m precision (same as hotspot cells)
    lat_r = round(float(lat), 3)
    lng_r = round(float(lng), 3)
    return f"{lat_r}_{lng_r}_{date}"


def update_cache():
    cache = load_cache()
    initial_count = len(cache)

    print(f"Fetching reports from {API_URL}...")
    reports = fetch_reports()
    print(f"  Got {len(reports)} reports")

    new_photos = 0
    for report in reports:
        photos = report.get("photos", [])
        if not photos:
            continue

        lat = report.get("lat")
        lng = report.get("long")
        date = report.get("requested_date")  # YYYY-MM-DD

        if not all([lat, lng, date]):
            continue

        key = make_key(lat, lng, date)
        if key not in cache:
            new_photos += 1

        cache[key] = {
            "id": report.get("service_request_id"),
            "photos": photos,
            "address": report.get("address", ""),
            "category": report.get("category", ""),
            "description": report.get("description", ""),
        }

    save_cache(cache)
    print(f"  Cache: {initial_count} -> {len(cache)} reports (+{new_photos} new with photos)")
    print(f"  Saved to {os.path.relpath(CACHE_FILE, HERE)}")
    return cache


if __name__ == "__main__":
    update_cache()
