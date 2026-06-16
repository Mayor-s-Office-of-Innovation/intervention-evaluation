# Hypothesis testing tool

Aggregate and filter underlying data to allow pod leaders to quickly understand effects of interventions.

Always show the data sources and queries used so analysis is reproducible.

## How to run locally

```
npm install
npm run dev      # serves this directory on http://localhost:8090
```

Or without installing anything:

```
npx http-server . -p 8090 -c-1
```

The app is fully static — it loads its libraries from CDNs and queries live SF
OpenData (Socrata) directly from the browser, so there is no build step.

## Tests

```
npm test         # Playwright e2e suite (hits the live Socrata API)
```

## Deploy

Pushing to `main` deploys to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

### Adding a new dashboard

Each dashboard is a self-contained subdirectory (`districts/`, `theft/`,
`unhoused/`, `drug/`, …) with an identical static layout:

- `index.html` + `styles.css` — the page the browser loads
- `js/*.js` — frontend logic
- `data/` — pre-baked JSON the browser fetches
- `build/` — **offline** Python that generates `data/`; intentionally *not* shipped

The deploy workflow loops over the project list and stages each one that has an
`index.html`, copying its `index.html`, `styles.css`, `js/*.js`, and `data/`. A
project with no `index.html` yet is skipped, so it's safe to commit a planning
stub (e.g. `drug/plan.md`) before the dashboard exists.

**To ship a new dashboard:** create `<project>/index.html` and add `<project>`
to the `for project in …` list in [`deploy.yml`](.github/workflows/deploy.yml).

## Background

See [PLAN.md](PLAN.md) for the design and [`spce-self-hypothesis-test.md`](spce-self-hypothesis-test.md) for the source brief.