/**
 * IG TOOLs - AvidKiya — Background service worker (MV3).
 *
 * Responsibilities:
 *  - Open/focus the dashboard on toolbar click.
 *  - Seed defaults on install.
 *  - Comment-marketing poller: chrome.alarms, ONE watched post per minute
 *    (round-robin), read-only comment fetches. Keyword hits => alert inbox +
 *    notification. It never posts, never DMs, never comments.
 *  - Coach events: content script reports that the USER manually commented;
 *    we count it and drive the daily goal.
 */

import { STORAGE_KEYS, DEFAULT_SETTINGS, MARKETING, IG_COOKIES } from './lib/config.js';
import {
  getWatches, updateWatch, pollWatch, pushAlerts,
} from './lib/marketing.js';
import { recordCoachComment, getCoach, saveCoach } from './lib/coach.js';
import { IGError } from './lib/instagram-api.js';
import * as AILocal from './lib/ai-local.js';

const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

// ---------------------------------------------------------------------------
// Dashboard opener
// ---------------------------------------------------------------------------
async function openDashboard() {
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URL + '*' });
  if (tabs.length > 0 && tabs[0].id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: DASHBOARD_URL });
  }
}

chrome.action.onClicked.addListener(() => void openDashboard());

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    if (!stored[STORAGE_KEYS.SETTINGS]) {
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...DEFAULT_SETTINGS } });
    }
    void openDashboard();
  }
  await ensureAlarm();
});
chrome.runtime.onStartup.addListener(() => void ensureAlarm());

// NOTE: the unfollow queue still never auto-resumes — dashboard asks first.

// ---------------------------------------------------------------------------
// Comment-marketing poller (read-only, 1 watch / minute, round-robin)
// ---------------------------------------------------------------------------
let rrIndex = 0;
let polling = false;
let backoffUntil = 0; // global pause on rate-limit

async function ensureAlarm() {
  const existing = await chrome.alarms.get(MARKETING.ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(MARKETING.ALARM_NAME, {
      periodInMinutes: MARKETING.ALARM_PERIOD_MIN,
      delayInMinutes: 1,
    });
  }
}

async function isLoggedIn() {
  try {
    const c = await chrome.cookies.get({ url: IG_COOKIES.url, name: IG_COOKIES.session });
    return !!c?.value;
  } catch {
    return false;
  }
}

async function pollTick() {
  if (polling) return { skipped: true };
  if (Date.now() < backoffUntil) return { backoff: true };
  polling = true;
  try {
    const watches = (await getWatches()).filter((w) => w.enabled);
    if (watches.length === 0) return { empty: true };
    if (!(await isLoggedIn())) return { login: false };

    // حالت کاری: در حالت «دستی» هیچ اتوماسیون پس‌زمینه‌ای اجرا نمی‌شود.
    const { get: storageGet } = await import('./lib/storage.js');
    const settings = await storageGet(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const mode = settings?.assistantMode || 'auto';
    if (mode === 'manual') return { skipped: 'manual-mode' };

    rrIndex = rrIndex % watches.length;
    const watch = watches[rrIndex];
    rrIndex++;

    try {
      const { watch: patched, hits } = await pollWatch(watch);
      await updateWatch(watch.id, patched);
      if (hits.length) {
        // تحلیل خودکار نیت (فقط حالت AI + روشن بودن سوییچ + Ollama در دسترس)
        if (mode === 'ai') {
          const conf = await storageGet('ai_settings', null);
          if (conf?.auto_classify && conf?.model) {
            await AILocal.classifyHits(hits, conf, settings?.lang || 'fa');
          }
        }
        await pushAlerts(hits);
        await updateBadge();
        for (const h of hits) {
          notify(`hit-${h.id}`, {
            title: `🔔 کلمهٔ «${h.keyword}» در کامنت‌ها`,
            message: `@${h.commenter}: ${h.text.slice(0, 120)}`,
          });
        }
      }
      return { ok: true, short: watch.short, hits: hits.length };
    } catch (err) {
      const kind = err instanceof IGError ? err.kind : 'unknown';
      await updateWatch(watch.id, { lastError: kind, lastPolledAt: Date.now() });
      if (kind === 'rate') {
        // polite global cooldown: 15 minutes
        backoffUntil = Date.now() + 15 * 60_000;
        notify('igtools-rate', {
          title: '⏳ کمی آروم‌تر',
          message: 'اینستاگرام موقتاً محدود کرد؛ پایش کامنت‌ها ۱۵ دقیقه مکث می‌کند.',
        });
      }
      return { ok: false, kind };
    }
  } finally {
    polling = false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MARKETING.ALARM_NAME) void pollTick();
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
function notify(id, { title, message }) {
  if (!chrome.notifications?.create) return;
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'assets/icons/icon-128.png',
    title,
    message,
    priority: 0,
  });
}

chrome.notifications?.onClicked.addListener(async (id) => {
  if (id.startsWith('hit-')) {
    // open the relevant post so the user can reply manually
    const alerts = await (await import('./lib/storage.js')).get(STORAGE_KEYS.ALERTS, []);
    const aid = id.slice(4);
    const alert = alerts.find((a) => a.id === aid);
    if (alert?.postUrl) chrome.tabs.create({ url: alert.postUrl });
  }
});

async function updateBadge() {
  try {
    const alerts = await (await import('./lib/storage.js')).get(STORAGE_KEYS.ALERTS, []);
    const fresh = alerts.filter((a) => a.status === 'new').length;
    await chrome.action.setBadgeText({ text: fresh > 0 ? String(fresh > 99 ? '99+' : fresh) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#21f1a8' });
  } catch { /* badge is cosmetic */ }
}

// ---------------------------------------------------------------------------
// Runtime messages (dashboard popup <-> background <-> content)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // manual poll trigger from the marketing tab
  if (msg.scope === 'mkt' && msg.type === 'pollNow') {
    pollTick().then(sendResponse);
    return true; // async
  }

  // coach: the user manually posted a comment (reported by content script)
  if (msg.scope === 'coach' && msg.type === 'commentDone') {
    recordCoachComment({ shortcode: msg.shortcode, url: msg.url, fresh: msg.fresh })
      .then(async (res) => {
        if (res.ok && res.done >= res.goal) {
          notify('coach-goal', {
            title: '🏆 تبریک! هدف امروز تکمیل شد',
            message: `${res.done} کامنت واقعی ثبت کردی. همین‌طوری مشهور می‌شی :)`,
          });
        }
        sendResponse(res);
      });
    return true;
  }

  if (msg.scope === 'coach' && msg.type === 'getState') {
    getCoach().then(sendResponse);
    return true;
  }

  if (msg.scope === 'coach' && msg.type === 'set') {
    saveCoach(msg.patch || {}).then(sendResponse);
    return true;
  }

  return undefined;
});
