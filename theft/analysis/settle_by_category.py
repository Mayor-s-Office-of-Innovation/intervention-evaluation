"""Per-subcategory report-settling (incident_date -> report_datetime lag), resolution='Open or Active',
over a fully-settled 12-mo window (12-24 mo ago). Tests whether one global settled-month fits all cats."""
import datetime, urllib.parse, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "build"))
from httpget import get_json

DOMAIN, DATASET = "data.sfgov.org", "wg3w-h783"
RES = "Open or Active"
TODAY = datetime.date.today()
def fom(mb):
    t = TODAY.year*12 + (TODAY.month-1) - mb
    return datetime.date(t//12, t%12+1, 1)
def soql(where, select="incident_date, report_datetime"):
    p={"$select":select,"$where":where,"$limit":"50000"}
    return get_json(f"https://{DOMAIN}/resource/{DATASET}.json?"+urllib.parse.urlencode(p))
def lagstats(sub_where, district=None):
    lo,hi=fom(24),fom(12)
    w=f"({sub_where}) AND resolution='{RES}' AND incident_date >= '{lo}' AND incident_date < '{hi}'"
    if district: w+=f" AND police_district='{district}'"
    rows=soql(w); lags=[]
    for r in rows:
        if r.get("incident_date") and r.get("report_datetime"):
            d=(datetime.date.fromisoformat(r["report_datetime"][:10])-datetime.date.fromisoformat(r["incident_date"][:10])).days
            if d>=0: lags.append(d)
    lags.sort(); n=len(lags)
    pct=lambda p: lags[min(n-1,int(p/100*n))] if n else None
    within=lambda d: round(sum(1 for x in lags if x<=d)/n*100,1) if n else None
    return dict(n=n,median=pct(50),w14=within(14),w30=within(30),w45=within(45),w60=within(60),p90=pct(90),p95=pct(95))
CATS={"shoplifting":"incident_subcategory = 'Larceny Theft - Shoplifting'",
  "comm_burglary":"incident_subcategory = 'Burglary - Commercial'",
  "comm_robbery":"incident_subcategory = 'Robbery - Commercial'",
  "commercial(b+r)":"incident_subcategory in('Burglary - Commercial','Robbery - Commercial')"}
print(f"window {fom(24):%b %Y}-{fom(13):%b %Y}  resolution={RES}\n")
for scope,dist in [("CITYWIDE",None),("Northern","Northern")]:
    print(f"=== {scope} ===")
    print(f"{'cat':16}{'n':>6}{'med':>5}{'w14':>7}{'w30':>7}{'w45':>7}{'w60':>7}{'p90':>6}{'p95':>6}")
    for k,w in CATS.items():
        s=lagstats(w,dist)
        print(f"{k:16}{s['n']:>6}{str(s['median']):>5}{str(s['w14']):>7}{str(s['w30']):>7}{str(s['w45']):>7}{str(s['w60']):>7}{str(s['p90']):>6}{str(s['p95']):>6}")
    print()
