#!/usr/bin/env node
// CI gate: fails the build if a schedule file is broken.
// Run locally with `npm run validate`.
import { readFileSync, existsSync } from 'fs';
import { validate, SCHEMA_VERSION } from '../core.js';

const args = process.argv.slice(2);
const targets = args.length ? args : ['overrides.json'];
let failed = false;

for (const file of targets) {
  if (!existsSync(file)) { console.log(`• ${file} — not present, skipping`); continue; }
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error(`✗ ${file} — not valid JSON: ${e.message}`); failed = true; continue; }

  const { errs, warns } = validate(data);
  const n = Object.keys(data.schools || {}).length;
  console.log(`\n${file} — ${n} school${n === 1 ? '' : 's'}, schema v${data.version ?? '?'} (code understands v${SCHEMA_VERSION})`);
  warns.forEach(w => console.log(`  ! ${w}`));
  errs.forEach(e => console.error(`  ✗ ${e}`));
  if (errs.length) failed = true; else console.log('  ✓ valid');
}

if (failed) { console.error('\nValidation failed.'); process.exit(1); }
console.log('\nAll files valid.');
