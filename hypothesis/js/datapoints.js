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

// SFPD Incident Reports (wg3w-h783) row → normalized event. A different shape
// than 311/CFS: geo is `point`, date is `incident_datetime`, and a single
// incident can span multiple rows, so we dedupe on incident_id (soda.js dedups
// by the returned `id`). Counts each incident once.
const SELECT_SFPD = 'incident_datetime, incident_id, incident_subcategory, incident_description, intersection, point';
const mapSFPD = r => {
  const c = r.point?.coordinates ?? [null, null];
  const dt = r.incident_datetime ?? null;
  return {
    datetime: dt,
    day: dt ? dt.slice(0, 10) : null,
    ym: dt ? dt.slice(0, 7) : null,
    id: r.incident_id ?? null,
    place: r.intersection ?? '(unknown location)',
    lat: c[1], lng: c[0],
    notes: r.incident_description || r.incident_subcategory || '',
  };
};

// Report-approval lag for SFPD incident reports. Unlike 311/CFS (creation-
// stamped, no lag), incidents only appear after supervisor approval, so the
// most recent months undercount. The theft dashboard MEASURED this at ~2 months
// for theft-family crimes (theft/build/build.py). We can't measure it live, so
// we carry it as a fixed caveat, surfaced only when the analysis window touches
// those still-settling recent months.
const SFPD_SETTLE = {
  lagMonths: 2,
  note: 'SFPD incident reports appear only after supervisor approval, so the most recent ~2 months are still settling and undercount. A drop at the trailing (right) edge of the timeline may reflect this reporting lag, not a real decline.',
};

// SF Fire/EMS Dispatched Calls (nuek-vuh3) row → event. There are multiple
// unit-rows per call; the signalWhere keeps only the first-dispatched unit
// (unit_sequence_in_call_dispatch = 1) so each call is a single row server-side.
// Geo is case_location (intersection/call-box level). Real-time — no settle lag.
const SELECT_EMS = 'call_number, received_dttm, call_type, call_type_group, address, case_location';
const mapEMS = r => {
  const c = r.case_location?.coordinates ?? [null, null];
  const dt = r.received_dttm ?? null;
  return {
    datetime: dt,
    day: dt ? dt.slice(0, 10) : null,
    ym: dt ? dt.slice(0, 7) : null,
    id: r.call_number ?? null,
    place: r.address ?? '(unknown location)',
    lat: c[1], lng: c[0],
    notes: r.call_type_group ? `${r.call_type} — ${r.call_type_group}` : (r.call_type || ''),
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

  // ── 911 mental-health crisis calls (CFS, same shape as drug/homeless) ──
  {
    key: 'mental_health',
    label: 'Reduce mental-health crisis calls',
    title: 'Mental-health crisis calls',
    noun: 'mental-health crisis call',
    description:
      '911 "Mentally Disturbed" dispatch calls (including the critical variant) — community/police-reported ' +
      'mental-health crises. This measures 911 crisis-response DEMAND, not the clinical prevalence of mental ' +
      'illness. Interpret direction with care: a drop can mean fewer crises, or calls routed to non-police ' +
      'crisis teams (e.g. the Street Crisis Response Team) — a good outcome via a different mechanism.',
    dataset: '2zdj-bwza',
    dateCol: 'received_datetime',
    geoCol: 'intersection_point',
    select: SELECT_CFS,
    signalWhere: "call_type_final_desc IN ('MENTALLY DISTURBED','MENTALLY DIST CRIT') AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL",
    filterDesc: "SFPD 911 Calls for Service. Community-reported (onview_flag N or HSOC) 'Mentally Disturbed' calls, including the critical variant; SF-flagged duplicate calls (dup_cad_number) excluded. Measures 911 crisis-response demand, not the clinical prevalence of mental illness. 'Well being check' and 'Person down' are deliberately excluded — they're mostly generic welfare/triage, not mental-health-specific.",
    mapRow: mapCFS,
  },

  {
    key: 'medical_emergencies',
    label: 'Reduce life-threatening medical emergencies',
    title: 'Potentially life-threatening medical emergencies',
    noun: 'life-threatening medical call',
    description:
      'SF Fire/EMS 911 "Medical Incident" dispatches graded Potentially Life-Threatening — acute medical ' +
      'emergencies (cardiac, trauma, overdoses, and more), one row per call, geolocated to the intersection/' +
      'call-box. This is an ALL-CAUSE signal, NOT overdose-specific: overdoses are only ~2.4% of medical 911 ' +
      'calls citywide and cannot be isolated in this data. Updated daily (no reporting lag).',
    dataset: 'nuek-vuh3',
    dateCol: 'received_dttm',
    geoCol: 'case_location',
    select: SELECT_EMS,
    signalWhere: "call_type = 'Medical Incident' AND call_type_group = 'Potentially Life-Threatening' AND unit_sequence_in_call_dispatch = 1",
    filterDesc: "SF Fire Department & EMS Dispatched Calls for Service. 'Medical Incident' dispatches graded 'Potentially Life-Threatening', limited to the first-dispatched unit (unit_sequence_in_call_dispatch = 1) so each 911 call counts once. Locations are intersection/call-box level (addresses obfuscated for caller privacy). All-cause acute medical — not overdose-specific.",
    mapRow: mapEMS,
  },

  // ── 311 single-service signals ──
  {
    key: 'encampments',
    label: 'Reduce encampments',
    title: 'Encampment reports',
    noun: 'encampment report',
    description:
      '311 Encampment reports — community reports of tents/structures. Includes homelessness requests ' +
      'rerouted to "General Request" after SF\'s June-2025 category change (unioned in, so the series stays ' +
      'continuous instead of showing an artificial drop). This is the encampment slice of "homelessness presence".',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere: "(service_name IN ('Encampment','Encampments') OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'))",
    filterDesc: "SF 311 Encampment reports (tents/structures), unioned with post-June-2025 homelessness requests rerouted to 'General Request' (service_subtype contains 'homeless') so the count stays continuous across the reroute.",
    mapRow: map311,
  },

  {
    key: 'graffiti',
    label: 'Reduce graffiti',
    title: 'Graffiti reports',
    noun: 'graffiti report',
    description:
      'SF 311 graffiti reports across public and private property (the Graffiti, Graffiti Public, and ' +
      'Graffiti Private service categories). A community/DPW-reported vandalism signal.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere: "service_name IN ('Graffiti','Graffiti Public','Graffiti Private')",
    filterDesc: "SF 311 graffiti reports — the Graffiti, Graffiti Public, and Graffiti Private service categories combined.",
    mapRow: map311,
  },

  {
    key: 'noise',
    label: 'Reduce noise complaints',
    title: 'Noise complaints',
    noun: 'noise complaint',
    description:
      'SF 311 noise complaints (the Noise Report and Noise service categories). Community-reported noise ' +
      'nuisance — useful for testing whether an intervention reduced noise complaints nearby.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere: "service_name IN ('Noise Report','Noise')",
    filterDesc: "SF 311 noise complaints — the Noise Report and Noise service categories combined.",
    mapRow: map311,
  },

  {
    key: 'lighting',
    label: 'Improve lighting',
    title: 'Streetlight reports',
    noun: 'streetlight report',
    description:
      'SF 311 Streetlights reports — outages and repair requests for public street lighting. A proxy for ' +
      'lighting conditions: fewer open reports suggests lights are being fixed / staying lit.',
    dataset: 'vw6y-z8j6',
    dateCol: 'requested_datetime',
    geoCol: 'point',
    select: SELECT_311,
    signalWhere: "service_name = 'Streetlights'",
    filterDesc: "SF 311 Streetlights reports — outages and repair requests for public street lighting.",
    mapRow: map311,
  },

  // ── SFPD Incident Reports (wg3w-h783) — reported crime, settles ~2 months ──
  {
    key: 'shoplifting',
    label: 'Reduce shoplifting',
    title: 'Shoplifting incidents',
    noun: 'shoplifting report',
    description:
      'SFPD reported shoplifting — incident reports in the "Larceny Theft - Shoplifting" subcategory. ' +
      'Victim/officer-reported crime (not a 311 complaint). Recent months undercount until reports clear approval.',
    dataset: 'wg3w-h783',
    dateCol: 'incident_datetime',
    geoCol: 'point',
    select: SELECT_SFPD,
    signalWhere: "incident_subcategory = 'Larceny Theft - Shoplifting'",
    filterDesc: "SFPD Incident Reports. Incidents in the 'Larceny Theft - Shoplifting' subcategory, each counted once (deduped by incident_id).",
    settle: SFPD_SETTLE,
    mapRow: mapSFPD,
  },

  {
    key: 'street_robbery',
    label: 'Reduce street robbery',
    title: 'Street robbery incidents',
    noun: 'street-robbery report',
    description:
      'SFPD reported street robbery — incident reports in the "Robbery - Street" subcategory (robbery in a ' +
      'public way, distinct from commercial or residential). Victim/officer-reported crime. Recent months undercount until reports clear approval.',
    dataset: 'wg3w-h783',
    dateCol: 'incident_datetime',
    geoCol: 'point',
    select: SELECT_SFPD,
    signalWhere: "incident_subcategory = 'Robbery - Street'",
    filterDesc: "SFPD Incident Reports. Incidents in the 'Robbery - Street' subcategory, each counted once (deduped by incident_id).",
    settle: SFPD_SETTLE,
    mapRow: mapSFPD,
  },

  {
    key: 'commercial_burglary',
    label: 'Reduce commercial burglary',
    title: 'Commercial burglary incidents',
    noun: 'commercial-burglary report',
    description:
      'SFPD reported commercial burglary — incident reports in the "Burglary - Commercial" subcategory ' +
      '(break-ins at businesses). Victim/officer-reported crime. Recent months undercount until reports clear approval.',
    dataset: 'wg3w-h783',
    dateCol: 'incident_datetime',
    geoCol: 'point',
    select: SELECT_SFPD,
    signalWhere: "incident_subcategory = 'Burglary - Commercial'",
    filterDesc: "SFPD Incident Reports. Incidents in the 'Burglary - Commercial' subcategory, each counted once (deduped by incident_id).",
    settle: SFPD_SETTLE,
    mapRow: mapSFPD,
  },
];

export const getDataPoint = key => DATAPOINTS.find(d => d.key === key) || LEVERS.find(d => d.key === key) || DATAPOINTS[0];

// Levers (expected changes) offered in the intervention form. Every lever is
// now a fully-wired DATAPOINTS entry with a live Socrata query — no label-only
// stubs. History (see levers-audit.md): the no-clean-source options (fraud,
// animal_incidents, public_safety, public_space) were removed on 2026-07-13,
// and `cleanliness` was dropped (composite; overlaps overflow/dumping/hazard and
// is scoped to the standalone cleanliness project instead).
export const LEVERS = [...DATAPOINTS];
