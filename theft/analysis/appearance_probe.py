import urllib.parse, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__),"..","build"))
from httpget import get_json
DOMAIN,DATASET="data.sfgov.org","wg3w-h783"
def q(select,where,order=None,limit=200):
    p={"$select":select,"$where":where,"$limit":str(limit)}
    if order:p["$order"]=order
    return get_json(f"https://{DOMAIN}/resource/{DATASET}.json?"+urllib.parse.urlencode(p))
print("=== recent rows: incident_date, report_datetime, :created_at, :updated_at ===")
try:
    rows=q(":id, incident_date, report_datetime, :created_at, :updated_at",
           "incident_date>='2026-06-01'", order="report_datetime DESC", limit=15)
    for r in rows:
        print(f"  inc={r.get('incident_date','')[:10]} rpt={r.get('report_datetime','')[:16]} "
              f"created={str(r.get(':created_at',''))[:19]} updated={str(r.get(':updated_at',''))[:19]}")
except Exception as e:
    print("  :created_at query failed ->", repr(e))
print("\n=== distinct :created_at day-counts (incident 2026-05+) ===")
try:
    rows=q("date_trunc_ymd(:created_at) AS d, count(*) AS n","incident_date>='2026-05-01'",order="d")
    for r in rows[-25:]:
        print(f"  {str(r.get('d',''))[:10]}  n={r['n']}")
except Exception as e:
    print("  failed ->", repr(e))
