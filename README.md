# MahyarVPN

کلاینت VPN ویندوز با **sing-box 1.14**، رابط کاربری مدرن (انیمیشن و glow)، فارسی/انگلیسی، حالت **TUN** و **System Proxy**.

## امکانات
- پروتکل‌ها: VLESS (Reality / TLS / WS / gRPC / HTTPUpgrade)، VMess، Trojan، Shadowsocks، Hysteria2، TUIC
- دکمه **دریافت کانفیگ**: ساب‌اسکریپشن رو می‌گیره و لیست رو بروز می‌کنه (بدون آپدیت برنامه)
- **تست پینگ واقعی**: درخواست HTTP واقعی از داخل هر سرور (نه ICMP)
- **انتخاب خودکار**: بهترین پینگ وصل میشه؛ اگه وصل نشد، میره سراغ بعدی (تا ۳ سرور)
- یا خودت از لیست انتخاب کن (وسط اتصال هم سوییچ میشه)
- خروجی: **Setup.exe** (نصبی) و **Portable.zip**


## MahyarVPN 2.0 · رابط کاربری «Orbit» (از صفر بازطراحی شد)
- **کره‌ی زمین سه‌بعدی زنده**: سرورها روی نقشه با پالس نشون داده میشن؛ موقع اتصال یه کمان نورانی از موقعیت تو تا سرور کشیده میشه و پکت‌ها روش حرکت می‌کنن
- **دکمه‌ی اتصال جدید**: حلقه‌ی گرادیانی چرخان، حالت مغناطیسی (دنبال موس میاد)، موج شوک موقع وصل شدن، آیکن که از پاور به سپر تبدیل میشه
- **ناوبری کناری** با ۴ صفحه: داشبورد، سرورها، آمار، تنظیمات (در پنجره‌ی باریک، داک پایین)
- **پالت دستورات** با `Ctrl+K`: هر کاری یا هر سروری رو تایپ کن و Enter
- **صفحه‌ی آمار**: نمودار زنده‌ی ترافیک، بیشترین/میانگین سرعت، توزیع پینگ سرورها، سهم پروتکل‌ها
- **تنظیمات**: کارت‌های حالت TUN/Proxy، ۴ تم رنگی (بنفش نئونی، آبی یخی، زمردی، غروب)، زبان، کاهش انیمیشن
- اتصال مستقیم به سریع‌ترین سرور، دابل‌کلیک روی هر سرور = اتصال، علاقه‌مندی‌ها، فیلتر پروتکل
- مجموعه آیکن اختصاصی duotone، افکت نور زیر موس روی کارت‌ها، شمارنده‌ی عددی انیمیشنی، اسپلش‌اسکرین
- میانبرها: `Ctrl+K` پالت · `Ctrl+Enter` اتصال · `F5` کانفیگ · `Ctrl+T` پینگ · `Ctrl+F` جستجو · `Ctrl+1..4` صفحه‌ها · `F11` تمام‌صفحه
- اندازه‌ی پیش‌فرض پنجره: 1080×700 (حداقل 420×640)

---

## ۱) ساخت ساب‌اسکریپشن (یک بار)
1. توی گیت‌هاب یه ریپوی **Public** جدید بساز به اسم دقیقاً `mahyarvpn-sub`
2. یه فایل `sub.txt` توش بساز و کانفیگ‌هات رو بذار، **هر خط یه لینک** (نمونه: `sub-repo-example/sub.txt`)
   - اگه لینک ساب از پنل (مثل Marzban/3x-ui/Hiddify) داری، محتوای base64 هم قبوله
3. تمام. برنامه خودش از این آدرس‌ها می‌خونه:
   - `https://raw.githubusercontent.com/<USERNAME>/mahyarvpn-sub/main/sub.txt`
   - میرور (اگه raw فیلتر بود): `https://cdn.jsdelivr.net/gh/<USERNAME>/mahyarvpn-sub@main/sub.txt`

`<USERNAME>` موقع بیلد خودکار از اسم اکانت گیت‌هابت پر میشه، لازم نیست کد رو دست بزنی.

**هر وقت خواستی کانفیگ‌ها رو عوض کنی:** فقط `sub.txt` رو ادیت و Commit کن. کاربر دکمه «دریافت کانفیگ» رو می‌زنه و بروز میشه.
> jsDelivr تا ۱۲ ساعت کش می‌کنه؛ برای پاک کردن فوری کش این آدرس رو باز کن:
> `https://purge.jsdelivr.net/gh/<USERNAME>/mahyarvpn-sub@main/sub.txt`

**لینک دلخواه (اختیاری):** اگه ساب پنل خودت یا Cloudflare Worker داری، توی ریپوی برنامه برو به
`Settings → Secrets and variables → Actions → Variables` و متغیر `SUB_URL` بساز. اون اولویت اول میشه.

> ⚠️ ریپوی Public یعنی هر کی آدرس رو داشته باشه کانفیگ‌ها رو می‌بینه. اگه مهمه، از ساب پنل خودت (SUB_URL) استفاده کن.

## ۲) گرفتن EXE از GitHub Actions
1. این پروژه رو توی یه ریپو (مثلاً `mahyarvpn`) Push کن
2. تب **Actions** → `Build MahyarVPN` → **Run workflow**
3. بعد از ~۱۰ دقیقه، پایین صفحه‌ی همون Run بخش **Artifacts** → `MahyarVPN-Windows` (Setup + Portable)

برای ریلیز رسمی تگ بزن:
```bash
git tag v1.0.0 && git push origin v1.0.0
```
فایل‌ها توی تب **Releases** قرار می‌گیرن.

sing-box نسخه 1.14 خودکار از ریلیز رسمی SagerNet دانلود و کنار برنامه بسته‌بندی میشه.

## ۳) اجرای لوکال (اختیاری)
پیش‌نیاز: Node 20، Rust، WebView2
```bash
# sing-box.exe خودت رو بذار اینجا: src-tauri/bin/sing-box.exe
npm install
npm run tauri dev
```

## نکات
- **TUN** کل سیستم رو تونل می‌کنه و دسترسی Administrator می‌خواد (برنامه خودش پیشنهاد اجرای دوباره با ادمین رو میده)
- **Proxy** پروکسی ویندوز رو روی `127.0.0.1:12334` تنظیم می‌کنه (HTTP + SOCKS) و موقع خروج خودکار برش می‌گردونه
- xhttp / splithttp توسط sing-box پشتیبانی نمیشن و رد میشن
- لاگ‌ها: `%APPDATA%\com.mahyar.vpn\core.log`

## تغییرات نسخه 1.1
- Maximize و فول‌اسکرین (F11) با چیدمان دوستونه در صفحه‌ی بزرگ
- سرعت لحظه‌ای دانلود/آپلود، مصرف کل و نمایش IP و کشور خروجی (چک واقعی اینترنت بعد از اتصال)
- نمایش کد کشور به‌جای ایموجی پرچم (ویندوز پرچم نشون نمیده)
- جستجو و مرتب‌سازی سرورها بر اساس پینگ، نوار کیفیت پینگ، انیمیشن‌های بیشتر

## v2.1 changes
- Home: connect button moved to the center under the globe (bigger, with a label), status and timer centered under it.
- Globe: real continents (Natural Earth land mask, `src/land.ts`), orbit ring now goes behind the planet, thinner atmosphere, background stars, calmer background.
- System tray: minimize / X hides to tray. Left-click the tray icon = open, right-click = connect/disconnect, open, quit. The icon gets a green dot when connected. Full exit: tray menu > Quit.

## v2.2 changes
- New connect icon: power glyph draws in, spins while connecting, morphs to a shield + check when connected.
- Animated wavy MAHYARVPN title at the top of the dashboard (VPN part turns green when connected).
- Single instance (tauri-plugin-single-instance): launching again just brings the window back.
- Start with Windows (tauri-plugin-autostart, starts hidden in tray) + Auto-connect toggle in Settings.
- Windows notification on connect/disconnect while hidden in tray (tauri-plugin-notification).
- Empty-state card on the dashboard when there are no configs; duplicate status chip removed.

## v2.3 · اسکن هوشمند ساب‌های عمومی
- **ساب عمومی** (پیش‌فرض: `4n0nymou3/multi-proxy-config-fetcher`، با میرور jsDelivr) کنار ساب شخصی خودت
- همه‌ی کانفیگ‌های ساب عمومی نمیاد تو برنامه: با **اینترنت خود کاربر** تست میشن و فقط **۱۰ تای کم‌پینگ** نگه داشته میشه (۵/۱۰/۱۵/۲۰ از تنظیمات)
- اسکن دو مرحله‌ای:
  1. اتصال TCP موازی به همه (۱۲۸ تا همزمان) → مرده‌ها و فیلترشده‌ها حذف
  2. تست HTTP واقعی از داخل تونل (sing-box) روی بهترین‌ها، با تنوع (حداکثر ۳ کانفیگ از یه سرور)
- کانفیگ‌هایی که قطعاً خرابن (UUID غلط، رمز ss ناشناخته، reality بدون کلید) همون اول کنار میرن؛ اگه یه کانفیگ خراب کل یه دسته رو رد کنه، دسته نصف میشه تا فقط همون حذف بشه
- اگه وسط اتصال TUN اسکن کنی، تونل موقتاً قطع میشه که تست با نت واقعی باشه و بعد خودش دوباره وصل میشه
- **ساب دلخواه**: از تنظیمات لینک ساب اضافه کن، روشن/خاموش کن
- **اسکن دوباره** (`Ctrl+R`): بدون دانلود مجدد، از همون استخر قبلی دوباره سریع‌ترین‌ها رو پیدا می‌کنه
- UI: پنل زنده‌ی اسکن (قیف دریافت ← زنده ← تست واقعی ← برترین‌ها)، رتبه‌ی طلایی/نقره‌ای/برنزی روی کارت سرورها، پیل رنگی پینگ، گروه ابزار با tooltip، سه‌تا سریع‌ترین روی داشبورد برای اتصال یه‌کلیکی، فیلتر «برترین‌ها / شخصی»
- علاقه‌مندی‌ها از ساب عمومی بعد از اسکن دوباره حذف نمیشن
