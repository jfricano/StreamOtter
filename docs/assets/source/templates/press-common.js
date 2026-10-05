// Places a real brandmark file at an exact rendered size, optionally drawing its clear space.
// Units below are each file's own viewBox units, measured from the files (path bounding boxes).
const ASSETS = "../../";
const SPEC = {
  horizontal: { file: "streamotter-lockup-horizontal", vb: [462.65, 88.27, 1765.09, 317.86], art: [467.46, 98.78, 2222.81, 401.72], clear: 167.9, rule: "O", min: "120 px wide" },
  stacked:    { file: "streamotter-lockup-stacked",    vb: [360.20, 86.27, 639.84, 459.97], art: [367.07, 98.78, 993.53, 536.25], clear: 84.1, rule: "O", min: "96 px wide" },
  readme:     { file: "streamotter-readme-lockup",     vb: [0, 0, 635.8, 456], art: [4.84, 10.51, 631.37, 448.0], clear: 84.2, rule: "O", min: "240 px wide" },
  mark:       { file: "streamotter-mark",              vb: [462.65, 88.27, 434.93, 317.86], art: [467.46, 98.78, 893.58, 401.72], clear: 75.7, rule: "¼h", min: "24 px tall" },
  wordmark:   { file: "streamotter-wordmark",          vb: [233.08, 396.57, 878.61, 131.64], art: [236.29, 402.55, 1109.04, 520.66], clear: 117.2, rule: "O", min: "80 px wide" },
};
// opts: { w } viewBox width in px, or { h } viewBox height in px; clear: true to draw clear space; dark: true for -dark file
function logo(key, opts) {
  const s0 = SPEC[key];
  const s = opts.w ? opts.w / s0.vb[2] : opts.h / s0.vb[3];
  const c = opts.clear ? s0.clear * s : 0;
  const aw = (s0.art[2] - s0.art[0]) * s, ah = (s0.art[3] - s0.art[1]) * s;
  const box = document.createElement("div");
  box.className = "logo-box" + (opts.clear ? " cs" : "");
  Object.assign(box.style, { position: "relative", width: aw + 2 * c + "px", height: ah + 2 * c + "px", flex: "none" });
  const img = document.createElement("img");
  img.src = ASSETS + s0.file + (opts.dark ? "-dark" : "") + ".svg";
  Object.assign(img.style, { position: "absolute", left: c - (s0.art[0] - s0.vb[0]) * s + "px", top: c - (s0.art[1] - s0.vb[1]) * s + "px", width: s0.vb[2] * s + "px", height: s0.vb[3] * s + "px", maxWidth: "none" });
  if (opts.clear) {
    box.innerHTML = `<div class="cs-zone"></div><div class="cs-art" style="left:${c}px;top:${c}px;width:${aw}px;height:${ah}px"></div>
      <div class="cs-dim v" style="left:${c + aw * 0.5 - 0.5}px;top:0;height:${c}px"><span>${s0.rule}</span></div>
      <div class="cs-dim h" style="top:${c + ah * 0.5 - 0.5}px;left:0;width:${c}px"><span>${s0.rule}</span></div>`;
  }
  box.appendChild(img);
  box.dataset.px = JSON.stringify({ w: +(s0.vb[2] * s).toFixed(1), h: +(s0.vb[3] * s).toFixed(1), clear: +c.toFixed(1) });
  return box;
}
function mount(sel, key, opts) { document.querySelector(sel).appendChild(logo(key, opts)); }
