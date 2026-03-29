## Critical Review of `folk-holographic-rc.ts` Against Reference Implementations

### 1. Resolution Assumption: The Root of All Problems

**All three references require or assume power-of-2 square resolution.** This is the single most important fact to internalize.

- **Amitabha:** `assert!(display_size.is_power_of_two());` -- it literally asserts power-of-2. `SIZE = DISPLAY_SIZE / 2`, and `num_cascades = SIZE.trailing_zeros()`. Every bit-shift is guaranteed to be exact division.
- **Yaazarai:** The Create*0 comment says it plainly: *"The only relevant HRC setting is resolution, which must always be square and a power of 2."\_ `render_extent = 512`.
- **TSBK03 paper:** Uses a separate `probe grid size` `s_p = (w_p, h_p)` that can differ from screen size, and handles non-power-of-2 probe counts with careful floor-division formulas and `GL_CLAMP_TO_BORDER` with border color 0. But critically, it has _separate ray textures per cascade level_, each right-sized with the exact formula.

**Your code** tries to run HRC at arbitrary window resolution (e.g. 1440x900) and papers over it with `nextPowerOf2` padding. This is the fundamental source of both the performance problem (wasted work) and the correctness problem (boundary math doesn't match what the shader expects).

**Recommendation:** Consider decoupling the HRC probe grid resolution from the screen resolution. You could run HRC at, say, 512x512 or 1024x1024 (power-of-2, square) and bilinearly upscale the fluence to screen resolution. This is exactly what the TSBK03 paper does (section 3.2: _"We give this grid any desired size s_p"_). This would instantly solve both the performance and artifact problems.

---

### 2. Architecture: Single-Pass vs Multi-Phase

The three references all separate HRC into distinct phases:

| Phase                | Amitabha                                                                       | Yaazarai                                         | TSBK03                                       | Your Code                            |
| -------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------- | ------------------------------------ |
| Ray computation      | "Merge up" kernel (trace or extend)                                            | `Shd_FrustumSeed` + `Shd_Extensions`             | Ray tracing pass + ray merging pass          | Combined in `cascadeMergeShader`     |
| Storage              | Per-cascade buffers in `cache_pyramid`                                         | Per-cascade texture pairs (rays + transmittance) | Per-cascade ray textures                     | **None** -- rays computed on-the-fly |
| Cone merging         | Separate "Merge Down" kernel                                                   | `Shd_MergingCones`                               | Angular fluence merging pass                 | Same shader as above                 |
| Fluence accumulation | `finish_kernel` writes per-direction radiance into a 3D texture, then filtered | `Shd_FluenceSum` sums 4 frustum textures         | Additive blending into final fluence texture | `fluenceAccumShader` ping-pongs      |

**Your approach** of doing everything in one shader is a bold simplification. The `cascadeMergeShader` traces rays via `traceRay()` and immediately merges with `readPrev()` from the previous cascade level. This means:

- **No ray storage at all.** Every cascade level recomputes rays from scratch by tracing through the world texture. The references all store rays and reuse them.
- **The shader is doing significantly more work per invocation** than the cone-merging shaders in the references, because it includes the ray-tracing loop.
- **Ray extensions are impossible** without stored ray data. References use ray extensions (combining shorter rays from the previous cascade to form longer rays) as the primary acceleration mechanism for higher cascades. Your code always traces fresh, which means every cascade level pays the full ray-tracing cost proportional to its ray length.

This is actually a major performance concern independent of the power-of-2 issue. At cascade level N, rays are `2^N` pixels long, and you trace every pixel. The references only trace rays for the first 1-2 cascade levels, then use O(1) ray extensions for all higher levels.

---

### 3. Texture Architecture: Oversized Square Textures

**Your code** allocates cascade ping-pong textures as:

```551:552:packages/labs/src/folk-holographic-rc.ts
    this.#maxCascadeDim = nextPowerOf2(Math.max(width, height));
    this.#numCascades = Math.log2(this.#maxCascadeDim);
```

For a 1440x900 screen: `maxCascadeDim = 2048`, each cascade texture is `2048x2048` in `rgba16float` = **32 MB for the pair**. These are cleared 8 times per frame (2 textures x 4 directions).

**Amitabha** uses flat buffers, not textures. Each cascade level `i` gets a buffer sized exactly to `(SIZE >> i) * SEGMENTS * SIZE * (2 << i + 1)`. No wasted space.

**Yaazarai** allocates per-cascade textures, each right-sized:

```gml
var raysw = floor(render_extent / interval) * rays;
vrays_radiance[i] = surface_build(raysw, render_extent, ...);
```

No wasted space per-level.

**TSBK03** also right-sizes per-cascade ray textures and uses a single ping-pong pair for angular fluence sized to the maximum needed.

**Your single pair of square textures is doing triple duty** -- they store the output of every cascade level across every direction. The excess area is zeroed out by expensive full-texture clears.

---

### 4. Clearing: The Hidden Performance Killer

```857:867:packages/labs/src/folk-holographic-rc.ts
      for (const view of this.#cascadeTextureViews) {
        const bg = device.createBindGroup({
          layout: this.#clearPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: view }],
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#clearPipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(clearWG, clearWG);
        pass.end();
      }
```

This dispatches `ceil(2048/16)^2 = 128*128 = 16,384` workgroups to clear each texture, done **twice** (both textures), done **four times** (each direction). That's **131,072 clear workgroup dispatches per frame**, each touching 256 texels. That's clearing 33.5 million texels per frame _just for clears_.

**Yaazarai** clears each surface with `draw_clear_alpha` just before writing, but each surface is right-sized.

**TSBK03** uses `GL_CLAMP_TO_BORDER` with border color 0 -- reads outside the valid region automatically return zero. **No clearing needed at all** for out-of-bounds reads.

Your `readPrev` could achieve the same by bounds-checking against the actual valid data region rather than clearing everything.

---

### 5. `readPrev` Bounds Checking: The Correctness Gap

Current code:

```136:143:packages/labs/src/folk-holographic-rc.ts
fn readPrev(perpIdx: i32, alongIdx: i32, angleIdx: u32, numAng: u32) -> vec3f {
  let x = f32(alongIdx * i32(numAng) + i32(angleIdx)) + 0.5;
  let y = f32(perpIdx) + 0.5;
  let dims = vec2f(textureDimensions(prevCascade));
  let uv = vec2f(x, y) / dims;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec3f(0.0); }
  return textureSampleLevel(prevCascade, cascadeSampler, uv, 0.0).rgb;
}
```

The bounds check is against `textureDimensions(prevCascade)`, which is the full `2048x2048`. But valid data occupies only `nextAlongSize * nextNumAngles` texels wide and `perpSize` texels tall. Everything outside that is stale data from previous writes to the same ping-pong texture.

**The TSBK03 paper** solves this with clamp-to-border (reads outside = vacuum). **Amitabha** solves it with explicit bounds checking in `BufferStorage::load`:

```rust
fn load(...) -> Expr<R> {
    let cell = probe.cell.cast_u32();
    if (cell >= grid.size).any() {
        R::black().expr()
    } else {
        params.read(...)
    }
}
```

Your `readPrev` needs to check `perpIdx` and `alongIdx` against the actual valid ranges (`params.perpSize` and `params.nextAlongSize`), not against the texture dimensions. Without this, the texture clears are the _only_ thing preventing stale data reads -- and they're enormously expensive.

---

### 6. `DirConfig` and Direction Handling

Your `DirConfig` approach:

```343:368:packages/labs/src/folk-holographic-rc.ts
interface DirConfig {
  alongAxis: [number, number];
  perpAxis: [number, number];
  originFn: (w: number, h: number) => [number, number];
  perpSize: (w: number, h: number) => number;
  alongBase: (w: number, h: number) => number;
}
```

Compared to the references:

- **Amitabha** encodes direction as a rotation vector `[Vec2::x(), Vec2::y(), -Vec2::x(), -Vec2::y()]` and derives everything from it. It uses "segments" with 2 sub-segments per direction (for even/odd row interleaving), totaling 8 segments. The origin, x_dir, y_dir are all computed from the rotation.

- **Yaazarai** rotates the entire scene into each frustum direction using `frustum_index` in the shader. The scene is conceptually always "facing East" and gets rotated. This means the same shader code works for all 4 directions without any direction-specific parameters.

- **TSBK03** defines `X()` and `Y()` accessor functions that swap coordinates based on whether the direction is horizontal or vertical, and flips for negative directions.

Your approach of passing origin, axes, perpSize, and alongBase as separate values works but creates a lot of per-direction CPU/GPU data that the references avoid through more elegant parameterization. The `originFn` functions are the most concerning: `(w) => [w, 0]` for West and `(_w, h) => [0, h]` for North. These were bug-fixed from `[w-1, 0]` and `[0, h-1]`. Whether `w` or `w-1` is correct depends on how `toWorld` interprets the origin relative to pixel centers.

---

### 7. CPU/GPU Boundary: What Crosses and What Shouldn't

**Your uniform data per cascade level** (the `CascadeParams` struct) has 16 fields / 64 bytes:

```105:122:packages/labs/src/folk-holographic-rc.ts
struct CascadeParams {
  perpSize: u32,
  alongSize: u32,
  numAngles: u32,
  spacing: f32,
  nextNumAngles: u32,
  nextSpacing: f32,
  nextAlongSize: u32,
  isLastCascade: u32,
  screenW: f32,
  screenH: f32,
  originX: f32,
  originY: f32,
  alongAxisX: f32,
  alongAxisY: f32,
  perpAxisX: f32,
  perpAxisY: f32,
};
```

This is uploaded for every (direction, level) combination. With 4 directions x ~11 levels, that's ~44 uniform uploads per frame. Several of these are constant across levels within a direction (`screenW`, `screenH`, `originX/Y`, `alongAxisX/Y`, `perpAxisX/Y`) and could be factored out.

**Amitabha** passes just `Grid { size: Vec2<u32>, directions: u32 }` (12 bytes) per dispatch. Direction info is baked into the segment buffer which is static.

**Yaazarai** passes `cascade_size`, `cascade_index`, and texture references -- minimal per-dispatch data.

Additionally, you **create bind groups inside the render loop** every frame:

```886:895:packages/labs/src/folk-holographic-rc.ts
        const bg = device.createBindGroup({
          layout: this.#cascadeMergePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#worldTextureView },
            { binding: 1, resource: readView },
            { binding: 2, resource: writeView },
            { binding: 3, resource: { buffer: this.#cascadeParamsBuffer, offset: paramsOffset, size: 64 } },
            { binding: 4, resource: this.#linearSampler },
          ],
        });
```

This creates ~44 bind groups per frame for cascade processing, plus ~4 for accumulation, plus clear bind groups. WebGPU bind group creation is relatively lightweight but this is still allocation churn that every reference avoids by pre-creating bind groups.

---

### 8. Fluence Accumulation: The 1-Pixel Offset

**Yaazarai's `Shd_FluenceSum`** applies a 1-pixel offset when sampling each frustum:

```glsl
vec2 pixel = vec2(1.0, 0.0) / world_size;
offsets[0] = in_TexelCoord + pixel.xy; // East: offset +1 along x
offsets[1] = in_TexelCoord - pixel.yx; // South: offset -1 along y
offsets[2] = in_TexelCoord - pixel.xy; // West: offset -1 along x
offsets[3] = in_TexelCoord + pixel.yx; // North: offset +1 along y
```

The comment explains: _"Offset 1px into each frustum, otherwise you get sampling overlap between frustums."_

**TSBK03** (section 3.9) confirms: _"Since the first cones of any direction's cascade 0 starts one step along that direction, each probe will receive fluence from rays starting at neighboring probes. This is intentional, as the four cascade-0 cones that start from any single probe have overlapping rays along the diagonals and would thus cause biases in brightness along those diagonals."_

**Your `fluenceAccumShader`** does coordinate rotation but no 1-pixel offset along the frustum direction:

```276:282:packages/labs/src/folk-holographic-rc.ts
  switch (params.direction) {
    case 0u: { cc = vec2i(gid.xy); }
    case 1u: { cc = vec2i(i32(gid.y), i32(gid.x)); }
    case 2u: { cc = vec2i(i32(params.screenW) - 1 - i32(gid.x), i32(gid.y)); }
    case 3u: { cc = vec2i(i32(params.screenH) - 1 - i32(gid.y), i32(gid.x)); }
    default: { cc = vec2i(gid.xy); }
  }
```

This maps screen pixel to cascade-0 texel, but doesn't account for the fact that cascade-0 probes start 1 pixel _into_ the frustum, not at the edge. This could be a source of edge artifacts independent of the power-of-2 issue.

---

### 9. Ray Count / Direction Count

| Reference | At Level n    | Directions/Cones                   | Rays                           |
| --------- | ------------- | ---------------------------------- | ------------------------------ |
| TSBK03    | Cascade n     | 2^n cones                          | 2^n + 1 rays                   |
| Yaazarai  | Cascade n     | `interval = 2^n` cones             | `interval + 1` rays            |
| Amitabha  | Level i       | `directions = 2 << i = 2^(i+1)`    | dispatch with `directions + 1` |
| Your code | Level `level` | `numAngles = 1 << level = 2^level` | Not stored; implied in merge   |

Amitabha's direction count at level `i` is `2^(i+1)`, which is twice your `numAngles` at the same level. Looking at Amitabha's `merge` function:

```rust
let lower_dir = dir * 2;
let upper_dir = dir * 2 + 1;
```

This splits each direction into two sub-directions at the next level, just like your code does with `angleIdx * 2` and `angleIdx * 2 + 1`. The factor-of-2 difference between Amitabha's `directions` and your `numAngles` seems to be an indexing convention difference rather than a functional one -- Amitabha indexes individual rays/directions, you index cones. The merge logic appears equivalent.

---

### 10. Number of Cascade Levels

- **Amitabha:** `num_cascades = SIZE.trailing_zeros()` where `SIZE = DISPLAY_SIZE / 2`. For DISPLAY_SIZE=1024, SIZE=512, num_cascades=9.
- **Yaazarai:** `render_count = ceil(log2(render_extent))`. For render_extent=512, render_count=9.
- **TSBK03:** `N_horizontal = ceil(log2(w_p - 1))`, `N_vertical = ceil(log2(h_p - 1))`. Different per axis.
- **Your code:**

```
this.#numCascades = Math.log2(this.#maxCascadeDim);
// maxCascadeDim = nextPowerOf2(max(width, height))
// For 1440x900: maxCascadeDim = 2048, numCascades = 11
```

But then you also compute per-direction cascade counts:

```
const dirCascades = Math.log2(alongBase); // per-direction
```

For East/West with width=1440: `alongBase = nextPowerOf2(1440) = 2048`, `dirCascades = 11`.
For South/North with height=900: `alongBase = nextPowerOf2(900) = 1024`, `dirCascades = 10`.

The global `#numCascades` (11) is used for buffer sizing, but `dirCascades` controls the actual iteration. The interaction between these two is confusing and error-prone -- `#numCascades` allocates slots for cascade params at 256-byte offsets, and `dirCascades` may index into different ranges.

---

### Summary: Ranked by Impact

1. **Use a fixed power-of-2 probe grid.** Decouple probe resolution from screen resolution. This is what every working implementation does. Upscale the fluence texture to screen resolution with bilinear sampling at zero cost.

2. **Add explicit bounds checking in `readPrev`** against `params.perpSize` and `params.nextAlongSize`. Then you can eliminate the full-texture clears entirely (or reduce them to clearing only the valid region).

3. **Consider right-sizing cascade textures** per-level (or at minimum, per-direction) instead of one giant square pair. Alternatively, if you keep the single pair, at least use rectangular textures sized to `max(flatSize_across_all_levels) x max(perpSize)` per direction.

4. **Add the 1-pixel frustum offset** in fluence accumulation, matching Yaazarai and TSBK03.

5. **Consider separating ray computation from cone merging** and implementing ray extensions for higher cascades, which would dramatically reduce per-invocation cost at high cascade levels.

6. **Pre-create bind groups** instead of creating them in the render loop.

7. **Simplify `CascadeParams`** -- factor out per-direction constants from per-level uniforms.
