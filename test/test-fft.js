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
  assert.ok(w[N / 2] > 0.999, "Middle should be ~1");
  for (let i = 0; i < N / 2; i++) {
    assert.ok(Math.abs(w[i] - w[N - 1 - i]) < 1e-10, `Symmetry at ${i}`);
  }
});
