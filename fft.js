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
