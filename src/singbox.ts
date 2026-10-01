import type { VNode } from './parser';

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
  return clean({
    log: { level: 'warn', timestamp: true },
    dns: {
      servers: [
        { type: 'https', tag: 'dns-remote', server: '1.1.1.1', detour: 'proxy' },
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
      rules: [
        { action: 'sniff' },
        { protocol: 'dns', action: 'hijack-dns' },
        { ip_is_private: true, outbound: 'direct' },
      ],
      final: 'proxy',
      auto_detect_interface: true,
      default_domain_resolver: 'dns-local',
    },
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
