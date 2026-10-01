// ===== تنظیمات ساب‌اسکریپشن =====
// موقع بیلد در GitHub Actions، اسم کاربری گیت‌هابت خودکار جایگزین میشه.
// اگه می‌خوای لینک کاملاً دلخواه بدی، توی Settings > Variables ریپو متغیر SUB_URL بساز.
const env = (import.meta as any).env || {};
const OWNER: string = env.VITE_GH_OWNER || 'YOUR_GITHUB_USERNAME';
const CUSTOM: string = env.VITE_SUB_URL || '';

export const SUB_URLS: string[] = [
  ...(CUSTOM ? [CUSTOM] : []),
  `https://raw.githubusercontent.com/${OWNER}/mahyarvpn-sub/main/sub.txt`,
  `https://cdn.jsdelivr.net/gh/${OWNER}/mahyarvpn-sub@main/sub.txt`,
];

export const PROXY_PORT = 12334;
export const API_PORT = 12335;
export const TEST_URL = 'https://www.gstatic.com/generate_204';
export const TEST_TIMEOUT = 5000;
