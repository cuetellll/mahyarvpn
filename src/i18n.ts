export type Lang = 'fa' | 'en';

export const t = {
  fa: {
    connect: 'اتصال', disconnect: 'قطع', idle: 'متصل نیستید', connecting: 'در حال اتصال...', connected: 'متصل شدید',
    getConfigs: 'دریافت کانفیگ', fetching: 'در حال دریافت...', testPing: 'تست پینگ', testing: 'در حال تست...',
    auto: 'انتخاب خودکار بهترین سرور', servers: 'سرورها', tunHint: 'کل سیستم', proxyHint: 'پروکسی سیستم',
    noConfigs: 'هنوز کانفیگی نیست. «دریافت کانفیگ» رو بزن.',
    updated: (n: number, s: number) => `${n} کانفیگ بروز شد${s ? ` (${s} پشتیبانی نشد)` : ''}`,
    fetchErr: 'دریافت کانفیگ ناموفق بود', connErr: 'اتصال ناموفق بود', noWorking: 'هیچ سروری جواب نداد',
    noValid: 'هیچ کانفیگ معتبری پیدا نشد', dropped: 'اتصال قطع شد',
    adminTitle: 'حالت TUN دسترسی ادمین می‌خواد', adminText: 'برای تونل کردن کل سیستم، برنامه باید با Administrator اجرا بشه.',
    relaunch: 'اجرای دوباره با ادمین', useProxy: 'برو روی حالت Proxy', cancel: 'بیخیال',
    timeout: 'تایم‌اوت', best: 'بهترین', current: 'سرور فعلی', autoPick: 'خودکار (بهترین پینگ)',
  },
  en: {
    connect: 'Connect', disconnect: 'Disconnect', idle: 'Not connected', connecting: 'Connecting...', connected: 'Connected',
    getConfigs: 'Get configs', fetching: 'Fetching...', testPing: 'Test ping', testing: 'Testing...',
    auto: 'Auto-select best server', servers: 'Servers', tunHint: 'Whole system', proxyHint: 'System proxy',
    noConfigs: 'No configs yet. Tap "Get configs".',
    updated: (n: number, s: number) => `${n} configs updated${s ? ` (${s} unsupported)` : ''}`,
    fetchErr: 'Failed to get configs', connErr: 'Connection failed', noWorking: 'No server responded',
    noValid: 'No valid config found', dropped: 'Connection dropped',
    adminTitle: 'TUN mode needs admin', adminText: 'To tunnel the whole system, the app must run as Administrator.',
    relaunch: 'Restart as admin', useProxy: 'Use Proxy mode', cancel: 'Cancel',
    timeout: 'timeout', best: 'Best', current: 'Current server', autoPick: 'Auto (best ping)',
  },
};
