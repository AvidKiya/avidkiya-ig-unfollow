/**
 * Storage layer — chrome.storage.local ONLY. No sync, no remote, no cookies
 * written by us. Instagram session cookies are only READ (see config).
 *
 * Data shapes:
 *  settings  : see config.DEFAULT_SETTINGS
 *  scan      : { ts, userId, username, followingCount, followersCount,
 *                nonFollowers: NormalizedUser[] }
 *  snapshots : [{ ts, followingCount, followersCount, nonFollowersCount,
 *                 added: [{id,username}...], removed: [{id,username}...] }]  (<= MAX_SNAPSHOTS)
 *  protected : { starred: {id: NormalizedUser}, never: {id: NormalizedUser} }
 *  queue     : { items: NormalizedUser[], index, status, createdAt, preset,
 *                log: [{ts, id, username, ok, error?}], lastError? ,
 *                needsResume: bool, doneCount, failCount }
 *  history   : [{ ts, id, username, ok, error?, source: 'queue'|'single' }]  (<= MAX_HISTORY)
 *  day       : { date, count } unfollows today (UTC date string)
 */

import { STORAGE_KEYS, LIMITS, DEFAULT_SETTINGS } from './config.js';

// -- low level ---------------------------------------------------------------

export async function get(key, fallback = null) {
  const res = await chrome.storage.local.get(key);
  return res[key] !== undefined ? res[key] : fallback;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getAll() {
  return chrome.storage.local.get(null);
}

export async function clearAll() {
  await chrome.storage.local.clear();
}

export async function importAll(obj) {
  // Only allow known keys, and never trust foreign shapes blindly.
  const allowed = Object.values(STORAGE_KEYS);
  const clean = {};
  for (const k of allowed) {
    if (k in obj) clean[k] = obj[k];
  }
  await chrome.storage.local.clear();
  await chrome.storage.local.set(clean);
}

// -- settings ----------------------------------------------------------------

export async function getSettings() {
  const s = await get(STORAGE_KEYS.SETTINGS, {});
  // merge so new fields in updates never break old profiles
  return {
    ...DEFAULT_SETTINGS,
    ...(s || {}),
    custom: { ...DEFAULT_SETTINGS.custom, ...(s?.custom || {}) },
  };
}

export async function saveSettings(settings) {
  await set(STORAGE_KEYS.SETTINGS, settings);
}

// -- scan & snapshots ----------------------------------------------------------

export async function getScan() {
  return get(STORAGE_KEYS.SCAN, null);
}

export async function saveScan(scan) {
  await set(STORAGE_KEYS.SCAN, scan);
}

export async function getSnapshots() {
  return get(STORAGE_KEYS.SNAPSHOTS, []);
}

/**
 * Push a snapshot and return { added, removed } (usernames diff) + the
 * persisted snapshot. Called after every successful scan.
 */
export async function pushSnapshot({ ts, followingCount, followersCount, nonFollowerUsers, previousSnapshot }) {
  const prev = previousSnapshot || null;
  const prevIds = new Set((prev?.nonFollowerIds || []).map(String));
  const curIds = nonFollowerUsers.map((u) => String(u.id));

  const added = nonFollowerUsers
    .filter((u) => !prevIds.has(String(u.id)))
    .slice(0, LIMITS.MAX_DIFF_LIST)
    .map((u) => ({ id: u.id, username: u.username }));

  // Who left the list: they followed back OR were unfollowed/deactivated —
  // we can NOT know which, and we never pretend dates ("followed since" is
  // not reliably available via the API).
  const curSet = new Set(curIds);
  const removed = prev
    ? (prev.nonFollowerIds || [])
        .filter((x) => !curSet.has(String(x.id)))
        .slice(0, LIMITS.MAX_DIFF_LIST)
    : [];

  const snap = {
    ts,
    followingCount,
    followersCount,
    nonFollowersCount: nonFollowerUsers.length,
    nonFollowerIds: curIds.map((id) => ({ id, username: nonFollowerUsers.find((u) => String(u.id) === String(id))?.username || '' })),
    added,
    removed,
  };

  const snaps = await getSnapshots();
  snaps.push(snap);
  while (snaps.length > LIMITS.MAX_SNAPSHOTS) snaps.shift();
  await set(STORAGE_KEYS.SNAPSHOTS, snaps);
  return { added, removed, snapshot: snap };
}

// -- protected lists -----------------------------------------------------------

const EMPTY_PROTECTED = { starred: {}, never: {} };

export async function getProtected() {
  const p = await get(STORAGE_KEYS.PROTECTED, EMPTY_PROTECTED);
  return {
    starred: p?.starred || {},
    never: p?.never || {},
  };
}

export async function saveProtected(p) {
  await set(STORAGE_KEYS.PROTECTED, p);
}

export async function toggleProtected(user, list) {
  const p = await getProtected();
  const id = String(user.id);
  if (p[list][id]) delete p[list][id];
  else p[list][id] = user;
  await saveProtected(p);
  return p;
}

export async function moveProtected(user, from, to) {
  const p = await getProtected();
  const id = String(user.id);
  delete p[from][id];
  p[to][id] = user;
  await saveProtected(p);
  return p;
}

export async function unprotect(userId, list) {
  const p = await getProtected();
  delete p[list][String(userId)];
  await saveProtected(p);
  return p;
}

// -- history ---------------------------------------------------------------

export async function getHistory() {
  return get(STORAGE_KEYS.HISTORY, []);
}

export async function appendHistory(entry) {
  const h = await getHistory();
  h.push(entry);
  while (h.length > LIMITS.MAX_HISTORY) h.shift();
  await set(STORAGE_KEYS.HISTORY, h);
}

// -- daily counter ----------------------------------------------------------

export async function getTodayCount() {
  const day = await get(STORAGE_KEYS.DAY, null);
  const today = new Date().toISOString().slice(0, 10);
  return day && day.date === today ? day.count : 0;
}

export async function bumpTodayCount(n = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const day = await get(STORAGE_KEYS.DAY, null);
  const count = day && day.date === today ? day.count + n : n;
  await set(STORAGE_KEYS.DAY, { date: today, count });
  return count;
}
