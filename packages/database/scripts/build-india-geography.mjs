#!/usr/bin/env node
// Builds prisma/data/india-geography.json — every district and every urban
// local body (municipal corporation, municipality, nagar panchayat, ...)
// in India — from Local Government Directory (lgdirectory.gov.in) CSVs.
//
// The daily LGD snapshots are archived at
// https://github.com/ramSeraph/opendata/releases/tag/lgd-latest. Download
// these four for the same date and extract them (7-Zip) into one folder:
//   states.<date>.csv.7z, districts.<date>.csv.7z,
//   urban_local_bodies.<date>.csv.7z, statewise_ulbs_coverage.<date>.csv.7z
//
// Usage: node scripts/build-india-geography.mjs <folder-with-extracted-csvs>
//
// LGD does not list a district on an urban local body, so each one is
// placed in the district that holds most of the villages/wards it covers.
// Bodies with no coverage rows yet (newly notified) are skipped and listed.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDir = process.argv[2];
if (!sourceDir) {
  console.error('Usage: node scripts/build-india-geography.mjs <folder-with-extracted-lgd-csvs>');
  process.exit(1);
}

const outputFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'data',
  'india-geography.json',
);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((value) => value.trim() !== ''));
  const keys = header.map((key) => key.replace(/^\uFEFF/, '').trim());
  return body.map((values) =>
    Object.fromEntries(keys.map((key, index) => [key, (values[index] ?? '').trim()])),
  );
}

function readComponent(component) {
  const files = readdirSync(sourceDir).filter(
    (name) => name.startsWith(`${component}.`) && name.endsWith('.csv'),
  );
  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one ${component}.<date>.csv in ${sourceDir}, found ${files.length}.`,
    );
  }
  const date = files[0].slice(component.length + 1, -'.csv'.length);
  return { date, rows: parseCsv(readFileSync(path.join(sourceDir, files[0]), 'utf8')) };
}

// LGD names are mostly title case; a few arrive in capitals or with stray
// spacing around a disambiguating "(District)".
function cleanName(raw) {
  let name = raw.replace(/\s+/g, ' ').trim();
  name = name.replace(/[\s.]*\(\s*/g, ' (').replace(/\s*\)/g, ')');
  if (name === name.toUpperCase() && /[A-Z]{3}/.test(name)) {
    name = name
      .toLowerCase()
      .replace(/(^|[\s(-])([a-z])/g, (_m, sep, letter) => sep + letter.toUpperCase());
  }
  return name;
}

const normalized = (name) => name.trim().toLowerCase();

const states = readComponent('states');
const districts = readComponent('districts');
const ulbs = readComponent('urban_local_bodies');
const coverage = readComponent('statewise_ulbs_coverage');
const dates = new Set([states.date, districts.date, ulbs.date, coverage.date]);
if (dates.size !== 1)
  throw new Error(`LGD files are from different dates: ${[...dates].join(', ')}.`);
const [snapshotLabel] = dates;
const snapshot = new Date(
  `${snapshotLabel.slice(0, 2)} ${snapshotLabel.slice(2, 5)} ${snapshotLabel.slice(5)} UTC`,
)
  .toISOString()
  .slice(0, 10);

const stateNameByCode = new Map(
  states.rows.map((r) => [r['State Code'], cleanName(r['State Name (In English)'])]),
);

const districtByCode = new Map();
for (const r of districts.rows) {
  const stateName = stateNameByCode.get(r['State Code']);
  if (!stateName)
    throw new Error(`District ${r['District Code']} has unknown state ${r['State Code']}.`);
  districtByCode.set(r['District Code'], {
    stateName,
    name: cleanName(r['District Name(In English)']),
  });
}

const districtVotes = new Map();
for (const r of coverage.rows) {
  const votes = districtVotes.get(r['Local Body Code']) ?? new Map();
  votes.set(r['District Code'], (votes.get(r['District Code']) ?? 0) + 1);
  districtVotes.set(r['Local Body Code'], votes);
}

const output = {};
for (const { stateName, name } of districtByCode.values()) {
  output[stateName] ??= {};
  output[stateName][name] ??= [];
}

const skipped = [];
for (const r of ulbs.rows) {
  const votes = districtVotes.get(r['Local Body Code']);
  if (!votes) {
    skipped.push(`${r['State Name']} / ${r['Local Body Name (In English)']}`);
    continue;
  }
  const [districtCode] = [...votes.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  const district = districtByCode.get(districtCode);
  if (!district)
    throw new Error(`Local body ${r['Local Body Code']} maps to unknown district ${districtCode}.`);
  const cities = output[district.stateName][district.name];
  const name = cleanName(r['Local Body Name (In English)']);
  if (!cities.some((existing) => normalized(existing) === normalized(name))) cities.push(name);
}

const sorted = {};
let districtCount = 0;
let cityCount = 0;
for (const stateName of Object.keys(output).sort()) {
  sorted[stateName] = {};
  for (const districtName of Object.keys(output[stateName]).sort()) {
    const cities = output[stateName][districtName].sort((a, b) => a.localeCompare(b));
    sorted[stateName][districtName] = cities;
    districtCount += 1;
    cityCount += cities.length;
  }
}

const document = {
  source:
    'Local Government Directory (lgdirectory.gov.in), via github.com/ramSeraph/opendata lgd-latest',
  snapshot,
  note: 'Cities are LGD urban local bodies, placed in the district covering most of their area. Generated by scripts/build-india-geography.mjs — do not edit by hand.',
  states: sorted,
};

writeFileSync(outputFile, `${JSON.stringify(document, null, 1)}\n`);
console.log(
  `Wrote ${outputFile}: ${Object.keys(sorted).length} states, ${districtCount} districts, ${cityCount} cities (LGD ${snapshot}).`,
);
if (skipped.length > 0)
  console.log(
    `Skipped ${skipped.length} local bodies with no LGD coverage yet: ${skipped.join('; ')}`,
  );
