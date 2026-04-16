"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
globalThis.MarbleFft = require("../fft.js");
const { extractFeatures, crossfadeLoop, monoFromStereo, sliceBuffer } = require("../audio.js");

test("200 Hz sine: bass dominates treble (distant bands)", () => {
  const sr = 44100;
  const dur = 1;
  const N = 24;
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(2 * Math.PI * 200 * i / sr);
  }
  const feat = extractFeatures(samples, sr, 24, N);
  const avgBass = mean(feat.bass);
  const avgTreb = mean(feat.treble);
  assert.ok(avgBass > avgTreb, `Bass (${avgBass}) should exceed treble (${avgTreb})`);
});

test("8000 Hz sine: treble dominates bass (distant bands)", () => {
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
  assert.ok(avgTreb > avgBass, `Treble (${avgTreb}) should exceed bass (${avgBass})`);
});

test("Two-pass convergence: loop seam is smooth", () => {
  const sr = 44100;
  const dur = 1;
  const N = 24;
  const samples = new Float32Array(sr * dur);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin(2 * Math.PI * 200 * i / sr) + 0.3 * Math.sin(2 * Math.PI * 5000 * i / sr);
  }
  const feat = extractFeatures(samples, sr, 24, N);
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
  const sr = 100;
  const samples = new Float32Array(500);
  for (let i = 0; i < 500; i++) samples[i] = i;
  const slice = sliceBuffer(samples, sr, 1.0, 2.0);
  assert.strictEqual(slice.length, 200);
  assert.strictEqual(slice[0], 100);
  assert.strictEqual(slice[199], 299);
});

function mean(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
