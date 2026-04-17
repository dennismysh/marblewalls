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
