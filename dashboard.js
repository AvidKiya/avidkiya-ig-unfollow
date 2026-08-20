/**
 * IG Unfollow - AvidKiya — Dashboard controller (empty-DOM, no frameworks).
 * Everything runs locally. Reads the user's own Instagram session via
 * credentialed fetches (see lib/instagram-api.js). Nothing leaves the browser.
 */

import { APP, GITHUB_REPO_URL, PRESETS, FOLLOWER_BUCKETS, STORAGE_KEYS } from './lib/config.js';
import { t, setLang, getLang, applyI18n, fmtNum, fmtDateTime } from './lib/i18n.js';
import { applyTheme } from './lib/theme.js';
import {
  getSettings, saveSettings, getScan, saveScan, getSnapshots, pushSnapshot,
  getProtected, saveProtected, toggleProtected, moveProtected, unprotect,
  getHistory, getTodayCount, getAll, clearAll, importAll,
} from './lib/storage.js';
import { getOwnProfile, readFollowing, readFollowers, IGError, fetchFreshExplore } from './lib/instagram-api.js';
import * as AILocal from './lib/ai-local.js';
import { QueueRunner, getQueue, clearQueue, STATUS } from './lib/queue.js';
import { toCSV, download, exportJSON, pickJSONFile, validateProtectedImport } from './lib/export.js';
import {
  getWatches, addWatch, updateWatch, removeWatch,
  getAlerts, setAlertStatus, renderTemplate,
} from './lib/marketing.js';
import {
  getCoach, saveCoach, getCoachLog, coachStats,
  BANK_FA, BANK_EN, CAT_KEYS,
} from './lib/coach.js';
import { upgradeGlassSelects, refreshGlassSelects } from './lib/glass-select.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function toast(type, msg, ms = 4200) {
  const box = $('#toasts');
  const node = el('div', { class: `toast ${type}`, role: 'status' },
    el('span', { text: msg }),
    el('button', {
      class: 't-close iconbtn', 'aria-label': t('common.close'),
      onclick: () => node.remove(),
      html: '<svg class="icon"><use href="#i-x"></use></svg>',
    }));
  box.append(node);
  setTimeout(() => { node.style.opacity = '0'; setTimeout(() => node.remove(), 250); }, ms);
}

/** Map an IGError / generic error to a friendly localized toast. */
function toastError(err) {
  if (err?.name === 'AbortError') return;
  if (err instanceof IGError) {
    switch (err.kind) {
      case 'auth': return toast('err', err.status === 403 ? t('toast.forbidden') : t('toast.loginNeeded'), 6000);
      case 'rate': return toast('warn', t('toast.rateLimited'), 6000);
      case 'block': return toast('err', t('toast.actionBlocked', { n: 30 }), 7000);
      case 'network': return toast('err', err.message.includes('timeout') ? t('toast.timeout') : t('toast.network'), 6000);
      default: break;
    }
  }
  toast('err', t('toast.unknownErr') + (err?.message ? ` (${esc(err.message)})` : ''), 6000);
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let modalPrevFocus = null;
function openModal(buildContent) {
  modalPrevFocus = document.activeElement;
  const content = $('#modalContent');
  content.innerHTML = '';
  content.append(buildContent);
  $('#modalBackdrop').classList.add('open');
  const firstBtn = content.querySelector('button');
  (firstBtn || $('#modalBox')).focus?.();
}
function closeModal() {
  $('#modalBackdrop').classList.remove('open');
  modalPrevFocus?.focus?.();
}
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// ---------------------------------------------------------------------------
// Avatar (direct CDN URL with referrer policy; graceful initial-fallback)
// ---------------------------------------------------------------------------
const AVATAR_COLORS = ['#0f9d76', '#7c5cd6', '#d65c8a', '#5c8ad6', '#d6895c', '#5cd6b0', '#b8d65c', '#d65c5c'];
function avatarEl(user, size = 46) {
  const name = (user.fullName || user.username || '?').trim();
  const initials = [...name].slice(0, 2).join('');
  const color = AVATAR_COLORS[[...(user.username || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const wrap = el('span', { class: 'avatar' + (user.profilePic ? '' : ' no-img') });
  const fb = el('span', { class: 'avatar-fallback', style: `background:${color}`, text: initials });
  if (user.profilePic) {
    const img = el('img', {
      src: user.profilePic,
      alt: '',
      loading: 'lazy',
      referrerpolicy: 'no-referrer', // never leak extension origin as referrer
      width: size, height: size,
    });
    // broken-image icon must never be visible -> swap to fallback
    img.addEventListener('error', () => wrap.classList.add('no-img'), { once: true });
    wrap.append(img, fb);
  } else {
    wrap.append(fb);
  }
  return wrap;
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
const state = {
  settings: null,
  scan: null,               // latest scan result
  protected: { starred: {}, never: {} },
  queue: null,
  runner: null,
  selection: new Map(),     // id -> user (non-follower selection)
  filters: defaultFilters(),
  buckets: new Set(),
  renderLimit: 80,
  profile: null,            // own IG profile cached for session
  scanCtl: null,            // AbortController for scan
  scanStartTs: 0,
  scanTimer: null,
  protectedTab: 'starred',  // 'starred' | 'never'
  protectedSearch: '',
  histFilter: 'all',
};

function defaultFilters() {
  return {
    search: '', type: 'any', bio: 'any', pic: 'any', prot: 'any',
    minFers: null, maxFers: null, minFing: null, maxFing: null, sort: 'username',
  };
}

const isNever = (u) => !!state.protected.never[String(u.id)];
const isStarred = (u) => !!state.protected.starred[String(u.id)];

function currentPreset() {
  const s = state.settings;
  return s.preset === 'custom' ? { ...PRESETS.custom, ...s.custom, id: 'custom' } : PRESETS[s.preset];
}

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600), m = Math.ceil((s % 3600) / 60);
  if (h > 0) return `${h} ${t('common.hours')} ${m} ${t('common.minutes')}`;
  return `${m} ${t('common.minutes')}`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function switchTab(name) {
  $$('.tab-btn').forEach((b) => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $$('.tab-panel').forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle('active', on);
    p.hidden = !on;
  });
  if (name === 'activity') renderActivity();
  if (name === 'protected') renderProtected();
  if (name === 'nonfollowers') renderNonFollowers(true);
  if (name === 'dashboard') renderDashboard();
  if (name === 'marketing') renderMarketing();
  if (name === 'coach') renderCoach();
}

function wireTabs() {
  const tabs = $$('.tab-btn');
  tabs.forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('.tabs').addEventListener('keydown', (e) => {
    const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dirKeys = document.documentElement.dir === 'rtl' ? { ArrowRight: -1, ArrowLeft: 1 } : { ArrowRight: 1, ArrowLeft: -1 };
      next = (i + dirKeys[e.key] + tabs.length) % tabs.length;
    } else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next !== null) { e.preventDefault(); switchTab(tabs[next].dataset.tab); tabs[next].focus(); }
  });
}

// ---------------------------------------------------------------------------
// Theme & language
// ---------------------------------------------------------------------------
function refreshThemeIcon() {
  const resolved = document.documentElement.dataset.theme;
  $('#themeIcon').innerHTML = `<use href="#${resolved === 'light' ? 'i-sun' : 'i-moon'}"></use>`;
}

async function changeLang(lang) {
  setLang(lang);
  state.settings.lang = lang;
  await saveSettings(state.settings);
  $('#langSelect').value = lang;
  $('#sLang').value = lang;
  applyI18n();
  renderAll();
}

async function changeTheme(setting) {
  applyTheme(setting);
  state.settings.theme = setting;
  await saveSettings(state.settings);
  $('#sTheme').value = setting;
  refreshThemeIcon();
}

// ---------------------------------------------------------------------------
// SCANNING
// ---------------------------------------------------------------------------
function setScanStep(activeId, doneIds = []) {
  for (const id of ['stepFollowing', 'stepFollowers', 'stepComparing']) {
    const n = $('#' + id);
    n.classList.toggle('active', id === activeId);
    n.classList.toggle('done', doneIds.includes(id));
  }
}

function updateScanProgress(kind, done, total) {
  const bar = $('#scanProgress');
  const fill = bar.firstElementChild;
  if (!total) { bar.classList.add('indeterminate'); return; }
  bar.classList.remove('indeterminate');
  const base = kind === 'following' ? 0 : 50;
  const pct = base + Math.min(50, (done / total) * 50);
  fill.style.width = `${Math.min(99, pct)}%`;
}

function pushLivePreview(user) {
  const box = $('#livePreview');
  const item = el('span', { class: 'lp-item' }, avatarEl(user, 26), el('span', { class: 'mono', text: '@' + user.username }));
  box.prepend(item);
  while (box.children.length > 24) box.lastElementChild.remove();
}

async function runScan() {
  if (state.scanCtl) return; // already running
  state.scanCtl = new AbortController();
  const signal = state.scanCtl.signal;
  state.scanStartTs = Date.now();

  // UI: reset
  $('#scanPanel').hidden = false;
  $('#scanBtn').disabled = true;
  $('#livePreview').innerHTML = '';
  $('#scanStatusMsg').textContent = '';
  $('#cPages').textContent = '0'; $('#cFollowing').textContent = '0';
  $('#cFollowers').textContent = '0'; $('#cTempNF').textContent = '0';
  setScanStep('stepFollowing');
  updateScanProgress('following', 0, 0);

  state.scanTimer = setInterval(() => {
    $('#cElapsed').textContent = fmtDuration((Date.now() - state.scanStartTs) / 1000);
  }, 1000);

  try {
    // 1) session
    let profile;
    try {
      profile = await getOwnProfile();
    } catch (err) {
      if (IS_WEB) { $('#webLoginBar').hidden = false; await refreshWebAuthUI(); }
      else $('#loginWarn').hidden = false;
      throw err;
    }
    $('#loginWarn').hidden = true;
    state.profile = profile;
    if (profile.degraded && !state.flags?.degradedToasted) {
      state.flags = { ...(state.flags || {}), degradedToasted: true };
      toast('warn', t('dashboard.profileDegraded'), 9000);
    }

    // 2) following (paged, live counters)
    setScanStep('stepFollowing');
    const following = [];
    let totalPages = 0;
    const folRes = await readFollowing(profile.id, {
      signal,
      onPage: ({ users, pages }) => {
        following.push(...users);
        $('#cPages').textContent = fmtNum(pages);
        $('#cFollowing').textContent = fmtNum(following.length);
        updateScanProgress('following', following.length, profile.followingCount);
      },
    });
    totalPages = folRes.pages;

    // 3) followers (paged, live "temporary non-followers")
    setScanStep('stepFollowers', ['stepFollowing']);
    const followersSet = new Set();
    const tempNF = new Map();
    await readFollowers(profile.id, {
      signal,
      onPage: ({ users, pages }) => {
        users.forEach((u) => followersSet.add(String(u.id)));
        $('#cPages').textContent = fmtNum(totalPages + pages);
        $('#cFollowers').textContent = fmtNum(followersSet.size);
        // live temp NF: following minus followers-so-far -> updates DURING scan
        tempNF.clear();
        for (const f of following) {
          if (!followersSet.has(String(f.id))) tempNF.set(f.id, f);
        }
        $('#cTempNF').textContent = fmtNum(tempNF.size);
        // surface a few live candidates while scanning
        let k = 0;
        for (const [, u] of [...tempNF].reverse()) { if (k++ >= 3) break; pushLivePreview(u); }
        updateScanProgress('followers', followersSet.size, profile.followersCount);
      },
    });

    // 4) compare
    setScanStep('stepComparing', ['stepFollowing', 'stepFollowers']);
    const nonFollowers = following.filter((u) => !followersSet.has(String(u.id)));

    const scan = {
      ts: Date.now(),
      userId: profile.id,
      username: profile.username,
      followingCount: profile.followingCount ?? following.length,
      followersCount: profile.followersCount ?? followersSet.size,
      nonFollowers,
    };
    await saveScan(scan);
    state.scan = scan;

    // snapshot diff (added / removed vs previous scan)
    const snaps = await getSnapshots();
    const prev = snaps[snaps.length - 1];
    // remove IDs already unfollowed since, keep honest diff
    await pushSnapshot({
      ts: scan.ts,
      followingCount: scan.followingCount,
      followersCount: scan.followersCount,
      nonFollowerUsers: nonFollowers,
      previousSnapshot: prev,
    });

    updateScanProgress('done', 1, 1);
    $('#scanProgress').firstElementChild.style.width = '100%';
    setScanStep('', ['stepFollowing', 'stepFollowers', 'stepComparing']);
    $('#scanStatusMsg').textContent = t('dashboard.progress.done');
    toast('ok', t('toast.scanDone', { n: nonFollowers.length }));
  } catch (err) {
    if (err?.name === 'AbortError') {
      $('#scanStatusMsg').textContent = t('dashboard.progress.cancelled');
      toast('warn', t('toast.scanCancelled'));
    } else {
      toastError(err);
      $('#scanStatusMsg').textContent = t('toast.scanFailed');
    }
  } finally {
    clearInterval(state.scanTimer);
    state.scanCtl = null;
    $('#scanBtn').disabled = false;
    renderDashboard();
    renderNonFollowers(true);
  }
}

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------
async function renderDashboard() {
  const scan = state.scan;
  const prot = state.protected;
  const protCount = Object.keys(prot.starred).length + Object.keys(prot.never).length;
  const today = await getTodayCount();

  $('#stFollowing').textContent = fmtNum(scan?.followingCount);
  $('#stFollowers').textContent = fmtNum(scan?.followersCount);
  $('#stNonFollowers').textContent = fmtNum(scan ? scan.nonFollowers.length : null);
  $('#stProtected').textContent = fmtNum(protCount);
  $('#stToday').textContent = fmtNum(today, { persianDigits: false });
  const timeEl = $('#stLastScanTime');
  if (scan) { timeEl.removeAttribute('data-i18n'); timeEl.textContent = fmtDateTime(scan.ts); }
  else { timeEl.textContent = t('dashboard.neverScanned'); }
  $('#scanBtnLabel').textContent = t(scan ? 'dashboard.rescanBtn' : 'dashboard.scanBtn');

  // diff vs previous scan
  const snaps = await getSnapshots();
  const last = snaps[snaps.length - 1];
  const prev = snaps[snaps.length - 2];
  if (last && prev) {
    $('#diffCard').hidden = false;
    $('#diffNew').textContent = fmtNum(last.added?.length ?? 0);
    const newFollowersEst = Math.max(0, (last.followersCount ?? 0) - (prev.followersCount ?? 0));
    $('#diffNewFollowers').textContent = fmtNum(newFollowersEst);
    $('#diffRemoved').textContent = fmtNum(last.removed?.length ?? 0);
  } else {
    $('#diffCard').hidden = true;
  }

  renderQueuePanel();
}

// ---------------------------------------------------------------------------
// Non-followers: filtering / sorting
// ---------------------------------------------------------------------------
function bucketOf(u) {
  const c = u.followersCount;
  if (c == null) return null;
  return FOLLOWER_BUCKETS.find((b) => c >= b.min && c <= b.max)?.id || null;
}

function filteredUsers() {
  const f = state.filters;
  const q = f.search.trim().toLowerCase();
  let list = state.scan?.nonFollowers || [];

  list = list.filter((u) => {
    if (q && !(`${u.username} ${u.fullName} ${u.biography || ''}`.toLowerCase().includes(q))) return false;
    if (f.type === 'private' && !u.isPrivate) return false;
    if (f.type === 'public' && u.isPrivate) return false;
    if (f.bio === 'has' && !(u.biography && u.biography.length)) return false;
    if (f.bio === 'none' && u.biography && u.biography.length) return false;
    if (f.pic === 'has' && !u.profilePic) return false;
    if (f.pic === 'none' && u.profilePic) return false;
    if (f.prot === 'starred' && !isStarred(u)) return false;
    if (f.prot === 'never' && !isNever(u)) return false;
    if (f.minFers != null && (u.followersCount == null || u.followersCount < f.minFers)) return false;
    if (f.maxFers != null && (u.followersCount == null || u.followersCount > f.maxFers)) return false;
    if (f.minFing != null && (u.followingCount == null || u.followingCount < f.minFing)) return false;
    if (f.maxFing != null && (u.followingCount == null || u.followingCount > f.maxFing)) return false;
    if (state.buckets.size > 0) {
      const b = bucketOf(u);
      if (!b || !state.buckets.has(b)) return false;
    }
    return true;
  });

  const by = f.sort;
  list = [...list].sort((a, b) => {
    if (by === 'followers') return (b.followersCount ?? -1) - (a.followersCount ?? -1);
    if (by === 'following') return (b.followingCount ?? -1) - (a.followingCount ?? -1);
    if (by === 'verified') return Number(b.isVerified) - Number(a.isVerified) || a.username.localeCompare(b.username);
    return a.username.localeCompare(b.username);
  });
  return list;
}

function iconUse(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function userRow(u, { withSelection = true } = {}) {
  const selected = state.selection.has(String(u.id));
  const row = el('div', { class: 'urow' + (selected ? ' selected' : ''), role: 'row' });

  if (withSelection) {
    const cb = el('input', {
      type: 'checkbox', class: 'u-check',
      'aria-label': `${t('common.select')} @${u.username}`,
      onchange: (e) => {
        if (isNever(u) && e.target.checked) { e.target.checked = false; return toast('warn', t('nf.smart.neverHint')); }
        e.target.checked ? state.selection.set(String(u.id), u) : state.selection.delete(String(u.id));
        row.classList.toggle('selected', e.target.checked);
        updateSelectionBar();
      },
    });
    cb.checked = selected;
    row.append(cb);
  }

  row.append(avatarEl(u));

  const badges = [];
  if (u.isVerified) badges.push(el('span', { class: 'badge green', title: t('common.verified') }, iconUse('i-check')));
  if (isNever(u)) badges.push(el('span', { class: 'badge amber', title: t('common.neverUnfollow') }, iconUse('i-lock')));
  if (isStarred(u)) badges.push(el('span', { class: 'badge green', title: t('common.starred') }, iconUse('i-star')));

  row.append(el('div', { class: 'u-main' },
    el('div', { class: 'u-name' }, [el('span', { class: 'mono', text: '@' + u.username }), ...badges]),
    el('div', { class: 'u-sub', text: u.fullName || t('common.unavailable') })));

  row.append(el('div', { class: 'u-cell hide-sm', html: `<b>${esc(fmtNum(u.followersCount))}</b><br><span class="muted" style="font-size:.72rem">${esc(t('nf.colFollowers'))}</span>` }));
  row.append(el('div', { class: 'u-cell hide-sm', html: `<b>${esc(fmtNum(u.followingCount))}</b><br><span class="muted" style="font-size:.72rem">${esc(t('nf.colFollowing'))}</span>` }));
  row.append(el('div', { class: 'u-cell hide-sm', html:
    `<span class="badge ${u.isPrivate ? 'amber' : ''}">${esc(u.isPrivate ? t('common.private') : t('common.public'))}</span><br>` +
    `<span class="muted" style="font-size:.72rem">${esc(u.biography == null ? t('nf.bioUnknown') : (u.biography ? t('nf.hasBio') : t('nf.noBio')))} · Bio</span>` }));

  const starBtn = el('button', {
    class: 'iconbtn' + (isStarred(u) ? ' on' : ''), 'aria-pressed': String(isStarred(u)),
    'aria-label': t('common.starred'), title: t('common.starred'),
    onclick: async () => { state.protected = await toggleProtected(u, 'starred'); toast('ok', t('toast.starToggled')); softRefresh(); },
  }, iconUse('i-star'));

  const lockBtn = el('button', {
    class: 'iconbtn lock' + (isNever(u) ? ' on warn' : ''), 'aria-pressed': String(isNever(u)),
    'aria-label': t('common.neverUnfollow'), title: t('common.neverUnfollow'),
    onclick: async () => {
      state.protected = await toggleProtected(u, 'never');
      if (isNever(u)) { state.selection.delete(String(u.id)); }
      toast('ok', t('toast.starToggled')); softRefresh();
    },
  }, iconUse('i-lock'));

  const openBtn = el('a', {
    class: 'iconbtn', href: `https://instagram.com/${encodeURIComponent(u.username)}`,
    target: '_blank', rel: 'noopener noreferrer',
    'aria-label': `${t('common.openProfile')} @${u.username}`, title: t('common.openProfile'),
  }, iconUse('i-external'));

  row.append(el('div', { class: 'btnrow', style: 'gap:2px' }, [starBtn, lockBtn, openBtn]));
  return row;
}

let nfObserver = null;
function renderNonFollowers(reset = false) {
  const list = $('#nfList');
  if (!list) return;
  const hasScan = !!state.scan;
  $('#nfNeedScan').hidden = hasScan;
  if (reset) {
    list.innerHTML = '';
    state.renderLimit = 80;
  }
  const users = filteredUsers();
  $('#nfCount').textContent = fmtNum(users.length);
  $('#nfEmpty').hidden = !(hasScan && users.length === 0);

  const slice = users.slice(0, state.renderLimit);
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  slice.forEach((u) => frag.append(userRow(u)));
  list.append(frag);

  // incremental rendering via IntersectionObserver (keeps UI alive on huge lists)
  nfObserver?.disconnect();
  if (users.length > state.renderLimit) {
    nfObserver = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        state.renderLimit += 80;
        renderNonFollowers(false);
      }
    }, { rootMargin: '600px' });
    nfObserver.observe($('#nfSentinel'));
  }
  updateSelectionBar();
}

function softRefresh() {
  renderNonFollowers(true);
  renderDashboard();
  if (!$('#panel-protected').hidden) renderProtected();
}

function updateSelectionBar() {
  const n = state.selection.size;
  $('#selCount').textContent = t('nf.selected', { n: fmtNum(n, { persianDigits: getLang() === 'fa' }) });
  $('#startUnfollowLabel').textContent = t('nf.startUnfollow', { n: fmtNum(n, { persianDigits: false }) });
}

// ---------------------------------------------------------------------------
// Smart select (Never-Unfollow users are NEVER included)
// ---------------------------------------------------------------------------
function selectWhere(pred, { includeNever = false } = {}) {
  let added = 0;
  for (const u of filteredUsers()) {
    if (!includeNever && isNever(u)) continue;
    if (pred(u)) { state.selection.set(String(u.id), u); added++; }
  }
  renderNonFollowers(true);
  return added;
}

function wireSmartSelect() {
  $('#sAll').addEventListener('click', () => selectWhere(() => true));
  $('#sNone').addEventListener('click', () => { state.selection.clear(); renderNonFollowers(true); });
  $('#selClearBtn').addEventListener('click', () => { state.selection.clear(); renderNonFollowers(true); });
  $('#sLt1k').addEventListener('click', () => selectWhere((u) => u.followersCount != null && u.followersCount < 1000));
  $('#sLt3k').addEventListener('click', () => selectWhere((u) => u.followersCount != null && u.followersCount < 3000));
  $('#sPriv').addEventListener('click', () => selectWhere((u) => u.isPrivate));
  $('#sNoBio').addEventListener('click', () => selectWhere((u) => u.biography != null && !u.biography));
  $('#sExStar').addEventListener('click', () => selectWhere((u) => !isStarred(u)));
  $('#sExNever').addEventListener('click', () => selectWhere(() => true)); // never-list excluded by default
}

// ---------------------------------------------------------------------------
// UNFOLLOW FLOW: confirm modal -> persisted queue -> runner
// ---------------------------------------------------------------------------
function eligibleSelection() {
  const never = state.protected.never;
  const all = [...state.selection.values()];
  const excluded = all.filter((u) => never[String(u.id)]);
  const eligible = all.filter((u) => !never[String(u.id)]);
  return { eligible, excluded };
}

async function openConfirmModal() {
  const { eligible, excluded } = eligibleSelection();
  if (state.selection.size === 0) return toast('warn', t('confirm.nothing'));
  if (eligible.length === 0) return toast('warn', t('confirm.allProtected'));

  const preset = currentPreset();
  const today = await getTodayCount();
  const dailyRemaining = Math.max(0, preset.dailyLimit - today);
  if (dailyRemaining <= 0) return toast('warn', t('settings.dailyLimitHit', { n: preset.dailyLimit }));

  const capped = Math.min(eligible.length, preset.maxPerRun, dailyRemaining);
  const items = eligible.slice(0, capped);

  // followers buckets of the selection
  const BUCKET_KEYS = { lt1k: 'bucketLt1k', b1k2k: 'bucket1k2k', b2k3k: 'bucket2k3k', b3k5k: 'bucket3k5k', gte5k: 'bucket5k' };
  const bucketCounts = FOLLOWER_BUCKETS.map((b) => ({
    id: b.id,
    n: items.filter((u) => u.followersCount != null && u.followersCount >= b.min && u.followersCount <= b.max).length,
  }));
  const unknownCount = items.filter((u) => u.followersCount == null).length;

  const avgDelay = (preset.delayMin + preset.delayMax) / 2;
  const batches = Math.ceil(items.length / preset.batchSize);
  const etaSec = items.length * (avgDelay + 2) + batches * ((preset.batchPauseMin + preset.batchPauseMax) / 2);

  const bucketBadges = bucketCounts.map((b) =>
    el('span', { class: 'badge', text: `${t('nf.filters.' + BUCKET_KEYS[b.id])}: ${fmtNum(b.n, { persianDigits: false })}` }));
  if (unknownCount) bucketBadges.push(el('span', { class: 'badge', text: `${t('common.unknown')}: ${fmtNum(unknownCount, { persianDigits: false })}` }));

  const content = el('div', {},
    el('h2', {}, iconUse('i-minus-circle'), ` ${t('confirm.title')}`),
    el('div', { class: 'm-row' }, [el('span', { text: t('confirm.total') }), el('b', { text: fmtNum(items.length, { persianDigits: false }) })]),
    el('div', { class: 'm-row' }, [el('span', { text: t('confirm.excluded') }), el('b', { text: fmtNum(excluded.length, { persianDigits: false }) })]),
    el('div', { class: 'm-row' }, [el('span', { text: t('confirm.preset') }), el('b', { text: t(`settings.preset${preset.id.charAt(0).toUpperCase() + preset.id.slice(1)}`) || preset.id })]),
    el('div', { class: 'm-row' }, [el('span', { text: t('confirm.delayRange') }), el('b', { text: `${preset.delayMin}–${preset.delayMax} ${t('common.seconds')}` })]),
    el('div', { class: 'm-row' }, [el('span', { text: t('confirm.eta') }), el('b', { text: fmtDuration(etaSec) })]),
    el('div', { style: 'margin:12px 0 4px;font-size:.82rem' }, [el('span', { class: 'muted', text: t('confirm.buckets') })]),
    el('div', { class: 'kv' }, bucketBadges),
    el('div', { class: 'note warn', style: 'margin-top:14px' }, [
      el('b', { text: t('confirm.riskTitle') + ': ' }), t('confirm.risk'),
    ]),
    el('div', { class: 'm-actions' }, [
      el('button', { class: 'btn ghost', onclick: closeModal, text: t('common.cancel') }),
      el('button', {
        class: 'btn primary', onclick: async () => { closeModal(); await startQueue(items); },
      }, iconUse('i-play'), ` ${t('confirm.start')}`),
    ])
  );
  openModal(content);
}

async function ensureCsrf() {
  try {
    state.profile = await getOwnProfile();
  } catch {
    state.profile = state.profile || {};
  }
  return state.profile?.csrf || '';
}

async function startQueue(items) {
  const preset = currentPreset();
  const queue = await QueueRunner.create(items, preset, state.settings.humanMode);
  state.queue = queue;
  $('#resumeBanner').hidden = true;
  renderQueuePanel();
  switchTab('dashboard');
  toast('ok', t('toast.queueCreated'));
  await launchRunner();
}

async function launchRunner() {
  if (state.runner) return; // single instance
  const csrf = await ensureCsrf();
  state.runner = new QueueRunner({
    csrf: () => state.profile?.csrf || csrf,
    onProgress: (q) => { state.queue = q; renderQueuePanel(); },
    onItemDone: (entry, q) => {
      state.queue = q;
      if (entry.ok) {
        // reflect instantly in UI: remove from scan list + selection
        const id = String(entry.id);
        if (state.scan) state.scan.nonFollowers = state.scan.nonFollowers.filter((u) => String(u.id) !== id);
        state.selection.delete(id);
        renderNonFollowers(true);
        renderDashboard();
      }
      renderQueuePanel();
    },
    onStatus: (status, q) => {
      state.queue = q;
      renderQueuePanel();
      if (status === STATUS.BLOCKED) toast('err', t('toast.actionBlocked', { n: q.cooldownMin || 30 }), 9000);
      if (status === STATUS.DONE) {
        toast('ok', t('toast.queueDone', { ok: q.doneCount, bad: q.failCount }), 8000);
        state.runner = null;
      }
      if (status === STATUS.PAUSED || status === STATUS.STOPPED || status === STATUS.BLOCKED) state.runner = null;
    },
  });
  const q = await getQueue();
  if (q) { q.status = STATUS.RUNNING; }
  await state.runner.run();
  state.runner = null;
  renderQueuePanel();
}

function statusLabel(s) {
  return {
    [STATUS.RUNNING]: t('queue.statusRunning'),
    [STATUS.PAUSED]: t('queue.statusPaused'),
    [STATUS.STOPPED]: t('queue.statusStopped'),
    [STATUS.BLOCKED]: t('queue.statusBlocked'),
    [STATUS.DONE]: t('queue.statusDone'),
    [STATUS.IDLE]: '—',
  }[s] || s;
}

function renderQueuePanel() {
  const q = state.queue;
  const panel = $('#queuePanel');
  if (!q) { panel.hidden = true; return; }
  const total = q.items.length;
  if (q.status === STATUS.DONE && total === 0) { panel.hidden = true; return; }
  panel.hidden = false;

  const remaining = Math.max(0, total - q.index);
  const pct = total ? Math.round((q.index / total) * 100) : 0;
  $('#qProgressBar').style.width = pct + '%';
  $('#qStatusBadge').textContent = statusLabel(q.status);
  $('#qStatusBadge').className = 'badge ' + (q.status === STATUS.BLOCKED ? 'red' : q.status === STATUS.RUNNING ? 'green' : '');
  const cur = q.items[q.index];
  $('#qCurrent').textContent = q.status === STATUS.DONE ? '—' : (cur ? '@' + cur.username : '—');
  $('#qRemaining').textContent = fmtNum(remaining, { persianDigits: false });
  const avg = (q.preset.delayMin + q.preset.delayMax) / 2 + 2;
  $('#qEta').textContent = q.status === STATUS.DONE ? '—' : fmtDuration(remaining * avg);
  $('#qLastError').textContent = q.lastError ? `${q.lastError}` : '—';

  const blocked = q.status === STATUS.BLOCKED;
  $('#qBlockedHint').hidden = !blocked;
  if (blocked) $('#qBlockedHint').textContent = t('queue.blockedHint', { n: q.cooldownMin || 30 });

  const running = q.status === STATUS.RUNNING && !!state.runner;
  $('#qPauseBtn').hidden = !running;
  $('#qResumeBtn').hidden = running || q.status === STATUS.DONE;
  $('#qStopBtn').hidden = q.status === STATUS.DONE;
  $('#qClearBtn').hidden = running;

  // results summary when done
  if (q.status === STATUS.DONE) {
    $('#qCurrent').textContent = t('queue.doneReport', { ok: q.doneCount, bad: q.failCount });
  }
}

async function checkResumeBanner() {
  const q = await getQueue();
  if (q && q.needsResume && q.index < q.items.length && q.status !== STATUS.DONE) {
    state.queue = q;
    $('#resumeBanner').hidden = false;
    $('#resumeText').textContent = t('queue.resumeDesc', { n: q.items.length - q.index });
  }
}

// ---------------------------------------------------------------------------
// Protected tab
// ---------------------------------------------------------------------------
function renderProtected() {
  const list = state.protectedTab;
  const p = state.protected;
  $('#pFavCount').textContent = fmtNum(Object.keys(p.starred).length, { persianDigits: false });
  $('#pNeverCount').textContent = fmtNum(Object.keys(p.never).length, { persianDigits: false });
  $('#pTabFav').setAttribute('aria-pressed', String(list === 'starred'));
  $('#pTabNever').setAttribute('aria-pressed', String(list === 'never'));

  const q = state.protectedSearch.trim().toLowerCase();
  let users = Object.values(p[list]);
  if (q) users = users.filter((u) => `${u.username} ${u.fullName}`.toLowerCase().includes(q));
  users.sort((a, b) => a.username.localeCompare(b.username));

  const box = $('#pList');
  box.innerHTML = '';
  $('#pEmpty').hidden = users.length > 0;
  $('#pEmptyText').textContent = t(list === 'starred' ? 'protected.emptyFav' : 'protected.emptyNever');

  const other = list === 'starred' ? 'never' : 'starred';
  for (const u of users) {
    const row = el('div', { class: 'urow compact' },
      avatarEl(u),
      el('div', { class: 'u-main' },
        el('div', { class: 'u-name mono', text: '@' + u.username }),
        el('div', { class: 'u-sub', text: u.fullName || t('common.unavailable') })),
      el('div', { class: 'btnrow', style: 'gap:2px' }, [
        el('button', {
          class: 'iconbtn', 'aria-label': t(other === 'never' ? 'protected.moveToNever' : 'protected.moveToFav'),
          title: t(other === 'never' ? 'protected.moveToNever' : 'protected.moveToFav'),
          onclick: async () => { state.protected = await moveProtected(u, list, other); toast('ok', t('toast.starToggled')); softRefresh(); renderProtected(); },
        }, iconUse(other === 'never' ? 'i-lock' : 'i-star')),
        el('button', {
          class: 'iconbtn', 'aria-label': t('protected.remove'), title: t('protected.remove'),
          onclick: async () => { state.protected = await unprotect(u.id, list); toast('ok', t('toast.starToggled')); softRefresh(); renderProtected(); },
        }, iconUse('i-trash')),
      ]),
      el('a', { class: 'iconbtn', href: `https://instagram.com/${encodeURIComponent(u.username)}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('common.openProfile') }, iconUse('i-external')),
    );
    box.append(row);
  }
}

function protectedExportRows(list) {
  return Object.values(state.protected[list]).map((u) => ({
    id: u.id, username: u.username, full_name: u.fullName || '',
    is_private: !!u.isPrivate, is_verified: !!u.isVerified,
  }));
}

// ---------------------------------------------------------------------------
// Activity tab (scans table + SVG chart + unfollow history)
// ---------------------------------------------------------------------------
async function renderActivity() {
  const snaps = await getSnapshots();

  // chart
  const svg = $('#nfChart');
  svg.innerHTML = '';
  const W = 640, H = 190, PAD = 34;
  const pts = snaps.map((s) => s.nonFollowersCount);
  if (pts.length >= 1) {
    const max = Math.max(...pts, 1);
    const min = Math.min(...pts, 0);
    const range = Math.max(1, max - min);
    const stepX = pts.length > 1 ? (W - PAD * 2) / (pts.length - 1) : 0;
    const coords = pts.map((v, i) => [PAD + (pts.length > 1 ? stepX * i : (W - PAD) / 2), H - PAD - ((v - min) / range) * (H - PAD * 2)]);
    // axis
    svg.append(svgEl('line', { x1: PAD, y1: H - PAD, x2: W - PAD, y2: H - PAD, stroke: 'var(--border)' }));
    svg.append(svgEl('line', { x1: PAD, y1: PAD, x2: PAD, y2: H - PAD, stroke: 'var(--border)' }));
    svg.append(svgEl('text', { x: 6, y: PAD + 4, fill: 'var(--text-faint)', 'font-size': 10 }, String(max)));
    svg.append(svgEl('text', { x: 6, y: H - PAD + 4, fill: 'var(--text-faint)', 'font-size': 10 }, String(min)));
    if (coords.length > 1) {
      const d = coords.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
      svg.append(svgEl('path', { d, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      const area = `${d} L${coords[coords.length - 1][0]},${H - PAD} L${coords[0][0]},${H - PAD} Z`;
      svg.append(svgEl('path', { d: area, fill: 'var(--accent)', opacity: 0.12 }));
    }
    coords.forEach(([x, y], i) => {
      svg.append(svgEl('circle', { cx: x, cy: y, r: 3.6, fill: 'var(--accent)' },
        [svgEl('title', {}, `${fmtDateTime(snaps[i].ts)} — ${pts[i]}`)]));
    });
    if (pts.length === 1) {
      svg.append(svgEl('text', { x: W / 2, y: H - PAD + 22, fill: 'var(--text-faint)', 'font-size': 11, 'text-anchor': 'middle' }, fmtDateTime(snaps[0].ts)));
    }
  } else {
    svg.append(svgEl('text', { x: W / 2, y: H / 2, fill: 'var(--text-faint)', 'font-size': 12, 'text-anchor': 'middle' }, t('activity.noScans')));
  }

  // scans table
  const tb = $('#scansTbody');
  tb.innerHTML = '';
  $('#scansEmpty').hidden = snaps.length > 0;
  [...snaps].reverse().forEach((s, i, arr) => {
    const prev = arr[i + 1];
    const diff = prev ? s.nonFollowersCount - prev.nonFollowersCount : 0;
    tb.append(el('tr', {},
      el('td', { text: fmtDateTime(s.ts) }),
      el('td', { text: fmtNum(s.followingCount, { persianDigits: false }) }),
      el('td', { text: fmtNum(s.followersCount, { persianDigits: false }) }),
      el('td', { text: fmtNum(s.nonFollowersCount, { persianDigits: false }) }),
      el('td', { html: diff === 0 ? '—' : `<b style="color:var(${diff > 0 ? '--danger' : '--ok'})">${diff > 0 ? '+' : ''}${esc(String(diff))}</b>` }),
    ));
  });

  // latest scan diff details
  const last = snaps[snaps.length - 1];
  const addedBox = $('#diffDetailAdded');
  const removedBox = $('#diffDetailRemoved');
  addedBox.innerHTML = ''; removedBox.innerHTML = '';
  $('#addedCount').textContent = fmtNum(last?.added?.length ?? 0, { persianDigits: false });
  $('#removedCount').textContent = fmtNum(last?.removed?.length ?? 0, { persianDigits: false });
  (last?.added || []).forEach((u) => addedBox.append(el('span', { class: 'badge green mono', text: '@' + u.username })));
  (last?.removed || []).forEach((u) => removedBox.append(el('span', { class: 'badge red mono', text: '@' + u.username })));

  await renderHistory();
}

function svgEl(tag, attrs = {}, children = []) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  children.forEach((c) => n.append(c));
  return n;
}

async function renderHistory() {
  const history = (await getHistory()).slice().reverse();
  const filter = state.histFilter;
  const rows = history.filter((h) => (filter === 'all' ? true : filter === 'ok' ? h.ok : !h.ok));
  const tb = $('#histTbody');
  tb.innerHTML = '';
  $('#histEmpty').hidden = rows.length > 0;
  rows.slice(0, 300).forEach((h) => {
    tb.append(el('tr', {},
      el('td', { html: `<span class="mono">@${esc(h.username)}</span>` }),
      el('td', { text: fmtDateTime(h.ts) }),
      el('td', { html: h.ok ? `<span class="badge green">${esc(t('common.success'))}</span>` : `<span class="badge red">${esc(t('common.error'))}</span>` }),
      el('td', { text: h.ok ? '—' : errorLabel(h), style: 'font-size:.8rem;color:var(--text-dim)' }),
    ));
  });
}

function errorLabel(h) {
  const map = { rate: 'kindRate', block: 'kindBlock', auth: 'kindAuth', network: 'kindNetwork' };
  return t(`activity.${map[h.error] || 'kindUnknown'}`) + (h.message ? ` · ${h.message}` : '');
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------
const PRESET_ORDER = ['safe', 'normal', 'conservative', 'custom'];

function renderPresets() {
  const wrap = $('#presetCards');
  wrap.innerHTML = '';
  const current = state.settings.preset;
  for (const id of PRESET_ORDER) {
    const titleKey = 'settings.preset' + id.charAt(0).toUpperCase() + id.slice(1);
    const card = el('button', {
      class: 'preset-card', 'aria-pressed': String(current === id), type: 'button',
      onclick: async () => {
        state.settings.preset = id;
        await saveSettings(state.settings);
        renderPresets();
        toast('ok', t('toast.settingsSaved'));
      },
    }, [
      el('h4', { text: t(titleKey) }),
      el('p', { text: PRESETS[id].maxPerRun ? getPresetDesc(id) : '' }),
    ]);
    wrap.append(card);
  }
  // custom inputs
  const cw = $('#customWrap');
  cw.hidden = current !== 'custom';
  const c = state.settings.custom;
  $('#cMaxRun').value = c.maxPerRun; $('#cDelayMin').value = c.delayMin; $('#cDelayMax').value = c.delayMax;
  $('#cBatchSize').value = c.batchSize; $('#cPauseMin').value = c.batchPauseMin; $('#cPauseMax').value = c.batchPauseMax;
  $('#cDailyLimit').value = c.dailyLimit;
}

function getPresetDesc(id) {
  return t('settings.preset' + id.charAt(0).toUpperCase() + id.slice(1) + 'Desc');
}

function wireSettings() {
  const customMap = {
    cMaxRun: 'maxPerRun', cDelayMin: 'delayMin', cDelayMax: 'delayMax', cBatchSize: 'batchSize',
    cPauseMin: 'batchPauseMin', cPauseMax: 'batchPauseMax', cDailyLimit: 'dailyLimit',
  };
  for (const [domId, key] of Object.entries(customMap)) {
    $('#' + domId).addEventListener('change', async (e) => {
      const v = Math.max(1, Number(e.target.value) || 1);
      state.settings.custom[key] = v;
      await saveSettings(state.settings);
      toast('ok', t('toast.settingsSaved'));
    });
  }

  $('#humanMode').addEventListener('change', async (e) => {
    state.settings.humanMode = e.target.checked;
    await saveSettings(state.settings);
    toast('ok', t('toast.settingsSaved'));
  });

  $('#sTheme').addEventListener('change', (e) => changeTheme(e.target.value));
  $('#sLang').addEventListener('change', (e) => changeLang(e.target.value));

  $('#clearDataBtn').addEventListener('click', () => {
    openModal(el('div', {},
      el('h2', {}, iconUse('i-warn'), ' ' + t('settings.clearData')),
      el('p', { text: t('settings.clearDataConfirm') }),
      el('div', { class: 'm-actions' }, [
        el('button', { class: 'btn ghost', onclick: closeModal, text: t('common.cancel') }),
        el('button', {
          class: 'btn danger', onclick: async () => {
            await clearAll();
            closeModal();
            location.reload();
          },
        }, iconUse('i-trash'), ' ' + t('settings.clearData')),
      ])));
  });

  $('#exportAllBtn').addEventListener('click', async () => {
    const all = await getAll();
    all.__meta = { app: APP.NAME, version: APP.VERSION, exportedAt: new Date().toISOString() };
    exportJSON(`avidkiya-ig-unfollow-backup-${new Date().toISOString().slice(0, 10)}.json`, all);
    toast('ok', t('toast.exportDone'));
  });

  $('#importAllBtn').addEventListener('click', async () => {
    const res = await pickJSONFile();
    if (!res.ok) return toast('err', t('settings.backupInvalid'));
    const data = res.data;
    const valid = data && typeof data === 'object' && Object.values(STORAGE_KEYS).some((k) => k in data);
    if (!valid) return toast('err', t('settings.backupInvalid'));
    openModal(el('div', {},
      el('h2', {}, iconUse('i-upload'), ' ' + t('settings.importAll')),
      el('p', { text: t('settings.importAllConfirm') }),
      el('div', { class: 'm-actions' }, [
        el('button', { class: 'btn ghost', onclick: closeModal, text: t('common.cancel') }),
        el('button', {
          class: 'btn primary', onclick: async () => { await importAll(data); closeModal(); location.reload(); },
        }, iconUse('i-check'), ' ' + t('common.confirm')),
      ])));
  });
}

// ---------------------------------------------------------------------------
// Non-followers wiring (filters / buckets / actions)
// ---------------------------------------------------------------------------
function wireNonFollowers() {
  const f = state.filters;
  const num = (id, key) => $('#' + id).addEventListener('input', (e) => {
    f[key] = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
    renderNonFollowers(true);
  });

  $('#fSearch').addEventListener('input', (e) => { f.search = e.target.value; renderNonFollowers(true); });
  $('#fType').addEventListener('change', (e) => { f.type = e.target.value; renderNonFollowers(true); });
  $('#fBio').addEventListener('change', (e) => { f.bio = e.target.value; renderNonFollowers(true); });
  $('#fPic').addEventListener('change', (e) => { f.pic = e.target.value; renderNonFollowers(true); });
  $('#fProt').addEventListener('change', (e) => { f.prot = e.target.value; renderNonFollowers(true); });
  num('fMinFers', 'minFers'); num('fMaxFers', 'maxFers'); num('fMinFing', 'minFing'); num('fMaxFing', 'maxFing');
  $('#fSort').addEventListener('change', (e) => { f.sort = e.target.value; renderNonFollowers(true); });

  $('#fClear').addEventListener('click', () => {
    state.filters = defaultFilters();
    state.buckets.clear();
    ['fSearch', 'fMinFers', 'fMaxFers', 'fMinFing', 'fMaxFing'].forEach((id) => ($('#' + id).value = ''));
    ['fType', 'fBio', 'fPic', 'fProt'].forEach((id) => ($('#' + id).value = 'any'));
    $('#fSort').value = 'username';
    $$('#fBuckets .chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    renderNonFollowers(true);
  });

  $$('#fBuckets .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.bucket;
      state.buckets.has(id) ? state.buckets.delete(id) : state.buckets.add(id);
      chip.setAttribute('aria-pressed', String(state.buckets.has(id)));
      renderNonFollowers(true);
    });
  });

  $('#startUnfollowBtn').addEventListener('click', openConfirmModal);
}

function wireProtectedTab() {
  $('#pTabFav').addEventListener('click', () => { state.protectedTab = 'starred'; renderProtected(); });
  $('#pTabNever').addEventListener('click', () => { state.protectedTab = 'never'; renderProtected(); });
  $('#pSearch').addEventListener('input', (e) => { state.protectedSearch = e.target.value; renderProtected(); });

  $('#pExportCsv').addEventListener('click', () => {
    const rows = protectedExportRows(state.protectedTab);
    const csv = toCSV(rows, [
      { label: 'id', value: 'id' }, { label: 'username', value: 'username' },
      { label: 'full_name', value: 'full_name' }, { label: 'is_private', value: 'is_private' },
      { label: 'is_verified', value: 'is_verified' },
    ]);
    download(`avidkiya-${state.protectedTab}-${Date.now()}.csv`, csv);
    toast('ok', t('toast.exportDone'));
  });
  $('#pExportJson').addEventListener('click', () => {
    exportJSON(`avidkiya-protected-${Date.now()}.json`, {
      starred: protectedExportRows('starred'),
      never: protectedExportRows('never'),
    });
    toast('ok', t('toast.exportDone'));
  });
  $('#pImportJson').addEventListener('click', async () => {
    const res = await pickJSONFile();
    if (!res.ok) return toast('err', t('protected.importFailed'));
    const v = validateProtectedImport(res.data);
    if (!v.ok) return toast('err', t('protected.importFailed'));

    // merge into existing lists
    const p = state.protected;
    const mergedStar = { ...p.starred, ...v.starred };
    const mergedNever = { ...p.never, ...v.never };
    state.protected = { starred: mergedStar, never: mergedNever };
    await saveProtected(state.protected);

    const okCount = Object.keys(v.starred).length + Object.keys(v.never).length;
    const bad = v.invalid || [];
    $('#pInvalidWrap').hidden = bad.length === 0;
    $('#pInvalidList').textContent = bad.map((b) => JSON.stringify(b)).join('\n');
    toast(bad.length ? 'warn' : 'ok', t('protected.importResult', { ok: okCount, bad: bad.length }), 6000);
    softRefresh();
    renderProtected();
  });
}

function wireActivity() {
  $('#hFilter').addEventListener('change', async (e) => { state.histFilter = e.target.value; await renderHistory(); });
  $('#hExportCsv').addEventListener('click', async () => {
    const rows = (await getHistory()).map((h) => ({ ...h, time: new Date(h.ts).toISOString(), result: h.ok ? 'ok' : 'error', message: h.ok ? '' : errorLabel(h) }));
    download(`avidkiya-unfollow-history-${Date.now()}.csv`, toCSV(rows, [
      { label: 'username', value: 'username' }, { label: 'time', value: 'time' },
      { label: 'result', value: 'result' }, { label: 'message', value: 'message' },
    ]));
    toast('ok', t('toast.exportDone'));
  });
  $('#hExportJson').addEventListener('click', async () => {
    exportJSON(`avidkiya-unfollow-history-${Date.now()}.json`, await getHistory());
    toast('ok', t('toast.exportDone'));
  });
  $('#scansExportCsv').addEventListener('click', async () => {
    const rows = await getSnapshots();
    download(`avidkiya-scans-${Date.now()}.csv`, toCSV(rows, [
      { label: 'time', value: (r) => new Date(r.ts).toISOString() },
      { label: 'following', value: 'followingCount' }, { label: 'followers', value: 'followersCount' },
      { label: 'non_followers', value: 'nonFollowersCount' },
      { label: 'new_non_followers', value: (r) => (r.added || []).length },
      { label: 'removed', value: (r) => (r.removed || []).length },
    ]));
    toast('ok', t('toast.exportDone'));
  });
  $('#scansExportJson').addEventListener('click', async () => {
    exportJSON(`avidkiya-scans-${Date.now()}.json`, await getSnapshots());
    toast('ok', t('toast.exportDone'));
  });
}

function wireScanAndQueue() {
  $('#scanBtn').addEventListener('click', runScan);
  $('#cancelScanBtn').addEventListener('click', () => state.scanCtl?.abort());

  $('#qPauseBtn').addEventListener('click', async () => {
    state.runner?.pause();
    const q = await getQueue();
    if (q) { q.status = STATUS.PAUSED; q.needsResume = true; state.queue = q; }
    renderQueuePanel();
  });
  $('#qResumeBtn').addEventListener('click', launchRunner);
  $('#resumeBtn').addEventListener('click', async () => {
    $('#resumeBanner').hidden = true;
    const q = await getQueue();
    if (q) { q.needsResume = false; q.status = STATUS.PAUSED; state.queue = q; }
    await launchRunner();
  });
  $('#qStopBtn').addEventListener('click', async () => {
    await state.runner?.stop();
    const q = await getQueue();
    if (q) { q.status = STATUS.STOPPED; q.needsResume = false; state.queue = q; }
    renderQueuePanel();
  });
  const clearQ = async () => {
    state.runner?.pause();
    await clearQueue();
    state.queue = null;
    $('#resumeBanner').hidden = true;
    renderQueuePanel();
  };
  $('#qClearBtn').addEventListener('click', clearQ);
  $('#resumeClearBtn').addEventListener('click', clearQ);
}

// ---------------------------------------------------------------------------
// Wiring: header
// ---------------------------------------------------------------------------
function wireHeader() {
  $('#langSelect').addEventListener('change', (e) => changeLang(e.target.value));
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    changeTheme(next);
  });
  // support/settings link targets come from config
  ['supportGithub', 'githubLink', 'privacyLink', 'supportStar'].forEach((id) => {
    const n = $('#' + id);
    if (n) n.href = GITHUB_REPO_URL;
  });
}

// ---------------------------------------------------------------------------
// COMMENT MARKETING tab
// ---------------------------------------------------------------------------
async function renderMarketing() {
  const watches = await getWatches();
  $('#mwCount').textContent = fmtNum(watches.length, { persianDigits: false });
  const wl = $('#mwList');
  wl.innerHTML = '';
  $('#mwEmpty').hidden = watches.length > 0;

  for (const w of watches) {
    const kws = w.keywords.map((k) => `<span class="badge green">${esc(k)}</span>`).join(' ');
    const errBadge = w.lastError
      ? `<span class="badge red">${esc(w.lastError === 'rate' ? t('mkt.msgRate') : w.lastError)}</span>` : '';
    const statusBadge = w.enabled
      ? `<span class="badge green">${esc(t('mkt.enable'))}</span>`
      : `<span class="badge">${esc(t('mkt.watchDisabled'))}</span>`;
    const last = w.lastPolledAt ? fmtDateTime(w.lastPolledAt) : '—';

    const row = el('div', { class: 'urow compact' },
      el('span', { class: 'avatar' }, iconUse('i-megaphone')),
      el('div', { class: 'u-main' },
        el('div', { class: 'u-name' }, [
          el('a', { class: 'mono', href: w.postUrl, target: '_blank', rel: 'noopener noreferrer', text: `/p/${w.short}/` }),
          el('span', { html: statusBadge }),
          errBadge ? el('span', { html: errBadge }) : null,
        ]),
        el('div', { class: 'u-sub', html: `${kws} · 📣 ${fmtNum(w.hits || 0, { persianDigits: false })} ${esc(t('mkt.hits'))} · 🕒 ${esc(last)}` }),
      ),
      el('div', { class: 'btnrow', style: 'gap:2px' }, [
        el('button', {
          class: 'iconbtn' + (w.enabled ? ' on' : ''), 'aria-pressed': String(w.enabled), 'aria-label': t(w.enabled ? 'mkt.disable' : 'mkt.enable'), title: t(w.enabled ? 'mkt.disable' : 'mkt.enable'),
          onclick: async () => { await updateWatch(w.id, { enabled: !w.enabled }); renderMarketing(); },
        }, iconUse(w.enabled ? 'i-pause' : 'i-play')),
        el('button', {
          class: 'iconbtn', 'aria-label': t('mkt.del'), title: t('mkt.del'),
          onclick: async () => { await removeWatch(w.id); toast('ok', t('coachToast.watchRemoved')); renderMarketing(); },
        }, iconUse('i-trash')),
      ]),
    );
    wl.append(row);
  }

  // alerts
  const alerts = (await getAlerts()).slice().reverse();
  $('#maCount').textContent = fmtNum(alerts.filter((a) => a.status === 'new').length, { persianDigits: false });
  const al = $('#maList');
  al.innerHTML = '';
  $('#maEmpty').hidden = alerts.length > 0;

  for (const a of alerts.slice(0, 60)) {
    const msg = renderTemplate(a.template, { user: a.commenter, keyword: a.keyword, link: a.link });
    const row = el('div', { class: 'urow compact' + (a.status === 'done' ? '' : ' selected') },
      avatarEl({ username: a.commenter, fullName: '', profilePic: '' }),
      el('div', { class: 'u-main' },
        el('div', { class: 'u-name' }, [
          el('span', { class: 'mono', text: '@' + a.commenter }),
          el('span', { class: 'badge green', text: `«${a.keyword}»` }),
          a.intent && AI_INTENTS.includes(a.intent)
            ? el('span', { class: 'badge violet', text: t('ai.intent.' + a.intent) }) : null,
          el('span', { class: 'badge', text: fmtDateTime(a.ts) }),
          a.status === 'done' ? el('span', { class: 'badge', text: t('mkt.statusDone') }) : el('span', { class: 'badge amber', text: t('mkt.statusNew') }),
        ]),
        el('div', { class: 'u-sub', text: a.text }),
      ),
      el('div', { class: 'btnrow', style: 'gap:2px;flex-wrap:wrap' }, [
        aiOn() ? el('button', {
          class: 'btn sm', type: 'button', title: t('ai.dmDraftTitle'),
          onclick: () => void openAiDmDraft(a),
        }, iconUse('i-lightbulb'), ` ${t('ai.dmDraftAI')}`) : null,
        el('a', { class: 'btn sm', href: a.postUrl, target: '_blank', rel: 'noopener noreferrer', text: t('mkt.openPost') }),
        el('a', { class: 'btn sm ghost', href: `https://instagram.com/${encodeURIComponent(a.commenter)}`, target: '_blank', rel: 'noopener noreferrer', text: t('mkt.openProfile') }),
        el('button', {
          class: 'btn sm primary',
          onclick: async () => {
            try { await navigator.clipboard.writeText(msg); } catch { /* gesture fallback below */ }
            window.open('https://www.instagram.com/direct/new/', '_blank', 'noopener');
            toast('ok', t('coachToast.dmReady'), 6000);
          },
        }, iconUse('i-send'), ` ${t('mkt.draftDM')}`),
        a.status === 'new' ? el('button', {
          class: 'btn sm ghost',
          onclick: async () => { await setAlertStatus([a.id], 'done'); toast('ok', t('coachToast.alertDone')); renderMarketing(); },
        }, iconUse('i-check'), ` ${t('mkt.markDone')}`) : null,
      ]),
    );
    al.append(row);
  }
}

function wireMarketing() {
  $('#mwAddBtn').addEventListener('click', async () => {
    const res = await addWatch({
      postUrl: $('#mwUrl').value,
      keywords: $('#mwKeywords').value,
      link: $('#mwLink').value,
      template: $('#mwTemplate').value,
    });
    if (!res.ok) {
      const map = { 'bad-url': 'mkt.errBadUrl', 'bad-shortcode': 'mkt.errBadUrl', 'no-keywords': 'mkt.errNoKeywords', duplicate: 'mkt.errDup', 'too-many': 'mkt.errMany' };
      return toast('err', t(map[res.error] || 'toast.unknownErr'));
    }
    $('#mwUrl').value = ''; $('#mwKeywords').value = ''; $('#mwLink').value = ''; $('#mwTemplate').value = '';
    toast('ok', t('coachToast.watchAdded'));
    renderMarketing();
  });

  $('#mwPollBtn').addEventListener('click', async () => {
    const label = $('#mwPollLabel');
    label.textContent = t('mkt.polling');
    $('#mwPollBtn').disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ scope: 'mkt', type: 'pollNow' });
      if (res?.login === false) toast('warn', t('mkt.loginNote'));
      else toast('ok', t('coachToast.pollDone'));
    } catch { toast('err', t('toast.unknownErr')); }
    label.textContent = t('mkt.pollNow');
    $('#mwPollBtn').disabled = false;
    renderMarketing();
  });

  $('#maClearDone').addEventListener('click', async () => {
    const alerts = await getAlerts();
    const ids = alerts.filter((a) => a.status === 'done').map((a) => a.id);
    if (ids.length) {
      const { set } = await import('./lib/storage.js');
      const { STORAGE_KEYS } = await import('./lib/config.js');
      await set(STORAGE_KEYS.ALERTS, alerts.filter((a) => a.status !== 'done'));
      toast('ok', t('toast.cleared'));
    }
    renderMarketing();
  });
}

// ---------------------------------------------------------------------------
// COMMENTING COACH tab
// ---------------------------------------------------------------------------
async function renderCoach() {
  const [s, stats, log] = await Promise.all([getCoach(), coachStats(), getCoachLog()]);

  $('#coToday').textContent = fmtNum(stats.today, { persianDigits: false });
  $('#coGoal').textContent = fmtNum(stats.goal, { persianDigits: false });
  $('#coWeek').textContent = fmtNum(stats.weekTotal, { persianDigits: false });
  $('#coStreak').textContent = fmtNum(stats.streak, { persianDigits: false });
  $('#coGoalInput').value = stats.goal;
  $('#coStartBtn').hidden = !!s.active;
  $('#coStopBtn').hidden = !s.active;
  $('#coSessionState').textContent = t(s.active ? 'coach.sessionOn' : 'coach.sessionOff');
  if (IS_WEB) $('#coSessionState').textContent = t('web.coachWebNote');
  $('#coUserHint').hidden = IS_WEB || !!state.settings.igUsername;

  // idea bank (built-ins are read-only; customs are deletable)
  const bankEl = $('#coBankList');
  bankEl.innerHTML = '';
  const bank = getLang() === 'fa' ? BANK_FA : BANK_EN;
  for (const b of bank) {
    bankEl.append(el('span', { class: 'chip', style: 'cursor:default;font-size:.8rem', text: `[${t('coach.' + (CAT_KEYS[b.cat] || 'catLight'))}] ${b.text}` }));
  }
  (s.customBank || []).forEach((idea, i) => {
    const chip = el('span', { class: 'chip', 'aria-pressed': 'true', style: 'font-size:.8rem' },
      `[${t('coach.customTag')}] ${idea} `);
    chip.append(el('button', {
      class: 'iconbtn', style: 'padding:0 4px', 'aria-label': t('mkt.del'),
      onclick: async () => {
        const cb = [...(s.customBank || [])];
        cb.splice(i, 1);
        await saveCoach({ customBank: cb });
        renderCoach();
      },
    }, iconUse('i-x')));
    bankEl.append(chip);
  });

  const logEl = $('#coLogList');
  logEl.innerHTML = '';
  const recent = log.slice().reverse().slice(0, 40);
  $('#coLogEmpty').hidden = recent.length > 0;
  void renderFreshFeed();
  for (const e of recent) {
    logEl.append(el('div', { class: 'urow compact' },
      el('span', { class: 'avatar' }, iconUse('i-user-minus')),
      el('div', { class: 'u-main' },
        el('div', { class: 'u-name' }, [
          el('a', { class: 'mono', href: e.url, target: '_blank', rel: 'noopener noreferrer', text: `/p/${e.shortcode}/` }),
          el('span', { class: e.fresh ? 'badge green' : 'badge', text: t(e.fresh ? 'coach.freshYes' : 'coach.freshNo') }),
        ]),
        el('div', { class: 'u-sub', text: fmtDateTime(e.ts) }),
      ),
      el('a', { class: 'iconbtn', href: e.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('common.openProfile') }, iconUse('i-external')),
    ));
  }
}

function wireCoach() {
  $('#coGoalInput').addEventListener('change', async (e) => {
    const v = Math.min(100, Math.max(5, Number(e.target.value) || 20));
    e.target.value = v;
    await saveCoach({ goal: v });
    renderCoach();
  });

  $('#coStartBtn').addEventListener('click', async () => {
    if (!IS_WEB && !state.settings.igUsername) {
      toast('warn', t('coachToast.usernameNeeded'), 6000);
      switchTab('settings');
      $('#sIgUsername').focus();
      return;
    }
    await saveCoach({ active: true, goal: Math.min(100, Math.max(5, Number($('#coGoalInput').value) || 20)), sessionStartedAt: Date.now() });
    toast('ok', t('coachToast.coachStarted'));
    window.open('https://www.instagram.com/explore/', '_blank', 'noopener');
    renderCoach();
  });

  $('#coStopBtn').addEventListener('click', async () => {
    await saveCoach({ active: false });
    toast('ok', t('coachToast.coachStopped'));
    renderCoach();
  });

  $('#coExploreBtn').addEventListener('click', () => {
    window.open('https://www.instagram.com/explore/', '_blank', 'noopener');
  });

  $('#coIdeaAdd').addEventListener('click', async () => {
    const v = $('#coIdeaInput').value.trim();
    if (v.length < 3) return;
    const s = await getCoach();
    await saveCoach({ customBank: [...(s.customBank || []), v].slice(-40) });
    $('#coIdeaInput').value = '';
    toast('ok', t('coachToast.ideaAdded'));
    renderCoach();
  });

  $('#sIgUsername').addEventListener('change', async (e) => {
    state.settings.igUsername = e.target.value.replace(/^@/, '').trim();
    e.target.value = state.settings.igUsername;
    await saveSettings(state.settings);
    toast('ok', t('coachToast.usernameSaved'));
  });
}

// ---------------------------------------------------------------------------
// Web mode (FastAPI local panel): login card + fresh-feed coach
// ---------------------------------------------------------------------------
const IS_WEB = !!globalThis.__IGTOOLS_WEB;

// ---------------------------------------------------------------------------
// AI assistant (Ollama local) — در هر دو حالت افزونه و وب‌پنل فعال است.
// وب‌مد: از روت‌های FastAPI ‏/api/ai/* — افزونه: fetch مستقیم به Ollama لوکال
// (با host_permissions روی 127.0.0.1:11434). این کوپایلوت «پیشنهاد/پیش‌نویس»
// می‌سازد؛ ارسال کامنت/دایرکت همیشه دستی است.
// ---------------------------------------------------------------------------
const AI_INTENTS = AILocal.AI_INTENTS;
const AI_MODES = ['manual', 'auto', 'ai'];
const aiOn = () => (state.settings?.assistantMode || 'auto') === 'ai';

async function aiFetch(path, body) {
  try {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  } catch {
    return { ok: false, error: 'ollama_unreachable' };
  }
}

async function getAIConf() {
  const { ai_settings } = await chrome.storage.local.get('ai_settings');
  const conf = {
    base_url: AILocal.DEFAULT_OLLAMA, model: '', tone: 'friendly', auto_classify: false,
    ...(ai_settings && typeof ai_settings === 'object' ? ai_settings : {}),
  };
  conf.base_url = AILocal.normalizeBase(conf.base_url);
  return conf;
}

async function aiStatus() {
  if (IS_WEB) return fetch('/api/ai/status').then((r) => r.json()).catch(() => null);
  const conf = await getAIConf();
  const ok = await AILocal.reachable(conf.base_url);
  const models = ok ? await AILocal.listModels(conf.base_url) : [];
  const model = models.includes(conf.model) ? conf.model : (models[0] || '');
  return {
    ok, base_url: conf.base_url, model, models,
    auto_classify: !!conf.auto_classify, tone: conf.tone || 'friendly',
    mode: state.settings.assistantMode || 'auto',
  };
}

async function aiSaveConf(patch) {
  if (IS_WEB) {
    return fetch('/api/ai/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }).then((r) => r.json()).catch(() => null);
  }
  const conf = await getAIConf();
  if (typeof patch.base_url === 'string') conf.base_url = AILocal.normalizeBase(patch.base_url);
  if (typeof patch.model === 'string') conf.model = patch.model.trim();
  if (AILocal.AI_TONES.includes(patch.tone)) conf.tone = patch.tone;
  if (typeof patch.auto_classify === 'boolean') conf.auto_classify = patch.auto_classify;
  await chrome.storage.local.set({ ai_settings: conf });
  return aiStatus();
}

async function aiIdeas(caption, user, lang) {
  if (IS_WEB) return aiFetch('/api/ai/comment-ideas', { caption, user, lang });
  const conf = await getAIConf();
  if (!conf.model) return { ok: false, error: 'no_model' };
  const raw = await AILocal.generate(conf.base_url, conf.model, AILocal.commentIdeasPrompt(caption, conf.tone, lang), { system: AILocal.systemPrompt(lang) });
  if (raw == null) return { ok: false, error: 'ollama_unreachable' };
  const ideas = AILocal.parseIdeas(raw, 3);
  return { ok: true, ideas: ideas.length ? ideas : [raw.slice(0, 160)] };
}

async function aiDmDraft(payload) {
  if (IS_WEB) return aiFetch('/api/ai/dm-draft', payload);
  const conf = await getAIConf();
  if (!conf.model) return { ok: false, error: 'no_model' };
  const lang = payload.lang || getLang();
  const raw = await AILocal.generate(conf.base_url, conf.model, AILocal.dmDraftPrompt({ ...payload, lang }), { system: AILocal.systemPrompt(lang), maxTokens: 340 });
  if (raw == null) return { ok: false, error: 'ollama_unreachable' };
  const draft = raw.trim().replace(/^[«»"']+|[«»"']+$/g, '');
  return draft ? { ok: true, draft } : { ok: false, error: 'empty' };
}

const aiErrKey = (res) => (res?.error === 'no_model' ? 'ai.errNoModel' : 'ai.errUnreachable');

/** مودال پیش‌نویس هوشمند دایرکت برای یک هشدار مارکتینگ (کپی + ارسال دستی). */
async function openAiDmDraft(a) {
  const ta = el('textarea', { rows: 6, spellcheck: 'false' });
  const genBox = el('div', { class: 'ai-gen' }, el('span', { class: 'ai-thinking-line', text: t('ai.thinking') }));
  const regenBtn = el('button', { class: 'btn sm ghost', type: 'button' }, iconUse('i-pulse'), ` ${t('ai.regenerate')}`);
  const sendBtn = el('button', { class: 'btn sm primary', type: 'button' }, iconUse('i-send'), ` ${t('mkt.draftDM')}`);

  openModal(el('div', {},
    el('h2', {}, iconUse('i-lightbulb'), ' ' + t('ai.dmDraftTitle')),
    el('p', { class: 'muted', style: 'font-size:.82rem', text: t('ai.dmIntro') }),
    genBox,
    el('div', { class: 'm-actions' }, [sendBtn, regenBtn, el('button', { class: 'btn ghost', type: 'button', onclick: closeModal, text: t('common.close') })]),
  ));

  const generate = async () => {
    genBox.innerHTML = '';
    genBox.append(el('span', { class: 'ai-thinking-line', text: t('ai.thinking') }));
    const res = await aiDmDraft({
      name: a.commenter, comment: a.text, keyword: a.keyword,
      template: a.template, link: a.link, intent: a.intent || '', lang: getLang(),
    });
    genBox.innerHTML = '';
    if (!res.ok) {
      genBox.append(el('span', { class: 'muted', style: 'font-size:.84rem', text: t(aiErrKey(res)) }));
      toast('err', t(aiErrKey(res)), 5000);
      return;
    }
    ta.value = res.draft || '';
    genBox.append(ta);
  };
  regenBtn.addEventListener('click', () => void generate());
  sendBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value || ''); } catch { /* fallback: user selects manually */ }
    window.open('https://www.instagram.com/direct/new/', '_blank', 'noopener');
    toast('ok', t('ai.copiedGo'), 6000);
  });
  void generate();
}

/** تولید/نمایش سه ایدهٔ کامنت برای یک پست تازهٔ اکسپلور — داخل باکس زیر ردیف. */
async function generateIdeas(box, it) {
  box.innerHTML = '';
  box.append(el('span', { class: 'ai-thinking-line', text: t('ai.thinking') }));
  const res = await aiIdeas(it.caption || '', it.user, getLang());
  box.innerHTML = '';
  if (!res.ok || !res.ideas?.length) {
    box.dataset.loaded = '';
    box.append(el('span', { class: 'muted', style: 'font-size:.8rem', text: t(aiErrKey(res)) }));
    return;
  }
  box.append(el('div', { class: 'ai-ideas-title muted', text: t('ai.ideasForPost') }));
  for (const idea of res.ideas) {
    const chip = el('button', { class: 'ai-chip', type: 'button', title: t('common.copy') }, iconUse('i-lightbulb'), ` ${idea}`);
    chip.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(idea); } catch { /* gesture fallback */ }
      chip.classList.add('copied');
      toast('ok', t('common.copied'), 2500);
      setTimeout(() => chip.classList.remove('copied'), 1200);
    });
    box.append(chip);
  }
  box.append(el('div', { class: 'btnrow', style: 'margin-top:4px' }, el('button', {
    class: 'btn sm ghost', type: 'button',
    onclick: () => { box.dataset.loaded = ''; void generateIdeas(box, it); },
  }, iconUse('i-pulse'), ` ${t('ai.regenerate')}`)));
  box.dataset.loaded = '1';
}

function toggleIdeas(box, it) {
  if (!box.hidden && box.dataset.loaded === '1') { box.hidden = true; return; }
  box.hidden = false;
  if (box.dataset.loaded !== '1') void generateIdeas(box, it);
}

// ---------------------------------------------------------------------------
// AI settings card (وب لوکال) — سه حالت کاری: دستی / خودکار / هوش مصنوعی
// ---------------------------------------------------------------------------
function renderAIModes() {
  const wrap = $('#aiModeCards');
  if (!wrap) return;
  wrap.innerHTML = '';
  const cur = state.settings.assistantMode || 'auto';
  for (const id of AI_MODES) {
    wrap.append(el('button', {
      class: 'preset-card', type: 'button', 'aria-pressed': String(cur === id),
      onclick: async () => {
        state.settings.assistantMode = id;
        await saveSettings(state.settings);
        renderAIModes();
        toast('ok', t('toast.settingsSaved'));
        if (!$('#panel-marketing').hidden) renderMarketing();
        if (!$('#panel-coach').hidden) renderCoach();
      },
    }, [el('h4', { text: t('ai.mode_' + id) }), el('p', { text: t('ai.mode_' + id + 'D') })]));
  }
}

function paintAIStatus(st) {
  const note = $('#aiStatusNote');
  if (!note) return;
  const sel = $('#aiModel');
  if (!st) { note.textContent = t('ai.statusFail'); return; }
  $('#aiUrl').value = st.base_url || '';
  $('#aiTone').value = st.tone || 'friendly';
  $('#aiAutoClassify').checked = !!st.auto_classify;
  sel.innerHTML = '';
  if (st.models?.length) {
    for (const m of st.models) sel.append(el('option', { value: m, text: m }));
    if (st.model && st.models.includes(st.model)) sel.value = st.model;
  } else {
    sel.append(el('option', { value: '', text: t('ai.noModels') }));
  }
  refreshGlassSelects();
  note.textContent = st.ok
    ? `${t('ai.statusOk')} · ${st.models?.length || 0} ${t('ai.modelsCount')}`
    : t('ai.statusFail') + (IS_WEB ? '' : ` ${t('ai.extCorsHint')}`);
}

async function aiStatusFetch() {
  return aiStatus();
}

function wireAICard() {
  const saveConf = (patch) => aiSaveConf(patch);

  $('#aiUrl').addEventListener('change', async (e) => {
    const st = await saveConf({ base_url: e.target.value.trim() });
    paintAIStatus(st);
    toast(st?.ok ? 'ok' : 'err', st?.ok ? t('ai.statusOk') : t('ai.statusFail'), 5000);
  });
  $('#aiModel').addEventListener('change', async (e) => {
    if (e.target.value) { await saveConf({ model: e.target.value }); toast('ok', t('toast.settingsSaved')); }
  });
  $('#aiTone').addEventListener('change', async (e) => {
    await saveConf({ tone: e.target.value });
    toast('ok', t('toast.settingsSaved'));
  });
  $('#aiAutoClassify').addEventListener('change', async (e) => {
    await saveConf({ auto_classify: e.target.checked });
    toast('ok', t('toast.settingsSaved'));
  });
  $('#aiTest').addEventListener('click', async () => {
    const lbl = $('#aiTestLabel');
    const old = lbl.textContent;
    lbl.textContent = t('ai.thinking');
    const st = await aiStatusFetch();
    lbl.textContent = old;
    paintAIStatus(st);
    toast(st?.ok ? 'ok' : 'err', st?.ok ? t('ai.statusOk') : t('ai.statusFail'), 5000);
  });
  $('#aiRefreshModels').addEventListener('click', async () => paintAIStatus(await aiStatusFetch()));
}

async function initAI() {
  const card = $('#aiCard');
  if (!card) return;
  card.hidden = false;
  renderAIModes();
  wireAICard();
  paintAIStatus(await aiStatusFetch());
}

// ---------------------------------------------------------------------------
// ⚡ Turbo queue (وب‌مد): آماده‌سازی دسته‌ای؛ ارسال همیشه با دست خود کاربر است.
// ابزار متن را آماده و پشت سر هم می‌چیند — ربات نیست، دستیار فوری است.
// ---------------------------------------------------------------------------
const turboState = { building: false };

async function getTurboQueue() {
  const { turbo_queue } = await chrome.storage.local.get('turbo_queue');
  const q = turbo_queue && typeof turbo_queue === 'object' ? turbo_queue : {};
  q.items = Array.isArray(q.items) ? q.items : [];
  return q;
}

async function saveTurboQueue(q) {
  await chrome.storage.local.set({ turbo_queue: { style: q.style || 'emoji', createdAt: q.createdAt || Date.now(), items: (q.items || []).slice(0, 60) } });
}

function parseEmojiPool(str) {
  return (str || '').split(/[,،\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 24);
}

async function buildTurbo() {
  if (turboState.building) return;
  turboState.building = true;
  const prog = $('#tuProgress'); const bar = $('#tuProgressBar'); const txt = $('#tuProgressText');
  prog.hidden = false;
  bar.style.width = '0%';
  try {
    const style = $('#tuStyle').value;
    const count = Math.min(30, Math.max(1, Number($('#tuCount').value) || 10));
    txt.textContent = t('turbo.building');
    const posts = (await fetchFreshItems()).filter((x) => x.fresh).slice(0, count);
    if (!posts.length) {
      toast('warn', t('turbo.listEmpty'), 5000);
      prog.hidden = true;
      return;
    }
    await chrome.storage.local.set({ turbo_emojis: $('#tuEmojis').value });
    const pool = parseEmojiPool($('#tuEmojis').value);
    const items = [];
    for (let i = 0; i < posts.length; i++) {
      txt.textContent = t('turbo.genProgress', { n: i + 1, total: posts.length });
      bar.style.width = `${Math.round(((i + 1) / posts.length) * 100)}%`;
      let text;
      if (style === 'emoji') {
        text = pool.length ? pool[i % pool.length] : '🧟‍♂️';
      } else {
        const r = await aiFetch('/api/ai/comment-ideas', { caption: posts[i].caption || '', user: posts[i].user, lang: getLang() });
        text = r.ok && r.ideas?.length ? r.ideas[0] : (pool[0] || '🔥');
      }
      items.push({ id: `tq-${Date.now()}-${i}`, url: posts[i].url, short: posts[i].shortcode, user: posts[i].user, text, status: 'pending' });
    }
    await saveTurboQueue({ style, items, createdAt: Date.now() });
    toast('ok', t('turbo.ready', { n: items.length }));
    prog.hidden = true;
    void renderTurbo();
  } finally {
    turboState.building = false;
  }
}

async function renderTurbo() {
  const host = $('#tuRunner');
  if (!host) return;
  const q = await getTurboQueue();
  host.innerHTML = '';
  $('#tuClear').hidden = q.items.length === 0;
  if (!q.items.length) return;
  const pending = q.items.filter((x) => x.status === 'pending');
  if (!pending.length) {
    host.append(el('div', { class: 'note', style: 'margin-top:10px' }, iconUse('i-check'), ` ${t('turbo.doneAll')}`));
    return;
  }
  const idx = q.items.findIndex((x) => x.status === 'pending');
  const it = q.items[idx];

  const ta = el('textarea', { rows: 2, spellcheck: 'false' });
  ta.value = it.text || '';
  const goBtn = el('button', { class: 'btn primary', type: 'button' }, iconUse('i-send'), ` ${t('turbo.copyOpen')}`);
  const doneBtn = el('button', { class: 'btn ghost', type: 'button' }, iconUse('i-check'), ` ${t('turbo.next')}`);
  const skipBtn = el('button', { class: 'btn ghost sm', type: 'button' }, iconUse('i-x'), ` ${t('turbo.skip')}`);

  host.append(
    el('div', { class: 'turbo-head' }, [
      el('span', { class: 'badge green', text: t('turbo.counter', { done: idx, total: q.items.length }) }),
      el('span', { class: 'muted', style: 'font-size:.78rem', text: t('turbo.remaining', { n: pending.length }) }),
      el('a', { class: 'mono', style: 'margin-inline-start:auto;font-size:.78rem;color:var(--text-faint)', href: it.url, target: '_blank', rel: 'noopener noreferrer', text: `@${it.user} · /p/${it.short}/` }),
    ]),
    el('div', { class: 'turbo-item' }, [
      ta,
      el('div', { class: 'btnrow', style: 'margin-top:8px' }, [goBtn, doneBtn, skipBtn]),
      el('p', { class: 'muted', style: 'font-size:.74rem;margin:8px 0 0', text: t('turbo.manualNote') }),
    ]),
  );

  ta.addEventListener('change', async () => { it.text = ta.value; await saveTurboQueue(q); });
  goBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); } catch { /* کاربر دستی کپی می‌کند */ }
    window.open(it.url, '_blank', 'noopener');
    toast('ok', t('ai.copiedGo'), 4000);
  });
  doneBtn.addEventListener('click', async () => {
    it.text = ta.value;
    it.status = 'done';
    await saveTurboQueue(q);
    void renderTurbo();
  });
  skipBtn.addEventListener('click', async () => {
    it.status = 'skipped';
    await saveTurboQueue(q);
    void renderTurbo();
  });
}

async function initTurbo() {
  const card = $('#turboCard');
  if (!card) return;
  card.hidden = false;
  const { turbo_emojis } = await chrome.storage.local.get('turbo_emojis');
  if (turbo_emojis) $('#tuEmojis').value = turbo_emojis;

  const syncStyle = () => {
    const aiStyle = $('#tuStyle').value === 'ai';
    $('#tuEmojiWrap').style.opacity = aiStyle ? '.45' : '1';
    const show = aiStyle && !aiOn();
    $('#tuAiHint').hidden = !show;
    if (show) $('#tuAiHint').textContent = t('turbo.aiOff');
  };
  $('#tuStyle').addEventListener('change', syncStyle);
  syncStyle();

  $('#tuBuild').addEventListener('click', () => {
    if ($('#tuStyle').value === 'ai' && !aiOn()) {
      toast('warn', t('turbo.aiOff'), 6000);
      switchTab('settings');
      return;
    }
    void buildTurbo();
  });
  $('#tuClear').addEventListener('click', async () => {
    await saveTurboQueue({ style: 'emoji', items: [] });
    void renderTurbo();
    toast('ok', t('toast.cleared'));
  });
  await renderTurbo();
}

async function refreshWebAuthUI() {
  if (!IS_WEB) return;
  const bar = $('#webLoginBar');
  const s = await fetch('/api/session').then((r) => r.json()).catch(() => ({ logged_in: false }));
  bar.hidden = false;
  $('#wlLogout').hidden = !s.logged_in;
  $('#wlStatus').textContent = s.logged_in ? `✅ ${t('web.loggedInAs')} @${s.username}` : '';
  $('#loginWarn').hidden = true; // وب‌مد: کارت لاگین جای هشدار instagram.com را می‌گیرد
}

async function initWebAuth() {
  await refreshWebAuthUI();
  $('#wlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#wlLoginLabel');
    btn.textContent = t('web.loggingIn');
    $('#wlLogin').disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: $('#wlUser').value.trim(),
          password: $('#wlPass').value,
          verification_code: $('#wlCode').value.trim(),
        }),
      }).then((r) => r.json());
      if (res.ok) {
        toast('ok', `${t('web.loggedInAs')} @${res.username}`);
        $('#webLoginBar').hidden = true;
        await refreshWebAuthUI();
      } else if (res.need_2fa) {
        $('#wlCodeWrap').hidden = false;
        $('#wlStatus').textContent = res.message;
        toast('warn', t('web.need2fa'), 6000);
        $('#wlCode').focus();
      } else {
        $('#wlStatus').textContent = res.message || res.detail || t('web.loginFailed');
        toast('err', `${t('web.loginFailed')}: ${res.message || res.detail || ''}`, 6000);
      }
    } catch (err) {
      toast('err', t('toast.network'));
    } finally {
      $('#wlLogin').disabled = false;
      btn.textContent = t('web.loginBtn');
    }
  });
  $('#wlLogout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    $('#webLoginBar').hidden = false;
    await refreshWebAuthUI();
    toast('ok', t('web.logoutBtn'));
  });
}

/** پست‌های تازهٔ اکسپلور (<24h) — وب‌مد از سرور لوکال، افزونه مستقیم با نشست مرورگر. */
async function fetchFreshItems() {
  if (IS_WEB) {
    const res = await fetch('/api/coach/fresh', { method: 'POST' }).then((r) => r.json()).catch(() => null);
    return Array.isArray(res?.items) ? res.items : [];
  }
  try {
    return await fetchFreshExplore(40);
  } catch {
    return []; // لاگین نیست یا شبکه — سکوت
  }
}

/** فهرست پست‌های تازهٔ اکسپلور (<24h) در تب کوچ — هر دو حالت. */
async function renderFreshFeed() {
  const box = $('#coLogList');
  const empty = $('#coLogEmpty');
  try {
    const items = (await fetchFreshItems()).filter((x) => x.fresh);
    if (!items.length) return;
    empty.hidden = true;
    const title = el('h3', { class: 'section-title', style: 'font-size:.95rem;margin-top:0' }, [
      iconUse('i-clock'), ` ${t('web.freshFromExplore')}`,
    ]);
    box.append(title);
    for (const it of items) {
      const ideasBox = el('div', { class: 'ai-ideas', hidden: true });
      const row = el('div', { class: 'urow compact' },
        el('span', { class: 'avatar' }, iconUse('i-external')),
        el('div', { class: 'u-main' },
          el('div', { class: 'u-name' }, [
            el('span', { class: 'mono', text: '@' + it.user }),
            el('span', { class: 'badge green', text: '🔥' }),
            el('span', { class: 'badge', text: `${it.age_hours} ${t('web.age')}` }),
          ]),
          el('div', { class: 'u-sub', text: `❤ ${it.like_count ?? '—'} · 💬 ${it.comment_count ?? '—'}` }),
        ),
        el('div', { class: 'btnrow', style: 'gap:2px' }, [
          aiOn() ? el('button', {
            class: 'btn sm', type: 'button', title: t('ai.suggest'),
            onclick: () => toggleIdeas(ideasBox, it),
          }, iconUse('i-lightbulb'), ` ${t('ai.suggest')}`) : null,
          el('a', { class: 'btn sm primary', href: it.url, target: '_blank', rel: 'noopener noreferrer', text: t('web.openPost') }),
        ]),
      );
      box.append(el('div', {}, [row, ideasBox]));
    }
  } catch {
    /* بدون لاگین — سکوت */
  }
}

// ---------------------------------------------------------------------------
// render everything (used after language change)
// ---------------------------------------------------------------------------
function renderAll() {
  renderDashboard();
  renderNonFollowers(true);
  renderProtected();
  renderActivity();
  renderPresets();
  renderMarketing();
  renderCoach();
  renderAIModes();
  void renderTurbo();
  $('#humanMode').checked = !!state.settings.humanMode;
  $('#sTheme').value = state.settings.theme;
  $('#sLang').value = state.settings.lang;
  $('#sIgUsername').value = state.settings.igUsername || '';
  relabelBucketChips();
  refreshGlassSelects();
  updateSelectionBar();
}

// Live-refresh marketing alerts & coach stats when background/content write.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ((changes.marketing_alerts || changes.marketing_watch) && !$('#panel-marketing').hidden) renderMarketing();
  if ((changes.coach_state || changes.coach_log) && !$('#panel-coach').hidden) renderCoach();
});

function relabelBucketChips() {
  const keys = ['nf.filters.bucketLt1k', 'nf.filters.bucket1k2k', 'nf.filters.bucket2k3k', 'nf.filters.bucket3k5k', 'nf.filters.bucket5k'];
  $$('#fBuckets .chip').forEach((chip, i) => { chip.textContent = t(keys[i]); });
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
async function init() {
  state.settings = await getSettings();
  setLang(state.settings.lang);
  applyTheme(state.settings.theme);
  applyI18n();
  refreshThemeIcon();
  $('#langSelect').value = state.settings.lang;

  state.scan = await getScan();
  state.protected = await getProtected();
  state.queue = await getQueue();

  wireHeader();
  wireTabs();
  wireScanAndQueue();
  wireNonFollowers();
  wireSmartSelect();
  wireProtectedTab();
  wireActivity();
  wireSettings();
  wireMarketing();
  wireCoach();
  upgradeGlassSelects();

  renderAll();
  if (IS_WEB) await initWebAuth();
  await initAI();
  await initTurbo();
  await checkResumeBanner();

  // gracefulness: look alive if hash requests a tab
  const hash = location.hash.replace('#/', '');
  if (hash && document.getElementById('panel-' + hash)) switchTab(hash);

  // If the tab closes mid-run: mark queue as resumable, never auto-continue.
  window.addEventListener('beforeunload', () => {
    if (state.scanCtl) state.scanCtl.abort();
    if (state.queue && state.runner) {
      // sync-ish: best effort persist
      QueueRunner.markDirtyOnUnload();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void QueueRunner.markDirtyOnUnload();
  });
}

init().catch((e) => {
  console.error(e);
  toast('err', t('toast.unknownErr'));
});
