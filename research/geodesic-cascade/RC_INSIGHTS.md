# What radiance cascades could tell us about distance fields (per-frame rebuild)

**Constraint (Orion):** the map changes every frame, like GI. So **build + query is the per-frame cost.** Breakthrough
criteria:
- work near N² (not 100× BFS);
- depth independent of the map;
- exact, or with error bounded the way RC's error is bounded.

## The correspondence

| GI / RC | distance fields |
|---|---|
| semiring (+, ×): radiance and transmittance | semiring (min, +): distance, with blocked/free as transmittance |
| ray interval monoid (r, t) ∘ (r', t') = (r + t·r', t·t') | segment monoid (m, free, len) ∘ (m', free', len') = (min(m, free ? len + m' : ∞), free ∧ free', len + len') |
| light travels in straight lines; occluders block | free-space geodesics are straight; obstacles force **bends at obstacle corners** |
| bounces: light leaving a surface depends on light arriving | bends: a corner's distance depends on other corners'; #passes = #bends of the optimal path |
| merge = integration (sum over a cone) | merge = minimum over a cone: no averaging, so no energy aliasing; angular undersampling becomes a *detour* error |
| penumbra condition: far field varies on scale r, so spatial sampling ∝ r suffices | far parts of the distance structure vary smoothly, but only away from corners |
| HRC: line space; extensions double segment length; fixed cost | a min-plus HRC gives every point the min over visible points along every sampled ray, in N² log N with fixed cost |
| constant cost per cascade (positions × directions = const) | the dense separator cascade stores N² per level too (blocks × ports²); RC's product is the same |

## The spectrum this exposes

At each scale, paths are represented somewhere between two extremes:
- **straight lines** (HRC: cheap, fixed cost, but a path can bend only within a cone's width at probe planes;
  Σ 2^-n is far too little to turn a corner);
- **arbitrary paths through blocks** (the separator / dense-distance-table cascade: exact for any number of bends, but
  costly to build, with a k³ closure at the top).

## Candidate directions

### A. Min-plus HRC + bends by iteration
- **Idea:** one HRC pass computes, at every point, the min over everything visible along sampled rays. That is one
  relaxation step over the *any-angle* visibility graph, i.e. one "bounce".
- **Strengths:** fixed cost, N² log N work, and any-angle (Euclidean) distances directly. The error from angular
  sampling is a detour bounded by the lateral line spacing c per bend, not compounding with distance.
- **Weakness:** the number of passes is the number of bends of the optimal path, which is unbounded in mazes. GI hides
  this with temporal feedback, but with obstacles changing every frame, stale values can be too low (invalid), so
  temporal reuse needs a monotone-safe scheme.
- **Verdict:** gives any-angle quality cheaply on open maps, but doesn't solve the depth problem. Useful as a component
  (the near-field / visibility part).

### B. Penumbra-scaled ports in the separator cascade
- **Idea:** keep the cascade, which handles bends exactly via tables, but sample block-boundary ports at spacing s_n that
  grows with level, so that **error per level is equalised** (RC's balance condition) instead of every level being
  exact.
- **Why it could pay:** for Euclidean geodesics, moving a separator crossing by δ costs ~δ²/(2ℓ), second order in δ,
  where ℓ is the distance to the adjacent bends. With s_n ∝ 2^(n/2):
  - ports per block ∝ 2^(n/2);
  - dense table work per block ∝ 2^(1.5n);
  - per level (N²/4^n blocks) ∝ N²·2^(−n/2), geometric, so **O(N²) total build and query, even with dense tables and
    k³ closures.** That's the per-frame build we need, with polylog depth.
- **The catch is RC's own catch, the 1-px-light problem in a new form.**
  - Narrow passages (1-px corridors crossing a separator between sampled ports) are missed entirely. That's aliasing,
    and it's catastrophic (infinite distance) rather than a 28 % dimming.
  - Corners close to a separator make the boundary distance vary sharply, so error ~s/2, not s²/ℓ.
  - So point-sampled ports have exactly RC's failure mode. The analogue of HRC's exact counting / polygonal fix is to
    represent each **free interval** of a separator analytically: distance along it is a lower envelope of cones
    w_c + |p − c| over visible apices (Mitchell–Mount–Papadimitriou "windows").
  - Its size then tracks the complexity of the distance structure (≈1 cone per interval in open areas, more in clutter),
    not the port count.
- **Open:** a size bound for windows per interval on pixel maps, and a fixed-depth way to merge window envelopes.

### C. Line space for the 4-connected metric
- **Idea:** P1 distances along a boundary are piecewise linear with slopes ±1, so the same window idea applies with L1
  cones.
- **Verdict:** less relevant if the practical target is any-angle.

## What to test first (exact references exist for all of these: `geo.py` for P3, BFS for P1)

1. **B, point-sampled (cheap, CPU, existing reference cascade):**
   - exact block tables vs tables restricted to subsampled ports at schedules s_n = 1, 2^(n/4), 2^(n/2);
   - P3 geodesic error vs exact, with per-level work and memory;
   - on open, room and maze maps.

   *Question:* is the penumbra-style error budget real for geodesics, and how bad is the aliasing in mazes?
2. **Window counts:** for each free interval of each separator at each level (P3), count the cones in the lower envelope
   of distance-from-boundary-points.

   *Question:* is the window representation small (≈ O(1) per interval) on real maps? That decides whether an exact,
   O(N²)-ish-build cascade exists.
3. **Only then** decide the GPU design. OpenEvolve becomes useful once there is a well-posed component with a fixed
   harness, e.g. the window-merge kernel or the port schedule under an error budget.
