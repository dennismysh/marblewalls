# Programmatic Beat Generator

**Date:** 2026-04-16
**Status:** Approved (pending implementation plan)

## Summary

Add a built-in beat generator to Marble Walls that synthesizes drum patterns across multiple genres using pure Web Audio oscillators and noise. Users pick a genre, toggle instruments on/off, adjust BPM, and randomize variations — all driving the existing audio-reactive visual pipeline. Complements the existing file-upload path as a second audio source. Generated beats loop sample-perfectly (no crossfade needed) and all parameters are URL-serializable for sharing.

## Decisions

| Question | Choice |
|----------|--------|
| Relationship to file upload | Complement — both sources available via toggle |
| Synthesis approach | Pure Web Audio (oscillators, noise, filters) — no samples |
| Genre model | Preset = pattern + sound palette + BPM, all editable |
| Genre count | 4 for MVP: Lo-fi Hip Hop, Techno, Trap, Ambient |
| Instrument layers | 3 universal (kick/snare/hat) + 1-2 genre extras |
| Pipeline integration | Render to buffer via OfflineAudioContext, then existing pipeline |
| Controls | Genre, instrument toggles, BPM, randomize variation |
| Loop precision | Sample-perfect (no crossfade); duration in bars, not seconds |

## User Flow

### Audio Source Switching

The Audio panel gains a source toggle at the top: **File** | **Beat Generator**. Defaults to Beat Generator.

- **File mode**: identical to current shipped behavior (file picker, start offset, reactivity, play/pause).
- **Beat Generator mode**: replaces the file picker area with generator controls.
- Switching sources clears the other source's state (file → generator clears audioFile/audioBuffer; generator → file clears generated buffer and features).
- Switching genres resets `genInstruments` to the new genre's default enabled set and `genBpm` to the new genre's default BPM.

### Beat Generator Controls

- **Genre dropdown**: Lo-fi Hip Hop, Techno, Trap, Ambient.
- **BPM slider**: 60–200, step 1. Overrides genre default.
- **Bars dropdown**: 1, 2, 4, 8 bars. Replaces the seconds-based duration dropdown in generator mode. Actual loop duration = `bars × 4 × (60 / BPM)` seconds.
- **Instrument toggles**: 3 core (Kick, Snare, Hi-Hat) always visible. 1–2 genre-specific extras appear when that genre is selected.
- **Randomize Variation button**: re-rolls the pattern within genre rules (different fills, slight placement shifts), keeping instruments/BPM the same. Uses a numeric variation seed for reproducibility.
- **Reactivity slider**: shared with file mode.
- **Play / Pause**: shared with file mode.

### Genre-Specific Instruments

| Genre | Core (always) | Extras |
|-------|--------------|--------|
| Lo-fi Hip Hop (85 BPM) | Kick, Snare, Hi-Hat | Shaker |
| Techno (130 BPM) | Kick, Snare (clap), Hi-Hat | Rimshot |
| Trap (140 BPM) | Kick, Snare (clap), Hi-Hat | Sub Bass, Triplet Hats |
| Ambient (70 BPM) | Kick, Snare, Hi-Hat | Pad |

## Architecture

### Synth Engine

Each instrument is a stateless function: `(audioCtx, destination, time, params) → void`. It schedules Web Audio nodes at the given time. No persistent state — fire and forget.

| Instrument | Technique |
|-----------|-----------|
| **Kick** | Sine oscillator with exponential frequency sweep (150 Hz → 40 Hz over ~200 ms) + gain envelope (fast attack, ~300 ms decay). Trap variant: longer decay (~600 ms) for sub-bass tail. |
| **Snare** | White noise burst (~100 ms) through bandpass filter (1–3 kHz) + short sine tone (~200 Hz, ~50 ms). Mix ratio and filter freq set character. |
| **Hi-Hat** | White noise through highpass filter (7–10 kHz), very short envelope (~30 ms closed, ~120 ms open). |
| **Clap** | Multiple noise bursts in quick succession (~3 bursts over 30 ms) through bandpass. Used as "snare" in Techno and Trap. |
| **Sub Bass** | Sine at root note (~45 Hz), long sustain (~400 ms). Trap extra — acts as 808 sub under the kick. |
| **Shaker** | Filtered noise with gentler envelope than hi-hat, lower highpass cutoff (~4 kHz), shuffled timing. Lo-fi extra. |
| **Pad** | Two detuned oscillators (saw/triangle) through low-pass filter, slow attack (~500 ms), long release. Sustained across the bar. Ambient extra. |
| **Rimshot** | Short triangle oscillator burst (~800 Hz) + noise click, very fast decay (~20 ms). Techno extra. |
| **Triplet Hats** | Same synth as hi-hat but patterned in triplet subdivisions. Trap extra. |

### Genre Preset Data Structure

```js
{
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
}
```

16 steps per bar (16th notes). Values are velocities (0 = off, 0.1–1.0 = hit strength) for subtle dynamics.

### Variation Randomizer

Uses a seeded PRNG (reuse the existing `mulberry32`). Given a genre preset and variation seed:
- Shuffle velocities on non-downbeat steps (±20% amplitude jitter).
- Occasionally shift non-core hits by ±1 step.
- Add/remove ghost notes (very low velocity ~0.15) on empty steps.
- Downbeats (step 0, 4, 8, 12) are never moved — they anchor the groove.
- Same seed always produces the same variation.

### Beat Rendering

1. Create `OfflineAudioContext` at 44100 Hz, duration = `bars × 4 × (60 / BPM)` seconds.
2. For each enabled instrument, walk the pattern (repeated for N bars). At each active step, schedule the synth function at the exact sample time: `stepTime = bar * barDuration + step * (barDuration / stepsPerBar)`.
3. Call `startRendering()` → returns `AudioBuffer`.
4. Buffer is sample-perfect looping by construction (pattern repeats exactly, all synth tails decay within one step). No crossfade needed.

Render time: ~50–100 ms for a 4-bar loop at 44.1 kHz on modern hardware.

### Pipeline Integration

The rendered `AudioBuffer` enters the existing audio pipeline at the same point a decoded file would:

1. `renderBeat()` produces an `AudioBuffer`.
2. `rebuildAudioLoop()` detects the source:
   - **File mode**: slice → crossfade → mono collapse → extract features.
   - **Beat Generator mode**: skip slice/crossfade → mono collapse → extract features.
3. `state.loopPcmMono`, `state.loopPcmStereo`, `state.features` are populated.
4. From here, everything downstream is identical: live preview, GIF export, MP4 export with embedded audio.

The pipeline doesn't know or care about the source. One buffer format, one feature table, one export path.

**Re-render triggers:** Genre change, instrument toggle, BPM change, bars change, variation randomized. NOT triggered by seed/scale/palette/invert.

### Export

- **MP4**: video frames driven by `Features[N]` + AAC audio from stereo loop buffer. Filename: `marblewalls_<seed>_<WxH>_<dur>s_<fps>fps_<genre>.mp4`.
- **GIF**: silent, feature-driven visuals only.

## UI Changes

### Source Toggle

Replace the current audio panel's fixed file-picker layout with a toggled view:

```
Audio source:  [File] [Beat Generator]

--- Beat Generator selected: ---
Genre       [Lo-fi Hip Hop ▼]
BPM         [====|=========]  85
Bars        [4 ▼]

Instruments:
  [✓] Kick    [✓] Snare    [✓] Hi-Hat    [✓] Shaker

  [Randomize Variation]

Reactivity  [===|=========]  1.00
[Play] [Pause]
```

### Duration Handling

- **File mode**: existing seconds-based duration dropdown (2/4/6/8/12/16 s).
- **Beat Generator mode**: bars dropdown (1, 2, 4, 8). Actual duration computed from `bars × 4 × 60/BPM`.

### Stage Meta Badge

When generator mode is active, the badge shows: `♪ techno` (genre name instead of generic "audio").

## State

New fields in the `state` object:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `audioSource` | `"file" \| "generator"` | `"generator"` | Which audio source is active |
| `genreId` | `string` | `"lofi"` | Selected genre preset ID |
| `genBpm` | `number` | `85` | BPM (from genre default, overridable) |
| `genBars` | `number` | `4` | Loop length in bars |
| `genInstruments` | `{ [name]: boolean }` | All enabled per genre | Which instruments are on |
| `genVariationSeed` | `number` | `0` | Seed for pattern variation |

## URL Persistence

In generator mode, all beat params are URL-serializable:

```
?audioSource=gen&genre=techno&bpm=130&bars=4&inst=kick,snare,hihat,rimshot&var=42
```

Shared links fully reproduce the exact beat — no file needed. Combined with existing visual params (seed, scale, palette, etc.), a URL captures the complete audio-visual experience.

In file mode, existing URL behavior is unchanged (audioStart, reactivity are serialized; file is not).

## Error Handling

| Condition | Response |
|-----------|----------|
| OfflineAudioContext render fails | Toast: "Beat generation failed — try a different browser" |
| Genre preset has missing instrument keys | Skip missing keys, render what exists |
| BPM + bars produces duration > 30s | Clamp bars down and toast "Bars reduced to fit" |
| OfflineAudioContext unavailable | Hide Beat Generator tab, default to File mode |
| All instruments toggled off | Render silent buffer. Features are zeros. Visuals static. |

## Testing

### Unit Tests (node-runnable)

- **Synth recipes**: render each synth to an OfflineAudioContext, verify buffer is non-silent (RMS > threshold) and spectral energy matches expected band (kick → bass, hi-hat → treble).
- **Pattern sequencer**: given genre + bars + BPM, verify output buffer has correct duration (±1 sample), is non-silent, has amplitude peaks at expected step timestamps.
- **Variation randomizer**: same genre + two different seeds → different patterns. Same seed → identical pattern. Downbeats are never moved.
- **Integration**: generated buffer passes through feature extraction and produces non-trivial `Features[N]` (not all zeros, bass/treble have distinct profiles).

### Manual QA Checklist

- [ ] Select each genre — instruments update, pattern sounds distinct
- [ ] Toggle each instrument on/off — sound changes accordingly
- [ ] BPM slider affects tempo audibly
- [ ] Randomize Variation produces a different-sounding pattern
- [ ] Same variation seed reproduces the same pattern
- [ ] Switch File → Generator and back — clean state transitions
- [ ] Export MP4 in generator mode — audio track embedded, genre in filename
- [ ] GIF export in generator mode — silent, visual reactivity present
- [ ] Share URL in generator mode — URL contains all beat params
- [ ] Open shared URL — beat reproduces exactly
- [ ] All instruments off — silent, no crash, visuals static
- [ ] Silent mode (no audio source) — all existing functionality unchanged

## Implementation Order

1. Synth engine module (pure functions, unit-testable, no DOM)
2. Genre preset data (4 presets with patterns and synth params)
3. Pattern sequencer + OfflineAudioContext rendering
4. Variation randomizer using seeded PRNG
5. UI: source toggle, genre dropdown, BPM slider, bars dropdown, instrument toggles, randomize button
6. Pipeline integration (rebuildAudioLoop detects source, skip crossfade for generator)
7. URL persistence for generator params
8. Edge cases, error handling, state transitions
9. Manual QA + sound tuning
