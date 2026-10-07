import { PAL, ribbon, codeStream, drop, dot, rock, digit, svg, sineY, smooth, band, taper, pt, r1, dashRow, dashPaths } from './lib.mjs';

// ---------- 1. live vs stale ----------
function card(P, x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${P.panel}"/>`;
}
export function pill(P, x, y, live) {
  // status pill: bright fill, dot + label bar in the matching on-colour
  const on = live ? P.onLive : P.onStale;
  let s = `<rect x="${x}" y="${y}" width="74" height="24" rx="12" fill="${live ? P.liveFill : P.staleFill}"/>`;
  s += dot(x + 14, y + 12, 4.5, on);
  s += `<path d="M${x + 27} ${y + 12}H${x + 60}" stroke="${on}" stroke-width="3" stroke-linecap="round"/>`;
  return s;
}
export function liveVsStale(P) {
  const id = P.mode;
  let s = '';
  const W = 200, H = 248, Y = 36, X = [28, 252];
  for (let i = 0; i < 2; i++) {
    const x = X[i], live = i === 0;
    s += card(P, x, Y, W, H);
    s += pill(P, x + 16, Y + 16, live);
    s += `<path d="M${x + 106} ${Y + 28}H${x + 150}" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
    // window
    const wx = x + 14, wy = Y + 56, ww = W - 28, wh = 132;
    s += `<clipPath id="w${i}${id}"><rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="10"/></clipPath>`;
    s += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="10" fill="${P.window}"/>`;
    s += `<g clip-path="url(#w${i}${id})">`;
    const cy = wy + wh / 2 + 2;
    if (live) {
      s += codeStream(P, { x0: wx - 30, x1: wx + ww + 30, y: cy, amp: 7, wl: 150, ph: 0.6, H: 50, seed: 3, topIn: 10, topOut: 10, botIn: 10, botOut: 10, bodyP: 0.05, xa: wx - 10, xb: wx + ww + 10 });
      s += drop(wx + 30, wy + 26, 5, -30, P.splash) + dot(wx + 46, wy + 20, 3, P.azure);
    } else {
      // iced: same stream frozen
      const iceP = { ...P, body: P.ice, azure: P.iceLine, splash: P.iceLine, hi: P.iceDash };
      s += codeStream(iceP, { x0: wx - 30, x1: wx + ww + 30, y: cy, amp: 7, wl: 150, ph: 0.6, H: 50, seed: 3, topIn: 10, topOut: 10, botIn: 10, botOut: 10, bodyP: 0.05, xa: wx - 10, xb: wx + ww + 10, dashColor: () => P.iceDash });
      // ice facets
      const f = sineY(cy, 7, 150, 0.6);
      const facets = [[wx + 22, -14, 30], [wx + 92, -10, 22], [wx + 128, 4, 26]];
      for (const [fx, dy, sz] of facets) {
        const yy = f(fx) + dy;
        s += `<polygon points="${pt([fx, yy])} ${pt([fx + sz * 0.6, yy - sz * 0.3])} ${pt([fx + sz, yy + sz * 0.15])} ${pt([fx + sz * 0.45, yy + sz * 0.4])}" fill="${P.iceFacet}" opacity="0.6"/>`;
      }
      // icicles hanging from the lower ribbon
      for (const ix of [wx + 36, wx + 58, wx + 104, wx + 140]) {
        const iy = f(ix) + 25 + 11;
        const len = 10 + ((ix * 7) % 9);
        s += `<path d="M${r1(ix - 5)} ${r1(iy)}L${r1(ix + 5)} ${r1(iy)}L${r1(ix)} ${r1(iy + len)}Z" fill="${P.iceLine}" stroke="${P.iceLine}" stroke-width="3" stroke-linejoin="round"/>`;
      }
    }
    s += `</g>`;
    if (!live) {
      // pause badge
      const bx = wx + ww / 2, by = cy;
      s += `<circle cx="${bx}" cy="${by}" r="21" fill="${P.staleFill}"/>`;
      s += `<path d="M${bx - 6} ${by - 8}V${by + 8}M${bx + 6} ${by - 8}V${by + 8}" stroke="${P.onStale}" stroke-width="6" stroke-linecap="round"/>`;
    }
    // sparkline footer
    const sy = Y + H - 32, sx0 = x + 20, sx1 = x + W - 20;
    const pts = [];
    for (let k = 0; k <= 12; k++) { const xx = sx0 + ((sx1 - sx0) * k) / 12; pts.push([xx, sy + 8 * Math.sin(k * 1.1) - (k * 0.6)]); }
    if (live) {
      s += `<path d="${smooth(pts)}" fill="none" stroke="${P.azure}" stroke-width="3" stroke-linecap="round"/>`;
      s += `<circle cx="${r1(pts[12][0])}" cy="${r1(pts[12][1])}" r="9" fill="${P.liveFill}" opacity="0.35"/>` + dot(pts[12][0], pts[12][1], 5, P.live);
    } else {
      const cut = pts.slice(0, 7);
      s += `<path d="${smooth(cut)}" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round"/>`;
      s += `<path d="M${pt(cut[6])}H${sx1}" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 8"/>`;
      s += dot(cut[6][0], cut[6][1], 5, P.stale);
    }
  }
  return svg(480, 320, 'Two views of the same state: one live and flowing, one visibly stale and paused', s);
}

// ---------- 2. snapshot then updates ----------
export function snapshotThenUpdates(P) {
  let s = '';
  const y = 214;
  s += codeStream(P, { x0: 96, x1: 464, y, amp: 8, wl: 220, ph: 2.2, H: 48, seed: 11, topIn: 70, botIn: 90 });
  const f = sineY(y, 8, 220, 2.2);
  // revision flags
  const xs = [236, 300, 364, 428];
  xs.forEach((x, i) => {
    const top = f(x) - 24 - 2;
    s += `<path d="M${x} ${r1(top)}V${r1(118)}" stroke="${P.muted}" stroke-width="3" stroke-linecap="round"/>`;
    s += dot(x, top, 5.5, P.hi === '#FFFFFF' ? P.azure : P.splash);
    s += `<rect x="${x - 19}" y="${86}" width="38" height="38" rx="8" fill="${i === 3 ? P.splash : P.azure}"/>`;
    s += digit(i + 1, x, 105, 18, P.mode === 'light' ? '#FFFFFF' : '#04183F', 3);
  });
  // flow chevron at the end of the flags
  s += `<path d="M452 98L462 105L452 112" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  // snapshot card (photo), slightly tilted, sitting at the head of the stream
  s += `<g transform="rotate(-6 112 170)">`;
  s += `<rect x="40" y="84" width="144" height="168" rx="10" fill="${P.mode === 'light' ? '#FFFFFF' : P.panel}" stroke="${P.edge}" stroke-width="3"/>`;
  s += `<clipPath id="ph${P.mode}"><rect x="52" y="96" width="120" height="110" rx="6"/></clipPath>`;
  s += `<rect x="52" y="96" width="120" height="110" rx="6" fill="${P.mode === 'light' ? P.panel : P.window}"/>`;
  s += `<g clip-path="url(#ph${P.mode})">` + codeStream(P, { x0: 30, x1: 200, y: 156, amp: 6, wl: 110, ph: 0.4, H: 34, seed: 5, topIn: 0, topOut: 0, botIn: 0, botOut: 0, bodyP: 0.05, xa: 48, xb: 178 }) + dot(150, 116, 7, P.splash) + `</g>`;
  s += `<path d="M58 228H112" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/><path d="M58 228H112" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  s += `<path d="M126 228H140" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  s += `</g>`;
  // flash marks
  s += `<path d="M190 66L198 54M202 76L216 72M184 56L184 44" stroke="${P.splash}" stroke-width="3" stroke-linecap="round"/>`;
  return svg(480, 320, 'A snapshot card, then numbered revision updates flowing in order along a stream', s);
}

// ---------- 3. state channels ----------
export function stateChannels(P) {
  let s = '';
  const y = 160;
  const types = [
    { col: P.splash, lens: [40], gap: 16 },
    { col: P.hi, lens: [0], gap: 14 },
    { col: P.azure, lens: [14], gap: 14 },
  ];
  const ends = [74, 160, 246];
  const H = 84, X0 = 24, XJ = 172;
  const bw = (x) => H * Math.pow(Math.sin((Math.PI / 2) * Math.min((x - X0) / 80, 1)), 0.4);
  const offs = [-26.5, 0, 26.5];
  const cw = (t) => 22 + 9 * (1 - Math.min(1, t / 0.3)) ** 2;
  const chans = ends.map((ey, i) => {
    const p0 = [XJ, y + offs[i]], c1 = [258, y + offs[i]], c2 = [292, ey], p3 = [404, ey];
    return (t) => { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]; };
  });
  const N = 40;
  const edge = (B, side) => { const out = []; for (let k = 0; k <= N; k++) { const t = k / N, a = B(Math.max(0, t - 0.002)), b = B(Math.min(1, t + 0.002)); let tx = b[0] - a[0], ty = b[1] - a[1]; const L = Math.hypot(tx, ty); tx /= L; ty /= L; const p = B(t), h = (cw(t) / 2) * side; out.push([p[0] + ty * h, p[1] - tx * h]); } return out; };
  const E = chans.map((B) => ({ top: edge(B, 1), bot: edge(B, -1) }));
  const sep = (upper, lower) => { for (let k = 0; k <= N; k++) if (upper[k][1] < lower[k][1] - 1) return k; return N; };
  const k1 = sep(E[0].bot, E[1].top), k2 = sep(E[1].bot, E[2].top);
  const bodyTop = [], bodyBot = [];
  for (const x of [X0, X0 + 2, X0 + 6, X0 + 12, X0 + 20, X0 + 32, X0 + 48, X0 + 66, X0 + 86, X0 + 106, X0 + 126]) { bodyTop.push([x, y - bw(x) / 2]); bodyBot.push([x, y + bw(x) / 2]); }
  bodyTop.push([XJ, y - H / 2]); bodyBot.push([XJ, y + H / 2]);
  const crotch = (a, b) => `Q${pt([(a[0] + b[0]) / 2 - 10, (a[1] + b[1]) / 2])} ${pt(b)}`;
  let d = `M${pt(bodyTop[0])}${(await_seg(bodyTop))}`;
  function await_seg(arr) { return arr.length > 1 ? curveSegsLocal(arr) : ''; }
  function curveSegsLocal(arr) { return smooth(arr).replace(/^M[^C]*/, ''); }
  d += `L${pt(E[0].top[0])}${curveSegsLocal(E[0].top)}`;
  const r0 = E[0].bot.slice(k1).reverse(); d += `L${pt(r0[0])}${curveSegsLocal(r0)}`;
  const m1 = E[1].top.slice(k1); d += crotch(r0[r0.length - 1], m1[0]) + curveSegsLocal(m1);
  const r1b = E[1].bot.slice(k2).reverse(); d += `L${pt(r1b[0])}${curveSegsLocal(r1b)}`;
  const m2 = E[2].top.slice(k2); d += crotch(r1b[r1b.length - 1], m2[0]) + curveSegsLocal(m2);
  const r2 = E[2].bot.slice().reverse(); d += `L${pt(r2[0])}${curveSegsLocal(r2)}`;
  const bb = bodyBot.slice().reverse(); d += `L${pt(bb[0])}${curveSegsLocal(bb)}Z`;
  s += `<path d="${d}" fill="${P.body}"/>`;
  s += `<path d="${ribbon({ x0: 40, x1: 196, y: y - H / 2 - 11, amp: 5, wl: 170, ph: 2, th: 10, p: 0.6, skew: 0.8 })}" fill="${P.azure}"/>`;
  s += `<path d="${ribbon({ x0: 70, x1: 214, y: y + H / 2 + 11, amp: 5, wl: 170, ph: 2, th: 10, p: 0.6, skew: 1.25 })}" fill="${P.splash}"/>`;
  const fy = () => y;
  [-24, -8, 8, 24].forEach((dy, i) => { s += dashPaths(dashRow(56 + (i % 2) * 10 + Math.abs(dy) * 0.6, 196, 21 * 31 + i * 7, { lens: [0, 14, 40], gap: 12 }), fy, dy, (dd) => (dd.len === 0 ? P.hi : dd.len === 14 ? P.azure : P.splash)); });
  // dashes along each channel, one kind per channel
  chans.forEach((B, i) => {
    const T = types[i];
    let path = '';
    if (T.lens[0] === 0) {
      for (let t = 0.26; t <= 0.8; t += 0.09) { const p = B(t); s += dot(p[0], p[1], 4, T.col); }
    } else {
      for (let t = 0.24; t <= 0.8; t += T.lens[0] > 20 ? 0.24 : 0.1) {
        const a = B(t), b = B(t + (T.lens[0] > 20 ? 0.13 : 0.035));
        path += `M${pt(a)}L${pt(b)}`;
      }
      s += `<path d="${path}" stroke="${T.col}" stroke-width="6" stroke-linecap="round" fill="none"/>`;
    }
  });
  // view cards
  ends.forEach((ey, i) => {
    const T = types[i];
    const x = 376, w = 84, h = 64;
    s += `<rect x="${x}" y="${ey - h / 2}" width="${w}" height="${h}" rx="14" fill="${P.panel}"/>`;
    s += `<rect x="${x + 10}" y="${ey - h / 2 + 10}" width="${w - 20}" height="${h - 20}" rx="8" fill="${P.body}"/>`;
    if (T.lens[0] === 0) s += dot(x + 30, ey, 5, T.col) + dot(x + 54, ey, 5, T.col);
    else if (T.lens[0] > 20) s += `<path d="M${x + 24} ${ey}H${x + 60}" stroke="${T.col}" stroke-width="6" stroke-linecap="round"/>`;
    else s += `<path d="M${x + 24} ${ey}H${x + 34}M${x + 50} ${ey}H${x + 60}" stroke="${T.col}" stroke-width="6" stroke-linecap="round"/>`;
  });
  return svg(480, 320, 'One wide Kafka stream branching into narrow state channels, each carrying only its own state', s);
}

// ---------- 4. hold ----------
export function hold(P) {
  let s = '';
  const y = 196, amp = 6, wl = 240, ph = 0.5;
  const f = sineY(y, amp, wl, ph);
  // full channel body + ribbons
  s += codeStream(P, { x0: 20, x1: 462, y, amp, wl, ph, H: 56, seed: 31, xa: 58, xb: 214, dashOpts: { lens: [0, 14, 26], gap: 9 } });
  // calm downstream: cover with flat still lines
  s += `<path d="M350 ${r1(f(350) - 6)}H420M372 ${r1(f(372) + 10)}H436" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
  // the bad record lodged upstream of the gate
  s += rock(P, 252, f(252) + 2, 1.05);
  // gate (sluice): posts, beam, lowered panel
  const gx = 300;
  s += `<rect x="${gx - 4}" y="138" width="40" height="${r1(f(gx) + 34 - 138)}" rx="6" fill="${P.muted}"/>`;
  s += `<path d="M${gx + 4} 160H${gx + 28}M${gx + 4} 182H${gx + 28}M${gx + 4} 204H${gx + 28}" stroke="${P.mode === 'light' ? '#FFFFFF' : P.panel}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<rect x="${gx - 12}" y="96" width="12" height="160" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx + 32}" y="96" width="12" height="160" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx - 20}" y="96" width="72" height="14" rx="7" fill="${P.fg}"/>`;
  // stale lamp on top
  s += `<circle cx="${gx + 16}" cy="78" r="16" fill="${P.staleFill}" opacity="0.3"/>` + dot(gx + 16, 78, 10, P.staleFill) + dot(gx + 16, 78, 4, P.onStale);
  s += `<path d="M${gx + 16} 87V96" stroke="${P.fg}" stroke-width="3"/>`;
  // queued-up dashes bunching behind the rock: small wake marks
    s += drop(208, f(208) - 48, 4.5, -40, P.splash) + dot(228, f(228) - 56, 3, P.azure);
  s += `<path d="M412 ${r1(f(412) - 34)}V124" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 8"/>`;
  s += `<rect x="370" y="60" width="84" height="64" rx="14" fill="${P.panel}"/>`;
  s += `<rect x="382" y="72" width="48" height="18" rx="9" fill="${P.staleFill}"/>` + dot(392, 81, 3.5, P.onStale) + `<path d="M400 81H420" stroke="${P.onStale}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M385 106H420M428 106H440" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  return svg(480, 320, 'A bad record lodged in the stream and a closed gate: nothing passes until it is dealt with', s);
}

// ---------- 5/6 pool helper ----------
export function pool(P, cx, cy, rx, ry, rings = true) {
  let s = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${P.pool}"/>`;
  s += `<path d="${ribbon({ x0: cx - rx * 0.92, x1: cx + rx * 0.6, y: cy - ry - 8, amp: 3, wl: 200, th: 6, p: 0.6 })}" fill="${P.azure}" transform="rotate(0)"/>`;
  if (rings) {
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.62}" ry="${ry * 0.55}" fill="none" stroke="${P.ripple}" stroke-width="3"/>`;
    s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.3}" ry="${ry * 0.25}" fill="none" stroke="${P.ripple}" stroke-width="3"/>`;
  }
  return s;
}

// Small "copy" glyph: two overlapping rounded squares on a disc.
export function copyBadge(P, cx, cy) {
  const back = P.mode === 'light' ? '#FFFFFF' : P.panel;
  return `<circle cx="${cx}" cy="${cy}" r="21" fill="${back}" stroke="${P.edge}" stroke-width="3"/>` +
    `<rect x="${cx - 10}" y="${cy - 10}" width="13" height="13" rx="3" fill="${P.muted}" stroke="${P.muted}" stroke-width="3"/>` +
    `<rect x="${cx - 3}" y="${cy - 3}" width="13" height="13" rx="3" fill="${back}" stroke="${P.fg}" stroke-width="3"/>`;
}
// Sluice gate (closed) with the stale lamp; posts gx-12..gx+44, stream centre fy.
function closedGate(P, gx, fy) {
  const beam = fy - 76, bottom = fy + 44;
  let s = `<rect x="${gx - 4}" y="${r1(fy - 42)}" width="40" height="${r1(bottom - 6 - (fy - 42))}" rx="6" fill="${P.muted}"/>`;
  s += `<path d="M${gx + 4} ${r1(fy - 20)}H${gx + 28}M${gx + 4} ${r1(fy + 2)}H${gx + 28}M${gx + 4} ${r1(fy + 24)}H${gx + 28}" stroke="${P.mode === 'light' ? '#FFFFFF' : P.panel}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<rect x="${gx - 12}" y="${r1(beam)}" width="12" height="${r1(bottom - beam)}" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx + 32}" y="${r1(beam)}" width="12" height="${r1(bottom - beam)}" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx - 20}" y="${r1(beam)}" width="72" height="14" rx="7" fill="${P.fg}"/>`;
  s += `<circle cx="${gx + 16}" cy="${r1(beam - 18)}" r="16" fill="${P.staleFill}" opacity="0.3"/>` + dot(gx + 16, beam - 18, 10, P.staleFill) + dot(gx + 16, beam - 18, 4, P.onStale);
  s += `<path d="M${gx + 16} ${r1(beam - 8)}V${r1(beam)}" stroke="${P.fg}" stroke-width="3"/>`;
  return s;
}

// ---------- 5. quarantine ----------
// quarantine-hold: the original stays lodged at the closed gate (source held);
// a byte-for-byte copy goes to the calm side pool (the quarantine topic).
export function quarantine(P) {
  let s = '';
  const y = 230, amp = 6, wl = 240, ph = 0.5;
  const f = sineY(y, amp, wl, ph);
  s += codeStream(P, { x0: 20, x1: 462, y, amp, wl, ph, H: 56, seed: 31, xa: 58, xb: 214, dashOpts: { lens: [0, 14, 26], gap: 9 } });
  s += `<path d="M350 ${r1(f(350) - 6)}H420M372 ${r1(f(372) + 10)}H436" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
  // side pool, top left, holding the copy
  const pc = [112, 76];
  s += pool(P, pc[0], pc[1], 82, 32, false);
  s += `<ellipse cx="${pc[0]}" cy="${pc[1] + 2}" rx="52" ry="19" fill="none" stroke="${P.ripple}" stroke-width="3"/>`;
  s += rock(P, pc[0], pc[1], 0.72);
  // dotted path from the held record up to the pool, with a copy badge
  s += `<path d="M246 ${r1(f(246) - 34)}C246 130 230 84 200 78" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 10"/>`;
  s += `<path d="M206 70L196 78L206 86" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += copyBadge(P, 240, 128);
  // the original, still lodged, and the closed gate
  s += rock(P, 252, f(252) + 2, 1.05);
  s += closedGate(P, 300, f(300));
  return svg(480, 320, 'A bad record held at a closed gate while a byte-for-byte copy is kept in a calm quarantine pool', s);
}

// ---------- 6. redrive ----------
// The source has already moved past (stream open, flowing). The stored copy is
// re-run through the current mapping, and its output is admitted only if newer.
export function redrive(P) {
  let s = '';
  const inner = P.mode === 'light' ? '#FFFFFF' : '#04183F';
  // the main stream, flowing freely below (source already moved on)
  s += codeStream(P, { x0: 20, x1: 462, y: 262, amp: 6, wl: 240, ph: 0.5, H: 40, seed: 52, botOut: 30 });
  // side pool with the stored copy
  const pc = [100, 82];
  s += pool(P, pc[0], pc[1], 76, 30, false);
  s += `<ellipse cx="${pc[0]}" cy="${pc[1] + 2}" rx="48" ry="17" fill="none" stroke="${P.ripple}" stroke-width="3"/>`;
  s += rock(P, pc[0], pc[1], 0.7);
  // dotted redrive path from the pool into the mapping node
  s += `<path d="M150 104C168 124 176 142 190 150" fill="none" stroke="${P.azure}" stroke-width="6" stroke-linecap="round" stroke-dasharray="0 13"/>`;
  // mapping node
  const nx = 196, ny = 120;
  s += `<rect x="${nx}" y="${ny}" width="64" height="64" rx="14" fill="${P.fg}"/>`;
  s += `<path d="M${nx + 12} ${ny + 22}H${nx + 22}M${nx + 12} ${ny + 32}H${nx + 18}M${nx + 12} ${ny + 42}H${nx + 24}" stroke="${P.splash}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M${nx + 28} ${ny + 24}L${nx + 36} ${ny + 32}L${nx + 28} ${ny + 40}" fill="none" stroke="${inner}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<rect x="${nx + 41}" y="${ny + 21}" width="13" height="22" rx="4" fill="${P.azure}"/>`;
  // narrow delivery channel from the node to the view
  const cy = ny + 32;
  s += `<path d="${ribbon({ x0: 252, x1: 380, y: cy, amp: 0, wl: 200, th: 22, p: 0.08 })}" fill="${P.body}"/>`;
  // the mapped state block travelling in the channel
  s += `<rect x="276" y="${cy - 9}" width="22" height="18" rx="5" fill="${P.azure}"/>`;
  // revision check: newer state wins (flag on a stem, like the revision ticks)
  const kx = 330;
  s += `<path d="M${kx} ${cy - 11}V${cy - 34}" stroke="${P.muted}" stroke-width="3" stroke-linecap="round"/>` + dot(kx, cy - 11, 5, P.azure);
  s += `<circle cx="${kx}" cy="${cy - 50}" r="17" fill="${P.liveFill}"/>`;
  s += `<path d="M${kx - 8} ${cy - 50}L${kx - 2} ${cy - 44}L${kx + 9} ${cy - 56}" fill="none" stroke="${P.onLive}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="M${kx - 26} ${cy - 50}H${kx - 40}M${kx + 26} ${cy - 50}H${kx + 40}" stroke="${P.edge}" stroke-width="3" stroke-linecap="round"/>`;
  // the view card, live, showing the delivered state
  const vx = 372, vy = cy - 50;
  s += `<rect x="${vx}" y="${vy}" width="96" height="100" rx="14" fill="${P.panel}"/>`;
  s += pill(P, vx + 11, vy + 12, true);
  s += `<rect x="${vx + 12}" y="${vy + 46}" width="72" height="42" rx="8" fill="${P.window}"/>`;
  s += `<rect x="${vx + 37}" y="${vy + 56}" width="22" height="22" rx="5" fill="${P.azure}"/>`;
  return svg(480, 320, 'Redrive: the stored copy of a quarantined record is re-run through the current mapping, and its state is delivered to the view only if it is newer', s);
}

// ---------- 7. incident journal ----------
export function journal(P) {
  let s = '';
  // cover
  s += `<rect x="56" y="44" width="368" height="236" rx="16" fill="${P.brown}"/>`;
  // pages
  s += `<path d="M70 62Q70 54 78 54Q160 50 238 60V268Q160 258 78 262Q70 262 70 254Z" fill="${P.paper}"/>`;
  s += `<path d="M410 62Q410 54 402 54Q320 50 242 60V268Q320 258 402 262Q410 262 410 254Z" fill="${P.paper}"/>`;
  s += `<path d="M240 60V268" stroke="${P.brownDark}" stroke-width="3"/>`;
  // ruled lines
  let rules = '';
  for (let yy = 90; yy <= 240; yy += 22) rules += `M86 ${yy}Q160 ${yy - 3} 226 ${yy + 1}M254 ${yy + 1}Q320 ${yy - 3} 394 ${yy}`;
  s += `<path d="${rules}" stroke="${P.rule}" stroke-width="3" stroke-linecap="round" fill="none"/>`;
  // left page: stream sketch
  s += `<path d="M92 150C112 138 132 138 152 150S192 162 212 150" fill="none" stroke="#048DFC" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M92 176C112 164 132 164 152 176S192 188 212 176" fill="none" stroke="#04BDFD" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M100 163H116M126 163H150M176 163H190" stroke="#A9BAD5" stroke-width="3" stroke-linecap="round"/>`;
  s += rock({ ...P, rock: P.paper, rockFacet: P.paper, rockCrack: '#7F5447' }, 160, 124, 0.62).replace(/stroke="#F7F4EF" stroke-width="6"/, 'stroke="#7F5447" stroke-width="3"').replace(/<polygon points="[^"]*" fill="#F7F4EF" stroke="#F7F4EF" stroke-width="3"\/>/, '');
  s += `<ellipse cx="160" cy="124" rx="30" ry="22" fill="none" stroke="#04183F" stroke-width="3" stroke-dasharray="0 7" stroke-linecap="round"/>`;
  s += `<path d="M192 112C202 102 210 98 220 96" fill="none" stroke="#04183F" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M92 212H150M92 234H128" stroke="#A9BAD5" stroke-width="3" stroke-linecap="round"/>`;
  // right page: incident entries with tick marks
  const rows = [86, 116, 146, 176];
  rows.forEach((yy, i) => {
    s += `<rect x="258" y="${yy - 9}" width="18" height="18" rx="5" fill="none" stroke="#04183F" stroke-width="3"/>`;
    if (i < 3) s += `<path d="M262 ${yy}L266 ${yy + 4}L273 ${yy - 5}" fill="none" stroke="#048DFC" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<path d="M288 ${yy}H${330 + ((i * 37) % 40)}" stroke="#04183F" stroke-width="3" stroke-linecap="round"/>`;
    s += `<path d="M${346 + ((i * 37) % 30) - 10} ${yy}H${386}" stroke="#A9BAD5" stroke-width="3" stroke-linecap="round"/>`;
  });
  // tally marks
  s += `<path d="M262 212V236M272 212V236M282 212V236M292 212V236M256 232L300 214" stroke="#04183F" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M318 212V236M328 212V236" stroke="#04183F" stroke-width="3" stroke-linecap="round"/>`;
  // bookmark ribbon + elastic band
  s += `<path d="M196 262V300L205 292L214 300V260" fill="#048DFC"/>`;
  s += `<rect x="392" y="44" width="10" height="236" fill="${P.fg === '#04183F' ? '#04183F' : '#04183F'}"/>`;
  // pencil
  s += `<g transform="translate(372 262) rotate(-38)">`;
  s += `<rect x="-6" y="-9" width="88" height="18" rx="4" fill="#04BDFD"/>`;
  s += `<rect x="70" y="-9" width="14" height="18" rx="4" fill="#A9BAD5"/>`;
  s += `<path d="M-6 -9L-26 0L-6 9Z" fill="#EBE6DF" stroke="#EBE6DF" stroke-width="3" stroke-linejoin="round"/>`;
  s += `<path d="M-19 -3.2L-27 0L-19 3.2Z" fill="#04183F" stroke="#04183F" stroke-width="3" stroke-linejoin="round"/>`;
  s += `</g>`;
  // droplets
  s += drop(40, 60, 5, -30, P.splash) + dot(30, 82, 3.5, P.azure) + drop(446, 250, 4, 30, P.splash);
  return svg(480, 320, 'An open field notebook: the incident journal, with stream sketches and tick marks', s);
}

// ---------- 8. otter guide ----------
export function otter(P) {
  let s = '';
  const B = '#7F5447', BD = '#6A463B', C = '#EBE6DF', INK = '#04183F', W = '#A9BAD5';
  // ripple ring and back ribbon
  s += `<path d="M86 246C70 250 58 256 52 262M394 244C410 248 424 254 430 260" fill="none" stroke="${P.ripple}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="${ribbon({ x0: 36, x1: 200, y: 226, amp: 6, wl: 200, ph: 1, th: 12, p: 0.6, skew: 0.8 })}" fill="${P.splash}"/>`;
  s += `<path d="${ribbon({ x0: 300, x1: 446, y: 222, amp: 6, wl: 200, ph: 1, th: 10, p: 0.6, skew: 1.3 })}" fill="${P.azure}"/>`;
  // body
  s += `<path d="M180 176C170 204 166 232 168 266H312C314 232 310 204 300 176Z" fill="${B}"/>`;
  s += `<ellipse cx="240" cy="238" rx="38" ry="38" fill="${C}"/>`;
  // ears
  s += dot(178, 94, 15, B) + dot(302, 94, 15, B) + dot(179, 95, 7, BD) + dot(301, 95, 7, BD);
  // head
  s += `<path d="M160 148C160 102 196 74 240 74C284 74 320 102 320 148C320 186 286 208 240 208C194 208 160 186 160 148Z" fill="${B}"/>`;
  // muzzle (two lobes + chin)
  s += `<path d="M240 140C228 132 210 132 198 140C182 150 180 178 196 192C210 204 226 206 240 206C254 206 270 204 284 192C300 178 298 150 282 140C270 132 252 132 240 140Z" fill="${C}"/>`;
  // eyes
  s += dot(206, 124, 9, INK) + dot(274, 124, 9, INK) + dot(209.5, 120.5, 3, '#FFFFFF') + dot(277.5, 120.5, 3, '#FFFFFF');
  // nose + mouth
  s += `<path d="M224 150C224 143 256 143 256 150C256 160 247 166 240 166C233 166 224 160 224 150Z" fill="${INK}"/>`;
  s += `<path d="M240 166V173M226 176C231 184 238 182 240 173C242 182 249 184 254 176" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  // whisker pores
  s += dot(212, 166, 2.2, BD) + dot(206, 176, 2.2, BD) + dot(216, 180, 2.2, BD) + dot(268, 166, 2.2, BD) + dot(274, 176, 2.2, BD) + dot(264, 180, 2.2, BD);
  // whiskers
  s += `<path d="M190 164C172 158 160 156 146 156M190 174C172 172 160 174 146 178M192 184C176 186 166 192 154 200M290 164C308 158 320 156 334 156M290 174C308 172 320 174 334 178M288 184C304 186 314 192 326 200" fill="none" stroke="${W}" stroke-width="3" stroke-linecap="round"/>`;
  // front water ribbons
  s += `<path d="${ribbon({ x0: 70, x1: 420, y: 262, amp: 7, wl: 240, ph: 2.4, th: 24, p: 0.5, skew: 1.1 })}" fill="${P.azure}"/>`;
  s += `<path d="${ribbon({ x0: 120, x1: 448, y: 290, amp: 6, wl: 240, ph: 2.4, th: 16, p: 0.6, skew: 1.3 })}" fill="${P.splash}"/>`;
  // paws resting on the wave
  s += `<ellipse cx="198" cy="252" rx="22" ry="13" fill="${B}"/><ellipse cx="282" cy="252" rx="22" ry="13" fill="${B}"/>`;
  s += `<path d="M192 254V259M200 254V259M276 254V259M284 254V259" stroke="${BD}" stroke-width="3" stroke-linecap="round"/>`;
  // droplets
  s += drop(124, 186, 6, -35, P.splash) + dot(108, 206, 4, P.azure) + drop(360, 176, 5, 35, P.splash) + dot(378, 196, 3.5, P.azure) + dot(140, 160, 3, P.splash);
  return svg(480, 320, 'A friendly otter peeking up from the stream', s);
}

export const SPOTS = {
  'live-vs-stale': liveVsStale,
  'snapshot-then-updates': snapshotThenUpdates,
  'state-channels': stateChannels,
  hold,
  quarantine,
  redrive,
  'incident-journal': journal,
  'otter-guide': otter,
};
