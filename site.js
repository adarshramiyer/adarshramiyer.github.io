// Scroll cue: hide "Projects ↓" once the projects are in view, and the whole fade at the bottom of the page.
(function () {
  const fade = document.querySelector(".scroll-fade");
  const projects = document.getElementById("projects");
  if (!fade) return;
  function update() {
    const atBottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 24;
    fade.classList.toggle("cue-gone", !projects || projects.getBoundingClientRect().top < innerHeight * 0.6);
    fade.classList.toggle("gone", atBottom);
  }
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();

// Top-bar labels follow the section titles: each in-page link (href="#id") takes the text of that section's <h2>,
// so renaming a section (e.g. "Projects" -> "Work") updates the top bar too. External links (Resume) are left alone.
document.querySelectorAll('.topnav a[href^="#"]').forEach((link) => {
  const title = document.querySelector(`${link.getAttribute("href")} > h2`);
  if (title) link.textContent = title.textContent.trim();
});

// Project links open in a new tab (applies to every link inside a .project, including ones added later).
document.querySelectorAll(".project a[href]").forEach((a) => {
  a.target = "_blank";
  a.rel = "noopener";
});

// Project videos: still until the project row is hovered, then loop; moving off pauses on the current frame,
// and the next hover resumes from there.
// (Cropping to the shared 4:3 frame is done in CSS with object-fit: cover.)
document.querySelectorAll(".project").forEach((project) => {
  const video = project.querySelector("video");
  if (!video) return;
  video.muted = true; // required for autoplay-on-hover in all browsers
  project.addEventListener("mouseenter", () => { video.play().catch(() => {}); });
  project.addEventListener("mouseleave", () => { video.pause(); });
});

// Flowing images: on hover, the base image of a .flow-media swirls like moving paint (a drifting turbulence field
// displaces it); .flow-still layers on top stay put. Like the videos, it freezes in place when the mouse leaves
// and continues from there on the next hover.
(function () {
  const media = document.querySelectorAll(".project .flow-media");
  if (!media.length) return;
  const NS = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(NS, "svg");
  defs.setAttribute("width", "0");
  defs.setAttribute("height", "0");
  defs.setAttribute("aria-hidden", "true");
  defs.style.position = "absolute";
  document.body.appendChild(defs);

  media.forEach((box, n) => {
    const base = box.querySelector("img:not(.flow-still)");
    const project = box.closest(".project");
    if (!base || !project) return;
    const id = `flow-${n}`;
    defs.insertAdjacentHTML("beforeend",
      `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
      `<feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves="2" seed="${7 + n}" result="noise"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`);
    const filter = defs.lastElementChild;
    const turb = filter.querySelector("feTurbulence"), disp = filter.querySelector("feDisplacementMap");

    const MAX_SCALE = 26;   // displacement strength in px once fully flowing
    const RAMP = 700;       // ms to ease into the full flow on the first hover
    let t = 0, amount = 0, last = 0, raf = 0;
    function frame(now) {
      const dt = last ? Math.min(now - last, 50) : 16;
      last = now;
      t += dt / 1000;
      amount = Math.min(1, amount + dt / RAMP);
      const fx = 0.012 + 0.003 * Math.sin(t * 0.7), fy = 0.018 + 0.004 * Math.cos(t * 0.5);
      turb.setAttribute("baseFrequency", `${fx.toFixed(5)} ${fy.toFixed(5)}`);
      disp.setAttribute("scale", (MAX_SCALE * amount * (0.8 + 0.2 * Math.sin(t * 1.3))).toFixed(2));
      raf = requestAnimationFrame(frame);
    }
    base.style.filter = `url(#${id})`;
    project.addEventListener("mouseenter", () => { last = 0; raf = requestAnimationFrame(frame); });
    project.addEventListener("mouseleave", () => { cancelAnimationFrame(raf); });
  });
})();

// Photo intro: the portrait is sampled from noise with DDPM (ancestral sampling, DDIM eta = 1).
//
// Variance-preserving process x_t = a(t) x0 + b(t) eps with a = cos(pi t / 2), b = sin(pi t / 2), in data space
// [-1, 1] shifted so the page background is zero (the noise sits around the page color). The denoiser is exact
// (it predicts the photo itself), so a sharp face emerges from the noise. Noise color is set by NOISE below.
// Steps are spaced with t(s) = (1 + cos(pi s)) / 2, which eases out of pure noise and tapers into the photo.
(function () {
  const root = document.documentElement;
  if (!root.classList.contains("intro")) return;
  const img = document.querySelector(".hero .photo img");
  const STEPS = 30, DURATION = 2600;

  const tAt = (k) => (k >= STEPS ? 0 : (1 + Math.cos((Math.PI * k) / STEPS)) / 2);
  const coef = (t) => [Math.cos((Math.PI / 2) * t), Math.sin((Math.PI / 2) * t)];

  // Seeded gaussian noise (Box-Muller), so every visit looks the same.
  let seed = 20261017;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) + 0.5) / 4294967296; };
  function gaussian(n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i += 2) {
      const r = Math.sqrt(-2 * Math.log(rnd())), th = 2 * Math.PI * rnd();
      out[i] = r * Math.cos(th);
      if (i + 1 < n) out[i + 1] = r * Math.sin(th);
    }
    return out;
  }

  // Noise color ("warm mix"). Each pixel's noise is  gray * g(1,1,1) + red * r * C + rgb * (n_r, n_g, n_b), with
  // g, r, n ~ N(0, 1) and gray^2 + red^2 + rgb^2 = 1. C is the direction from the page color toward the accent red
  // (scaled to unit RMS per channel), i.e. "ink in the accent color": +C darkens toward red; -C lightens, which
  // mostly clips on a white page.
  const NOISE = { gray: 0.7, red: 0.5, rgb: 0.5 };

  const accent = getComputedStyle(root).getPropertyValue("--accent").trim().match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  const page = getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number);
  const chroma = accent.map((v, k) => v - page[k]);
  const chromaRms = Math.sqrt(chroma.reduce((s, v) => s + v * v, 0) / 3);
  const C = chroma.map((v) => v / chromaRms);

  // Tint ramp: the noise starts as plain rgb and acquires the warm tint as sampling progresses. Fresh noise at
  // progress p uses gray and red weights scaled by ease(p), with the rgb weight topping the variance back up to 1.
  // (DDPM replaces most of the noise every step, so the visible grain follows the ramp closely.)
  const TINT_START = 0.05, TINT_END = 0.35;
  function weightsAt(p) {
    const u = Math.min(Math.max((p - TINT_START) / (TINT_END - TINT_START), 0), 1), e = u * u * (3 - 2 * u);
    const gray = NOISE.gray * e, red = NOISE.red * e;
    return { gray, red, rgb: Math.sqrt(Math.max(0, 1 - gray * gray - red * red)) };
  }

  // n pixels of structured noise (3 values per pixel) with weights w.
  function noise(n, w) {
    const out = new Float32Array(n * 3);
    const g = w.gray ? gaussian(n) : null, r = w.red ? gaussian(n) : null, c = w.rgb ? gaussian(n * 3) : null;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        out[3 * i + k] = (g ? w.gray * g[i] : 0) + (r ? w.red * r[i] * C[k] : 0) + (c ? w.rgb * c[3 * i + k] : 0);
      }
    }
    return out;
  }

  function showPhoto() {
    root.classList.remove("intro");
    img.style.opacity = "";
  }

  function run() {
    const wrap = document.createElement("span");
    wrap.className = "photo-noise";
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);

    // One working pixel per css pixel of the photo.
    const size = Math.round(img.getBoundingClientRect().width), N = size * size;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const bg = getComputedStyle(document.body).backgroundColor;

    // With an exact denoiser the noise part n_t = x_t - a(t) x0 evolves on its own, so x_t = a x0 + n_t can be
    // composited without ever reading the photo's pixels (which browsers block for local files):
    //   page color, photo at opacity a  ->  a x0 + (1 - a) bg  (x0 relative to the page color, as designed)
    //   + positive part of n            ->  additive ("lighter") blend
    //   - negative part of n            ->  invert, add, invert back
    const layer = () => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
    const posC = layer(), negC = layer();
    const posX = posC.getContext("2d"), negX = negC.getContext("2d");
    const posD = posX.createImageData(size, size), negD = negX.createImageData(size, size);
    const eps = noise(N, weightsAt(0)); // x_1 is pure noise: n_1 = b(1) eps = eps

    function draw(t) {
      const [a, b] = coef(t);
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < 3; c++) {
          const v = b * eps[3 * i + c] * 127.5;
          posD.data[4 * i + c] = v > 0 ? v : 0;
          negD.data[4 * i + c] = v < 0 ? -v : 0;
        }
        posD.data[4 * i + 3] = negD.data[4 * i + 3] = 255;
      }
      posX.putImageData(posD, 0, 0);
      negX.putImageData(negD, 0, 0);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);
      ctx.globalAlpha = a;
      ctx.drawImage(img, 0, 0, size, size);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(posC, 0, 0);
      ctx.globalCompositeOperation = "difference";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(negC, 0, 0);
      ctx.globalCompositeOperation = "difference";
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = "source-over";
    }

    // One ancestral step from t to t2 on the unit noise eps: keep part of it, replace the rest with fresh noise.
    // (n = b eps; DDPM keeps sqrt(b2^2 - c^2) of the current noise and injects c of fresh noise.)
    function step(t, t2, p) {
      const [a, b] = coef(t), [a2, b2] = coef(t2);
      if (b2 <= 0) return;
      const c = (b2 / b) * Math.sqrt(Math.max(0, 1 - (a * a) / (a2 * a2)));
      const keep = Math.sqrt(Math.max(0, b2 * b2 - c * c)) / b2, fresh = c / b2;
      const z = noise(N, weightsAt(p));
      for (let i = 0; i < eps.length; i++) eps[i] = keep * eps[i] + fresh * z[i];
    }

    img.style.opacity = 0;
    root.classList.remove("intro");
    draw(tAt(0));
    const start = performance.now() + 120;
    let k = 0;
    const tick = () => {
      const next = Math.min(STEPS, Math.floor(((performance.now() - start) / DURATION) * STEPS));
      while (k < next) { step(tAt(k), tAt(k + 1), (k + 1) / STEPS); k++; }
      if (k >= STEPS) {
        // The final sample is the photo itself; dissolve the canvas away.
        draw(0);
        img.style.opacity = "";
        canvas.style.transition = "opacity 450ms ease-out";
        requestAnimationFrame(() => { canvas.style.opacity = 0; });
        setTimeout(() => canvas.remove(), 500);
        return;
      }
      if (next > 0) draw(tAt(k));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Start once the photo is decoded (capped, so a slow load never hides it for long). If the effect can't run
  // for any reason, just show the photo.
  const ready = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 1200))]).then(() => {
    try { run(); } catch (err) {
      document.querySelectorAll(".photo-noise canvas").forEach((c) => c.remove());
      showPhoto();
    }
  });
})();
