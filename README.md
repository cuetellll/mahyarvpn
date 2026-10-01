# MahyarVPN

کلاینت VPN ویندوز با **sing-box 1.14**، رابط کاربری مدرن (انیمیشن و glow)، فارسی/انگلیسی، حالت **TUN** و **System Proxy**.

## امکانات
- پروتکل‌ها: VLESS (Reality / TLS / WS / gRPC / HTTPUpgrade)، VMess، Trojan، Shadowsocks، Hysteria2، TUIC
- دکمه **دریافت کانفیگ**: ساب‌اسکریپشن رو می‌گیره و لیست رو بروز می‌کنه (بدون آپدیت برنامه)
- **تست پینگ واقعی**: درخواست HTTP واقعی از داخل هر سرور (نه ICMP)
- **انتخاب خودکار**: بهترین پینگ وصل میشه؛ اگه وصل نشد، میره سراغ بعدی (تا ۳ سرور)
- یا خودت از لیست انتخاب کن (وسط اتصال هم سوییچ میشه)
- خروجی: **Setup.exe** (نصبی) و **Portable.zip**

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
