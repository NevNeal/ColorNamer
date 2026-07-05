(() => {
  // Re-click after first injection just re-opens the eyedropper.
  if (window.__cnf) {
    window.__cnf.pick();
    return;
  }

  // ---------- Color math ----------
  function parseHex(input) {
    let h = input.trim().replace(/^#/, "").toLowerCase();
    if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function rgbToLab(r, g, b) {
    let [rl, gl, bl] = [r, g, b].map((v) => {
      v /= 255;
      return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    });
    let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
    x /= 0.95047; y /= 1.0; z /= 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x), fy = f(y), fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function deltaE2000(l1, l2) {
    const { L: L1, a: a1, b: b1 } = l1;
    const { L: L2, a: a2, b: b2 } = l2;
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const avgL = (L1 + L2) / 2;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
    const avgC = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const avgCp = (C1p + C2p) / 2;
    const h1p = (Math.atan2(b1, a1p) * deg + 360) % 360;
    const h2p = (Math.atan2(b2, a2p) * deg + 360) % 360;
    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) {
      dhp = h2p - h1p;
      if (dhp > 180) dhp -= 360;
      else if (dhp < -180) dhp += 360;
    }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
    let avghp;
    if (C1p * C2p === 0) avghp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) avghp = (h1p + h2p) / 2;
    else avghp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    const T = 1 - 0.17 * Math.cos((avghp - 30) * rad) + 0.24 * Math.cos(2 * avghp * rad) +
      0.32 * Math.cos((3 * avghp + 6) * rad) - 0.20 * Math.cos((4 * avghp - 63) * rad);
    const Sl = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
    const Sc = 1 + 0.045 * avgCp;
    const Sh = 1 + 0.015 * avgCp * T;
    const dTheta = 30 * Math.exp(-Math.pow((avghp - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
    const Rt = -Rc * Math.sin(2 * dTheta * rad);
    return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh));
  }

  // ---------- Data (loaded once, cached) ----------
  let colors = null;
  async function getColors() {
    if (colors) return colors;
    const res = await fetch(chrome.runtime.getURL("colornames.json"));
    const raw = await res.json();
    colors = raw.map((c) => {
      const { r, g, b } = parseHex(c.hex);
      return { name: c.name, hex: c.hex, lab: rgbToLab(r, g, b) };
    });
    return colors;
  }

  function nearest(hex, n) {
    const { r, g, b } = parseHex(hex);
    const target = rgbToLab(r, g, b);
    return colors
      .map((c) => ({ ...c, d: deltaE2000(target, c.lab) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n);
  }

  // ---------- Result card (shadow DOM, isolated from page CSS) ----------
  function showCard(pickedHex, matches) {
    document.getElementById("__cnf_host")?.remove();
    const host = document.createElement("div");
    host.id = "__cnf_host";
    const root = host.attachShadow({ mode: "open" });
    const best = matches[0];
    const similar = matches.slice(1, 7);
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          width: 232px; padding: 14px; border-radius: 14px;
          background: #17171b; color: #eaeaea; box-shadow: 0 12px 40px rgba(0,0,0,.5);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: pop .14s ease-out;
        }
        @keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.98); } }
        .top { display: flex; gap: 12px; align-items: center; }
        .sw { width: 52px; height: 52px; border-radius: 10px; border: 1px solid #34343a; flex: 0 0 auto; }
        .name { font-size: 16px; font-weight: 600; line-height: 1.2; }
        .hex { font-size: 12px; font-family: ui-monospace, monospace; color: #9a9aa2; margin-top: 3px; cursor: pointer; }
        .hex:hover { color: #eaeaea; }
        .row { display: flex; gap: 6px; margin-top: 12px; }
        .chip { flex: 1; aspect-ratio: 1; border-radius: 6px; border: 1px solid #34343a; cursor: pointer; }
        .chip:hover { outline: 2px solid #6b8afd; }
        .x { position: absolute; top: 8px; right: 10px; color: #6a6a72; cursor: pointer; font-size: 15px; line-height: 1; }
        .x:hover { color: #eaeaea; }
        .copied { position:absolute; bottom:14px; left:14px; font-size:11px; color:#6b8afd; opacity:0; transition:opacity .15s; }
      </style>
      <div class="card" part="card">
        <span class="x" title="Close">✕</span>
        <div class="top">
          <div class="sw" style="background:${pickedHex}"></div>
          <div>
            <div class="name">${best.name}</div>
            <div class="hex" title="Copy">${pickedHex.toLowerCase()} · click to copy</div>
          </div>
        </div>
        <div class="row">
          ${similar.map((c) => `<div class="chip" style="background:${c.hex}" title="${c.name} ${c.hex}"></div>`).join("")}
        </div>
        <span class="copied">Copied!</span>
      </div>`;
    document.documentElement.appendChild(host);

    const close = () => host.remove();
    root.querySelector(".x").addEventListener("click", close);
    root.querySelector(".hex").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(pickedHex.toLowerCase()); } catch {}
      const c = root.querySelector(".copied");
      c.style.opacity = "1";
      setTimeout(() => (c.style.opacity = "0"), 900);
    });
    root.querySelectorAll(".chip").forEach((el, i) => {
      el.addEventListener("click", () => showCard(similar[i].hex, nearest(similar[i].hex, 8)));
    });
    const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
  }

  // ---------- Pick flow ----------
  async function pick() {
    if (!window.EyeDropper) {
      alert("Your browser doesn't support the EyeDropper API (needs Chrome/Edge 95+).");
      return;
    }
    try {
      const [{ sRGBHex }] = await Promise.all([new EyeDropper().open()]);
      await getColors();
      showCard(sRGBHex, nearest(sRGBHex, 8));
    } catch (e) {
      // User pressed Esc / cancelled — do nothing.
    }
  }

  window.__cnf = { pick };
  pick();
})();
