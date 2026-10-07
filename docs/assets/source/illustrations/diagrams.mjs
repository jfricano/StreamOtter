import { ribbon, codeStream, drop, dot, rock, digit, step, svg, sineY, smooth, pt, r1, dashRow, dashPaths } from './lib.mjs';
import { pill, pool, copyBadge } from './spots.mjs';

// ---------- shared small pictograms ----------
function gate(P, gx, fy, open = false) {
  // posts at gx-12..gx and gx+32..gx+44; beam on top; panel lowered or raised
  const bottom = fy + 40, beam = fy - 70;
  let s = '';
  const py = open ? beam + 14 : fy - 40;
  const ph = open ? 40 : bottom - 6 - (fy - 40);
  s += `<rect x="${gx - 4}" y="${r1(py)}" width="40" height="${r1(ph)}" rx="6" fill="${P.muted}"/>`;
  s += `<rect x="${gx - 12}" y="${r1(beam)}" width="12" height="${r1(bottom - beam)}" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx + 32}" y="${r1(beam)}" width="12" height="${r1(bottom - beam)}" rx="6" fill="${P.fg}"/>`;
  s += `<rect x="${gx - 20}" y="${r1(beam)}" width="72" height="14" rx="7" fill="${P.fg}"/>`;
  if (!open) {
    s += `<circle cx="${gx + 16}" cy="${r1(beam - 18)}" r="16" fill="${P.staleFill}" opacity="0.3"/>` + dot(gx + 16, beam - 18, 10, P.staleFill) + dot(gx + 16, beam - 18, 4, P.onStale);
    s += `<path d="M${gx + 16} ${r1(beam - 8)}V${r1(beam)}" stroke="${P.fg}" stroke-width="3"/>`;
  }
  return s;
}
function viewCard(P, x, y, w, live) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="72" rx="14" fill="${P.window}"/>`;
  s += pill(P, x + 14, y + 14, live);
  s += `<path d="M${x + 104} ${y + 26}H${x + w - 20}" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  s += `<path d="M${x + 16} ${y + 54}H${x + w * 0.55}" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  return s;
}
function burst(P, cx, cy) {
  let s = '';
  for (const a of [-150, -115, -65, -30]) {
    const rad = (a * Math.PI) / 180;
    s += `M${pt([cx + 34 * Math.cos(rad), cy + 34 * Math.sin(rad)])}L${pt([cx + 50 * Math.cos(rad), cy + 50 * Math.sin(rad)])}`;
  }
  return `<path d="${s}" stroke="${P.fg}" stroke-width="6" stroke-linecap="round"/>`;
}
function notebook(P, x, y, w = 150, h = 92) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${P.brown}"/>`;
  const m = 7, half = w / 2;
  s += `<rect x="${x + m}" y="${y + m}" width="${half - m - 2}" height="${h - 2 * m}" rx="6" fill="${P.paper}"/>`;
  s += `<rect x="${x + half + 2}" y="${y + m}" width="${half - m - 2}" height="${h - 2 * m}" rx="6" fill="${P.paper}"/>`;
  let l = '';
  for (let k = 0; k < 3; k++) l += `M${x + 16} ${y + 26 + k * 18}H${x + half - 14 - (k % 2) * 14}`;
  s += `<path d="${l}" stroke="#A9BAD5" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M${x + half + 14} ${y + 26}H${x + w - 18}M${x + half + 14} ${y + 44}H${x + w - 30}" stroke="#04183F" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M${x + half + 14} ${y + 62}H${x + w - 22}" stroke="#048DFC" stroke-width="3" stroke-linecap="round"/>`;
  return s;
}
function wrench(P, cx, cy) {
  return `<g transform="translate(${cx} ${cy}) rotate(45)"><rect x="-6" y="0" width="12" height="44" rx="6" fill="${P.fg}"/>` +
    `<circle cx="0" cy="-6" r="16" fill="${P.fg}"/><rect x="-6" y="-26" width="12" height="18" rx="3" fill="${P.panel}"/></g>`;
}
function arcArrow(cx, cy, r, d0, d1, color, sw, head) {
  // clockwise arc from d0 to d1 (degrees), filled arrowhead at the end
  const A = (d) => (d * Math.PI) / 180;
  const p0 = [cx + r * Math.cos(A(d0)), cy + r * Math.sin(A(d0))], p1 = [cx + r * Math.cos(A(d1)), cy + r * Math.sin(A(d1))];
  const large = d1 - d0 > 180 ? 1 : 0;
  const t = [-Math.sin(A(d1)), Math.cos(A(d1))], n = [Math.cos(A(d1)), Math.sin(A(d1))];
  const tip = [p1[0] + t[0] * head, p1[1] + t[1] * head];
  const b1 = [p1[0] + n[0] * head * 0.85, p1[1] + n[1] * head * 0.85], b2 = [p1[0] - n[0] * head * 0.85, p1[1] - n[1] * head * 0.85];
  return `<path d="M${pt(p0)}A${r} ${r} 0 ${large} 1 ${pt(p1)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>` +
    `<path d="M${pt(tip)}L${pt(b1)}L${pt(b2)}Z" fill="${color}" stroke="${color}" stroke-width="${Math.min(3, sw)}" stroke-linejoin="round"/>`;
}
function retryLoop(P, cx, cy, r = 24) {
  return arcArrow(cx, cy, r, -40, 230, P.azure, 6, 11);
}
function shield(P, cx, cy) {
  const on = P.mode === 'light' ? '#FFFFFF' : '#04183F';
  return `<path transform="translate(${cx} ${cy})" d="M0 -24L19 -17V-1C19 13 10 21 0 26C-10 21 -19 13 -19 -1V-17Z" fill="${P.azure}" stroke="${P.azure}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M${cx - 8} ${cy}L${cx - 2} ${cy + 6}L${cx + 9} ${cy - 7}" fill="none" stroke="${on}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function chevron(P, x, y) {
  return `<path d="M${x - 5} ${y - 10}L${x + 5} ${y}L${x - 5} ${y + 10}" fill="none" stroke="${P.muted}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function loopGlyphMarker(P, cx, cy, r = 22) {
  const on = P.mode === 'light' ? '#FFFFFF' : '#04183F';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.azure}"/>` + arcArrow(cx, cy, 9, -40, 220, on, 4, 6);
}

// ---------- (a) bad-record flow ----------
export function badRecordFlow(P) {
  const W = 1600, H = 600, Y = 286, amp = 6, wl = 304, ph = 0.4;
  const f = sineY(Y, amp, wl, ph);
  const PX = [52, 356, 660, 964, 1268], PW = 280, PT = 48, PH = 400;
  const CY = PT + 30; // card row top
  let s = '';
  // panels
  PX.forEach((x) => { s += `<rect x="${x}" y="${PT}" width="${PW}" height="${PH}" rx="16" fill="${P.panel}"/>`; });
  // redrive lane: from the quarantine pool (P3), under P4, round the far side of P5
  // and into the view card (delivery side), never back upstream of the gate.
  const lx3 = PX[2] + 250, LY = 532, RX = PX[4] + PW + 26, VY = CY + 36;
  s += `<path d="M${lx3} 404V${LY - 40}C${lx3} ${LY - 10} ${lx3 + 14} ${LY} ${lx3 + 50} ${LY}H${RX - 40}C${RX - 10} ${LY} ${RX} ${LY - 10} ${RX} ${LY - 40}V${VY + 40}C${RX} ${VY + 10} ${RX - 6} ${VY} ${RX - 26} ${VY}" fill="none" stroke="${P.azure}" stroke-width="6" stroke-linecap="round" stroke-dasharray="0 14"/>`;
  s += `<path d="M${RX - 22} ${VY - 13}L${RX - 36} ${VY}L${RX - 22} ${VY + 13}" fill="none" stroke="${P.azure}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  // one continuous stream through all panels
  s += codeStream(P, { x0: 24, x1: PX[4] + PW - 4, y: Y, amp, wl, ph, H: 52, seed: 1, rows: [], topIn: 30, botIn: 70, topOut: 30, botOut: 16 });
  const dashes = (a, b, seed, opts) => [-12, 12].map((dy, i) => dashPaths(dashRow(a + i * 8, b, seed + i, opts), f, dy, (d) => (d.len === 0 ? P.hi : d.k < 0.55 ? P.splash : d.k < 0.8 ? P.hi : P.azure))).join('');
  const dense = { lens: [0, 14, 22], gap: 8 };
  // P1: the record fails (the view was live until now)
  let x = PX[0];
  s += dashes(x + 16, x + 128, 11) + dashes(x + 208, x + PW - 10, 13);
  s += rock(P, x + 168, f(x + 168), 1.0) + burst(P, x + 168, f(x + 168) - 4);
  s += viewCard(P, x + 24, CY, 232, true);
  // P2: the source holds; the view is visibly stale
  x = PX[1];
  s += dashes(x + 10, x + 116, 21, dense);
  s += rock(P, x + 146, f(x + 146) + 2, 1.0) + gate(P, x + 190, f(x + 190));
  s += viewCard(P, x + 24, CY, 232, false);
  // P3: original copied to the quarantine pool + incident journaled
  x = PX[2];
  s += dashes(x + 10, x + 116, 31, dense);
  s += `<ellipse cx="${x + 190}" cy="404" rx="78" ry="30" fill="${P.window}"/>`;
  s += `<path d="${ribbon({ x0: x + 118, x1: x + 236, y: 366, amp: 3, wl: 200, th: 6, p: 0.6 })}" fill="${P.azure}"/>`;
  s += `<ellipse cx="${x + 190}" cy="404" rx="50" ry="18" fill="none" stroke="${P.ripple}" stroke-width="3"/>`;
  s += rock(P, x + 184, 402, 0.8);
  s += `<path d="M${x + 132} ${r1(f(x + 132) + 30)}C${x + 126} 356 ${x + 134} 392 ${x + 148} 400" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 9"/>`;
  s += copyBadge(P, x + 128, 352);
  s += rock(P, x + 146, f(x + 146) + 2, 1.0) + gate(P, x + 190, f(x + 190));
  s += notebook(P, x + 40, CY - 4, 200, 84);
  // P4: cause fixed, then the operator retries (or the recovery guard approves a resync past it)
  x = PX[3];
  s += dashes(x + 10, x + 116, 41, dense);
  s += rock(P, x + 146, f(x + 146) + 2, 1.0) + gate(P, x + 190, f(x + 190));
  s += wrench(P, x + 50, CY + 30) + chevron(P, x + 100, CY + 36) + retryLoop(P, x + 146, CY + 36, 24);
  s += `<path d="M${x + 196} ${CY + 10}V${CY + 62}" stroke="${P.edge}" stroke-width="3" stroke-linecap="round"/>`;
  s += shield(P, x + 234, CY + 36);
  // P5: the source moves on; the view is live again
  x = PX[4];
  s += dashes(x + 12, x + PW - 40, 51);
  s += gate(P, x + 60, f(x + 60), true);
  s += viewCard(P, x + 24, CY, 232, true).replace(/<rect x="[^"]*" y="[^"]*" width="232"/, (m) => m);
  // connectors between panels
  for (let i = 0; i < 4; i++) s += chevron(P, PX[i] + PW + 12, PT + PH - 60);
  // step markers
  PX.forEach((x, i) => { s += step(P, i + 1, x + 4, PT + 4, 22); });
  s += loopGlyphMarker(P, PX[3] + 70, LY, 22);
  // mapping node on the lane: the stored copy is re-run through the current mapping
  { const nx = PX[4] + 30, ny = LY - 26, inner = P.mode === 'light' ? '#FFFFFF' : '#04183F';
    s += `<rect x="${nx}" y="${ny}" width="52" height="52" rx="12" fill="${P.fg}"/>`;
    s += `<path d="M${nx + 10} ${ny + 18}H${nx + 18}M${nx + 10} ${ny + 26}H${nx + 15}M${nx + 10} ${ny + 34}H${nx + 20}" stroke="${P.splash}" stroke-width="3" stroke-linecap="round"/>`;
    s += `<path d="M${nx + 24} ${ny + 20}L${nx + 30} ${ny + 26}L${nx + 24} ${ny + 32}" fill="none" stroke="${inner}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    s += `<rect x="${nx + 34}" y="${ny + 17}" width="10" height="18" rx="3" fill="${P.azure}"/>`;
    // revision check before delivery: newer state wins
    const kx = PX[4] + 170;
    s += `<circle cx="${kx}" cy="${LY}" r="17" fill="${P.liveFill}"/>`;
    s += `<path d="M${kx - 8} ${LY}L${kx - 2} ${LY + 6}L${kx + 9} ${LY - 6}" fill="none" stroke="${P.onLive}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`; }
  s += drop(26, 360, 5, -30, P.splash) + dot(40, 384, 3.5, P.azure);
  return svg(W, H, 'How a bad record is handled: it fails, the source holds and the view goes stale, the record is quarantined and journaled, the operator fixes and retries, and the view is live again; redrive is a separate path from the quarantine pool back into the ordered stream', s);
}

// ---------- (b) core model ----------
export function coreModel(P) {
  const W = 1600, H = 600;
  let s = '';
  const Y = 360;
  // raw Kafka stream on the left (mixed dashes)
  s += codeStream(P, { x0: 30, x1: 520, y: Y, amp: 8, wl: 260, ph: 0.8, H: 70, seed: 7, xa: 80, xb: 470, botOut: 40, topOut: 70 });
  // state channel stream out of the gateway
  const Y2 = 360, f2 = sineY(Y2, 7, 300, 2.0);
  s += codeStream(P, { x0: 560, x1: 1268, y: Y2, amp: 7, wl: 300, ph: 2.0, H: 44, seed: 9, rows: [0], topIn: 50, botIn: 90, botOut: 20, topOut: 40,
    xa: 900, xb: 1220, dashOpts: { lens: [26, 40], gap: 30 }, dashColor: () => P.splash });
  // mapping node (gateway): rounded square
  const nx = 520, ny = Y - 70;
  s += `<rect x="${nx}" y="${ny}" width="140" height="140" rx="22" fill="${P.fg}"/>`;
  const inner = P.mode === 'light' ? '#FFFFFF' : '#04183F';
  // icon: mixed dashes in -> one neat block out
  s += `<path d="M${nx + 26} ${ny + 46}H${nx + 46}M${nx + 30} ${ny + 70}H${nx + 40}M${nx + 24} ${ny + 94}H${nx + 50}" stroke="${P.splash}" stroke-width="6" stroke-linecap="round"/>`;
  s += `<path d="M${nx + 62} ${ny + 56}L${nx + 76} ${ny + 70}L${nx + 62} ${ny + 84}" fill="none" stroke="${inner}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<rect x="${nx + 90}" y="${ny + 50}" width="28" height="40" rx="6" fill="${P.azure}"/>`;
  // definition cards above the node
  const cy = 64;
  // state shape card: { key: value } lines
  s += `<rect x="360" y="${cy}" width="200" height="132" rx="14" fill="${P.panel}"/>`;
  s += `<path d="M392 ${cy + 26}C382 ${cy + 26} 380 ${cy + 32} 380 ${cy + 42}V${cy + 56}C380 ${cy + 62} 376 ${cy + 66} 372 ${cy + 66}C376 ${cy + 66} 380 ${cy + 70} 380 ${cy + 76}V${cy + 90}C380 ${cy + 100} 382 ${cy + 106} 392 ${cy + 106}" fill="none" stroke="${P.fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<path d="M528 ${cy + 26}C538 ${cy + 26} 540 ${cy + 32} 540 ${cy + 42}V${cy + 56}C540 ${cy + 62} 544 ${cy + 66} 548 ${cy + 66}C544 ${cy + 66} 540 ${cy + 70} 540 ${cy + 76}V${cy + 90}C540 ${cy + 100} 538 ${cy + 106} 528 ${cy + 106}" fill="none" stroke="${P.fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  [[cy + 44, 34, 56], [cy + 66, 46, 40], [cy + 88, 28, 64]].forEach(([yy, k, v]) => {
    s += `<path d="M406 ${yy}H${406 + k}" stroke="${P.azure}" stroke-width="6" stroke-linecap="round"/><path d="M${424 + k} ${yy}H${424 + k + v}" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  });
  // mapping function card: record -> state
  s += `<rect x="620" y="${cy}" width="200" height="132" rx="14" fill="${P.panel}"/>`;
  s += `<path d="M648 ${cy + 50}H676M648 ${cy + 66}H664M648 ${cy + 82}H684" stroke="${P.splash}" stroke-width="6" stroke-linecap="round"/>`;
  s += `<path d="M700 ${cy + 66}H738M728 ${cy + 56}L740 ${cy + 66}L728 ${cy + 76}" fill="none" stroke="${P.fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<rect x="756" y="${cy + 44}" width="40" height="44" rx="8" fill="${P.azure}"/>`;
  s += `<path d="M766 ${cy + 58}H786M766 ${cy + 74}H780" stroke="${P.mode === 'light' ? '#FFFFFF' : '#04183F'}" stroke-width="3" stroke-linecap="round"/>`;
  // connectors from cards into node
  s += `<path d="M460 ${cy + 132}C460 240 540 236 560 ${ny}M720 ${cy + 132}C720 240 640 236 620 ${ny}" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 9"/>`;
  // snapshot card at the head of the state channel
  s += `<g transform="translate(24 0) rotate(-5 760 330)">`;
  s += `<rect x="700" y="246" width="120" height="140" rx="10" fill="${P.mode === 'light' ? '#FFFFFF' : P.panel}" stroke="${P.edge}" stroke-width="3"/>`;
  s += `<rect x="710" y="256" width="100" height="90" rx="6" fill="${P.mode === 'light' ? P.panel : P.window}"/>`;
  s += `<rect x="740" y="276" width="40" height="50" rx="8" fill="${P.azure}"/>`;
  s += `<path d="M750 292H770M750 308H764" stroke="${P.mode === 'light' ? '#FFFFFF' : '#04183F'}" stroke-width="3" stroke-linecap="round"/>`;
  s += `<path d="M716 366H760M772 366H790" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
  s += `</g>`;
  // revision chips
  [[930, 1], [1030, 2], [1130, 3]].forEach(([x, n]) => {
    const top = f2(x) - 22 - 2;
    s += `<path d="M${x} ${r1(top)}V${266}" stroke="${P.muted}" stroke-width="3" stroke-linecap="round"/>` + dot(x, top, 5.5, P.azure);
    s += `<rect x="${x - 21}" y="226" width="42" height="42" rx="9" fill="${P.azure}"/>` + digit(n, x, 247, 20, P.mode === 'light' ? '#FFFFFF' : '#04183F', 3);
  });
  s += chevron(P, 1190, 247);
  // two views: live | stale
  const vx = 1300;
  const views = [[200, true], [380, false]];
  // channel splits to the two views
  s += `<path d="M1250 ${r1(f2(1250))}C1276 ${r1(f2(1250))} 1270 236 1300 236M1250 ${r1(f2(1250))}C1276 ${r1(f2(1250))} 1270 416 1300 416" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 9"/>`;
  for (const [vy, live] of views) {
    s += `<rect x="${vx}" y="${vy - 72}" width="240" height="144" rx="16" fill="${P.panel}"/>`;
    s += pill(P, vx + 16, vy - 56, live);
    s += `<path d="M${vx + 106} ${vy - 44}H${vx + 150}" stroke="${P.label}" stroke-width="6" stroke-linecap="round"/>`;
    s += `<rect x="${vx + 16}" y="${vy - 16}" width="208" height="72" rx="10" fill="${P.window}"/>`;
    const sx0 = vx + 32, sx1 = vx + 208, sy = vy + 22;
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push([sx0 + ((sx1 - sx0) * k) / 12, sy + 10 * Math.sin(k * 1.1) - k * 0.8]);
    if (live) {
      s += `<path d="${smooth(pts)}" fill="none" stroke="${P.azure}" stroke-width="3" stroke-linecap="round"/>`;
      s += `<circle cx="${r1(pts[12][0])}" cy="${r1(pts[12][1])}" r="10" fill="${P.liveFill}" opacity="0.35"/>` + dot(pts[12][0], pts[12][1], 5.5, P.live);
    } else {
      const cut = pts.slice(0, 7);
      s += `<path d="${smooth(cut)}" fill="none" stroke="${P.muted}" stroke-width="3" stroke-linecap="round"/>`;
      s += `<path d="M${pt(cut[6])}H${sx1}" stroke="${P.muted}" stroke-width="3" stroke-linecap="round" stroke-dasharray="0 8"/>`;
      s += dot(cut[6][0], cut[6][1], 5.5, P.stale);
      s += `<circle cx="${vx + 196}" cy="${vy - 44}" r="14" fill="${P.staleFill}"/><path d="M${vx + 192} ${vy - 50}V${vy - 38}M${vx + 200} ${vy - 50}V${vy - 38}" stroke="${P.onStale}" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  // step markers
  s += step(P, 1, 360, 64, 22) + step(P, 2, 722, 238, 22) + step(P, 3, 1300, 128, 22);
  s += drop(1570, 300, 6, 30, P.splash) + dot(1556, 276, 4, P.azure) + drop(70, 250, 6, -30, P.splash) + dot(92, 232, 3.5, P.azure);
  s = `<g transform="translate(0 44)">${s}</g>`;
  return svg(W, H, 'The core model: you define the state shape and one mapping function; each view gets a snapshot, then updates in revision order; every view is live or visibly stale', s);
}

export const DIAGRAMS = { 'diagram-bad-record-flow': badRecordFlow, 'diagram-core-model': coreModel };
