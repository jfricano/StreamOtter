// node docs/assets/source/press/stickers.mjs
// Builds press/sticker-*.svg from the real brandmark files (paths copied verbatim).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const A = fileURLToPath(new URL("../../", import.meta.url));
const OUT = A + "press/";
const inner = (f) => { const s = readFileSync(A + f, "utf8"); return s.slice(s.indexOf(">", s.indexOf("<svg")) + 1, s.lastIndexOf("</svg>")).replace(/<title>[^<]*<\/title>/, ""); };
const ds = (f) => [...readFileSync(A + f, "utf8").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);

// 1. Die-cut mark: light mark on a uniform white contour, with a light-ink edge so it reads on white pages.
{
  const mark = inner("streamotter-mark.svg");
  const shape = ds("streamotter-mark.svg").map((d) => `<path d="${d}"/>`).join("");
  const B = Number(process.env.BLEED ?? 38); // contour width, in mark units (mark art is 426 x 303)
  const pad = B + 6;
  // Very thick strokes on the small droplets render with gaps in some engines; circles of the same reach plug them.
  const drops = [[500.8, 183.1, 56.9, 56.7], [482.1, 245.4, 31.7, 32.2], [851.8, 335.8, 28.1, 29.5]];
  const plug = (c, r) => drops.map(([x, y, w, h]) => `<circle cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" r="${(Math.max(w, h) / 2 + r).toFixed(1)}" fill="${c}"/>`).join("");
  const vb = [467.46 - pad, 98.78 - pad, 893.58 - 467.46 + 2 * pad, 401.72 - 98.78 + 2 * pad].map((v) => +v.toFixed(2));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb.join(" ")}" width="${Math.round(vb[2])}" height="${Math.round(vb[3])}" role="img"><title>StreamOtter sticker (die-cut mark)</title><defs><g id="shape">${shape}</g></defs><use xlink:href="#shape" fill="#E9F2FC" stroke="#E9F2FC" stroke-width="${2 * B + 6}" stroke-linejoin="round"/>${plug("#E9F2FC", B + 3)}<use xlink:href="#shape" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="${2 * B}" stroke-linejoin="round"/>${plug("#FFFFFF", B)}${mark}</svg>`;
  writeFileSync(OUT + "sticker-mark.svg", svg);
}

// 2. Circle badge: the stacked dark lockup on ink, wave ribbons and droplets along the rim.
{
  const lock = inner("streamotter-lockup-stacked-dark.svg");
  const C = 500, k = 0.86, CY = 470;
  const art = [367.07, 98.78, 993.53, 536.25];
  const cx = (art[0] + art[2]) / 2, cy = (art[1] + art[3]) / 2;
  // clear box (O = 84.1 lockup units) must stay inside the ink disc and clear of ribbons
  const hw = (art[2] - art[0] + 2 * 84.1) * k / 2, hh = (art[3] - art[1] + 2 * 84.1) * k / 2;

  const P = (r, t) => [(C + r * Math.cos(t)).toFixed(1), (C + r * Math.sin(t)).toFixed(1)].join(" ");
  // tapered ribbon along an arc: centre radius r0 + amp*sin(n t + ph), thickness th * sin(pi u)
  const ribbon = (a0, a1, r0, amp, n, ph, th) => {
    const N = 90, rad = (d) => (d * Math.PI) / 180, outer = [], innerE = [];
    for (let i = 0; i <= N; i++) { const u = i / N, t = rad(a0 + (a1 - a0) * u); const r = r0 + amp * Math.sin(n * t + ph); const w = th * Math.pow(Math.sin(Math.PI * u), 0.8) / 2; outer.push(P(r + w, t)); innerE.push(P(r - w, t)); }
    return "M" + outer.join("L") + "L" + innerE.reverse().join("L") + "Z";
  };
  const drop = (deg, r, s, c) => `<circle cx="${(C + r * Math.cos((deg * Math.PI) / 180)).toFixed(1)}" cy="${(C + r * Math.sin((deg * Math.PI) / 180)).toFixed(1)}" r="${s}" fill="${c}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" role="img"><title>StreamOtter sticker (badge)</title><defs><linearGradient id="rib" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#048DFC"/><stop offset="1" stop-color="#04BDFD"/></linearGradient></defs>` +
    `<circle cx="500" cy="500" r="496" fill="#FFFFFF" stroke="#E9F2FC" stroke-width="6"/>` +
    `<circle cx="500" cy="500" r="472" fill="#04183F"/>` +
    `<circle cx="500" cy="500" r="452" fill="none" stroke="#048DFC" stroke-opacity="0.35" stroke-width="3"/>` +
    `<path d="${ribbon(150, 40, 406, 0, 0, 0, 50)}" fill="url(#rib)"/>` +
    `<path d="${ribbon(122, 26, 442, 0, 0, 0, 20)}" fill="#04BDFD"/>` +
    `<path d="${ribbon(118, 66, 366, 0, 0, 0, 11)}" fill="#048DFC"/>` +
    `<path d="${ribbon(236, 304, 434, 0, 0, 0, 13)}" fill="#04BDFD"/>` +
    drop(157, 404, 14, "#048DFC") + drop(165, 420, 8, "#048DFC") + drop(20, 436, 10, "#04BDFD") + drop(14, 446, 6, "#04BDFD") + drop(229, 432, 8, "#04BDFD") + drop(311, 432, 6, "#04BDFD") +
    `<g transform="translate(${(C - k * cx).toFixed(2)} ${(CY - k * cy).toFixed(2)}) scale(${k})">${lock}</g></svg>`;
  writeFileSync(OUT + "sticker-badge.svg", svg);
}

// 3. Live pill: a "live" view-state sticker. Letters are drawn as monoline paths (no font).
{
  const sw = 22;
  const letters = `<path d="M30 62H60V170Q60 200 90 200H104"/><path d="M148 104H180V200M144 200H216"/><path d="M252 104L300 200L348 104"/><path d="M380 151H462A42 49 0 1 0 452 184"/>`;
  const dot = `<circle cx="-96" cy="148" r="58" fill="none" stroke="#01E1FC" stroke-opacity="0.35" stroke-width="10"/><circle cx="-96" cy="148" r="34" fill="#01E1FC"/>`;
  const x0 = -230, x1 = 560, y0 = 18, y1 = 278, h = y1 - y0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - 30} ${y0 - 30} ${x1 - x0 + 60} ${h + 60}" width="${x1 - x0 + 60}" height="${h + 60}" role="img"><title>live</title>` +
    `<rect x="${x0 - 26}" y="${y0 - 26}" width="${x1 - x0 + 52}" height="${h + 52}" rx="${(h + 52) / 2}" fill="#FFFFFF" stroke="#E9F2FC" stroke-width="4"/>` +
    `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${h}" rx="${h / 2}" fill="#04183F"/>` +
    `<rect x="${x0 + 14}" y="${y0 + 14}" width="${x1 - x0 - 28}" height="${h - 28}" rx="${(h - 28) / 2}" fill="none" stroke="#048DFC" stroke-opacity="0.5" stroke-width="3"/>` +
    dot + `<circle cx="180" cy="62" r="16" fill="#E9F2FC"/><g fill="none" stroke="#E9F2FC" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${letters}</g></svg>`;
  writeFileSync(OUT + "sticker-live.svg", svg);
}
console.log("ok");
