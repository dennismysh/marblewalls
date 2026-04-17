"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const synths = require("../synth.js");

test("All synth recipes are functions", () => {
  const names = ["kick", "snare", "hihat", "clap", "subBass", "shaker", "pad", "rimshot"];
  for (const name of names) {
    assert.strictEqual(typeof synths[name], "function", `synths.${name} should be a function`);
  }
});

test("Synth functions accept (ctx, dest, time, params) signature", () => {
  const names = ["kick", "snare", "hihat", "clap", "subBass", "shaker", "pad", "rimshot"];
  for (const name of names) {
    assert.ok(synths[name].length >= 3, `synths.${name} should accept at least 3 args, got ${synths[name].length}`);
  }
});
