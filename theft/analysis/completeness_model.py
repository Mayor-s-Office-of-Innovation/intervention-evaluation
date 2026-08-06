"""Estimate a recent incident-month's missing % of reports, from the incident->report lag CDF,
then invert to 'a month is solid (>=threshold complete) N days after month-end'.
Appearance lag ~= reporting lag + <1 day (dataset reloads daily; see appearance_probe.py)."""
import datetime, urllib.parse, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__),"..","build"))
from httpget import get_json
DOMAIN,DATASET="data.sfgov.org","wg3w-h783"; RES="Open or Active"
TODAY=datetime.date.today()
def fom(mb):
    t=TODAY.year*12+(TODAY.month-1)-mb; return datetime.date(t//12,t%12+1,1)
def lags(where):
    lo,hi=fom(24),fom(12)  # fully-settled 12-mo window
    w=f"({where}) AND resolution='{RES}' AND incident_date>='{lo}' AND incident_date<'{hi}'"
    rows=get_json(f"https://{DOMAIN}/resource/{DATASET}.json?"+urllib.parse.urlencode(
        {"$select":"incident_date, report_datetime","$where":w,"$limit":"50000"}))
    out=[]
    for r in rows:
        if r.get("incident_date") and r.get("report_datetime"):
            d=(datetime.date.fromisoformat(r["report_datetime"][:10])-datetime.date.fromisoformat(r["incident_date"][:10])).days
            if d>=0: out.append(d)
    return sorted(out)

def cdf(sorted_lags):
    n=len(sorted_lags)
    return lambda k: (sum(1 for x in sorted_lags if x<=k)/n) if n else 0.0

def month_completeness(F, delta, D=30):
    # fraction of a D-day month's incidents reported by `delta` days after month-end
    return sum(F(delta+j) for j in range(D))/D

CATS={"shoplifting":"incident_subcategory='Larceny Theft - Shoplifting'",
      "commercial":"incident_subcategory in('Burglary - Commercial','Robbery - Commercial')",
      "all-merchant":"incident_subcategory in('Larceny Theft - Shoplifting','Burglary - Commercial','Robbery - Commercial')"}

Fs={}
for k,w in CATS.items():
    L=lags(w); Fs[k]=(cdf(L),len(L))
    F=Fs[k][0]
    print(f"{k:12} n={len(L):5}  F(0)={F(0)*100:4.1f}%  F(3)={F(3)*100:4.1f}%  F(7)={F(7)*100:4.1f}%  F(14)={F(14)*100:4.1f}%  F(30)={F(30)*100:4.1f}%")

print("\n=== estimated MISSING % of a month's reports, by days after month-end ===")
print(f"{'days':>4}"+"".join(f"{k:>13}" for k in CATS))
for delta in [0,3,6,9,12,15,18,21,25,30,37]:
    row=f"{delta:>4}"
    for k in CATS:
        miss=(1-month_completeness(Fs[k][0],delta))*100
        row+=f"{miss:>12.2f}%"
    print(row)

print("\n=== days after month-end to reach completeness threshold (all-merchant / shoplifting) ===")
for thr in [0.99,0.995,0.999]:
    for k in ["all-merchant","shoplifting"]:
        F=Fs[k][0]
        d=next((dd for dd in range(0,90) if month_completeness(F,dd)>=thr),None)
        print(f"  >= {thr*100:4.1f}% complete: {k:12} after {d} days")

print(f"\n=== current situation (today {TODAY}) ===")
for label, monthend, in [("June (ended 2026-06-30)",datetime.date(2026,6,30)),
                         ("July (ended 2026-07-31)",datetime.date(2026,7,31))]:
    delta=(TODAY-monthend).days
    F=Fs["all-merchant"][0]; Fs_shop=Fs["shoplifting"][0]
    print(f"  {label}: {delta} days settled -> missing ~{(1-month_completeness(F,delta))*100:.2f}% (all-merchant), "
          f"~{(1-month_completeness(Fs_shop,delta))*100:.2f}% (shoplifting)")
