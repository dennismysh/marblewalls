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
    uniform float u_useCustomPalette;
    uniform int   u_paletteCount;
    uniform vec3  u_palette[8];
    uniform float u_colorBias;

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
      float fb  = f + u_colorBias;
      float sR  = sin(fb * PI * 2.0 + wm * 2.0);
      float sG  = sin(g * PI * 3.0 + fb * 2.0);
      float sGw = sin(wm * 4.0);
      float sB  = sin(fb * PI * 1.5 + g * PI + 1.0);

      float r  = clamp(0.30 + 0.70 * sR * sR, 0.0, 1.0);
      float gc = clamp(0.20 + 0.60 * sG * sG + 0.20 * sGw * sGw, 0.0, 1.0);
      float b  = clamp(0.15 + 0.85 * sB * sB, 0.0, 1.0);

      vec3 col = vec3(r, gc, b);

      // Custom palette: sample a smooth gradient across the user's N colors.
      // Drive it with the same noise 'f' that informs the procedural palette,
      // plus a dash of 'wm' so bands follow the marble's domain warping.
      if (u_useCustomPalette > 0.5) {
        float t = clamp(f + u_colorBias + wm * 0.1, 0.0, 1.0);
        float idx = t * float(u_paletteCount - 1);
        float idx0 = floor(idx);
        float idx1 = min(idx0 + 1.0, float(u_paletteCount - 1));
        float m = idx - idx0;
        // WebGL1 requires constant index expressions — select via static loop.
        vec3 c0 = vec3(0.0);
        vec3 c1 = vec3(0.0);
        for (int k = 0; k < 8; k++) {
          float fk = float(k);
          if (fk == idx0) c0 = u_palette[k];
          if (fk == idx1) c1 = u_palette[k];
        }
        col = mix(c0, c1, m);
      }

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
      uUseCustomPalette: gl.getUniformLocation(prog, "u_useCustomPalette"),
      uPaletteCount: gl.getUniformLocation(prog, "u_paletteCount"),
      uPalette: gl.getUniformLocation(prog, "u_palette[0]"),
      uColorBias: gl.getUniformLocation(prog, "u_colorBias"),
    };
  }

  function render(gl, loc, width, height, offsets, scale, invert, paletteOpts, colorBias) {
    gl.viewport(0, 0, width, height);
    gl.useProgram(loc.prog);
    gl.uniform2f(loc.uRes, width, height);
    gl.uniform1fv(loc.uOff, offsets);
    gl.uniform1f(loc.uScale, scale);
    gl.uniform1f(loc.uInvert, invert ? 1.0 : 0.0);
    const po = paletteOpts || EMPTY_PALETTE_UNIFORM;
    gl.uniform1f(loc.uUseCustomPalette, po.use ? 1.0 : 0.0);
    gl.uniform1i(loc.uPaletteCount, po.count);
    gl.uniform3fv(loc.uPalette, po.colors);
    gl.uniform1f(loc.uColorBias, colorBias || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Zero-filled palette uniform for calls that don't use a custom palette
  // (keeps the shader happy — uniforms must always have a value).
  const EMPTY_PALETTE_UNIFORM = {
    use: false,
    count: 2,
    colors: new Float32Array(24),
  };

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
    paletteToggle: $("#palette-toggle"),
    paletteField: $("#palette-field"),
    paletteCount: $("#palette-count"),
    paletteCountValue: $("#palette-count-value"),
    paletteSwatchesEl: $("#palette-swatches"),
    paletteSwatches: document.querySelectorAll("#palette-swatches .swatch"),
    paletteRandomize: $("#palette-randomize"),
    download: $("#download"),
    share: $("#share"),
    seedBadge: $("#seed-badge"),
    sizeBadge: $("#size-badge"),
    loading: $("#loading"),
    animDuration: $("#anim-duration"),
    animSize: $("#anim-size"),
    animFps: $("#anim-fps"),
    animWarning: $("#anim-warning"),
    exportGif: $("#export-gif"),
    exportMp4: $("#export-mp4"),
    animProgress: $("#anim-progress"),
    animProgressBar: $("#anim-progress-bar"),
    animProgressLabel: $("#anim-progress-label"),
    audioFileInput: $("#audio-file"),
    audioFileName: $("#audio-file-name"),
    audioClear: $("#audio-clear"),
    audioControls: $("#audio-controls"),
    audioStart: $("#audio-start"),
    audioStartReadout: $("#audio-start-readout"),
    audioReactivity: $("#audio-reactivity"),
    audioReactivityReadout: $("#audio-reactivity-readout"),
    audioPlay: $("#audio-play"),
    audioPause: $("#audio-pause"),
    audioBadge: $("#audio-badge"),
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

  const DEFAULT_PALETTE = ["#5b8cff", "#8b5bff", "#ff5b8c", "#ffbc5b",
                           "#5bffbc", "#ff5b5b", "#5bffff", "#ffffff"];
  const MAX_PALETTE = 8;
  const MIN_PALETTE = 2;

  const state = {
    seed: 0,
    width: 1920,
    height: 1080,
    scale: 1.0,
    preset: "1920x1080",
    invert: false,
    animDurationSec: 4,
    animSizeP: 2160, // long-edge target for GIF / MP4 export (4K)
    videoFps: 24, // MP4 frame rate; GIF is always 24 fps (see delayCsForFrame)
    useCustomPalette: false,
    paletteCount: 4,
    palette: DEFAULT_PALETTE.slice(),
    audioFile: null,
    audioBuffer: null,
    loopPcmMono: null,
    loopPcmStereo: null,
    features: null,
    audioStart: 0,
    audioTrackDuration: 0,
    reactivity: 1.0,
    audioPlaying: false,
  };

  // Animation radius: how far the first domain-warp layer drifts on its circle.
  // 0.35 is organic without losing the seed's identity.
  const ANIM_RADIUS = 0.35;
  // GIF is locked to 24 fps because its per-frame delay is an integer in
  // centiseconds — see delayCsForFrame for the alternating 4/5 cs pattern
  // that averages exactly 100/24. MP4 frame rate is user-selectable via
  // state.videoFps.
  const GIF_FPS = 24;

  // ---- Palette helpers --------------------------------------------------
  function hexToRgb(hex) {
    const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }

  function normalizeHex(hex) {
    const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
    return m ? "#" + m[1].toLowerCase() : null;
  }

  function hslToHex(h, s, l) {
    // h in [0,1], s/l in [0,1]
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const c = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
      return Math.round(c * 255).toString(16).padStart(2, "0");
    };
    return "#" + f(0) + f(8) + f(4);
  }

  function randomPalette(count) {
    const n = Math.max(MIN_PALETTE, Math.min(MAX_PALETTE, count | 0));
    const out = [];
    // Drop an anchor hue, then spread the rest around the wheel so we get
    // a varied-but-coherent set instead of N near-identical colors.
    const anchor = Math.random();
    for (let i = 0; i < n; i++) {
      const jitter = (Math.random() - 0.5) * 0.1;
      const h = (anchor + i / n + jitter + 1) % 1;
      const s = 0.6 + Math.random() * 0.25;
      const l = 0.45 + Math.random() * 0.2;
      out.push(hslToHex(h, s, l));
    }
    return out;
  }

  function buildPaletteUniform(state) {
    const buf = new Float32Array(MAX_PALETTE * 3);
    const count = Math.max(MIN_PALETTE, Math.min(MAX_PALETTE, state.paletteCount));
    for (let i = 0; i < count; i++) {
      const [r, g, b] = hexToRgb(state.palette[i] || "#000000");
      buf[i * 3] = r;
      buf[i * 3 + 1] = g;
      buf[i * 3 + 2] = b;
    }
    return { use: !!state.useCustomPalette, count, colors: buf };
  }

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

    // palette=5b8cff-8b5bff-ff5b8c-ffbc5b — absence means procedural mode.
    const paletteStr = p.get("palette") || "";
    if (paletteStr) {
      const parts = paletteStr
        .split(/[-,]/)
        .map((s) => normalizeHex(s))
        .filter(Boolean);
      if (parts.length >= MIN_PALETTE) {
        const count = Math.min(parts.length, MAX_PALETTE);
        state.useCustomPalette = true;
        state.paletteCount = count;
        // Preserve defaults in unused slots so toggling count back up looks nice.
        for (let i = 0; i < count; i++) state.palette[i] = parts[i];
      }
    }
  }

  function writeURL() {
    const p = new URLSearchParams();
    p.set("seed", String(state.seed));
    p.set("size", `${state.width}x${state.height}`);
    if (state.scale !== 1) p.set("scale", state.scale.toFixed(2));
    if (state.invert) p.set("invert", "1");
    if (state.useCustomPalette) {
      const hexes = state.palette
        .slice(0, state.paletteCount)
        .map((h) => (h || "#000000").replace(/^#/, ""));
      p.set("palette", hexes.join("-"));
    }
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
    render(gl, loc, w, h, offsets, state.scale, state.invert, buildPaletteUniform(state));
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
    render(ogl, oloc, w, h, offsets, state.scale, state.invert, buildPaletteUniform(state));

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

  // ---- Perfect-loop animation + GIF/MP4 export --------------------------
  //
  // The shader has no time uniform. To produce a *perfect* loop, we add a
  // circular perturbation to the first domain-warp layer's offsets
  // (o0..o3). Because cos/sin are 2π-periodic, frame 0 and frame N are
  // byte-identical — no seam when wrapping.

  function animatedOffsets(base, i, N, radius, phaseOffset) {
    const out = new Float32Array(12);
    const t = (2 * Math.PI * i) / N + (phaseOffset || 0);
    const r = radius || ANIM_RADIUS;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    // Decoupled orbit for the second pair — quarter-turn phase shift.
    const cosTQ = Math.cos(t + Math.PI / 2);
    const sinTQ = Math.sin(t + Math.PI / 2);
    out[0] = base[0] + r * cosT;
    out[1] = base[1] + r * sinT;
    out[2] = base[2] + r * cosTQ;
    out[3] = base[3] + r * sinTQ;
    for (let k = 4; k < 12; k++) out[k] = base[k];
    return out;
  }

  // GIF format stores per-frame delay in integer centiseconds (1/100 s).
  // True 24 fps is 100/24 ≈ 4.1667 cs, which is not representable. We
  // alternate 4 cs and 5 cs in a 5:1 ratio so a 6-frame block sums to 25 cs,
  // yielding exactly 100 cs per 24 frames = 24.00 fps average.
  function delayCsForFrame(i) {
    return i % 6 === 5 ? 5 : 4;
  }

  function animDimensionsFor(longP, srcW, srcH, maxTex) {
    // Size selector controls the long-edge pixel count; aspect ratio comes
    // from the user's PNG preset. The shader is resolution-independent —
    // it only cares about aspect and scale — so we can render at any size.
    const cap = Math.min(longP, maxTex);
    let w, h;
    if (srcW >= srcH) {
      w = cap;
      h = Math.max(2, Math.round((cap * srcH) / srcW));
    } else {
      h = cap;
      w = Math.max(2, Math.round((cap * srcW) / srcH));
    }
    // H.264 requires even dims; GIF benefits too.
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
    return { w, h };
  }

  function flipRowsRGBA(src, w, h, dst) {
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const srcOff = (h - 1 - y) * rowBytes;
      const dstOff = y * rowBytes;
      dst.set(src.subarray(srcOff, srcOff + rowBytes), dstOff);
    }
  }

  function setAnimProgress(pct, label) {
    els.animProgress.hidden = false;
    els.animProgressBar.value = Math.max(0, Math.min(100, pct));
    if (label !== undefined) els.animProgressLabel.textContent = label;
  }

  function hideAnimProgress() {
    els.animProgress.hidden = true;
    els.animProgressBar.value = 0;
    els.animProgressLabel.textContent = "";
  }

  function setExportButtonsDisabled(disabled) {
    for (const btn of [els.download, els.exportGif, els.exportMp4, els.share]) {
      if (!btn) continue;
      btn.disabled = disabled;
      btn.setAttribute("aria-disabled", String(disabled));
    }
  }

  // Shared frame generator. Renders N frames of the perfectly-looping
  // animation into a dedicated offscreen WebGL context, calling `onFrame`
  // with either a pixel buffer (for GIF) or the canvas itself (for MP4).
  async function renderFrames({ w, h, N, needsPixels, onFrame, onStatus }) {
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ogl = createGL(off);
    const oloc = makeProgram(ogl);

    const maxTex = ogl.getParameter(ogl.MAX_TEXTURE_SIZE);
    if (w > maxTex || h > maxTex) {
      throw new Error(`This device caps GPU textures at ${maxTex}px. Pick a smaller size.`);
    }

    const base = offsetsForSeed(state.seed);
    const paletteOpts = buildPaletteUniform(state);
    const readBuf = needsPixels ? new Uint8Array(w * h * 4) : null;
    const flipBuf = needsPixels ? new Uint8Array(w * h * 4) : null;

    for (let i = 0; i < N; i++) {
      const offs = animatedOffsets(base, i, N, ANIM_RADIUS);
      render(ogl, oloc, w, h, offs, state.scale, state.invert, paletteOpts);
      if (needsPixels) {
        ogl.readPixels(0, 0, w, h, ogl.RGBA, ogl.UNSIGNED_BYTE, readBuf);
        flipRowsRGBA(readBuf, w, h, flipBuf);
        await onFrame(i, flipBuf, off);
      } else {
        await onFrame(i, null, off);
      }
      if (onStatus) onStatus(i + 1, N);
      // Yield to the event loop so the progress UI can paint and the tab
      // stays responsive. A setTimeout(0) is enough on all browsers.
      await new Promise((r) => setTimeout(r, 0));
    }

    // Help the GC release the offscreen GPU context promptly.
    const lose = ogl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }

  function triggerDownload(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportGIF() {
    if (!window.GIFEnc) { toast("GIF encoder failed to load."); return; }

    const durationSec = state.animDurationSec;
    const N = durationSec * GIF_FPS; // multiple of 6 by construction (2/4/6/8 × 24)
    let w, h;
    try {
      const probeCanvas = document.createElement("canvas");
      const probeGL = createGL(probeCanvas);
      const maxTex = probeGL.getParameter(probeGL.MAX_TEXTURE_SIZE);
      const lose = probeGL.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      ({ w, h } = animDimensionsFor(state.animSizeP, state.width, state.height, maxTex));
    } catch (err) {
      toast("WebGL init failed: " + err.message);
      return;
    }

    setExportButtonsDisabled(true);
    setAnimProgress(0, "Preparing…");
    // Two-frame yield so the progress UI actually paints before the heavy work.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const { GIFEncoder, quantize, applyPalette } = window.GIFEnc;

    try {
      // Pass 1: build a shared palette from 4 sample frames (0, N/4, N/2,
      // 3N/4). A single palette across every frame is essential for a
      // clean loop seam — per-frame palettes introduce dithering shimmer.
      setAnimProgress(0, "Building palette…");
      const sampleIndices = [0, Math.floor(N / 4), Math.floor(N / 2), Math.floor((3 * N) / 4)];
      const sampleBuf = new Uint8Array(sampleIndices.length * w * h * 4);
      {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const ogl = createGL(off);
        const oloc = makeProgram(ogl);
        const base = offsetsForSeed(state.seed);
        const paletteOpts = buildPaletteUniform(state);
        const readBuf = new Uint8Array(w * h * 4);
        const flipBuf = new Uint8Array(w * h * 4);
        for (let s = 0; s < sampleIndices.length; s++) {
          const i = sampleIndices[s];
          const offs = animatedOffsets(base, i, N, ANIM_RADIUS);
          render(ogl, oloc, w, h, offs, state.scale, state.invert, paletteOpts);
          ogl.readPixels(0, 0, w, h, ogl.RGBA, ogl.UNSIGNED_BYTE, readBuf);
          flipRowsRGBA(readBuf, w, h, flipBuf);
          sampleBuf.set(flipBuf, s * w * h * 4);
          await new Promise((r) => setTimeout(r, 0));
        }
        const lose = ogl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
      const palette = quantize(sampleBuf, 256, { format: "rgb444" });

      // Pass 2: render each frame and write it to the GIF.
      const gif = GIFEncoder();
      await renderFrames({
        w, h, N,
        needsPixels: true,
        onFrame: (i, pixels) => {
          const indexed = applyPalette(pixels, palette, "rgb444");
          gif.writeFrame(indexed, w, h, {
            palette: i === 0 ? palette : undefined,
            delay: delayCsForFrame(i) * 10, // writeFrame takes ms; round(ms/10)=cs
            repeat: 0,
          });
        },
        onStatus: (done, total) => {
          const pct = (done / total) * 100;
          setAnimProgress(pct, `Encoding GIF… frame ${done} / ${total}`);
        },
      });
      setAnimProgress(100, "Finalizing…");
      await new Promise((r) => setTimeout(r, 0));
      gif.finish();
      const bytes = gif.bytesView();
      const blob = new Blob([bytes], { type: "image/gif" });
      const filename = `marblewalls_${state.seed}_${w}x${h}_${durationSec}s_${GIF_FPS}fps.gif`;
      triggerDownload(blob, filename);
      toast(`GIF exported (${formatBytes(blob.size)})`);
    } catch (err) {
      console.error(err);
      toast("GIF export failed: " + err.message);
    } finally {
      hideAnimProgress();
      setExportButtonsDisabled(false);
    }
  }

  async function exportMP4() {
    if (!("VideoEncoder" in window)) {
      toast("MP4 export needs WebCodecs (Chrome/Edge, Safari 16.4+, Firefox 130+).");
      return;
    }
    if (!window.Mp4Muxer) { toast("MP4 muxer failed to load."); return; }

    const durationSec = state.animDurationSec;
    const fps = state.videoFps;
    const N = durationSec * fps;
    let w, h;
    try {
      const probeCanvas = document.createElement("canvas");
      const probeGL = createGL(probeCanvas);
      const maxTex = probeGL.getParameter(probeGL.MAX_TEXTURE_SIZE);
      const lose = probeGL.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      ({ w, h } = animDimensionsFor(state.animSizeP, state.width, state.height, maxTex));
    } catch (err) {
      toast("WebGL init failed: " + err.message);
      return;
    }

    setExportButtonsDisabled(true);
    setAnimProgress(0, "Preparing…");
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const bitrate = Math.max(2_000_000, Math.min(40_000_000, Math.round(w * h * fps * 0.1)));

    let encoder = null;
    try {
      const muxer = new Mp4Muxer.Muxer({
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: "avc", width: w, height: h, frameRate: fps },
        fastStart: "in-memory",
      });

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => { throw e; },
      });

      // H.264 High profile, level chosen by pixel count × frame rate.
      // Each level has a macroblocks-per-second ceiling, so higher fps
      // pushes us up a level even at the same resolution (e.g. 1080p@60
      // needs 4.2, not 4.0).
      //   4.0 (avc1.640028) → up to 1080p @ 30fps
      //   4.2 (avc1.64002a) → up to 1080p @ 60fps
      //   5.0 (avc1.640032) → up to 1440p @ 30fps
      //   5.1 (avc1.640033) → up to 4K @ 30fps
      //   5.2 (avc1.640034) → up to 4K @ 60fps / 8K @ 30fps
      const pixelCount = w * h;
      let codec;
      if (pixelCount <= 1920 * 1080) codec = fps > 30 ? "avc1.64002a" : "avc1.640028";
      else if (pixelCount <= 2560 * 1440) codec = fps > 30 ? "avc1.640033" : "avc1.640032";
      else if (pixelCount <= 3840 * 2160) codec = fps > 30 ? "avc1.640034" : "avc1.640033";
      else codec = "avc1.640034";

      // Try the chosen codec first, then fall back to the next higher level
      // if the browser's H.264 encoder rejects it.
      const candidates = ["avc1.640028", "avc1.64002a", "avc1.640032", "avc1.640033", "avc1.640034"];
      const startIdx = Math.max(0, candidates.indexOf(codec));
      let chosen = null;
      for (let idx = startIdx; idx < candidates.length; idx++) {
        const cfg = { codec: candidates[idx], width: w, height: h, bitrate, framerate: fps };
        // eslint-disable-next-line no-await-in-loop
        const sup = await VideoEncoder.isConfigSupported(cfg);
        if (sup && sup.supported) { chosen = cfg; break; }
      }
      if (!chosen) throw new Error("No supported H.264 config for this resolution / frame rate.");
      encoder.configure(chosen);

      const frameDurUs = Math.round(1_000_000 / fps);

      await renderFrames({
        w, h, N,
        needsPixels: false,
        onFrame: (i, _pixels, canvas) => {
          const timestamp = Math.round((i * 1_000_000) / fps);
          const vf = new VideoFrame(canvas, { timestamp, duration: frameDurUs });
          // 1 keyframe per second + first frame, for seekability.
          encoder.encode(vf, { keyFrame: i === 0 || i % fps === 0 });
          vf.close();
        },
        onStatus: (done, total) => {
          const pct = (done / total) * 100;
          setAnimProgress(pct, `Encoding MP4… frame ${done} / ${total}`);
        },
      });

      setAnimProgress(100, "Finalizing…");
      await encoder.flush();
      muxer.finalize();
      const bytes = muxer.target.buffer;
      const blob = new Blob([bytes], { type: "video/mp4" });
      const filename = `marblewalls_${state.seed}_${w}x${h}_${durationSec}s_${fps}fps.mp4`;
      triggerDownload(blob, filename);
      toast(`MP4 exported (${formatBytes(blob.size)})`);
    } catch (err) {
      console.error(err);
      toast("MP4 export failed: " + err.message);
    } finally {
      if (encoder && encoder.state !== "closed") {
        try { encoder.close(); } catch (_) { /* ignore */ }
      }
      hideAnimProgress();
      setExportButtonsDisabled(false);
    }
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec - m * 60;
    return m + ":" + s.toFixed(2).padStart(5, "0");
  }

  function formatBytes(n) {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + " GB";
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + " MB";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + " KB";
    return n + " B";
  }

  function updateAnimWarning() {
    const p = state.animSizeP;
    const hasMp4 = "VideoEncoder" in window;
    const lines = [];
    if (p >= 2160) {
      lines.push("4K GIFs can exceed several hundred MB and take minutes to encode.");
      if (hasMp4) lines.push("MP4 at 4K is much smaller (~20–80 MB) and typically a better choice.");
    } else if (p >= 1080) {
      lines.push("1080p GIFs can be 30–70 MB. MP4 at 1080p is ~6–15 MB.");
    }
    if (lines.length === 0) {
      els.animWarning.hidden = true;
      els.animWarning.textContent = "";
    } else {
      els.animWarning.hidden = false;
      els.animWarning.textContent = lines.join(" ");
      els.animWarning.classList.toggle("warn-strong", p >= 2160);
    }
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
    // Animation controls
    els.animDuration.value = String(state.animDurationSec);
    els.animSize.value = String(state.animSizeP);
    els.animFps.value = String(state.videoFps);
    updateAnimWarning();
    // Audio controls
    var hasAudio = !!state.audioFile;
    els.audioControls.hidden = !hasAudio;
    els.audioClear.hidden = !hasAudio;
    els.audioBadge.hidden = !hasAudio;
    els.audioFileName.textContent = hasAudio ? state.audioFile.name : "No file";
    els.audioReactivity.value = state.reactivity;
    els.audioReactivityReadout.textContent = state.reactivity.toFixed(2);
    if (hasAudio && state.audioTrackDuration > 0) {
      var maxStart = Math.max(0, state.audioTrackDuration - state.animDurationSec);
      els.audioStart.max = maxStart;
      els.audioStart.value = state.audioStart;
      els.audioStartReadout.textContent = formatTime(state.audioStart);
    }
    // Palette controls
    syncPaletteControlsFromState();
  }

  function syncPaletteControlsFromState() {
    if (!els.paletteToggle) return;
    els.paletteToggle.checked = !!state.useCustomPalette;
    els.paletteField.hidden = !state.useCustomPalette;
    els.paletteCount.value = String(state.paletteCount);
    els.paletteCountValue.textContent = String(state.paletteCount);
    for (let i = 0; i < els.paletteSwatches.length; i++) {
      const sw = els.paletteSwatches[i];
      const hex = normalizeHex(state.palette[i]) || "#000000";
      sw.value = hex;
      sw.hidden = i >= state.paletteCount;
    }
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

  if (els.paletteToggle) {
    els.paletteToggle.addEventListener("change", (e) => {
      state.useCustomPalette = !!e.target.checked;
      els.paletteField.hidden = !state.useCustomPalette;
      scheduleRender();
    });

    els.paletteCount.addEventListener("input", (e) => {
      const n = clamp(parseInt(e.target.value, 10) || MIN_PALETTE, MIN_PALETTE, MAX_PALETTE);
      state.paletteCount = n;
      els.paletteCountValue.textContent = String(n);
      for (let i = 0; i < els.paletteSwatches.length; i++) {
        els.paletteSwatches[i].hidden = i >= n;
      }
      scheduleRender();
    });

    els.paletteSwatches.forEach((sw, i) => {
      sw.addEventListener("input", (e) => {
        const hex = normalizeHex(e.target.value);
        if (!hex) return;
        state.palette[i] = hex;
        scheduleRender();
      });
    });

    els.paletteRandomize.addEventListener("click", () => {
      const fresh = randomPalette(state.paletteCount);
      for (let i = 0; i < fresh.length; i++) {
        state.palette[i] = fresh[i];
        if (els.paletteSwatches[i]) els.paletteSwatches[i].value = fresh[i];
      }
      scheduleRender();
    });
  }

  els.download.addEventListener("click", downloadPNG);

  els.animDuration.addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v > 0) state.animDurationSec = v;
  });

  els.animSize.addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v > 0) state.animSizeP = v;
    updateAnimWarning();
  });

  els.animFps.addEventListener("change", (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v > 0) state.videoFps = v;
  });

  els.exportGif.addEventListener("click", exportGIF);
  els.exportMp4.addEventListener("click", exportMP4);

  // WebCodecs availability check: hide the MP4 button on unsupported browsers.
  if (!("VideoEncoder" in window)) {
    els.exportMp4.hidden = true;
  }

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
