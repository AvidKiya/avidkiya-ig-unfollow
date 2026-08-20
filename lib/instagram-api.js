/**
 * Instagram API access layer.
 *
 * Privacy model: requests are made DIRECTLY from this extension page to
 * instagram.com, with credentials:'include'. The browser attaches the user's
 * own Instagram session cookies (read-only; we never exfiltrate them — they
 * go to Instagram and nowhere else). There is no proxy and no third party.
 *
 * If Instagram reshapes these endpoints, edit config.js ENDPOINTS and the two
 * normalizers below — the rest of the app stays untouched.
 */

import { ENDPOINTS, IG_APP_ID, IG_COOKIES, NET } from './config.js';

// ---------------------------------------------------------------------------
// Web-mode proxy (نسخهٔ لوکال FastAPI): وقتی web-adapter فعال است، درخواست‌ها
// از پروکسی محلی /ig رد می‌شوند تا CORS دور زده شود و Session سمت سرور تزریق گردد.
// در حالت افزونه مقدارش خالی است و همه‌چیز مستقیم به instagram.com می‌رود.
// ---------------------------------------------------------------------------
export function igTarget(url) {
  const p = globalThis.__IGTOOLS_PROXY;
  return p ? `${p}?u=${encodeURIComponent(url)}` : url;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export class IGError extends Error {
  /**
   * kind: 'auth' (401/403/login needed) | 'rate' (429) | 'block' (action blocked)
   *     | 'network' | 'crawl' (checkpoint etc.) | 'unknown'
   */
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'IGError';
    this.kind = kind;
    this.status = status;
  }
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options = {}, timeoutMs = NET.TIMEOUT_MS, signal = null) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  if (signal) {
    // Propagate user cancellation (cancel scan / stop queue).
    signal.addEventListener('abort', () => ctrl.abort(signal.reason), { once: true });
  }
  try {
    return await fetch(igTarget(url), {
      credentials: 'include', // attach the user's own IG session
      redirect: 'follow',
      ...options,
      headers: {
        'X-IG-App-ID': IG_APP_ID,
        'X-Requested-With': 'XMLHttpRequest',
        ...(options.headers || {}),
      },
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new IGError('network', 'request-timeout');
    if (err?.name === 'AbortError') throw err; // user cancelled
    throw new IGError('network', err?.message || 'network-failure');
  } finally {
    clearTimeout(timer);
  }
}

export async function getJSON(url, signal) {
  const res = await fetchWithTimeout(url, { method: 'GET' }, NET.TIMEOUT_MS, signal);
  if (!res.ok) throw new IGError(classifyStatus(res.status), `http-${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new IGError('unknown', 'invalid-json');
  }
}

// ---------------------------------------------------------------------------
// Explore: fresh posts (<24h) — read-only; used by the Turbo queue + coach feed
// (در حالت وب‌مد معادلش سمت سرور /api/coach/fresh است)
// ---------------------------------------------------------------------------
const EXPLORE_URL = 'https://i.instagram.com/api/v1/discover/topical_explore/?is_prefetch=false';

/** خروجی خالص: آیتم‌های اکسپلور را از JSON خام بیرون می‌کشد (قابل تست در Node). */
export function collectExploreItems(payload, nowSec = Math.floor(Date.now() / 1000)) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.code === 'string' && typeof node.taken_at === 'number') found.push(node);
    Object.values(node).forEach(walk);
  };
  walk(payload);
  const seen = new Set();
  const out = [];
  for (const m of found) {
    if (!m.code || seen.has(m.code)) continue;
    seen.add(m.code);
    const ageHours = (nowSec - (m.taken_at || nowSec)) / 3600;
    const caption = typeof m.caption === 'string' ? m.caption : (m.caption?.text || '');
    out.push({
      shortcode: m.code,
      url: `https://www.instagram.com/p/${m.code}/`,
      age_hours: Math.round(ageHours * 10) / 10,
      fresh: ageHours < 24,
      caption: String(caption).slice(0, 400),
      user: m.user?.username || '',
      like_count: m.like_count ?? null,
      comment_count: m.comment_count ?? null,
      media_type: m.media_type ?? null,
    });
  }
  out.sort((a, b) => a.age_hours - b.age_hours);
  return out;
}

/** پست‌های تازهٔ اکسپلور (تازه‌ترین‌ها اول). خطای auth → کاربر باید لاگین باشد. */
export async function fetchFreshExplore(limit = 40, signal = null) {
  const payload = await getJSON(EXPLORE_URL, signal);
  return collectExploreItems(payload).slice(0, limit);
}

async function readCookie(name) {
  try {
    if (typeof chrome === 'undefined' || !chrome.cookies?.get) return null; // web mode
    const c = await chrome.cookies.get({ url: IG_COOKIES.url, name });
    return c?.value || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session / profile
// ---------------------------------------------------------------------------

/**
 * Resolve the logged-in user's numeric id + username + basic counts.
 * Throws IGError('auth') when there is no active Instagram session.
 */
export async function getOwnProfile() {
  let userId = await readCookie(IG_COOKIES.session);
  let username = '';
  // Web mode: session کوکی سمت سرور لوکال است؛ id (+ یوزرنیم) را از سرور می‌گیریم.
  if (!userId && globalThis.__IGTOOLS_WEB) {
    const s = await fetch('/api/session').then((r) => r.json()).catch(() => ({}));
    if (!s?.logged_in) throw new IGError('auth', 'not-logged-in', 401);
    userId = s.user_id;
    username = s.username || '';
  }
  if (!userId) throw new IGError('auth', 'not-logged-in', 401);
  const csrf = (await readCookie(IG_COOKIES.csrf)) || '';
  const uid = String(userId);

  const shape = (u, degraded = false) => ({
    id: String(u.pk ?? u.id ?? uid),
    username: u.username || username || '',
    fullName: u.full_name || '',
    followersCount: numOrNull(u.follower_count),
    followingCount: numOrNull(u.following_count),
    csrf,
    degraded,
  });

  // زنجیرهٔ مقاوم — اینستاگرام گاهی یک‌اندپوینت را موقتاً مسدود/چالش می‌کند:
  //   ۱) i.instagram.com users/info   ۲) همان مسیر روی www.instagram.com
  //   ۳) web_profile_info با یوزرنیم (اگر داریم)
  const attempts = [
    ENDPOINTS.userInfo(uid),
    ENDPOINTS.userInfo(uid).replace('https://i.instagram.com', 'https://www.instagram.com'),
  ];
  if (username) attempts.push(ENDPOINTS.webProfile(username));

  let lastNote = '';
  for (const url of attempts) {
    try {
      const data = await getJSON(url);
      const u = data?.user || data?.data?.user;
      if (u) return shape(u);
      lastNote = (data && typeof data === 'object' && (data.message || data.status))
        ? JSON.stringify(data).slice(0, 160) : 'no-user-field';
      console.warn('[igtools] profile empty payload @', url.split('/api')[0], '→', lastNote);
    } catch (err) {
      if (err instanceof IGError && err.kind === 'auth') throw err; // واقعاً لاگین نیست
      lastNote = err?.message || String(err);
      console.warn('[igtools] profile attempt failed @', url.split('/api')[0], '→', lastNote);
    }
  }

  // به‌جای خفه‌کردن ابزار با (empty-profile): با idِ کافی ادامه می‌دهیم؛
  // شمارنده‌ها «—» نمایش داده می‌شوند و اسکن/صف کار می‌کند.
  console.warn(`[igtools] profile degraded (${lastNote})`);
  return { id: uid, username, fullName: '', followersCount: null, followingCount: null, csrf, degraded: true };
}

// ---------------------------------------------------------------------------
// Normalizers (single point of contact with Instagram's raw shapes)
// ---------------------------------------------------------------------------
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a friendships-list user object.
 * NOTE: the list API does NOT expose biography / follower counts / follow
 * dates for each user. We store what Instagram actually returns and never
 * fabricate the rest — the UI renders unavailable fields as "—".
 */
export function normalizeListUser(u) {
  return {
    id: String(u.pk ?? u.id ?? ''),
    username: u.username || '',
    fullName: u.full_name || '',
    profilePic: u.profile_pic_url || '',
    isPrivate: !!u.is_private,
    isVerified: !!u.is_verified,
    biography: typeof u.biography === 'string' ? u.biography : null, // usually null here
    followersCount: numOrNull(u.follower_count), // usually null here
    followingCount: numOrNull(u.following_count),
  };
}

// ---------------------------------------------------------------------------
// Paginated list readers
// ---------------------------------------------------------------------------

/**
 * Generic paginator for following/followers endpoints.
 * Calls onPage({ users, totalPages }) after each page so the UI stays live.
 * Respects AbortSignal for real "Cancel Scan".
 */
async function readListPaged(urlFn, userId, { signal, onPage }) {
  let cursor = '';
  let pages = 0;
  const all = [];
  do {
    const data = await getJSON(urlFn(userId, cursor), signal);
    const raw = Array.isArray(data?.users) ? data.users : [];
    const users = raw.map(normalizeListUser).filter((u) => u.id);
    all.push(...users);
    pages += 1;
    onPage?.({ users, pages, total: all.length });

    cursor = typeof data?.next_max_id === 'string' ? data.next_max_id : '';
    if (cursor) await sleep(NET.PAGE_PAUSE_MS, signal); // be polite between pages
  } while (cursor);

  return { users: all, pages };
}

export function readFollowing(userId, opts) {
  return readListPaged(ENDPOINTS.following, userId, opts);
}

export function readFollowers(userId, opts) {
  return readListPaged(ENDPOINTS.followers, userId, opts);
}

// ---------------------------------------------------------------------------
// Unfollow
// ---------------------------------------------------------------------------

/**
 * Unfollow a single account. Throws IGError with kind:
 *  'rate' on 429, 'block' on action-block / spam feedback, 'auth' on 401/403.
 */
export async function unfollowUser(userId, csrf, signal) {
  const token = csrf || (await readCookie(IG_COOKIES.csrf)) || '';
  const res = await fetchWithTimeout(
    ENDPOINTS.destroy(userId),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': token,
        'X-ASBD-ID': '129477',
      },
      body: '',
    },
    NET.TIMEOUT_MS,
    signal
  );

  if (res.status === 429) throw new IGError('rate', 'http-429', 429);
  if (res.status === 401 || res.status === 403) throw new IGError('auth', `http-${res.status}`, res.status);

  let body = null;
  try {
    body = await res.json();
  } catch {
    /* some error pages are HTML */
  }

  const msg = (body?.message || body?.feedback_message || '').toString();
  const spam = body?.spam === true || /feedback_required|try again later|action.*block/i.test(msg);
  if (!res.ok) {
    if (spam) throw new IGError('block', msg || 'action-blocked', res.status);
    throw new IGError(classifyStatus(res.status), msg || `http-${res.status}`, res.status);
  }
  if (spam) throw new IGError('block', msg || 'action-blocked', res.status);
  return true;
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(done, ms);
    function done() {
      cleanup();
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'));
    }
    function cleanup() {
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
