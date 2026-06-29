// ──────────────────────────────────────────────────────────────────────
// Vetted data points — the registry behind the "What do you expect to
// change?" dropdown. Each entry is a self-contained analysis definition:
// label + description (for users) + a pre-built Socrata query + a row→event
// mapper. Adding a new effect to the tool = adding one entry here.
//
// All litter filters are normalized across SF 311's 2024-06-13 taxonomy
// migration (Title Case → snake_case) via lower(...) LIKE matching, so the
// time series stays continuous across that date.
// ──────────────────────────────────────────────────────────────────────

// drug-note tokens for the 911 signal (broadened past literal "DRUGS")
const DRUG_TOKENS = ['DRUG', 'DEALER', 'SALES', 'METH'];
const drugNotes = DRUG_TOKENS
  .flatMap(t => [`upper(call_type_original_notes) LIKE '%${t}%'`, `upper(call_type_final_notes) LIKE '%${t}%'`])
  .join(' OR ');

// helper: build an OR clause of lower(service_details) LIKE '%token%'
const detailsLike = tokens => tokens.map(t => `lower(service_details) LIKE '%${t}%'`).join(' OR ');

// 311 row → normalized event
const map311 = r => {
  const dt = r.requested_datetime ?? null;
  return {
    datetime: dt,
    day: dt ? dt.slice(0, 10) : null,
    ym: dt ? dt.slice(0, 7) : null,
    id: r.service_request_id ?? null,
    place: r.address ?? '(unknown location)',
    lat: r.lat != null ? +r.lat : null,
    lng: r.long != null ? +r.long : null,
    notes: (r.service_details ?? '').replace(/_/g, ' '),
  };
};

const SELECT_311 = 'service_request_id, requested_datetime, address, service_details, lat, long';
const CLEANING = "service_name='Street and Sidewalk Cleaning'";

// 911 CFS row → normalized event (popup shows the call type + any notes)
const SELECT_CFS = 'cad_number, received_datetime, intersection_name, intersection_point, call_type_final_desc, call_type_original_notes, call_type_final_notes';
const mapCFS = r => {
  const c = r.intersection_point?.coordinates ?? [null, null];
  const dt = r.received_datetime ?? null;
  const notes = r.call_type_final_notes || r.call_type_original_notes || '';
  return {
    datetime: dt,
    day: dt ? dt.slice(0, 10) : null,
    ym: dt ? dt.slice(0, 7) : null,
    id: r.cad_number ?? null,
    place: r.intersection_name ?? '(unknown location)',
    lat: c[1], lng: c[0],
    notes: r.call_type_final_desc ? (notes ? `${r.call_type_final_desc} — ${notes}` : r.call_type_final_desc) : notes,
  };
};

export const DATAPOINTS = [
  {
    key: 'drug',
    label: 'Reduce drug-related activity',
    title: 'Drug-related complaints',
    noun: 'drug-related complaint',
    description:
      '911 dispatched "Suspicious Person" calls whose dispatcher notes mention drugs (DRUG / DEALER / SALES / METH). ' +
      'The cleanest community-reported drug-activity signal in SF OpenData — community concern, not enforcement.',
    dataset: '2zdj-bwza',
    dateCol: 'received_datetime',
    geoCol: 'intersection_point',
    select: 'received_datetime, intersection_name, intersection_point, call_type_original_notes, call_type_final_notes',
    signalWhere: `call_type_final_desc = 'SUSPICIOUS PERSON' AND onview_flag IN ('N','HSOC') AND (${drugNotes})`,
    filterDesc: "SFPD 911 Calls for Service. Community-reported 'Suspicious Person' calls (onview_flag N or HSOC) whose dispatcher notes mention DRUG, DEALER, SALES or METH.",
    mapRow: r => {
      const c = r.intersection_point?.coordinates ?? [null, null];
      const dt = r.received_datetime ?? null;
      return {
        datetime: dt,
        day: dt ? dt.slice(0, 10) : null,
        ym: dt ? dt.slice(0, 7) : null,
        place: r.intersection_name ?? '(unknown location)',
        lat: c[1], lng: c[0],
        notes: r.call_type_final_notes || r.call_type_original_notes || '',
      };
    },
  },

  {
    key: 'overflow',
    label: 'Reduce overflowing trash cans',
    title: 'Overflowing trash cans',
    noun: 'overflowing-can report',
    description:
      'SF 311 "Street and Sidewalk Cleaning" reports of overflowing public garbage cans, receptacles, or dumpsters. ' +
      'A pure DPW servicing signal — useful for testing whether added pickups or new bins reduced overflow complaints.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere: `${CLEANING} AND (lower(service_details) LIKE '%overflow%')`,
    filterDesc: "SF 311 Street & Sidewalk Cleaning reports whose detail mentions 'overflow' (overflowing public cans, receptacles, or dumpsters). Matches both pre- and post-2024 label spellings.",
    // Known structural break in the underlying reporting (see PLAN.md §8.5). Surfaced as a
    // chart marker + verdict warning only when the analysis window crosses the date.
    breaks: [{
      date: '2025-11-01',
      label: 'sensor reports end',
      detail: "DPW's Nordsense contract ended after Nov 2025, so in-can sensors stopped auto-filing " +
        "overflow service requests — removing ~75% of reports citywide (machine-generated, not " +
        "resident-reported). Confirmed by SF 311 data supervisor Bryan Wong. Counts before and after " +
        "this date aren't comparable: a drop here reflects the sensors going offline, not less overflow.",
    }],
    mapRow: map311,
  },

  {
    key: 'dumping',
    label: 'Reduce illegal dumping',
    title: 'Illegal dumping',
    noun: 'illegal-dumping report',
    description:
      'SF 311 reports of large-item illegal dumping — furniture, mattresses, appliances, electronics, tires, plus ' +
      'explicit "illegal dumping" reports. Concentrated in southern/industrial districts (Bayview, Excelsior). ' +
      'No single 311 field captures dumping, so this combines the bulky-item details with the dumping labels.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere:
      `${CLEANING} AND (` +
      detailsLike(['furniture', 'mattress', 'appliance', 'refriger', 'electronic', 'tire', 'illegal_dumping', 'illegal dumping', 'bulky']) +
      ` OR lower(service_subtype)='bulky items')`,
    filterDesc: "SF 311 Street & Sidewalk Cleaning reports for bulky dumped items — furniture, mattresses, appliances/refrigerators, electronics, tires — plus records labeled illegal dumping or bulky. Matches both label spellings.",
    mapRow: map311,
  },

  {
    key: 'hazard',
    label: 'Reduce health-hazard waste',
    title: 'Health-hazard waste',
    noun: 'health-hazard report',
    description:
      'SF 311 health-hazard waste: human/animal waste & urine (where feces and vomit are recorded), needles/syringes, ' +
      'oil & liquid spills, and hazardous/medical waste. These are DPW\'s priority cleanups. Note: 311 cannot isolate ' +
      'blood (no dedicated code) and bundles feces with urine/animal waste.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere:
      `${CLEANING} AND (` +
      detailsLike(['human', 'urine', 'fece', 'needle', 'syringe', 'oil', 'hazard', 'medical', 'biohaz']) +
      `)`,
    filterDesc: "SF 311 Street & Sidewalk Cleaning reports of human waste/urine, needles/syringes, oil & liquid spills, and hazardous/medical waste. Matches both label spellings.",
    mapRow: map311,
  },

  // ── Homelessness (aggregate, multi-source) ──
  {
    key: 'homeless_presence',
    label: 'Reduce homelessness presence',
    title: 'Homelessness presence',
    noun: 'homelessness report',
    description:
      'Aggregate of community reports indicating unhoused presence: 311 Encampment reports plus 911 Sit/Lie ' +
      'Enforcement, Blocked Sidewalk, and Homeless Complaint calls (community-reported), combined across the two ' +
      'reporting systems with each record counted once.',
    sources: [
      {
        dataset: '2zdj-bwza',
        dateCol: 'received_datetime',
        geoCol: 'intersection_point',
        select: SELECT_CFS,
        signalWhere: "call_type_final_desc IN ('SIT/LIE ENFORCEMENT','BLOCKED SIDEWALK','HOMELESS COMPLAINT') AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL",
        filterDesc: "SFPD 911 Calls for Service. Community-reported (onview_flag N or HSOC) Sit/Lie Enforcement, Blocked Sidewalk, and Homeless Complaint calls. SF-flagged duplicate calls (dup_cad_number) are excluded. Trespasser is deliberately omitted — it's only ~7% homeless-related.",
        mapRow: mapCFS,
      },
      {
        dataset: 'vw6y-z8j6',
        dateCol: 'requested_datetime',
        geoCol: 'point',
        select: SELECT_311,
        signalWhere: "service_name IN ('Encampment','Encampments')",
        filterDesc: "SF 311 Encampment reports — community reports of tents/structures.",
        mapRow: map311,
      },
    ],
  },
];

export const getDataPoint = key => DATAPOINTS.find(d => d.key === key) || LEVERS.find(d => d.key === key) || DATAPOINTS[0];

// Extended list of levers (expected changes) for the intervention form
// Includes all DATAPOINTS plus additional common intervention outcomes
export const LEVERS = [
  ...DATAPOINTS,
  // Additional levers not in DATAPOINTS
  { key: 'encampments', label: 'Reduce encampments' },
  { key: 'animal_incidents', label: 'Reduce animal incidents' },
  { key: 'fraud', label: 'Reduce fraud' },
  { key: 'street_robbery', label: 'Reduce street robbery' },
  { key: 'shoplifting', label: 'Reduce shoplifting' },
  { key: 'commercial_burglary', label: 'Reduce commercial burglary' },
  { key: 'graffiti', label: 'Reduce graffiti' },
  { key: 'noise', label: 'Reduce noise complaints' },
  { key: 'public_safety', label: 'Improve public safety' },
  { key: 'cleanliness', label: 'Improve cleanliness' },
  { key: 'lighting', label: 'Improve lighting' },
  { key: 'public_space', label: 'Increase public space use' },
];
