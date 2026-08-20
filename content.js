/**
 * IG TOOLs - AvidKiya — content script (instagram.com).
 *
 * STRICTLY manual-assist:
 *  - Shows the Engagement Coach overlay while a coach session is active.
 *  - Reads the current post's <time datetime> to flag fresh posts (<24h).
 *  - Watches the DOM: when YOU post a comment (author link = your username),
 *    it reports it to the background for goal tracking.
 *  - Idea bank: click to cycle, click to COPY (clipboard) — you paste, adapt,
 *    and press Post yourself. This script never types, clicks Post, likes,
 *    or submits anything.
 */

(() => {
  'use strict';

  const COACH_KEY = 'coach_state';
  const SETTINGS_KEY = 'settings';
  const OVERLAY_ID = 'igtools-coach-overlay';
  const FRESH_WINDOW_H = 24;

  let coach = null;
  let igUsername = '';
  let bank = [];
  let bankIdx = 0;
  let currentShort = null;
  let currentFresh = null;
  let reportedShorts = new Set(); // anti double-report within this page session
  let overlayEl = null;
  let observer = null;

  // ----------------------------------------------------------- storage sync
  async function loadState() {
    const data = await chrome.storage.local.get([COACH_KEY, SETTINGS_KEY]);
    coach = data[COACH_KEY] || null;
    igUsername = (data[SETTINGS_KEY]?.igUsername || '').replace(/^@/, '').trim();
    bank = [...(coach?.customBank || [])];
    // merge built-in starters (duplicated-lite; full bank lives in dashboard)
    const builtIn = await loadBuiltInBank();
    bank = [...builtIn, ...bank];
  }

  async function loadBuiltInBank() {
    try {
      const mod = await import(chrome.runtime.getURL('lib/coach.js'));
      return (mod.BANK_FA || []).map((b) => b.text);
    } catch {
      return [];
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[COACH_KEY]) {
      const prev = coach;
      coach = changes[COACH_KEY].newValue;
      if (coach?.active && !prev?.active) showOverlay();
      if (!coach?.active && prev?.active) hideOverlay();
      if (coach?.active) refreshOverlay();
    }
    if (changes[SETTINGS_KEY]) {
      igUsername = (changes[SETTINGS_KEY].newValue?.igUsername || '').replace(/^@/, '').trim();
    }
  });

  // --------------------------------------------------------------- overlay
  function showOverlay() {
    if (document.getElementById(OVERLAY_ID)) { refreshOverlay(); return; }
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.innerHTML = `
      <div class="igt-hd">
        <span class="igt-logo">🧠 <b>کامنت کوچ</b></span>
        <span class="igt-prog" data-role="prog">۰/۰</span>
        <button class="igt-x" data-role="close" title="پایان جلسه">×</button>
      </div>
      <div class="igt-bar"><i data-role="bar"></i></div>
      <div class="igt-fresh" data-role="fresh">پستی باز نیست</div>
      <div class="igt-idea" data-role="idea" title="کلیک: ایدهٔ بعدی"></div>
      <div class="igt-row">
        <button class="igt-btn" data-role="next">💡 ایدهٔ بعدی</button>
        <button class="igt-btn igt-copy" data-role="copy">📋 کپی ایده</button>
      </div>
      <div class="igt-note">کامنت را خودت بنویس و بفرست — ما فقط کنارت هستیم تا واقعی بمونی ✋</div>
      <div class="igt-warn" data-role="warn"></div>`;
    (document.documentElement || document.body).appendChild(overlayEl);

    overlayEl.querySelector('[data-role="close"]').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ scope: 'coach', type: 'set', patch: { active: false } });
      hideOverlay();
    });
    overlayEl.querySelector('[data-role="next"]').addEventListener('click', nextIdea);
    overlayEl.querySelector('[data-role="idea"]').addEventListener('click', nextIdea);
    overlayEl.querySelector('[data-role="copy"]').addEventListener('click', copyIdea);
    refreshOverlay();
    if (!igUsername) showWarn('برای شمارش کامنت‌ها، username اینستاگرامت را در تنظیمات IG TOOLs بنویس.');
  }

  function hideOverlay() {
    overlayEl?.remove();
    overlayEl = null;
  }

  function faNum(n) {
    try { return new Intl.NumberFormat('fa-IR').format(n); } catch { return String(n); }
  }

  function showWarn(msg) {
    const w = overlayEl?.querySelector('[data-role="warn"]');
    if (w) w.textContent = msg || '';
  }

  function nextIdea() {
    if (!bank.length) return;
    bankIdx = (bankIdx + 1) % bank.length;
    refreshOverlay();
  }

  async function copyIdea() {
    const idea = overlayEl?.querySelector('[data-role="idea"]')?.textContent?.trim();
    if (!idea) return;
    try {
      const ta = document.createElement('textarea');
      ta.value = idea;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      const btn = overlayEl.querySelector('[data-role="copy"]');
      btn.textContent = '✓ کپی شد';
      setTimeout(() => { if (btn.isConnected) btn.textContent = '📋 کپی ایده'; }, 1200);
    } catch { /* clipboard unavailable — user selects manually */ }
  }

  function refreshOverlay() {
    if (!overlayEl || !coach) return;
    const prog = overlayEl.querySelector('[data-role="prog"]');
    const bar = overlayEl.querySelector('[data-role="bar"]');
    const idea = overlayEl.querySelector('[data-role="idea"]');
    prog.textContent = `${faNum(coach.done || 0)}/${faNum(coach.goal || 20)} امروز`;
    const pct = Math.min(100, Math.round(((coach.done || 0) / (coach.goal || 20)) * 100));
    bar.style.width = pct + '%';
    bar.classList.toggle('igt-full', pct >= 100);
    idea.textContent = bank[bankIdx] || '';
    updateFreshBadge();
  }

  // ------------------------------------------------------- freshness (<24h)
  function updateFreshBadge() {
    const badge = overlayEl?.querySelector('[data-role="fresh"]');
    if (!badge) return;
    if (!currentShort) {
      badge.className = 'igt-fresh';
      badge.textContent = 'پستی باز نیست — از اکسپلور یکی رو باز کن';
      return;
    }
    const t = findPostTime();
    if (!t) {
      badge.className = 'igt-fresh';
      badge.textContent = '⏱ تاریخ پست پیدا نشد';
      return;
    }
    const h = (Date.now() - t.getTime()) / 3600_000;
    currentFresh = h < FRESH_WINDOW_H;
    if (currentFresh) {
      badge.className = 'igt-fresh igt-ok';
      badge.textContent = h < 1
        ? '🔥 تازه (کمتر از یک ساعت) — بهترین زمان برای کامنت!'
        : `✅ تازه (${faNum(Math.floor(h))} ساعت پیش) — زیر ۲۴ ساعت`;
    } else {
      badge.className = 'igt-fresh igt-old';
      badge.textContent = `⏳ قدیمی (${faNum(Math.floor(h / 24))} روز پیش) — اولویت با پست‌های تازه`;
    }
  }

  function findPostTime() {
    // Post dialog/feed article: the FIRST <time datetime> of the main article
    // is the post's own timestamp (comments' times come later in DOM order).
    const article = document.querySelector('div[role="dialog"] article, article');
    const scope = article || document;
    for (const t of scope.querySelectorAll('time[datetime]')) {
      const d = new Date(t.getAttribute('datetime'));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  }

  // -------------------------------------------------- current post tracker
  function shortcodeFromLocation() {
    const m = location.pathname.match(/\/(?:p|reel|reels)\/([A-Za-z0-9_-]{5,20})/);
    return m ? m[1] : null;
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl || currentShort !== shortcodeFromLocation()) {
      lastUrl = location.href;
      const next = shortcodeFromLocation();
      if (next !== currentShort) {
        currentShort = next;
        currentFresh = null;
        // DOM needs a beat to render the post; check freshness shortly after
        setTimeout(updateFreshBadge, 900);
        setTimeout(updateFreshBadge, 2400); // second pass for slow loads
      }
    }
  }, 600);

  // --------------------------------------------- own-comment detection
  function startObserver() {
    observer?.disconnect();
    observer = new MutationObserver(() => {
      if (!coach?.active || !igUsername || !currentShort) return;
      if (reportedShorts.has(currentShort)) return;
      const path = `/${igUsername}/`;
      // Look for freshly-rendered comments authored by the user inside the
      // post dialog or feed article — never the header/profile areas.
      const scopes = document.querySelectorAll('div[role="dialog"], article');
      for (const scope of scopes) {
        const links = scope.querySelectorAll(`a[href="${path}"]`);
        for (const link of links) {
          // A comment block has author-link AND some nearby non-empty text.
          const block = link.closest('li, div');
          if (!block || block.__igtoolsSeen) continue;
          const textAround = block.textContent || '';
          if (textAround.replace(igUsername, '').trim().length < 2) continue; // nav/avatar link
          block.__igtoolsSeen = true;
          reportedShorts.add(currentShort);
          chrome.runtime
            .sendMessage({
              scope: 'coach', type: 'commentDone',
              shortcode: currentShort, url: location.href.split('?')[0], fresh: currentFresh,
            })
            .then((res) => {
              if (res?.ok) {
                coach = { ...coach, done: res.done };
                refreshOverlay();
                flashDone(res.done >= res.goal);
              }
            })
            .catch(() => {});
          return;
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true });
  }

  function flashDone(isGoal) {
    if (!overlayEl) return;
    overlayEl.classList.add('igt-flash');
    const note = overlayEl.querySelector('.igt-note');
    if (note) note.textContent = isGoal ? '🏆 هدف امروز کامل شد — فوق‌العاده‌ای!' : '✓ ثبت شد! بریم پست بعدی';
    setTimeout(() => overlayEl?.classList.remove('igt-flash'), 900);
    setTimeout(() => { if (note) note.textContent = 'کامنت را خودت بنویس و بفرست — ما فقط کنارت هستیم تا واقعی بمونی ✋'; }, 4000);
  }

  // ------------------------------------------------------------------- init
  (async function init() {
    await loadState();
    currentShort = shortcodeFromLocation();
    if (coach?.active) showOverlay();
    startObserver();
  })();
})();
