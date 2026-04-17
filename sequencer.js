// sequencer.js — Genre presets, pattern variation, beat rendering.
// Depends on MarbleSynth (synth.js). Works in browser (global MarbleSequencer) and Node (require).
"use strict";

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
    id: "lofi", name: "Lo-fi Hip Hop", bpm: 85, bars: 4,
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
    id: "techno", name: "Techno", bpm: 130, bars: 4,
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
    id: "trap", name: "Trap", bpm: 140, bars: 4,
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
    id: "ambient", name: "Ambient", bpm: 70, bars: 4,
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
        var jitter = 1 + (rng() - 0.5) * 0.4;
        dst[i] = Math.max(0.05, Math.min(1.0, src[i] * jitter));
        if (rng() < 0.1 && i > 0 && i < src.length - 1) {
          var dir = rng() < 0.5 ? -1 : 1;
          var target = i + dir;
          if (dst[target] === 0 && target % 4 !== 0) {
            dst[target] = dst[i];
            dst[i] = 0;
          }
        }
      } else {
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
        if (inst.synth === "pad") {
          params.duration = barDuration;
        }
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
