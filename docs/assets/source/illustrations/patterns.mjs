import { PAL, ribbon, drop, dot, svg, sineY, dashRow, dashPaths, pt, r1 } from './lib.mjs';

const TINT = {
  light: { a: '#D7ECFE', s: '#D7F4FF' }, // azure 16% / splash 16% on white
  dark: { a: '#04285A', s: '#042F5A' },  // azure 14% / splash 14% on ink
};

// Seamless 240x160 tile of the mark's wave ribbons (pre-tinted, subtle).
export function waveTile(P) {
  const T = TINT[P.mode], W = 240, wl = 240;
  const segs = [
    { x0: 16, x1: 196, y: 34, amp: 6, th: 11, c: T.a, skew: 0.8 },
    { x0: 96, x1: 262, y: 52, amp: 6, th: 8, c: T.s, skew: 1.3 },
    { x0: 136, x1: 330, y: 112, amp: 6, th: 11, c: T.a, skew: 0.8, ph: Math.PI },
    { x0: 210, x1: 380, y: 130, amp: 6, th: 8, c: T.s, skew: 1.3, ph: Math.PI },
  ];
  let s = '';
  for (const g of segs) {
    for (const dx of [-W, 0, W]) {
      const a = g.x0 + dx, b = g.x1 + dx;
      if (b < 0 || a > W) continue;
      s += `<path d="${ribbon({ x0: a, x1: b, y: g.y, amp: g.amp, wl, ph: g.ph || 0, th: g.th, p: 0.6, skew: g.skew })}" fill="${g.c}"/>`;
    }
  }
  s += drop(40, 84, 4, -30, T.s) + dot(56, 78, 2.5, T.a) + drop(118, 150, 3.5, 30, T.s) + dot(206, 82, 3, T.a);
  return svg(W, 160, 'Wave ribbon tile', s);
}

// 1600x160 horizontally seamless band of code-stream dashes.
export function codeBand(P) {
  const W = 1600, y = 80, H = 60, amp = 8, wl = 400;
  const f = sineY(y, amp, wl, 0);
  let s = `<path d="${ribbon({ x0: -60, x1: W + 60, y, amp, wl, th: H, p: 0.001, n: 120 })}" fill="${P.body}"/>`;
  const tops = [[40, 420], [520, 880], [980, 1380], [1460, 1780]];
  const bots = [[220, 640], [740, 1120], [1220, 1560]];
  const rib = (list, dy, th, c, skew) => {
    for (const [a0, b0] of list) for (const dx of [-W, 0]) {
      const a = a0 + dx, b = b0 + dx;
      if (b < 0 || a > W) continue;
      s += `<path d="${ribbon({ x0: a, x1: b, y: y + dy, amp, wl, th, p: 0.6, skew })}" fill="${c}"/>`;
    }
  };
  rib(tops, -H / 2 - 13, 10, P.azure, 0.8);
  rib(bots, H / 2 + 13, 10, P.splash, 1.25);
  const cf = (d) => (d.len === 0 ? P.hi : d.k < 0.55 ? P.splash : d.k < 0.8 ? P.hi : P.azure);
  [-15, 0, 15].forEach((dy, i) => {
    const row = dashRow(i === 1 ? 150 : 12 + i * 9, W - 14, 77 + i * 13, { gap: 22, lens: [0, 18, 30, 48, 70] });
    s += dashPaths(row, f, dy, cf);
  });
  // prompt chevron, as in the detailed logo
  s += `<path d="M118 ${r1(f(118) - 7)}L128 ${r1(f(124))}L118 ${r1(f(130) + 7)}" fill="none" stroke="${P.hi}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += drop(470, 22, 5, -25, P.splash) + dot(488, 16, 3, P.azure) + drop(1130, 142, 4.5, 155, P.splash) + dot(1110, 148, 3, P.azure) + dot(1490, 18, 3.5, P.splash);
  return svg(W, 160, 'Code stream band', s);
}

// 1200x48 divider: one wave ribbon with droplets.
export function divider(P) {
  let s = `<path d="${ribbon({ x0: 40, x1: 1112, y: 24, amp: 5, wl: 300, ph: 0.4, th: 9, p: 0.6, skew: 1.15, n: 80 })}" fill="${P.azure}"/>`;
  s += `<path d="${ribbon({ x0: 640, x1: 1080, y: 33, amp: 5, wl: 300, ph: 0.4, th: 5, p: 0.6, skew: 1.2, n: 30 })}" fill="${P.splash}"/>`;
  s += drop(1136, 22, 4.5, -75, P.splash) + dot(1156, 14, 3, P.azure) + dot(1170, 26, 2.2, P.splash) + dot(24, 28, 2.5, P.splash);
  return svg(1200, 48, 'Wave divider', s);
}

// 240x240 corner scatter of droplets (top-left corner; rotate/flip in CSS for others).
export function droplets(P) {
  let s = '';
  const items = [
    [34, 50, 9, -40, 'splash'], [70, 26, 5, -60, 'azure'], [22, 96, 5, -20, 'azure'],
    [96, 60, 3.5, 0, 'dot-splash'], [60, 92, 6, 0, 'dot-azure'], [126, 30, 3, 0, 'dot-azure'],
    [104, 104, 4, -45, 'splash'], [38, 140, 3, 0, 'dot-splash'], [150, 72, 2.5, 0, 'dot-splash'],
    [80, 150, 2.5, 0, 'dot-azure'], [172, 24, 2, 0, 'dot-splash'], [20, 186, 2, 0, 'dot-azure'],
  ];
  for (const [x, y, r, rot, k] of items) {
    if (k.startsWith('dot')) s += dot(x, y, r, k.endsWith('azure') ? P.azure : P.splash);
    else s += drop(x, y, r, rot, k === 'azure' ? P.azure : P.splash);
  }
  return svg(240, 240, 'Splash droplets', s);
}

export const PATTERNS = {
  'wave-tile': [waveTile, true],
  'code-stream-band': [codeBand, true],
  divider: [divider, false],
  droplets: [droplets, false],
};
