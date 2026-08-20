/**
 * IG Unfollow - AvidKiya — Central configuration.
 *
 * Everything brand-related, all Instagram endpoints, and every storage key
 * lives here so future maintenance (e.g. Instagram changing an endpoint)
 * means editing ONE file instead of hunting through the codebase.
 */

export const APP = {
  NAME: 'IG Unfollow - AvidKiya',
  VERSION: '3.0.0',
  AUTHOR: 'Avid Kiya',
  USERNAME: 'avidkiya',
};

/** Direct-star link for the project repo. Replace with the real repository
 *  URL once it is published, e.g. 'https://github.com/avidkiya/ig-unfollow' */
export const GITHUB_REPO_URL = 'https://github.com/avidkiya';

export const LINKS = {
  instagram: 'https://instagram.com/avidkiya',
  telegram: 'https://t.me/avidkiya',
  x: 'https://x.com/avidkiya',
  github: GITHUB_REPO_URL,
  supportText: '', // filled from i18n at runtime
};

// ---------------------------------------------------------------------------
// Instagram endpoints. If Instagram changes these, patch them here only.
// ---------------------------------------------------------------------------
export const IG_APP_ID = '936619743392459'; // public web app id

export const ENDPOINTS = {
  /** Own profile lookup (username, counts) by numeric user id. */
  userInfo: (userId) => `https://i.instagram.com/api/v1/users/${encodeURIComponent(userId)}/info/`,
  /** Own profile lookup by username (useful fallback). */
  webProfile: (username) =>
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
  /** Paginated following list. max_id is the server cursor. */
  following: (userId, maxId = '') =>
    `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/following/?count=200${
      maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''
    }`,
  /** Paginated followers list. */
  followers: (userId, maxId = '') =>
    `https://www.instagram.com/api/v1/friendships/${encodeURIComponent(userId)}/followers/?count=200${
      maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''
    }`,
  /** Unfollow (POST). */
  destroy: (userId) => `https://www.instagram.com/api/v1/friendships/destroy/${encodeURIComponent(userId)}/`,
};

/** Cookies that prove an Instagram session + carry the CSRF token. */
export const IG_COOKIES = {
  session: 'ds_user_id',
  csrf: 'csrftoken',
  url: 'https://www.instagram.com/',
};

/** Network behaviour. */
export const NET = {
  /** Per-request timeout (ms). */
  TIMEOUT_MS: 30_000,
  /** Small polite pause between pagination pages (ms). */
  PAGE_PAUSE_MS: 900,
  /** Suggested cooldown shown to the user after a 429 / action block (min). */
  BLOCK_COOLDOWN_MIN: 30,
};

// ---------------------------------------------------------------------------
// Storage keys (chrome.storage.local only — never sync, never remote).
// ---------------------------------------------------------------------------
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SCAN: 'scan_current', // latest scan result incl. full non-follower profiles
  SNAPSHOTS: 'snapshots', // capped history of scan metadata for diffs/charts
  PROTECTED: 'protected', // { starred: {id: user}, never: {id: user} }
  QUEUE: 'queue', // pending unfollow queue (survives dashboard closing)
  HISTORY: 'history', // per-action unfollow log
  DAY: 'day_counter', // { date: 'YYYY-MM-DD', count: n } unfollows today
  MARKETING: 'marketing_watch', // watched own posts: keyword alerts
  ALERTS: 'marketing_alerts', // triggered keyword alerts inbox
  COACH: 'coach_state', // engagement coach session state
  COACH_LOG: 'coach_log', // log of manually-posted comments
};

/** Keep storage bounded. */
export const LIMITS = {
  MAX_SNAPSHOTS: 20,
  MAX_HISTORY: 500,
  /** Diff lists stored per snapshot are capped; full data lives in SCAN. */
  MAX_DIFF_LIST: 400,
  MAX_ALERTS: 200,
  MAX_WATCHES: 30,
  MAX_COACH_LOG: 500,
};

/** Comment-marketing polling. chrome.alarms minimum is ~1 minute, so one
 *  watch is polled per tick (round-robin) — gentle on Instagram by design. */
export const MARKETING = {
  ALARM_NAME: 'igtools-marketing-poll',
  ALARM_PERIOD_MIN: 1,
  /** How many comments to inspect per poll (first page is enough for alerts). */
  PAGE_SIZE: 20,
};

/** Engagement coach defaults. */
export const COACH_DEFAULTS = {
  active: false,
  goal: 20,
  date: '',
  done: 0,
  sessionStartedAt: null,
  customBank: [], // user-added comment ideas
};

// ---------------------------------------------------------------------------
// Unfollow presets. Delays are in seconds and are randomized inside [min,max].
// ---------------------------------------------------------------------------
export const PRESETS = {
  safe: {
    id: 'safe',
    maxPerRun: 8,
    delayMin: 20,
    delayMax: 40,
    batchSize: 4,
    batchPauseMin: 120,
    batchPauseMax: 240,
    dailyLimit: 50,
  },
  normal: {
    id: 'normal',
    maxPerRun: 15,
    delayMin: 12,
    delayMax: 25,
    batchSize: 5,
    batchPauseMin: 90,
    batchPauseMax: 180,
    dailyLimit: 120,
  },
  conservative: {
    id: 'conservative', // recommended for new accounts
    maxPerRun: 5,
    delayMin: 30,
    delayMax: 60,
    batchSize: 3,
    batchPauseMin: 180,
    batchPauseMax: 360,
    dailyLimit: 25,
  },
  custom: {
    id: 'custom',
    maxPerRun: 10,
    delayMin: 15,
    delayMax: 30,
    batchSize: 5,
    batchPauseMin: 90,
    batchPauseMax: 150,
    dailyLimit: 100,
  },
};

export const DEFAULT_SETTINGS = {
  lang: 'fa',
  theme: 'dark', // 'dark' | 'light' | 'system'
  preset: 'safe',
  custom: { ...PRESETS.custom },
  humanMode: true, // ON by default: jittered random delays + batch pauses
  igUsername: '', // your own username — used by the coach to detect your comments
  // Working mode: 'manual' | 'auto' | 'ai' — the AI assistant (Ollama) itself
  // is configured in the local web panel; the extension always behaves as 'auto'.
  assistantMode: 'auto',
};

/** Followers buckets used in filters / smart select / confirm modal. */
export const FOLLOWER_BUCKETS = [
  { id: 'lt1k', min: 0, max: 999 },
  { id: 'b1k2k', min: 1000, max: 1999 },
  { id: 'b2k3k', min: 2000, max: 2999 },
  { id: 'b3k5k', min: 3000, max: 4999 },
  { id: 'gte5k', min: 5000, max: Infinity },
];
