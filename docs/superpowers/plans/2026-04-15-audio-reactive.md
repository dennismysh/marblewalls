# Audio-Reactive Looping Wallpapers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audio-reactive visuals where users load an audio file, pick a loop slice, and the marble pattern reacts to bass/mid/treble/beat energy — with live preview and MP4 export with embedded audio.

**Architecture:** Pre-computed feature table extracted via vendored FFT from a crossfaded audio loop buffer. One shared `Features[N]` array drives both live preview (rAF + interpolation) and offline render (discrete frames). One new shader uniform (`u_colorBias`); all other modulation feeds through existing JS-side inputs. Silent mode is completely unaffected — every code path defaults to current behavior when no audio is loaded.

**Tech Stack:** Web Audio API (decode, playback), vendored Cooley-Tukey FFT (~100 lines), WebCodecs AudioEncoder (AAC for MP4 audio track), existing mp4-muxer (already supports audio tracks).

**Spec:** `docs/superpowers/specs/2026-04-15-audio-reactive-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `fft.js` | Create | Radix-2 Cooley-Tukey FFT, Hann window, magnitude computation. Pure math, no DOM. Dual-export (browser global + CJS). |
| `audio.js` | Create | Audio decode, mono collapse, loop-slice, equal-power crossfade, feature extraction (band energies, beat detection, smoothing, two-pass stabilization), normalization. Pure functions except `decodeAudio` which needs `AudioContext`. Dual-export. |
| `app.js` | Modify | New `u_colorBias` uniform in shader, extended `render()`/`animatedOffsets()`/`renderFrames()` signatures, new state fields, audio UI wiring, live preview rAF loop, audio transport, MP4 audio track encoding, error handling, share UX. |
| `index.html` | Modify | Audio panel section (file input, start offset slider, reactivity slider, play/pause), extended duration dropdown (12s, 16s), audio badge, new `<script>` tags for `fft.js` and `audio.js`. |
| `style.css` | Modify | Audio panel field styles, play/pause button, file display row, audio badge. |
| `test/test-fft.js` | Create | Node-runnable unit tests for FFT correctness. |
| `test/test-audio.js` | Create | Node-runnable unit tests for feature extraction, crossfade, two-pass convergence. |

---

### Task 1: FFT Module

**Files:**
- Create: `fft.js`
- Create: `test/test-fft.js`

- [ ] **Step 1: Write FFT test file with 440 Hz sine test**

```js
// test/test-fft.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { fft, hann, magnitudes } = require("../fft.js");

test("FFT peaks at correct bin for 440 Hz sine", () => {
  const N = 2048;
  const sr = 44100;
  const freq = 440;
  const samples = new Float64Array(N);
  for (let i = 0; i < N; i++) samples[i] = Math.sin(2 * Math.PI * freq * i / sr);
  const win = hann(N);
  const windowed = new Float64Array(N);
  for (let i = 0; i < N; i++) windowed[i] = samples[i] * win[i];
  const mags = magnitudes(fft(windowed));
  const expectedBin = Math.round(freq / (sr / N));
  let peakBin = 0;
  for (let i = 1; i < mags.length; i++) {
    if (mags[i] > mags[peakBin]) peakBin = i;
  }
  assert.ok(Math.abs(peakBin - expectedBin) <= 1,
    `Peak at bin ${peakBin}, expected ~${expectedBin}`);
});

test("FFT of DC signal has energy only in bin 0", () => {
  const N = 512;
  const samples = new Float64Array(N).fill(1.0);
  const mags = magnitudes(fft(samples));
  assert.ok(mags[0] > 0, "Bin 0 should have energy");
  for (let i = 1; i < mags.length; i++) {
    assert.ok(mags[i] < 1e-10, `Bin ${i} should be near zero, got ${mags[i]}`);
  }
});

test("Hann window is symmetric and zero at endpoints", () => {
  const N = 256;
  const w = hann(N);
  assert.ok(w[0] < 1e-10, "First sample should be ~0");
  assert.ok(w[N - 1] < 1e-10, "Last sample should be ~0");
  assert.ok(Math.abs(w[N / 2] - 1.0) < 1e-10, "Middle should be ~1");
  for (let i = 0; i < N / 2; i++) {
    assert.ok(Math.abs(w[i] - w[N - 1 - i]) < 1e-10, `Symmetry at ${i}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/test-fft.js`
Expected: FAIL — `Cannot find module '../fft.js'`

- [ ] **Step 3: Implement fft.js**

```js
// fft.js — Radix-2 Cooley-Tukey FFT, Hann window, magnitude helper.
// No dependencies. Works in browser (global MarbleFft) and Node (require).
"use strict";

function bitReverse(x, bits) {
  var result = 0;
  for (var i = 0; i < bits; i++) {
    result = (result << 1) | (x & 1);
    x >>= 1;
  }
  return result;
}

function fft(input) {
  var N = input.length;
  var bits = Math.round(Math.log2(N));
  var real = new Float64Array(N);
  var imag = new Float64Array(N);
  for (var i = 0; i < N; i++) real[bitReverse(i, bits)] = input[i];
  for (var size = 2; size <= N; size *= 2) {
    var half = size >> 1;
    var angle = -2 * Math.PI / size;
    for (var i = 0; i < N; i += size) {
      for (var j = 0; j < half; j++) {
        var wr = Math.cos(angle * j);
        var wi = Math.sin(angle * j);
        var k = i + j;
        var kh = k + half;
        var tr = real[kh] * wr - imag[kh] * wi;
        var ti = real[kh] * wi + imag[kh] * wr;
        real[kh] = real[k] - tr;
        imag[kh] = imag[k] - ti;
        real[k] += tr;
        imag[k] += ti;
      }
    }
  }
  return { real: real, imag: imag };
}

function hann(N) {
  var w = new Float64Array(N);
  for (var i = 0; i < N; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  }
  return w;
}

function magnitudes(result) {
  var N = result.real.length;
  var half = N >> 1;
  var mags = new Float64Array(half);
  for (var i = 0; i < half; i++) {
    mags[i] = Math.sqrt(result.real[i] * result.real[i] + result.imag[i] * result.imag[i]);
  }
  return mags;
}

var MarbleFft = { fft: fft, hann: hann, magnitudes: magnitudes };
if (typeof module !== "undefined") module.exports = MarbleFft;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/test-fft.js`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add fft.js test/test-fft.js
git commit -m "Add vendored radix-2 FFT module with tests"
```

---

### Task 2: Feature Extractor

**Files:**
- Create: `audio.js`
- Create: `test/test-audio.js`

- [ ] **Step 1: Write feature extraction tests**

```js
// test/test-audio.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
// fft.js must be loaded first (sets global MarbleFft for audio.js)
globalThis.MarbleFft = require("../fft.js");
const { extractFeatures, crossfadeLoop, monoFromStereo, sliceBuffer } = require("../audio.js");

test("200 Hz sine produces highest bass energy", () => {
  const sr = 44100;
  const dur = 1;
  const N = 24; // 24 frames at 24 fps = 1 second
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(2 * Math.PI * 200 * i / sr);
  }
  const feat = extractFeatures(samples, sr, 24, N);
  const avgBass = mean(feat.bass);
  const avgMid = mean(feat.mid);
  const avgTreb = mean(feat.treble);
  assert.ok(avgBass > avgMid * 2, `Bass (${avgBass}) should dominate mid (${avgMid})`);
  assert.ok(avgBass > avgTreb * 2, `Bass (${avgBass}) should dominate treble (${avgTreb})`);
});

test("8000 Hz sine produces highest treble energy", () => {
  const sr = 44100;
  const dur = 1;
  const N = 24;
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(2 * Math.PI * 8000 * i / sr);
  }
  const feat = extractFeatures(samples, sr, 24, N);
  const avgBass = mean(feat.bass);
  const avgTreb = mean(feat.treble);
  assert.ok(avgTreb > avgBass * 2, `Treble (${avgTreb}) should dominate bass (${avgBass})`);
});

test("Two-pass convergence: features[0] ≈ features[N-1] neighbors", () => {
  const sr = 44100;
  const dur = 1;
  const N = 24;
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(2 * Math.PI * 200 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 5000 * i / sr);
  }
  const feat = extractFeatures(samples, sr, 24, N);
  // The loop should be smooth: feature[0] and feature[N-1] should be close
  // (they're adjacent in the loop). We check relative distance.
  for (const key of ["bass", "mid", "treble"]) {
    const diff = Math.abs(feat[key][0] - feat[key][N - 1]);
    assert.ok(diff < 0.15, `${key} loop seam diff ${diff} should be < 0.15`);
  }
});

test("crossfadeLoop produces continuous seam", () => {
  const sr = 44100;
  const dur = 1;
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) samples[i] = i / samples.length;
  const looped = crossfadeLoop(samples, sr, 0.030);
  // The last sample and first sample should be close after crossfade
  const diff = Math.abs(looped[looped.length - 1] - looped[0]);
  assert.ok(diff < 0.05, `Seam diff ${diff} should be < 0.05`);
});

test("monoFromStereo averages channels", () => {
  const left = new Float32Array([1.0, 0.0, 0.5]);
  const right = new Float32Array([0.0, 1.0, 0.5]);
  const mono = monoFromStereo([left, right]);
  assert.strictEqual(mono[0], 0.5);
  assert.strictEqual(mono[1], 0.5);
  assert.strictEqual(mono[2], 0.5);
});

test("sliceBuffer extracts correct range", () => {
  const sr = 100; // 100 samples/sec for easy math
  const samples = new Float32Array(500);
  for (let i = 0; i < 500; i++) samples[i] = i;
  const slice = sliceBuffer(samples, sr, 1.0, 2.0); // 1s-3s = samples 100-299
  assert.strictEqual(slice.length, 200);
  assert.strictEqual(slice[0], 100);
  assert.strictEqual(slice[199], 299);
});

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/test-audio.js`
Expected: FAIL — `Cannot find module '../audio.js'`

- [ ] **Step 3: Implement audio.js**

```js
// audio.js — Audio decode helpers, loop-slice, crossfade, feature extraction.
// Depends on MarbleFft (fft.js). Works in browser (global MarbleAudio) and Node (require).
"use strict";

function monoFromStereo(channels) {
  var left = channels[0];
  var right = channels.length > 1 ? channels[1] : left;
  var mono = new Float32Array(left.length);
  for (var i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
  return mono;
}

function sliceBuffer(mono, sampleRate, startSec, durationSec) {
  var startSample = Math.round(startSec * sampleRate);
  var length = Math.round(durationSec * sampleRate);
  startSample = Math.max(0, Math.min(startSample, mono.length - length));
  length = Math.min(length, mono.length - startSample);
  return mono.slice(startSample, startSample + length);
}

function crossfadeLoop(samples, sampleRate, xfadeSec) {
  var xfadeSamples = Math.min(Math.round(xfadeSec * sampleRate), Math.floor(samples.length / 2));
  var out = new Float32Array(samples);
  for (var i = 0; i < xfadeSamples; i++) {
    var t = i / xfadeSamples;
    var fadeOut = Math.cos(t * Math.PI * 0.5);
    var fadeIn = Math.sin(t * Math.PI * 0.5);
    var tailIdx = samples.length - xfadeSamples + i;
    out[tailIdx] = samples[tailIdx] * fadeOut + samples[i] * fadeIn;
  }
  return out;
}

function normalize01(arr) {
  var max = 0;
  for (var i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max > 0) for (var i = 0; i < arr.length; i++) arr[i] /= max;
}

function extractFeatures(mono, sampleRate, fps, N) {
  var Fft = (typeof MarbleFft !== "undefined") ? MarbleFft : require("./fft.js");
  var fftSize = 2048;
  var hop = Math.round(sampleRate / fps);
  var win = Fft.hann(fftSize);

  var binHz = sampleRate / fftSize;
  var bassLo = Math.floor(20 / binHz);
  var bassHi = Math.ceil(250 / binHz);
  var midLo = Math.floor(250 / binHz);
  var midHi = Math.ceil(4000 / binHz);
  var trebLo = Math.floor(4000 / binHz);
  var trebHi = Math.min(Math.ceil(20000 / binHz), (fftSize >> 1) - 1);

  var alphaBass = 1 - Math.exp(-1 / (0.080 * fps));
  var alphaMid = 1 - Math.exp(-1 / (0.040 * fps));
  var alphaTreb = 1 - Math.exp(-1 / (0.040 * fps));
  var alphaBeatDecay = 1 - Math.exp(-1 / (0.150 * fps));

  var total = 2 * N;
  var rawBass = new Float32Array(total);
  var rawMid = new Float32Array(total);
  var rawTreb = new Float32Array(total);
  var rawBeat = new Float32Array(total);

  var prevMags = null;
  var fluxHistory = [];
  var fluxWinSize = Math.max(1, Math.ceil(fps * 0.5));

  for (var f = 0; f < total; f++) {
    var frameIdx = f % N;
    var sampleStart = frameIdx * hop;
    var windowed = new Float64Array(fftSize);
    for (var j = 0; j < fftSize; j++) {
      windowed[j] = (mono[(sampleStart + j) % mono.length] || 0) * win[j];
    }
    var mags = Fft.magnitudes(Fft.fft(windowed));

    var bass = 0, mid = 0, treb = 0;
    for (var b = bassLo; b <= bassHi && b < mags.length; b++) bass += mags[b];
    for (var b = midLo; b <= midHi && b < mags.length; b++) mid += mags[b];
    for (var b = trebLo; b <= trebHi && b < mags.length; b++) treb += mags[b];

    var flux = 0;
    if (prevMags) {
      for (var b = 0; b < mags.length; b++) {
        var delta = mags[b] - prevMags[b];
        if (delta > 0) flux += delta;
      }
    }
    prevMags = new Float64Array(mags);

    fluxHistory.push(flux);
    if (fluxHistory.length > fluxWinSize) fluxHistory.shift();
    var fluxAvg = 0;
    for (var k = 0; k < fluxHistory.length; k++) fluxAvg += fluxHistory[k];
    fluxAvg /= fluxHistory.length;
    var beatRaw = flux > fluxAvg * 1.5 ? flux - fluxAvg : 0;

    rawBass[f] = bass;
    rawMid[f] = mid;
    rawTreb[f] = treb;
    rawBeat[f] = beatRaw;
  }

  var sBass = 0, sMid = 0, sTreb = 0, sBeat = 0;
  var smoothBass = new Float32Array(total);
  var smoothMid = new Float32Array(total);
  var smoothTreb = new Float32Array(total);
  var smoothBeat = new Float32Array(total);

  for (var f = 0; f < total; f++) {
    sBass += alphaBass * (rawBass[f] - sBass);
    sMid += alphaMid * (rawMid[f] - sMid);
    sTreb += alphaTreb * (rawTreb[f] - sTreb);
    if (rawBeat[f] > sBeat) sBeat = rawBeat[f];
    else sBeat += alphaBeatDecay * (rawBeat[f] - sBeat);
    smoothBass[f] = sBass;
    smoothMid[f] = sMid;
    smoothTreb[f] = sTreb;
    smoothBeat[f] = sBeat;
  }

  var outBass = smoothBass.slice(N, 2 * N);
  var outMid = smoothMid.slice(N, 2 * N);
  var outTreb = smoothTreb.slice(N, 2 * N);
  var outBeat = smoothBeat.slice(N, 2 * N);

  normalize01(outBass);
  normalize01(outMid);
  normalize01(outTreb);
  normalize01(outBeat);

  return { bass: outBass, mid: outMid, treble: outTreb, beat: outBeat };
}

var MarbleAudio = {
  monoFromStereo: monoFromStereo,
  sliceBuffer: sliceBuffer,
  crossfadeLoop: crossfadeLoop,
  extractFeatures: extractFeatures,
  normalize01: normalize01
};
if (typeof module !== "undefined") module.exports = MarbleAudio;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/test-audio.js`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add audio.js test/test-audio.js
git commit -m "Add audio feature extraction with crossfade and two-pass loop stabilization"
```

---

### Task 3: Shader u_colorBias + Render Signature Changes

**Files:**
- Modify: `app.js:17-127` (FRAG shader string)
- Modify: `app.js:198-207` (makeProgram uniform locations)
- Modify: `app.js:210-222` (render function)
- Modify: `app.js:526-534` (animatedOffsets function)

- [ ] **Step 1: Add `u_colorBias` uniform declaration to FRAG shader**

In `app.js`, add `uniform float u_colorBias;` after the existing uniform block (line ~26), and apply it as an additive term to `f` before the sine-palette lookups.

Add after `uniform vec3  u_palette[8];`:
```glsl
    uniform float u_colorBias;
```

Change the sine-palette section from:
```glsl
      float sR  = sin(f * PI * 2.0 + wm * 2.0);
      float sG  = sin(g * PI * 3.0 + f * 2.0);
      float sGw = sin(wm * 4.0);
      float sB  = sin(f * PI * 1.5 + g * PI + 1.0);
```
to:
```glsl
      float fb  = f + u_colorBias;
      float sR  = sin(fb * PI * 2.0 + wm * 2.0);
      float sG  = sin(g * PI * 3.0 + fb * 2.0);
      float sGw = sin(wm * 4.0);
      float sB  = sin(fb * PI * 1.5 + g * PI + 1.0);
```

And in the custom palette section, change:
```glsl
        float t = clamp(f + wm * 0.1, 0.0, 1.0);
```
to:
```glsl
        float t = clamp(f + u_colorBias + wm * 0.1, 0.0, 1.0);
```

- [ ] **Step 2: Add `uColorBias` to makeProgram return**

In `makeProgram()`, add to the returned object (after `uPalette`):
```js
      uColorBias: gl.getUniformLocation(prog, "u_colorBias"),
```

- [ ] **Step 3: Extend render() to accept colorBias**

Change the function signature at line 210 from:
```js
  function render(gl, loc, width, height, offsets, scale, invert, paletteOpts) {
```
to:
```js
  function render(gl, loc, width, height, offsets, scale, invert, paletteOpts, colorBias) {
```

Add before `gl.drawArrays`:
```js
    gl.uniform1f(loc.uColorBias, colorBias || 0);
```

- [ ] **Step 4: Extend animatedOffsets() to accept phaseOffset**

Change the function signature from:
```js
  function animatedOffsets(base, i, N, radius) {
    const out = new Float32Array(12);
    const t = (2 * Math.PI * i) / N;
```
to:
```js
  function animatedOffsets(base, i, N, radius, phaseOffset) {
    const out = new Float32Array(12);
    const t = (2 * Math.PI * i) / N + (phaseOffset || 0);
```

- [ ] **Step 5: Verify silent mode renders identically**

Open `index.html` in a browser. Verify the preview renders exactly as before (colorBias defaults to 0, phaseOffset defaults to 0). Check that all existing exports (PNG, GIF, MP4) still work.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Add u_colorBias shader uniform and phaseOffset to animatedOffsets"
```

---

### Task 4: renderFrames Audio Modulation

**Files:**
- Modify: `app.js:596-632` (renderFrames function)

The `renderFrames` function currently calls `animatedOffsets` and `render` with fixed parameters. Add optional `features` and `reactivity` params so when present, each frame computes modulated values from the feature table.

- [ ] **Step 1: Extend renderFrames to accept audio options**

Change the function signature from:
```js
  async function renderFrames({ w, h, N, needsPixels, onFrame, onStatus }) {
```
to:
```js
  async function renderFrames({ w, h, N, needsPixels, onFrame, onStatus, features, reactivity }) {
```

Inside the frame loop (`for (let i = 0; i < N; i++)`), change:
```js
      const offs = animatedOffsets(base, i, N, ANIM_RADIUS);
      render(ogl, oloc, w, h, offs, state.scale, state.invert, paletteOpts);
```
to:
```js
      let radius = ANIM_RADIUS;
      let scale = state.scale;
      let phaseKick = 0;
      let colorBias = 0;
      if (features) {
        const r = reactivity || 1.0;
        radius = ANIM_RADIUS + 0.25 * features.bass[i] * r;
        scale = state.scale * (1 + 0.08 * features.mid[i] * r);
        phaseKick = 0.15 * features.beat[i] * r;
        colorBias = 0.30 * features.treble[i] * r;
      }
      const offs = animatedOffsets(base, i, N, radius, phaseKick);
      render(ogl, oloc, w, h, offs, scale, state.invert, paletteOpts, colorBias);
```

- [ ] **Step 2: Verify silent mode is unchanged**

The existing callers (`exportGIF`, `exportMP4`) don't pass `features` or `reactivity`, so they hit the `if (features)` false branch. Open the app, run a GIF or MP4 export, verify output is identical to before.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Wire feature-driven modulation into renderFrames loop"
```

---

### Task 5: HTML, CSS, and State for Audio Panel

**Files:**
- Modify: `index.html:95-141` (after palette section, before anim section)
- Modify: `index.html:128-133` (duration dropdown — add 12s, 16s)
- Modify: `index.html:175-177` (script tags — add fft.js and audio.js)
- Modify: `style.css` (audio panel styles)
- Modify: `app.js:236-268` (els), `app.js:288-301` (state), `app.js:906-924` (syncControlsFromState)

- [ ] **Step 1: Add audio panel HTML**

In `index.html`, after the closing `</div>` of `palette-field` (after line 122) and before the `anim-field` div (line 124), insert:

```html
      <div class="field audio-field" id="audio-field">
        <label>Audio</label>
        <div class="audio-file-row">
          <input id="audio-file" type="file" accept="audio/*" class="audio-file-input" />
          <span id="audio-file-name" class="audio-file-name">No file</span>
          <button id="audio-clear" class="btn btn-small" type="button" hidden>Clear</button>
        </div>
        <div class="audio-controls" id="audio-controls" hidden>
          <div class="field">
            <label for="audio-start">Start offset <span id="audio-start-readout" class="audio-readout">0:00.00</span></label>
            <input id="audio-start" type="range" min="0" max="1" step="0.01" value="0" />
          </div>
          <div class="field">
            <label for="audio-reactivity">Reactivity <span id="audio-reactivity-readout" class="audio-readout">1.00</span></label>
            <input id="audio-reactivity" type="range" min="0" max="1.5" step="0.01" value="1" />
          </div>
          <div class="row audio-transport">
            <button id="audio-play" class="btn" type="button">Play</button>
            <button id="audio-pause" class="btn" type="button" hidden>Pause</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add 12s and 16s duration options**

In the `anim-duration` select, add after the `8 s` option:
```html
            <option value="12">12 s</option>
            <option value="16">16 s</option>
```

- [ ] **Step 3: Add audio badge placeholder to stage-meta**

After `size-badge` span (line 32), add:
```html
        <span id="audio-badge" class="badge" hidden>&#9835; audio</span>
```

- [ ] **Step 4: Add script tags for fft.js and audio.js**

Before the `app.js` script tag (line 177), insert:
```html
  <script src="fft.js"></script>
  <script src="audio.js"></script>
```

- [ ] **Step 5: Add CSS for audio panel**

Append to `style.css`:

```css
.audio-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.audio-file-input {
  max-width: 140px;
  font-size: 12px;
}
.audio-file-name {
  font-size: 13px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.btn-small {
  padding: 4px 10px;
  font-size: 12px;
}
.audio-controls {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}
.audio-readout {
  float: right;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.audio-transport {
  gap: 8px;
}
```

- [ ] **Step 6: Add new state fields and els entries in app.js**

Add to `els` object (after `animProgressLabel`):
```js
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
```

Add to `state` object (after `palette`):
```js
    audioFile: null,
    audioBuffer: null,
    loopPcmMono: null,
    loopPcmStereo: null,
    features: null,
    audioStart: 0,
    audioTrackDuration: 0,
    reactivity: 1.0,
    audioPlaying: false,
```

- [ ] **Step 7: Wire audio state sync in syncControlsFromState**

After the `updateAnimWarning()` call, add:
```js
    // Audio controls
    const hasAudio = !!state.audioFile;
    els.audioControls.hidden = !hasAudio;
    els.audioClear.hidden = !hasAudio;
    els.audioBadge.hidden = !hasAudio;
    els.audioFileName.textContent = hasAudio ? state.audioFile.name : "No file";
    els.audioReactivity.value = state.reactivity;
    els.audioReactivityReadout.textContent = state.reactivity.toFixed(2);
    if (hasAudio && state.audioTrackDuration > 0) {
      const maxStart = Math.max(0, state.audioTrackDuration - state.animDurationSec);
      els.audioStart.max = maxStart;
      els.audioStart.value = state.audioStart;
      els.audioStartReadout.textContent = formatTime(state.audioStart);
    }
```

Add a `formatTime` helper near the other utility functions:
```js
  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ":" + s.toFixed(2).padStart(5, "0");
  }
```

- [ ] **Step 8: Verify the audio panel renders correctly**

Open `index.html` in a browser. Verify:
- Audio section is visible with "No file" text and a file picker.
- Controls (start offset, reactivity, play/pause) are hidden until a file is loaded.
- Duration dropdown now shows 12s and 16s options.
- No console errors.
- All existing functionality unaffected.

- [ ] **Step 9: Commit**

```bash
git add index.html style.css app.js
git commit -m "Add audio panel UI with file picker, start offset, reactivity, play/pause"
```

---

### Task 6: Audio Pipeline Integration (File Decode + Feature Extraction)

**Files:**
- Modify: `app.js` (add audio decode pipeline, event listeners for file input / start / reactivity)

- [ ] **Step 1: Add AudioContext lazy init and decode pipeline**

After the `state` object and before the animation helpers, add:

```js
  // ---- Audio pipeline ----------------------------------------------------
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  async function loadAudioFile(file) {
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) {
      toast("File too large (max 100 MB).");
      return;
    }
    try {
      const ctx = getAudioCtx();
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      if (decoded.duration > 600) {
        toast("Audio files longer than 10 minutes aren't supported.");
        return;
      }
      state.audioFile = file;
      state.audioBuffer = decoded;
      state.audioTrackDuration = decoded.duration;
      state.audioStart = Math.min(state.audioStart, Math.max(0, decoded.duration - state.animDurationSec));
      rebuildAudioLoop();
      syncControlsFromState();
      scheduleRender();
    } catch (err) {
      console.error(err);
      toast("Couldn't decode this file — try MP3, WAV, OGG, or M4A.");
    }
  }

  function clearAudioFile() {
    stopAudioPreview();
    state.audioFile = null;
    state.audioBuffer = null;
    state.loopPcmMono = null;
    state.loopPcmStereo = null;
    state.features = null;
    state.audioTrackDuration = 0;
    state.audioPlaying = false;
    syncControlsFromState();
    scheduleRender();
  }

  function rebuildAudioLoop() {
    if (!state.audioBuffer) return;
    const decoded = state.audioBuffer;
    const channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      channels.push(decoded.getChannelData(c));
    }
    const mono = MarbleAudio.monoFromStereo(channels);
    const monoSlice = MarbleAudio.sliceBuffer(mono, decoded.sampleRate, state.audioStart, state.animDurationSec);
    const monoLoop = MarbleAudio.crossfadeLoop(monoSlice, decoded.sampleRate, 0.030);

    // Build stereo loop for playback/export
    const stereoChannels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const ch = MarbleAudio.sliceBuffer(decoded.getChannelData(c), decoded.sampleRate, state.audioStart, state.animDurationSec);
      stereoChannels.push(MarbleAudio.crossfadeLoop(ch, decoded.sampleRate, 0.030));
    }

    state.loopPcmMono = monoLoop;
    state.loopPcmStereo = stereoChannels;

    const N = Math.round(state.animDurationSec * state.videoFps);
    state.features = MarbleAudio.extractFeatures(monoLoop, decoded.sampleRate, state.videoFps, N);
  }
```

- [ ] **Step 2: Wire file input and control listeners**

After the existing event listeners, add:

```js
  els.audioFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadAudioFile(file);
  });

  els.audioClear.addEventListener("click", clearAudioFile);

  els.audioStart.addEventListener("input", (e) => {
    state.audioStart = parseFloat(e.target.value) || 0;
    els.audioStartReadout.textContent = formatTime(state.audioStart);
    rebuildAudioLoop();
    scheduleRender();
  });

  els.audioReactivity.addEventListener("input", (e) => {
    state.reactivity = parseFloat(e.target.value) || 1.0;
    els.audioReactivityReadout.textContent = state.reactivity.toFixed(2);
  });

  // Re-extract features when duration or fps changes (they affect N)
  els.animDuration.addEventListener("change", () => {
    if (state.audioBuffer) rebuildAudioLoop();
  });
  els.animFps.addEventListener("change", () => {
    if (state.audioBuffer) rebuildAudioLoop();
  });
```

- [ ] **Step 3: Add drag-and-drop on the preview canvas**

After the file input listener:

```js
  els.canvas.parentElement.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  els.canvas.parentElement.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && file.type.startsWith("audio/")) loadAudioFile(file);
  });
```

- [ ] **Step 4: Verify pipeline works end-to-end**

Open in browser. Drop an MP3 onto the preview. Verify:
- File name appears in the audio panel.
- Controls (start offset, reactivity, play/pause) are revealed.
- Audio badge appears.
- No console errors.
- Changing start offset triggers re-extraction (check with `console.log(state.features.bass.slice(0,5))` in the listener).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Wire audio decode, loop-slice, crossfade, and feature extraction pipeline"
```

---

### Task 7: Live Preview (rAF Loop + Audio Transport)

**Files:**
- Modify: `app.js` (add audio transport, rAF render loop, play/pause wiring)

- [ ] **Step 1: Add audio preview transport and rAF loop**

After `rebuildAudioLoop()` function, add:

```js
  let audioSource = null;
  let audioStartTime = 0;
  let audioRafId = 0;

  function startAudioPreview() {
    if (!state.loopPcmStereo || !state.features) return;
    const ctx = getAudioCtx();
    if (ctx.state === "suspended") ctx.resume();

    stopAudioPreview();

    const buf = ctx.createBuffer(
      state.loopPcmStereo.length,
      state.loopPcmStereo[0].length,
      state.audioBuffer.sampleRate
    );
    for (let c = 0; c < state.loopPcmStereo.length; c++) {
      buf.copyToChannel(state.loopPcmStereo[c], c);
    }

    audioSource = ctx.createBufferSource();
    audioSource.buffer = buf;
    audioSource.loop = true;
    audioSource.connect(ctx.destination);
    audioSource.start();
    audioStartTime = ctx.currentTime;

    state.audioPlaying = true;
    els.audioPlay.hidden = true;
    els.audioPause.hidden = false;

    audioRafId = requestAnimationFrame(audioRenderTick);
  }

  function stopAudioPreview() {
    if (audioSource) {
      try { audioSource.stop(); } catch (_) {}
      audioSource.disconnect();
      audioSource = null;
    }
    if (audioRafId) {
      cancelAnimationFrame(audioRafId);
      audioRafId = 0;
    }
    state.audioPlaying = false;
    els.audioPlay.hidden = false;
    els.audioPause.hidden = true;
  }

  function audioRenderTick() {
    if (!state.audioPlaying || !state.features) return;

    const ctx = getAudioCtx();
    const loopDur = state.animDurationSec;
    const fps = state.videoFps;
    const N = Math.round(loopDur * fps);
    const t = ((ctx.currentTime - audioStartTime) % loopDur + loopDur) % loopDur;
    const frameF = t * fps;
    const i = Math.floor(frameF) % N;
    const alpha = frameF - Math.floor(frameF);
    const i1 = (i + 1) % N;

    // Interpolate features
    const feat = {
      bass: state.features.bass[i] * (1 - alpha) + state.features.bass[i1] * alpha,
      mid: state.features.mid[i] * (1 - alpha) + state.features.mid[i1] * alpha,
      treble: state.features.treble[i] * (1 - alpha) + state.features.treble[i1] * alpha,
      beat: state.features.beat[i] * (1 - alpha) + state.features.beat[i1] * alpha,
    };

    const r = state.reactivity;
    const radius = ANIM_RADIUS + 0.25 * feat.bass * r;
    const scale = state.scale * (1 + 0.08 * feat.mid * r);
    const phaseKick = 0.15 * feat.beat * r;
    const colorBias = 0.30 * feat.treble * r;

    const { w, h } = sizePreviewCanvas();
    const base = offsetsForSeed(state.seed);
    const offs = animatedOffsets(base, i, N, radius, phaseKick);
    render(gl, loc, w, h, offs, scale, state.invert, buildPaletteUniform(state), colorBias);
    updateBadges();

    audioRafId = requestAnimationFrame(audioRenderTick);
  }
```

- [ ] **Step 2: Wire play/pause buttons**

After the existing audio listeners:

```js
  els.audioPlay.addEventListener("click", startAudioPreview);
  els.audioPause.addEventListener("click", stopAudioPreview);
```

- [ ] **Step 3: Stop audio preview on file clear and state changes**

In `clearAudioFile()`, `stopAudioPreview()` is already called (added in Task 6, Step 1). Also stop preview when start offset changes — add to the audioStart listener after `rebuildAudioLoop()`:

```js
    if (state.audioPlaying) {
      stopAudioPreview();
      startAudioPreview();
    }
```

- [ ] **Step 4: Verify live preview works**

Open in browser. Load an audio file. Click Play. Verify:
- Audio plays from the correct start offset.
- Marble pattern visibly reacts — warp radius pulses with bass, scale breathes with mid, colors shift with treble, beats cause visible phase kicks.
- Pause stops both audio and visual animation.
- Dragging start offset while playing restarts from the new position.
- Reactivity slider at 0 makes the pattern static (like silent mode).
- Reactivity slider at 1.5 makes reactions more dramatic.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Add live audio-reactive preview with rAF render loop and transport"
```

---

### Task 8: MP4 Export with Embedded Audio Track

**Files:**
- Modify: `app.js` (extend `exportMP4` to include audio encoding when audio is loaded)

- [ ] **Step 1: Extend exportMP4 to pass features into renderFrames**

In `exportMP4()`, after computing `N`:

Change the `renderFrames` call to pass features when available:

```js
      await renderFrames({
        w, h, N,
        needsPixels: false,
        features: state.features || null,
        reactivity: state.reactivity,
        onFrame: (i, _pixels, canvas) => {
```

(The `onFrame`, `onStatus` callbacks stay the same.)

- [ ] **Step 2: Add AAC audio encoding when audio is loaded**

After the `await renderFrames(...)` block and before `setAnimProgress(100, "Finalizing…")`:

```js
      // Encode audio track if an audio file is loaded and AudioEncoder is available
      if (state.loopPcmStereo && "AudioEncoder" in window) {
        setAnimProgress(98, "Encoding audio…");
        await new Promise((r) => setTimeout(r, 0));
        const sr = state.audioBuffer.sampleRate;
        const numCh = state.loopPcmStereo.length;
        const numSamples = state.loopPcmStereo[0].length;

        const audioEnc = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
          error: (e) => console.error("AudioEncoder error:", e),
        });
        audioEnc.configure({
          codec: "mp4a.40.2",
          numberOfChannels: numCh,
          sampleRate: sr,
          bitrate: 192000,
        });

        const frameSize = 1024;
        for (let off = 0; off < numSamples; off += frameSize) {
          const count = Math.min(frameSize, numSamples - off);
          // f32-planar: channels are contiguous blocks
          const planarBuf = new Float32Array(count * numCh);
          for (let c = 0; c < numCh; c++) {
            planarBuf.set(state.loopPcmStereo[c].subarray(off, off + count), c * count);
          }
          const ad = new AudioData({
            format: "f32-planar",
            sampleRate: sr,
            numberOfFrames: count,
            numberOfChannels: numCh,
            timestamp: Math.round((off / sr) * 1_000_000),
            data: planarBuf,
          });
          audioEnc.encode(ad);
          ad.close();
        }
        await audioEnc.flush();
        audioEnc.close();
      }
```

- [ ] **Step 3: Add audio track to muxer config when audio is loaded**

Change the muxer initialization to conditionally include an audio track. Replace the existing muxer creation:

```js
      const hasAudioTrack = !!(state.loopPcmStereo && "AudioEncoder" in window);
      const muxerOpts = {
        target: new Mp4Muxer.ArrayBufferTarget(),
        video: { codec: "avc", width: w, height: h, frameRate: fps },
        fastStart: "in-memory",
      };
      if (hasAudioTrack) {
        muxerOpts.audio = {
          codec: "aac",
          numberOfChannels: state.loopPcmStereo.length,
          sampleRate: state.audioBuffer.sampleRate,
        };
      }
      const muxer = new Mp4Muxer.Muxer(muxerOpts);
```

- [ ] **Step 4: Update filename when audio is embedded**

Change the filename line:
```js
      const suffix = state.features ? "_audio" : "";
      const filename = `marblewalls_${state.seed}_${w}x${h}_${durationSec}s_${fps}fps${suffix}.mp4`;
```

- [ ] **Step 5: Also pass features into GIF export**

In `exportGIF()`, pass features into renderFrames the same way:
```js
      await renderFrames({
        w, h, N,
        needsPixels: true,
        features: state.features || null,
        reactivity: state.reactivity,
        onFrame: (i, pixels) => {
```

- [ ] **Step 6: Verify MP4 export with audio**

Open in browser. Load an audio file. Export MP4. Verify:
- File downloads with `_audio` suffix.
- Open in VLC / QuickTime — both video and audio play.
- Video shows audio-reactive marble motion.
- Set player to loop — verify the seam is clean (no audio pop, no visual jump).

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "Add embedded audio track to MP4 export with feature-driven video"
```

---

### Task 9: Edge Cases, Error Handling, Share UX

**Files:**
- Modify: `app.js` (share behavior, GIF tooltip, capability gates)
- Modify: `index.html` (GIF button tooltip update)

- [ ] **Step 1: Update GIF button tooltip in audio mode**

In `app.js`, after `loadAudioFile` sets state, add tooltip update logic. Create a helper:

```js
  function updateExportTooltips() {
    const hasAudio = !!state.audioFile;
    els.exportGif.title = hasAudio
      ? "Export looping GIF (silent — GIF has no audio)"
      : "Export looping GIF at 24 fps";
    els.exportMp4.title = hasAudio
      ? "Export looping MP4 with embedded audio"
      : "Export looping MP4 video at the selected frame rate";
  }
```

Call `updateExportTooltips()` at the end of `loadAudioFile()` and `clearAudioFile()`.

- [ ] **Step 2: Update share behavior for audio mode**

In the share click listener, add an audio-mode check before the existing logic:

```js
  els.share.addEventListener("click", async () => {
    if (state.audioFile) {
      toast("Share captures visual settings but not the audio file — export the MP4 to share with audio.");
      writeURL();
      try { await navigator.clipboard.writeText(location.href); } catch (_) {}
      return;
    }
    // ... existing share logic ...
  });
```

(Replace the existing `els.share.addEventListener` block.)

- [ ] **Step 3: Add start-offset clamping when duration changes**

In the `animDuration` change listener, after `rebuildAudioLoop()`, add:

```js
    if (state.audioBuffer) {
      const maxStart = Math.max(0, state.audioTrackDuration - state.animDurationSec);
      if (state.audioStart > maxStart) {
        state.audioStart = maxStart;
        toast("Start offset clamped to fit loop.");
      }
      syncControlsFromState();
    }
```

- [ ] **Step 4: Disable audio file input on ancient browsers**

At boot (near the existing WebCodecs check), add:

```js
  if (typeof AudioContext === "undefined" && typeof webkitAudioContext === "undefined") {
    els.audioFileInput.disabled = true;
    els.audioFileName.textContent = "Audio requires a modern browser";
  }
```

- [ ] **Step 5: Verify edge cases**

- Load a very short audio clip (< 2s). Set duration to 4s. Verify start offset clamps and toast shows.
- Click Share while audio is loaded. Verify toast message.
- Export GIF while audio is loaded. Verify it produces a silent GIF and tooltip says so.
- Remove the file. Verify app returns fully to silent mode (badge gone, controls hidden, tooltips reset).

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "Add audio-mode edge cases: share toast, GIF tooltip, start clamping, capability gate"
```

---

### Task 10: URL Parameter Persistence for Audio Settings

**Files:**
- Modify: `app.js` (`writeURL` and `loadFromURL` functions)

- [ ] **Step 1: Persist audioStart and reactivity in URL**

In `writeURL()`, add after the palette serialization:

```js
    if (state.audioStart > 0) p.set("audioStart", state.audioStart.toFixed(3));
    if (state.reactivity !== 1.0) p.set("reactivity", state.reactivity.toFixed(2));
```

In `loadFromURL()`, add at the end:

```js
    const audioStart = parseFloat(p.get("audioStart") || "");
    if (Number.isFinite(audioStart) && audioStart >= 0) state.audioStart = audioStart;

    const reactivity = parseFloat(p.get("reactivity") || "");
    if (Number.isFinite(reactivity)) state.reactivity = clamp(reactivity, 0, 1.5);
```

- [ ] **Step 2: Verify URL persistence**

Load an audio file, set start offset to 5.0 and reactivity to 0.75. Note the URL contains `audioStart=5.000&reactivity=0.75`. Reload page — settings are restored (though the audio file itself is gone, so controls are hidden until a file is re-loaded).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Persist audioStart and reactivity in URL parameters"
```

---

### Task 11: Manual QA

**Files:** None (verification only)

- [ ] **Step 1: Silent mode regression**

Open the app with no audio file. Verify all existing features work exactly as before:
- Seed / randomize / slider
- All presets, custom size
- Pattern scale
- Invert colors
- Custom palette (all counts, randomize)
- PNG download
- GIF export (24 fps)
- MP4 export (at 24/30/48/60 fps)
- Share link
- URL parameter round-trip

- [ ] **Step 2: Audio mode full flow**

1. Drop an MP3 onto the canvas.
2. Audio badge appears. Controls reveal.
3. Drag start offset — readout updates.
4. Set reactivity to 1.0, click Play.
5. Verify visual reactivity is clearly synced to audio.
6. Pause. Change seed. Play again — different pattern, same reactivity.
7. Set reactivity to 0 — visuals are static (like silent mode).
8. Set reactivity to 1.5 — visuals are punchy.
9. Change duration to 8s — features re-extract, start slider adjusts range.
10. Export MP4 — downloads with `_audio` suffix, plays with audio in VLC/QuickTime.
11. Export GIF — downloads silently, tooltip warned about no audio.
12. Click Share — toast explains audio file isn't in URL.
13. Clear audio file — app returns to silent mode.

- [ ] **Step 3: Loop seam quality**

Export an 8-second MP4 at 30 fps with audio. Open in VLC, set to loop. Listen for:
- Audio pop/click at the seam → indicates crossfade needs tuning
- Visual jump at the seam → indicates two-pass features aren't converging

Both should be imperceptible or very subtle.

- [ ] **Step 4: Browser compatibility**

Test in Chrome and Safari (if available). Verify:
- Chrome: full functionality (audio encoding, MP4 with audio track)
- Safari 16.4+: should work similarly
- If testing Firefox: verify MP4 exports silently with a toast about AudioEncoder

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "QA fixes for audio-reactive feature"
```
