// Shared motif generator for the launch visuals (social-*, article-* templates).
// Draws the brief's motifs as plain SVG strings: layered water, tapered wave ribbons and
// droplets (from the mark), code-stream dashes (from the detailed logo), revision ticks and
// live/stale chips. Deterministic: every random choice comes from a seeded generator.
(function () {
  const TAU = Math.PI * 2;
  const r1 = (n) => Math.round(n * 10) / 10;

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A wave centreline y = f(x): two sines plus an optional tilt.
  function wave({ y, amp = 20, len = 700, phase = 0, amp2 = 0, len2 = 300, phase2 = 0, tilt = 0 }) {
    return (x) => y + amp * Math.sin((TAU * x) / len + phase) + amp2 * Math.sin((TAU * x) / len2 + phase2) + tilt * x;
  }
  const shift = (f, dy) => (x) => f(x) + dy;

  function samples(f, x0, x1, step = 6) {
    const pts = [];
    for (let x = x0; x < x1; x += step) pts.push([x, f(x)]);
    pts.push([x1, f(x1)]);
    return pts;
  }
  const poly = (pts) => pts.map((p, i) => (i ? "L" : "M") + r1(p[0]) + " " + r1(p[1])).join("");

  // Water filled from the wave down to `bottom`.
  function water(f, x0, x1, bottom, fill, extra = "") {
    return `<path d="${poly(samples(f, x0, x1))}L${x1} ${bottom}L${x0} ${bottom}Z" fill="${fill}" ${extra}/>`;
  }

  // Tapered swoosh along f, like the waves in the mark. `hang` 0..1: how much of the
  // thickness hangs below the centreline. `peak` 0..1: where along the run it is thickest.
  function ribbon(f, x0, x1, thick, fill, { peak = 0.5, hang = 0.7, power = 0.85, extra = "" } = {}) {
    const N = 140, top = [], bot = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = x0 + (x1 - x0) * t;
      const s = t < peak ? t / peak : (1 - t) / (1 - peak);
      const th = thick * Math.pow(Math.sin((s * Math.PI) / 2), power);
      const c = f(x);
      top.push([x, c - th * (1 - hang)]);
      bot.push([x, c + th * hang]);
    }
    return `<path d="${poly(top)}${bot.reverse().map((p) => "L" + r1(p[0]) + " " + r1(p[1])).join("")}Z" fill="${fill}" ${extra}/>`;
  }

  // Arc-length walker along f.
  function walker(f, x0, x1) {
    const pts = samples(f, x0, x1, 2), acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = acc[acc.length - 1];
    const idx = (s) => { let lo = 0, hi = acc.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; acc[m] < s ? (lo = m) : (hi = m); } return lo; };
    const at = (s) => { const i = idx(s), k = (s - acc[i]) / (acc[i + 1] - acc[i] || 1); return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; };
    const between = (s0, s1) => { const a = idx(s0), b = idx(s1); return [at(s0), ...pts.slice(a + 1, b + 1), at(s1)]; };
    return { total, at, between };
  }

  // Code-stream dashes: rounded bars and dots riding the current.
  function codeStream(f, x0, x1, {
    seed = 1, width = 10, colors = ["#04BDFD"], weights = null, lens = [0, 22, 36, 54, 80, 120],
    gap = [14, 24], start = 0, opacity = 1, chevron = false, fade = 0,
  } = {}) {
    const rand = rng(seed), w = walker(f, x0, x1);
    const pick = (arr, wts) => {
      if (!wts) return arr[Math.floor(rand() * arr.length)];
      let r = rand() * wts.reduce((a, b) => a + b, 0);
      for (let i = 0; i < arr.length; i++) { r -= wts[i]; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    };
    let out = "", s = start;
    if (chevron) {
      const [cx, cy] = w.at(s + width), h = width * 1.1;
      out += `<path d="M${r1(cx - h * 0.5)} ${r1(cy - h)}L${r1(cx + h * 0.5)} ${r1(cy)}L${r1(cx - h * 0.5)} ${r1(cy + h)}" fill="none" stroke="${colors[colors.length - 1]}" stroke-width="${width * 0.8}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
      s += width * 3.2;
    }
    while (s < w.total - width) {
      const L = Math.min(pick(lens), w.total - s - width);
      const c = pick(colors, weights);
      // optional fade-out towards the run's end, so streams dissolve instead of stopping hard
      const op = fade ? opacity * Math.min(1, (w.total - s) / fade) : opacity;
      if (L <= 4) {
        const [x, y] = w.at(s);
        out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${width / 2}" fill="${c}" opacity="${r1(op * 100) / 100}"/>`;
      } else {
        out += `<path d="${poly(w.between(s, s + L))}" fill="none" stroke="${c}" stroke-width="${width}" stroke-linecap="round" opacity="${r1(op * 100) / 100}"/>`;
      }
      s += Math.max(L, 0) + gap[0] + rand() * (gap[1] - gap[0]) + width;
    }
    return out;
  }

  // A droplet: a teardrop whose tail points along `angle` (degrees, 0 = right).
  function drop(x, y, r, fill, angle = -120, stretch = 1.9) {
    const t = r * stretch;
    return `<path transform="translate(${r1(x)} ${r1(y)}) rotate(${angle})" d="M${r1(t)} 0C${r1(t * 0.55)} ${r1(-r * 0.35)} ${r1(r * 0.35)} ${r1(-r)} 0 ${r1(-r)}A${r} ${r} 0 0 0 0 ${r}C${r1(r * 0.35)} ${r} ${r1(t * 0.55)} ${r1(r * 0.35)} ${r1(t)} 0Z" fill="${fill}"/>`;
  }
  const dot = (x, y, r, fill, extra = "") => `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}" ${extra}/>`;

  // Revision ticks along f: a dot on the stream, a short stem and a mono label.
  function ticks(f, xs, labels, {
    size = 18, r = 6, stem = 26, line = "#A9BAD5", fill = "#04183F", ring = "#04BDFD", label = "#A9BAD5",
    weight = 500, below = false,
  } = {}) {
    return xs.map((x, i) => {
      const y = f(x), dir = below ? 1 : -1, y2 = y + dir * stem;
      const ty = below ? y2 + size * 1.05 : y2 - size * 0.45;
      return `<g><line x1="${r1(x)}" y1="${r1(y + dir * (r + 3))}" x2="${r1(x)}" y2="${r1(y2)}" stroke="${line}" stroke-width="${Math.max(1.5, size / 10)}" stroke-linecap="round"/>` +
        `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" fill="${fill}" stroke="${ring}" stroke-width="${r * 0.55}"/>` +
        (labels[i] ? `<text x="${r1(x)}" y="${r1(ty)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="${weight}" font-size="${size}" fill="${label}" letter-spacing="0.02em">${labels[i]}</text>` : "") + `</g>`;
    }).join("");
  }

  // SVG chip matching streamotter.dev's .chip (dot + mono label in a pill).
  const STATES = {
    dark: { live: ["#01e1fc", "#062F3D"], stale: ["#f2b84b", "#33260B"] },
    light: { live: ["#00728a", "#D6F5FB"], stale: ["#7f4f00", "#FAE9C6"] },
  };
  function chip(x, y, state, { size = 20, theme = "dark", anchor = "start", text = state, outline = false } = {}) {
    const [fg, bg] = STATES[theme][state];
    const tw = text.length * size * 0.64, padL = size * 0.65, padR = size * 0.75, dotR = size * 0.25, gapD = size * 0.45;
    const w = padL + dotR * 2 + gapD + tw + padR, h = size * 1.84;
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    return `<g><rect x="${r1(x0)}" y="${r1(y - h / 2)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h / 2)}" fill="${bg}" ${outline ? `stroke="${fg}" stroke-width="${size / 12}"` : ""}/>` +
      `<circle cx="${r1(x0 + padL + dotR)}" cy="${r1(y)}" r="${r1(dotR)}" fill="${fg}"/>` +
      `<text x="${r1(x0 + padL + dotR * 2 + gapD)}" y="${r1(y + size * 0.36)}" font-family="JetBrains Mono, monospace" font-weight="600" font-size="${size}" letter-spacing="${size * 0.04}" fill="${fg}">${text}</text></g>`;
  }
  chip.width = (text, size) => size * 0.65 + size * 0.5 + size * 0.45 + text.length * size * 0.64 + size * 0.75;

  // A small "view" card: mono title, a chip, a revision, and placeholder rows of code dashes.
  function viewCard(x, y, w, h, { title = "view", state = "live", rev = "r43", theme = "dark", size = 18, seed = 21, dim = false, rows = 3 } = {}) {
    const dark = theme === "dark";
    const fill = dark ? "#0E2A5C" : "#FFFFFF", edge = dark ? "#1B3D78" : "#C4DDF8", txt = dark ? "#E9F2FC" : "#04183F", sub = dark ? "#A9BAD5" : "#41506B";
    const pad = size * 1.1;
    let out = `<g opacity="${dim ? 0.92 : 1}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${size * 0.8}" fill="${fill}" stroke="${edge}" stroke-width="${Math.max(1.5, size / 9)}"/>`;
    out += `<text x="${x + pad}" y="${y + pad + size * 0.75}" font-family="JetBrains Mono, monospace" font-weight="500" font-size="${size}" fill="${sub}">${title}</text>`;
    out += chip(x + w - pad, y + pad + size * 0.4, state, { size: size * 0.95, theme, anchor: "end" });
    const rowColors = dark ? (state === "live" ? ["#04BDFD", "#E9F2FC", "#A9BAD5"] : ["#7D90B1", "#A9BAD5", "#5B6E92"]) : (state === "live" ? ["#048DFC", "#04183F", "#A6CBF3"] : ["#A9BAD5", "#C4D2E6", "#8796B0"]);
    for (let i = 0; i < rows; i++) {
      const ry = y + pad * 2.6 + i * size * 1.55;
      if (ry > y + h - pad * 0.8) break;
      out += codeStream(() => ry, x + pad + size * 0.3, x + w - pad - size * 0.3, { seed: seed + i * 5, width: size * 0.5, colors: rowColors, weights: [3, 2, 1], lens: [0, size * 1.6, size * 2.6, size * 4], gap: [size * 0.5, size * 0.9] });
    }
    out += `<text x="${x + pad}" y="${y + h - pad * 0.75}" font-family="JetBrains Mono, monospace" font-weight="500" font-size="${size * 0.85}" fill="${sub}">${rev}</text></g>`;
    return out;
  }

  // Faint field of code-stream rows used as texture.
  function texture(W, H, { seed = 7, rows = 10, y0 = 0, y1 = H, color = "#A9BAD5", opacity = 0.06, width = 6, amp = 6, x0 = 0, x1 = W } = {}) {
    let out = "";
    for (let i = 0; i < rows; i++) {
      const y = y0 + ((y1 - y0) * (i + 0.5)) / rows;
      out += codeStream(wave({ y, amp, len: 900 + i * 37, phase: i * 0.9 }), x0, x1, {
        seed: seed + i * 13, width, colors: [color], opacity, lens: [0, 18, 30, 46, 70, 110], gap: [16, 34], start: (i * 53) % 90,
      });
    }
    return out;
  }

  const DARK = { back: "#0B2453", mid: "#0E2A5C", front: "#1B3D78", deep: "#04183F", azure: "#048DFC", splash: "#04BDFD", light: "#E9F2FC", whisker: "#A9BAD5" };
  const LIGHT = { back: "#DCEBFB", mid: "#C4DDF8", front: "#A6CBF3", deep: "#04183F", azure: "#048DFC", splash: "#04BDFD", light: "#04183F", whisker: "#41506B" };

  // The shared "creek" composition: layered water rising across the bottom of a canvas,
  // bright swooshes on the crest, code streams in the deep water, droplets and optional
  // revision ticks. `top` is the crest height at the left edge; `rise` lifts the right side.
  function creek(W, H, {
    top = H * 0.72, rise = 0, theme = "dark", seed = 3, scale = 1, ticksAt = null, tickLabels = ["r41", "r42", "r43"],
    tickSize = 18, chipState = null, chipSize = 20, streams = 3, drops = true, dropRange = null, phase = 0, swooshes = true, light = null,
  } = {}) {
    const P = theme === "dark" ? DARK : LIGHT, s = scale;
    const tilt = -rise / W;
    const crest = wave({ y: top, amp: 16 * s, len: 820 * s, phase: 0.6 + phase, amp2: 6 * s, len2: 310 * s, phase2: 1.3 + phase, tilt });
    const bg = "";
    let out = bg;
    // back water, mid water, front water
    out += water(wave({ y: top - 38 * s, amp: 22 * s, len: 1100 * s, phase: 2.1 + phase, amp2: 5 * s, len2: 260 * s, tilt }), 0, W, H, P.back);
    out += water(wave({ y: top - 12 * s, amp: 18 * s, len: 900 * s, phase: 1.2 + phase, amp2: 6 * s, len2: 340 * s, phase2: 0.4, tilt }), 0, W, H, P.mid);
    out += water(shift(crest, 18 * s), 0, W, H, P.front);
    out += water(shift(crest, 46 * s), 0, W, H, theme === "dark" ? "#081B45" : "#B9D6F6");
    // code streams in the deep water
    const deepColors = theme === "dark" ? [P.splash, P.light, P.whisker, P.azure] : ["#0369C9", "#04183F", "#048DFC", "#41506B"];
    for (let i = 0; i < streams; i++) {
      const dy = (78 + i * 34) * s;
      if (top + dy > H - 10 * s) break;
      out += codeStream(shift(crest, dy), W * 0.02 + i * 40 * s, W, {
        seed: seed + i * 11, width: 9 * s, colors: deepColors, weights: [5, 2, 1.2, 2], lens: [0, 24, 40, 60, 90, 130].map((v) => v * s),
        gap: [12 * s, 22 * s], opacity: theme === "dark" ? 0.9 - i * 0.18 : 0.85 - i * 0.2, chevron: i === 0, start: i * 20 * s,
      });
    }
    // swooshes on the crest
    if (swooshes) {
      const lightSwoosh = light ?? (theme === "dark" ? P.light : "#FFFFFF");
      out += ribbon(shift(crest, 24 * s), W * 0.08, W * 0.98, 22 * s, lightSwoosh, { peak: 0.62, hang: 0.4 });
      out += ribbon(shift(crest, 4 * s), -W * 0.05, W * 0.72, 26 * s, "url(#azsp)", { peak: 0.55, hang: 0.75 });
      out += ribbon(shift(crest, -16 * s), W * 0.35, W * 1.04, 16 * s, P.splash, { peak: 0.45, hang: 0.8 });
    }
    // droplets above the crest
    if (drops) {
      const rand = rng(seed + 99);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = W * (0.12 + (0.82 * i) / (n - 1)) + (rand() - 0.5) * 60 * s;
        const y = crest(x) - (34 + rand() * 46) * s;
        const r = (3 + rand() * 5) * s;
        if (dropRange && (x < dropRange[0] || x > dropRange[1])) continue;
        if (ticksAt && x > ticksAt[0] - 50 * s && x < ticksAt[ticksAt.length - 1] + (chipState ? 160 : 50) * s) continue;
        out += i % 3 === 1 ? drop(x, y, r * 1.3, i % 2 ? P.splash : P.azure, -150 + rand() * 40) : dot(x, y, r, i % 2 ? P.splash : P.azure);
      }
    }
    // revision ticks on the crest
    if (ticksAt) {
      out += ticks(shift(crest, -16 * s), ticksAt, tickLabels, {
        size: tickSize, r: 6 * s, stem: 30 * s,
        line: theme === "dark" ? "#A9BAD5" : "#41506B", label: theme === "dark" ? "#A9BAD5" : "#41506B",
        fill: theme === "dark" ? "#04183F" : "#FFFFFF", ring: theme === "dark" ? "#04BDFD" : "#048DFC",
      });
      if (chipState) {
        const x = ticksAt[ticksAt.length - 1], y = crest(x) - 16 * s - 30 * s - tickSize * 0.8;
        out += chip(x + tickSize * 1.9, y, chipState, { size: chipSize, theme, anchor: "start" });
      }
    }
    return { svg: out, crest };
  }

  const defs = `<defs><linearGradient id="azsp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#048DFC"/><stop offset="1" stop-color="#04BDFD"/></linearGradient>` +
    `<linearGradient id="azspv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04BDFD"/><stop offset="1" stop-color="#048DFC"/></linearGradient></defs>`;

  // Paint into <svg class="art">.
  function paint(svgEl, inner) {
    const W = svgEl.clientWidth || innerWidth, H = svgEl.clientHeight || innerHeight;
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svgEl.innerHTML = defs + inner;
  }

  window.SO = { rng, wave, shift, samples, poly, water, ribbon, codeStream, drop, dot, ticks, chip, viewCard, texture, creek, paint, defs, DARK, LIGHT };
})();
