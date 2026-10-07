// Shared primitives for the StreamOtter illustration family.
// Shape language: fills first; only two stroke widths (6 = primary, 3 = fine);
// round caps/joins; corner radii 14 (cards), 10 (windows), 8 (chips).
export const r1 = (n) => Math.round(n * 10) / 10;
export const pt = (p) => `${r1(p[0])} ${r1(p[1])}`;

export const PAL = {
  light: {
    mode: 'light',
    fg: '#04183F', body: '#04183F', panel: '#E9F2FC', window: '#FFFFFF',
    azure: '#048DFC', splash: '#04BDFD', hi: '#FFFFFF',
    muted: '#A9BAD5', label: '#A9BAD5', edge: '#A9BAD5', ripple: '#C8D6EA',
    live: '#00728A', stale: '#7F4F00', liveFill: '#01E1FC', staleFill: '#F2B84B', onLive: '#00728A', onStale: '#7F4F00',
    ice: '#D3DFEF', iceLine: '#A9BAD5', iceDash: '#F4F8FD', iceFacet: '#FFFFFF',
    brown: '#7F5447', brownDark: '#5E3D33', cream: '#EBE6DF', whisker: '#A9BAD5',
    rock: '#5E3D33', rockFacet: '#7F5447', rockCrack: '#3E2721',
    pool: '#E9F2FC', paper: '#F7F4EF', rule: '#E4DDD2',
    bg: '#FFFFFF',
  },
  dark: {
    mode: 'dark',
    fg: '#E9F2FC', body: '#123A7A', panel: '#0E2A5C', window: '#04183F',
    azure: '#048DFC', splash: '#04BDFD', hi: '#E9F2FC',
    muted: '#5873A3', label: '#3A5A92', edge: '#1B3D78', ripple: '#1B3D78',
    live: '#01E1FC', stale: '#F2B84B', liveFill: '#01E1FC', staleFill: '#F2B84B', onLive: '#04183F', onStale: '#04183F',
    ice: '#3A5687', iceLine: '#A9BAD5', iceDash: '#7F97C2', iceFacet: '#A9BAD5',
    brown: '#7F5447', brownDark: '#5E3D33', cream: '#EBE6DF', whisker: '#A9BAD5',
    rock: '#5E3D33', rockFacet: '#7F5447', rockCrack: '#3E2721',
    pool: '#0E2A5C', paper: '#F7F4EF', rule: '#E4DDD2',
    bg: '#04183F',
  },
};

// Catmull-Rom through points -> cubic Bezier segments (no leading M).
export function curveSegs(pts) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}
export const smooth = (pts) => `M${pt(pts[0])}${curveSegs(pts)}`;

// A filled band around a centerline c(t) with full width w(t).
export function band(c, w, n = 24) {
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = c(Math.max(0, t - 0.002)), b = c(Math.min(1, t + 0.002));
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    const p = c(t), h = w(t) / 2;
    top.push([p[0] + ty * h, p[1] - tx * h]);
    bot.push([p[0] - ty * h, p[1] + tx * h]);
  }
  bot.reverse();
  return `M${pt(top[0])}${curveSegs(top)}L${pt(bot[0])}${curveSegs(bot)}Z`;
}

export const taper = (p = 0.6, skew = 1) => (t) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, skew))), p);

// Sine centerline sharing a global phase so parallel ribbons stay in step.
export const sineY = (y, amp, wl, ph = 0) => (x) => y + amp * Math.sin((2 * Math.PI * x) / wl + ph);

export function ribbon({ x0, x1, y, amp = 8, wl = 160, ph = 0, th = 10, p = 0.6, skew = 1, n }) {
  const f = sineY(y, amp, wl, ph);
  return band((t) => { const x = x0 + (x1 - x0) * t; return [x, f(x)]; }, (t) => th * taper(p, skew)(t), n || Math.max(12, Math.round((x1 - x0) / 16)));
}

// Seeded PRNG.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Fill a row of code dashes along y=f(x)+dy between xa..xb. Returns [{x,len}] (len 0 = dot).
export function dashRow(xa, xb, seed, opts = {}) {
  const R = rng(seed), out = [];
  const lens = opts.lens || [0, 14, 26, 40, 58];
  const gap = opts.gap || 14;
  let x = xa + R() * 10;
  while (x < xb) {
    const len = lens[Math.floor(R() * lens.length)];
    if (x + len > xb) break;
    out.push({ x, len, k: R() });
    x += len + gap + R() * 8;
  }
  return out;
}

export function dashPaths(row, f, dy, colorFn) {
  // group by colour so output stays compact
  const groups = {};
  for (const d of row) {
    const col = colorFn(d);
    (groups[col] ||= []).push(d);
  }
  let s = '';
  for (const [col, ds] of Object.entries(groups)) {
    let path = '';
    for (const d of ds) {
      const a = [d.x, f(d.x) + dy], b = [d.x + d.len, f(d.x + d.len) + dy];
      path += `M${pt(a)}L${pt(b)}`;
    }
    s += `<path d="${path}" stroke="${col}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
  }
  return s;
}

// A code stream: body + azure top ribbon + splash bottom ribbon + dash rows.
export function codeStream(P, o) {
  const { x0, x1, y, amp = 8, wl = 200, ph = 0, H = 56, seed = 1, edges = true, bodyP = 0.3, rows, dashColor, xa, xb, bodyFill } = o;
  const f = sineY(y, amp, wl, ph);
  const bodyD = o.wFn ? band((t) => { const x = x0 + (x1 - x0) * t; return [x, f(x)]; }, (t) => H * o.wFn(t), Math.max(12, Math.round((x1 - x0) / 16))) : ribbon({ x0, x1, y, amp, wl, ph, th: H, p: bodyP });
  let s = `<path d="${bodyD}" fill="${bodyFill || P.body}"/>`;
  if (edges) {
    const g = 9;
    s += `<path d="${ribbon({ x0: x0 + (o.topIn ?? 24), x1: x1 - (o.topOut ?? 60), y: y - H / 2 - g - 2, amp, wl, ph, th: 10, p: 0.6, skew: 0.8 })}" fill="${P.azure}"/>`;
    s += `<path d="${ribbon({ x0: x0 + (o.botIn ?? 60), x1: x1 - (o.botOut ?? 14), y: y + H / 2 + g + 2, amp, wl, ph, th: 10, p: 0.6, skew: 1.25 })}" fill="${P.splash}"/>`;
  }
  const rs = rows || (H >= 56 ? [-H / 4.2, 0, H / 4.2] : H >= 36 ? [-H / 5, H / 5] : [0]);
  const A = xa ?? x0 + H * 0.9, B = xb ?? x1 - H * 0.9;
  const cf = dashColor || ((d) => (d.len === 0 ? P.hi : d.k < 0.55 ? P.splash : d.k < 0.8 ? P.hi : P.azure));
  rs.forEach((dy, i) => { s += dashPaths(dashRow(A + (i % 2) * 12, B, seed * 31 + i * 7, o.dashOpts), f, dy, cf); });
  return s;
}

// Teardrop droplet with its point toward angle `rot` degrees (0 = up).
export function drop(cx, cy, r, rot, fill) {
  const d = `M0 ${r1(-r * 2.1)}C${r1(r * 0.5)} ${r1(-r * 1.25)} ${r1(r)} ${r1(-r * 0.75)} ${r1(r)} 0A${r1(r)} ${r1(r)} 0 0 1 ${r1(-r)} 0C${r1(-r)} ${r1(-r * 0.75)} ${r1(-r * 0.5)} ${r1(-r * 1.25)} 0 ${r1(-r * 2.1)}Z`;
  return `<path transform="translate(${r1(cx)} ${r1(cy)}) rotate(${rot})" d="${d}" fill="${fill}"/>`;
}
export const dot = (cx, cy, r, fill) => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(r)}" fill="${fill}"/>`;

// Bad-record "rock": knotted, irregular pebble with a facet and a crack.
export function rock(P, cx, cy, s = 1) {
  const pts = [[-26, -6], [-18, -20], [-2, -24], [10, -16], [24, -18], [28, -2], [20, 14], [4, 20], [-14, 18], [-27, 8]].map(([x, y]) => [cx + x * s, cy + y * s]);
  const facet = [[-18, -20], [-2, -24], [10, -16], [2, -6], [-14, -6]].map(([x, y]) => [cx + x * s, cy + y * s]);
  const crack = [[-8, 6], [0, 0], [8, 8], [16, 2]].map(([x, y]) => [cx + x * s, cy + y * s]);
  const poly = (a) => a.map(pt).join(' ');
  return `<g stroke-linejoin="round"><polygon points="${poly(pts)}" fill="${P.rock}" stroke="${P.rock}" stroke-width="6"/>` +
    `<polygon points="${poly(facet)}" fill="${P.rockFacet}" stroke="${P.rockFacet}" stroke-width="3"/>` +
    `<polyline points="${poly(crack)}" fill="none" stroke="${P.rockCrack}" stroke-width="3" stroke-linecap="round"/></g>`;
}

// Digits drawn as strokes in a 10x16 box (mono-like, round caps).
const DIG = {
  1: 'M2.5 3.5L6 0.5V15.5',
  2: 'M1 4.2C1 2 2.8 0.5 5 0.5C7.4 0.5 9 2 9 4.2C9 6.6 7 8.4 1 15.5H9.5',
  3: 'M1.2 2.2C2 1.1 3.4 0.5 5 0.5C7.4 0.5 9 1.9 9 3.9C9 6 7.3 7.5 4.6 7.5C7.6 7.5 9.4 9.1 9.4 11.5C9.4 14 7.5 15.5 5 15.5C3.2 15.5 1.8 14.8 1 13.7',
  4: 'M7.4 15.5V0.5L0.8 11H9.8',
  5: 'M8.8 0.5H2L1.4 7.2C2.4 6.4 3.6 6 5 6C7.6 6 9.4 7.8 9.4 10.6C9.4 13.6 7.4 15.5 4.8 15.5C3.2 15.5 1.9 14.9 1 13.8',
  6: 'M8.2 1.4C7.3 0.8 6.3 0.5 5.2 0.5C2.6 0.5 1 3 1 8.4C1 13 2.6 15.5 5.2 15.5C7.6 15.5 9.3 13.6 9.3 10.9C9.3 8.3 7.6 6.6 5.3 6.6C3.4 6.6 1.9 7.6 1.1 9.4',
  7: 'M0.8 0.5H9.4L4 15.5',
  8: 'M5.1 7.6C2.9 7.6 1.4 6.2 1.4 4C1.4 1.9 3 0.5 5.1 0.5C7.2 0.5 8.8 1.9 8.8 4C8.8 6.2 7.3 7.6 5.1 7.6ZM5.1 7.6C2.6 7.6 0.9 9.2 0.9 11.5C0.9 13.9 2.7 15.5 5.1 15.5C7.5 15.5 9.3 13.9 9.3 11.5C9.3 9.2 7.6 7.6 5.1 7.6Z',
};
export function digit(n, cx, cy, h, color, sw = 3) {
  const k = h / 16;
  return `<path transform="translate(${r1(cx - 5 * k)} ${r1(cy - 8 * k)}) scale(${r1(k * 100) / 100})" d="${DIG[n]}" fill="none" stroke="${color}" stroke-width="${r1(sw / k)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Numbered step marker: filled circle with a stroked digit.
export function step(P, n, cx, cy, r = 22) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.fg}"/>` + digit(n, cx + 0.3, cy, r * 0.95, P.mode === 'light' ? '#FFFFFF' : '#04183F', 4);
}

export function svg(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="title"><title id="title">${title}</title>\n${body}\n</svg>\n`;
}
