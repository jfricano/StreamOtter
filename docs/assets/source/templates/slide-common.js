// Wave flair for slides: tapered ribbons (azure -> splash), droplets, code-stream dashes and revision ticks.
// flair(el, { h, tone: "dark" | "light" | "azure", ticks: [..labels], dashes: true, seed })
function flair(el, o) {
  const W = 1920, H = o.h, tone = o.tone ?? "dark";
  const pal = {
    dark: { a: "#048DFC", b: "#04BDFD", dash: ["#04BDFD", "#E9F2FC", "#048DFC"], tick: "#A9BAD5", drop: "#04BDFD", r2: "#04BDFD" },
    light: { a: "#048DFC", b: "#04BDFD", dash: ["#048DFC", "#04BDFD", "#A9BAD5"], tick: "#5D6F91", drop: "#04BDFD", r2: "#04BDFD" },
    azure: { a: "#04BDFD", b: "#04BDFD", dash: ["#04183F", "#E9F2FC", "#04BDFD"], tick: "#04183F", drop: "#E9F2FC", r2: "#E9F2FC" },
  }[tone];
  let rnd = o.seed ?? 7; const r = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const cy = (base, A, L, ph) => (x) => base + A * Math.sin((2 * Math.PI * x) / L + ph);
  const ribbon = (f, th, x0 = -20, x1 = W + 20, taper = 0.25) => {
    const top = [], bot = [];
    for (let x = x0; x <= x1; x += 12) {
      const u = (x - x0) / (x1 - x0);
      const t = th * Math.min(1, Math.sin(Math.PI * Math.min(u / taper, 1) / 2)) * (0.55 + 0.45 * u);
      top.push(`${x.toFixed(0)} ${(f(x) - t / 2).toFixed(1)}`); bot.push(`${x.toFixed(0)} ${(f(x) + t / 2).toFixed(1)}`);
    }
    return "M" + top.join("L") + "L" + bot.reverse().join("L") + "Z";
  };
  const id = "g" + Math.round(r() * 1e6);
  const f1 = cy(H * 0.42, H * 0.10, 1500, 0.6), f2 = cy(H * 0.66, H * 0.08, 1300, 1.7), f3 = cy(H * 0.86, H * 0.06, 1700, 2.6), fd = cy(H * 0.54, H * 0.09, 1400, 1.1);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${pal.a}"/><stop offset="1" stop-color="${pal.b}"/></linearGradient></defs>`;
  s += `<path d="${ribbon(f1, H * 0.16, 260, W + 20, 0.3)}" fill="url(#${id})"/>`;
  s += `<path d="${ribbon(f2, H * 0.09, -20, W + 20, 0.2)}" fill="${pal.r2}" fill-opacity="0.9"/>`;
  s += `<path d="${ribbon(f3, H * 0.05, 520, W + 20, 0.3)}" fill="${pal.a}" fill-opacity="0.75"/>`;
  if (o.dashes !== false) {
    for (const [f, row] of [[fd, 0]]) {
      let x = row ? 900 : 120 + r() * 60;
      while (x < W) {
        const len = 18 + r() * 70, c = pal.dash[Math.floor(r() * pal.dash.length)], op = row ? 0.5 : 0.85;
        const y = f(x + len / 2), ang = Math.atan2(f(x + len) - f(x), len) * 180 / Math.PI;
        s += `<rect x="${x.toFixed(0)}" y="${(y - 5).toFixed(1)}" width="${len.toFixed(0)}" height="10" rx="5" fill="${c}" fill-opacity="${op}" transform="rotate(${ang.toFixed(1)} ${(x + len / 2).toFixed(0)} ${y.toFixed(1)})"/>`;
        x += len + 14 + r() * 26;
      }
    }
  }
  for (const [x, dy, rr] of [[230, -0.14, 9], [196, -0.08, 5], [1840, 0.2, 7], [1150, -0.15, 6]]) s += `<circle cx="${x}" cy="${(f1(x) + H * dy).toFixed(1)}" r="${rr}" fill="${pal.drop}"/>`;
  if (o.ticks) {
    o.ticks.forEach((lab, i) => {
      const x = o.tickX0 + i * o.tickGap, y = f1(x) - H * 0.08 - 22;
      s += `<line x1="${x}" y1="${y + 14}" x2="${x}" y2="${y + 34}" stroke="${pal.tick}" stroke-width="3" stroke-linecap="round"/><text x="${x}" y="${y}" text-anchor="middle" font-family="JetBrains Mono" font-size="22" font-weight="600" fill="${pal.tick}">${lab}</text>`;
    });
  }
  el.innerHTML = s + "</svg>";
}
