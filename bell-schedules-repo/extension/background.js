import { getSchedules, snapshot } from './engine.js';

const COLORS = { green: '#2e7d32', yellow: '#b07e00', red: '#c62828', gray: '#6b7280' };
const DEFAULTS = { schoolId: null, mode: 'A', notifyEnd: 0, notifyStart: false, newtab: true };

function init() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  update();
}
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'tick') update(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync') update(); });

/* ---------- reminders ----------
   Fired from the same one-minute tick that drives the badge. Each notification
   is keyed to one period on one date so it can only ever fire once. */
async function maybeNotify(s, cfg) {
  if (!s.current || !cfg) return;
  const fireKey = kind => `${s.iso}|${s.current.start}|${kind}`;
  const { fired = [] } = await chrome.storage.local.get({ fired: [] });
  const todo = [];

  if (cfg.notifyEnd > 0) {
    const window = cfg.notifyEnd * 60;
    if (s.left <= window && s.left > window - 70 && !fired.includes(fireKey('end')))
      todo.push([fireKey('end'), `${s.current.name} ends in ${cfg.notifyEnd} min`, s.next ? `Next: ${s.next.name}` : 'Last period of the day']);
  }
  if (cfg.notifyStart) {
    const since = s.secs - s.current.start;
    if (since >= 0 && since < 70 && !fired.includes(fireKey('start')))
      todo.push([fireKey('start'), `${s.current.name} has started`, `Ends at ${fmtClock(s.current.end)}`]);
  }
  if (!todo.length) return;

  // notifications is an optional permission; stay quiet if it was declined.
  const ok = await chrome.permissions.contains({ permissions: ['notifications'] }).catch(() => false);
  if (!ok) return;

  for (const [key, title, message] of todo) {
    chrome.notifications.create(key, {
      type: 'basic', iconUrl: 'icons/icon128.png', title, message, silent: false
    }, () => void chrome.runtime.lastError);
    fired.push(key);
  }
  await chrome.storage.local.set({ fired: fired.slice(-40) });
}
const fmtClock = sec => {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
};

async function update() {
  const cfg = await chrome.storage.sync.get(DEFAULTS);

  if (!cfg.schoolId) {
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: 'Bell Clock \u2014 click to choose your school' });
    return;
  }
  const res = await getSchedules();
  if (!res.data) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: COLORS.gray });
    chrome.action.setTitle({ title: 'Bell Clock \u2014 cannot reach the schedule' });
    return;
  }
  const s = snapshot(res.data, cfg.schoolId, cfg.mode);
  if (s.missingSchool) {
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: COLORS.gray });
    chrome.action.setTitle({ title: 'Bell Clock \u2014 pick your school again' });
    return;
  }

  const text = s.left == null ? '' : (() => {
    const m = Math.ceil(s.left / 60);
    return m >= 60 ? Math.floor(m / 60) + 'h' : String(m);
  })();
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: COLORS[s.state] || COLORS.gray });
  chrome.action.setTitle({ title: `${s.schoolName}\n${s.period} \u00b7 ${s.count.v} ${s.count.u}`.trim() });

  await maybeNotify(s, cfg);
}

/* ---------- new tab opt-out ----------
   The override is declared in the manifest, so the page always loads; when the
   student has turned it off we hand the tab back to Chrome's own new tab. */
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info.url || !tab) return;
  const mine = chrome.runtime.getURL('newtab.html');
  if (!info.url.startsWith(mine)) return;
  const { newtab } = await chrome.storage.sync.get({ newtab: true });
  if (newtab === false) chrome.tabs.update(tabId, { url: 'about:newtab' }).catch(() => {});
});
