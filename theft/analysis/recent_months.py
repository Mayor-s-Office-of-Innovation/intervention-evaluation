import urllib.parse, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__),"..","build"))
from httpget import get_json
DOMAIN,DATASET="data.sfgov.org","wg3w-h783"; RES="Open or Active"
def monthly(where,district=None):
    w=f"({where}) AND resolution='{RES}' AND incident_date >= '2025-11-01'"
    if district: w+=f" AND police_district='{district}'"
    p={"$select":"date_trunc_ym(incident_date) AS m, count(*) AS n","$where":w,"$group":"m","$order":"m"}
    return {r["m"][:7]:int(r["n"]) for r in get_json(f"https://{DOMAIN}/resource/{DATASET}.json?"+urllib.parse.urlencode(p))}
CATS={"shoplifting":"incident_subcategory = 'Larceny Theft - Shoplifting'",
  "commercial":"incident_subcategory in('Burglary - Commercial','Robbery - Commercial')"}
mos=["2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06","2026-07","2026-08"]
for scope,dist in [("CITYWIDE",None),("Northern","Northern")]:
    print(f"=== {scope} reported monthly ===")
    print(f"{'cat':12}"+"".join(f"{m[2:]:>8}" for m in mos))
    for k,w in CATS.items():
        d=monthly(w,dist)
        print(f"{k:12}"+"".join(f"{d.get(m,0):>8}" for m in mos))
    print()
