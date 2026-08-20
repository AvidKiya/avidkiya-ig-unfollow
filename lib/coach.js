/**
 * Engagement Coach (کامنت کوچ) — a MANUAL-assist tool.
 *
 * Philosophy: the robot never posts anything. It tracks your goal, notices
 * when YOU manually comment, tells you if a post is fresh (<24h — where your
 * comment actually gets seen), and offers idea starters that you adapt.
 * Real comments from a real human => real recognition, zero spam signals.
 */

import { STORAGE_KEYS, LIMITS, COACH_DEFAULTS } from './config.js';
import { get, set } from './storage.js';

// ---------------------------------------------------------------------------
// Built-in idea bank (Persian). These are STARTERS, meant to be adapted —
// identical copy-paste comments are exactly what spam filters hunt for.
// ---------------------------------------------------------------------------
export const BANK_FA = [
  { cat: 'question', text: 'چه جالب! این تکنیک رو خودت یاد گرفتی یا دوره‌ای رفتی؟' },
  { cat: 'question', text: 'سوال دارم — این روش روی نمونه‌های کوچیک‌تر هم جواب می‌ده؟' },
  { cat: 'question', text: 'یکی می‌تونه بگه مرحلهٔ دومش دقیقاً چطور انجام می‌شه؟' },
  { cat: 'question', text: 'به نظرت برای شروع از کدوم قسمتش بهتره؟' },
  { cat: 'reaction', text: 'وای، این زاویه خیلی خلاقانه‌ست 😍 بقیهٔ کارهات رو هم دیدم، عالین' },
  { cat: 'reaction', text: 'این ایده رو ندیده بودم — سیوش کردم که دوباره برگردم بخونمش' },
  { cat: 'reaction', text: 'دقیقاً چیزی که امروز لازم داشتم، مرسی که گذاشتیش 🙌' },
  { cat: 'reaction', text: 'آخ آخ، چرا زودتر ندیده بودم این پیجو 😄' },
  { cat: 'experience', text: 'من امسال همین رو امتحان کردم؛ تنها نکته‌ش اینه که صبر می‌خواد، ولی ارزشش رو داره' },
  { cat: 'experience', text: 'من اولش دقیقاً همین اشتباه رو کردم — بعد فهمیدم رازش توی جزئیات کوچیکه' },
  { cat: 'experience', text: 'تجربهٔ من می‌گه نسخهٔ دوم بهتر جواب می‌ده، امتحان کن ببین چی می‌شه' },
  { cat: 'experience', text: 'سه هفته پیش شروع کردم و واقعاً فرقش معلومه — ادامه بده 💪' },
  { cat: 'value', text: 'نکتهٔ «برعکس فکر کن» تو این پست طلایی بود، خیلی‌ها همینو نمی‌دونن' },
  { cat: 'value', text: 'این قسمتش ارزش یه پست جدا داره: وقتی گفتی کوچیک شروع کن' },
  { cat: 'value', text: 'بیشتر پیجا فقط نتیجه رو نشون می‌دن، تو مراحلش رو گفتی. همین فرقته 😉' },
  { cat: 'value', text: 'خلاصه‌ش رو برا دفترم نوشتم — کپشنت همیشه پر از نکته‌ست' },
  { cat: 'light', text: 'من که وسط دیدنش لبخندم نرفت 😄 ادامه بده' },
  { cat: 'light', text: 'این پست رسماً روزمو ساخت، ممنونم ✨' },
  { cat: 'light', text: 'حالا که اینو دیدم، باید برم امتحانش کنم. اگه خراب شد مقصر شمی 😅' },
  { cat: 'light', text: 'الان کامنت همهٔ ما اینه: پارت دوم کی میاد؟ 😁' },
];

export const BANK_EN = [
  { cat: 'question', text: 'Love this! Did you teach yourself or take a course?' },
  { cat: 'question', text: 'Genuine question — does this work on smaller samples too?' },
  { cat: 'reaction', text: 'Saving this one, such a fresh angle 😍' },
  { cat: 'reaction', text: 'Exactly what I needed today, thanks for sharing 🙌' },
  { cat: 'experience', text: 'Tried this earlier this year — it takes patience but it pays off' },
  { cat: 'experience', text: 'I made the same mistake at first; the magic is in the tiny details' },
  { cat: 'value', text: 'The "think backwards" bit here is gold, most people miss that' },
  { cat: 'light', text: 'Okay this officially made my day 😄 keep them coming' },
];

export const CAT_KEYS = { question: 'catQuestion', reaction: 'catReaction', experience: 'catExperience', value: 'catValue', light: 'catLight' };

// ---------------------------------------------------------------------------
// Coach state
// ---------------------------------------------------------------------------
const todayStr = () => new Date().toISOString().slice(0, 10);

export async function getCoach() {
  const s = await get(STORAGE_KEYS.COACH, null);
  const state = { ...COACH_DEFAULTS, ...(s || {}) };
  if (state.date !== todayStr()) { // new day -> reset counter
    state.date = todayStr();
    state.done = 0;
    await saveCoach(state);
  }
  return state;
}

export async function saveCoach(patch) {
  const cur = await get(STORAGE_KEYS.COACH, { ...COACH_DEFAULTS });
  const next = { ...cur, ...patch };
  await set(STORAGE_KEYS.COACH, next);
  return next;
}

export async function getCoachLog() {
  return get(STORAGE_KEYS.COACH_LOG, []);
}

/**
 * Record a manually-posted comment (called by background on content-script
 * signal). Guards against double-counting the same shortcode in one day.
 */
export async function recordCoachComment({ shortcode, url, fresh }) {
  const day = todayStr();
  const log = await getCoachLog();
  const dup = log.find((e) => new Date(e.ts).toISOString().slice(0, 10) === day && e.shortcode === shortcode);
  if (dup) return { ok: false, reason: 'duplicate' };

  const entry = { ts: Date.now(), shortcode, url, fresh: !!fresh };
  log.push(entry);
  while (log.length > LIMITS.MAX_COACH_LOG) log.shift();
  await set(STORAGE_KEYS.COACH_LOG, log);

  const s = await getCoach();
  const next = await saveCoach({ done: (s.done || 0) + 1 });
  return { ok: true, done: next.done, goal: next.goal };
}

/** Whole weekly stats for the coach dashboard card. */
export async function coachStats() {
  const log = await getCoachLog();
  const now = Date.now();
  const weekAgo = now - 7 * 86400_000;
  const week = log.filter((e) => e.ts >= weekAgo);
  const byDay = {};
  for (const e of week) {
    const d = new Date(e.ts).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  // streak of consecutive days with >=1 comment, ending today or yesterday
  let streak = 0;
  const cursor = new Date();
  const todayKeys = new Set(Object.keys(byDay));
  if (!todayKeys.has(todayStr())) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 60; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (byDay[key]) { streak++; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }
  const s = await getCoach();
  return {
    today: s.done || 0,
    goal: s.goal || 20,
    weekTotal: week.length,
    streak,
    freshCount: week.filter((e) => e.fresh).length,
    total: log.length,
  };
}
