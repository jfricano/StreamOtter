// Shared drawing code for the lineage strip (lineage-*.html).
// Each template calls Lineage.build({ layout: "h" | "v", theme: "light" | "dark" }).
// Stations are drawn as neutral buoys; only the StreamOtter station carries the mark.
(function () {
  const NS = "http://www.w3.org/2000/svg";

  // Copy for the four stations. No dates, no judgement labels.
  const STATIONS = [
    { tag: "Java bridge", name: "b/kafka-websocket", desc: "Kafka 0.8-era topics, raw, over WebSockets", chips: [], buoy: "cone" },
    { tag: "OSLabs · accelerator", name: "KafkaSocks", desc: "Kafka to WebSockets for JavaScript apps", chips: [], buoy: "can" },
    { tag: "OSLabs · KafkaJS", name: "kafka-penguin", desc: "Error strategies for KafkaJS consumers", chips: ["fail fast", "ignore", "dead-letter queue"], buoy: "sphere" },
    { tag: "State channels", name: null, desc: "Snapshots, then revision-ordered updates", chips: ["hold", "quarantine", "redrive"], mark: true },
  ];

  // Derived tints of the palette (see docs/assets/README.md#extended-tints): pale band, rings, muted text.
  const THEMES = {
    light: {
      band: "#E3F0FD", ring: "#C9DCF2", disc: "#FFFFFF", water: "#DCEEFE", waterLine: "#04BDFD",
      buoyBody: "#04183F", buoyBand: "#EBE6DF", buoyTop: "#0369C9", mast: "#04183F",
      dash: "#FFFFFF", tick: "#FFFFFF", tickText: "#0369C9", strandA: "#048DFC", strandB: "#04BDFD",
      pool: "#DCEEFE", poolText: "#0369C9", browserFill: "#FFFFFF", browserBar: "#F1F6FD", dot: "#C9DCF2",
      mark: "../../streamotter-mark.svg", wordmark: "../../streamotter-wordmark.svg",
    },
    dark: {
      band: "rgba(4,141,252,0.14)", ring: "rgba(233,242,252,0.22)", disc: "#06214F", water: "#0A3D86", waterLine: "#04BDFD",
      buoyBody: "#E9F2FC", buoyBand: "#048DFC", buoyTop: "#04BDFD", mast: "#E9F2FC",
      dash: "#E9F2FC", tick: "#E9F2FC", tickText: "#04BDFD", strandA: "#048DFC", strandB: "#04BDFD",
      pool: "#0A3D86", poolText: "#04BDFD", browserFill: "#061C45", browserBar: "#0A2A5E", dot: "rgba(233,242,252,0.3)",
      mark: "../../streamotter-mark-dark.svg", wordmark: "../../streamotter-wordmark-dark.svg",
    },
  };

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const html = (tag, cls, text, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  };

  // Path through a function. orient "h": y = f(x); "v": x = f(y).
  function curve(f, a, b, orient, offset = 0, steps = 160) {
    let d = "";
    for (let i = 0; i <= steps; i++) {
      const t = a + ((b - a) * i) / steps;
      const p = orient === "h" ? [t, f(t) + offset] : [f(t) + offset, t];
      d += (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1);
    }
    return d;
  }

  function defs(svg, orient, a, b) {
    const d = el("defs", {}, svg);
    const g = el("linearGradient", orient === "h"
      ? { id: "flow", gradientUnits: "userSpaceOnUse", x1: a, y1: 0, x2: b, y2: 0 }
      : { id: "flow", gradientUnits: "userSpaceOnUse", x1: 0, y1: a, x2: 0, y2: b }, d);
    el("stop", { offset: "0", "stop-color": "#048DFC" }, g);
    el("stop", { offset: "1", "stop-color": "#04BDFD" }, g);
    const r = el("linearGradient", { id: "ring", x1: 0, y1: 0, x2: 1, y2: 1 }, d);
    el("stop", { offset: "0", "stop-color": "#048DFC" }, r);
    el("stop", { offset: "1", "stop-color": "#04BDFD" }, r);
    return d;
  }

  // The stream: pale band, flowing ribbon, thin wave strands, code-stream dashes.
  function stream(svg, f, a, b, orient, T, w = 50, dashEnd = b) {
    const g = el("g", {}, svg);
    el("path", { d: curve(f, a, b, orient), fill: "none", stroke: T.band, "stroke-width": w * 2.7, "stroke-linecap": "round" }, g);
    el("path", { d: curve(f, a, b, orient), fill: "none", stroke: "url(#flow)", "stroke-width": w, "stroke-linecap": "round" }, g);
    el("path", { d: curve(f, a + 40, b, orient, w * 0.82), fill: "none", stroke: T.strandB, "stroke-width": 6, "stroke-linecap": "round", "stroke-dasharray": "220 26 90 30 340 24 140 40" }, g);
    el("path", { d: curve(f, a + 10, b, orient, -w * 0.8), fill: "none", stroke: T.strandA, "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": "120 40 260 30 60 60 180 34", opacity: 0.85 }, g);
    // code-stream dashes, two lanes
    el("path", { d: curve(f, a, dashEnd, orient, -9), fill: "none", stroke: T.dash, "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "34 20 12 20 52 22 18 26 26 20 70 30", opacity: 0.95 }, g);
    el("path", { d: curve(f, a, dashEnd, orient, 10), fill: "none", stroke: T.dash, "stroke-width": 7, "stroke-linecap": "round", "stroke-dasharray": "14 24 44 18 22 34 60 20 10 22 30 28", "stroke-dashoffset": 40, opacity: 0.6 }, g);
    return g;
  }

  function droplets(svg, pts, T) {
    for (const [x, y, r, c] of pts) el("circle", { cx: x, cy: y, r, fill: c === 1 ? T.strandB : T.strandA }, svg);
  }

  // A neutral navigation buoy floating in a disc (no project logos).
  function buoy(g, type, r, T, clipId) {
    const clip = el("clipPath", { id: clipId }, g);
    el("circle", { r: r - 3 }, clip);
    const inner = el("g", { "clip-path": `url(#${clipId})` }, g);
    const wl = r * 0.36; // water line
    el("path", { d: `M${-r} ${wl} q ${r * 0.25} -10 ${r * 0.5} 0 t ${r * 0.5} 0 t ${r * 0.5} 0 t ${r * 0.5} 0 V ${r} H ${-r} Z`, fill: T.water }, inner);
    // body
    const s = r / 80;
    const b = el("g", { transform: `scale(${s})` }, inner);
    el("rect", { x: -3.5, y: -50, width: 7, height: 30, rx: 2, fill: T.mast }, b);
    if (type === "cone") el("path", { d: "M-17 -46 L17 -46 L0 -76 Z", fill: T.buoyTop, "stroke-linejoin": "round", stroke: T.buoyTop, "stroke-width": 4 }, b);
    if (type === "can") el("rect", { x: -14, y: -74, width: 28, height: 26, rx: 4, fill: T.buoyTop }, b);
    if (type === "sphere") el("circle", { cx: 0, cy: -60, r: 14, fill: T.buoyTop }, b);
    el("path", { d: "M-30 40 L-22 -14 Q-21 -22 -13 -22 L13 -22 Q21 -22 22 -14 L30 40 Z", fill: T.buoyBody }, b);
    el("rect", { x: -27, y: 0, width: 54, height: 12, fill: T.buoyBand }, b);
    // ripple in front
    el("path", { d: "M-80 36 q 13 -9 26 0 t 26 0 t 26 0 t 26 0 t 26 0 t 26 0 t 26 0 V 90 H -80 Z", fill: T.water }, b);
    el("path", { d: "M-46 34 q 11 -8 22 0 t 22 0 t 22 0 t 22 0", fill: "none", stroke: T.waterLine, "stroke-width": 4, "stroke-linecap": "round" }, b);
  }

  function disc(svg, cx, cy, r, st, i, T, root) {
    const g = el("g", { transform: `translate(${cx} ${cy})` }, svg);
    el("circle", { r: r + 10, fill: T.band }, g);
    el("circle", { r, fill: T.disc, stroke: st.mark ? "url(#ring)" : T.ring, "stroke-width": st.mark ? 4 : 2.5 }, g);
    if (st.mark) {
      const mw = r * 1.42, mh = mw * (317.86 / 434.93);
      const img = html("img", "mark", null, root);
      img.src = T.mark;
      img.alt = "";
      Object.assign(img.style, { left: cx - mw / 2 + "px", top: cy - mh / 2 + "px", width: mw + "px", height: mh + "px" });
    } else {
      buoy(g, st.buoy, r, T, "clip" + i);
    }
    return g;
  }

  // Revision ticks across the ribbon, numbered above/left.
  function ticks(svg, f, positions, orient, T, labelSide = -1, labelY = null) {
    positions.forEach((t, k) => {
      const c = f(t);
      if (orient === "h") {
        el("line", { x1: t, y1: c - 17, x2: t, y2: c + 17, stroke: T.tick, "stroke-width": 4, "stroke-linecap": "round" }, svg);
        const tx = el("text", { x: t, y: labelY ?? c - 50, "text-anchor": "middle", class: "rev" }, svg);
        tx.textContent = "r" + (41 + k);
      } else {
        el("line", { x1: c - 17, y1: t, x2: c + 17, y2: t, stroke: T.tick, "stroke-width": 4, "stroke-linecap": "round" }, svg);
        const tx = el("text", { x: c + labelSide * 52, y: t + 6, "text-anchor": labelSide < 0 ? "end" : "start", class: "rev" }, svg);
        tx.textContent = "r" + (41 + k);
      }
    });
  }

  // Side channel to a small pool: kafka-penguin's dead-letter queue, drawn as an eddy.
  function eddy(svg, d, px, py, T, label, rx = 46, ry = 17) {
    el("path", { d, fill: "none", stroke: "url(#flow)", "stroke-width": 12, "stroke-linecap": "round" }, svg);
    el("path", { d, fill: "none", stroke: T.dash, "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": "8 12", opacity: 0.9 }, svg);
    el("ellipse", { cx: px, cy: py, rx, ry, fill: T.pool, stroke: T.strandB, "stroke-width": 3 }, svg);
    el("circle", { cx: px - rx * 0.35, cy: py, r: 4, fill: T.strandA }, svg);
    el("circle", { cx: px + 2, cy: py + 2, r: 3, fill: T.strandB }, svg);
    el("circle", { cx: px + rx * 0.37, cy: py - 1, r: 4, fill: T.strandA }, svg);
    if (label) {
      const t = el("text", { x: px + 60, y: py + 6, class: "pool" }, svg);
      t.textContent = label;
    }
  }

  function label(root, st, x, y, w, align, T) {
    const box = html("div", "station " + align, null, root);
    Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px" });
    html("div", "tag", st.tag, box);
    if (st.name) html("div", "name", st.name, box);
    else {
      box.classList.add("has-wordmark");
      const wm = html("img", "wordmark", null, box);
      wm.src = T.wordmark;
      wm.alt = "StreamOtter";
    }
    const desc = html("div", "desc", null, box);
    // keep hyphenated words (revision-ordered, dead-letter) whole when a line wraps
    st.desc.split(/(\S+-\S+)/).forEach((part, k) => {
      if (k % 2) html("span", "nw", part, desc); else desc.append(part);
    });
    const row = html("div", "chips", null, box);
    for (const c of st.pills || []) {
      const p = html("span", "chip pill " + c, null, row);
      html("i", null, null, p);
      p.append(c);
    }
    for (const c of st.chips) html("span", "chip", c, row);
    return box;
  }

  function browser(root, svg, x, y, w, h, T) {
    const g = el("g", {}, svg);
    el("rect", { x, y, width: w, height: h, rx: 18, fill: T.browserFill, stroke: T.ring, "stroke-width": 2.5 }, g);
    el("path", { d: `M${x} ${y + 40} V ${y + 18} a18 18 0 0 1 18 -18 H ${x + w - 18} a18 18 0 0 1 18 18 V ${y + 40} Z`, fill: T.browserBar }, g);
    el("line", { x1: x, y1: y + 40, x2: x + w, y2: y + 40, stroke: T.ring, "stroke-width": 2 }, g);
    [0, 1, 2].forEach((i) => el("circle", { cx: x + 22 + i * 18, cy: y + 20, r: 5.5, fill: T.dot }, g));
    const box = html("div", "browser", null, root);
    Object.assign(box.style, { left: x + 22 + "px", top: y + 58 + "px", width: w - 44 + "px" });
    html("div", "btag", "state channel", box);
    for (const [k, v] of [["live", "live"], ["stale", "stale"]]) {
      const row = html("div", "vrow", null, box);
      html("span", "vbar " + k, null, row);
      const p = html("span", "chip pill " + k, null, row);
      html("i", null, null, p);
      p.append(v);
    }
  }

  function build({ layout, theme }) {
    const T = THEMES[theme];
    document.body.classList.add(theme, layout === "h" ? "lay-h" : "lay-v");
    const root = document.getElementById("stage");
    const W = root.clientWidth, H = root.clientHeight;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, root);

    if (layout === "h") {
      const xs = [220, 610, 1000, 1390];
      const cy = 262, r = 92;
      const amp = (x) => (x < 1400 ? 1 : Math.max(0.35, 1 - (x - 1400) / 320));
      const f = (x) => cy + 24 * Math.sin((x - 10) / 195 * Math.PI) * amp(x);
      defs(svg, "h", 0, 1760);
      eddy(svg, `M1104 ${f(1104) + 16} C 1122 ${f(1104) + 56}, 1110 380, 1140 392`, 1176, 396, T, "dlq");
      stream(svg, f, -60, 1760, "h", T, 50, 1478);
      droplets(svg, [[98, 192, 6, 0], [122, 176, 4, 1], [515, 334, 5, 1], [805, 192, 6, 0], [830, 178, 3.5, 1], [1196, 196, 5, 0], [1218, 182, 3.5, 1]], T);
      ticks(svg, f, [1532, 1590, 1648], "h", T, -1, Math.min(f(1532), f(1590), f(1648)) - 52);
      xs.forEach((x, i) => disc(svg, x, f(x), r, STATIONS[i], i, T, root));
      browser(root, svg, 1700, 150, 262, 226, T);
      const centers = [220, 610, 1000, 1445], widths = [380, 380, 380, 470];
      centers.forEach((x, i) => label(root, STATIONS[i], x - widths[i] / 2, 430, widths[i], "center", T));
    } else {
      const ys = [334, 554, 774, 994];
      const cx = 196, r = 80;
      const f = (y) => cx + 28 * Math.sin((y - 266) / 212 * Math.PI);
      defs(svg, "v", 0, 1200);
      eddy(svg, `M${f(862) - 18} 862 C ${f(862) - 44} 868, 96 870, 82 882`, 64, 892, T, null, 32, 12);
      stream(svg, f, -60, 1260, "v", T, 48, 1060);
      droplets(svg, [[106, 476, 6, 0], [92, 496, 4, 1], [296, 690, 5, 1], [308, 670, 3.5, 0], [92, 690, 4, 0], [300, 902, 5, 0]], T);
      ticks(svg, f, [1102, 1138, 1174], "v", T, 1);
      ys.forEach((y, i) => disc(svg, f(y), y, r, STATIONS[i], i, T, root));
      const st4 = { ...STATIONS[3], pills: ["live", "stale"] };
      [...STATIONS.slice(0, 3), st4].forEach((st, i) => label(root, st, 340, ys[i] - 92, 800, "left", T));
    }
  }

  window.Lineage = { build };
})();
