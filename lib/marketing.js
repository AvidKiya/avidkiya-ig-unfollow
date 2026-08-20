/**
 * Comment-marketing module (جایگزین سالم ربات دایرکت):
 *
 *  - You register YOUR OWN posts + keywords.
 *  - The background worker polls the public comments of those posts (~1/min,
 *    round-robin, read-only) via Instagram's own web endpoint with YOUR session.
 *  - When a new comment contains a keyword, an ALERT is created and the user
 *    is notified. Nothing is ever posted or DMed automatically — drafts are
 *    prepared and the human presses send.
 */

import { STORAGE_KEYS, LIMITS, IG_APP_ID, NET } from './config.js';
import { get, set } from './storage.js';
import { IGError, igTarget } from './instagram-api.js';

// ---------------------------------------------------------------------------
// Shortcode <-> media id. Instagram shortcodes are a base-64-ish encoding of
// the numeric media id using this alphabet — fully local, no network needed.
// ---------------------------------------------------------------------------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function shortcodeToMediaId(shortcode) {
  if (!shortcode || typeof shortcode !== 'string') return null;
  let id = 0n;
  for (const ch of shortcode) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

/** Extract shortcode from any Instagram post/reel URL or bare shortcode. */
export function extractShortcode(input) {
  if (!input) return null;
  const m = String(input).trim().match(/(?:instagram\.com\/)?(?:p|reel|reels)\/([A-Za-z0-9_-]{5,20})/i);
  if (m) return m[1];
  const bare = String(input).trim();
  return /^[A-Za-z0-9_-]{8,15}$/.test(bare) ? bare : null;
}

// ---------------------------------------------------------------------------
// Watch list persistence
// ---------------------------------------------------------------------------
export async function getWatches() {
  return get(STORAGE_KEYS.MARKETING, []);
}

export async function addWatch({ postUrl, keywords, link, template }) {
  const short = extractShortcode(postUrl);
  if (!short) return { ok: false, error: 'bad-url' };
  const mediaId = shortcodeToMediaId(short);
  if (!mediaId) return { ok: false, error: 'bad-shortcode' };
  const kw = (Array.isArray(keywords) ? keywords : String(keywords).split(/[,،\n]/))
    .map((k) => k.trim()).filter(Boolean);
  if (kw.length === 0) return { ok: false, error: 'no-keywords' };

  const watches = await getWatches();
  if (watches.length >= LIMITS.MAX_WATCHES) return { ok: false, error: 'too-many' };
  if (watches.some((w) => w.short === short)) return { ok: false, error: 'duplicate' };

  const watch = {
    id: `w-${Date.now().toString(36)}`,
    postUrl: `https://www.instagram.com/p/${short}/`,
    short, mediaId,
    keywords: kw,
    link: link?.trim() || '',
    template: template?.trim() || '',
    enabled: true,
    lastSeenPk: '0',
    lastError: null,
    hits: 0,
    createdAt: Date.now(),
  };
  watches.push(watch);
  await set(STORAGE_KEYS.MARKETING, watches);
  return { ok: true, watch };
}

export async function updateWatch(id, patch) {
  const watches = await getWatches();
  const i = watches.findIndex((w) => w.id === id);
  if (i === -1) return null;
  watches[i] = { ...watches[i], ...patch };
  await set(STORAGE_KEYS.MARKETING, watches);
  return watches[i];
}

export async function removeWatch(id) {
  await set(STORAGE_KEYS.MARKETING, (await getWatches()).filter((w) => w.id !== id));
}

// ---------------------------------------------------------------------------
// Alerts inbox
// ---------------------------------------------------------------------------
export async function getAlerts() {
  return get(STORAGE_KEYS.ALERTS, []);
}

export async function pushAlerts(newAlerts) {
  if (!newAlerts.length) return;
  const alerts = await getAlerts();
  alerts.push(...newAlerts);
  while (alerts.length > LIMITS.MAX_ALERTS) alerts.shift();
  await set(STORAGE_KEYS.ALERTS, alerts);
}

export async function setAlertStatus(ids, status) {
  const alerts = await getAlerts();
  for (const a of alerts) if (ids.includes(a.id)) a.status = status;
  await set(STORAGE_KEYS.ALERTS, alerts);
}

// ---------------------------------------------------------------------------
// Comment reading (read-only, own-session, same etiquette as the scanner)
// ---------------------------------------------------------------------------
export async function fetchRecentComments(mediaId, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), NET.TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  try {
    const res = await fetch(
      igTarget(`https://i.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`),
      { credentials: 'include', headers: { 'X-IG-App-ID': IG_APP_ID, 'X-Requested-With': 'XMLHttpRequest' }, signal: ctrl.signal }
    );
    if (res.status === 401 || res.status === 403) throw new IGError('auth', `http-${res.status}`, res.status);
    if (res.status === 429) throw new IGError('rate', 'http-429', 429);
    if (res.status === 404) throw new IGError('notfound', 'http-404', 404);
    if (!res.ok) throw new IGError('unknown', `http-${res.status}`, res.status);
    const data = await res.json();
    return Array.isArray(data?.comments) ? data.comments : [];
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new IGError('network', 'request-timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Case-insensitive keyword match, works for Persian & Latin keywords. */
export function matchKeyword(text, keywords) {
  const hay = (text || '').toLowerCase();
  return keywords.find((k) => k && hay.includes(k.toLowerCase())) || null;
}

export function renderTemplate(tpl, { user = '', keyword = '', link = '' } = {}) {
  return (tpl || '')
    .replaceAll('{user}', user)
    .replaceAll('{keyword}', keyword)
    .replaceAll('{link}', link)
    .trim();
}

/**
 * Poll ONE watch: fetch the freshest first page of comments, diff against
 * lastSeenPk, return keyword hits. Updates the watch (pk cursor + errors).
 * Returns { watch, hits:[alert] }.
 */
export async function pollWatch(watch, signal) {
  const comments = await fetchRecentComments(watch.mediaId, signal);
  comments.sort((a, b) => BigInt(a.pk ?? 0) < BigInt(b.pk ?? 0) ? -1 : 1);

  const lastPk = BigInt(watch.lastSeenPk || '0');
  const fresh = comments.filter((c) => {
    try { return BigInt(c.pk) > lastPk; } catch { return false; }
  });
  const maxPk = comments.length ? String(comments[comments.length - 1].pk) : watch.lastSeenPk;

  const hits = [];
  for (const c of fresh) {
    const keyword = matchKeyword(c.text, watch.keywords);
    if (!keyword) continue;
    hits.push({
      id: `a-${Date.now().toString(36)}-${String(c.pk).slice(-5)}`,
      ts: Date.now(),
      watchId: watch.id,
      postUrl: watch.postUrl,
      short: watch.short,
      commenter: c.user?.username || '',
      commenterId: String(c.user?.pk || ''),
      text: (c.text || '').slice(0, 280),
      keyword,
      link: watch.link,
      template: watch.template,
      status: 'new',
    });
  }

  const patched = {
    ...watch,
    lastSeenPk: maxPk,
    lastError: null,
    hits: (watch.hits || 0) + hits.length,
    lastPolledAt: Date.now(),
  };
  return { watch: patched, hits };
}
