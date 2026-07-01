# Test Plan — Intervention Evaluation Dashboards

Comprehensive manual regression checklist for all dashboards. Run before releases; each automated test maps back to items here.

## Environment

All tests run against a **locally served build** using committed `data/*.json` fixtures by default:
```bash
npx http-server -p 8080 -c-1
```

Tests that write data (interventions API) must target a **dev worker/test namespace**, never production:
```bash
# Local development
cd interventions-api && wrangler dev
# Tests use API_URL=http://localhost:8787
```

For Playwright: `npx playwright test --headed` to watch tests run; `--ui` for interactive mode.

---

## Homepage (`/index.html`)

### Features
- [ ] **District tabs**: Four tabs (Northern, Central, Mission, Tenderloin) render
- [ ] **Tab selection**: Clicking a tab updates the view and URL hash (`#northern`, etc.)
- [ ] **OKR cards**: Three OKR cards render per district with KR tickers
- [ ] **KR tickers**: Each card shows 1mo and 3mo change badges (up/down arrows + percentages)
- [ ] **Card navigation**: Clicking an OKR card navigates to the sub-dashboard with district hash
- [ ] **Content tabs**: OKRs / Interventions tabs switch views
- [ ] **Interventions table**: Shows intervention rows with target KR, status badges
- [ ] **Back navigation**: Browser back from sub-dashboard returns to homepage with same district selected
- [ ] **URL state**: District persists in URL hash; direct link to `/#mission` works
- [ ] **No console errors**: Check devtools console

### Data parity
- [ ] KR ticker percentages match `*/data/aggregates.json` calculations

---

## Districts Dashboard (`/districts/index.html`)

### Features
- [ ] **District rollup cards**: Cards for each district + citywide render with report counts
- [ ] **YoY comparison**: "vs a year earlier" delta shows with correct class (good/bad)
- [ ] **Signal selector**: Dropdown switches between signals (Encampment, etc.)
- [ ] **Time slider**: Dual-thumb range slider adjusts the time window
- [ ] **Play button**: Animates through time windows
- [ ] **Focus tabs**: District tabs below chart allow focusing on one district
- [ ] **Chart overlays**: Toggle checkboxes for 12-mo average, Prior year, Citywide
- [ ] **Map renders**: Heatmap/dots mode toggle works
- [ ] **Methodology section**: Shows data sources and caveats
- [ ] **No console errors**

---

## Drug Dashboard (`/drug/index.html#<district>`)

### Features
- [ ] **Success cards**: Two cards (Drug complaints, Dealer arrests) with momentum chips (1mo/3mo/12mo)
- [ ] **Citywide card**: Shows citywide context with share percentage
- [ ] **Chart selector**: Aggregate / Drug complaints / Dealer arrests switches focus
- [ ] **Chart renders**: SVG with bars, selection band, overlay lines
- [ ] **Scrubber presets**: Since Lurie / 12mo / 3mo / All buttons work
- [ ] **Scrubber label**: Shows selected date range
- [ ] **Map renders**: Hotspot cells (persistent/emerged/cooled) with legend
- [ ] **Map legend**: Click toggles category visibility; counts update
- [ ] **Cell popup**: Click cell → sparkline + "See details" button
- [ ] **See details panel**: Opens breakdown with TOD chips (All/Morning/Afternoon/Evening/Night)
- [ ] **TOD chips filter breakdown**: Clicking a chip filters the incident-type breakdown
- [ ] **Popup stays open**: After See details, popup remains open through chip clicks
- [ ] **Map TOD filter**: Granular time-of-day chips reclassify cells
- [ ] **Deep-link**: Pinning a cell adds URL params; sharing the URL restores the cell
- [ ] **Composition chart**: Shows district's share of citywide
- [ ] **Methodology**: Runnable query links present
- [ ] **No console errors**

### Data parity
- [ ] Headline card number equals `data/aggregates.json` latest complete month value (V7 test)

---

## Unhoused Dashboard (`/unhoused/index.html#<district>`)

### Features
- [ ] **Page-level Day/Night toggle**: Two toggle buttons filter all visualizations
- [ ] **Success cards**: Encampments + 911 unhoused calls with momentum chips
- [ ] **Citywide card**: Context card with share of citywide
- [ ] **Chart selector**: Aggregate / Encampment / 911 unhoused calls
- [ ] **Encampment-only toggle**: When Encampment focused, toggle shows dedicated category only
- [ ] **Scrubber presets**: Since Lurie / 12mo / 3mo / All
- [ ] **Chart brush**: Drag to select custom window
- [ ] **Map signal toggle**: Encampment / 911 unhoused calls switches map data
- [ ] **Map TOD filter**: All + Morning/Afternoon/Evening/Night chips
- [ ] **Map view toggle**: Combined / Day vs night split view
- [ ] **Cell popup + See details**: Same as Drug dashboard
- [ ] **HSOC response block**: Shows response signal below map (not a success metric)
- [ ] **Docked detail panel**: Shows when cell selected (PR #32)
- [ ] **Cross-street search**: Search input finds locations (PR #33)
- [ ] **Deep-link**: URL params for window + pinned cell
- [ ] **Methodology**: Sources, exclusions (Needles, human/animal waste)
- [ ] **No console errors**

### Data parity
- [ ] Success card numbers match aggregates.json

---

## Theft Dashboard (`/theft/index.html`)

### Features
- [ ] **District selection**: Cards for each district
- [ ] **Reported vs cleared toggles**: Switch between views
- [ ] **Chart renders**: Monthly trend chart
- [ ] **Methodology section**: Query links
- [ ] **No console errors**

---

## Hypothesis Tool (`/hypothesis/index.html`)

### Features
- [ ] **Data point dropdown**: Select what to measure (drug, overflow, etc.)
- [ ] **Intervention date picker**: Set the date of intervention
- [ ] **Location picker map**: Click/drag to set pin location
- [ ] **Radius slider**: Adjust search radius
- [ ] **Run button**: Executes live Socrata query
- [ ] **Results render**: Verdict, stat cards, chart, event map
- [ ] **Date range slider**: Dual-thumb to adjust analysis window
- [ ] **Shareable URL**: Copy link button copies state to clipboard
- [ ] **Save dialog**: Saves hypothesis to interventions API
- [ ] **Methodology**: Shows exact query links
- [ ] **No console errors**

### Data parity
- [ ] Live query results match direct Socrata API call

---

## Cross-Dashboard Checks

### Theme
- [ ] **Light/dark toggle**: Works on all dashboards
- [ ] **OS preference**: Follows system preference by default

### Navigation
- [ ] **Back-home links**: Each sub-dashboard has working back link
- [ ] **Browser back/forward**: History navigation works correctly
- [ ] **Deep-links**: Shared URLs restore full state

### Performance
- [ ] **Initial load**: < 3s on fast connection
- [ ] **No layout shift**: Content doesn't jump after load

---

## Automated Test Coverage

| Dashboard | Spec File | Key Assertions |
|-----------|-----------|----------------|
| Homepage | `districts/tests/smoke.spec.js` | Cards render, tabs work |
| Drug | `drug/tests/e2e.spec.js` | V7 data parity, scrubber, See details |
| Unhoused | `unhoused/tests/e2e.spec.js` | Cards, chart, map, TOD filter, See details |
| Validation | `validation/validate_build.py` | Build invariants |
| Parity | `validation/parity.mjs` | Classifier parity |

Run all tests:
```bash
npm test
# or individually:
npx playwright test drug/tests/
npx playwright test unhoused/tests/
python validation/validate_build.py
node validation/parity.mjs
```

---

## PR Checklist Template

When creating a PR, include:

```markdown
## Test Plan

### What changed
- [ ] List the features/files modified

### Manual testing performed
- [ ] Which checklist items from TESTPLAN.md were verified
- [ ] Environment tested against (local build, etc.)

### Automated tests
- [ ] New/updated tests added for changes
- [ ] Full suite passes: `npm test`

### Data verification
- [ ] UI values match source JSON where applicable
```
