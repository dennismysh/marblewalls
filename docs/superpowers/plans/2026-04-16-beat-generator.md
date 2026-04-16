# Beat Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in beat generator that synthesizes drum patterns across 4 genres using pure Web Audio, driving the existing audio-reactive visual pipeline alongside the file-upload path.

**Architecture:** New `synth.js` module contains stateless synth recipes and genre preset data. New `sequencer.js` module handles pattern sequencing, variation randomization, and OfflineAudioContext rendering. `app.js` gains a source toggle UI, new state fields, and a modified `rebuildAudioLoop()` that accepts generated buffers without crossfade. The downstream pipeline (features, preview, export) is unchanged.

**Tech Stack:** Web Audio API (OscillatorNode, AudioBufferSourceNode for noise, BiquadFilterNode, GainNode, OfflineAudioContext), existing mulberry32 PRNG for variations.

**Spec:** `docs/superpowers/specs/2026-04-16-beat-generator-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `synth.js` | Create | Stateless synth recipe functions (kick, snare, hihat, clap, subBass, shaker, pad, rimshot). Pure Web Audio scheduling. Dual-export (browser global `MarbleSynth` + CJS). |
| `sequencer.js` | Create | Genre preset data (4 genres), pattern variation via seeded PRNG, `renderBeat()` function that creates OfflineAudioContext, schedules all hits, returns AudioBuffer. Dual-export (`MarbleSequencer` + CJS). |
| `app.js` | Modify | New state fields (`audioSource`, `genreId`, `genBpm`, `genBars`, `genInstruments`, `genVariationSeed`), source toggle UI wiring, modified `rebuildAudioLoop()` to handle generator buffers, URL persistence for generator params, genre-specific badge text, export filename with genre. |
| `index.html` | Modify | Source toggle buttons, generator controls (genre dropdown, BPM slider, bars dropdown, instrument toggles, randomize button), script tags for `synth.js` and `sequencer.js`. |
| `style.css` | Modify | Source toggle styling, instrument toggle grid, generator control spacing. |
| `test/test-synth.js` | Create | Unit tests for synth recipes (non-silent output, correct spectral band). |
| `test/test-sequencer.js` | Create | Unit tests for sequencer (correct duration, variation determinism, downbeat preservation). |

---

### Task 1: Synth Engine Module

**Files:**
- Create: `synth.js`
- Create: `test/test-synth.js`

- [ ] **Step 1: Write synth test file**

```js
// test/test-synth.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");

// OfflineAudioContext is not available in Node. We test synth recipes
// by verifying they are callable functions with correct signatures.
// Spectral/RMS tests require a browser; covered by integration tests
// in test-sequencer.js using a mock or manual QA.
const synths = require("../synth.js");

test("All synth recipes are functions", () => {
  const names = ["kick", "snare", "hihat", "clap", "subBass", "shaker", "pad", "rimshot"];
  for (const name of names) {
    assert.strictEqual(typeof synths[name], "function", `synths.${name} should be a function`);
  }
});

test("Synth functions accept (ctx, dest, time, params) signature", () => {
  // Verify each function has length >= 3 (ctx, dest, time; params optional)
  const names = ["kick", "snare", "hihat", "clap", "subBass", "shaker", "pad", "rimshot"];
  for (const name of names) {
    assert.ok(synths[name].length >= 3, `synths.${name} should accept at least 3 args, got ${synths[name].length}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/test-synth.js`
Expected: FAIL — `Cannot find module '../synth.js'`

- [ ] **Step 3: Implement synth.js**

```js
// synth.js — Web Audio synth recipes for drum/instrument synthesis.
// Each function: (audioCtx, destination, time, params) → void
// Schedules nodes at the given time. Stateless — fire and forget.
// Works in browser (global MarbleSynth) and Node (require).
"use strict";

function createNoise(ctx, duration) {
  var sampleRate = ctx.sampleRate;
  var length = Math.ceil(sampleRate * duration);
  var buffer = ctx.createBuffer(1, length, sampleRate);
  var data = buffer.getChannelData(0);
  for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  var src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

function kick(ctx, dest, time, params) {
  var p = params || {};
  var decay = p.decay || 0.3;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + decay * 0.6);
  gain.gain.setValueAtTime(1.0, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + decay + 0.01);
}

function snare(ctx, dest, time, params) {
  var p = params || {};
  var decay = p.decay || 0.12;
  var tone = p.tone || 200;
  var noise = createNoise(ctx, decay);
  var nGain = ctx.createGain();
  var filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = p.filterFreq || 2000;
  nGain.gain.setValueAtTime(0.7, time);
  nGain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  noise.connect(filter);
  filter.connect(nGain);
  nGain.connect(dest);
  noise.start(time);
  noise.stop(time + decay + 0.01);
  var osc = ctx.createOscillator();
  var oGain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = tone;
  oGain.gain.setValueAtTime(0.5, time);
  oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.connect(oGain);
  oGain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.06);
}

function hihat(ctx, dest, time, params) {
  var p = params || {};
  var decay = p.decay || 0.03;
  var cutoff = p.cutoff || 8000;
  var noise = createNoise(ctx, decay + 0.02);
  var filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = cutoff;
  var gain = ctx.createGain();
  gain.gain.setValueAtTime(0.4, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  noise.start(time);
  noise.stop(time + decay + 0.02);
}

function clap(ctx, dest, time, params) {
  var p = params || {};
  var spread = p.spread || 0.03;
  var filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1500;
  filter.Q.value = 2;
  filter.connect(dest);
  for (var i = 0; i < 3; i++) {
    var noise = createNoise(ctx, 0.02);
    var gain = ctx.createGain();
    var t = time + i * (spread / 3);
    gain.gain.setValueAtTime(0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    noise.connect(gain);
    gain.connect(filter);
    noise.start(t);
    noise.stop(t + 0.05);
  }
}

function subBass(ctx, dest, time, params) {
  var p = params || {};
  var freq = p.freq || 45;
  var sustain = p.sustain || 0.4;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.8, time);
  gain.gain.setValueAtTime(0.8, time + sustain * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, time + sustain);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + sustain + 0.01);
}

function shaker(ctx, dest, time, params) {
  var p = params || {};
  var decay = p.decay || 0.06;
  var noise = createNoise(ctx, decay + 0.02);
  var filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = p.cutoff || 4000;
  var gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  noise.start(time);
  noise.stop(time + decay + 0.02);
}

function pad(ctx, dest, time, params) {
  var p = params || {};
  var duration = p.duration || 2.0;
  var attack = p.attack || 0.5;
  var freq = p.freq || 220;
  var filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = p.cutoff || 800;
  filter.connect(dest);
  for (var d = 0; d < 2; d++) {
    var osc = ctx.createOscillator();
    osc.type = d === 0 ? "sawtooth" : "triangle";
    osc.frequency.value = freq * (1 + d * 0.007);
    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(0.15, time + attack);
    gain.gain.setValueAtTime(0.15, time + duration - attack);
    gain.gain.linearRampToValueAtTime(0.001, time + duration);
    osc.connect(gain);
    gain.connect(filter);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }
}

function rimshot(ctx, dest, time, params) {
  var p = params || {};
  var tone = p.tone || 800;
  var osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = tone;
  var gain = ctx.createGain();
  gain.gain.setValueAtTime(0.5, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(time);
  osc.stop(time + 0.03);
  var noise = createNoise(ctx, 0.01);
  var nGain = ctx.createGain();
  nGain.gain.setValueAtTime(0.3, time);
  nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.01);
  noise.connect(nGain);
  nGain.connect(dest);
  noise.start(time);
  noise.stop(time + 0.02);
}

var MarbleSynth = {
  kick: kick, snare: snare, hihat: hihat, clap: clap,
  subBass: subBass, shaker: shaker, pad: pad, rimshot: rimshot,
  createNoise: createNoise
};
if (typeof module !== "undefined") module.exports = MarbleSynth;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/test-synth.js`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add synth.js test/test-synth.js
git commit -m "Add Web Audio synth engine with 8 instrument recipes"
```

---

### Task 2: Genre Presets & Sequencer Module

**Files:**
- Create: `sequencer.js`
- Create: `test/test-sequencer.js`

- [ ] **Step 1: Write sequencer tests**

```js
// test/test-sequencer.js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
globalThis.MarbleSynth = require("../synth.js");
const seq = require("../sequencer.js");

test("All 4 genre presets exist with required fields", () => {
  const ids = ["lofi", "techno", "trap", "ambient"];
  for (const id of ids) {
    const genre = seq.GENRES[id];
    assert.ok(genre, `Genre "${id}" should exist`);
    assert.ok(genre.name, `Genre "${id}" should have a name`);
    assert.ok(genre.bpm > 0, `Genre "${id}" should have a positive BPM`);
    assert.ok(genre.instruments, `Genre "${id}" should have instruments`);
    assert.ok(genre.pattern, `Genre "${id}" should have a pattern`);
    assert.strictEqual(genre.pattern.stepsPerBar, 16, `Genre "${id}" should have 16 steps per bar`);
    // Every instrument in the pattern must exist in instruments
    for (const key of Object.keys(genre.pattern)) {
      if (key === "stepsPerBar") continue;
      assert.ok(genre.instruments[key], `Genre "${id}" pattern has "${key}" but instruments doesn't`);
      assert.strictEqual(genre.pattern[key].length, 16, `Genre "${id}" pattern "${key}" should have 16 steps`);
    }
  }
});

test("Each genre has kick, snare, hihat as core instruments", () => {
  for (const id of Object.keys(seq.GENRES)) {
    const genre = seq.GENRES[id];
    assert.ok(genre.instruments.kick, `Genre "${id}" should have kick`);
    assert.ok(genre.instruments.snare, `Genre "${id}" should have snare`);
    assert.ok(genre.instruments.hihat, `Genre "${id}" should have hihat`);
  }
});

test("applyVariation with same seed produces identical output", () => {
  const genre = seq.GENRES.techno;
  const v1 = seq.applyVariation(genre.pattern, 42);
  const v2 = seq.applyVariation(genre.pattern, 42);
  for (const key of Object.keys(v1)) {
    if (key === "stepsPerBar") continue;
    assert.deepStrictEqual(v1[key], v2[key], `Variation for "${key}" should be deterministic`);
  }
});

test("applyVariation with different seeds produces different output", () => {
  const genre = seq.GENRES.techno;
  const v1 = seq.applyVariation(genre.pattern, 1);
  const v2 = seq.applyVariation(genre.pattern, 999);
  let different = false;
  for (const key of Object.keys(v1)) {
    if (key === "stepsPerBar") continue;
    for (let i = 0; i < v1[key].length; i++) {
      if (v1[key][i] !== v2[key][i]) { different = true; break; }
    }
    if (different) break;
  }
  assert.ok(different, "Different seeds should produce different patterns");
});

test("applyVariation preserves downbeats (steps 0, 4, 8, 12)", () => {
  const genre = seq.GENRES.techno;
  const original = genre.pattern;
  for (let seed = 0; seed < 10; seed++) {
    const varied = seq.applyVariation(original, seed);
    for (const key of Object.keys(varied)) {
      if (key === "stepsPerBar") continue;
      for (const db of [0, 4, 8, 12]) {
        if (original[key][db] > 0) {
          assert.ok(varied[key][db] > 0,
            `Seed ${seed}: downbeat ${db} for "${key}" should be preserved`);
        }
      }
    }
  }
});

test("computeLoopDuration returns correct seconds", () => {
  assert.strictEqual(seq.computeLoopDuration(120, 1), 2.0);
  assert.strictEqual(seq.computeLoopDuration(120, 4), 8.0);
  assert.strictEqual(seq.computeLoopDuration(60, 2), 8.0);
  assert.strictEqual(seq.computeLoopDuration(140, 4), 4 * 4 * 60 / 140);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/test-sequencer.js`
Expected: FAIL — `Cannot find module '../sequencer.js'`

- [ ] **Step 3: Implement sequencer.js**

```js
// sequencer.js — Genre presets, pattern variation, beat rendering.
// Depends on MarbleSynth (synth.js). Works in browser (global MarbleSequencer) and Node (require).
"use strict";

// Reuse mulberry32 PRNG (same as app.js) for deterministic variations
function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var GENRES = {
  lofi: {
    id: "lofi",
    name: "Lo-fi Hip Hop",
    bpm: 85,
    bars: 4,
    instruments: {
      kick:   { enabled: true, synth: "kick",   params: { decay: 0.35 } },
      snare:  { enabled: true, synth: "snare",  params: { decay: 0.10, tone: 180, filterFreq: 1800 } },
      hihat:  { enabled: true, synth: "hihat",  params: { cutoff: 7000, decay: 0.04 } },
      shaker: { enabled: true, synth: "shaker", params: { cutoff: 3500, decay: 0.07 } },
    },
    pattern: {
      stepsPerBar: 16,
      kick:   [1,0,0,0, 0,0,0.6,0, 1,0,0,0, 0,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0.3],
      hihat:  [0.5,0,0.8,0, 0.5,0,0.8,0, 0.5,0,0.8,0, 0.5,0,0.8,0],
      shaker: [0,0.3,0,0.3, 0,0.3,0,0.3, 0,0.3,0,0.3, 0,0.3,0,0.3],
    }
  },
  techno: {
    id: "techno",
    name: "Techno",
    bpm: 130,
    bars: 4,
    instruments: {
      kick:    { enabled: true, synth: "kick",    params: { decay: 0.25 } },
      snare:   { enabled: true, synth: "clap",    params: { spread: 0.03 } },
      hihat:   { enabled: true, synth: "hihat",   params: { cutoff: 8000, decay: 0.03 } },
      rimshot: { enabled: true, synth: "rimshot",  params: { tone: 800 } },
    },
    pattern: {
      stepsPerBar: 16,
      kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      rimshot: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1],
    }
  },
  trap: {
    id: "trap",
    name: "Trap",
    bpm: 140,
    bars: 4,
    instruments: {
      kick:        { enabled: true, synth: "kick",    params: { decay: 0.60 } },
      snare:       { enabled: true, synth: "clap",    params: { spread: 0.025 } },
      hihat:       { enabled: true, synth: "hihat",   params: { cutoff: 9000, decay: 0.025 } },
      subBass:     { enabled: true, synth: "subBass",  params: { freq: 45, sustain: 0.45 } },
      tripletHats: { enabled: true, synth: "hihat",   params: { cutoff: 10000, decay: 0.02 } },
    },
    pattern: {
      stepsPerBar: 16,
      kick:        [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      snare:       [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:       [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      subBass:     [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      tripletHats: [0,0,0,0.5, 0,0.5,0,0, 0,0,0,0.5, 0,0.5,0,0],
    }
  },
  ambient: {
    id: "ambient",
    name: "Ambient",
    bpm: 70,
    bars: 4,
    instruments: {
      kick:  { enabled: true, synth: "kick",  params: { decay: 0.40 } },
      snare: { enabled: true, synth: "snare", params: { decay: 0.15, tone: 160, filterFreq: 1200 } },
      hihat: { enabled: true, synth: "hihat", params: { cutoff: 6000, decay: 0.06 } },
      pad:   { enabled: true, synth: "pad",   params: { freq: 220, cutoff: 600, attack: 0.8, duration: 0 } },
    },
    pattern: {
      stepsPerBar: 16,
      kick:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      hihat: [0,0,0,0, 0,0,0.4,0, 0,0,0,0, 0,0,0.4,0],
      pad:   [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    }
  }
};

function computeLoopDuration(bpm, bars) {
  return bars * 4 * (60 / bpm);
}

function applyVariation(pattern, seed) {
  var rng = mulberry32(seed);
  var out = { stepsPerBar: pattern.stepsPerBar };
  for (var key in pattern) {
    if (key === "stepsPerBar") continue;
    var src = pattern[key];
    var dst = new Array(src.length);
    for (var i = 0; i < src.length; i++) {
      var isDownbeat = (i % 4 === 0);
      if (isDownbeat) {
        dst[i] = src[i];
      } else if (src[i] > 0) {
        // Jitter velocity ±20%
        var jitter = 1 + (rng() - 0.5) * 0.4;
        dst[i] = Math.max(0.05, Math.min(1.0, src[i] * jitter));
        // Occasionally shift ±1 step (10% chance)
        if (rng() < 0.1 && i > 0 && i < src.length - 1) {
          var dir = rng() < 0.5 ? -1 : 1;
          var target = i + dir;
          if (dst[target] === 0 && target % 4 !== 0) {
            dst[target] = dst[i];
            dst[i] = 0;
          }
        }
      } else {
        // Maybe add ghost note (8% chance)
        dst[i] = rng() < 0.08 ? 0.15 : 0;
      }
    }
    out[key] = dst;
  }
  return out;
}

function renderBeat(genre, bpm, bars, instruments, variationSeed) {
  var Synths = (typeof MarbleSynth !== "undefined") ? MarbleSynth : require("./synth.js");
  var duration = computeLoopDuration(bpm, bars);
  var sampleRate = 44100;
  var numChannels = 2;
  var ctx = new OfflineAudioContext(numChannels, Math.ceil(sampleRate * duration), sampleRate);

  var pattern = variationSeed > 0
    ? applyVariation(genre.pattern, variationSeed)
    : genre.pattern;

  var barDuration = 4 * (60 / bpm);
  var stepsPerBar = pattern.stepsPerBar;
  var stepDuration = barDuration / stepsPerBar;

  for (var instName in genre.instruments) {
    if (!instruments[instName]) continue;
    var inst = genre.instruments[instName];
    var synthFn = Synths[inst.synth];
    if (!synthFn) continue;
    var steps = pattern[instName];
    if (!steps) continue;

    for (var bar = 0; bar < bars; bar++) {
      for (var step = 0; step < stepsPerBar; step++) {
        var velocity = steps[step];
        if (velocity <= 0) continue;
        var time = bar * barDuration + step * stepDuration;
        var params = Object.assign({}, inst.params);
        // For pad, set duration to the full bar
        if (inst.synth === "pad") {
          params.duration = barDuration;
        }
        // Scale gain by velocity
        var gainNode = ctx.createGain();
        gainNode.gain.value = velocity;
        gainNode.connect(ctx.destination);
        synthFn(ctx, gainNode, time, params);
      }
    }
  }

  return ctx.startRendering();
}

var MarbleSequencer = {
  GENRES: GENRES,
  computeLoopDuration: computeLoopDuration,
  applyVariation: applyVariation,
  renderBeat: renderBeat,
  mulberry32: mulberry32
};
if (typeof module !== "undefined") module.exports = MarbleSequencer;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/test-sequencer.js`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sequencer.js test/test-sequencer.js
git commit -m "Add genre presets, pattern variation, and beat sequencer"
```

---

### Task 3: HTML/CSS for Generator UI

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Add source toggle and generator controls to index.html**

Replace the existing audio panel section. Find the `<div class="field audio-field" id="audio-field">` block and replace its contents. The new structure has a source toggle, then two conditional views (file / generator):

In `index.html`, replace the entire `audio-field` div with:

```html
      <div class="field audio-field" id="audio-field">
        <label>Audio</label>
        <div class="audio-source-toggle">
          <button id="source-file" class="btn btn-toggle" type="button">File</button>
          <button id="source-gen" class="btn btn-toggle active" type="button">Beat Generator</button>
        </div>

        <div id="audio-file-view" hidden>
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
          </div>
        </div>

        <div id="audio-gen-view">
          <div class="field">
            <label for="gen-genre">Genre</label>
            <select id="gen-genre">
              <option value="lofi" selected>Lo-fi Hip Hop</option>
              <option value="techno">Techno</option>
              <option value="trap">Trap</option>
              <option value="ambient">Ambient</option>
            </select>
          </div>
          <div class="field">
            <label for="gen-bpm">BPM <span id="gen-bpm-readout" class="audio-readout">85</span></label>
            <input id="gen-bpm" type="range" min="60" max="200" step="1" value="85" />
          </div>
          <div class="field">
            <label for="gen-bars">Bars</label>
            <select id="gen-bars">
              <option value="1">1 bar</option>
              <option value="2">2 bars</option>
              <option value="4" selected>4 bars</option>
              <option value="8">8 bars</option>
            </select>
          </div>
          <div class="field">
            <label>Instruments</label>
            <div class="instrument-toggles" id="instrument-toggles"></div>
          </div>
          <button id="gen-randomize" class="btn" type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M17 3h4v4h-2V6.41l-4.29 4.3-1.42-1.42L17.59 5H17V3Zm-8.71 7.29L4 6V5h1l4.29 4.29-1 1ZM3 19v-4h2v1.59l4.29-4.3 1.42 1.42L6.41 18H7v1H3Zm14 0v2h4v-4h-2v.59l-5.29-5.3-1.42 1.42L17.59 19H17Z"/></svg>
            Randomize Variation
          </button>
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
```

Also add the new script tags — insert before `<script src="vendor/gifenc/gifenc.js">`:
```html
  <script src="synth.js"></script>
  <script src="sequencer.js"></script>
```

- [ ] **Step 2: Add CSS for source toggle and instrument toggles**

Append to `style.css`:

```css
.audio-source-toggle {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.btn-toggle {
  flex: 1;
  padding: 6px 0;
  font-size: 12px;
  text-align: center;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--muted);
  cursor: pointer;
}
.btn-toggle.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.instrument-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.instrument-toggles label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  cursor: pointer;
}
.instrument-toggles input[type="checkbox"] {
  accent-color: var(--accent);
}
```

- [ ] **Step 3: Verify HTML renders correctly**

Open `index.html` in browser. Verify:
- Source toggle shows "File" and "Beat Generator" buttons
- Beat Generator is selected by default, showing genre/BPM/bars/instruments
- File view is hidden
- Clicking "File" shows the file picker, hides generator controls
- No console errors

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "Add source toggle and beat generator UI controls"
```

---

### Task 4: State, Els, and Source Switching in app.js

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Add new els entries**

In the `els` object, add after `audioBadge`:
```js
    sourceFile: $("#source-file"),
    sourceGen: $("#source-gen"),
    audioFileView: $("#audio-file-view"),
    audioGenView: $("#audio-gen-view"),
    genGenre: $("#gen-genre"),
    genBpm: $("#gen-bpm"),
    genBpmReadout: $("#gen-bpm-readout"),
    genBars: $("#gen-bars"),
    genInstrumentToggles: $("#instrument-toggles"),
    genRandomize: $("#gen-randomize"),
```

- [ ] **Step 2: Add new state fields**

In the `state` object, add after `audioPlaying`:
```js
    audioSource: "generator",
    genreId: "lofi",
    genBpm: 85,
    genBars: 4,
    genInstruments: {},
    genVariationSeed: 0,
```

- [ ] **Step 3: Add source switching functions**

After the existing `clearAudioFile()` function, add:

```js
  function setAudioSource(source) {
    stopAudioPreview();
    state.audioSource = source;
    if (source === "file") {
      clearGeneratorState();
      els.audioFileView.hidden = false;
      els.audioGenView.hidden = true;
      els.sourceFile.classList.add("active");
      els.sourceGen.classList.remove("active");
    } else {
      clearAudioFile();
      els.audioFileView.hidden = true;
      els.audioGenView.hidden = false;
      els.sourceFile.classList.remove("active");
      els.sourceGen.classList.add("active");
      generateAndLoadBeat();
    }
    updateExportTooltips();
    syncControlsFromState();
  }

  function clearGeneratorState() {
    state.loopPcmMono = null;
    state.loopPcmStereo = null;
    state.features = null;
  }

  function initGenreDefaults(genreId) {
    var genre = MarbleSequencer.GENRES[genreId];
    if (!genre) return;
    state.genreId = genreId;
    state.genBpm = genre.bpm;
    state.genInstruments = {};
    for (var name in genre.instruments) {
      state.genInstruments[name] = genre.instruments[name].enabled;
    }
  }

  async function generateAndLoadBeat() {
    var genre = MarbleSequencer.GENRES[state.genreId];
    if (!genre) return;
    try {
      var buffer = await MarbleSequencer.renderBeat(
        genre, state.genBpm, state.genBars,
        state.genInstruments, state.genVariationSeed
      );
      state.audioBuffer = buffer;
      state.audioTrackDuration = buffer.duration;

      // Build loop PCM from generated buffer (no slice/crossfade needed)
      var channels = [];
      for (var c = 0; c < buffer.numberOfChannels; c++) {
        channels.push(new Float32Array(buffer.getChannelData(c)));
      }
      state.loopPcmStereo = channels;
      state.loopPcmMono = MarbleAudio.monoFromStereo(channels);

      var dur = MarbleSequencer.computeLoopDuration(state.genBpm, state.genBars);
      var N = Math.round(dur * state.videoFps);
      state.features = MarbleAudio.extractFeatures(state.loopPcmMono, buffer.sampleRate, state.videoFps, N);
      state.animDurationSec = dur;

      syncControlsFromState();
      scheduleRender();
    } catch (err) {
      console.error(err);
      toast("Beat generation failed — try a different browser.");
    }
  }
```

- [ ] **Step 4: Build instrument toggles dynamically**

Add a function to populate the instrument toggle checkboxes:

```js
  function buildInstrumentToggles() {
    var genre = MarbleSequencer.GENRES[state.genreId];
    if (!genre) return;
    var container = els.genInstrumentToggles;
    container.innerHTML = "";
    for (var name in genre.instruments) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!state.genInstruments[name];
      cb.dataset.inst = name;
      cb.addEventListener("change", function () {
        state.genInstruments[this.dataset.inst] = this.checked;
        generateAndLoadBeat();
      });
      var span = document.createElement("span");
      span.textContent = name.replace(/([A-Z])/g, " $1").replace(/^./, function (s) { return s.toUpperCase(); });
      label.appendChild(cb);
      label.appendChild(span);
      container.appendChild(label);
    }
  }
```

- [ ] **Step 5: Wire source toggle and generator event listeners**

After the existing audio event listeners, add:

```js
  els.sourceFile.addEventListener("click", function () { setAudioSource("file"); });
  els.sourceGen.addEventListener("click", function () { setAudioSource("generator"); });

  els.genGenre.addEventListener("change", function (e) {
    initGenreDefaults(e.target.value);
    buildInstrumentToggles();
    syncControlsFromState();
    generateAndLoadBeat();
  });

  els.genBpm.addEventListener("input", function (e) {
    state.genBpm = parseInt(e.target.value, 10) || 85;
    els.genBpmReadout.textContent = String(state.genBpm);
    generateAndLoadBeat();
  });

  els.genBars.addEventListener("change", function (e) {
    state.genBars = parseInt(e.target.value, 10) || 4;
    generateAndLoadBeat();
  });

  els.genRandomize.addEventListener("click", function () {
    state.genVariationSeed = Math.floor(Math.random() * 1000000);
    generateAndLoadBeat();
  });
```

- [ ] **Step 6: Update syncControlsFromState for generator fields**

In `syncControlsFromState`, update the audio controls section to handle both modes. Replace the existing audio controls block with:

```js
    // Audio source toggle
    var isGen = state.audioSource === "generator";
    els.sourceFile.classList.toggle("active", !isGen);
    els.sourceGen.classList.toggle("active", isGen);
    els.audioFileView.hidden = isGen;
    els.audioGenView.hidden = !isGen;

    if (isGen) {
      els.genGenre.value = state.genreId;
      els.genBpm.value = state.genBpm;
      els.genBpmReadout.textContent = String(state.genBpm);
      els.genBars.value = state.genBars;
    }

    // Audio badge
    var hasAudio = !!(state.features);
    els.audioBadge.hidden = !hasAudio;
    if (hasAudio && isGen) {
      var genre = MarbleSequencer.GENRES[state.genreId];
      els.audioBadge.textContent = "\u266B " + (genre ? genre.name : "beat");
    } else if (hasAudio) {
      els.audioBadge.textContent = "\u266B audio";
    }

    // File mode controls (only if in file mode)
    if (!isGen) {
      var hasFile = !!state.audioFile;
      els.audioControls.hidden = !hasFile;
      els.audioClear.hidden = !hasFile;
      els.audioFileName.textContent = hasFile ? state.audioFile.name : "No file";
      if (hasFile && state.audioTrackDuration > 0) {
        var maxStart = Math.max(0, state.audioTrackDuration - state.animDurationSec);
        els.audioStart.max = maxStart;
        els.audioStart.value = state.audioStart;
        els.audioStartReadout.textContent = formatTime(state.audioStart);
      }
    }

    els.audioReactivity.value = state.reactivity;
    els.audioReactivityReadout.textContent = state.reactivity.toFixed(2);
```

- [ ] **Step 7: Update export filename for generator mode**

In `exportMP4`, find the filename line and change:
```js
      var suffix = state.features ? (state.audioSource === "generator" ? "_" + state.genreId : "_audio") : "";
```

- [ ] **Step 8: Initialize generator on boot**

At the bottom of the boot section (after `writeURL();`, before the closing `})()`), add:
```js
  // Initialize generator defaults only if URL didn't already set instruments
  if (Object.keys(state.genInstruments).length === 0) {
    initGenreDefaults(state.genreId);
  }
  buildInstrumentToggles();
  if (state.audioSource === "generator") {
    generateAndLoadBeat();
  }
```
This must run AFTER `loadFromURL()` so URL params take precedence over defaults.

- [ ] **Step 9: Verify full flow in browser**

Open in browser. Verify:
- Beat Generator is selected by default
- Genre dropdown shows Lo-fi Hip Hop
- BPM slider shows 85
- Instrument toggles appear for kick, snare, hi-hat, shaker
- Click Play — beat plays, visuals react
- Switch to File mode — generator controls hide, file picker shows
- Switch back — generator controls reappear
- No console errors

- [ ] **Step 10: Commit**

```bash
git add app.js
git commit -m "Wire beat generator state, source toggle, and pipeline integration"
```

---

### Task 5: URL Persistence for Generator Params

**Files:**
- Modify: `app.js` (`writeURL` and `loadFromURL` functions)

- [ ] **Step 1: Add generator params to writeURL**

In `writeURL()`, add after the existing `reactivity` serialization:
```js
    if (state.audioSource === "generator") {
      p.set("audioSource", "gen");
      p.set("genre", state.genreId);
      p.set("bpm", String(state.genBpm));
      p.set("bars", String(state.genBars));
      var enabledInst = [];
      for (var name in state.genInstruments) {
        if (state.genInstruments[name]) enabledInst.push(name);
      }
      p.set("inst", enabledInst.join(","));
      if (state.genVariationSeed > 0) p.set("var", String(state.genVariationSeed));
    }
```

- [ ] **Step 2: Add generator params to loadFromURL**

In `loadFromURL()`, add at the end (after the existing reactivity parsing):
```js
    var audioSrc = p.get("audioSource");
    if (audioSrc === "gen") {
      state.audioSource = "generator";
      var genre = p.get("genre");
      if (genre && MarbleSequencer.GENRES[genre]) {
        state.genreId = genre;
        initGenreDefaults(genre);
      }
      var bpm = parseInt(p.get("bpm") || "", 10);
      if (Number.isFinite(bpm) && bpm >= 60 && bpm <= 200) state.genBpm = bpm;
      var bars = parseInt(p.get("bars") || "", 10);
      if ([1, 2, 4, 8].indexOf(bars) >= 0) state.genBars = bars;
      var instStr = p.get("inst") || "";
      if (instStr) {
        var instList = instStr.split(",");
        for (var name in state.genInstruments) state.genInstruments[name] = false;
        for (var i = 0; i < instList.length; i++) {
          if (state.genInstruments.hasOwnProperty(instList[i])) {
            state.genInstruments[instList[i]] = true;
          }
        }
      }
      var varSeed = parseInt(p.get("var") || "0", 10);
      if (Number.isFinite(varSeed)) state.genVariationSeed = varSeed;
    } else if (audioSrc === "file") {
      state.audioSource = "file";
    }
```
Note: `initGenreDefaults(genre)` inside this block sets all instruments to defaults, then the `inst` param overrides which are enabled. `buildInstrumentToggles()` is called in the boot sequence (Task 4, Step 8) which runs after `loadFromURL()`, so the UI will be in sync.

- [ ] **Step 3: Verify URL persistence**

Generate a beat with Techno, 130 BPM, 4 bars, variation seed. Share the URL. Reload — verify the exact same beat plays.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Persist beat generator params in URL for sharing"
```

---

### Task 6: Edge Cases and Error Handling

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Handle OfflineAudioContext unavailability**

Near the existing AudioContext capability gate, add:
```js
  if (typeof OfflineAudioContext === "undefined") {
    els.sourceGen.hidden = true;
    if (state.audioSource === "generator") setAudioSource("file");
  }
```

- [ ] **Step 2: Clamp bars when BPM + bars would exceed 30s**

In the `genBpm` input listener and `genBars` change listener, add after updating state:
```js
    var dur = MarbleSequencer.computeLoopDuration(state.genBpm, state.genBars);
    if (dur > 30) {
      while (state.genBars > 1 && MarbleSequencer.computeLoopDuration(state.genBpm, state.genBars) > 30) {
        state.genBars = Math.floor(state.genBars / 2);
      }
      els.genBars.value = state.genBars;
      toast("Bars reduced to fit within 30-second limit.");
    }
```

- [ ] **Step 3: Update share toast for generator mode**

In the share click listener, update the audio-mode check to differentiate:
```js
    if (state.audioSource === "file" && state.audioFile) {
      toast("Share captures visual settings but not the audio file — export the MP4 to share with audio.");
      writeURL();
      try { await navigator.clipboard.writeText(location.href); } catch (_) {}
      return;
    }
```

(Generator mode shares everything via URL — no toast needed, falls through to normal share behavior.)

- [ ] **Step 4: Update GIF/MP4 tooltips for generator mode**

Update `updateExportTooltips`:
```js
  function updateExportTooltips() {
    var hasAudio = !!(state.features);
    if (state.audioSource === "generator" && hasAudio) {
      els.exportGif.title = "Export looping GIF (silent — GIF has no audio)";
      els.exportMp4.title = "Export looping MP4 with generated beat";
    } else if (state.audioSource === "file" && state.audioFile) {
      els.exportGif.title = "Export looping GIF (silent — GIF has no audio)";
      els.exportMp4.title = "Export looping MP4 with embedded audio";
    } else {
      els.exportGif.title = "Export looping GIF at 24 fps";
      els.exportMp4.title = "Export looping MP4 video at the selected frame rate";
    }
  }
```

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Add edge case handling for beat generator"
```

---

### Task 7: Manual QA

**Files:** None (verification only)

- [ ] **Step 1: Silent mode regression**

Remove all audio state (no file, switch to file mode with no file loaded). Verify all existing features work: seed, presets, scale, invert, palette, PNG download, GIF export, MP4 export, share.

- [ ] **Step 2: Beat generator full flow**

1. Page loads with Beat Generator selected and Lo-fi Hip Hop genre
2. Click Play — hear lo-fi beat, see reactive visuals
3. Switch to Techno — BPM jumps to 130, instruments change (rimshot appears), pattern sounds different
4. Toggle kick off — kick disappears from audio
5. Adjust BPM slider to 100 — tempo slows
6. Click Randomize Variation — pattern shifts subtly
7. Switch to Trap — sub bass and triplet hats extras appear
8. Switch to Ambient — sparse pattern, pad sustained
9. Set bars to 8 — longer loop
10. Export MP4 — audio embedded, filename has genre
11. Export GIF — silent, visual reactivity present

- [ ] **Step 3: Source switching**

1. In generator mode, click Play
2. Switch to File mode — audio stops, file picker appears
3. Load an MP3 — existing file flow works
4. Switch back to generator — file is cleared, beat regenerates

- [ ] **Step 4: URL sharing in generator mode**

1. Configure Techno, 145 BPM, 2 bars, only kick + hihat enabled, randomize a variation
2. Click Share — URL is copied (no "file not in URL" toast)
3. Open URL in new tab — exact same beat plays

- [ ] **Step 5: Edge cases**

- Toggle all instruments off → silence, no crash
- BPM at 200, 8 bars → verify bars clamp if > 30s
- Verify each genre's instruments toggle on/off correctly

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "QA fixes for beat generator"
```
