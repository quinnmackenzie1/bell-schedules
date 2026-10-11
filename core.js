/* =====================================================================
   Bell Clock core — the ONE copy of the scheduling rules.
   Pure functions only: no DOM, no chrome.*, no fetch. Everything else
   (extension, web clock, editor, CI validator) builds on this file so the
   four can never disagree about what period it is.
   Edit this file, then run `node scripts/build.mjs`.
   ===================================================================== */

export const SCHEMA_VERSION = 1;
export const TRACK_LETTERS = ['A', 'B', 'C'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEKDAY_BY_INDEX = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86400000;

// Periods matching this show gray rather than counting down in color.
const UNTIMED = /break|passing/i;

/* ---------------- time ---------------- */
export function toSec(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return (h > 23 || mi > 59) ? null : h * 3600 + mi * 60;
}
export function toHHMM(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}
export function labelTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
export function rangeLabel(a, b) {
  const A = labelTime(a), B = labelTime(b);
  return A.slice(-2) === B.slice(-2) ? A.slice(0, -3) + ' \u2013 ' + B : A + ' \u2013 ' + B;
}
export function ordinal(n) {
  return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
}
export function minutesLabel(sec) {
  const m = Math.max(0, Math.ceil(sec / 60));
  if (m >= 60) return { v: Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0'), u: 'hr' };
  return { v: String(m), u: 'min' };
}

/* ---------------- dates ---------------- */
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}
export function isoOf(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
export function weekdayOf(iso) {
  const ms = parseISO(iso);
  return ms === null ? null : WEEKDAY_BY_INDEX[new Date(ms).getUTCDay()];
}

/* ---------------- schools ---------------- */
export function availableTracks(school) {
  const seen = new Set();
  for (const t of Object.values((school || {}).templates || {}))
    for (const p of t.periods || []) if (p.track && p.track !== 'both') seen.add(p.track);
  return TRACK_LETTERS.filter(x => seen.has(x));
}

function hasNoClasses(school, templateId) {
  const t = (school.templates || {})[templateId];
  return !t || !(t.periods || []).length;
}

/**
 * Which cycle day falls on `iso`. The cycle advances on school days only, so
 * weekends and any date assigned a no-class template are stepped over.
 */
export function cycleDayFor(school, iso) {
  const rot = school && school.rotation;
  if (!rot || !rot.start || !Array.isArray(rot.days) || !rot.days.length) return null;
  const start = parseISO(rot.start), target = parseISO(iso);
  if (start === null || target === null || target < start) return null;
  if ((target - start) / DAY_MS > 400) return null;      // stale start date

  let count = 0;
  for (let t = start; t <= target; t += DAY_MS) {
    const wd = new Date(t).getUTCDay();
    const override = (school.dates || {})[isoOf(t)];
    const skip = (wd === 0 || wd === 6) ? !override : (override && hasNoClasses(school, override));
    if (skip) continue;
    if (t === target) return rot.days[count % rot.days.length];
    count++;
  }
  return null;
}

/** Which template a given date resolves to, and why. */
export function resolveDay(school, iso) {
  const weekday = weekdayOf(iso);
  const overrideId = (school.dates || {})[iso];
  const cycleDay = overrideId ? null : cycleDayFor(school, iso);
  const templateId = overrideId
    || (cycleDay ? ((school.rotation.map || {})[cycleDay]) : null)
    || (cycleDay ? null : (school.week || {})[weekday]);
  return {
    weekday,
    isWeekend: weekday === 'Saturday' || weekday === 'Sunday',
    overrideId, cycleDay, templateId,
    template: templateId ? (school.templates || {})[templateId] : null
  };
}

/** The rows a student on `track` should see on `iso`, sorted and sanitized. */
export function periodsFor(school, iso, track) {
  const { template } = resolveDay(school, iso);
  return ((template && template.periods) || [])
    .filter(r => r.track === 'both' || (track && r.track === track))
    .map(r => ({ name: r.name, start: toSec(r.start), end: toSec(r.end) }))
    .filter(r => r.start !== null && r.end !== null && r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

/* ---------------- the one place that decides what is displayed ---------------- */
export function snapshot(data, schoolId, mode, now = new Date()) {
  const school = data && data.schools ? data.schools[schoolId] : null;
  if (!school) return { missingSchool: true };

  const zone = school.timezone || 'America/Chicago';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(x => [x.type, x.value]));
  // en-CA renders YYYY-MM-DD, matching the keys the editor writes.
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);

  const day = resolveDay(school, iso);
  const tracks = availableTracks(school);
  const activeTrack = tracks.length ? (tracks.includes(mode) ? mode : tracks[0]) : null;
  const rows = periodsFor(school, iso, activeTrack);

  const secs = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const current = rows.find(r => secs >= r.start && secs < r.end);
  const next = rows.find(r => r.start > secs);

  let state = 'gray', period, remaining, count, up, left = null;
  if (current) {
    left = current.end - secs;
    state = UNTIMED.test(current.name) ? 'gray' : left <= 300 ? 'red' : left <= 600 ? 'yellow' : 'green';
    period = current.name;
    count = minutesLabel(left);
    remaining = 'TIME REMAINING';
    up = next ? `Up next \u00b7 ${next.name} at ${labelTime(next.start)}` : 'Last period of the day';
  } else if (next) {
    left = next.start - secs;
    period = secs < rows[0].start ? 'Before school' : 'Passing time';
    count = minutesLabel(left);
    remaining = 'UNTIL ' + next.name.toUpperCase();
    up = `${next.name} starts at ${labelTime(next.start)}`;
  } else {
    period = rows.length ? 'School day complete' : 'No school scheduled';
    count = { v: '\u2014', u: '' };
    remaining = rows.length ? 'SEE YOU NEXT SCHOOL DAY' : 'NO CLASSES TODAY';
    up = '';
  }

  let announcement = null;
  const a = school.announcement;
  if (a && a.text && (!a.until || a.until >= iso)) announcement = a.text;

  return {
    schoolName: school.name, zone, parts, iso, secs, rows, current, next,
    state, period, count, remaining, up, left,
    tracks, activeTrack, cycleDay: day.cycleDay, announcement,
    templateLabel: day.template ? day.template.label : null,
    isOverride: Boolean(day.overrideId),
    missingSchool: false
  };
}

/* ---------------- validation ----------------
   Used by the editor, and by CI on every commit, so a broken file cannot
   reach students even if someone edits the JSON by hand. */
export function validate(d) {
  const errs = [], warns = [];
  if (!d || typeof d !== 'object') return { errs: ['File is not a JSON object.'], warns };
  if (d.version && d.version > SCHEMA_VERSION)
    warns.push(`File says version ${d.version}; this code understands ${SCHEMA_VERSION}. Older apps may not read it correctly.`);
  if (!d.schools || typeof d.schools !== 'object') return { errs: ['No "schools" object.'], warns };

  const entries = Object.entries(d.schools);
  if (!entries.length) errs.push('No schools defined.');

  for (const [sid, s] of entries) {
    const who = (s && s.name) || sid;
    if (!s || typeof s !== 'object') { errs.push(`School "${sid}" is not an object.`); continue; }
    if (!s.name || !String(s.name).trim()) errs.push(`School "${sid}" has no name.`);
    if (s.timezone) { try { new Intl.DateTimeFormat('en-US', { timeZone: s.timezone }); }
      catch (e) { errs.push(`${who}: "${s.timezone}" is not a valid time zone.`); } }

    const tpls = Object.entries(s.templates || {});
    if (!tpls.length) warns.push(`${who}: no templates.`);

    for (const [tid, t] of tpls) {
      const label = (t && t.label) || tid;
      const rows = (t && t.periods) || [];
      if (!rows.length) { warns.push(`${who}: "${label}" has no periods — it reads as a no-school day.`); continue; }
      rows.forEach((r, i) => {
        if (!r.name || !String(r.name).trim()) errs.push(`${who} / ${label}: period ${i + 1} has no name.`);
        if (r.track && !['both', ...TRACK_LETTERS].includes(r.track))
          errs.push(`${who} / ${label}: "${r.name}" has unknown track "${r.track}".`);
        const a = toSec(r.start), b = toSec(r.end);
        if (a === null || b === null) errs.push(`${who} / ${label}: "${r.name || 'period ' + (i + 1)}" has an invalid time.`);
        else if (b <= a) errs.push(`${who} / ${label}: "${r.name}" ends before it starts.`);
      });
      for (const track of TRACK_LETTERS) {
        const inTrack = rows
          .filter(r => r.track === 'both' || r.track === track)
          .filter(r => toSec(r.start) !== null && toSec(r.end) !== null)
          .sort((x, y) => toSec(x.start) - toSec(y.start));
        for (let i = 1; i < inTrack.length; i++) {
          if (toSec(inTrack[i].start) < toSec(inTrack[i - 1].end))
            errs.push(`${who} / ${label}: "${inTrack[i - 1].name}" and "${inTrack[i].name}" overlap on track ${track}.`);
        }
      }
    }

    for (const [day, tid] of Object.entries(s.week || {}))
      if (tid && !(s.templates || {})[tid]) errs.push(`${who}: ${day} points at a missing template.`);
    for (const [date, tid] of Object.entries(s.dates || {})) {
      if (parseISO(date) === null) errs.push(`${who}: "${date}" is not a valid date.`);
      if (!(s.templates || {})[tid]) errs.push(`${who}: ${date} points at a missing template.`);
    }

    if (s.rotation && s.rotation.start) {
      if (parseISO(s.rotation.start) === null) errs.push(`${who}: rotation start date is invalid.`);
      const days = s.rotation.days || [];
      if (!days.length) errs.push(`${who}: rotation has no days.`);
      const miss = days.filter(x => !(s.rotation.map || {})[x]);
      if (miss.length) warns.push(`${who}: no template for ${miss.join(', ')}.`);
      for (const [dayName, tid] of Object.entries(s.rotation.map || {}))
        if (!(s.templates || {})[tid]) errs.push(`${who}: ${dayName} points at a missing template.`);
    } else {
      // A rotation with no start date is inert: the school silently falls back
      // to the weekly map, which is almost never what the editor intended.
      if (s.rotation) errs.push(`${who}: the rotating cycle has no start date, so it is being ignored.`);
      const unmapped = WEEKDAYS.filter(x => !(s.week || {})[x]);
      if (unmapped.length) warns.push(`${who}: no normal template for ${unmapped.join(', ')}.`);
    }

    if (s.announcement && s.announcement.until && parseISO(s.announcement.until) === null)
      errs.push(`${who}: announcement "hide after" date is invalid.`);
  }
  return { errs, warns };
}

/** Cheap shape check used before trusting a freshly fetched file. */
export function looksValid(d) {
  if (!d || typeof d !== 'object' || !d.schools || typeof d.schools !== 'object') return false;
  const ids = Object.keys(d.schools);
  return ids.length > 0 && ids.every(id => {
    const s = d.schools[id];
    return s && typeof s.name === 'string' && s.templates && typeof s.templates === 'object';
  });
}
