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
