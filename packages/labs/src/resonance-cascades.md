# Resonance Cascades

**Real-time 2D acoustic parameter estimation integrated into Holographic Radiance Cascades**

---

## 1. What This Is

Resonance Cascades extends HRC's existing cascade pass to compute acoustic attenuation alongside visual global illumination. By treating the listener as an acoustic emitter and widening the ray payload, we obtain a per-probe attenuation field that any number of sound sources can query via a gather pass — with zero additional cascade dispatches.

The output is per-source, per-frame control data (gain, spectral tilt, stereo pan) that drives a Web Audio DSP chain: `source → lowpass filter → gain → compressor → panner → output`.

---

## 2. Core Ideas

### 2.1 The listener is an emitter

The listener (mouse cursor) is rendered as a shape in the world texture with channel ID 1 in the material texture. The seed shader emits acoustic radiance at channel-1 pixels via `(1-trans)` — identical to how visual light emits from surfaces. The cascade propagates this signal outward. At every probe P, the resulting acoustic fluence equals the fraction of the listener's signal that reaches P. By reciprocity, this IS the gain for any sound source at P.

### 2.2 Two acoustic channels: HF and LF

Two acoustic radiance channels propagate through the cascade with different transmittance:

- **HF (high frequency):** shares visual `trans`. Blocked by walls (trans=0). Attenuated by volumes same as light.
- **LF (low frequency):** uses its own `transLF = max(pow(1-opacity, spacing × LF_FACTOR), BASS_WALL_PERM)`. Bass sees volumes as thinner (`LF_FACTOR=0.1`) and leaks through solid walls (`BASS_WALL_PERM=0.6`).

This models the **mass law**: high-frequency sound interacts strongly with all media (like light), while low-frequency sound passes through more easily due to longer wavelengths.

| Scenario | HF trans | LF trans | What you hear |
|----------|---------|---------|---------------|
| Air | 1.0 | 1.0 | Full spectrum |
| Light volume (0.05) | 0.91 | 0.99 | Gradual treble rolloff |
| Dense volume (0.5) | 0.25 | 0.88 | Muffled, bass-heavy |
| Thin wall (0.97) | ~0 | 0.52 | Faint bass only |
| Solid wall (1.0) | 0 | 0.60 | Bass rumble through wall |

At readout: **gain = LF** (the louder component), **spectral tilt = HF/LF** ratio → lowpass cutoff frequency.

### 2.3 Merge-compatible properties

For a value to propagate correctly through the cascade's hierarchical merge, it must behave like a **radiance** — satisfying two properties:

1. **Over-composability:** composes as `combined = near + far × near_transmittance`
2. **Linearity:** weighted sums give correct totals under angular averaging

Path properties like spectral slope (a cumulative exponent) fail both requirements. We learned this the hard way: slope produced directional artifacts in the merge because it doesn't compose like radiance. The solution was the two-channel approach — both HF and LF are radiances with different propagation parameters. The spectral information is recovered from their RATIO at readout, not carried as a separate non-radiance value.

### 2.4 Acoustic bounces

The bounce shader (which drives multi-bounce visual GI) also handles acoustic reflections:

- Reads previous frame's fluence alpha (broadband acoustic) at each wall probe
- Re-emits `fluence × albedo / 2π` into the bounce texture alpha
- The seed reads bounce alpha and adds it to BOTH acoustic channels
- Each bounce loses 30% of HF energy (`BOUNCE_HF_LOSS = 0.7`), modeling frequency-dependent surface absorption

This enables sound around corners, through L-corridors, and in enclosed rooms. Multi-bounce sound progressively warms (loses treble) — matching real room acoustics where reverberant sound is always bassier than direct sound.

### 2.5 What this does NOT model

- **Wave interference / room modes.** No constructive/destructive superposition or standing waves.
- **Impulse response timing.** We compute how much energy arrives, not when.
- **True diffraction.** Sound wrapping around obstacles follows the cascade's penumbra structure — qualitatively plausible, quantitatively approximate.
- **Per-material acoustic properties.** All surfaces use the same mass law parameters. Custom absorption/reflection per material would require extending the material texture.

---

## 3. Data Layout

### 3.1 Ray buffer

`vec4u` = 16 bytes (same as vec3u due to WGSL alignment — the 4th u32 was wasted padding):
- u32[0-1]: `packF16(R, G, B, trans)` — visual radiance + transmittance
- u32[2]: `pack2x16float(acousticHF, acousticLF)` — two acoustic channels
- u32[3]: `pack2x16float(transLF, 0)` — LF transmittance (HF uses visual trans)

### 3.2 Merge buffer

`vec2u` = 8 bytes: `packRGB9E5(visual)` + `pack2x16float(acousticHF, acousticLF)`.

### 3.3 Fluence buffer

`packF16(R, G, B, acousticHF)`. HF in alpha (shares visual precision path).

### 3.4 LF buffer

Separate `rgba16float` probe-resolution buffer for acousticLF. Uses identical `packF16` precision path as fluence to avoid ratio artifacts from precision mismatch.

### 3.5 Pan buffer

`f32` per probe. Stores `result_lf × cos(angle_to_listener)` accumulated from all 4 directions. The gather splits positive/negative contributions per channel.

### 3.6 Material texture

`rg8unorm`. R = albedo, G = audio channel ID (0=none, 1=listener, 2-255=sources). Written per-pixel via MRT.

### 3.7 Channel accumulator

1024 `u32` entries (atomic): channels 0-255 = HF gain, 256-511 = LF gain, 512-767 = pan positive, 768-1023 = pan negative.

---

## 4. Gather Pass

A compute pass at **screen resolution**. For each pixel with channel ID >= 2:
1. Read HF fluence, LF fluence, and pan at the probe position
2. Multiply each by `(1-trans)` — surface absorption (identical to visual light absorption)
3. `atomicAdd` into per-channel accumulators

This models sound reception at the shape's **surface**. Edge pixels contribute (exposed to the acoustic field). Interior pixels contribute nothing (field blocked by outer layers). Every pixel of a source shape participates, not just the center.

---

## 5. Readout

### Per-channel values

```
gain      = LF_gathered / listener_perimeter     // 0..~1, with pow(g, 0.4) curve for dynamics
hfRatio   = HF_gathered / LF_gathered            // 1.0 = flat, <1.0 = treble cut
pan       = (pan_pos - pan_neg) / LF_gathered    // [-1, +1]
```

### Audio DSP chain

```
source (Feather.mov) → lowpass biquad → gain node → compressor/limiter → stereo panner → output
```

- **Lowpass cutoff** = `200 + sqrt(hfRatio) × 19800` Hz. Open air → 20kHz (flat). Through wall → 200Hz (bass only).
- **Gain** = `pow(min(gain, 1.0), 0.4)` — power curve compresses dynamic range so quiet signals (behind walls) remain audible.
- **Pan** = geometric direction from listener to source probe, gain-weighted across source pixels.
- **Compressor** at -3dB threshold, 20:1 ratio — acts as limiter to prevent clipping from hot bass content.
- **Smoothing** via `setTargetAtTime` (50ms time constant) on all parameters to prevent clicks from frame-to-frame changes.

---

## 6. Lessons Learned

### Slope doesn't work in a cascade

The original design used an additive "slope" value (spectral tilt exponent) propagated through the cascade. This failed because slope is a **path property** (accumulated along a ray), not a **field quantity** (amount arriving from a direction). It doesn't satisfy over-composability or linearity. Every attempt — additive composition, gain-weighted products, over-composite — produced directional artifacts in the merge.

The fix: two radiance channels with different transmittance. Both satisfy merge-compatible properties. The spectral information is recovered from their ratio at readout.

### Precision matching is critical

The two acoustic channels must use **identical** sampling methods and storage precision everywhere. The original artifacts that plagued the HF channel for days turned out to be `textureSampleLevel` (bilinear) vs `textureLoad` (point sampling) on different textures containing the same data. Even f16 vs f32 storage precision creates visible ratio artifacts.

### The LF/HF flip

The initial model had broadband (shares visual trans) + HF (extra attenuation). This was backwards. The correct physical model: HF shares visual trans (high frequencies interact with media like light), LF gets its own more-permissive trans (bass passes through). This gives:
- No spurious treble cut in direct view (HF = visual, ratio = 1)
- Bass leaks through solid walls (transLF has wall permeability)
- Bounced sound retains full spectrum (both channels receive bounce energy)
- Smooth degradation around corners (bass persists when HF is blocked)

---

## 7. Future Extensions

### Improved stereo pan

Current pan uses geometric direction from listener to probe. This works for direct paths but not for multi-bounce indirect paths (sound arriving from a corridor to the left still pans based on geometric source position). A proper solution would propagate pan-weighted acoustic as a separate over-composable channel.

### Per-material acoustic properties

Extend material texture to carry per-surface acoustic parameters (absorption coefficient, mass). Currently all surfaces use the same global LF_FACTOR and BASS_WALL_PERM.

### Multiple listeners

Each listener occupies one acoustic channel pair (HF + LF). Two listeners would need 4 acoustic f16 values in the ray buffer, or a separate cascade pass.

### Decay rate estimation

Compare frame-to-frame bounce convergence to estimate reverberant decay rate. Could feed into algorithmic reverb tail length.

---

## 8. References

- Freeman, Sannikov, Margel. "Holographic Radiance Cascades for 2D Global Illumination." arXiv:2505.02041 (2025).
- Sannikov. "Radiance Cascades: A Novel Approach to Calculating Global Illumination." (2023).
- Yaazarai. Volumetric HRC. github.com/Yaazarai/Volumetric-HRC.
- m4xc. "Fundamentals of Radiance Cascades." m4xc.dev (2024).
- Raghuvanshi et al. Project Triton / Project Acoustics, Microsoft Research.
- Valve. Steam Audio. valvesoftware.github.io/steam-audio.
- Cremer, Müller. "Principles and Applications of Room Acoustics."
