# Resonance Cascades v2

**Half-resolution acoustic cascade with physically-motivated spectral tilt and per-source reverb**

---

## 1. Motivation

The v1 approach threads two acoustic channels (HF, LF) through every stage of the visual HRC pipeline: wider ray entries, wider merge entries, additional fluence buffers, a screen-resolution gather pass, and atomic accumulators. This adds ~50–80% to cascade compute time and makes every shader more complex.

The v2 approach runs a **separate half-resolution acoustic cascade** alongside the visual cascade, sharing only the world texture and material texture as inputs. The visual pipeline is completely unmodified. The acoustic cascade is structurally simpler (two scalars instead of RGB), physically better motivated (wall thickness emerges from resampling rather than tuned constants), and provides per-source reverb estimation through additional quarter-resolution bounce passes.

---

## 2. Architecture Overview

```
Visual GI cascade (UNCHANGED)
  - Full resolution P probes
  - RGB emission, scalar transmittance
  - Existing merge format (RGB9E5)
  - No acoustic data anywhere
  - Cost: 100% (baseline)

Half-res acoustic cascade (NEW)
  - P/2 probes
  - Two scalar channels: HF gain, LF gain
  - Reads same world texture + material texture
  - Bilinear-resampled opacity in seed
  - Listener emits, sources read (reciprocity)
  - Cost: ~25% of visual GI

Quarter-res bounce passes (NEW)
  - P/4 probes
  - Two bounce iterations for reverb estimation
  - Same two-channel format
  - Cost: ~12% of visual GI

Total acoustic overhead: ~37% of visual GI
```

---

## 3. The Acoustic Seed

The acoustic seed samples the **full-resolution world texture** at each half-res probe position using a smooth kernel (bilinear interpolation centered on the probe). This produces an area-averaged opacity α that encodes wall presence and thickness within the probe cell.

From this single opacity value, two transmittances are derived:

```
HF_trans = pow(1.0 - α, spacing)
LF_trans = pow(1.0 - α, spacing * LF_FACTOR)
```

### Why bilinear resampling is physically correct

- **Thin walls** (1 pixel in a 2-pixel cell): α ≈ 0.25–0.5 depending on sub-pixel position. Substantial LF transmission, moderate HF transmission. Thin walls leak bass — correct.
- **Thick walls** (cell fully opaque): α ≈ 1.0. Near-zero transmission at both HF and LF. Thick walls block everything — correct.
- **Wall edges**: as geometry slides past a probe center, the bilinear kernel ramps opacity smoothly from 0 to peak. No popping or discontinuities. Any opaque pixel within the kernel radius contributes nonzero opacity to the nearest probe — walls never vanish.
- **Volumes** (opacity 0.03 spatially extended): the doubled spacing at half-res gives `pow(1 - 0.03, 2×spacing) = pow(1 - 0.03, spacing)²` — traversing twice the distance through the same medium. Physically correct, no special handling needed.

### What this replaces

The v1 approach uses point-sampled opacity at full resolution with a tuned `BASS_WALL_PERM = 0.65` constant. Every solid pixel leaks bass at the same fixed rate regardless of wall thickness. A 1-pixel wall and a 50-pixel wall both transmit 65% of bass per probe. The v2 approach makes wall thickness emergent from geometry — no tuning constant needed.

### Emission

The listener (channel ID 1 in the material texture) emits scalar amplitude 1.0 into both HF and LF channels. The seed checks the material texture at each probe position for channel ID 1 and emits accordingly.

Bounced emission from the previous frame's acoustic fluence is read from the acoustic bounce texture (at P/2 resolution) and added to the emission, same as visual GI handles indirect light.

---

## 4. Acoustic Extend and Merge

Structurally identical to visual HRC. The extend composes ray segments hierarchically (bottom-up). The merge integrates angular contributions (top-down). The only difference is the data format:

### Per-entry format

| Stage       | Visual                            | Acoustic                            |
| ----------- | --------------------------------- | ----------------------------------- |
| Ray entry   | vec4u (RGB emission + trans, 16B) | 2× f16 emission + 2× f16 trans (8B) |
| Merge entry | u32 (RGB9E5, 4B)                  | u32 (2× f16: HF + LF, 4B)           |

The merge entry is the same size as visual (u32). Two f16 scalars pack into one u32 via `pack2x16float`. No merge buffer widening.

### Composition rules

Over-composite is applied independently to each channel:

```
HF_combined = HF_near + HF_far × HF_trans_near
LF_combined = LF_near + LF_far × LF_trans_near

HF_trans_combined = HF_trans_near × HF_trans_far
LF_trans_combined = LF_trans_near × LF_trans_far
```

Associativity, linearity, over-composability — all preserved per channel independently. The merge's angular weighting and even/odd probe parity handling work identically to visual.

### Bandwidth cost

At P/2 probes: merge bandwidth is (P/2)² × log₂(P/2) × 4B per level. Approximately **25% of visual merge bandwidth**.

---

## 5. Readout at Source Positions

After the acoustic cascade completes, the fluence is a (P/2 × P/2) texture with two f16 channels (HF, LF).

For each source channel ID (≥ 2 in the material texture), read HF and LF fluence at the source's probe position via bilinear texture sampling. No screen-resolution gather pass needed — just a texture read per source.

If a source channel spans multiple pixels (e.g., a lava field), average across the source's extent. This can be a small compute pass over source pixels only, or CPU-side accumulation from a readback of the fluence at known source positions.

---

## 6. Bounce Passes for Per-Source Reverb

### Why this gives per-source reverb

By reciprocity, the listener emits and sources receive. Pass 0 fluence at source S is the direct-path energy from listener to S through all geometry. When walls re-emit this energy (bounce), pass 1 fluence at S is the energy that left the listener, reflected off walls, and reached S. This IS the first-order reflected energy for source S's specific path.

Two sources in different acoustic environments get different reverb:

- Source A in a small tiled room: many nearby walls re-emit strongly → fluence_1(A) / fluence_0(A) is high → reverberant.
- Source B in an open field: no nearby walls re-emit → fluence_1(B) / fluence_0(B) ≈ 0 → dry.

### Implementation

After the P/2 acoustic cascade completes:

1. **Bounce shader** at P/2 resolution: reads acoustic fluence, re-emits at wall probes with `fluence × albedo / 2π`. Writes to a bounce texture at P/4 resolution.
2. **Quarter-res cascade pass 1**: full seed + extend + merge at P/4 probes, propagating the bounced emission. Produces fluence_1 (HF and LF).
3. **Bounce again** from fluence_1 at P/4.
4. **Quarter-res cascade pass 2**: produces fluence_2 (HF and LF).

### Decay model

In a uniform-albedo enclosed room, the per-bounce decay is geometric: E_n = E_0 × albedo^n. The ratio fluence_1/fluence_0 ≈ fluence_2/fluence_1 is constant.

For non-uniform rooms (mixed materials, open boundaries, corridors), the decay ratio varies between bounce orders. Two data points (fluence_1, fluence_2) give a first-order estimate of the decay rate:

```
decay_ratio = fluence_2 / fluence_1
RT60 ≈ -60 dB / (10 × log10(decay_ratio) × bounces_per_second)
```

### Scene complexity independence

Each bounce pass is a full cascade evaluation. The cascade correctly integrates energy through all geometry in O(P² log P) regardless of scene complexity. A scene with 2 walls and a scene with 200 walls produce equally accurate bounce results. The approximation is in the 2-point decay extrapolation, not in the energy computation. The quality of the extrapolation depends on scene topology (uniform vs. mixed materials), not scene complexity.

### Temporal refinement

The visual GI bounce mechanism already feeds back fluence from frame to frame. The acoustic cascade can similarly accumulate temporal bounce data:

- Frame N: within-frame bounce passes give fluence_1 and fluence_2 (immediate).
- Frame N+1: temporal bounce feedback gives effective third-order reflection data.
- Frame N+2: fourth-order.

Over ~5 frames, the decay estimate refines from 2 data points to 5. This doesn't delay the audio response — gain and spectral tilt are available immediately from the within-frame acoustic cascade. Only the reverb T60 estimate refines progressively, and reverb is a slow-changing room property where 83ms latency (5 frames at 60fps) is perceptually acceptable.

### Cost

Each quarter-res cascade pass: (P/4)² / (P)² = 1/16 of visual GI bandwidth, with simpler two-channel format. Two passes total: ~12% of visual GI.

---

## 7. DSP Chain

### Per-source values extracted per frame

| Value        | Source                                | Meaning                                      |
| ------------ | ------------------------------------- | -------------------------------------------- |
| HF_gain      | acoustic cascade fluence (HF channel) | high-frequency attenuation                   |
| LF_gain      | acoustic cascade fluence (LF channel) | low-frequency attenuation (wall penetration) |
| reverb_ratio | fluence_1 / fluence_0                 | reverberant energy fraction                  |
| decay_rate   | fluence_2 / fluence_1                 | per-bounce energy decay → RT60               |
| pan          | geometric direction to source         | stereo position                              |

### Spectral tilt modeling

The mass law gives transmission loss proportional to 1/(f·m)², which is -6 dB per octave — a smooth spectral tilt, not a sharp cutoff. A lowpass filter with cutoff is the wrong model. The correct model is a first-order IIR filter:

```
y[n] = a × x[n] + (1-a) × y[n-1]
```

This gives exactly -6 dB/octave slope. The coefficient `a` is derived from the HF/LF ratio:

```
tilt_dB = 20 × log10(HF_gain / LF_gain)
```

- Open air: tilt ≈ 0 dB (flat). Coefficient a → 1.0 (passthrough).
- Behind thin wall: tilt ≈ -6 dB. Single-wall mass law.
- Behind thick wall: tilt ≈ -18 dB. Multiple-wall equivalent.
- Through volume: tilt varies smoothly with density and path length.

Multiple walls compound naturally in the cascade — HF attenuates more per wall than LF — so the tilt grows correctly with wall count without needing to know how many walls are in the path.

Web Audio implementation:

```javascript
// First-order IIR from tilt ratio
const a = Math.pow(HF_gain / LF_gain, 0.5); // map ratio to coefficient
const wallFilter = audioContext.createIIRFilter([a, 0], [1, -(1 - a)]);
```

Or equivalently, use a `BiquadFilterNode` of type `"highshelf"` at ~1 kHz with gain = tilt_dB. This gives a smooth spectral rolloff with no resonant artifacts.

### Signal flow

```
source audio
  → first-order IIR (spectral tilt from HF/LF ratio)
  → gain node (overall level from LF_gain, with pow(g, 0.4) compression)
  → reverb send (wet/dry from reverb_ratio, tail length from decay_rate)
  → stereo panner (from geometric direction)
  → compressor/limiter (-3dB threshold, 20:1)
  → output
```

All parameters smoothed via `setTargetAtTime` with 50ms time constant to prevent clicks.

### Reverb implementation

Per-source reverb can use a simple synthetic exponential decay convolution:

- Decay length: RT60 from decay_rate estimate.
- Wet level: reverb_ratio × LF_gain.
- Can use a shared `ConvolverNode` with per-source wet/dry send, or lightweight per-source feedback delay networks for distinct room characters.

The reverb_ratio directly distinguishes "source in reverberant room" from "source in open air" even if both have the same direct-path gain. This is the key advantage over v1, which had no per-source reverb information.

---

## 8. Resource Requirements

### GPU buffers (at P = 1024 visual, P/2 = 512 acoustic, P/4 = 256 bounce)

| Buffer                            | Format                            | Size                        |
| --------------------------------- | --------------------------------- | --------------------------- |
| Acoustic ray buffers (×10 levels) | 2×f16 emission + 2×f16 trans = 8B | ~10 × 512 × 512 × 8B ≈ 20MB |
| Acoustic merge buffers (×2)       | u32 per entry                     | 2 × 512 × 512 × 4B ≈ 2MB    |
| Acoustic fluence texture          | rg16float                         | 512 × 512 × 4B ≈ 1MB        |
| Acoustic bounce texture           | rg16float                         | 512 × 512 × 4B ≈ 1MB        |
| Bounce ray buffers (×8 levels)    | 8B per entry                      | ~8 × 256 × 256 × 8B ≈ 4MB   |
| Bounce merge buffers (×2)         | u32 per entry                     | 2 × 256 × 256 × 4B ≈ 0.5MB  |
| Bounce fluence textures (×2)      | rg16float                         | 2 × 256 × 256 × 4B ≈ 0.5MB  |
| **Total acoustic memory**         |                                   | **~29MB**                   |

Compare to v1 acoustic overhead: ~15.6MB in wider merge/ray buffers embedded in the visual pipeline, plus LF/pan/channel buffers.

### Bandwidth per frame

| Component                            | Entries | Bytes/entry        | Total            |
| ------------------------------------ | ------- | ------------------ | ---------------- |
| Acoustic seed (P/2 × P/2 × 4 dir)    | ~1M     | 8B read + 8B write | ~16MB            |
| Acoustic extend (~10 levels × 4 dir) | ~10M    | 8B read + 8B write | ~160MB           |
| Acoustic merge (~10 levels × 4 dir)  | ~10M    | 8B read + 4B write | ~120MB           |
| Bounce pass 1 (all stages)           | ~1.5M   | ~12B avg           | ~18MB            |
| Bounce pass 2 (all stages)           | ~1.5M   | ~12B avg           | ~18MB            |
| **Total acoustic bandwidth**         |         |                    | **~332MB/frame** |

At 60fps: ~20 GB/s. On a 400 GB/s GPU: ~5% of bandwidth capacity.

---

## 9. Implementation Plan

### Phase 1: Half-res acoustic cascade

1. Create separate acoustic pipeline: seed, extend, merge shaders operating on two f16 scalars.
2. Acoustic seed reads world texture with bilinear sampling at P/2 resolution. Computes HF_trans and LF_trans from area-averaged opacity.
3. Acoustic extend and merge are structurally identical to visual but operate on the two-scalar format.
4. Read acoustic fluence at source positions. Drive gain + spectral tilt filter.
5. **Validate**: compare HF_gain against visual fluence at source positions (should correlate). Compare LF_gain vs HF_gain behind walls of varying thickness (LF should exceed HF, with ratio scaling with thickness).

### Phase 2: Bounce passes for reverb

1. Implement acoustic bounce shader at P/2: reads acoustic fluence, re-emits at wall probes with albedo.
2. Run quarter-res cascade from bounced emission. Read fluence_1 at sources.
3. Repeat for fluence_2.
4. Compute decay_ratio and reverb_ratio per source. Drive reverb send parameters.
5. **Validate**: source in enclosed room should have high reverb_ratio. Source in open air should have near-zero. Moving a wall to enclose a source should increase reverb_ratio over a few frames.

### Phase 3: DSP chain upgrade

1. Replace lowpass filter with first-order IIR or highshelf for spectral tilt.
2. Add per-source reverb send with wet/dry from reverb_ratio and decay from RT60 estimate.
3. Smooth all parameter transitions.
4. **Validate**: A/B test against v1. Listen for: natural muffling behind walls (smooth tilt vs sharp cutoff), distinct reverb character for sources in different rooms, absence of artifacts on geometry changes.

### Phase 4: Remove v1 acoustic system

Once v2 is validated, strip all acoustic data from the visual pipeline:

- Remove HF/LF channels from ray seed, extend, and merge shaders.
- Remove acoustic entries from merge buffer (revert to u32 RGB9E5).
- Remove LF buffer, pan buffer, channel accumulator, gather pass.
- Remove readback for channel gains.
- Visual pipeline returns to its clean pre-acoustic state.

---

## 10. Open Questions

### Bilinear resampling calibration

The bilinear kernel maps wall thickness to area-averaged opacity, which maps to transmittance. Whether this mapping matches real mass-law transmission for the wall thickness and frequency implied by the resolution is an empirical question. The mapping is monotonic in the right direction (thinner walls → more bass transmission), but may need a nonlinear transfer function:

```
acoustic_opacity = transfer_function(bilinear_opacity)
```

where `transfer_function` is calibrated against ground-truth frequency-dependent transmission for canonical wall thicknesses.

### LF_FACTOR tuning

The `LF_FACTOR` parameter controls how much more permissive LF transmittance is than HF. In v1, this was 0.1. The v2 approach may need a different value because the base opacity is area-averaged rather than point-sampled. The interaction between area-averaging and the LF_FACTOR exponent needs empirical tuning.

### Number of bounce passes

Two bounce passes give two data points for RT60 estimation. For scenes with uniform absorption, two points are sufficient (geometric decay). For complex topologies (L-corridors, coupled rooms), the decay may be non-geometric and two points give a crude fit. A third bounce pass at P/4 adds ~6% cost and provides a third data point. Whether this is worth it depends on the diversity of scenes encountered.

### Temporal bounce integration

The acoustic cascade can feed its fluence into the next frame's bounce texture, accumulating higher-order reflections over time (same mechanism as visual GI bounces). This gives progressive refinement of the decay estimate without additional per-frame cost. The interaction between within-frame bounce passes and temporal bounce feedback needs careful design to avoid double-counting reflection orders.

### Source readout granularity

For sources spanning many pixels (large shapes with a single channel ID), the acoustic fluence at the source's center may not represent the whole source. A source that's partially behind a wall has different attenuation at its exposed vs. occluded portions. Whether to average across source pixels (more accurate, requires a gather pass) or read at the center (cheaper, less accurate) depends on typical source sizes and shapes.

---

## 11. Comparison to v1

| Property                     | v1 (naive)                                     | v2 (half-res cascade)                             |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Visual pipeline modification | Heavy (wider merge, extra channels everywhere) | None                                              |
| Acoustic cost                | ~50-80% of visual GI                           | ~37% of visual GI                                 |
| Wall penetration model       | Fixed constant (BASS_WALL_PERM = 0.65)         | Thickness-emergent from resampling                |
| Per-source reverb            | No                                             | Yes (from bounce passes)                          |
| Frequency model              | Two fixed bands (HF shares visual trans)       | Two bands with physically-motivated transmittance |
| Spectral tilt DSP            | Lowpass with cutoff                            | First-order IIR (-6 dB/octave, mass law)          |
| Gather mechanism             | Screen-resolution atomic dispatch              | Per-source texture read                           |
| Code complexity              | Acoustic data threaded through every shader    | Clean separation: visual + acoustic pipelines     |
| Diffraction                  | Multi-frame (requires bounce feedback)         | Multi-frame (same, inherent to cascade)           |

---

## 12. References

- Freeman, Sannikov, Margel. "Holographic Radiance Cascades for 2D Global Illumination." arXiv:2505.02041 (2025).
- Rosen, Godin, Raghuvanshi. "Interactive sound propagation for dynamic scenes using 2D wave simulation." SCA 2020.
- GPUVerb. GPU-accelerated Planeverb. github.com/GPUVerb/GPUVerb.
- Raghuvanshi et al. Project Triton / Project Acoustics, Microsoft Research.
