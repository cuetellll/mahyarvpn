import { useEffect, useRef } from 'react';
import { GEO, HOME_CC } from '../geo';

type Props = {
  status: 'idle' | 'connecting' | 'connected';
  markers: string[];
  target?: string;
  a1: string; a2: string; st: string;
  reduce?: boolean;
};

const D = Math.PI / 180;
type V3 = [number, number, number];
const toV = (lat: number, lon: number): V3 => [Math.cos(lat * D) * Math.cos(lon * D), Math.cos(lat * D) * Math.sin(lon * D), Math.sin(lat * D)];
const toLL = (v: V3): [number, number] => [Math.asin(Math.max(-1, Math.min(1, v[2]))) / D, Math.atan2(v[1], v[0]) / D];
function slerp(a: V3, b: V3, t: number): V3 {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(dot);
  if (w < 1e-4) return a;
  const s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
  return [a[0] * s1 + b[0] * s2, a[1] * s1 + b[1] * s2, a[2] * s1 + b[2] * s2];
}
const lerpAng = (a: number, b: number, t: number) => { let d = ((b - a + 540) % 360) - 180; return a + d * t; };

/** نقاط کره (Fibonacci lattice) */
const DOTS: [number, number][] = (() => {
  const n = 1400, out: [number, number][] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = g * i;
    out.push([Math.asin(y) / D, Math.atan2(Math.sin(th) * r, Math.cos(th) * r) / D]);
  }
  return out;
})();

export default function Globe(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext('2d')!;
    let w = 0, h = 0, dpr = 1, raf = 0;
    let lon0 = -20, lat0 = 22, t0 = performance.now(), arcT = 0, last = t0;
    const ro = new ResizeObserver(() => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.max(1, w * dpr); cv.height = Math.max(1, h * dpr);
    });
    ro.observe(cv);

    const frame = (now: number) => {
      const P = props.current;
      const dt = Math.min(64, now - last); last = now;
      const t = (now - t0) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.4, cx = w / 2, cy = h / 2;
      if (R <= 0) { raf = requestAnimationFrame(frame); return; }

      const home = GEO[HOME_CC], tgt = P.target ? GEO[P.target] : undefined;
      // rotation
      if (P.status === 'connected' && tgt) {
        const mid = toLL(slerp(toV(home[0], home[1]), toV(tgt[0], tgt[1]), 0.5));
        lon0 = lerpAng(lon0, mid[1], 0.03); lat0 += (Math.max(-30, Math.min(40, mid[0])) - lat0) * 0.03;
      } else {
        lon0 += (P.reduce ? 0 : (P.status === 'connecting' ? 0.09 : 0.012)) * dt;
        lat0 += (22 - lat0) * 0.02;
      }
      const sl = Math.sin(lat0 * D), cl = Math.cos(lat0 * D);
      const proj = (lat: number, lon: number, k = 1) => {
        const l = (lon - lon0) * D, cp = Math.cos(lat * D), sp = Math.sin(lat * D);
        const x = cp * Math.sin(l), y = cl * sp - sl * cp * Math.cos(l), z = sl * sp + cl * cp * Math.cos(l);
        return { x: cx + R * k * x, y: cy - R * k * y, z, vis: z > 0 || Math.hypot(x, y) * k > 1.0 };
      };

      // atmosphere
      const atm = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
      atm.addColorStop(0, P.a1 + '55'); atm.addColorStop(0.4, P.a1 + '18'); atm.addColorStop(1, 'transparent');
      ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, Math.PI * 2); ctx.fill();
      // body
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      body.addColorStop(0, '#1b2350'); body.addColorStop(0.7, '#0a0f26'); body.addColorStop(1, '#070a1a');
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      // rim
      ctx.strokeStyle = P.a1 + '66'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

      // dots
      ctx.fillStyle = '#b9c4ff';
      for (const [la, lo] of DOTS) {
        const q = proj(la, lo);
        if (q.z <= 0) continue;
        ctx.globalAlpha = 0.08 + q.z * 0.55;
        const s = 0.6 + q.z * 1.1;
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // scanning band while connecting
      if (P.status === 'connecting') {
        const yb = cy + Math.sin(t * 3) * R * 0.9;
        const g = ctx.createLinearGradient(0, yb - 30, 0, yb + 30);
        g.addColorStop(0, 'transparent'); g.addColorStop(0.5, P.st + '55'); g.addColorStop(1, 'transparent');
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = g; ctx.fillRect(cx - R, yb - 30, R * 2, 60); ctx.restore();
      }

      // orbit ring + satellite
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(-0.35); ctx.scale(1, 0.28);
      ctx.strokeStyle = P.a2 + '40'; ctx.lineWidth = 1 / 0.28 * 0.6;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.22, 0, Math.PI * 2); ctx.stroke();
      const sa = t * (P.reduce ? 0 : 0.6);
      ctx.fillStyle = P.a2; ctx.shadowColor = P.a2; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(Math.cos(sa) * R * 1.22, Math.sin(sa) * R * 1.22, 3 / 0.28 * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      // markers
      for (const cc of P.markers) {
        const g = GEO[cc]; if (!g) continue;
        const q = proj(g[0], g[1]); if (q.z <= 0.05) continue;
        const isT = cc === P.target && P.status === 'connected';
        if (isT) continue;
        ctx.globalAlpha = 0.4 + q.z * 0.6;
        ctx.fillStyle = P.a2; ctx.shadowColor = P.a2; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(q.x, q.y, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        const ph = (t * 0.8 + (cc.charCodeAt(0) % 7) / 7) % 1;
        ctx.strokeStyle = P.a2; ctx.globalAlpha = (1 - ph) * 0.5 * q.z; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(q.x, q.y, 2 + ph * 9, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // home
      const hq = proj(home[0], home[1]);
      if (hq.z > 0) {
        ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(hq.x, hq.y, 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        ctx.font = '600 9px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)';
        ctx.fillText('YOU', hq.x + 6, hq.y - 6);
      }

      // arc to target
      if (tgt && (P.status === 'connected' || P.status === 'connecting')) {
        arcT = Math.min(1, arcT + dt / (P.status === 'connected' ? 900 : 2500));
        const a = toV(home[0], home[1]), b = toV(tgt[0], tgt[1]);
        const N = 64, pts: { x: number; y: number; vis: boolean }[] = [];
        for (let i = 0; i <= N; i++) {
          const f = i / N; if (f > arcT) break;
          const [la, lo] = toLL(slerp(a, b, f));
          pts.push(proj(la, lo, 1 + Math.sin(f * Math.PI) * 0.28));
        }
        ctx.lineWidth = 2; ctx.lineCap = 'round';
        const grad = ctx.createLinearGradient(hq.x, hq.y, pts[pts.length - 1]?.x ?? hq.x, pts[pts.length - 1]?.y ?? hq.y);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, P.st);
        ctx.strokeStyle = grad; ctx.shadowColor = P.st; ctx.shadowBlur = 12;
        ctx.beginPath();
        let pen = false;
        for (const q of pts) { if (!q.vis) { pen = false; continue; } if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y); }
        ctx.stroke(); ctx.shadowBlur = 0;
        // packets
        if (P.status === 'connected' && pts.length > 2) {
          for (let k = 0; k < 3; k++) {
            const f = ((t * 0.45 + k / 3) % 1);
            const q = pts[Math.floor(f * (pts.length - 1))];
            if (!q.vis) continue;
            ctx.fillStyle = '#fff'; ctx.shadowColor = P.st; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, Math.PI * 2); ctx.fill();
          }
          ctx.shadowBlur = 0;
          const tq = proj(tgt[0], tgt[1]);
          if (tq.z > 0) {
            for (let k = 0; k < 2; k++) {
              const ph = (t * 0.7 + k / 2) % 1;
              ctx.strokeStyle = P.st; ctx.globalAlpha = 1 - ph; ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.arc(tq.x, tq.y, 4 + ph * 18, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.globalAlpha = 1; ctx.fillStyle = P.st; ctx.shadowColor = P.st; ctx.shadowBlur = 16;
            ctx.beginPath(); ctx.arc(tq.x, tq.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
          }
        }
      } else arcT = 0;

      // specular
      const sp = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.9);
      sp.addColorStop(0, 'rgba(255,255,255,.07)'); sp.addColorStop(1, 'transparent');
      ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return <canvas ref={ref} className="globe" />;
}
