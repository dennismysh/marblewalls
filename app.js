/* Marble Walls — WebGL wallpaper generator
 * Ports the Python domain-warped FBM algorithm to a GLSL fragment shader.
 * Pure client-side; no build step.
 */
(() => {
  "use strict";

  // ---- Shaders ----------------------------------------------------------

  const VERT = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  // FBM and domain warping transcribed from the Python script.
  // fbm5 and fbm4 are separate to keep loop counts static (WebGL1 requirement).
  const FRAG = `
    precision highp float;

    uniform vec2  u_resolution;
    uniform float u_offsets[12];
    uniform float u_scale;
    uniform float u_invert;

    float fbm5(vec2 p) {
      float val = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 5; i++) {
        val += amp * sin(p.x * freq + cos(p.y * freq * 0.7 + 1.3) * 1.7);
        val += amp * cos(p.y * freq + sin(p.x * freq * 0.9 + 2.1) * 1.3);
        freq *= 2.17;
        amp *= 0.48;
      }
      return val;
    }

    float fbm4(vec2 p) {
      float val = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 4; i++) {
        val += amp * sin(p.x * freq + cos(p.y * freq * 0.7 + 1.3) * 1.7);
        val += amp * cos(p.y * freq + sin(p.x * freq * 0.9 + 2.1) * 1.3);
        freq *= 2.17;
        amp *= 0.48;
      }
      return val;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;

      // Map to [-2, 2] on the shorter axis, extend the longer one so the
      // pattern isn't stretched on non-square aspect ratios.
      float aspect = u_resolution.x / u_resolution.y;
      vec2 p = (uv - 0.5) * 4.0;
      if (aspect >= 1.0) p.x *= aspect; else p.y /= aspect;
      p *= u_scale;

      float o0  = u_offsets[0],  o1  = u_offsets[1];
      float o2  = u_offsets[2],  o3  = u_offsets[3];
      float o4  = u_offsets[4],  o5  = u_offsets[5];
      float o6  = u_offsets[6],  o7  = u_offsets[7];
      float o8  = u_offsets[8],  o9  = u_offsets[9];
      float o10 = u_offsets[10], o11 = u_offsets[11];

      float wx1 = fbm5(vec2(p.x + o0, p.y + o1));
      float wy1 = fbm5(vec2(p.x + o2, p.y + o3));

      float wx2 = fbm5(vec2(p.x + 1.7 * wx1 + o4, p.y + 1.7 * wy1 + o5));
      float wy2 = fbm5(vec2(p.x + 1.7 * wx1 + o6, p.y + 1.7 * wy1 + o7));

      float wx3 = fbm4(vec2(p.x + 1.5 * wx2 + o8,  p.y + 1.5 * wy2 + o9));
      float wy3 = fbm4(vec2(p.x + 1.5 * wx2 + o10, p.y + 1.5 * wy2 + o11));

      float f  = fbm5(vec2(p.x + 2.0 * wx3,       p.y + 2.0 * wy3))       * 0.15 + 0.5;
      float g  = fbm4(vec2(p.x + 2.0 * wy3 + 4.0, p.y + 2.0 * wx3 + 1.0)) * 0.15 + 0.5;
      float wm = sqrt(wx3 * wx3 + wy3 * wy3) * 0.2;

      const float PI = 3.14159265358979;
      float sR  = sin(f * PI * 2.0 + wm * 2.0);
      float sG  = sin(g * PI * 3.0 + f * 2.0);
      float sGw = sin(wm * 4.0);
      float sB  = sin(f * PI * 1.5 + g * PI + 1.0);

      float r  = clamp(0.30 + 0.70 * sR * sR, 0.0, 1.0);
      float gc = clamp(0.20 + 0.60 * sG * sG + 0.20 * sGw * sGw, 0.0, 1.0);
      float b  = clamp(0.15 + 0.85 * sB * sB, 0.0, 1.0);

      vec3 col = vec3(r, gc, b);

      // Vignette (matches the Python: centered [-1, 1] on each axis).
      vec2 vc = (uv - 0.5) * 2.0;
      float vig = clamp(1.0 - dot(vc, vc) * 0.15, 0.3, 1.0);

      // Invert the fully-rendered output (including vignette) so the result
      // is a true color-negative of what you'd otherwise see on screen.
      vec3 rendered = col * vig;
      rendered = mix(rendered, vec3(1.0) - rendered, u_invert);

      gl_FragColor = vec4(rendered, 1.0);
    }
  `;

  // ---- Seeded PRNG ------------------------------------------------------

  // mulberry32 — tiny, fast, deterministic per-seed
  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function offsetsForSeed(seed) {
    const rng = mulberry32(seed);
    const o = new Float32Array(12);
    for (let i = 0; i < 12; i++) o[i] = rng() * 12;
    return o;
  }

  // ---- WebGL plumbing ---------------------------------------------------

  function createGL(canvas) {
    const gl =
      canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true }) ||
      canvas.getContext("experimental-webgl");
    if (!gl) throw new Error("WebGL is not available in this browser.");
    return gl;
  }

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error("Shader compile error: " + log);
    }
    return sh;
  }

  function makeProgram(gl) {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      throw new Error("Program link error: " + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // Full-screen triangle pair
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    return {
      prog,
      uRes: gl.getUniformLocation(prog, "u_resolution"),
      uOff: gl.getUniformLocation(prog, "u_offsets"),
      uScale: gl.getUniformLocation(prog, "u_scale"),
      uInvert: gl.getUniformLocation(prog, "u_invert"),
    };
  }

  function render(gl, loc, width, height, offsets, scale, invert) {
    gl.viewport(0, 0, width, height);
    gl.useProgram(loc.prog);
    gl.uniform2f(loc.uRes, width, height);
    gl.uniform1fv(loc.uOff, offsets);
    gl.uniform1f(loc.uScale, scale);
    gl.uniform1f(loc.uInvert, invert ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ---- App --------------------------------------------------------------

  const $ = (sel) => document.querySelector(sel);

  const els = {
    canvas: $("#preview"),
    seed: $("#seed"),
    seedSlider: $("#seed-slider"),
    randomize: $("#randomize"),
    preset: $("#preset"),
    customSize: $("#custom-size"),
    width: $("#width"),
    height: $("#height"),
    scale: $("#scale"),
    invert: $("#invert"),
    download: $("#download"),
    share: $("#share"),
    seedBadge: $("#seed-badge"),
    sizeBadge: $("#size-badge"),
    loading: $("#loading"),
  };

  // Preview GL context + program
  let gl, loc;
  try {
    gl = createGL(els.canvas);
    loc = makeProgram(gl);
  } catch (err) {
    document.querySelector(".canvas-wrap").innerHTML =
      `<div style="padding:24px;color:#ff9aa8;font-size:14px;text-align:center">
        ${err.message}<br><br>Try a modern browser that supports WebGL.
      </div>`;
    return;
  }

  const state = {
    seed: 0,
    width: 1920,
    height: 1080,
    scale: 1.0,
    preset: "1920x1080",
    invert: false,
  };

  // ---- URL params (?seed=, ?size=WxH, ?scale=) --------------------------
  function loadFromURL() {
    const p = new URLSearchParams(location.search);
    const s = parseInt(p.get("seed") || "", 10);
    if (Number.isFinite(s) && s >= 0) state.seed = s;

    const size = (p.get("size") || "").toLowerCase();
    const m = size.match(/^(\d+)x(\d+)$/);
    if (m) {
      const w = clamp(parseInt(m[1], 10), 64, 8192);
      const h = clamp(parseInt(m[2], 10), 64, 8192);
      state.width = w;
      state.height = h;
      // Try to match a preset option, else switch to custom
      const v = `${w}x${h}`;
      const opt = Array.from(els.preset.options).find((o) => o.value === v);
      state.preset = opt ? v : "custom";
    }

    const scale = parseFloat(p.get("scale") || "");
    if (Number.isFinite(scale)) state.scale = clamp(scale, 0.5, 2.5);

    const inv = (p.get("invert") || "").toLowerCase();
    if (inv === "1" || inv === "true") state.invert = true;
  }

  function writeURL() {
    const p = new URLSearchParams();
    p.set("seed", String(state.seed));
    p.set("size", `${state.width}x${state.height}`);
    if (state.scale !== 1) p.set("scale", state.scale.toFixed(2));
    if (state.invert) p.set("invert", "1");
    history.replaceState(null, "", `?${p.toString()}`);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---- Preview sizing ---------------------------------------------------
  // Render preview at display size * DPR, capped so interactive redraw stays fast.
  const PREVIEW_MAX_LONG = 1600;

  function sizePreviewCanvas() {
    const wrap = els.canvas.parentElement;
    // Keep preview aspect ratio matching the selected output size
    wrap.style.aspectRatio = `${state.width} / ${state.height}`;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = Math.max(1, Math.round(rect.width * dpr));
    let h = Math.max(1, Math.round(rect.height * dpr));

    // Cap so interactive redraws stay snappy
    const longest = Math.max(w, h);
    if (longest > PREVIEW_MAX_LONG) {
      const k = PREVIEW_MAX_LONG / longest;
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    if (els.canvas.width !== w || els.canvas.height !== h) {
      els.canvas.width = w;
      els.canvas.height = h;
    }
    return { w, h };
  }

  function renderPreview() {
    const { w, h } = sizePreviewCanvas();
    // Note: preview uses target aspect, but any resolution — the algorithm's
    // appearance only depends on aspect and scale, not pixel count.
    const offsets = offsetsForSeed(state.seed);
    render(gl, loc, w, h, offsets, state.scale, state.invert);
    updateBadges();
  }

  function updateBadges() {
    els.seedBadge.textContent = `seed ${state.seed}`;
    els.sizeBadge.textContent = `${state.width} × ${state.height}`;
  }

  // ---- Download at target resolution ------------------------------------
  async function downloadPNG() {
    const w = state.width;
    const h = state.height;

    showLoading(true);

    // Two-frame yield so the spinner actually paints
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    let ogl, oloc;
    try {
      ogl = createGL(off);
      oloc = makeProgram(ogl);
    } catch (err) {
      showLoading(false);
      toast("Could not render at " + w + "×" + h + ": " + err.message);
      return;
    }

    const maxTex = ogl.getParameter(ogl.MAX_TEXTURE_SIZE);
    if (w > maxTex || h > maxTex) {
      showLoading(false);
      toast(`This device caps GPU textures at ${maxTex}px. Try a smaller size.`);
      return;
    }

    const offsets = offsetsForSeed(state.seed);
    render(ogl, oloc, w, h, offsets, state.scale, state.invert);

    off.toBlob(
      (blob) => {
        showLoading(false);
        if (!blob) { toast("Could not encode PNG."); return; }
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `marblewalls_${state.seed}_${w}x${h}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
      "image/png"
    );
  }

  function showLoading(on) {
    els.loading.hidden = !on;
  }

  // ---- Toast ------------------------------------------------------------
  let toastEl;
  let toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  }

  // ---- Debounce ---------------------------------------------------------
  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderPreview();
      writeURL();
    });
  }

  // ---- Wire up UI -------------------------------------------------------
  function syncControlsFromState() {
    els.seed.value = state.seed;
    els.seedSlider.value = state.seed;
    els.scale.value = state.scale;
    els.width.value = state.width;
    els.height.value = state.height;
    els.invert.checked = state.invert;
    // Preset
    const v = `${state.width}x${state.height}`;
    const opt = Array.from(els.preset.options).find((o) => o.value === v);
    els.preset.value = opt ? v : "custom";
    els.customSize.hidden = els.preset.value !== "custom";
  }

  function setSeed(val) {
    const n = clamp(parseInt(val, 10) || 0, 0, 999999);
    state.seed = n;
    els.seed.value = n;
    els.seedSlider.value = n;
    scheduleRender();
  }

  els.seed.addEventListener("input", (e) => setSeed(e.target.value));
  els.seedSlider.addEventListener("input", (e) => setSeed(e.target.value));

  els.randomize.addEventListener("click", () => {
    setSeed(Math.floor(Math.random() * 1000000));
  });

  els.preset.addEventListener("change", () => {
    const v = els.preset.value;
    if (v === "custom") {
      els.customSize.hidden = false;
      state.width = clamp(parseInt(els.width.value, 10) || 1920, 64, 8192);
      state.height = clamp(parseInt(els.height.value, 10) || 1080, 64, 8192);
    } else {
      els.customSize.hidden = true;
      const [w, h] = v.split("x").map(Number);
      state.width = w;
      state.height = h;
      els.width.value = w;
      els.height.value = h;
    }
    scheduleRender();
  });

  [els.width, els.height].forEach((inp) => {
    inp.addEventListener("input", () => {
      if (els.preset.value !== "custom") return;
      state.width = clamp(parseInt(els.width.value, 10) || 1920, 64, 8192);
      state.height = clamp(parseInt(els.height.value, 10) || 1080, 64, 8192);
      scheduleRender();
    });
  });

  els.scale.addEventListener("input", (e) => {
    state.scale = parseFloat(e.target.value) || 1.0;
    scheduleRender();
  });

  els.invert.addEventListener("change", (e) => {
    state.invert = !!e.target.checked;
    scheduleRender();
  });

  els.download.addEventListener("click", downloadPNG);

  els.share.addEventListener("click", async () => {
    writeURL();
    const url = location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Marble Walls", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard");
    } catch {
      toast("Copy failed — select and copy the URL bar");
    }
  });

  window.addEventListener("resize", () => {
    // Only re-render if canvas element needs new size
    scheduleRender();
  });

  // ---- Boot -------------------------------------------------------------
  loadFromURL();
  syncControlsFromState();
  renderPreview();
  writeURL();
})();
