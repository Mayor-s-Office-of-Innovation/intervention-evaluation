import urllib.parse, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__),"..","build"))
from httpget import get_json
DOMAIN,DATASET="data.sfgov.org","wg3w-h783"
def q(where,select,group=None,order=None):
    p={"$select":select,"$where":where,"$limit":"50000"}
    if group:p["$group"]=group
    if order:p["$order"]=order
    return get_json(f"https://{DOMAIN}/resource/{DATASET}.json?"+urllib.parse.urlencode(p))
# Is filed_online populated at all? distinct values + counts, 2021+
print("=== filed_online distribution by subcategory (2021+) ===")
rows=q("incident_subcategory in('Larceny Theft - Shoplifting','Burglary - Commercial','Robbery - Commercial') AND incident_date>='2021-01-01'",
       "incident_subcategory AS sub, filed_online, count(*) AS n","incident_subcategory, filed_online","incident_subcategory, filed_online")
for r in rows:
    print(f"  {r.get('sub',''):28} filed_online={str(r.get('filed_online','(null)')):8} n={r['n']}")
# Broader: any robbery (all robbery types) filed online, citywide 2021+?
print("\n=== all Robbery subcategories filed_online=true (2021+) ===")
rows=q("incident_category='Robbery' AND filed_online=true AND incident_date>='2021-01-01'",
       "incident_subcategory AS sub, count(*) AS n","incident_subcategory","incident_subcategory")
if not rows: print("  (none)")
for r in rows: print(f"  {r.get('sub',''):32} n={r['n']}")
# For contrast: shoplifting filed online share
print("\n=== shoplifting filed_online=true count (2021+) ===")
rows=q("incident_subcategory='Larceny Theft - Shoplifting' AND filed_online=true AND incident_date>='2021-01-01'","count(*) AS n")
print("  shoplifting online:", rows[0]['n'] if rows else 0)
