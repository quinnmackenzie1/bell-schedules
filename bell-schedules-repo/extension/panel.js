import { getSchedules, snapshot, rangeLabel, ordinal } from './engine.js';

const $ = id => document.getElementById(id);
const DEFAULTS = { schoolId: null, mode: 'A', notifyEnd: 0, notifyStart: false, theme: 'auto' };

let schedules = null, meta = {}, settings = { ...DEFAULTS };
let schoolId = null, mode = 'A';
let names = {};            // { [schoolId]: { [originalPeriodName]: customName } }
let editing = null;        // period name currently being renamed

const view = n => { document.body.dataset.view = n; };
const myNames = () => (names[schoolId] ||= {});

/* ---------------- theme ---------------- */
function applyTheme(t) {
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ---------------- school picker ---------------- */
function showPicker(note) {
  const box = $('school-list');
  box.innerHTML = '';
  if (note) $('pick-note').textContent = note;
  Object.entries(schedules.schools)
    .sort((a, b) => a[1].name.localeCompare(b[1].name))
    .forEach(([id, s]) => {
      const b = document.createElement('button');
      const zone = (s.timezone || '').split('/').pop().replace(/_/g, ' ');
      b.innerHTML = `${s.name}<span class="sub">${zone}</span>`;
      b.onclick = async () => {
        schoolId = id;
        await chrome.storage.sync.set({ schoolId: id });
        view('clock');
        render();
      };
      box.appendChild(b);
    });
  view('pick');
}

/* ---------------- lunch tracks ---------------- */
function renderTracks(tracks, active) {
  const nav = $('tracks');
  if (!tracks.length) { nav.hidden = true; nav.innerHTML = ''; nav.dataset.built = ''; return; }
  nav.hidden = false;
  const want = tracks.join('');
  if (nav.dataset.built !== want) {
    nav.dataset.built = want;
    nav.innerHTML = '';
    for (const t of tracks) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.mode = t; b.textContent = t;
      b.onclick = () => {
        mode = t;
        document.body.dataset.schedule = t;
        chrome.storage.sync.set({ mode: t });
        render();
      };
      nav.appendChild(b);
    }
  }
  nav.querySelectorAll('button').forEach(b =>
    b.dataset.mode === active ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
}

/* ---------------- agenda, with inline renaming ---------------- */
function startRename(li, original) {
  if (editing) return;
  editing = original;
  const span = li.querySelector('.nm');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = myNames()[original] || original;
  input.setAttribute('aria-label', 'Rename ' + original);
  span.replaceWith(input);
  input.focus();
  input.select();

  const finish = save => {
    if (save) {
      const v = input.value.trim();
      if (!v || v === original) delete myNames()[original];
      else myNames()[original] = v;
      chrome.storage.local.set({ names });
    }
    editing = null;
    render();
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
}

function renderAgenda(rows, current, secs) {
  const ol = $('rows');
  if (editing) return;                 // don't tear down the field mid-edit
  ol.innerHTML = '';
  if (!rows.length) { ol.innerHTML = '<li class="empty">No periods today</li>'; return; }

  for (const r of rows) {
    const li = document.createElement('li');
    li.className = current && r.start === current.start ? 'now' : r.end <= secs ? 'done' : 'upcoming';
    const custom = myNames()[r.name];
    const n = document.createElement('span');
    n.className = 'nm';
    n.title = 'Click to rename';
    n.innerHTML = custom
      ? `<span class="custom">${escapeHtml(custom)}</span>`
      : escapeHtml(r.name);
    n.onclick = () => startRename(li, r.name);
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = rangeLabel(r.start, r.end);
    li.append(n, t);
    ol.appendChild(li);
  }
}
const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- main render ---------------- */
function render() {
  if (!schedules || !schoolId) return;
  const now = new Date();
  const s = snapshot(schedules, schoolId, mode, now);
  if (s.missingSchool) return showPicker('Your school is no longer listed. Pick another.');

  $('school-name').textContent = s.schoolName;
  renderTracks(s.tracks, s.activeTrack);
  if (s.activeTrack && s.activeTrack !== mode) mode = s.activeTrack;

  $('date').textContent = `${s.parts.weekday}, ${s.parts.month} ${ordinal(Number(s.parts.day))}`;

  const sp = $('special');
  const tag = s.isOverride && s.templateLabel ? 'Special schedule \u00b7 ' + s.templateLabel
    : s.cycleDay ? s.cycleDay + (s.templateLabel ? ' \u00b7 ' + s.templateLabel : '')
    : null;
  sp.textContent = tag || '';
  sp.hidden = !tag;

  const nt = $('notice');
  nt.textContent = s.announcement || '';
  nt.hidden = !s.announcement;

  const cp = new Intl.DateTimeFormat('en-US',
    { timeZone: s.zone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(now);
  $('clocktime').textContent = cp.filter(x => x.type !== 'dayPeriod').map(x => x.value).join('').trim();
  $('clockampm').textContent = cp.find(x => x.type === 'dayPeriod').value;

  const label = n => myNames()[n] || n;
  $('period').textContent = s.current ? label(s.period) : s.period;
  $('countnum').textContent = s.count.v;
  $('countunit').textContent = s.count.u;
  $('remaining').textContent = s.next && !s.current
    ? 'UNTIL ' + label(s.next.name).toUpperCase() : s.remaining;
  $('next').textContent = s.next
    ? (s.current ? `Up next \u00b7 ${label(s.next.name)} at ${timeOf(s.next.start)}`
                 : `${label(s.next.name)} starts at ${timeOf(s.next.start)}`)
    : s.up;
  document.body.dataset.state = s.state;
  renderAgenda(s.rows, s.current, s.secs);

  const when = meta.fetchedAt
    ? new Date(meta.fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '\u2014';
  const right = meta.stale ? '<span class="warn">Offline</span>'
    : s.activeTrack ? `<span>${s.activeTrack} lunch</span>` : '<span></span>';
  $('foot').innerHTML = `<span>Schedule ${meta.stale ? 'from' : 'updated'} ${when}</span>${right}`;
  $('set-foot').textContent = `Schedule ${meta.stale ? 'last loaded' : 'updated'} ${when}` +
    (meta.error ? ` \u00b7 ${meta.error}` : '');
}
const timeOf = sec => rangeLabel(sec, sec).split(' \u2013 ')[1] || '';

/* ---------------- ring ---------------- */
const ring = $('ring');
function sweep() {
  const d = new Date();
  ring.setAttribute('stroke-dashoffset',
    (100 - ((d.getSeconds() + d.getMilliseconds() / 1000) / 60) * 100).toFixed(2));
}

/* ---------------- settings ---------------- */
function fillSettings() {
  $('opt-end').value = String(settings.notifyEnd || 0);
  $('opt-start').checked = Boolean(settings.notifyStart);
  $('opt-theme').value = settings.theme || 'auto';
}
async function saveSetting(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.sync.set(patch);
}
async function askNotificationPermission() {
  try {
    const granted = await chrome.permissions.request({ permissions: ['notifications'] });
    if (!granted) {
      await saveSetting({ notifyEnd: 0, notifyStart: false });
      fillSettings();
      alert('Reminders need notification permission, so they stay off for now.');
    }
    return granted;
  } catch (e) { return false; }
}

$('open-settings').onclick = () => { fillSettings(); view('settings'); };
$('set-close').onclick = () => view('clock');
$('opt-end').onchange = async e => {
  const v = Number(e.target.value);
  if (v > 0 && !(await askNotificationPermission())) return;
  saveSetting({ notifyEnd: v });
};
$('opt-start').onchange = async e => {
  if (e.target.checked && !(await askNotificationPermission())) { e.target.checked = false; return; }
  saveSetting({ notifyStart: e.target.checked });
};
$('opt-theme').onchange = e => { applyTheme(e.target.value); saveSetting({ theme: e.target.value }); };
$('opt-open-full').onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
$('opt-clearnames').onclick = () => {
  if (!confirm('Remove every custom class name you have set?')) return;
  names = {};
  chrome.storage.local.set({ names });
  render();
};
$('opt-school').onclick = () => showPicker('Pick a different school.');
$('opt-refresh').onclick = () => boot({ force: true });
$('school-name').onclick = () => showPicker('Pick a different school.');
$('retry').onclick = () => boot({ force: true });

/* ---------------- boot ---------------- */
async function boot({ force = false } = {}) {
  view('loading');
  settings = await chrome.storage.sync.get(DEFAULTS);
  ({ names = {} } = await chrome.storage.local.get({ names: {} }));
  applyTheme(settings.theme || 'auto');

  mode = ['A', 'B', 'C'].includes(settings.mode) ? settings.mode : 'A';
  document.body.dataset.schedule = mode;

  const res = await getSchedules({ force });
  meta = { fetchedAt: res.fetchedAt, stale: res.stale, error: res.error };
  if (!res.data) {
    $('err-detail').textContent = `${res.error || 'Unknown problem'}. Check your connection, then try again.`;
    view('error');
    return;
  }
  schedules = res.data;

  if (settings.schoolId && schedules.schools[settings.schoolId]) {
    schoolId = settings.schoolId;
    view('clock');
    render();
  } else {
    showPicker(settings.schoolId ? 'Your school is no longer listed. Pick another.' : null);
  }
}

sweep();
setInterval(sweep, 100);
setInterval(() => { if (schoolId && schedules) render(); }, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sweep(); render(); } });
boot();
