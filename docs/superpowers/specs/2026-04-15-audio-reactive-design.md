# Audio-Reactive Looping Wallpapers

**Date:** 2026-04-15
**Status:** Approved (pending implementation plan)

## Summary

Add audio-reactive visuals to Marble Walls. Users load an audio file, pick a loop slice, and the generative marble pattern reacts to bass, mid, treble, and beat energy in real time. The exported MP4 contains both the audio-synced video and the embedded audio track, looping seamlessly.

Silent mode (no audio file loaded) is completely unchanged.

## Decisions

| Question | Choice |
|----------|--------|
| Primary mode | Live preview + offline render |
| Audio input | File only (no microphone) |
| Reactivity depth | Three-band (bass/mid/treble) + beat detection |
| Loop behavior | Audio loops with visuals; no linear/full-song mode |
| Loop smoothness | Equal-power crossfade at seam + user-picked start offset |
| Audio UI | Minimal: file picker, start-offset slider, reactivity slider |
| Waveform display | Deferred; slider is sufficient for MVP |

## User Flow

### Silent Mode (unchanged)

No audio file loaded. All existing controls (seed, size, palette, scale, invert, duration, fps) behave identically. Export produces silent looping GIF or MP4.

### Audio Mode

1. User drops/picks an audio file (MP3, WAV, OGG, M4A).
2. App enters audio mode. New controls appear in an **Audio** panel section:
   - **File** display with a clear/remove button.
   - **Start offset** slider: `0` to `trackDuration - loopDuration`, step 10 ms, with a time readout (e.g. `1:23.40`).
   - **Reactivity** slider: `0.0` to `1.5` (0 = no reactivity / silent-mode feel, 1.0 = normal, 1.5 = punchier). Single knob; per-band tuning deferred.
   - **Play / Pause** button for live preview.
3. The existing **duration dropdown** (2, 4, 6, 8 s) defines the audio loop length. Two new options are added: **12 s** and **16 s** (longer loops suit more musical contexts).
4. Live preview: plays the crossfaded audio loop and renders the marble animation synced to the audio features at display refresh rate.
5. Export:
   - **MP4**: one loop period with embedded audio track. Filename: `marblewalls_<seed>_<WxH>_<dur>s_<fps>fps_audio.mp4`.
   - **GIF**: silent (GIF has no audio container). Still available; tooltip clarifies.
6. A small `♪` badge appears in `stage-meta` when audio mode is active.

## Architecture

### Audio Decode & Loop Slice

1. Read file as `ArrayBuffer`, decode via `AudioContext.decodeAudioData` into a stereo `AudioBuffer`.
2. Collapse to mono for feature extraction (average L+R). Keep stereo for playback/export.
3. Extract the slice `[start, start + loopDuration]` from the decoded PCM.
4. Apply a **30 ms equal-power crossfade** at the seam: the last 30 ms fades out via `cos(pi * t / 2T)` while the first 30 ms of the loop fades in via `sin(pi * t / 2T)`. Result: a buffer that loops sample-perfectly clean when `AudioBufferSourceNode.loop = true`.
5. This crossfaded buffer is the single source of truth for playback, feature extraction, and the exported audio track.

### Feature Extraction (Pre-computed)

All features are derived from the crossfaded mono loop buffer before either playback or export begins.

**FFT**: Vendor a ~300-line Cooley-Tukey radix-2 FFT. No external dependencies. 2048-sample Hann window, hop size = `sampleRate / fps`.

**Per-frame features** (for each visual frame `i` in `[0, N)` where `N = duration * fps`):

| Feature | Derivation | Band |
|---------|------------|------|
| `bass` | Sum of FFT magnitudes | 20-250 Hz |
| `mid` | Sum of FFT magnitudes | 250-4000 Hz |
| `treble` | Sum of FFT magnitudes | 4000-20000 Hz |
| `beat` | Spectral-flux onset detection (sum of positive bin deltas vs. moving-average threshold), peak-held | Full spectrum |

All values are normalized to `[0, 1]` relative to the track's own dynamic range.

**Smoothing**: Single-pole exponential moving average per feature:
- Bass: ~80 ms time constant (slow, organic swell)
- Mid: ~40 ms (responsive but not twitchy)
- Treble: ~40 ms
- Beat: ~150 ms decay from peak (fast attack, slow release)

**Two-pass loop stabilization**: Run the extractor over **2N frames** (two consecutive loop periods). Discard the first N frames. The second pass's smoother states have converged to the loop-stable fixed point, guaranteeing `features[0] == features[N]` within float epsilon.

**Output**: `Features[N]` array — one `{ bass, mid, treble, beat }` per visual frame. Both live preview and offline render read from this same array.

**Re-extraction triggers**: File change, start-offset change, duration change, fps change. Not triggered by seed/scale/palette/invert (those don't affect audio).

### Visual Mapping

All modulation is computed in JS before calling the existing `render()`. The shader gets **one new float uniform** (`u_colorBias`); all other modulation feeds into existing inputs.

Given per-frame features and user `reactivity` setting:

```
radius_i    = ANIM_RADIUS + 0.25 * bass_i * reactivity       // 0.35 base -> 0.10..0.80 range
scale_i     = state.scale * (1 + 0.08 * mid_i * reactivity)  // +/- 8% breathing
phaseKick_i = 0.15 * beat_i * reactivity                     // extra orbit phase offset
colorBias_i = 0.30 * treble_i * reactivity                   // additive term before palette lookup
```

**Function signature changes**:
- `animatedOffsets(base, i, N, radius, phaseOffset)` — add optional `phaseOffset` (default 0) added to the current `t = 2*pi*i/N` term.
- `render(gl, loc, w, h, offsets, scale, invert, paletteOpts, colorBias)` — add `colorBias` (default 0). Maps to new uniform `u_colorBias`.
- `renderFrames` loop: when features array is present, compute per-frame modulated values; when absent, identical to current behavior (silent mode).

### Live Preview

**Audio transport**: `AudioBufferSourceNode` created from the crossfaded stereo buffer with `loop = true`. Connected to `AudioContext.destination` for playback.

**Render loop**: On Play, start a `requestAnimationFrame` loop:
```
t = (audioCtx.currentTime - playStartTime) % loopDuration
frameF = t * fps                         // fractional frame index
i = Math.floor(frameF) % N
alpha = frameF - Math.floor(frameF)
feat = lerp(features[i], features[(i+1) % N], alpha)
// -> compute radius, scale, phaseKick, colorBias from feat
// -> render
```

On Pause: cancel rAF, stop audio source, leave last frame visible.
On audio-mode exit: tear down rAF loop, restore existing `scheduleRender` behavior.

Interpolation between feature frames means live preview runs at display refresh rate (typically 60 Hz) even when export fps is 24 or 30. The reactivity character matches export exactly (same feature table); live is just temporally smoother.

### Offline Render (MP4 Export with Audio)

**Video path**: Exactly today's `renderFrames` loop. For each frame `i`, look up `features[i]` (discrete, no interpolation), compute modulated values, render.

**Audio path** (new):
1. Encode the crossfaded stereo PCM via WebCodecs `AudioEncoder` (AAC-LC, ~192 kbps, 44.1 kHz).
2. Chunk the PCM into 1024-sample AAC frames, wrap as `AudioData` with ascending timestamps.
3. Forward `EncodedAudioChunk` from `AudioEncoder.output` to `muxer.addAudioChunk`.
4. Muxer config gains: `audio: { codec: "aac", numberOfChannels: 2, sampleRate: 44100 }`.

Video and audio encoding run in parallel; the muxer interleaves at `finalize()`.

**AudioEncoder fallback**: If `AudioEncoder` is not available (older Firefox), export a silent MP4 and toast "Audio track requires Chrome/Edge or Safari 16.4+."

### Shader Change

One new uniform added to the fragment shader:

```glsl
uniform float u_colorBias;
```

Applied as an additive term to the sine-palette lookup argument, just before the final `sin()` calls that produce RGB. When `u_colorBias = 0` (silent mode), output is bit-identical to current behavior.

## UI Additions

### New Audio Panel Section

Inserted between the existing palette section and the animation section:

```
Audio
  [Choose File] filename.mp3 [x]
  Start offset  [=====|==========]  1:23.40
  Reactivity    [===|=============]  0.85
  [Play] [Pause]
```

The entire section is hidden when no file is loaded. File input also accepts drag-and-drop on the preview canvas area.

### Duration Dropdown Extension

Add `12 s` and `16 s` options (available in both silent and audio modes):

```html
<option value="12">12 s</option>
<option value="16">16 s</option>
```

### Stage Meta Badge

When audio mode is active, add a badge after the existing seed/size badges:

```html
<span class="badge">♪ audio</span>
```

## State

New fields in the `state` object:

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `audioFile` | `File \| null` | `null` | The loaded audio file object |
| `audioBuffer` | `AudioBuffer \| null` | `null` | Decoded audio (cached) |
| `loopBuffer` | `AudioBuffer \| null` | `null` | Crossfaded loop slice (stereo) |
| `features` | `Features[] \| null` | `null` | Pre-computed per-frame features |
| `audioStart` | `number` | `0` | Start offset in seconds |
| `reactivity` | `number` | `1.0` | Audio-to-visual gain multiplier |
| `audioPlaying` | `boolean` | `false` | Live transport state |

These fields are not URL-serializable (audio file can't be in a URL). Share links in audio mode encode `audioStart`, `reactivity`, and all visual params, but not the file. A toast explains this when sharing.

## Error Handling

| Condition | Response |
|-----------|----------|
| Unsupported file type / decode failure | Toast: "Couldn't decode this file — try MP3, WAV, OGG, or M4A" |
| Track > 10 minutes | Toast: "Audio files longer than 10 minutes aren't supported" |
| `start + loopDuration > trackLength` | Clamp start, toast "Start offset clamped to fit loop" |
| `AudioEncoder` unavailable | Silent MP4 fallback + toast explaining browser requirement |
| `decodeAudioData` unavailable (ancient browser) | Disable audio mode; file input shows "Audio requires a modern browser" |
| WebGL context loss during audio-mode render | Same handling as silent mode (existing) |

## Testing

### Unit Tests (node-runnable, no framework)

- **FFT correctness**: Feed a pure 440 Hz sine, verify peak at bin closest to 440 Hz.
- **Band summation**: 200 Hz sine should peak `bass`, near-zero `mid`/`treble`.
- **Equal-power crossfade**: Assert continuity at seam (sample N-1 to sample 0 delta < epsilon) and RMS preservation through the crossfade window.
- **Two-pass convergence**: After 2N frames of smoothing, `features[0]` and `features[N]` differ by < 1e-4 for each field.

### Integration Tests

Three short canned audio clips committed to `test-fixtures/`:
- `bass-heavy.mp3` — sub-heavy loop
- `treble-heavy.mp3` — hi-hat / cymbal loop
- `beat-heavy.mp3` — kick-snare pattern

Verify feature extraction produces expected envelope shapes (bass-heavy clip has highest `bass` mean, etc.).

### Manual QA Checklist

- [ ] Load audio file; verify controls appear and badge shows
- [ ] Drag start offset; verify playback restarts from new position
- [ ] Play/pause works; visuals react in sync with audio
- [ ] Reactivity slider at 0 looks identical to silent mode
- [ ] Reactivity slider at 1.5 produces visibly stronger motion
- [ ] Export MP4 with audio; verify audio track plays in VLC and QuickTime
- [ ] Exported MP4 loops cleanly (no pop at seam) in a player set to repeat
- [ ] Live preview and exported MP4 look visually consistent
- [ ] GIF export in audio mode produces a silent GIF (no crash)
- [ ] Remove audio file; app returns to silent mode fully
- [ ] Silent mode regression: all existing functionality unchanged
- [ ] Share link in audio mode shows explanatory toast
- [ ] Unsupported browser (Firefox without AudioEncoder): silent MP4 + toast

## Implementation Order

1. Vendor FFT + write feature extractor as a pure module (unit-testable, no DOM)
2. Audio decode + loop-slice + equal-power crossfade helper (unit-testable)
3. Extend `render`/`animatedOffsets`/`renderFrames` to accept optional per-frame modulation; regression-verify silent mode
4. Live preview rAF loop + AudioBufferSourceNode transport + play/pause wiring
5. MP4 audio track via AudioEncoder + muxer audio config
6. UI: file input, start-offset slider, reactivity slider, extended duration options, play button, badge
7. Edge cases, capability gates, share UX, error toasts
8. Manual QA + polish
