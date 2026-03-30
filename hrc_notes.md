# HRC Implementation: Current State and Optimization History

## Architecture

WebGPU implementation of Holographic Radiance Cascades (HRC) following the Yaazarai/Amitabha/TSBK03 multi-phase architecture:

| Phase | Shader | Description |
|---|---|---|
| Seed | `raySeedShader` | Samples world textures at each probe position → level-0 ray data |
| Extend | `rayExtendShader` | Bottom-up ray composition (levels 1..nc-1), crossed L→R / R→L averaging |
| Merge | `coneMergeShader` | Top-down cone merge (levels nc-1..0), even/odd probe interpolation |
| Fluence | Fused into level-0 merge | Direction remap + additive accumulation across 4 directions |
| Blit | `blitShader` | Bilinear upscale from probe res to screen res, tonemap, dither |

Additional systems: diffuse bounces (screen-res bounce texture fed back into seed), per-channel volumetric transport, 2D path tracer for ground truth comparison.

## Current Performance (ps=1024, nc=10, 1660×1030)

- **Frame time:** ~12ms (mono transmittance), ~16ms (per-channel transmittance)
- **Bandwidth:** ~3.6GB/frame (mono), ~5.4GB/frame (per-channel)
- **Dispatches:** 80 compute passes per frame (4 dirs × (1 seed + 9 extend + 10 merge))
- **Ray texture storage:** ~151MB (10 levels × rgba16float radiance + rgba8unorm transmittance)

Bandwidth breakdown: Extend ~45%, Merge ~50%, everything else ~5%.

## Optimization History

### Phase 1: Architecture (largest gains)

**Separated seed + extend + merge phases** — Original implementation had a single-pass `cascadeMergeShader` that traced rays from scratch at every cascade level. Higher levels traced 2^N pixels per ray, making cost proportional to ray length. Separating into seed (world sample) → extend (O(1) ray composition) → merge (cone integration) reduced the per-level cost from O(2^N) to O(1).

**Per-level right-sized ray textures** — Original used oversized square ping-pong textures (2048×2048) cleared 8× per frame. Now each level has its own texture sized to `(ps >> level) × ((1 << level) + 1) × ps`.

**Decoupled probe grid from screen resolution** — Power-of-2 square probe grid (ps × ps) with bilinear upscale to screen resolution in the blit shader. Matches TSBK03 approach.

**Eliminated full-texture clears** — Bounds checking in `loadPrev`/`loadRay`/`loadMerge` returns vacuum (radiance=0, transmittance=1) for out-of-bounds reads. No clearing needed.

### Phase 2: Per-frame overhead reduction

**Pre-created bind groups** — Seed, extend, merge, blit, and bounce bind groups are all pre-created at init/resize. Zero `createBindGroup` calls per frame in the standard path.

**Static uniform uploads** — Seed params (per-direction), extend params (per-level), and merge params (per-direction-level) are uploaded once at init/resize. Only blit params (exposure) are written per frame.

**Seed dispatch halved** — Both ray texels per probe get identical seed data. Reduced from `ps*2 × ps` dispatch to `ps × ps`, each thread writing 2 adjacent texels.

**Mouse light dirty flag** — Skip mouse circle rebuild when mouse hasn't moved.

### Phase 3: Format optimization

**Opacity texture: rgba16float → rgba8unorm** — Values are [0,1], 256 levels is sufficient. Halves memory and bandwidth for a texture read by seed (4×) and blit (1×).

**Mono transmittance toggle** — Override-constant pipeline variants. When enabled, transmittance is packed into ray texture alpha (dot(trans, 0.333)), eliminating all trans texture reads/writes. ~33% total bandwidth reduction. Per-channel colored glass attenuation is lost; solid/transparent scenes are visually identical.

### Phase 4: Structural simplification

**Fused fluence accumulation into level-0 merge** — The level-0 merge (numCones=1) writes directly to the fluence texture with direction-dependent coordinate remapping and 1px frustum offset. Eliminates: separate `fluenceAccumShader`, `fluenceAccumPipeline`, accumulation UBO, 4 accum dispatches per frame.

**Shared WGSL snippets** — `blitCommon` string with tonemap, dither, vertex shader shared between HRC blit and PT blit. `tonemapAndDither()` helper.

**Helper functions** — `tex()`, `bg()`, `computePipeline()`, `fullscreenBlit()`, `attr()` reduce WebGPU boilerplate. `TEX_RENDER`/`TEX_STORAGE` usage constants.

### Phase 5: Correctness fixes

**Path tracer step-0 sampling** — PT now samples the starting pixel before marching, matching the blit's `emission * opacity` self-contribution.

**Probe-scale transmittance** — Seed computes `trans = pow(1-opacity, scaleAlong)` to account for probe footprint covering multiple pixels in the opacity texture.

**Bounce surface fluence sampling** — Transparency-weighted average of cardinal neighbors (not max) prevents both brightness bias and iterative light diffusion through thick walls.

**Shape rotation support** — Reads `folk-shape` rotation property directly, computes rotated corner vertices for triangle rasterization.

## Approaches Attempted and Rejected

**Bottom-up radiance accumulation** — Attempted to replace the top-down merge with a bottom-up scheme that processes extend+merge at each level sequentially, needing only 2 ray texture pairs. Failed because the spatial discontinuities (no even/odd probe averaging) created severe power-of-2 banding that the 4-direction averaging could not mask.

**Chunked re-extension (2 ray textures)** — Attempted to keep only 2 ray textures and re-seed + re-extend for each pair of merge levels consumed top-down. Was 2× slower due to redundant extend bandwidth exceeding any cache benefit.

**Direction sharing** — Attempted to share seed/extend work between opposing directions (East/West, North/South). Failed because over-composition is order-dependent: eastward-composed rays cannot be reversed to produce westward rays.

**Shared-memory cooperative extend** — Loading previous level's tile into workgroup shared memory for reuse across L→R and R→L compositions. Hardware shared memory limits (32KB on Apple Silicon) restrict this to level 1 only, giving ~2% total savings — insufficient for the implementation complexity.

## Known Limitations

- **Bandwidth-bound:** 90%+ of frame time is texture reads/writes in extend+merge. ALU is in the shadow of memory latency.
- **4 directions × nc levels is irreducible:** Each direction's ray data is fundamentally independent (directional over-composition). Each cascade level must exist simultaneously for the top-down merge.
- **Ray texture memory:** ~151MB at ps=1024. Format is rgba16float (8 bytes/texel) — needed for HDR radiance. `rg11b10ufloat` would halve this but isn't a valid WebGPU storage texture format.
- **Bounce light leak at thin walls:** Bounce fluence sampling can reach through walls thinner than ~2× probe spacing due to bilinear fluence interpolation at boundaries. Mitigated by transparency-weighted neighbor averaging but not eliminated.
- **Cross-browser constraints:** Firefox lacks `readonly_and_readwrite_storage_textures`, `shader-f16`, and subgroups. Implementation targets Chrome+Firefox baseline.

## Open Questions

- Is there a way to reduce per-texel byte cost below rgba16float (8 bytes) while preserving HDR, using only WebGPU baseline storage formats?
- Can the O(4 × nc × ps²) bandwidth scaling be reduced algorithmically? Higher cascade levels have very few probes — their data is highly spatially redundant across perpendicular positions.
- Would a rectangular probe grid (TSBK03 per-axis cascade count) give meaningful savings on non-square screens?
- Are there HRC-specific optimizations (beyond standard RC techniques like bilinear fix, c-1 gathering) that address the bandwidth wall?
