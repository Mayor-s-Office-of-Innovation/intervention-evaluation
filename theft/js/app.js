// Orchestration: render a per-signal card whose PRIMARY stat is theft reported by
// businesses (latest full month + three reference comparisons + a 12-mo-trend badge),
// then the chart, then arrests as secondary context. See ../plan.md §7.1 / D10 / D11.
// Now supports multiple districts via hash routing (e.g., #central, #mission).
import { loadAggregates, loadProvenance } from './data.js';
import {
  prettyMonth, shortMonth, monthIndex, trailingYoY, trailing12Line,
  compareMonth, compareToAverage, reportTone, trendVerdict, fmtPct,
  shareAt, shareAllTime, fmtSharePct,
} from './rollup.js';
import { drawChart } from './chart.js';
import { initShopliftingMap, setShopliftingDistrict } from './shoplifting-map.js';
import { CITYWIDE, fromHash, isCitywide } from '../../shared/districts.js';

let active = 'Northern';
let AGG, PROV;

const fmtNum = n => (n == null ? '—' : n.toLocaleString('en-US'));
const chartColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const cardsHost = document.getElementById('cards');
const vehicleCardsHost = document.getElementById('vehicle-cards');   // context signals render here (below the map)
const asOf = document.getElementById('data-asof');
const exclHost = document.getElementById('exclusion-note');
let charts = [];

function initDistrict() {
  active = fromHash(location.hash) || 'Northern';

  // Update header to show which district
  const eyebrow = document.querySelector('.app-header__eyebrow');
  if (eyebrow) {
    eyebrow.textContent = isCitywide(active)
      ? 'San Francisco · Citywide · Property & street crime'
      : `San Francisco · ${active} district · Property & street crime`;
  }
  // Carry the district back to the homepage so its pill stays selected
  const back = document.querySelector('.back-home');
  if (back) back.href = `../#${active.toLowerCase()}`;
}

function renderDistrict() {
  cardsHost.innerHTML = '';
  if (vehicleCardsHost) vehicleCardsHost.innerHTML = '';
  charts = [];

  const idx = monthIndex(AGG, AGG.latest_settled_month);
  asOf.textContent = `${isCitywide(active) ? 'Citywide' : active + ' district'} · latest settled month ${prettyMonth(AGG.latest_settled_month)} · built ${AGG.generated}`;

  for (const [key, sig] of Object.entries(AGG.signals)) {
    // Committed KRs render up top; context signals (vehicle) render below the map.
    const host = (sig.context_only && vehicleCardsHost) ? vehicleCardsHost : cardsHost;
    renderCard(key, sig, AGG, idx, host);
  }

  renderDetailSections(AGG, PROV);
  renderExclusion(AGG);
  renderReportingNote(AGG);
  renderFootnotes(PROV);

  const draw = () => charts.forEach(fn => fn());
  draw();
}

function chip(label, detail, pct) {
  const t = reportTone(pct);
  return `
    <div class="chip chip--${t}">
      <span class="chip__delta">${fmtPct(pct)}</span>
      <span class="chip__label">${label}</span>
      <span class="chip__detail">${detail}</span>
    </div>`;
}

function renderCard(key, sig, agg, idx, host = cardsHost) {
  // Get district-specific data from new structure. Citywide has no per-district `series` entry —
  // its reported series lives at sig.citywide.reported (no arrests axis citywide).
  const cw = isCitywide(active);
  const districtData = cw
    ? (sig.citywide ? { reported: sig.citywide.reported } : null)
    : sig.series?.[active];
  if (!districtData) {
    console.warn(`No data for ${active} in signal ${key}`);
    return;
  }

  const reported = districtData.reported;
  const arrests = districtData.arrests;

  const month = agg.months[idx];
  const trend = trailingYoY(reported, idx);
  const v = trendVerdict(trend.pct, sig.noun);
  // Citywide has no arrests series baked, so suppress the enforcement block there too.
  const noArrests = !!sig.no_arrests || cw || !arrests;   // vehicle theft: MVT arrests are near-zero, so we suppress the block

  const vsLast = compareMonth(reported, idx, idx - 1);
  const vsYear = compareMonth(reported, idx, idx - 12);
  const vsAvg = compareToAverage(reported, idx);
  const startYear = agg.months[0].slice(0, 4);

  // "Newest-month peek": we keep the headline number/verdict on the solid settled month, but when a
  // more-recent complete month is being held back (not yet ≥ the completeness bar), show it as a
  // preview with its estimated completeness (plan-settle-completeness.md; user choice "June headline +
  // July peek"). Skipped once the newest complete month IS the settled month (nothing being held back).
  const completeIdx = monthIndex(agg, agg.latest_complete_month);
  const showPeek = agg.latest_complete_month !== agg.latest_settled_month
    && completeIdx != null && reported[completeIdx] != null
    && reported[completeIdx] > 0   // a "0 · ~96% complete" tag reads as "more coming" on ~0 (review Fix 4)
    && agg.latest_complete_completeness_pct != null;

  // Arrests settle slower than reports (long enforcement tail), so the arrests context evaluates at its
  // OWN settled month — one month behind the reported headline (Workstream F) — not the reported idx.
  // Skipped citywide (no arrests series) and where arrests aren't shown.
  let arrIdx, arrMonthLabel, arrMonth, arrYear;
  if (!noArrests) {
    arrIdx = agg.latest_settled_month_arrests ? monthIndex(agg, agg.latest_settled_month_arrests) : idx;
    arrMonthLabel = agg.months[arrIdx];
    arrMonth = arrests[arrIdx];
    arrYear = compareMonth(arrests, arrIdx, arrIdx - 12);
  }

  // "In SF context" compares this district against all of SF — self-referential citywide, so suppressed.
  let cityTrend, shareNow, shareAvg, shareArrow = '';
  if (!cw) {
    cityTrend = trailingYoY(sig.citywide.reported, idx);
    shareNow = shareAt(reported, sig.citywide.reported, idx);
    shareAvg = shareAllTime(reported, sig.citywide.reported);
    // Arrow must agree with the numbers actually printed (both render at integer-percent via
    // fmtSharePct), or an 11.4% vs 10.9% gap shows as "11% ▲ vs 11%" — a contradiction (review Fix 3).
    // Gate on the rounded displayed values, not the raw 0.5pp delta.
    const shareNowR = shareNow == null ? null : Math.round(shareNow * 100);
    const shareAvgR = shareAvg == null ? null : Math.round(shareAvg * 100);
    shareArrow = (shareNowR == null || shareAvgR == null) ? ''
      : shareNowR > shareAvgR ? '▲' : shareNowR < shareAvgR ? '▼' : '▬';
  }

  const card = document.createElement('wa-card');
  // Context signals (vehicle) render below the KR map as a full-width editorial "context band":
  // flat, tinted, left-rail — deliberately NOT the bordered scorecard chrome, so it reads as an
  // aside rather than a co-equal OKR. KR cards keep the compact small-multiple scorecard.
  const wide = !!sig.context_only;
  card.className = `scorecard${wide ? ' scorecard--wide' : ''}`;

  // KR cards: title + verdict badge in the wa-card header slot. Context band: no header slot —
  // the title becomes a quiet in-band kicker (below) and the loud verdict tone-badge is dropped.
  const header = `
    <div slot="header" class="scorecard__header">
      <h3 class="scorecard__title">${sig.label}</h3>
      <span class="scorecard__badges">
        <span class="badge badge--${v.tone}">${v.label}</span>
      </span>
    </div>`;
  const kicker = `
    <div class="ctx-band__kicker">
      <span class="scorecard__title">${sig.label}</span>
      <span class="badge badge--context" title="Shown for context — not one of the two committed key results.">Context</span>
    </div>`;
  const desc = `<p class="scorecard__desc">${sig.desc}</p>`;
  const primary = `
    <div class="primary">
      <div class="primary__eyebrow">${sig.reported_label || 'Theft reported by businesses'}</div>
      <div class="evaluating">Evaluating <strong>${prettyMonth(month)}</strong>
        <span class="evaluating__tag" title="The most recent month complete enough to trust — see the note below the charts.">latest settled month</span>
      </div>
      <div class="primary__figure">
        <span class="primary__num">${fmtNum(reported[idx])}</span>
        <span class="primary__unit">reports</span>
        <span class="primary__trend trend--${v.tone}">12-mo trend ${fmtPct(trend.pct)}</span>
      </div>
      ${showPeek ? `<div class="primary__peek" title="The newest complete month is still filling in — shown as a preview, not the evaluated figure. Completeness is estimated from the reporting-lag curve (see the note below the charts).">
        ${shortMonth(agg.latest_complete_month)} so far <strong>${fmtNum(reported[completeIdx])}</strong>
        <span class="primary__peek-tag">~${Math.round(agg.latest_complete_completeness_pct)}% complete</span>
      </div>` : ''}
      <p class="verdict verdict--${v.tone}">${v.text}</p>
    </div>`;
  const chipsBlock = `
    <div class="chips">
      ${chip('vs last month', `${shortMonth(agg.months[idx - 1])}: ${fmtNum(vsLast.ref)}`, vsLast.pct)}
      ${chip('vs a year ago', `${shortMonth(agg.months[idx - 12])}: ${fmtNum(vsYear.ref)}`, vsYear.pct)}
      ${chip('vs typical month', `avg ${Math.round(vsAvg.avg)}/mo since ${startYear}`, vsAvg.pct)}
    </div>`;
  const chartBlock = `
    <div class="chart-host" id="chart-${key}"></div>
    <div class="legend">
      <span class="legend__item"><i style="background:var(--chart-monthly)"></i>Reported (monthly)</span>
      <span class="legend__item"><i style="background:var(--chart-trend);height:3px"></i>Reported (12-mo avg)</span>
      ${noArrests ? '' : '<span class="legend__item"><i style="background:var(--chart-arrests)"></i>Arrests (context)</span>'}
    </div>`;
  const sfContext = cw ? '' : `
    <div class="sf-context">
      <div class="sf-context__head">In SF context</div>
      <div class="sf-context__row">
        <span class="sf-context__label">Citywide 12-mo trend</span>
        <span class="sf-context__val delta--${reportTone(cityTrend.pct)}">${fmtPct(cityTrend.pct)}</span>
      </div>
      <div class="sf-context__row">
        <span class="sf-context__label">${active} share of SF</span>
        <span class="sf-context__val">${fmtSharePct(shareNow)}
          <span class="sf-context__sub">${shareArrow} vs ${fmtSharePct(shareAvg)} all-time avg</span>
        </span>
      </div>
    </div>`;
  const contextBlock = noArrests ? '' : `
    <div class="context">
      <div class="context__head">Enforcement — context, not a success target</div>
      <div class="context__row">
        <span><strong>${fmtNum(arrMonth)}</strong> SFPD arrests in ${shortMonth(arrMonthLabel)}</span>
        <span class="context__delta">vs a year ago ${fmtPct(arrYear.pct)} <small>(${shortMonth(agg.months[arrIdx - 12])}: ${fmtNum(arrYear.ref)})</small></span>
      </div>
      <p class="context__note">
        We want arrests to rise while theft is high — but if deterrence is working, arrests should
        eventually fall <em>alongside</em> reports. So read this beside the trend above, not as a
        target on its own.
      </p>
    </div>`;
  const foot = `
    <small class="scorecard__foot">
      ${key === 'commercial' ? 'Burglary + robbery combined. ' : ''}${sig.context_only ? 'Shown as context, not a committed key result — the citywide decline predates and exceeds any single district’s effort. ' : ''}${noArrests ? 'Vehicle theft is almost entirely victim-reported and has no meaningful arrests axis, so arrests are not shown. ' : ''}Single months are noisy at this
      volume — the 12-month trend and chart show the real direction.
    </small>`;

  // Context band: full-width, stats-lede on the left, wide chart on the right — a flat aside.
  // Default KR card: everything stacked in the bordered small-multiple.
  const body = wide
    ? `<div class="ctx-band__grid">
         <div class="ctx-band__lede">${kicker}${desc}${primary}</div>
         <div class="ctx-band__chart">${chartBlock}</div>
       </div>
       <div class="ctx-band__meta">${chipsBlock}${sfContext}</div>
       ${foot}`
    : `${desc}${primary}${chipsBlock}${chartBlock}${sfContext}${contextBlock}${foot}`;
  card.innerHTML = wide ? body : `${header}${body}`;
  host.appendChild(card);

  const avg = s => trailing12Line(s).map(x => (x == null ? null : x / 12));
  const settledIdx = monthIndex(agg, agg.latest_settled_month);
  const lines = [
    { values: avg(reported), color: chartColor('--chart-trend'), width: 2.5, label: 'Reported 12mo' },
    { values: reported, color: chartColor('--chart-monthly'), width: 2.25, label: 'Reported monthly' },
  ];
  // Arrests line only where an arrests axis is meaningful (not vehicle theft).
  if (!noArrests) lines.splice(1, 0,
    { values: arrests, color: chartColor('--chart-arrests'), width: 1.5, opacity: 0.85, label: 'Arrests' });
  charts.push(() => drawChart(
    card.querySelector(`#chart-${key}`), agg.months, lines,
    { unsettledFromIdx: settledIdx + 1 },
  ));
}

// ── Vehicle-theft DETAIL section (Workstream B). Renders once per signal carrying a baked `detail`
// node (currently only vehicle). All numbers are pre-baked over the signal's own window (2018→present)
// for stable percentages; the hour histogram is the honest home for "when" after the Day/Night toggle
// was dropped (see theft/day-night-findings.md). ──
const TYPE_ORDER = [['auto', 'Auto'], ['truck', 'Truck'], ['motorcycle', 'Motorcycle'], ['other', 'Other']];
const prettyCorner = s => s.replace(/\s*\\\s*/g, ' & ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const hourLabel = i => ({ 0: '12a', 6: '6a', 12: '12p', 18: '6p' }[i] || '');

function renderDetailSections(agg, prov) {
  const host = document.getElementById('detail-sections');
  if (!host) return;
  const html = [];
  for (const [key, sig] of Object.entries(agg.signals)) {
    const d = sig.detail?.[active];
    if (d) html.push(detailSection(key, sig, d, prov));
  }
  host.innerHTML = html.join('');
}

function detailSection(key, sig, d, prov) {
  const startYear = (d.start || '2018').slice(0, 4);
  const tm = d.type_mix;
  const untypedPct = tm.total ? Math.round((tm.untyped / tm.total) * 100) : 0;

  // Bars descending by count so length reads top-to-bottom (review Fix 7); the "Other" catch-all is
  // pinned last regardless of size since it's a residual bucket, not a vehicle class.
  const typeBars = TYPE_ORDER
    .map(([k, label]) => ({ k, label, n: tm.buckets[k] || 0 }))
    .sort((a, b) => (a.k === 'other') - (b.k === 'other') || b.n - a.n)
    .map(({ k, label, n }) => {
      const pct = tm.typed ? (n / tm.typed) * 100 : 0;
      return `<div class="tbar">
      <span class="tbar__label">${label}</span>
      <span class="tbar__track"><span class="tbar__fill" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="tbar__val">${Math.round(pct)}% <small>(${fmtNum(n)})</small></span>
    </div>`;
    }).join('');

  const maxHour = Math.max(1, ...d.hours);
  const peak = d.hours.indexOf(Math.max(...d.hours));
  const hourBars = d.hours.map((n, i) => {
    const h = Math.max(2, Math.round((n / maxHour) * 100));
    const hr = i % 12 === 0 ? 12 : i % 12;
    const ampm = i < 12 ? 'am' : 'pm';
    return `<span class="hour-bar${i === peak ? ' hour-bar--peak' : ''}" style="height:${h}%"
      title="${hr}${ampm} — ${fmtNum(n)} reports"></span>`;
  }).join('');
  const hourAxis = d.hours.map((_, i) => `<span class="hours-axis__t">${hourLabel(i)}</span>`).join('');

  const maxCorner = Math.max(1, ...d.top_intersections.map(t => t.n));
  const cornerBars = d.top_intersections.map(t => `<div class="cbar">
      <span class="cbar__label" title="${prettyCorner(t.intersection)}">${prettyCorner(t.intersection)}</span>
      <span class="cbar__track"><span class="cbar__fill" style="width:${((t.n / maxCorner) * 100).toFixed(1)}%"></span></span>
      <span class="cbar__val">${fmtNum(t.n)}</span>
    </div>`).join('');

  const q = prov?.signals?.[key]?.detail_queries?.[active];
  const qlink = (url, text) => url ? `<a href="${url}" target="_blank" rel="noopener">${text}</a>` : '';
  const queries = q ? `<p class="detail__method">Method: vehicle type parsed from <code class="fn-filter">incident_description</code>;
    hour uses the <em>reported</em> time, not the (unknown) moment of theft. All figures span ${startYear}→present.
    Run the exact queries: ${qlink(q.type_mix, 'type mix ↗')} · ${qlink(q.hours, 'hour-of-day ↗')} · ${qlink(q.top_intersections, 'top corners ↗')}.</p>` : '';

  return `<section class="detail" aria-label="${sig.label} detail — ${active}">
    <h2 class="detail__head">${sig.label} in depth · ${active}</h2>
    <p class="detail__note">Vehicle theft is the one category whose data supports this breakdown — a clean
      vehicle type, a reported-hour profile, and enough multi-year history for stable top locations. The
      merchant key results don't, so this detail is vehicle-only (it isn't a claim that vehicle theft
      matters more). Figures cover ${startYear}→present.</p>

    <div class="detail-grid">
      <div class="dt-panel">
        <div class="dt-panel__title">What kind of vehicle</div>
        ${typeBars}
        <p class="dt-panel__foot">Share of <strong>typed</strong> reports. Recovered/attempted rows carry
          no vehicle type and are excluded (~${untypedPct}% of all ${fmtNum(tm.total)} reports).</p>
      </div>

      <div class="dt-panel">
        <div class="dt-panel__title">When it's reported <span class="dt-panel__tag">reported hour</span></div>
        <div class="hours">${hourBars}</div>
        <div class="hours-axis">${hourAxis}</div>
        <p class="dt-panel__foot">Hour the report was filed — for stolen vehicles this is when the owner
          noticed, not when the theft happened, so read it as a reporting rhythm, not a crime clock.</p>
      </div>
    </div>

    <div class="dt-panel dt-panel--wide">
      <div class="dt-panel__title">Where it accumulates · top corners, ${startYear}→present</div>
      ${cornerBars}
      <p class="dt-panel__foot">All-time counts, so multi-year totals are legible. Vehicle theft is diffuse
        (hundreds of corners); these leaders are modest and a hot corner reflects where cars park, not a
        single store. ${queries}</p>
    </div>
  </section>`;
}

function renderExclusion(agg) {
  if (!agg.excluded || !agg.excluded.length) return;
  exclHost.innerHTML = agg.excluded.map(e =>
    `<strong>Excluded:</strong> the "${e.code}" incident code. ${e.reason}`).join('<br>');
}

function renderReportingNote(agg) {
  const host = document.getElementById('reporting-note');
  const s = agg.settling;
  if (!host || !s) return;
  const settled = prettyMonth(agg.latest_settled_month);
  const complete = prettyMonth(agg.latest_complete_month);
  const lagMo = agg.settle_lag_months;
  const lagWord = n => (n === 1 ? 'one complete month' : `${n} complete months`);
  // Arrests settle slower, so they hold back an extra month — surfaced honestly here (Workstream F).
  const arrLag = agg.settle_lag_months_arrests;
  const arrSettled = agg.latest_settled_month_arrests ? prettyMonth(agg.latest_settled_month_arrests) : null;
  // Completeness estimate (plan-settle-completeness.md): turn the lag curve into "% of this month's
  // reports already in", and — when we're holding the headline back — say how short the newest month is.
  const missing = agg.settled_missing_pct;
  const settledComplete = agg.settled_completeness_pct != null ? Math.round(agg.settled_completeness_pct) : null;
  const lcComplete = agg.latest_complete_completeness_pct != null ? Math.round(agg.latest_complete_completeness_pct) : null;
  const bar = agg.solid_threshold_pct != null ? agg.solid_threshold_pct : null;  // exact (98.5), not rounded
  const completenessSentence = settledComplete == null ? '' :
    ` We estimate <strong>${settled} is ~${settledComplete}% complete</strong>${missing != null
      ? ` (≈${missing}% of reports still to arrive)` : ''}` +
    (lagMo > 0 && lcComplete != null
      ? `; the newest complete month (${complete}) is only ~${lcComplete}% complete${bar != null
          ? `, below our ~${bar}% "solid" bar` : ''}, so we hold the headline back until it firms up.`
      : ', so we treat it as final.');
  host.innerHTML = `
    <div class="callout__title">Recent months aren't final — that's why we evaluate ${settled}</div>
    <p>SFPD reports enter this dataset only after a supervisor approves them, so a month keeps filling in
    after it ends. But <em>business/victim reports settle fast</em>: across a fully-settled period
    (${s.ref_window}, n=${s.n} reports), ${s.median_days === 0
      ? 'the median report is filed the same day'
      : `the median report lands in ${s.median_days} day${s.median_days === 1 ? '' : 's'}`} and
    <strong>${s.within_30_pct}% within 30 days</strong>, so a settled month rarely gains more than a
    couple of percent afterward. We therefore evaluate the reported headline at the latest settled month
    (<strong>${settled}</strong>, ${lagMo === 0 ? 'the newest complete month' : `just ${lagWord(lagMo)} back`})
    and shade only the still-filling months after it.${completenessSentence}
    <a class="fnref" href="#fn-settled">how we measure this ↗</a></p>
    <p><strong>Arrests are different.</strong> Enforcement outcomes carry a long tail (~10% take
    <strong>${agg.settling_arrests ? agg.settling_arrests.p90_days + '+' : 'many more'} days</strong>),
    so the arrests context holds back further${arrSettled ? ` — to ${arrSettled}, ${arrLag} months back` : ''}.
    And because single months are noisy at this volume, the Improving / Worsening badge follows the
    de-noised <strong>12-month trend</strong>, not any one month.</p>`;
}

// Build the runnable footnote query links CLIENT-SIDE from the build-generated `filter`, so the
// "run the query" link reproduces the district actually on screen. The build bakes only the citywide
// denominator query; the per-district query lives here (there's no single canonical district):
//   districtQueryUrl → per-district reported+arrests (split by resolution)
//   citywideQueryUrl → citywide denominator behind the "share of SF" tile
const SODA = 'https://data.sfgov.org/resource/wg3w-h783.json';
const HISTORY_START = '2021-01-01';   // build.py HISTORY_START
const RES_REPORTED = 'Open or Active'; // build.py RES_REPORTED
const queryUrl = soql => `${SODA}?${new URLSearchParams({ '$query': soql })}`;
const districtQueryUrl = (filter, district) => queryUrl(
  `SELECT date_trunc_ym(incident_date) AS month, resolution, count(*) AS n `
  + `WHERE (${filter}) AND police_district='${district}' AND incident_date >= '${HISTORY_START}' `
  + `GROUP BY month, resolution ORDER BY month`);
const citywideQueryUrl = filter => queryUrl(
  `SELECT date_trunc_ym(incident_date) AS month, count(*) AS n `
  + `WHERE (${filter}) AND resolution='${RES_REPORTED}' AND incident_date >= '${HISTORY_START}' `
  + `GROUP BY month ORDER BY month`);

function renderFootnotes(prov) {
  const host = document.getElementById('footnotes');
  if (!host || !prov) return;
  const link = (url, text = 'run the exact query ↗') => `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
  const code = s => `<code class="fn-filter">${s}</code>`;
  const cw = isCitywide(active);
  const items = [];
  // Citywide view: the on-screen number IS the unfiltered citywide count, so the runnable link is the
  // citywide query (no district filter) — the per-district link would build an invalid police_district.
  const scopedMeta = filter => cw
    ? `Filter: ${code(filter)} · ${link(citywideQueryUrl(filter), 'run the citywide query ↗')}`
    : `Filter: ${code(filter)} · ${link(districtQueryUrl(filter, active), `run the ${active} query ↗`)} · `
      + `${link(citywideQueryUrl(filter), 'citywide denominator ↗')}`;

  for (const key of ['shoplifting', 'commercial']) {
    const s = prov.signals[key];
    if (!s) continue;
    items.push({ id: `fn-${key}`, title: s.label,
      body: `${s.why} <span class="fn-meta">${scopedMeta(s.filter)}</span>` });
  }
  if (!cw) items.push({ id: 'fn-sf-context', title: 'In SF context — citywide trend & share',
    body: `The “Citywide 12-mo trend” and “${active} share of SF” compare this district against all of SF. `
        + `The citywide denominator drops the district filter and counts reported incidents `
        + `(<code class="fn-filter">resolution='${RES_REPORTED}'</code>) — the “citywide denominator ↗” link on each `
        + `signal above runs it.` });
  for (const e of prov.excluded || []) {
    items.push({ id: 'fn-excluded', title: `Excluded — ${e.code}`,
      body: `${e.why} <span class="fn-meta">Filter: ${code(e.where)} · ${link(e.query_url)}</span>` });
  }
  if (prov.axes) {
    items.push({ id: 'fn-axes', title: 'The two axes — reported vs. arrests',
      body: `<strong>Reported by businesses</strong> — ${prov.axes.reported.why} `
          + `${code(prov.axes.reported.where)}<br>`
          + `<strong>Arrests by SFPD</strong> — ${prov.axes.arrests.why} `
          + `${code(prov.axes.arrests.where)}` });
  }
  if (prov.settle_note) {
    items.push({ id: 'fn-settled', title: 'Latest settled month', body: prov.settle_note });
  }
  // Vehicle theft (context) appended last so it doesn't renumber the bracket-referenced footnotes above.
  const veh = prov.signals.vehicle;
  if (veh) {
    items.push({ id: 'fn-vehicle', title: veh.label,
      body: `${veh.why} <em>Shown as context, not a key result; motor-vehicle theft has no meaningful `
          + `arrests axis, so the card shows reports only.</em> <span class="fn-meta">${scopedMeta(veh.filter)}</span>` });
  }

  host.innerHTML = items.map(it =>
    `<li id="${it.id}"><strong>${it.title}.</strong> ${it.body}</li>`).join('');
}

(async function main() {
  try {
    [AGG, PROV] = await Promise.all([loadAggregates(), loadProvenance().catch(() => null)]);

    initDistrict();
    renderDistrict();
    initShopliftingMap(active);   // deferred: loads + inits only when scrolled into view

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => charts.forEach(fn => fn()), 150); });
    window.addEventListener('themechange', () => setTimeout(() => charts.forEach(fn => fn()), 0));
    window.addEventListener('hashchange', () => {
      initDistrict();
      renderDistrict();
      setShopliftingDistrict(active);   // no-op until the map has loaded
    });
  } catch (err) {
    document.getElementById('cards').innerHTML =
      `<p class="error">Could not load data: ${err.message}</p>`;
    console.error(err);
  }
})();
