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

const DISTRICTS = ['Northern', 'Central', 'Mission', 'Tenderloin'];
let active = 'Northern';
let AGG, PROV;

const fmtNum = n => (n == null ? '—' : n.toLocaleString('en-US'));
const chartColor = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const cardsHost = document.getElementById('cards');
const asOf = document.getElementById('data-asof');
const exclHost = document.getElementById('exclusion-note');
let charts = [];

function initDistrict() {
  const h = (location.hash || '').replace('#', '').toLowerCase();
  active = DISTRICTS.find(d => d.toLowerCase() === h) || 'Northern';

  // Update header to show which district
  const eyebrow = document.querySelector('.app-header__eyebrow');
  if (eyebrow) {
    eyebrow.textContent = `San Francisco · ${active} district · Property & street crime`;
  }
}

function renderDistrict() {
  cardsHost.innerHTML = '';
  charts = [];

  const idx = monthIndex(AGG, AGG.latest_settled_month);
  asOf.textContent = `${active} district · latest settled month ${prettyMonth(AGG.latest_settled_month)} · built ${AGG.generated}`;

  for (const [key, sig] of Object.entries(AGG.signals)) {
    renderCard(key, sig, AGG, idx);
  }

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

function renderCard(key, sig, agg, idx) {
  // Get district-specific data from new structure
  const districtData = sig.series?.[active];
  if (!districtData) {
    console.warn(`No data for ${active} in signal ${key}`);
    return;
  }

  const reported = districtData.reported;
  const arrests = districtData.arrests;

  const month = agg.months[idx];
  const trend = trailingYoY(reported, idx);
  const v = trendVerdict(trend.pct);

  const vsLast = compareMonth(reported, idx, idx - 1);
  const vsYear = compareMonth(reported, idx, idx - 12);
  const vsAvg = compareToAverage(reported, idx);
  const startYear = agg.months[0].slice(0, 4);

  const arrMonth = arrests[idx];
  const arrYear = compareMonth(arrests, idx, idx - 12);

  const cityTrend = trailingYoY(sig.citywide.reported, idx);
  const shareNow = shareAt(reported, sig.citywide.reported, idx);
  const shareAvg = shareAllTime(reported, sig.citywide.reported);
  const dShare = (shareNow != null && shareAvg != null) ? shareNow - shareAvg : null;
  const shareArrow = dShare == null ? '' : dShare > 0.005 ? '▲' : dShare < -0.005 ? '▼' : '▬';

  const card = document.createElement('wa-card');
  card.className = 'scorecard';
  card.innerHTML = `
    <div slot="header" class="scorecard__header">
      <h3 class="scorecard__title">${sig.label}</h3>
      <span class="badge badge--${v.tone}">${v.label}</span>
    </div>
    <p class="scorecard__desc">${sig.desc}</p>

    <div class="primary">
      <div class="primary__eyebrow">Theft reported by businesses</div>
      <div class="evaluating">Evaluating <strong>${prettyMonth(month)}</strong>
        <span class="evaluating__tag" title="The most recent month complete enough to trust — see the note below the charts.">latest settled month</span>
      </div>
      <div class="primary__figure">
        <span class="primary__num">${fmtNum(reported[idx])}</span>
        <span class="primary__unit">reports</span>
        <span class="primary__trend trend--${v.tone}">12-mo trend ${fmtPct(trend.pct)}</span>
      </div>
      <p class="verdict verdict--${v.tone}">${v.text}</p>
      <div class="chips">
        ${chip('vs last month', `${shortMonth(agg.months[idx - 1])}: ${fmtNum(vsLast.ref)}`, vsLast.pct)}
        ${chip('vs a year ago', `${shortMonth(agg.months[idx - 12])}: ${fmtNum(vsYear.ref)}`, vsYear.pct)}
        ${chip('vs typical month', `avg ${Math.round(vsAvg.avg)}/mo since ${startYear}`, vsAvg.pct)}
      </div>
    </div>

    <div class="chart-host" id="chart-${key}"></div>
    <div class="legend">
      <span class="legend__item"><i style="background:var(--chart-monthly)"></i>Reported (monthly)</span>
      <span class="legend__item"><i style="background:var(--chart-trend);height:3px"></i>Reported (12-mo avg)</span>
      <span class="legend__item"><i style="background:var(--chart-arrests)"></i>Arrests (context)</span>
    </div>

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
    </div>

    <div class="context">
      <div class="context__head">Enforcement — context, not a success target</div>
      <div class="context__row">
        <span><strong>${fmtNum(arrMonth)}</strong> SFPD arrests in ${shortMonth(month)}</span>
        <span class="context__delta">vs a year ago ${fmtPct(arrYear.pct)} <small>(${shortMonth(agg.months[idx - 12])}: ${fmtNum(arrYear.ref)})</small></span>
      </div>
      <p class="context__note">
        We want arrests to rise while theft is high — but if deterrence is working, arrests should
        eventually fall <em>alongside</em> reports. So read this beside the trend above, not as a
        target on its own.
      </p>
    </div>

    <small class="scorecard__foot">
      ${key === 'commercial' ? 'Burglary + robbery combined. ' : ''}Single months are noisy at this
      volume — the 12-month trend and chart show the real direction.
    </small>`;
  cardsHost.appendChild(card);

  const avg = s => trailing12Line(s).map(x => (x == null ? null : x / 12));
  const settledIdx = monthIndex(agg, agg.latest_settled_month);
  charts.push(() => drawChart(
    card.querySelector(`#chart-${key}`), agg.months,
    [
      { values: avg(reported), color: chartColor('--chart-trend'), width: 2.5, label: 'Reported 12mo' },
      { values: arrests, color: chartColor('--chart-arrests'), width: 1.5, opacity: 0.85, label: 'Arrests' },
      { values: reported, color: chartColor('--chart-monthly'), width: 2.25, label: 'Reported monthly' },
    ],
    { unsettledFromIdx: settledIdx + 1 },
  ));
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
  host.innerHTML = `
    <div class="callout__title">Recent months aren't final — that's why we evaluate ${settled}</div>
    <p>SFPD reports enter this dataset only after a supervisor approves them, so a month keeps filling in
    for weeks after it ends. Across a fully-settled period (${s.ref_window}, n=${s.n} reports), the
    median report lands in ${s.median_days} day${s.median_days === 1 ? '' : 's'} and
    <strong>${s.within_30_pct}% within 30 days</strong> — but a long tail means ~10% take
    <strong>${s.p90_days}+ days</strong>. So the most recent month or two (through ${complete}) are
    still climbing and would read as a false drop.</p>
    <p><strong>What we do:</strong> the headline evaluates the latest <em>settled</em> month
    (<strong>${settled}</strong>, ${agg.settle_lag_months} months back); still-filling months are shaded
    on every chart. And because single months are noisy at this volume, the Improving / Worsening badge
    follows the de-noised <strong>12-month trend</strong>, not any one month.</p>`;
}

function renderFootnotes(prov) {
  const host = document.getElementById('footnotes');
  if (!host || !prov) return;
  const link = url => `<a href="${url}" target="_blank" rel="noopener">run the exact query ↗</a>`;
  const code = s => `<code class="fn-filter">${s}</code>`;
  const items = [];

  for (const key of ['shoplifting', 'commercial']) {
    const s = prov.signals[key];
    if (!s) continue;
    items.push({ id: `fn-${key}`, title: s.label,
      body: `${s.why} <span class="fn-meta">Filter: ${code(s.filter)} · ${link(s.query_url)}</span>` });
  }
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

  host.innerHTML = items.map(it =>
    `<li id="${it.id}"><strong>${it.title}.</strong> ${it.body}</li>`).join('');
}

(async function main() {
  try {
    [AGG, PROV] = await Promise.all([loadAggregates(), loadProvenance().catch(() => null)]);

    initDistrict();
    renderDistrict();

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => charts.forEach(fn => fn()), 150); });
    window.addEventListener('themechange', () => setTimeout(() => charts.forEach(fn => fn()), 0));
  } catch (err) {
    document.getElementById('cards').innerHTML =
      `<p class="error">Could not load data: ${err.message}</p>`;
    console.error(err);
  }
})();
