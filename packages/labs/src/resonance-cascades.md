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

### 2.5 Merge-compatible properties

For a value to propagate correctly through the cascade's hierarchical merge, it must satisfy two properties:

**Over-composability.** The value must compose as `combined = near + far × near_transmittance`. This means it represents "an amount of something arriving from a direction" — you can add what's in front to what's behind (attenuated by transparency). Radiance-like quantities satisfy this. Path properties (like cumulative spectral tilt or total path length) do not.

**Linearity (superposition).** When the merge sums contributions from different angles (angular weighting) or averages adjacent probes (even/odd interpolation), the result must equal the correct total. This requires linear scaling: `w_A × value_A + w_B × value_B` gives the correct combined value. Radiance is linear. Products of independent quantities, ratios, and nonlinear functions introduce cross-term errors under averaging.

**In one sentence:** a value flows correctly through the cascade if and only if it behaves like a radiance — it represents "how much of X arrives" and satisfies both over-composability and linear superposition.

This is why `acousticHF` (high-frequency acoustic radiance) works: it IS a radiance with different propagation parameters. And why `slope` (a path-integral exponent) failed: it is neither over-composable nor linear under angular averaging. The spectral tilt is instead recovered from the RATIO of two correctly-propagated radiance channels at readout.

### 2.6 Mass law via two-channel acoustic radiance

Frequency-dependent attenuation is modeled by propagating TWO acoustic channels with different effective opacity:

- **Broadband** (`acoustic`): uses `trans = pow(1 - opacity, spacing)` — same as visual
- **High-frequency** (`acousticHF`): uses `trans_hf = pow(1 - opacity, spacing × HF_FACTOR)` — the medium is effectively `HF_FACTOR` times thicker for high frequencies

This models the **mass law**: high-frequency sound waves interact with media as if the medium were thicker, because shorter wavelengths scatter/absorb more. The `HF_FACTOR` (default 3.0) determines the frequency ratio: `f_hf / f_ref = sqrt(HF_FACTOR)`.

**Wall permeability:** Both acoustic channels use `max(trans, WALL_PERM)` instead of raw `trans` in the over-composite. This gives solid walls (opacity=1) a tiny nonzero transmittance for bass (`WALL_PERM = 0.02`) and an even tinier one for treble (`WALL_PERM_HF = WALL_PERM^HF_FACTOR ≈ 0.000008`). Bass leaks through walls; treble does not. Visual channels still use raw `trans = 0` for full opacity.

---

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

### 3.1 Ray buffer (widened, implemented)

`vec3u` = 16 bytes (due to WGSL vec3 alignment) → `packF16(R, G, B, trans)` + `pack2x16float(acoustic, acousticHF)`

Two acoustic f16 values: broadband acoustic radiance (the listener's propagating signal) and high-frequency acoustic radiance (mass-law-attenuated). Both compose identically via over-composite. The ratio `acousticHF / acoustic` gives the spectral tilt at readout.

### 3.2 Merge buffer (widened, implemented)

`vec2u` = 8 bytes → `packRGB9E5(visual)` + `pack2x16float(acoustic, acousticHF)`. Both acoustic channels flow through the merge identically to R, G, B.

### 3.3 Fluence buffer + HF buffer (implemented)

Fluence: `packF16(R, G, B, acoustic_gain)`. HF: separate `r32float` probe-resolution buffer for `acousticHF` gain. Both written at merge level 0, accumulated across 4 directions.

### 3.4 Pan buffer (new, small)

One i8 value per probe: signed pan position [-127, +127]. At 1024² probes: 1MB.

Written during the level-0 merge write. Each direction contributes its acoustic result weighted by a sign: E = +1, W = -1, N and S = 0 (for X-axis stereo pan). Normalized at readout by dividing by acoustic_gain.

### 3.5 Material texture (implemented)

Extended to `rg8unorm`. R = albedo (existing). G = audio channel ID:
- 0 = no audio role
- 1 = listener (the mouse light / brush)
- 2–255 = audio source channels

The channel ID is written per-pixel via the MRT fragment shader. Every pixel of a shape tagged as an audio source carries the channel ID, enabling the gather pass to correctly sum contributions from the shape's entire surface.

### 3.6 Slope buffer (new)

One `f32` per probe at probe resolution. Stores the gain-weighted slope (`acoustic * slope`) accumulated from all 4 directions. Written at merge level 0 alongside the fluence. Copied to an `r32float` texture for the gather pass to sample.

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

### 5.1 Gather pass (implemented)

A gather compute pass at **screen resolution**. For each pixel:
1. Read channel ID from material texture
2. If channel >= 2 (source): read acoustic fluence alpha and slope at that probe position
3. Multiply by `(1-trans)` — the surface absorption, identical to how visual light is absorbed
4. `atomicAdd` into per-channel accumulator (gain and slope_weight separately)

This models sound reception at the shape's **surface**, not its center. Edge pixels contribute (they see the listener's acoustic field and have opacity). Interior pixels of opaque shapes contribute nothing (acoustic field is blocked by outer layers). Air pixels contribute nothing (no opacity to absorb).

Gain is normalized by the listener's perimeter (`2 * pi * radius`) to give listener-size-independent attenuation with correct 1/r distance falloff. Slope is normalized by gain to give the gain-weighted average spectral tilt.

All sources are area sources. A point source is a single-pixel area source.

### 5.2 Spectral tilt from HF ratio (implemented)

The gather accumulates both broadband and HF gains per channel. The ratio gives the spectral tilt:

```
hfRatio = hfGain / broadGain    // 1.0 = flat (open air), <1.0 = treble cut
shelfDb = (hfRatio - 1.0) * 18  // maps to lowshelf EQ gain in dB
```

This replaces the original slope-based spectral reconstruction. The slope approach (`T(f) = gain × (f/f_ref)^slope`) offered continuous spectrum reconstruction from one number, but slope is a path property that does not satisfy the cascade's merge-compatible requirements (see §2.5). The two-channel ratio approach gives correct multi-path composition at the cost of discrete (two-band) rather than continuous frequency resolution.

### 5.3 Audio DSP mapping (implemented)

```
gain     → channel volume (linear gain)
hfRatio  → lowshelf EQ: (hfRatio - 1) × 18 dB at 2kHz
             hfRatio = 1.0: flat response (open air)
             hfRatio = 0.5: -9dB treble cut (moderate volume traversal)
             hfRatio = 0.0: -18dB treble cut (dense volume or wall)
pan      → stereo panner [-1, +1] (future, requires directional gather)
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

### 8.2 Per-material acoustic properties

Override global mass_scale per surface via material texture channel. Custom slope values for materials that deviate from the mass law.

### 8.3 Decay rate estimation

Compare frame-to-frame bounce convergence to estimate reverberant decay rate. Feeds into algorithmic reverb tail length.

### 8.4 Multiple listeners

Each listener occupies one acoustic radiance channel. Two listeners = two channels in the same pass (sacrifice a visual color channel or widen further). Four listeners would need a second pass.

---

## 9. Build Plan

### Phase 0: Test Harness — DONE

Acoustic test scenes (open field, doorway, corridor, volumetric, two rooms). Listener = mouse brush (channel 1 in material texture). Shapes equipped with audio emitter UI (Feather.mov via Web Audio). Acoustic debug visualization (debug mode 3) showing listener (cyan), sources (yellow), gain field (blue-orange heatmap). Audio debug panel with per-channel gain/slope bars and rolling graph.

### Phase 1: FDTD Ground Truth

2D wave solver on same world texture. Gaussian pulse → FFT → |H(f)|. Directional measurement. Pressure field visualization. Validates: free-field falloff, rigid reflection, slit diffraction.

### Phase 2: Resonance Cascade Integration — DONE

Ray payload widened to `vec3u` (16 bytes per element due to WGSL alignment). Acoustic_rad + slope in seed/extend. Acoustic + slope_weight carried through merge via second f16. Acoustic_gain in fluence alpha. Slope_weight in separate probe-resolution buffer. Listener emits via `(1-trans)` at channel-1 pixels in material texture — identical to visual light emission. Gather pass at screen resolution sums `fluence * (1-trans)` per channel with atomics. Gain normalized by listener perimeter for correct 1/r falloff.

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
