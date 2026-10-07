// Shared layout for the launch article headers (article-*.html, 2000x1125 and 1200x630).
// One layout, one illustration per article. Titles live in article-titles.js.
(function () {
  const A = "../../"; // docs/assets/
  const LAYOUT = {
    big: { pad: 128, lockTop: 104, lockW: 440, textTop: 250, textBottom: 860, eb: 28, title: 100, titleW: 1010, ver: 330, verTitle: 64,
      box: { x: 1150, y: 120, w: 760, h: 740 }, creek: { top: 968, rise: 70, scale: 1.45, tickSize: 26, chipSize: 26 } },
    og: { pad: 64, lockTop: 56, lockW: 300, textTop: 140, textBottom: 490, eb: 17, title: 58, titleW: 620, ver: 190, verTitle: 38,
      box: { x: 700, y: 64, w: 456, h: 444 }, creek: { top: 560, rise: 34, scale: 0.86, tickSize: 16, chipSize: 16 } },
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const g = (box, inner) => `<g transform="translate(${box.x} ${box.y}) scale(${box.w / 720})">${inner}</g>`;
  const mono = (x, y, size, fill, text, extra = "") =>
    `<text x="${x}" y="${y}" font-family="JetBrains Mono, monospace" font-weight="600" font-size="${size}" fill="${fill}" ${extra}>${esc(text)}</text>`;

  // ---------- illustrations, drawn in a 720 x 700 box ----------

  // (2) Field notebook: a cream page with review notes in code-dash scribbles, checks,
  // a struck-out line, a circled `live?`, a stale sticker and a pencil.
  function notebook() {
    const { codeStream, chip } = SO;
    const P = "#EBE6DF", rule = "#D3CCC1", inkc = "#04183F", sub = "#41506B";
    let o = `<g transform="rotate(-4 360 360)">`;
    o += `<rect x="110" y="40" width="520" height="640" rx="18" fill="${P}"/>`;
    o += `<rect x="110" y="40" width="520" height="640" rx="18" fill="none" stroke="#D3CCC1" stroke-width="3"/>`;
    for (let i = 0; i < 9; i++) o += `<circle cx="${160 + i * 54}" cy="64" r="9" fill="#04183F"/>`;
    o += `<line x1="182" y1="90" x2="182" y2="660" stroke="#048DFC" stroke-width="3" opacity="0.7"/>`;
    for (let i = 0; i < 10; i++) o += `<line x1="130" y1="${150 + i * 52}" x2="610" y2="${150 + i * 52}" stroke="${rule}" stroke-width="2"/>`;
    o += mono(200, 134, 22, sub, "review notes", 'letter-spacing="1"');
    const rows = [
      { y: 190, mark: "check", seed: 2 }, { y: 242, mark: "check", seed: 5 }, { y: 294, mark: "strike", seed: 7 },
      { y: 346, mark: "circle", seed: 11 }, { y: 398, mark: "check", seed: 13 }, { y: 450, mark: "box", seed: 17 },
      { y: 502, mark: "check", seed: 19 }, { y: 554, mark: "box", seed: 23 },
    ];
    for (const r of rows) {
      const y = r.y - 12;
      if (r.mark === "check") o += `<path d="M138 ${y}l10 10l18 -20" fill="none" stroke="#00728a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
      else o += `<rect x="140" y="${y - 12}" width="24" height="24" rx="5" fill="none" stroke="${sub}" stroke-width="3"/>`;
      if (r.mark === "circle") {
        o += mono(204, y + 9, 26, inkc, "live?");
        o += `<ellipse cx="248" cy="${y}" rx="64" ry="26" fill="none" stroke="#0369C9" stroke-width="4" transform="rotate(-6 248 ${y})"/>`;
        o += codeStream(() => y, 336, 560, { seed: r.seed, width: 9, colors: [inkc, sub], lens: [0, 22, 36, 60], gap: [10, 16] });
        continue;
      }
      o += codeStream(() => y, 204, r.mark === "strike" ? 520 : 590 - (r.seed % 5) * 26, { seed: r.seed, width: 9, colors: [inkc, sub, inkc], lens: [0, 22, 36, 60, 90], gap: [10, 16] });
      if (r.mark === "strike") o += `<path d="M196 ${y + 2}C300 ${y - 6} 420 ${y + 8} 530 ${y - 2}" fill="none" stroke="#7f4f00" stroke-width="5" stroke-linecap="round"/>`;
    }
    o += `</g>`;
    // stale sticker, slapped on at an angle
    o += `<g transform="rotate(8 560 600)">${chip(560, 600, "stale", { size: 36, theme: "light", anchor: "middle", outline: true })}</g>`;
    // pencil
    o += `<g transform="translate(470 470) rotate(-58)">` +
      `<rect x="0" y="-15" width="230" height="30" rx="4" fill="#7F5447"/>` +
      `<rect x="0" y="-15" width="230" height="10" fill="#93665A"/>` +
      `<rect x="214" y="-15" width="34" height="30" rx="6" fill="#A9BAD5"/>` +
      `<path d="M0 -15L-44 0L0 15Z" fill="#EBE6DF"/>` +
      `<path d="M-30 -5L-44 0L-30 5Z" fill="#04183F"/></g>`;
    return o;
  }

  function build(id, size) {
    const L = LAYOUT[size], a = window.ARTICLES[id], W = innerWidth, H = innerHeight;
    const stage = document.getElementById("stage");
    let html = "";
    const isLaunch = id === "launch";
    if (!isLaunch) html += `<img class="layer logo" src="${A}streamotter-lockup-horizontal-dark.svg" alt="StreamOtter" style="left:${L.pad}px;top:${L.lockTop}px;width:${L.lockW}px">`;
    html += `<div class="layer" style="left:${L.pad}px;top:${L.textTop}px;height:${L.textBottom - L.textTop}px;width:${L.titleW}px;display:flex;flex-direction:column;justify-content:center;--eb:${L.eb}px">`;
    html += `<div class="eyebrow">${esc(a.eyebrow)}</div>`;
    if (isLaunch) {
      html += `<div class="head version" style="font-size:${L.ver}px;font-weight:900;line-height:0.9;margin-top:${L.eb * 0.6}px;letter-spacing:-0.035em">${esc(a.version)}</div>`;
      html += `<div class="head" style="font-size:${L.verTitle}px;font-weight:800;margin-top:${L.eb * 1.1}px;max-width:${L.titleW * 0.92}px">${esc(a.title)}</div>`;
    } else {
      html += `<div class="head" style="font-size:${L.title}px;margin-top:${L.eb * 1.1}px">${esc(a.title)}</div>`;
    }
    html += `</div>`;
    if (isLaunch) {
      const b = L.box, w = b.w, h = w * 791 / 1397;
      html += `<img class="layer" src="${A}streamotter-logo-dark.png" alt="StreamOtter" style="left:${b.x - b.w * 0.01}px;top:${b.y + (b.h - h) / 2 - b.h * 0.02}px;width:${w}px">`;
    }
    stage.insertAdjacentHTML("beforeend", html);

    const C = L.creek;
    const tickXs = isLaunch ? null : null;
    const c = SO.creek(W, H, { top: C.top, rise: C.rise, seed: { launch: 2, "making-it-lie": 14 }[id], scale: C.scale,
      streams: 2, dropRange: [0, L.box.x - 60], phase: { launch: 0.2, "making-it-lie": 2.9 }[id], ticksAt: tickXs });
    const illus = { "making-it-lie": () => notebook() }[id];
    SO.paint(document.getElementById("art"),
      SO.texture(W, H, { rows: 8, y0: H * 0.04, y1: C.top - H * 0.1, opacity: 0.045, width: 6 * C.scale }) +
      (illus ? g(L.box, illus()) : "") + c.svg);
  }

  window.ArticleSeries = { build };
})();
