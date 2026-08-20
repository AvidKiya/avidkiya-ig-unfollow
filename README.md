# IG TOOLs - AvidKiya

جعبه‌ابزار **رایگان و متن‌باز** اینستاگرام برای Chrome / Edge (Manifest V3)، ساختهٔ Avid Kiya:

- 🧹 **انفالوور** — تشخیص کسانی که فالوبک نکرده‌اند + آنفالوی کنترل‌شده با Human Mode و لیست سفید
- 📣 **کامنت مارکتینگ** — پایش کامنت‌های **پست‌های خودت**، هشدار کلمهٔ کلیدی + پیش‌نویس دایرکت با یک کلیک (**ارسال همیشه دستی**)
- 🧠 **کامنت کوچ** — تشخیص پست‌های **تازهٔ زیر ۲۴ ساعت** روی اینستاگرام، بانک ایدهٔ کامنت، هدف روزانه و آمار؛ **کامنت را خودت می‌نویسی** — هیچ ارسال خودکاری وجود ندارد

**Free & open-source Instagram toolbox (MV3) by Avid Kiya:** unfollow manager, comment-marketing keyword alerts on your own posts (manual-send drafts), and a manual engagement coach that flags freshly-posted (<24h) content. **No auto-commenting, no auto-DM, no auto-liking — ever.**

- سازنده / Made by: **Avid Kiya** — [@avidkiya](https://instagram.com/avidkiya)
- پشتیبانی / Support: [Instagram](https://instagram.com/avidkiya) · [Telegram](https://t.me/avidkiya) · [X](https://x.com/avidkiya) · [GitHub](https://github.com/avidkiya)
- نسخه / Version: **4.2.0** · مجوز / License: [MIT](LICENSE)
- پیش‌نمایش UI / UI preview: [`docs/preview.html`](docs/preview.html) را در مرورگر باز کنید (Dark و Light).

---

# فارسی

## ✨ امکانات

- **اسکن زنده** با نمایش مرحلهٔ فعلی، تعداد صفحه‌ها، شمارش‌های real-time، نتایج موقت در حین اسکن و ** امکان Cancel واقعی**
- داشبورد آماری: Following / Followers / Non-followers / Protected / Unfollow امروز + تفاضل با اسکن قبلی
- فهرست Non-followers با **فیلترهای کامل** (جست‌وجو، Private/Public، Verified، Bio، تصویر، بازهٔ فالوئر/فالووینگ، دسته‌بندی فالوئر، مرتب‌سازی)
- **انتخاب هوشمند** (زیر 1K، زیر 3K، Private، بدون Bio، همه به‌جز Starred و …). اعضای «هرگز آنفالو نکن» **هرگز** در انتخاب گروهی نمی‌آیند
- لیست‌های محافظت‌شده: **Favorites** و **Never Unfollow** با Export/Import و اعتبارسنجی
- **Human Mode** پیش‌فرض فعال: تاخیر تصادفی، jitter طبیعی، استراحت بین batchها، توقف خودکار هنگام 429 / Action Block
- Presetهای Safe / Normal / Conservative / Custom + سقف روزانه
- **صف آنفالو پایدار** در `chrome.storage.local` — با بستن داشبورد از بین نمی‌رود و فقط با تأیید شما **Resume** می‌شود (هرگز خودکار)
- گزارش فعالیت: تاریخچهٔ اسکن‌ها، diff هر اسکن، تاریخچهٔ آنفالوها و **نمودار SVG داخلی**
- **📣 کامنت مارکتینگ**: پایش خودکار پست‌های خودت برای کلمات کلیدی + هشدار + پیش‌نویس دایرکت (ارسال دستی)
- **🧠 کامنت کوچ**: هدف روزانه + بانک ایده + ویجت شیشه‌ای روی instagram.com (تشخیص تازه‌بودن پست <24h و شمارش خودکار کامنت‌های خودت) + فهرست پست‌های تازهٔ اکسپلور
- **🤖 دستیار AI (Ollama لوکال)**: سه حالت دستی/خودکار/هوش مصنوعی؛ ایدهٔ کامنت از روی کپشن، پیش‌نویس هوشمند دایرکت و تحلیل نیت هشدارها — **ارسال همیشه با خودت**
- **⚡ صف توربو**: آماده‌سازی دسته‌ای متن (ایموجی نوبتی یا ایدهٔ AI) برای پست‌های تازه و چیدن یکی‌یکی جلوی تو — کپی + باز کردن پست + ارسال دستی در ~۳ ثانیه
- تم وبسایت **Liquid Glass** (Dark `#171717`/`#21F1A8` · Light `#F0EDE4`/`#004741` · System) با رابط **فارسی RTL / English** و فونت محلی **Vazirmatn**
- Export CSV/JSON برای همه‌چیز + Backup کامل داده‌های محلی

## 📣 کامنت مارکتینگ (سناریوی «کامنت کن تا فایل بدم»)

1. در تب **کامنت مارکتینگ** لینک پست **خودت** + کلمات کلیدی (مثل «آموزش، فایل») + لینک فایل و قالب پیام را ثبت کن.
2. سرویس‌ورکر هر دقیقه **یک** پست را (نوبتی، فقط-خواندنی) بررسی می‌کند. اگر اینستاگرام محدود کرد، ۱۵ دقیقه مکث خودکار.
3. هر کامنت حاوی کلمهٔ کلیدی → هشدار در صندوق + Notification کروم + نشان روی آیکن افزونه.
4. روی **«پیش‌نویس دایرکت»** بزن: متن قالب (با جایگذاری `{user}` و `{link}`) کپی می‌شود و صفحهٔ دایرکت باز می‌شود — **ارسال با خودت**. هشدار را «انجام شد» علامت بزن تا دوباره‌کاری پیش نیاید.

## 🧠 کامنت کوچ (دیده شدن واقعی، بدون اسپم)

1. یوزرنیم خودت را در **تنظیمات** بنویس (فقط برای تشخیص کامنت‌های خودت — لوکال می‌ماند).
2. هدف روزانه را تنظیم کن و **«شروع جلسه»** را بزن — تب Explore باز می‌شود و ویجت کوچ گوشهٔ صفحه ظاهر می‌شود.
3. وقتی پستی باز می‌کنی، ویجت می‌گوید **تازه‌ست (زیر ۲۴ ساعت 🔥) یا قدیمی** — روی تازه‌ها کامنت بگذار تا دیده شوی.
4. از **بانک ایده** الهام بگیر (دکمهٔ کپی) ولی **خودت شخصی‌اش کن و بفرست**؛ کوچ کامنت تو را تشخیص می‌دهد و می‌شمارد.
5. آمار امروز/هفته/روزهای پیاپی + تاریخچهٔ کامنت‌ها در تب **کامنت‌گذاری**. رسیدن به هدف = Notification تبریک 🏆

> **چرا ارسال خودکار ندارد؟** کامنتِ ثابتِ خودکار زیر پست غریبه‌ها دقیقاً تعریف اسپم است — سریع‌ترین راهِ Action Block و مخفی شدن کامنت‌ها از همه. این ابزار برای بهتر شدنِ توست، نه جایگزینی تو.

## 🔒 حریم خصوصی

- **هیچ داده‌ای به هیچ سروری ارسال نمی‌شود.** همه‌چیز فقط در `chrome.storage.local` ذخیره می‌شود.
- هیچ پروکسی خارجی برای تصاویر پروفایل استفاده نمی‌شود؛ تصاویر مستقیم از CDN اینستاگرام (با `referrerpolicy="no-referrer"`) بارگذاری می‌شوند.
- کوکی‌های نشست اینستاگرام فقط از طرف **مرورگر شما و مستقیم به اینستاگرام** ارسال می‌شوند؛ افزونه آن‌ها را ذخیره یا بازارسال نمی‌کند.
- بدون `eval`، بدون اسکریپت خارجی/CDN، بدون ردیابی، بدون تبلیغات، بدون پلن پولی.

## ⚙️ نحوهٔ نصب (Load Unpacked)

1. فایل ZIP را از حالت فشرده خارج کنید (یا مخزن را clone کنید).
2. در Chrome به آدرس `chrome://extensions` بروید (در Edge: `edge://extensions`).
3. گزینهٔ **Developer mode** را از گوشهٔ بالا-راست فعال کنید.
4. روی **Load unpacked** کلیک کنید و پوشهٔ پروژه (پوشه‌ای که `manifest.json` در آن است) را انتخاب کنید.
5. روی آیکن **IG Unfollow - AvidKiya** در نوار ابزار کلیک کنید تا داشبورد در یک تب مستقل باز شود.
6. قبل از اسکن، در همان مرورگر وارد [instagram.com](https://www.instagram.com/) شوید.

> برای تست زبان انگلیسی: از منوی بالای صفحه یا تب Settings زبان را روی English بگذارید؛ جهت صفحه به‌صورت خودکار LTR می‌شود.

## 🧭 نحوهٔ استفاده

1. از تب **Dashboard** دکمهٔ «شروع اسکن» را بزنید و پیشرفت زنده را تماشا کنید.
2. در تب **Non-followers** با فیلترها و انتخاب هوشمند، حساب‌های هدف را انتخاب کنید. افراد مهم را با ⭐ یا 🔒 محافظت کنید.
3. دکمهٔ «شروع آنفالو» را بزنید؛ **Modal تأیید** خلاصهٔ کامل (تعداد، دسته‌بندی، preset، زمان تقریبی و هشدار ریسک) را نشان می‌دهد.
4. پس از تأیید، صف با شمایل انسانی اجرا می‌شود؛ می‌توانید Pause / Stop / Clear کنید. اگر تب بسته شود، دفعهٔ بعد فقط دکمهٔ **Resume** را می‌بینید.

## ⚠️ محدودیت‌ها و مسئولیت کاربر

- **این ابزار هیچ وابستگی به Meta / Instagram ندارد** و محصول رسمی آن‌ها نیست.
- اینستاگرام ممکن است برای اقدامات پیاپی محدودیت موقت (**Action Block / 429**) اعمال کند. Human Mode ریسک را کم می‌کند اما **هیچ روش فنی تضمینی برای عدم محدودیت یا بن نیست**. مسئولیت استفاده با کاربر است.
- «تاریخ Follow» و «Last Active» از API قابل‌اعتمادی در دسترس نیست و این افزونه **عمداً آن‌ها را نمایش نمی‌دهد** تا دادهٔ جعلی تولید نشود.
- Bio و تعداد Follower/Following معمولاً در endpoint فهرست اینستاگرام وجود ندارد؛ در این موارد «—» نمایش داده می‌شود و فیلترهای مربوط فقط روی داده‌های موجود اعمال می‌شوند.
- اگر Endpointهای اینستاگرام تغییر کنند، فقط [`lib/config.js`](lib/config.js) و نرمالایزرهای [`lib/instagram-api.js`](lib/instagram-api.js) نیاز به به‌روزرسانی دارند.

## 🗂 ساختار پروژه

```
manifest.json          # Manifest V3
background.js          # Service worker: باز کردن داشبورد + seed تنظیمات
dashboard.html/.js     # رابط اصلی (تک‌صفحه‌ای، ES Modules)
style.css              # Design system — Dark #171717/#21F1A8 · Light #F0EDE4/#004741
lib/                   # config, instagram-api, storage, queue, i18n, export, theme
assets/                # fonts (Vazirmatn محلی)، icons، logo
docs/preview.html      # پیش‌نمایش استاتیک Dark/Light
README.md · CHANGELOG.md · LICENSE
```

> فایل `content.js` فقط برای **ویجت کامنت کوچ** روی instagram.com تزریق می‌شود (تشخیص تازگی پست + شمارش کامنت‌های *خودت*). هیچ تایپ/کلیک/ارسال خودکاری انجام نمی‌دهد. خواندن لیست‌ها و کامنت‌ها از context امن صفحهٔ افزونه با `credentials: 'include'` انجام می‌شود.
> ساختار ماژولی جدید: `lib/marketing.js` (پایش پست‌ها و هشدارها) و `lib/coach.js` (بانک ایده، آمار، هدف روزانه).

## 🚀 انتشار در GitHub

```bash
git init
git add .
git commit -m "IG Unfollow - AvidKiya v3.0.0"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

سپس در تنظیمات مخزن، بخش **About** را پر کنید و موضوع‌ها (Topics) مثل `chrome-extension`, `instagram`, `manifest-v3` را اضافه کنید. برای نسخه‌های بعدی، ZIP خروجی را در بخش **Releases** منتشر کنید. لینک Star مستقیم پروژه از متغیر `GITHUB_REPO_URL` در [`lib/config.js`](lib/config.js) قابل تنظیم است.

## 🤝 حمایت

این پروژه رایگان و متن‌باز است؛ حمایت شما با **Follow** و **Star** به ادامهٔ توسعه کمک می‌کند: [@avidkiya](https://instagram.com/avidkiya) — [GitHub](https://github.com/avidkiya)

---
---

# English

## 📣 Comment Marketing (the "comment to get the file" flow)

1. Register **your own** post URLs + keywords + a link and DM template in the **Comment Marketing** tab.
2. A service worker polls **one post per minute** (round-robin, read-only; 15-min auto-cooldown if rate-limited).
3. Keyword comments → inbox alert + Chrome notification + toolbar badge.
4. Hit **DM draft**: the template is filled (`{user}`, `{link}`), copied to your clipboard, and Instagram Direct opens — **you press send**. Mark alerts done to avoid repeat work.

## 🧠 Commenting Coach (real recognition, zero spam)

1. Put your own username in Settings (local only — used to recognize your comments).
2. Set a daily goal and start a session: Explore opens with a small coach widget.
3. Opening a post, the widget tells you if it's **fresh (<24h) 🔥** or old — prioritize fresh posts where comments actually get seen.
4. Get starters from the idea bank (copy button), personalize them and **post them yourself**; the coach detects and counts your comments.
5. Track today/week/streak stats and your comment log in the **Commenting Coach** tab. Goal reached = 🏆 notification.

> **Why no auto-posting?** Identical automated comments on strangers' posts are the definition of spam — the fastest route to action blocks and hidden comments. This tool makes *you* better; it doesn't replace you.

## ✨ Features

- **Live scan**: current step, pages read, real-time counters, in-progress temporary results, real **Cancel**
- Stats dashboard + diff vs. previous scan (new non-followers, new followers estimate, left-the-list)
- Full filter set, follower buckets (under 1K … 5K+), sorting, **smart select** — Never-Unfollow users are **never** bulk-selected
- Protected lists: **Favorites** & **Never Unfollow** (whitelist) with validated JSON import + CSV/JSON export
- **Human Mode** on by default: randomized delays, natural jitter, batch pauses, instant stop on **429 / Action Block**
- Presets: Safe (8/run, 20–40s) · Normal (15/run, 12–25s) · Conservative (5/run, 30–60s) · Custom + daily limit
- **Persistent queue** in `chrome.storage.local` — survives closing the dashboard; only resumes with your explicit confirmation, never automatically
- Activity report: scan history, per-scan diffs, unfollow history with filters, **internal SVG chart** (no libraries)
- **📣 Comment Marketing**: watch your own posts for keyword comments, alerts + DM drafts (manual send)
- **🧠 Commenting Coach**: daily goal + idea bank + glass overlay on instagram.com (detects fresh <24h posts and auto-counts your own comments) + fresh Explore feed
- **🤖 AI assistant (local Ollama)**: Manual/Automatic/AI modes; caption-based comment ideas, smart DM drafts, intent tags on alerts — **you always press send**
- **⚡ Turbo Queue**: batch-prepare texts (rotating emojis or AI ideas) for fresh posts, served one-by-one — copy + open post + manual send in ~3s
- **Dark / Light / System** theme, **Persian RTL / English** UI, local **Vazirmatn** font
- CSV/JSON exports everywhere, full backup & restore

## 🔒 Privacy

- **Zero data leaves your machine.** Everything lives in `chrome.storage.local`.
- No external proxy for profile pictures; images come straight from Instagram's CDN with `referrerpolicy="no-referrer"`.
- Instagram session cookies are only attached by **your browser, to Instagram**. The extension never stores or forwards them.
- No `eval`, no remote/CDN scripts, no tracking, no ads, no paywall.

## ⚙️ Install (Load Unpacked)

1. Unzip the release (or clone the repo).
2. Go to `chrome://extensions` (Edge: `edge://extensions`).
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Click the **IG Unfollow - AvidKiya** toolbar icon — the dashboard opens in its own tab.
6. Log in to [instagram.com](https://www.instagram.com/) in the same browser, then run a scan.

## ⚠️ Limitations & responsibility

- This tool **is not affiliated with Meta / Instagram**.
- Instagram may temporarily limit bulk actions (**Action Block / 429**). Human Mode reduces risk but **no technical method can guarantee your account won't be limited or banned**. Use at your own risk.
- "Followed since" and "Last active" are **not reliably available** via the API and are intentionally not shown — no fake data.
- If Instagram changes its endpoints, only [`lib/config.js`](lib/config.js) and the normalizers in [`lib/instagram-api.js`](lib/instagram-api.js) need updates.

## 🤝 Support

Free & open source. A **Follow** and a **Star** keep development going: [@avidkiya](https://instagram.com/avidkiya) — [GitHub](https://github.com/avidkiya)
