import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent as RME } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { decodeSubscription, parseLinks, type VNode } from './parser';
import { buildConfig, buildTestConfig } from './singbox';
import { SUB_URLS, PROXY_PORT, TEST_URL, TEST_TIMEOUT } from './config';
import { t, type Lang } from './i18n';
import { I } from './icons';
import { GEO, ccHue } from './geo';
import Globe from './components/Globe';
import { Area, Count } from './components/bits';

type Status = 'idle' | 'connecting' | 'connected';
type Mode = 'tun' | 'proxy';
type Page = 'home' | 'servers' | 'stats' | 'settings';
type Step = '' | 'test' | 'start' | 'switch';
type Theme = 'violet' | 'cyan' | 'emerald' | 'sunset';
type IpInfo = { query: string; country: string; countryCode: string } | null;
type Toast = { id: number; msg: string; type: 'ok' | 'err' };

const VERSION = '2.0.0';
const HIST = 90;
const PAGES: Page[] = ['home', 'servers', 'stats', 'settings'];
const THEMES: Record<Theme, [string, string]> = {
  violet: ['#8b5cff', '#ff4fd8'], cyan: ['#22d3ee', '#3b82f6'], emerald: ['#10f5a8', '#22d3ee'], sunset: ['#ff7a45', '#ff3d81'],
};
const ST: Record<Status, string> = { idle: '#ff5a7a', connecting: '#ffb547', connected: '#10f5a8' };

const load = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const errMsg = (e: unknown) => String((e as any)?.message ?? e).split('\n').slice(-3).join(' ').slice(0, 220);
const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
const fmtBytes = (b: number) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const pingClass = (p?: number) => (p === undefined ? '' : p < 0 ? 'bad' : p < 300 ? 'good' : p < 700 ? 'mid' : 'slow');
const pingLevel = (p?: number) => (p === undefined || p < 0 ? 0 : p < 150 ? 5 : p < 300 ? 4 : p < 500 ? 3 : p < 800 ? 2 : 1);

/** ویندوز ایموجی پرچم رو نشون نمیده؛ تبدیلش می‌کنیم به کد کشور */
const FLAG = /([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/u;
function splitFlag(name: string): { cc: string; label: string } {
  const m = name.match(FLAG);
  if (!m) return { cc: '', label: name.trim() };
  const cc = String.fromCharCode(m[1].codePointAt(0)! - 0x1f1e6 + 65, m[2].codePointAt(0)! - 0x1f1e6 + 65);
  return { cc, label: name.replace(FLAG, '').replace(/^[\s|\-–_]+/, '').trim() || cc };
}
const transportOf = (n: VNode) => (n.outbound.tls?.reality ? 'reality' : n.outbound.transport?.type || '');

/* ---------- tiny UI atoms ---------- */
const Flag = ({ cc, size = 'm' }: { cc: string; size?: 's' | 'm' | 'l' }) => (
  <span className={`flag ${size}`} style={{ ['--h' as any]: ccHue(cc) } as CSSProperties}>{cc || '··'}</span>
);
const Meter = ({ p }: { p?: number }) => {
  const l = pingLevel(p);
  return <span className={`meter ${pingClass(p)}`}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= l ? 'on' : ''} style={{ animationDelay: `${i * 40}ms` }} />)}</span>;
};
const Switch = ({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
  <button className={`sw ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} role="switch" aria-checked={on}><i /></button>
);
const Card = ({ className = '', children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) => (
  <div className={`glass ${className}`} style={style}>{children}</div>
);
const Kbd = ({ k }: { k: string }) => <span className="kbds">{k.split('+').map((x) => <kbd key={x}>{x}</kbd>)}</span>;

export default function App() {
  const [lang, setLang] = useState<Lang>(() => load('lang', 'fa'));
  const [mode, setMode] = useState<Mode>(() => load('mode', 'tun'));
  const [auto, setAuto] = useState<boolean>(() => load('auto', true));
  const [sortPing, setSortPing] = useState<boolean>(() => load('sortPing', false));
  const [links, setLinks] = useState<string[]>(() => load('links', []));
  const [selected, setSelected] = useState<string | null>(() => load('selected', null));
  const [pings, setPings] = useState<Record<string, number>>(() => load('pings', {}));
  const [favs, setFavs] = useState<string[]>(() => load('favs', []));
  const [fetchedAt, setFetchedAt] = useState<number>(() => load('fetchedAt', 0));
  const [theme, setTheme] = useState<Theme>(() => load('theme', 'violet'));
  const [reduce, setReduce] = useState<boolean>(() => load('reduce', false));
  const [status, setStatus] = useState<Status>('idle');
  const [step, setStep] = useState<Step>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'fetch' | 'test'>('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [adminAsk, setAdminAsk] = useState(false);
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [speed, setSpeed] = useState({ up: 0, down: 0, total: 0 });
  const [hist, setHist] = useState<{ d: number; u: number }[]>([]);
  const [ip, setIp] = useState<IpInfo | 'loading' | 'fail'>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState<Page>('home');
  const [maxed, setMaxed] = useState(false);
  const [splash, setSplash] = useState(true);
  const [pal, setPal] = useState(false);
  const [palQ, setPalQ] = useState('');
  const [palI, setPalI] = useState(0);
  const [flash, setFlash] = useState(0);
  const [shake, setShake] = useState(false);
  const testingRef = useRef(false);
  const lastStats = useRef<[number, number] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const palRef = useRef<HTMLInputElement>(null);
  const magRef = useRef<HTMLDivElement>(null);
  const T = t[lang];
  const win = getCurrentWindow();
  const [a1, a2] = THEMES[theme];

  const nodes = useMemo(() => parseLinks(links).nodes, [links]);
  const protocols = useMemo(() => Array.from(new Set(nodes.map((n) => n.protocol))), [nodes]);
  const online = useMemo(() => nodes.filter((n) => (pings[n.id] ?? -1) > 0).length, [nodes, pings]);
  const tested = useMemo(() => nodes.filter((n) => pings[n.id] !== undefined).length, [nodes, pings]);
  const bestId = useMemo(() => {
    const ok = nodes.filter((n) => (pings[n.id] ?? -1) > 0);
    return ok.length ? ok.reduce((a, b) => (pings[a.id] <= pings[b.id] ? a : b)).id : null;
  }, [nodes, pings]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = q ? nodes.filter((n) => n.name.toLowerCase().includes(q) || n.protocol.includes(q)) : nodes;
    if (filter === 'fav') list = list.filter((n) => favs.includes(n.id));
    else if (filter !== 'all') list = list.filter((n) => n.protocol === filter);
    const fav = (n: VNode) => (favs.includes(n.id) ? 0 : 1);
    const v = (n: VNode) => { const p = pings[n.id]; return p === undefined ? 1e9 : p < 0 ? 1e10 : p; };
    return [...list].sort((a, b) => fav(a) - fav(b) || (sortPing ? v(a) - v(b) : 0));
  }, [nodes, query, sortPing, pings, filter, favs]);
  const markers = useMemo(() => Array.from(new Set(nodes.map((n) => splitFlag(n.name).cc).filter((c) => c && GEO[c]))), [nodes]);
  const active = nodes.find((n) => n.id === activeId);
  const selNode = nodes.find((n) => n.id === selected);
  const bestNode = nodes.find((n) => n.id === bestId);
  const shownNode = status !== 'idle' ? active ?? (auto ? bestNode : selNode) : auto ? bestNode : selNode;
  const shownFlag = shownNode ? splitFlag(shownNode.name) : null;

  useEffect(() => save('lang', lang), [lang]);
  useEffect(() => save('mode', mode), [mode]);
  useEffect(() => save('auto', auto), [auto]);
  useEffect(() => save('sortPing', sortPing), [sortPing]);
  useEffect(() => save('links', links), [links]);
  useEffect(() => save('selected', selected), [selected]);
  useEffect(() => save('pings', pings), [pings]);
  useEffect(() => save('favs', favs), [favs]);
  useEffect(() => save('fetchedAt', fetchedAt), [fetchedAt]);
  useEffect(() => save('theme', theme), [theme]);
  useEffect(() => save('reduce', reduce), [reduce]);
  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => { if (filter !== 'all' && filter !== 'fav' && !protocols.includes(filter)) setFilter('all'); }, [protocols]); // eslint-disable-line
  useEffect(() => { const id = window.setTimeout(() => setSplash(false), 1700); return () => window.clearTimeout(id); }, []);
  useEffect(() => { if (pal) { setPalQ(''); setPalI(0); window.setTimeout(() => palRef.current?.focus(), 30); } }, [pal]);

  const actions = useRef({ toggle: () => {}, updateConfigs: () => {}, testAll: () => {} });

  // کیبورد
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'F11') { e.preventDefault(); await win.setFullscreen(!(await win.isFullscreen())); }
      if (e.key === 'Escape') { setPal(false); if (await win.isFullscreen()) await win.setFullscreen(false); }
      if (e.key === 'F5') { e.preventDefault(); actions.current.updateConfigs(); }
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); actions.current.toggle(); }
      if (e.ctrlKey && k === 't') { e.preventDefault(); actions.current.testAll(); }
      if (e.ctrlKey && k === 'k') { e.preventDefault(); setPal((v) => !v); }
      if (e.ctrlKey && k === 'f') { e.preventDefault(); setPage('servers'); window.setTimeout(() => searchRef.current?.focus(), 200); }
      if (e.ctrlKey && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); setPage(PAGES[Number(e.key) - 1]); }
    };
    const onResize = () => win.isMaximized().then(setMaxed).catch(() => {});
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    onResize();
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize); };
  }, []); // eslint-disable-line

  // ripple + spotlight
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.rp');
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const s = document.createElement('span');
      const size = Math.max(r.width, r.height) * 2.2;
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      window.setTimeout(() => s.remove(), 700);
    };
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement).closest?.<HTMLElement>('.glass, .srv');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('pointermove', onMove);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('pointermove', onMove); };
  }, []);

  useEffect(() => {
    if (status === 'connected') return;
    const id = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(id);
  }, [status]);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-2), { id, msg, type }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4500);
  };
  const fail = (msg: string) => {
    setShake(true);
    window.setTimeout(() => setShake(false), 600);
    showToast(msg, 'err');
  };

  useEffect(() => { if (!links.length) updateConfigs(); }, []); // eslint-disable-line

  // مانیتور اتصال، تایمر و سرعت
  useEffect(() => {
    if (status !== 'connected') return;
    const id = window.setInterval(async () => {
      setNow(Date.now());
      if (testingRef.current) return;
      const ok = await invoke<boolean>('core_running').catch(() => false);
      if (!ok && !testingRef.current) {
        setStatus('idle'); setActiveId(null); setIp(null);
        fail(T.dropped);
        return;
      }
      const st = await invoke<[number, number]>('core_stats').catch(() => null);
      if (st) {
        const prev = lastStats.current;
        if (prev) {
          const up = Math.max(0, st[0] - prev[0]), down = Math.max(0, st[1] - prev[1]);
          setSpeed({ up, down, total: st[0] + st[1] });
          setHist((h) => [...h.slice(-(HIST - 1)), { d: down, u: up }]);
        }
        lastStats.current = st;
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, lang]); // eslint-disable-line

  async function checkIp() {
    setIp('loading');
    try {
      const j = JSON.parse(await invoke<string>('get_ip', { port: PROXY_PORT }));
      if (j.status !== 'success') throw new Error('ip');
      setIp(j);
    } catch {
      setIp('fail');
      showToast(T.noNet, 'err');
    }
  }

  async function updateConfigs() {
    if (busy) return;
    setBusy('fetch');
    try {
      const text = await invoke<string>('fetch_text', { urls: SUB_URLS });
      const { nodes: ns, skipped } = parseLinks(decodeSubscription(text));
      if (!ns.length) throw new Error(T.noValid);
      setLinks(ns.map((n) => n.link));
      setPings({});
      setFetchedAt(Date.now());
      setFavs((f) => f.filter((id) => ns.some((n) => n.id === id)));
      if (!ns.some((n) => n.id === selected)) setSelected(ns[0].id);
      showToast(T.updated(ns.length, skipped), 'ok');
    } catch (e) {
      fail(`${T.fetchErr}: ${errMsg(e)}`);
    } finally {
      setBusy('');
    }
  }

  async function runTest(list: VNode[]): Promise<Record<string, number>> {
    const res: Record<string, number> = {};
    if (!list.length) return res;
    const call = (ns: VNode[]) =>
      invoke<number[]>('test_delays', { config: JSON.stringify(buildTestConfig(ns)), count: ns.length, url: TEST_URL, timeout: TEST_TIMEOUT });
    try {
      const arr = await call(list);
      list.forEach((n, i) => (res[n.id] = arr[i]));
    } catch {
      for (const n of list) {
        try { res[n.id] = (await call([n]))[0]; } catch { res[n.id] = -1; }
        setPings((p) => ({ ...p, [n.id]: res[n.id] }));
      }
    }
    return res;
  }

  async function startNode(n: VNode) {
    await invoke('start_core', {
      config: JSON.stringify(buildConfig(n, mode, PROXY_PORT)),
      systemProxy: mode === 'proxy',
      port: PROXY_PORT,
    });
    lastStats.current = null;
    setSpeed({ up: 0, down: 0, total: 0 });
    setHist([]);
    setActiveId(n.id);
    setSince(Date.now());
    setNow(Date.now());
    setStatus('connected');
    setStep('');
    setFlash((f) => f + 1);
    checkIp();
  }

  async function testAll() {
    if (busy || status === 'connecting' || !nodes.length) return;
    setBusy('test');
    testingRef.current = true;
    const reconnect = status === 'connected' && mode === 'tun' ? active : undefined;
    if (reconnect) await invoke('stop_core').catch(() => {});
    setPings({});
    const res = await runTest(nodes);
    setPings(res);
    if (reconnect) await startNode(reconnect).catch((e) => { setStatus('idle'); fail(`${T.connErr}: ${errMsg(e)}`); });
    testingRef.current = false;
    setBusy('');
  }

  async function disconnect() {
    await invoke('stop_core').catch(() => {});
    setStatus('idle');
    setActiveId(null);
    setIp(null);
  }

  async function toggle() {
    if (status === 'connecting' || busy) return;
    if (status === 'connected') return disconnect();
    if (!nodes.length) return fail(T.noConfigs);
    if (mode === 'tun' && !(await invoke<boolean>('is_admin').catch(() => false))) return setAdminAsk(true);

    setStatus('connecting');
    try {
      let order: VNode[];
      if (auto) {
        let p = pings;
        if (!nodes.some((n) => (p[n.id] ?? -1) > 0)) {
          setStep('test');
          testingRef.current = true;
          p = await runTest(nodes);
          setPings(p);
          testingRef.current = false;
        }
        order = nodes.filter((n) => (p[n.id] ?? -1) > 0).sort((a, b) => p[a.id] - p[b.id]).slice(0, 3);
        if (!order.length) throw new Error(T.noWorking);
      } else {
        order = [nodes.find((n) => n.id === selected) || nodes[0]];
      }
      setStep('start');
      let last: unknown;
      for (const n of order) {
        try { await startNode(n); setSelected(n.id); return; } catch (e) { last = e; }
      }
      throw last;
    } catch (e) {
      testingRef.current = false;
      setStatus('idle');
      setStep('');
      fail(`${T.connErr}: ${errMsg(e)}`);
    }
  }

  async function pick(n: VNode) {
    setSelected(n.id);
    setAuto(false);
    if (status === 'connected' && n.id !== activeId) {
      setStatus('connecting');
      setStep('switch');
      await startNode(n).catch((e) => { setStatus('idle'); setStep(''); setActiveId(null); fail(`${T.connErr}: ${errMsg(e)}`); });
    }
  }

  /** مستقیم وصل شو به یه سرور مشخص (از لیست یا پالت) */
  async function connectTo(n: VNode) {
    if (status === 'connecting' || busy) return;
    if (status === 'connected') return pick(n);
    setSelected(n.id); setAuto(false);
    if (mode === 'tun' && !(await invoke<boolean>('is_admin').catch(() => false))) return setAdminAsk(true);
    setStatus('connecting'); setStep('start');
    await startNode(n).catch((e) => { setStatus('idle'); setStep(''); fail(`${T.connErr}: ${errMsg(e)}`); });
  }

  async function connectFastest() {
    if (status === 'connecting' || busy || !nodes.length) return;
    let p = pings;
    if (!nodes.some((n) => (p[n.id] ?? -1) > 0)) {
      setBusy('test'); testingRef.current = true;
      p = await runTest(nodes); setPings(p);
      testingRef.current = false; setBusy('');
    }
    const ok = nodes.filter((n) => (p[n.id] ?? -1) > 0).sort((a, b) => p[a.id] - p[b.id]);
    if (!ok.length) return fail(T.noWorking);
    await connectTo(ok[0]);
  }

  const toggleFav = (id: string) => setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const copyIp = () => {
    if (ip && typeof ip === 'object') navigator.clipboard?.writeText(ip.query).then(() => showToast(T.copied, 'ok')).catch(() => {});
  };
  const onMag = (e: RME) => {
    if (reduce || !magRef.current) return;
    const r = magRef.current.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    magRef.current.style.transform = `translate(${dx * 0.12}px, ${dy * 0.12}px)`;
  };
  const offMag = () => { if (magRef.current) magRef.current.style.transform = ''; };

  actions.current = { toggle, updateConfigs, testAll };

  /* ---------- derived ---------- */
  const label = status === 'connected' ? T.connected : status === 'connecting' ? T.connecting : T.idle;
  const stepText = step === 'test' ? T.stepTest : step === 'start' ? T.stepStart : step === 'switch' ? T.stepSwitch : '';
  const mins = fetchedAt ? Math.floor((now - fetchedAt) / 60000) : -1;
  const updatedText = mins < 0 ? T.never : mins < 1 ? T.justNow : T.ago(mins);
  const downs = hist.map((x) => x.d), ups = hist.map((x) => x.u);
  const peak = downs.length ? Math.max(...downs) : 0;
  const avg = downs.length ? downs.reduce((a, b) => a + b, 0) / downs.length : 0;
  const buckets = useMemo(() => {
    const b = [0, 0, 0, 0, 0, 0];
    nodes.forEach((n) => { const p = pings[n.id]; if (p === undefined) return; if (p < 0) b[5]++; else if (p < 150) b[0]++; else if (p < 300) b[1]++; else if (p < 500) b[2]++; else if (p < 800) b[3]++; else b[4]++; });
    return b;
  }, [nodes, pings]);
  const protoCount = useMemo(() => protocols.map((p) => [p, nodes.filter((n) => n.protocol === p).length] as const), [protocols, nodes]);
  const vars = { '--a1': a1, '--a2': a2, '--st': ST[status] } as CSSProperties;

  /* ---------- command palette ---------- */
  type PItem = { id: string; icon: ReactNode; label: string; hint?: string; run: () => void; group: string };
  const palItems: PItem[] = useMemo(() => {
    const A: PItem[] = [
      { id: 'tog', group: T.actions, icon: I.power, label: status === 'connected' ? T.disconnect : T.connect, hint: 'Ctrl+Enter', run: toggle },
      { id: 'fast', group: T.actions, icon: I.bolt, label: T.fastest, run: connectFastest },
      { id: 'cfg', group: T.actions, icon: I.refresh, label: T.getConfigs, hint: 'F5', run: updateConfigs },
      { id: 'ping', group: T.actions, icon: I.pulse, label: T.testPing, hint: 'Ctrl+T', run: testAll },
      { id: 'mode', group: T.actions, icon: mode === 'tun' ? I.proxy : I.cpu, label: `${T.switchMode} ${mode === 'tun' ? 'Proxy' : 'TUN'}`, run: () => status === 'idle' && setMode(mode === 'tun' ? 'proxy' : 'tun') },
      { id: 'lang', group: T.actions, icon: I.lang, label: T.toggleLang, run: () => setLang(lang === 'fa' ? 'en' : 'fa') },
      ...(Object.keys(THEMES) as Theme[]).map((th) => ({ id: 'th-' + th, group: T.theme, icon: I.palette, label: T.themes[th], run: () => setTheme(th) })),
      ...PAGES.map((p, i) => ({ id: 'pg-' + p, group: T.goTo, icon: [I.home, I.servers, I.stats, I.settings][i], label: [T.home, T.servers, T.stats, T.settings][i], hint: `Ctrl+${i + 1}`, run: () => setPage(p) })),
      ...nodes.map((n) => { const f = splitFlag(n.name); const p = pings[n.id]; return { id: 'n-' + n.id, group: T.servers, icon: <Flag cc={f.cc} size="s" />, label: f.label, hint: p === undefined ? n.protocol : p < 0 ? T.timeout : `${p}ms`, run: () => connectTo(n) }; }),
    ];
    const q = palQ.trim().toLowerCase();
    return q ? A.filter((x) => x.label.toLowerCase().includes(q) || x.group.toLowerCase().includes(q) || (x.hint ?? '').toLowerCase().includes(q)) : A.filter((x) => !x.id.startsWith('n-')).concat(A.filter((x) => x.id.startsWith('n-')).slice(0, 6));
  }, [palQ, status, mode, lang, nodes, pings, T, auto, busy, selected, activeId]); // eslint-disable-line
  const runPal = (it?: PItem) => { if (!it) return; setPal(false); window.setTimeout(it.run, 60); };

  /* ================= PAGES ================= */
  const Dashboard = (
    <div className="pg dash">
      <Card className="stage">
        <div className="stage-top">
          <div className="st-chip"><span className="st-dot" />{label}</div>
          <div className="st-mode">{mode === 'tun' ? I.cpu : I.proxy}{mode.toUpperCase()}</div>
        </div>
        <div className="globe-wrap"><Globe status={status} markers={markers} target={status !== 'idle' ? (active ? splitFlag(active.name).cc : undefined) : undefined} a1={a1} a2={a2} st={ST[status]} reduce={reduce} /></div>
        <div className="timer mono" data-on={status === 'connected'}>{status === 'connected' ? fmtTime(now - since) : '00:00:00'}</div>
        <div className="core-area">
          <div className="mag" ref={magRef} onMouseMove={onMag} onMouseLeave={offMag}>
            <button className={`core ${status} ${shake ? 'shake' : ''}`} onClick={toggle} disabled={!!busy && status !== 'connected'} aria-label={status === 'connected' ? T.disconnect : T.connect}>
              <span className="core-halo" />
              <span className="core-ring" />
              <svg className="core-arc" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" /></svg>
              {flash > 0 && <span className="shock" key={flash} />}
              <span className="core-in">
                <span className="core-ic" key={status}>{status === 'connected' ? I.shieldOk : I.power}</span>
              </span>
            </button>
          </div>
          <div className="core-label">
            <b key={label}>{status === 'connecting' && stepText ? stepText : label}</b>
            <small>{status === 'connected' ? T.tapDisconnect : status === 'connecting' ? T.wait : T.tapConnect}</small>
          </div>
        </div>
        {status === 'connecting' && <div className="steps">{(['test', 'start'] as Step[]).map((s, i) => <i key={s} className={step === s || (step === 'start' && i === 0) || step === 'switch' ? 'on' : ''} />)}</div>}
      </Card>

      <div className="side">
        <Card className="srv-card">
          <div className="lbl">{status === 'connected' ? T.current : T.location}</div>
          <div className="srv-row">
            <Flag cc={shownFlag?.cc || (auto ? 'AI' : '')} size="l" />
            <div className="srv-txt">
              <b dir="auto">{shownNode ? shownFlag?.label : auto ? T.autoPick : '—'}</b>
              <span className="tags">{shownNode ? <><em className={`p-${shownNode.protocol}`}>{shownNode.protocol}</em>{transportOf(shownNode) && <em>{transportOf(shownNode)}</em>}</> : <em>{nodes.length} {T.servers}</em>}</span>
            </div>
            {shownNode && pings[shownNode.id] !== undefined && <div className={`big-ping ${pingClass(pings[shownNode.id])}`}><Meter p={pings[shownNode.id]} /><span className="mono">{pings[shownNode.id] < 0 ? '×' : pings[shownNode.id]}</span></div>}
          </div>
          <div className="row2">
            <button className="btn rp" onClick={() => setPage('servers')}>{I.servers}{T.change}</button>
            <button className="btn accent rp" onClick={connectFastest} disabled={!!busy || status === 'connecting' || !nodes.length}>{I.bolt}{T.fastest}</button>
          </div>
        </Card>

        <div className="tiles">
          <Card className="tile dl">
            <div className="tile-h"><span className="ti">{I.down}</span>{T.down}</div>
            <div className="tile-v mono"><Count value={speed.down} fmt={(v) => fmtBytes(v)} /><small>/s</small></div>
            <Area id="sd" n={30} h={36} series={[{ data: downs, color: '#22d3ee' }]} />
          </Card>
          <Card className="tile ul">
            <div className="tile-h"><span className="ti">{I.up}</span>{T.up}</div>
            <div className="tile-v mono"><Count value={speed.up} fmt={(v) => fmtBytes(v)} /><small>/s</small></div>
            <Area id="su" n={30} h={36} series={[{ data: ups, color: '#ff4fd8' }]} />
          </Card>
        </div>

        <Card className="info">
          <button className="info-row rp" onClick={copyIp} disabled={!ip || typeof ip !== 'object'}>
            <span className="ii">{I.globe}</span>
            <span className="info-k">{T.ip}</span>
            <span className="info-v mono">{ip === 'loading' ? <span className="skel" /> : ip && typeof ip === 'object' ? <><Flag cc={ip.countryCode} size="s" />{ip.query}<span className="cp">{I.copy}</span></> : '—'}</span>
          </button>
          <div className="info-row">
            <span className="ii">{I.stats}</span>
            <span className="info-k">{T.total}</span>
            <span className="info-v mono"><Count value={speed.total} fmt={fmtBytes} /></span>
          </div>
          <div className="info-row">
            <span className="ii">{I.lock}</span>
            <span className="info-k">{T.mode}</span>
            <div className="mini-seg">
              <button className={mode === 'tun' ? 'on' : ''} disabled={status !== 'idle'} onClick={() => setMode('tun')}>TUN</button>
              <button className={mode === 'proxy' ? 'on' : ''} disabled={status !== 'idle'} onClick={() => setMode('proxy')}>Proxy</button>
              <span className="ms-glow" data-p={mode} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );

  const Servers = (
    <div className="pg servers">
      <div className="pg-head">
        <div>
          <h1>{T.servers}</h1>
          <p className="pg-sub"><span className="chip-n">{nodes.length}</span>{tested > 0 && <span className="on-n"><i />{online} {T.online}</span>}<span className="muted">· {T.lastUpdate}: {updatedText}</span></p>
        </div>
        <div className="head-actions">
          <button className="ibtn rp" onClick={updateConfigs} disabled={!!busy || status === 'connecting'} title={T.getConfigs}><span className={busy === 'fetch' ? 'spin' : ''}>{I.refresh}</span></button>
          <button className="ibtn rp" onClick={testAll} disabled={!!busy || status === 'connecting' || !nodes.length} title={T.testPing}><span className={busy === 'test' ? 'pulse' : ''}>{I.pulse}</span></button>
          <button className={`ibtn rp ${sortPing ? 'on' : ''}`} onClick={() => setSortPing(!sortPing)} title={T.sortPing}>{I.sort}</button>
          <button className="btn accent rp" onClick={connectFastest} disabled={!!busy || status === 'connecting' || !nodes.length}>{I.bolt}<span className="hide-s">{T.fastest}</span></button>
        </div>
      </div>
      <div className={`bar ${busy ? 'on' : ''}`}><i style={busy === 'test' && tested ? { width: `${(tested / Math.max(1, nodes.length)) * 100}%`, animation: 'none' } : undefined} /></div>
      <div className="toolbar">
        <div className="search">
          {I.search}
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={T.search} />
          {query ? <button className="clr" onClick={() => setQuery('')}>{I.x}</button> : <Kbd k="Ctrl+F" />}
        </div>
        {nodes.length > 0 && (
          <div className="chips">
            {['all', 'fav', ...protocols].map((f) => (
              <button key={f} className={`chipf rp ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'fav' && I.star}{f === 'all' ? T.all : f === 'fav' ? T.favs : f}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid">
        {!nodes.length && (
          <div className="empty">
            <div className="empty-art"><span /><span /><span />{I.servers}</div>
            <b>{T.noConfigs}</b><p>{T.emptyHint}</p>
            <button className="btn accent rp" onClick={updateConfigs} disabled={!!busy}><span className={busy === 'fetch' ? 'spin' : ''}>{I.refresh}</span>{busy === 'fetch' ? T.fetching : T.getConfigs}</button>
          </div>
        )}
        {nodes.length > 0 && !shown.length && <div className="empty small">{T.noMatch}</div>}
        {shown.map((n, i) => {
          const p = pings[n.id], f = splitFlag(n.name), tr = transportOf(n);
          const isSel = !auto && n.id === selected, isAct = n.id === activeId, isFav = favs.includes(n.id);
          return (
            <div key={n.id} role="button" tabIndex={0} className={`srv rp ${isSel ? 'sel' : ''} ${isAct ? 'act' : ''}`}
              style={{ animationDelay: `${Math.min(i, 18) * 26}ms` }} onClick={() => pick(n)} onDoubleClick={() => connectTo(n)} onKeyDown={(e) => e.key === 'Enter' && pick(n)}>
              <Flag cc={f.cc} />
              <div className="srv-meta">
                <b dir="auto">{f.label}</b>
                <span className="tags"><em className={`p-${n.protocol}`}>{n.protocol}</em>{tr && <em>{tr}</em>}{n.id === bestId && <em className="best">{I.bolt}{T.best}</em>}</span>
              </div>
              <div className={`srv-ping ${pingClass(p)} ${busy === 'test' && p === undefined ? 'ld' : ''}`}>
                <Meter p={p} />
                <span className="mono">{p === undefined ? (busy === 'test' ? '' : '—') : p < 0 ? T.timeout : `${p}ms`}</span>
              </div>
              <span role="button" className={`fav ${isFav ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFav(n.id); }}>{I.star}</span>
              {isAct && <span className="live">LIVE</span>}
            </div>
          );
        })}
      </div>
    </div>
  );

  const Stats = (
    <div className="pg stats">
      <div className="pg-head"><div><h1>{T.stats}</h1><p className="pg-sub muted">{status === 'connected' ? `${T.session} · ${fmtTime(now - since)}` : T.notConnectedYet}</p></div></div>
      <div className="kpis">
        {[
          { k: T.uptime, v: status === 'connected' ? fmtTime(now - since) : '—', ic: I.clock },
          { k: T.total, v: <Count value={speed.total} fmt={fmtBytes} />, ic: I.stats },
          { k: T.peak, v: <><Count value={peak} fmt={fmtBytes} />/s</>, ic: I.bolt },
          { k: T.avg, v: <><Count value={avg} fmt={fmtBytes} />/s</>, ic: I.down },
        ].map((x, i) => (
          <Card key={i} className="kpi" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="kpi-ic">{x.ic}</span><span className="kpi-k">{x.k}</span><span className="kpi-v mono">{x.v}</span>
          </Card>
        ))}
      </div>
      <Card className="chart">
        <div className="chart-h"><b>{T.liveTraffic}</b><span className="lg"><i className="d" />{T.down}<i className="u" />{T.up}</span></div>
        <Area id="big" n={HIST} h={180} grid series={[{ data: downs, color: '#22d3ee' }, { data: ups, color: '#ff4fd8' }]} />
      </Card>
      <div className="two">
        <Card className="hist">
          <div className="chart-h"><b>{T.pingDist}</b><span className="muted">{tested}/{nodes.length}</span></div>
          <div className="bars">
            {buckets.map((v, i) => {
              const m = Math.max(1, ...buckets);
              return (
                <div key={i} className={`bcol b${i}`}>
                  <span className="bv mono">{v}</span>
                  <span className="bb"><i style={{ height: `${(v / m) * 100}%`, transitionDelay: `${i * 60}ms` }} /></span>
                  <span className="bl mono">{['<150', '<300', '<500', '<800', '800+', '×'][i]}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="protos">
          <div className="chart-h"><b>{T.protoMix}</b></div>
          {protoCount.map(([p, c], i) => (
            <div key={p} className="pr">
              <span className={`pn p-${p}`}>{p}</span>
              <span className="pt"><i className={`p-${p}`} style={{ width: `${(c / Math.max(1, nodes.length)) * 100}%`, transitionDelay: `${i * 80}ms` }} /></span>
              <span className="pc mono">{c}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );

  const Settings = (
    <div className="pg settings">
      <div className="pg-head"><div><h1>{T.settings}</h1><p className="pg-sub muted">MahyarVPN v{VERSION}</p></div></div>
      <div className="set-grid">
        <Card className="set">
          <div className="set-t">{I.lock}{T.connection}</div>
          <div className="mode-cards">
            {(['tun', 'proxy'] as Mode[]).map((m) => (
              <button key={m} className={`mcard rp ${mode === m ? 'on' : ''}`} disabled={status !== 'idle'} onClick={() => setMode(m)}>
                <span className="mc-ic">{m === 'tun' ? I.cpu : I.proxy}</span>
                <b>{m === 'tun' ? 'TUN' : 'Proxy'}</b>
                <small>{m === 'tun' ? T.tunHint : T.proxyHint}</small>
                <span className="mc-check">{I.check}</span>
              </button>
            ))}
          </div>
          <div className="opt"><div><b>{T.auto}</b><small>{T.autoHint}</small></div><Switch on={auto} onChange={setAuto} /></div>
          <div className="opt"><div><b>{T.sortPing}</b><small>{T.sortHint}</small></div><Switch on={sortPing} onChange={setSortPing} /></div>
        </Card>
        <Card className="set">
          <div className="set-t">{I.palette}{T.appearance}</div>
          <div className="opt col"><b>{T.theme}</b>
            <div className="swatches">
              {(Object.keys(THEMES) as Theme[]).map((th) => (
                <button key={th} className={`swatch rp ${theme === th ? 'on' : ''}`} onClick={() => setTheme(th)} style={{ ['--s1' as any]: THEMES[th][0], ['--s2' as any]: THEMES[th][1] } as CSSProperties}>
                  <i /><span>{T.themes[th]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="opt"><div><b>{T.language}</b></div>
            <div className="mini-seg">
              <button className={lang === 'fa' ? 'on' : ''} onClick={() => setLang('fa')}>فارسی</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
              <span className="ms-glow" data-p={lang === 'fa' ? 'tun' : 'proxy'} />
            </div>
          </div>
          <div className="opt"><div><b>{T.reduce}</b><small>{T.reduceHint}</small></div><Switch on={reduce} onChange={setReduce} /></div>
        </Card>
        <Card className="set">
          <div className="set-t">{I.sub}{T.subscription}</div>
          <div className="opt"><div><b>{nodes.length} {T.configs}</b><small>{T.lastUpdate}: {updatedText}</small></div>
            <button className="btn rp" onClick={updateConfigs} disabled={!!busy || status === 'connecting'}><span className={busy === 'fetch' ? 'spin' : ''}>{I.refresh}</span>{busy === 'fetch' ? T.fetching : T.getConfigs}</button>
          </div>
        </Card>
        <Card className="set">
          <div className="set-t">{I.keyboard}{T.shortcuts}</div>
          <div className="keys">
            {[[T.kPalette, 'Ctrl+K'], [T.kConnect, 'Ctrl+Enter'], [T.kConfigs, 'F5'], [T.kPing, 'Ctrl+T'], [T.kSearch, 'Ctrl+F'], [T.kPages, 'Ctrl+1-4'], [T.kFull, 'F11']].map(([a, k]) => (
              <div key={k} className="krow"><span>{a}</span><Kbd k={k} /></div>
            ))}
          </div>
        </Card>
        <Card className="set about">
          <div className="about-logo">{I.logo}</div>
          <div><b>Mahyar<span className="grad">VPN</span> <span className="ver">v{VERSION}</span></b><small>{T.aboutText}</small></div>
        </Card>
      </div>
    </div>
  );

  const navItems: [Page, ReactNode, string][] = [['home', I.home, T.home], ['servers', I.servers, T.servers], ['stats', I.stats, T.stats], ['settings', I.settings, T.settings]];
  const pIdx = PAGES.indexOf(page);

  return (
    <div className="app" data-status={status} data-reduce={reduce} style={vars}>
      <div className="bg"><span className="aurora a" /><span className="aurora b" /><span className="aurora c" /><span className="noise" /><span className="grid-bg" /></div>

      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>{I.logo}<span>Mahyar<b className="grad">VPN</b></span></div>
        <button className="cmdk rp" onClick={() => setPal(true)}>{I.search}<span>{T.paletteHint}</span><Kbd k="Ctrl+K" /></button>
        <div className="win">
          <button className="wb" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}><span className="wl">{lang === 'fa' ? 'EN' : 'فا'}</span></button>
          <button className="wb" onClick={() => win.minimize()} aria-label="minimize">{I.min}</button>
          <button className="wb" onClick={() => win.toggleMaximize()} aria-label="maximize">{maxed ? I.restore : I.max}</button>
          <button className="wb x" onClick={() => win.close()} aria-label="close">{I.close}</button>
        </div>
      </header>

      <div className="shell">
        <nav className="rail" style={{ ['--i' as any]: pIdx } as CSSProperties}>
          <span className="rail-ind" />
          {navItems.map(([p, ic, l]) => (
            <button key={p} className={`rb ${page === p ? 'on' : ''}`} onClick={() => setPage(p)} data-tip={l}>
              {ic}<span className="rl">{l}</span>
              {p === 'servers' && nodes.length > 0 && <em>{nodes.length}</em>}
            </button>
          ))}
          <span className="rail-sp" />
          <span className={`rail-st`} title={label}><i /></span>
        </nav>
        <main className="content">
          <div className="page" key={page}>{page === 'home' ? Dashboard : page === 'servers' ? Servers : page === 'stats' ? Stats : Settings}</div>
        </main>
      </div>

      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.type}`} onClick={() => setToasts((ts) => ts.filter((y) => y.id !== x.id))}>
            <span className="t-ic">{x.type === 'ok' ? I.check : I.alert}</span><span className="t-msg">{x.msg}</span><span className="t-bar" />
          </div>
        ))}
      </div>

      {pal && (
        <div className="overlay" onClick={() => setPal(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <div className="pal-in">{I.command}
              <input ref={palRef} value={palQ} placeholder={T.palette}
                onChange={(e) => { setPalQ(e.target.value); setPalI(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setPalI((i) => Math.min(palItems.length - 1, i + 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setPalI((i) => Math.max(0, i - 1)); }
                  if (e.key === 'Enter') { e.preventDefault(); runPal(palItems[palI]); }
                }} />
              <Kbd k="Esc" />
            </div>
            <div className="pal-list">
              {palItems.map((it, i) => (
                <div key={it.id}>
                  {(i === 0 || palItems[i - 1].group !== it.group) && <div className="pal-g">{it.group}</div>}
                  <button className={`pal-it ${i === palI ? 'on' : ''}`} onMouseEnter={() => setPalI(i)} onClick={() => runPal(it)}>
                    <span className="pal-ic">{it.icon}</span><span className="pal-l" dir="auto">{it.label}</span>{it.hint && <span className="pal-h mono">{it.hint}</span>}
                  </button>
                </div>
              ))}
              {!palItems.length && <div className="empty small">{T.noMatch}</div>}
            </div>
          </div>
        </div>
      )}

      {adminAsk && (
        <div className="overlay" onClick={() => setAdminAsk(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="m-ic">{I.shieldOk}</div>
            <h3>{T.adminTitle}</h3>
            <p>{T.adminText}</p>
            <button className="btn accent rp" onClick={() => invoke('relaunch_admin').catch((e) => { setAdminAsk(false); showToast(errMsg(e), 'err'); })}>{T.relaunch}</button>
            <button className="btn rp" onClick={() => { setMode('proxy'); setAdminAsk(false); }}>{T.useProxy}</button>
            <button className="btn ghost" onClick={() => setAdminAsk(false)}>{T.cancel}</button>
          </div>
        </div>
      )}

      {splash && (
        <div className="splash">
          <div className="sp-logo">
            <svg viewBox="0 0 32 32"><path className="sp-path" d="M16 2.5l11 4.2v8.1c0 7-4.9 11.9-11 14.2C9.9 26.7 5 21.8 5 14.8V6.7z" /><path className="sp-check" d="M11 15.5l3.6 3.6L21.5 12" /></svg>
            <span className="sp-ring" />
          </div>
          <div className="sp-name">Mahyar<b className="grad">VPN</b></div>
          <div className="sp-bar"><i /></div>
        </div>
      )}
    </div>
  );
}
