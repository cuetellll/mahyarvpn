import type { VNode } from './parser';
import { API_PORT, AETHER_PORT } from './config';

/**
 * v2.5 · مدل ۲: یه «سرور» مجازی که خروجیش SOCKS5 محلی Aether هست.
 * sing-box همون TUN / پروکسی ویندوز رو می‌سازه و همه‌چی رو می‌فرسته توی Aether.
 */
export const AETHER_ID = 'aether';
export const AETHER_NODE: VNode = {
  id: AETHER_ID,
  link: '',
  name: 'Aether · WireGuard',
  protocol: 'wireguard',
  server: '127.0.0.1',
  port: AETHER_PORT,
  outbound: { type: 'socks', server: '127.0.0.1', server_port: AETHER_PORT, version: '5' },
};

const clean = (o: any) => JSON.parse(JSON.stringify(o)); // undefined ها حذف میشن

/** کانفیگ اصلی sing-box 1.14 (فرمت جدید DNS و route actions) */
export function buildConfig(node: VNode, mode: 'tun' | 'proxy', port: number) {
  const inbounds: any[] = [
    { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: port },
  ];
  if (mode === 'tun') {
    inbounds.unshift({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'MahyarVPN',
      address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
      mtu: 9000,
      auto_route: true,
      strict_route: true,
      stack: 'mixed',
    });
  }
  const aether = node.id === AETHER_ID;
  const rules: any[] = [
    { action: 'sniff' },
    // ترافیک خود aether.exe (WireGuard به Cloudflare + DNS خودش) نباید دوباره بره توی تونل، وگرنه حلقه میشه
    ...(aether ? [{ process_name: ['aether.exe'], outbound: 'direct' }] : []),
    { protocol: 'dns', action: 'hijack-dns' },
    { ip_is_private: true, outbound: 'direct' },
    // SOCKS5 Aether فقط TCP رو مطمئن رد می‌کنه؛ QUIC رد میشه تا مرورگر سریع برگرده روی TCP
    ...(aether ? [{ network: 'udp', port: 443, action: 'reject' }] : []),
  ];
  return clean({
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        // مدل ۲: DNS روی TCP از داخل Aether (DoH هم TCP هست، ولی ساده‌تر و سبک‌تر)
        aether
          ? { type: 'tcp', tag: 'dns-remote', server: '1.1.1.1', detour: 'proxy' }
          : { type: 'https', tag: 'dns-remote', server: '1.1.1.1', detour: 'proxy' },
        { type: 'local', tag: 'dns-local' },
      ],
      final: 'dns-remote',
      strategy: 'prefer_ipv4',
    },
    inbounds,
    outbounds: [
      { ...node.outbound, tag: 'proxy' },
      { type: 'direct', tag: 'direct' },
    ],
    route: {
      rules,
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'dns-local',
    },
    experimental: { clash_api: { external_controller: `127.0.0.1:${API_PORT}` } },
  });
}

/** کانفیگ موقت برای تست پینگ واقعی (همه سرورها با هم، از طریق Clash API) */
export function buildTestConfig(nodes: VNode[]) {
  return clean({
    log: { level: 'error' },
    dns: { servers: [{ type: 'local', tag: 'dns-local' }] },
    outbounds: [
      ...nodes.map((n, i) => ({ ...n.outbound, tag: `n${i}` })),
      { type: 'direct', tag: 'direct' },
    ],
    route: { final: 'direct', auto_detect_interface: true, default_domain_resolver: 'dns-local' },
    // experimental.clash_api رو بک‌اند با یه پورت آزاد اضافه می‌کنه
  });
}
