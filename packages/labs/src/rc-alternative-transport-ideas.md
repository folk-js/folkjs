# Alternative Light Transport for Radiance Cascades

Ideas for reducing memory and compute in the radiance cascade pipeline while preserving its core properties: **scene-independent cost**, **hierarchical angular refinement**, and **correct occlusion**.

These are not about lowering resolution or quality — they're structural changes to how light information is encoded and queried.

---

## 1. Circular Harmonic Cascades (angular compression)

### Core idea

Replace discrete angular bins with circular harmonic (CH) coefficients — the 2D analogue of spherical harmonics.

Currently, each cascade probe stores pre-averaged radiance in angular bins, tiled spatially across the cascade texture (`sqrtBins × sqrtBins` grid). With CH encoding, each probe stores a small number of analytic coefficients instead.

### What are circular harmonics?

The angular radiance distribution L(θ) at a probe can be decomposed:

```
L(θ) = a₀ + a₁ cos(θ) + b₁ sin(θ) + a₂ cos(2θ) + b₂ sin(2θ) + ...
```

- **Band 0** (1 coefficient): DC — total irradiance, omnidirectional
- **Band 0+1** (3 coefficients): DC + dipole — captures mean intensity and dominant direction
- **Band 0+1+2** (5 coefficients): adds quadrupole — captures two-lobed distributions

For most 2D GI, bands 0+1 (3 coefficients) capture the vast majority of the signal.

### What changes in the cascade

- **Storage**: Instead of `sqrtBins × sqrtBins` angular tiles, store 3-5 CH coefficients per probe. Cascade textures shrink because the spatial tiling for angular bins is eliminated. Each probe is just 3 floats (band 0+1) instead of however many bins.

- **Pre-averaging**: The current pre-averaging step (4 sub-rays → 1 bin average) becomes analytic integration over the sub-angle range. This is exact rather than approximate — you project the ray's contribution onto CH basis functions with known integrals.

- **Cascade merging**: CH coefficients interpolate smoothly and linearly. The bilinear-fix heuristic (currently 4 rays × 4 upper probes = 16 rays per bin) simplifies because CH coefficients are continuous functions that bilinearly interpolate correctly by construction. No ringing/parallax artifacts from discrete bin boundaries.

- **Fluence resolve**: Extracting per-pixel irradiance from CH coefficients is a single dot product per pixel (evaluate the CH at the desired angle, or just read the DC term for omnidirectional irradiance).

### What doesn't change

Ray marching is still needed to produce the CH coefficients at each probe. The SDF, JFA, and world texture pipeline remain the same. The scene-independent cost guarantee is preserved.

### Expected savings

- ~1.5-2× reduction in cascade texture memory and bandwidth
- Simpler, more correct cascade merging (no bilinear fix needed)
- Slightly less compute per cascade level (fewer angular tiles to process)
- Incremental improvement, not an order-of-magnitude change

### Open questions

- What's the minimum CH band count that looks acceptable? Band 0+1 (3 coefficients) might be too smooth for scenes with sharp directional lighting. Band 0+1+2 (5 coefficients) is probably sufficient.
- How does CH projection interact with the cascade's interval merging (transmittance compositing)? Transmittance is a multiplicative operation which doesn't trivially compose in the CH basis.

---

## 2. Hierarchical SDF Ray March (min-mipmap acceleration)

### Core idea

Replace the variable-length, step-by-step SDF ray march with a bounded-depth hierarchical query on a min-mipmapped SDF. Reduces per-ray cost from O(interval_length) to O(log(interval_length)).

### Current ray march cost

Each ray in `marchRay()` walks along its interval, sampling the SDF at each step:

```wgsl
while (t < remaining) {
    let dist = sampleSDF(pos);        // texture read
    if (dist >= remaining - t) break;  // empty space skip
    if (dist < 1.0) {
        // near surface: sample world texture, advance by 1
    } else {
        t += dist;                     // sphere trace jump
    }
}
```

SDF sphere tracing already skips large empty regions, but near surfaces or in cluttered areas, rays take many 1-pixel steps. The number of steps per ray is variable (bounded but data-dependent in practice). The total ray count is scene-independent (fixed by cascade structure), but per-ray cost can vary.

### Min-mipmap SDF

Build a mipmap of the SDF where each coarser level stores the **minimum** SDF value in the block:

```
mip0[x,y] = sdf[x,y]                          // original SDF
mip1[x,y] = min(mip0[2x,2y], mip0[2x+1,2y],
                mip0[2x,2y+1], mip0[2x+1,2y+1])
mip2[x,y] = min(mip1[2x,2y], ...)
...
```

This is O(N) to compute (standard mipmap reduction) and 1.33× the memory of the base SDF. It's scene-independent — always the same number of mip levels regardless of content.

### Hierarchical ray march

Instead of stepping along the ray, query the mipmap top-down:

1. At the coarsest mip level, a single read gives the minimum distance anywhere in a large region that the ray passes through.
2. If `min_dist > interval_length`, the entire interval is guaranteed empty → no hit, done in 1 read.
3. If not, descend one mip level. Check only the sub-regions that overlap the ray's path.
4. Continue descending until either finding guaranteed emptiness or reaching the base level where precise SDF values are available.

Total texture reads per ray: **O(log(interval_length))** instead of O(interval_length).

### Properties

- **Scene-independent**: The mipmap has fixed depth (log₂ of screen size). Traversal depth is bounded by mip levels, not scene content.
- **Conservative**: Min-mipmap can give false positives ("might be geometry here" when there isn't, because the minimum came from a different part of the block) but never false negatives. Correctness is preserved — you just do extra work sometimes.
- **Biggest win on upper cascade levels**: Higher cascade levels have longer intervals (up to screen diagonal). These benefit most from hierarchical skipping. Level 0 intervals are short and already cheap.

### Implementation sketch

```
fn marchRayHierarchical(origin, dir, intervalStart, intervalLength) -> vec4f {
    // Start from coarsest useful mip level
    let maxMip = u32(log2(intervalLength));

    // Walk through mip hierarchy
    for (var mip = maxMip; mip >= 0; mip--) {
        let blockSize = 1 << mip;
        // Check if ray segment intersects any geometry at this mip level
        let minDist = sampleSDFMip(pos, mip);
        if (minDist > remainingInterval) {
            // Entire block is clear, skip ahead
            break;
        }
        // Otherwise, descend to finer level
    }
    // At base level, do precise SDF march for the remaining short segment
}
```

The exact traversal logic needs care — this is the implementation challenge. The ray needs to step through the mip grid cells it intersects, checking each one, descending only where the min-mip indicates possible geometry.

### Expected savings

- Significant compute reduction for upper cascade levels (levels with long intervals)
- Modest savings for level 0 (short intervals, already fast)
- Memory cost: +33% for the SDF mipmap (much less than cascade texture savings)
- Overall: could reduce total ray march time by 2-4× depending on scene geometry and cascade depth

### Open questions

- What's the optimal traversal strategy? DDA-style grid walking at each mip level, or recursive descent?
- How does this interact with the bilinear SDF sampling currently used (`textureSampleLevel`)? Min-mipmaps should use nearest-neighbor at coarse levels to preserve the conservative property.
- Is there a way to encode the mip traversal as a fixed-iteration loop (no dynamic branching) for better GPU occupancy?

---

## 3. Factored Visibility–Radiance Transport

### Core idea

Separate the two questions currently entangled in each ray march:
1. **Visibility**: Is there geometry along this ray, and at what distance?
2. **Radiance**: What color is the geometry at the hit point?

Currently both are answered in the same `marchRay()` call, which reads both the SDF and the world texture. By factoring them, each can use a more appropriate (and potentially cheaper) representation.

### Factored pipeline

**Visibility pass** — for each probe/direction, compute only:
- Hit distance (or "no hit" sentinel)
- Transmittance (0 or 1 for opaque scenes)

Store in a compact format: `r16float` per probe/direction (half the bandwidth of `rgba16float`). This is the expensive pass (SDF traversal) but its output is small.

**Radiance gather** — given the hit distances:
- Look up emitter color from the world texture at the hit position
- Single `textureLoad` per probe/direction
- Combine with transmittance and upper cascade value

This is cheap (one texture read per entry) and operates on the full-color world texture.

### Why this might help

- The **visibility pass** can run at reduced precision. Hit distances don't need float16 color precision — they're scalar values with limited range. Using `r16float` or even `r8unorm` (normalized transmittance) halves or quarters the bandwidth.

- The **visibility pass** is the candidate for hierarchical acceleration (idea 2). Factoring it out means the min-mipmap traversal only needs to produce a distance, not also sample colors.

- **Visibility varies more slowly than color** spatially. It might be possible to compute visibility at half resolution and upsample, while doing the radiance lookup at full resolution. This would halve the expensive part.

- The factored representation makes it easier to **cache visibility across frames**. If geometry hasn't moved, visibility doesn't change. Temporal reuse of the visibility buffer could skip the march entirely for static regions (detected via SDF comparison with previous frame).

### Risks

- The factored approach adds a synchronization point (visibility must complete before radiance gather). This might negate the bandwidth savings if it prevents pipeline overlap.
- Reduced-resolution visibility introduces artifacts at shadow edges. Whether this is acceptable depends on the application.
- Temporal caching of visibility requires change detection, adding complexity.

### Expected savings

- 2× bandwidth reduction in the march pass (scalar vs RGBA output)
- Potentially 2× compute reduction if visibility is computed at half resolution
- Temporal reuse could eliminate the march entirely for static frames (but this is speculative)
- Most impactful when combined with idea 2 (hierarchical march produces only distances)

---

## Composition

These ideas are not mutually exclusive. A combined approach might look like:

1. **Min-mipmap SDF** for hierarchical ray acceleration (idea 2)
2. **Factored visibility** to reduce march output bandwidth (idea 3)
3. **CH coefficients** for cascade storage and merging (idea 1)

The march produces scalar visibility/distance (idea 3), accelerated by min-mipmaps (idea 2). The radiance gather projects results into CH coefficients (idea 1) for storage, merging, and fluence resolve.

Total memory compared to current: cascade textures shrink (fewer angular tiles from CH), SDF grows slightly (min-mipmap), visibility buffer is compact (scalar). Net reduction likely 2-3×.

Total compute compared to current: ray march cost reduced by hierarchical traversal and halved output, merge simplified by CH interpolation. Net reduction likely 2-4×.

---

## Non-viable directions considered

- **FFT convolution for free-space light transport**: Produces unoccluded fluence efficiently, but handling occlusion reintroduces scene-dependent convergence. Violates RC's core guarantee.
- **Prefix-sum / discrete ordinates sweeps**: Well-established technique (S_N methods, 1960s). Gives up hierarchical angular refinement — fixed angular resolution everywhere. Not radiance cascades.
- **Diffusion / Poisson solvers**: O(N) cost but inherently produces soft, wrapping light. No sharp shadows. Wrong physical model for geometric optics.
- **Iterative methods (radiosity, Neumann series)**: Scene-dependent convergence. Non-starter.
