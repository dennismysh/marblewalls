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
