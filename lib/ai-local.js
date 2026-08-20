/**
 * ai-local.js — کلاینت و پرامپت‌های Ollama لوکال (نسخهٔ جاوااسکریپت).
 *
 * خالص و بدون وابستگی به chrome.* تا هم داخل صفحهٔ داشبورد، هم داخل
 * Service Worker پس‌زمینهٔ افزونه، هم در تست‌های Node قابل import باشد.
 * در حالت وب‌مد داشبورد به‌جای این فایل از روت‌های FastAPI ‏/api/ai/* استفاده
 * می‌کند (پیاده‌سازی پایتونی معادل در ai_prompts.py / ai_client.py است).
 *
 * خط قرمز AvidKiya: این ماژول فقط «متن پیشنهادی» تولید می‌کند؛ هیچ‌کدام از
 * توابعش به اینستاگرام چیزی ارسال نمی‌کنند. ارسال همیشه با دست کاربر است.
 */

export const AI_INTENTS = ['price', 'buy', 'collab', 'support', 'spam', 'other'];
export const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
export const AI_TONES = ['friendly', 'pro', 'fun'];

export function normalizeBase(url) {
  let u = (url || '').trim().replace(/\/+$/, '');
  if (!u) u = DEFAULT_OLLAMA;
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u;
}

// ---------------------------------------------------------------------------
// Prompts (معادل ai_prompts.py نسخهٔ وب)
// ---------------------------------------------------------------------------
export function systemPrompt(lang = 'fa') {
  if (lang === 'en') {
    return 'You are a helpful Instagram comment-drafting assistant. Write short, natural, human-sounding text. Use at most one emoji, never hashtags, never links, never promotional claims. Output ONLY the requested text — no explanations, no quotes.';
  }
  return 'تو یک دستیار فارسی‌زبان برای پیش‌نویس کامنت اینستاگرام هستی. کوتاه، طبیعی و محاوره‌ای بنویس؛ انگار یک آدم واقعی است نه ربات. حداکثر یک ایموجی، بدون هشتگ، بدون لینک، بدون ادعای تبلیغاتی. فقط متن خواسته‌شده را بنویس؛ بدون هیچ توضیح اضافه‌ای.';
}

const TONE = {
  friendly: { fa: 'دوستانه و صمیمی', en: 'warm and friendly' },
  pro: { fa: 'محترمانه و حرفه‌ای', en: 'polite and professional' },
  fun: { fa: 'شوخ، خودمانی و بامزه', en: 'playful and witty' },
};

export function toneLabel(tone, lang = 'fa') {
  const t = TONE[tone] || TONE.friendly;
  return t[lang] || t.fa;
}

export function commentIdeasPrompt(caption, tone = 'friendly', lang = 'fa', n = 3) {
  const cap = (caption || '').trim().slice(0, 900) || (lang === 'en' ? '(no caption)' : '(بدون کپشن)');
  const t = toneLabel(tone, lang);
  if (lang === 'en') {
    return `Suggest ${n} short, natural Instagram comments for the post below. Tone: ${t}. Each comment must be ONE line starting with a dash «-». Make them specific to the post content so they read like a real follower, not a marketing bot. A genuine question or reaction is great.\nPost caption:\n«${cap}»`;
  }
  return `برای پست زیر ${n} کامنت کوتاه و طبیعی اینستاگرامی به فارسی پیشنهاد بده. لحن: ${t}. هر کامنت فقط یک خط باشد و با خط تیره «-» شروع شود. کامنت‌ها باید دقیقاً به محتوای پست ربط داشته باشند تا مثل کامنت یک مخاطب واقعی به نظر برسند، نه ربات تبلیغاتی. یک سؤال یا واکنش صمیمی هم گزینهٔ خوبی است.\nکپشن پست:\n«${cap}»`;
}

const BULLET = /^\s*(?:[-*•–—]|\d{1,2}[.\)]\s?)\s*/;

export function parseIdeas(raw, n = 3) {
  const ideas = [];
  for (const line of String(raw || '').split('\n')) {
    const s = line.replace(BULLET, '').trim().replace(/^[«»"']+|[«»"']+$/g, '');
    if (s.length >= 2 && s.length <= 220 && !ideas.includes(s)) ideas.push(s);
    if (ideas.length >= n) break;
  }
  return ideas;
}

export function dmDraftPrompt({ name = '', comment = '', keyword = '', template = '', link = '', lang = 'fa' } = {}) {
  const hint = template
    ? (lang === 'en'
        ? `\nMy previous default message was: «${template.slice(0, 220)}» — use it as a style guide but do not copy it.`
        : `\nپیام پیش‌فرض قبلی من این بود: «${template.slice(0, 220)}» — از لحنش الگو بگیر ولی عیناً کپی نکن.`)
    : '';
  const linkLine = link
    ? (lang === 'en'
        ? `\nThe link to send is: ${link} — paste it exactly once where it fits.`
        : `\nلینکی که باید بفرستم این است: ${link} — فقط یک‌بار، سر جای درست داخل متن بیاور.`)
    : '';
  if (lang === 'en') {
    return `A user @${name || '?'} commented on my Instagram post: «${comment.slice(0, 400)}»\nTheir interest keyword: ${keyword || '—'}.${hint}${linkLine}\nWrite a SHORT direct-message draft (3-4 sentences) with a natural, human, conversational tone that first refers to their comment, then answers/delivers, and stays friendly. Output ONLY the DM text.`;
  }
  return `کاربری با یوزرنیم @${name || '?'} زیر پست اینستاگرام من این کامنت را گذاشته: «${comment.slice(0, 400)}»\nکلمهٔ کلیدی علاقه‌اش: ${keyword || '—'}.${hint}${linkLine}\nیک پیش‌نویس دایرکت کوتاه (۳ تا ۴ جملهٔ فارسی) بنویس که اول به کامنت خودش ارجاع بدهد، بعد جواب/لینک را تحویل بدهد و دوستانه و انسانی باشد. فقط متن دایرکت را بنویس.`;
}

export function classifyPrompt(text, lang = 'fa') {
  const rules = 'Rules: price question=price, wants to buy/order=buy, collaboration/sponsorship offer=collab, problem or support question=support, irrelevant advertising=spam, everything else=other.';
  if (lang === 'en') {
    return `Classify the intent of this Instagram comment using EXACTLY one word from: price | buy | collab | support | spam | other\n${rules}\nComment: «${(text || '').slice(0, 400)}»\nAnswer (one word only):`;
  }
  return `نیت این کامنت اینستاگرام را دقیقاً با یکی از این کلمه‌های انگلیسی مشخص کن: price | buy | collab | support | spam | other\nقانون: سؤال دربارهٔ قیمت=price ، تمایل به خرید/سفارش=buy ، پیشنهاد همکاری یا تبلیغ=collab ، مشکل یا سؤال پشتیبانی=support ، تبلیغ نامرتبط=spam ، بقیه=other.\nکامنت: «${(text || '').slice(0, 400)}»\nجواب (فقط یک کلمه):`;
}

export function parseIntent(raw) {
  const low = String(raw || '').toLowerCase();
  let best = 'other';
  let pos = 1e9;
  for (const it of AI_INTENTS) {
    const i = low.indexOf(it);
    if (i >= 0 && i < pos) { best = it; pos = i; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// HTTP client (fetch) — کار در صفحهٔ افزونه با host_permissions روی 127.0.0.1
// ---------------------------------------------------------------------------
async function fetchTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function reachable(base, timeoutMs = 3000) {
  try {
    const r = await fetchTimeout(normalizeBase(base) + '/api/tags', { method: 'GET' }, timeoutMs);
    return r.ok;
  } catch {
    return false;
  }
}

export async function listModels(base, timeoutMs = 6000) {
  try {
    const r = await fetchTimeout(normalizeBase(base) + '/api/tags', { method: 'GET' }, timeoutMs);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.models || []).map((m) => m?.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** متن تولیدشده یا null در صورت خطا/عدم دسترسی. */
export async function generate(base, model, prompt, { system = '', timeoutMs = 120000, temperature = 0.75, maxTokens = 260 } = {}) {
  const body = { model, prompt, stream: false, options: { temperature, num_predict: maxTokens } };
  if (system) body.system = system;
  try {
    const r = await fetchTimeout(normalizeBase(base) + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    if (!r.ok) return null;
    const data = await r.json();
    return (data.response || '').trim();
  } catch {
    return null;
  }
}

/**
 * تحلیل نیت یک دسته هشدار درجا (fail-safe). برای پولر پس‌زمینهٔ افزونه.
 * conf: { base_url, model } — lang از تنظیمات داشبورد.
 */
export async function classifyHits(hits, conf, lang = 'fa', maxN = 8) {
  if (!conf?.model) return;
  if (!(await reachable(conf.base_url, 2500))) return;
  for (const h of hits.slice(0, maxN)) {
    const raw = await generate(conf.base_url, conf.model, classifyPrompt(h.text || '', lang), {
      system: systemPrompt(lang), temperature: 0.1, maxTokens: 16, timeoutMs: 30000,
    });
    h.intent = parseIntent(raw || '');
  }
}
