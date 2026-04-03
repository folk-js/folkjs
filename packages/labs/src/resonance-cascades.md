# Resonance Cascades

**Real-time 2D acoustic parameter estimation integrated into Holographic Radiance Cascades**

---

## 1. What This Is

Resonance Cascades extends HRC's existing cascade pass to compute acoustic attenuation alongside visual global illumination. By treating the listener as an acoustic emitter and widening the ray payload, we obtain a per-probe attenuation field that any number of sound sources can query via simple lookup — with zero additional cascade dispatches and no per-channel scaling.

The output is per-source, per-frame control data (gain, spectral tilt, stereo pan) that drives a standard audio DSP chain.

---

## 2. Core Idea

### 2.1 The listener is an emitter

The cascade computes fluence at every probe from whatever is emitting. For visual GI, every light source emits. For audio, only the listener emits — with intensity 1.0 in the acoustic radiance channel, and 0.0 at every other probe.

The cascade propagates this signal outward through the scene using the same seed, extend, and merge machinery. Walls block it. Doorways let it fan through with correct angular spread (from the merge's even/odd interpolation). Volumetrics partially attenuate it. At every probe P, the resulting acoustic fluence equals the fraction of the listener's signal that reaches P via all available paths.

By reciprocity, this equals how much sound from P would reach the listener. `acoustic_fluence[P]` IS the gain coefficient for any sound source at P.

### 2.2 Why this is mathematically correct

The cascade computes a path integral: emission × transmittance, summed over all directions and distances, composed hierarchically via the over-composite `rad_combined = rad_near + rad_far × trans_near`, with spatial alignment corrected by the merge's even/odd probe interpolation and crossed extensions.

For a single emitter (the listener), the fluence at probe P represents the total energy from the listener reaching P through all unobstructed air paths. This is exactly the geometric-regime acoustic attenuation: the sum of all transmission paths weighted by their individual transmittances. Every aspect of HRC — the hierarchical composition, the aperture spreading through openings, the spatial interpolation — operates identically whether the emitted signal represents light or sound.

### 2.3 The cascade is listener-independent in structure

The seed, extend, and merge dispatches are unchanged. The listener position enters only as a uniform in the seed shader: one probe gets `acoustic_rad = 1.0`, all others get `acoustic_rad = 0.0`. If the listener moves, only the seed uniform changes. No rebinding, no reallocation.

Multiple listeners (split-screen, multiplayer) would require additional acoustic channels, not additional cascade passes. Each listener occupies one radiance channel.

### 2.4 What this does NOT model

- **Wave interference.** No constructive/destructive superposition.
- **Room modes.** No standing wave resonances.
- **Impulse response timing.** We compute how much energy arrives, not when.
- **True diffraction.** Sound wrapping around obstacles follows the cascade's penumbra structure, which is qualitatively plausible but quantitatively approximate.
- **Reflections** (without bounces). Without the bounce loop, sound propagates only through air paths — through doorways, through gaps, through volumetrics. It does NOT wrap around corners or reflect off surfaces. With bounces enabled, reflected energy naturally accumulates over frames and contributes additional gain.

## Volumetric Acoustics

### How existing HRC volume parameters drive audio

HRC already models volumetric media with two parameters per pixel: opacity (extinction per step) and albedo (fraction of extinguished energy that is scattered vs absorbed). These same values, with no additional data, produce physically correct volumetric audio behavior.

**Opacity** controls how much energy is removed from the forward path. The seed computes `trans = pow(1 - opacity, spacing)`, which compounds per-pixel extinction over the probe footprint. This is Beer-Lambert attenuation — identical physics for light and sound propagating through a participating medium.

**Albedo** controls what happens to the removed energy. The bounce shader reads `fluence × albedo` and re-emits it isotropically. For audio, this means scattered sound energy re-enters the cascade and can reach probes that the direct path cannot — sound diffusing through a scattering medium.

**Slope** adds frequency dependence to the extinction. In the seed, slope is computed from opacity:

```wgsl
if (world.a > 0.0 && world.a < 1.0) {
    slope = -2.0 * world.a * params.probeSpacing;
}
```

This models the physical relationship where volumetric scatterers (leaves, raindrops, bodies in a crowd) are small relative to bass wavelengths and large relative to treble wavelengths. Low frequencies pass through with less attenuation; high frequencies are more strongly scattered or absorbed. The `-2.0` coefficient corresponds to the Rayleigh-regime f^(-2) dependence. Slope accumulates additively through the extend shader, so traversing more volume produces a steeper tilt.

For solid walls (opacity = 1.0), slope is irrelevant: transmittance is zero and the acoustic signal is dead regardless of frequency.

### Expected behavior for different combinations

| Opacity | Albedo | Analog               | Direct sound         | Scattered sound          | Spectral effect      |
| ------- | ------ | -------------------- | -------------------- | ------------------------ | -------------------- |
| 0.0     | —      | Air                  | Full                 | None                     | Flat                 |
| 0.05    | 0.0    | Thin absorber        | Slightly reduced     | None                     | Mild treble loss     |
| 0.05    | 0.8    | Light fog            | Slightly reduced     | Diffuse glow of sound    | Mild treble loss     |
| 0.2     | 0.3    | Foliage              | Noticeably reduced   | Some diffuse scatter     | Moderate treble loss |
| 0.2     | 0.0    | Acoustic foam (thin) | Noticeably reduced   | None (absorbed)          | Moderate treble loss |
| 0.5     | 0.5    | Dense hedge          | Heavily attenuated   | Moderate diffuse scatter | Strong treble loss   |
| 0.5     | 0.0    | Heavy absorber       | Heavily attenuated   | None                     | Strong treble loss   |
| 1.0     | —      | Solid wall           | Zero (fully blocked) | Via bounce off surface   | N/A (signal dead)    |

Key behaviors to note:

- **High opacity, zero albedo** (acoustic foam, absorbers): sound is removed and destroyed. No scattering, no bounce. The space behind it is quiet.
- **High opacity, high albedo** (dense reflective medium): sound is removed from the direct path but scattered diffusely. The probe behind it receives less direct sound but may receive scattered energy from the bounce loop — similar to hearing muffled sound through a thick curtain where some energy leaks diffusely.
- **Low opacity, high albedo** (fog, light rain): minimal direct attenuation but significant scattering over distance. Sound becomes harder to localize as the direct-to-scattered ratio decreases. The gain remains high but the pan becomes less defined (scattered energy arrives from many directions).
- **Zero albedo everywhere** (or bounces disabled): no scattering at all. Sound propagates only through air paths and apertures. Volumes only attenuate; they never redirect.

---

## 3. Data Layout

### 3.1 Ray buffer (widened)

Current: `vec2u` = 8 bytes → `packF16(R, G, B, trans)`

Proposed: `vec3u` = 12 bytes → `packF16(R, G, B, trans, acoustic_rad, slope)`

Full RGB visual radiance is preserved unchanged. Two new f16 values: acoustic radiance (the listener's propagating signal) and spectral slope (frequency-dependent attenuation tilt, see §4.2).

### 3.2 Merge buffer (widened)

Current: `u32` = 4 bytes → `packRGB9E5(visual_result)`

Needs to carry acoustic_rad through the merge alongside visual RGB. Options:

- **2×u32 = 8 bytes:** `packRGB9E5(visual)` + `packF16(acoustic, slope)`. Doubles merge buffer size.
- **Replace RGB9E5 with 4×f16 = 8 bytes:** `packF16(R, G, B, acoustic)`. Uniform precision, same width. Slope carried separately or derived at readout.

Merge operates per-component on radiance. The acoustic channel flows through even/odd interpolation, cone weighting, and far-cone composition identically to R, G, or B. No merge shader logic changes beyond operating on wider data.

### 3.3 Fluence buffer

Current: `vec2u` = 8 bytes → `packF16(R, G, B, 1.0)` with unused alpha.

Proposed: `packF16(R, G, B, acoustic_gain)`. The alpha carries acoustic fluence.

### 3.4 Pan buffer (new, small)

One i8 value per probe: signed pan position [-127, +127]. At 1024² probes: 1MB.

Written during the level-0 merge write. Each direction contributes its acoustic result weighted by a sign: E = +1, W = -1, N and S = 0 (for X-axis stereo pan). Normalized at readout by dividing by acoustic_gain.

### 3.5 Material texture (future, for area sources)

Current: `r8unorm` → albedo only.

Future: extend to `rgba8unorm`. R = albedo (existing). G = acoustic source type ID (0–255). B = acoustic emission intensity. A = reserved. This enables area sources without any cascade changes — the gather pass reads from fluence, not from the cascade.

---

## 4. Shader Changes

### 4.1 Seed

```wgsl
// Existing visual computation (unchanged)
let trans = pow(1.0 - world.a, params.probeSpacing);
let rad = (world.rgb + bounce) * (1.0 - trans);

// Acoustic: listener probe emits 1.0, all others emit 0.0
let is_listener = (probeIdx == params.listenerProbeIdx
                && sliceIdx == params.listenerSliceIdx);
let acoustic_rad = select(0.0, 1.0, is_listener) * (1.0 - trans);

// Spectral slope from opacity via mass law
var slope = 0.0;
if (world.a > 0.0 && world.a < 1.0) {
    slope = -2.0 * world.a * params.probeSpacing;
}
// Solid walls: slope irrelevant (trans = 0, signal is dead)
```

### 4.2 Extend

Two additional operations per composition:

```wgsl
// Existing (unchanged)
let combined_rad = near.rad + far.rad * near.trans;
let combined_trans = near.trans * far.trans;

// New
let combined_acoustic = near.acoustic + far.acoustic * near.trans;
let combined_slope = near.slope + far.slope;
```

One multiply-add (acoustic, same pattern as visual radiance) and one addition (slope). Bandwidth-bound shader; ALU cost is invisible.

Slope composition is additive because it represents a power-law exponent: `T(f) = T_ref × (f/f_ref)^slope`. Serial transmission multiplies T values, which adds exponents.

### 4.3 Merge

No logic changes. acoustic_rad is a fourth radiance component that flows through the merge identically to R, G, or B. The merge's even/odd probe handling, cone weighting, angular weights, far-cone composition — all per-component operations that apply to acoustic_rad without modification.

At level 0, the merge writes:

- acoustic_gain to fluence buffer alpha
- sign-weighted acoustic contribution to the i8 pan buffer

### 4.4 Blit

No changes. Reads visual fluence RGB and world texture. Ignores acoustic data.

---

## 5. Readout

### 5.1 Point sources

For any sound source at probe position P:

```
gain  = acousticFluence[P]                    // 0 = fully occluded, continuous
pan   = panBuffer[P] / 127.0                  // [-1, +1], reflects indirect paths
slope = slopeBuffer[P]  (or derived)          // spectral tilt
```

O(1) per source. Any number of sources, any number of audio channels. The cascade does not know about sources.

### 5.2 Area sources (Phase 5)

A gather compute pass at probe resolution. Each emitting probe reads its own `acousticFluence` value, multiplies by emission intensity, atomically adds into per-type bins. One dispatch, all types, every frame. Channel-independent.

Point sources and area sources are the same operation at different scales. A point source is a single-pixel area source.

### 5.3 Spectral reconstruction

From gain and slope, the attenuation at any frequency is recovered:

```
T(f) = gain × (f / f_ref) ^ slope
```

This is infinite-band resolution from two numbers. The power-law model matches the mass law's dominant f^(-2) behavior for most construction materials.

### 5.4 Audio DSP mapping

```
gain    → channel volume (linear gain applied to audio signal)
slope   → tilt EQ (slope × 6.02 ≈ dB/octave)
            slope = 0: flat response (open air or solid wall)
            slope = -4: heavy treble loss (dense volumetric traversal)
pan     → stereo panner [-1, +1]
            correctly reflects indirect portal paths
```

---

## 6. Cost

### 6.1 Integrated overhead (single cascade pass)

| Resource              | Current HRC     | With Resonance Cascades | Overhead              |
| --------------------- | --------------- | ----------------------- | --------------------- |
| Ray entry             | 8 bytes (vec2u) | 12 bytes (vec3u)        | +50% ray bandwidth    |
| Merge entry           | 4 bytes (u32)   | 8 bytes (2×u32)         | +100% merge bandwidth |
| Fluence entry         | 8 bytes         | 8 bytes (use alpha)     | 0%                    |
| Pan buffer            | —               | 1 byte per probe        | ~1MB at 1024²         |
| Additional dispatches | 0               | 0                       | 0                     |
| ALU (seed)            | —               | ~5 instructions         | negligible            |
| ALU (extend)          | —               | 2 instructions          | negligible            |
| ALU (merge)           | —               | 0 (per-component)       | negligible            |

The dominant overhead is bandwidth: +50% on ray buffers, +100% on merge buffers. These are the bottleneck in the current bandwidth-bound pipeline. Estimated impact: +30–60% of current cascade time. Needs profiling.

### 6.2 Readback

Acoustic fluence + pan: ~5MB at 1024² (4 bytes fluence alpha + 1 byte pan per probe). Staging buffer with one-frame latency (~16ms, inaudible). For few sources, copy only relevant probe values.

### 6.3 Standalone mode (noted)

Resonance Cascades could also run as a fully separate cascade with no visual GI, at whatever probe resolution is appropriate for audio. The architecture is identical; it simply wouldn't carry RGB radiance. This is a separate product, not the integrated approach described here.

---

## 7. Accuracy

### Exact (to probe resolution)

- **Binary occlusion.** Walls fully block. Gaps wider than one probe spacing are resolved.
- **Aperture propagation.** Energy fans through openings with correct angular spread from the merge's spatial interpolation.
- **Gain composition.** The over-composite correctly accumulates the listener's signal along all available paths.
- **Multi-path summation.** Multiple paths (e.g. two doorways) sum correctly.
- **Pan accuracy.** Reflects the true directional distribution of arriving energy, including indirect paths.

### Approximate

- **Spectral slope.** Additive composition assumes power-law transmission. Non-monotonic materials are approximated by their average tilt.
- **Penumbra as diffraction proxy.** Qualitatively plausible, quantitatively approximate.

---

## 8. Future Extensions (speculative)

### 8.1 Bounce-derived reverb

With bounces enabled, separate the acoustic channel into direct (R-like) and bounced (G-like) components. The ratio gives wet/dry per probe at zero additional GPU cost.

### 8.2 Area sources

Material texture encodes type ID (0–255) and emission intensity. Gather pass sums fluence × emission per type. One dispatch, all types, every frame, without need for separate query step.

### 8.3 Per-material acoustic properties

Override global mass_scale per surface via material texture channel. Custom slope values for materials that deviate from the mass law.

### 8.4 Decay rate estimation

Compare frame-to-frame bounce convergence to estimate reverberant decay rate. Feeds into algorithmic reverb tail length.

### 8.5 Multiple listeners

Each listener occupies one acoustic radiance channel. Two listeners = two channels in the same pass (sacrifice a visual color channel or widen further). Four listeners would need a second pass.

---

## 9. Build Plan

### Phase 0: Test Harness

Fork HRC into acoustic test page. Predefined scenes: open field, single wall, wall with doorway, L-corridor, two rooms, thin pillar, volumetric obstacle. Moveable listener and source.

Notes:

- source can be brush/mouse to start, listener size can correspond to brush size. Shapes can be equipped with audio emitter UI (we have at least one sound file that we can play, we can also use simple sources like white/blue noise and sine waves)
- We should have a visual mode toggle for audio that, instead of reading RGB fluence, visualises the acoustic values for emitter pixels (can start with gain as red, for example, later can extend to slope and pan)
- we might want to do audio integration at this stage instead of later.

### Phase 1: FDTD Ground Truth

2D wave solver on same world texture. Gaussian pulse → FFT → |H(f)|. Directional measurement. Pressure field visualization. Validates: free-field falloff, rigid reflection, slit diffraction.

### Phase 2: Resonance Cascade Integration

Widen ray payload to vec3u. Add acoustic_rad + slope to seed/extend. Carry acoustic through merge. Write acoustic_gain to fluence alpha. Write pan to i8 buffer. Listener position as seed uniform. Readback pipeline. Acoustic heatmap visualization.

### Phase 3: Comparison & Validation

**Go/no-go gate.** Cascade vs FDTD across all test scenes.

Metrics: broadband attenuation error (<6 dB target), spectral shape, pan accuracy (<30° target), aperture spreading (qualitative).

| Scene       | Expected                                        |
| ----------- | ----------------------------------------------- |
| Open field  | Exact                                           |
| Single wall | Exact occlusion, correct pan                    |
| Doorway     | Good aperture spread, pan shifts toward opening |
| L-corridor  | Exact with bounces                              |
| Thin pillar | Poor (penumbra ≠ diffraction)                   |
| Volumetric  | Good frequency-dependent attenuation            |

### Phase 4: Audio Integration

Web Audio: source → tilt EQ (slope) → gain (acoustic_gain) → stereo panner (pan) → output. FDTD convolution for A/B. Demo: walls, sources, moving listener, real-time audio.

---

## 10. References

- Freeman, Sannikov, Margel. "Holographic Radiance Cascades for 2D Global Illumination." arXiv:2505.02041 (2025).
- Sannikov. "Radiance Cascades: A Novel Approach to Calculating Global Illumination." (2023).
- Yaazarai. Volumetric HRC. github.com/Yaazarai/Volumetric-HRC.
- m4xc. "Fundamentals of Radiance Cascades." m4xc.dev (2024).
- Raghuvanshi et al. Project Triton / Project Acoustics, Microsoft Research.
- GPUVerb. GPU-accelerated 2D FDTD. github.com/GPUVerb/GPUVerb.
- Valve. Steam Audio. valvesoftware.github.io/steam-audio.
- Cremer, Müller. "Principles and Applications of Room Acoustics."
