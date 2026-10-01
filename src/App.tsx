import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { decodeSubscription, parseLinks, type VNode } from './parser';
import { buildConfig, buildTestConfig } from './singbox';
import { SUB_URLS, PROXY_PORT, TEST_URL, TEST_TIMEOUT } from './config';
import { t, type Lang } from './i18n';

type Status = 'idle' | 'connecting' | 'connected';
type Mode = 'tun' | 'proxy';

const load = <T,>(k: string, d: T): T => {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
};
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const errMsg = (e: unknown) => String((e as any)?.message ?? e).split('\n').slice(-3).join(' ').slice(0, 220);
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
const pingClass = (p?: number) => (p === undefined ? '' : p < 0 ? 'bad' : p < 300 ? 'good' : p < 700 ? 'mid' : 'slow');

export default function App() {
  const [lang, setLang] = useState<Lang>(() => load('lang', 'fa'));
  const [mode, setMode] = useState<Mode>(() => load('mode', 'tun'));
  const [auto, setAuto] = useState<boolean>(() => load('auto', true));
  const [links, setLinks] = useState<string[]>(() => load('links', []));
  const [selected, setSelected] = useState<string | null>(() => load('selected', null));
  const [pings, setPings] = useState<Record<string, number>>(() => load('pings', {}));
  const [status, setStatus] = useState<Status>('idle');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'' | 'fetch' | 'test'>('');
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const [adminAsk, setAdminAsk] = useState(false);
  const [since, setSince] = useState(0);
  const [now, setNow] = useState(Date.now());
  const testingRef = useRef(false);
  const toastTimer = useRef<number>();
  const T = t[lang];

  const nodes = useMemo(() => parseLinks(links).nodes, [links]);
  const bestId = useMemo(() => {
    const ok = nodes.filter((n) => (pings[n.id] ?? -1) > 0);
    return ok.length ? ok.reduce((a, b) => (pings[a.id] <= pings[b.id] ? a : b)).id : null;
  }, [nodes, pings]);
  const active = nodes.find((n) => n.id === activeId);

  useEffect(() => save('lang', lang), [lang]);
  useEffect(() => save('mode', mode), [mode]);
  useEffect(() => save('auto', auto), [auto]);
  useEffect(() => save('links', links), [links]);
  useEffect(() => save('selected', selected), [selected]);
  useEffect(() => save('pings', pings), [pings]);
  useEffect(() => {
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  };

  // بار اول خودش کانفیگ‌ها رو می‌گیره
  useEffect(() => { if (!links.length) updateConfigs(); }, []); // eslint-disable-line

  // مانیتور اتصال + تایمر
  useEffect(() => {
    if (status !== 'connected') return;
    const id = window.setInterval(async () => {
      setNow(Date.now());
      if (testingRef.current) return;
      const ok = await invoke<boolean>('core_running').catch(() => false);
      if (!ok && !testingRef.current) { setStatus('idle'); setActiveId(null); showToast(T.dropped, 'err'); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [status, lang]); // eslint-disable-line

  async function updateConfigs() {
    if (busy) return;
    setBusy('fetch');
    try {
      const text = await invoke<string>('fetch_text', { urls: SUB_URLS });
      const { nodes: ns, skipped } = parseLinks(decodeSubscription(text));
      if (!ns.length) throw new Error(T.noValid);
      setLinks(ns.map((n) => n.link));
      setPings({});
      if (!ns.some((n) => n.id === selected)) setSelected(ns[0].id);
      showToast(T.updated(ns.length, skipped), 'ok');
    } catch (e) {
      showToast(`${T.fetchErr}: ${errMsg(e)}`, 'err');
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
      // اگه یه کانفیگ خراب کل تست رو بخوابونه، تک‌تک تست می‌کنیم
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
    setActiveId(n.id);
    setSince(Date.now());
    setNow(Date.now());
    setStatus('connected');
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
    if (reconnect) await startNode(reconnect).catch((e) => { setStatus('idle'); showToast(`${T.connErr}: ${errMsg(e)}`, 'err'); });
    testingRef.current = false;
    setBusy('');
  }

  async function disconnect() {
    await invoke('stop_core').catch(() => {});
    setStatus('idle');
    setActiveId(null);
  }

  async function toggle() {
    if (status === 'connecting' || busy) return;
    if (status === 'connected') return disconnect();
    if (!nodes.length) return showToast(T.noConfigs, 'err');
    if (mode === 'tun' && !(await invoke<boolean>('is_admin').catch(() => false))) return setAdminAsk(true);

    setStatus('connecting');
    try {
      let order: VNode[];
      if (auto) {
        let p = pings;
        if (!nodes.some((n) => (p[n.id] ?? -1) > 0)) {
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
      let last: unknown;
      for (const n of order) {
        try { await startNode(n); setSelected(n.id); return; } catch (e) { last = e; }
      }
      throw last;
    } catch (e) {
      testingRef.current = false;
      setStatus('idle');
      showToast(`${T.connErr}: ${errMsg(e)}`, 'err');
    }
  }

  async function pick(n: VNode) {
    setSelected(n.id);
    setAuto(false);
    if (status === 'connected' && n.id !== activeId) {
      setStatus('connecting');
      await startNode(n).catch((e) => { setStatus('idle'); setActiveId(null); showToast(`${T.connErr}: ${errMsg(e)}`, 'err'); });
    }
  }

  const win = getCurrentWindow();
  const label = status === 'connected' ? T.connected : status === 'connecting' ? T.connecting : T.idle;

  return (
    <div className="app" data-status={status}>
      <div className="bg"><span className="blob b1" /><span className="blob b2" /><span className="blob b3" /></div>

      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region><span className="logo-dot" />Mahyar<b>VPN</b></div>
        <div className="win-btns">
          <button className="chip" onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}>{lang === 'fa' ? 'EN' : 'فا'}</button>
          <button className="wbtn" onClick={() => win.minimize()} aria-label="minimize">
            <svg viewBox="0 0 12 12"><path d="M2 6h8" /></svg>
          </button>
          <button className="wbtn close" onClick={() => win.close()} aria-label="close">
            <svg viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" /></svg>
          </button>
        </div>
      </header>

      <section className="hero">
        <div className={`orb ${status}`}>
          <span className="wave" /><span className="wave w2" />
          <span className="ring" />
          <button className="power" onClick={toggle} disabled={!!busy && status !== 'connected'} title={status === 'connected' ? T.disconnect : T.connect}>
            <svg viewBox="0 0 24 24"><path d="M12 3v8" /><path d="M6.3 6.8a8 8 0 1 0 11.4 0" /></svg>
          </button>
        </div>
        <div className="status">{label}</div>
        <div className="sub">
          {status === 'connected' && active ? (
            <><span className="mono">{fmt(now - since)}</span> · {active.name}{pings[active.id] > 0 && <> · <span className="mono">{pings[active.id]}ms</span></>}</>
          ) : auto ? T.autoPick : (nodes.find((n) => n.id === selected)?.name ?? '—')}
        </div>
      </section>

      <section className="controls">
        <div className="seg">
          <button className={mode === 'tun' ? 'on' : ''} disabled={status !== 'idle'} onClick={() => setMode('tun')}>TUN<small>{T.tunHint}</small></button>
          <button className={mode === 'proxy' ? 'on' : ''} disabled={status !== 'idle'} onClick={() => setMode('proxy')}>Proxy<small>{T.proxyHint}</small></button>
          <span className="seg-glow" data-pos={mode} />
        </div>
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="track"><span className="thumb" /></span>
          {T.auto}
        </label>
        <div className="actions">
          <button className="btn" onClick={updateConfigs} disabled={!!busy || status === 'connecting'}>
            <svg viewBox="0 0 24 24" className={busy === 'fetch' ? 'spin' : ''}><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></svg>
            {busy === 'fetch' ? T.fetching : T.getConfigs}
          </button>
          <button className="btn" onClick={testAll} disabled={!!busy || status === 'connecting' || !nodes.length}>
            <svg viewBox="0 0 24 24" className={busy === 'test' ? 'pulse' : ''}><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>
            {busy === 'test' ? T.testing : T.testPing}
          </button>
        </div>
      </section>

      <section className="list">
        <div className="list-head">{T.servers}<span>{nodes.length}</span></div>
        {!nodes.length && <div className="empty">{T.noConfigs}</div>}
        {nodes.map((n, i) => {
          const p = pings[n.id];
          const isSel = !auto && n.id === selected;
          return (
            <button key={n.id} className={`node ${isSel ? 'sel' : ''} ${n.id === activeId ? 'active' : ''}`} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} onClick={() => pick(n)}>
              <span className={`proto p-${n.protocol}`}>{n.protocol}</span>
              <span className="name" dir="auto">{n.name}</span>
              {n.id === bestId && <span className="best">⚡ {T.best}</span>}
              <span className={`ping ${pingClass(p)} ${busy === 'test' && p === undefined ? 'loading' : ''}`}>
                {p === undefined ? (busy === 'test' ? '' : '—') : p < 0 ? T.timeout : `${p}ms`}
              </span>
            </button>
          );
        })}
      </section>

      {toast && <div className={`toast ${toast.type}`} onClick={() => setToast(null)}>{toast.msg}</div>}

      {adminAsk && (
        <div className="modal" onClick={() => setAdminAsk(false)}>
          <div className="card" onClick={(e) => e.stopPropagation()}>
            <h3>{T.adminTitle}</h3>
            <p>{T.adminText}</p>
            <button className="btn primary" onClick={() => invoke('relaunch_admin').catch((e) => { setAdminAsk(false); showToast(errMsg(e), 'err'); })}>{T.relaunch}</button>
            <button className="btn" onClick={() => { setMode('proxy'); setAdminAsk(false); }}>{T.useProxy}</button>
            <button className="btn ghost" onClick={() => setAdminAsk(false)}>{T.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
