#!/usr/bin/env node
/* Regression tests for the scheduling rules. Run with `npm test`. */
import { snapshot, validate, cycleDayFor, resolveDay, periodsFor, rangeLabel, minutesLabel } from '../core.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const is = (got, want, label) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.error(`✗ ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const ok = (cond, label) => is(Boolean(cond), true, label);

const data = JSON.parse(readFileSync(new URL('../overrides.json', import.meta.url)));
const S = Object.keys(data.schools)[0];

/* --- real data --- */
// Derived from the data rather than hardcoded, so renaming a template or a
// period cannot break the suite.
const atNoonish = t => snapshot(data, S, t, new Date('2026-10-12T16:52:00Z'));
ok(/lunch/i.test(atNoonish('A').period), 'A track is at lunch at 11:52');
ok(!/lunch/i.test(atNoonish('B').period), 'B track is in class at 11:52');
ok(atNoonish('A').period !== atNoonish('B').period, 'the two tracks differ at 11:52');
is(snapshot(data, S, 'A', new Date('2026-10-11T16:00:00Z')).period, 'No school scheduled', 'Sunday is empty');
is(snapshot(data, S, 'A', new Date('2026-10-12T19:58:30Z')).state, 'yellow', '6:30 left is yellow');
is(snapshot(data, S, 'A', new Date('2026-10-12T20:01:00Z')).state, 'red', '4 min left is red');
is(snapshot(data, S, 'Z', new Date('2026-10-12T16:52:00Z')).activeTrack, 'A', 'unknown track falls back to the first');
ok(snapshot(data, 'no-such-school', 'A').missingSchool, 'unknown school reports missing');

/* --- labels --- */
is(rangeLabel(8 * 3600 + 15 * 60, 9 * 3600 + 5 * 60), '8:15 – 9:05 AM', 'shared meridiem collapses');
is(rangeLabel(11 * 3600 + 40 * 60, 12 * 3600 + 10 * 60), '11:40 AM – 12:10 PM', 'crossing noon keeps both');
is(minutesLabel(272), { v: '5', u: 'min' }, '4:32 rounds up to 5 min');
is(minutesLabel(1), { v: '1', u: 'min' }, 'final second still reads 1');
is(minutesLabel(4500), { v: '1:15', u: 'hr' }, 'over an hour switches units');

/* --- rotation --- */
const rot = {
  name: 'Rot', timezone: 'America/Chicago',
  rotation: { start: '2026-10-05', days: ['Day 1', 'Day 2', 'Day 3'], map: { 'Day 1': 'd', 'Day 2': 'd', 'Day 3': 'd' } },
  dates: { '2026-10-07': 'off' },
  templates: { d: { label: 'D', periods: [{ name: '1st', start: '08:00', end: '08:50', track: 'both' }] }, off: { label: 'Off', periods: [] } }
};
is(cycleDayFor(rot, '2026-10-05'), 'Day 1', 'cycle starts at Day 1');
is(cycleDayFor(rot, '2026-10-06'), 'Day 2', 'cycle advances');
is(cycleDayFor(rot, '2026-10-08'), 'Day 3', 'no-school day does not consume a slot');
is(cycleDayFor(rot, '2026-10-12'), 'Day 2', 'weekend is skipped');

/* --- DST and zones --- */
const az = JSON.parse(JSON.stringify(data));
az.schools[S].timezone = 'America/Phoenix';
ok(snapshot(az, S, 'A', new Date('2026-10-12T16:52:00Z')).iso === '2026-10-12', 'Arizona resolves a date');
const springForward = snapshot(data, S, 'A', new Date('2027-03-14T14:00:00Z')); // DST change day
ok(springForward.iso === '2027-03-14', 'spring-forward Sunday still resolves');

/* --- validation --- */
is(validate(data).errs, [], 'live file has no errors');
const broken = JSON.parse(JSON.stringify(data));
const firstTpl = Object.keys(broken.schools[S].templates).find(
  t => (broken.schools[S].templates[t].periods || []).length);
broken.schools[S].templates[firstTpl].periods.push(
  { name: 'Clash', start: '08:30', end: '09:00', track: 'both' });
ok(validate(broken).errs.some(e => /overlap/.test(e)), 'overlap on the same track is an error');
ok(Object.keys(data.schools).length >= 1, 'the live file has at least one school');
const crossTrack = JSON.parse(JSON.stringify(data));
ok(!validate(crossTrack).errs.some(e => /overlap/.test(e)), 'A and B overlapping each other is allowed');
const badDate = JSON.parse(JSON.stringify(data));
badDate.schools[S].dates['not-a-date'] = 'tchs-monday';
ok(validate(badDate).errs.some(e => /not a valid date/.test(e)), 'bad date key is caught');
const badTz = JSON.parse(JSON.stringify(data));
badTz.schools[S].timezone = 'Mars/Olympus';
ok(validate(badTz).errs.some(e => /time zone/.test(e)), 'bad time zone is caught');
ok(validate({ schools: {} }).errs.length, 'empty file is an error');
ok(validate(null).errs.length, 'null is an error');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
