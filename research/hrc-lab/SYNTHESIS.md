# HRC aliasing & 1-px lights — what's true (Discord × our harness)

Sources: all Discord digests (`digests/`), the HRC paper, Alexander's PolygonalHRC45.ls, and our own measurements
(`NOTES.md`, rounds 1–13; exact references throughout). Verdicts below use our measurements wherever a claim was testable.

## 1. What HRC is (settled)

- **Line-space machine.** In one quadrant a line is (intercept, slope). Extensions = the Brady / Götz–Druckmüller approximate
  discrete Radon transform with `+` replaced by the over-monoid ⟨r,t⟩. Merge-down = a dual (back-projection) transform whose
  "lines" are receivers' pencils. Unoccluded, HRC ≈ R*R = convolution with 1/r. (Discord June 2026 + our Round 5.)
- **Causal, not adjoint.** Occlusion forces near→far composition, so merge-down anchors children *ahead* of the parent rather
  than taking the exact transpose of extensions. The exact transpose exists (scan gather) but needs twice the lines.
- **Penumbra constant c = 2.** At the distance a level handles, neighbouring lines are 2 px apart, and they live on two
  row-parity sublattices (ray endpoints 2k − 2ⁿ). The checkerboard is that parity split, and the cross blur is the
  reconstruction step that fills it in, not a cosmetic filter.
- **Partition, not accuracy.** Individual cone values are poor (50–75 % L1 vs exact fans), yet the fluence is good. Each child
  bin goes to exactly one parent fan, and the per-level errors are tuned to cancel each other. Every "locally more correct"
  change we tried (refocus, centroids, wedges, apex fixes, exact cones at some levels) made the result worse.

## 2. Why 1-px lights alias: three separate defects

| defect | mechanism | visible as | fix | status |
|---|---|---|---|---|
| **line measure** | a thin ray counts a pixel as 1; a real line crosses 1+\|tan θ\| | committed HRC 28 % dark off-axis → bright axis cross; the ±45° seeds pass through pixel corners → X | strip seeds | fixed (bias 0.31→0.047) but shimmer goes up (0.024→0.031) |
| **critical sampling (c = 2)** | a 1-px source is crossed by ≈ ½ line per receiver at its distance, so coverage is 0/1, correct only on average | spokes and shimmer; "min light 2×2" | more lines (c = 1, 2×), or prefilter (blur, and transmittance leaks) | linear schemes capped (Round 6) |
| **phase-lock on dyadic directions** | along directions that are cone edges at every level, every receiver's line hits the source centre, so coverage is always full | radial lines at slope 0, ½; c = 1's ×2 axis / ×0.65 diagonal cross | the checkerboard + blur happen to anti-alias it in HRC | structural |

HRC is **unbiased but aliased**: the error is the variance of point-sampling sharp line-space features at critical density,
not a mean geometric bias. Extrapolation and mean corrections amplify it.

## 3. Discord claims: signal vs noise

| claim (who) | verdict | evidence |
|---|---|---|
| "HRC = Radon + dual Radon" (Alexander, fad, 06-2026) | **true**, with one qualification: the dual is causal, not the transpose | Round 5; exact adjoint verified to 1e-13 but needs c = 1 |
| "The merge diagram is exact; only the raycasting is wrong; counting pixels in polygons is alias-free" (Alexander 03-15) | **true for counting without falloff; false for HRC with falloff** | gapless straight tiling has counting error exactly 0 (Round 3). Replacing every HRC interval with an exact traced strip leaves the PSF bias unchanged (0.062→0.063): merge-down is the limiter, not seeding. Alexander, 09-12: falloff in polygonal "still don't understand how" |
| "Odd merges exact, even merges overlap/gap" (RCa 02-16) | **partly** | the gap is real: an unaligned cone's far part = 2 child cones + a unit strip on the centre line (= the B-ray). "Exact" only holds for counting |
| AdrianM's A/B grammar gives exact topology; the B weight is the obstruction | **true, and it is the same obstruction as polygonal falloff** | falloff is receiver-relative (1/x from the receiver), so a weight shared by many receivers can't be exact. Composable falloff needs 2–3 channels per region (rank-2 2.9 %, rank-3 0.19 % worst case; Round 3) |
| "Overlap count per pixel is a discrete integer" (Alexander 02-17); "rays 2 px apart → min 2×2 light" (Yaazarai) | **true**: both describe c = 2 binary coverage | Round 6, Round 11 |
| "Bright streaks follow gaps in the merge diagram; even rays get more contribution" (Yaazarai) | **true**: dyadic phase-lock | Round 11 polar decomposition: spokes at slopes 0 and ½ |
| "1-px banding is angular discretisation, not extend/merge" (Orion 04-09, brute force with 1024 angles) | **false as a diagnosis** | per-pixel ideal with HRC's own slope count and unit strips: nrmse 0.012. Thin rays alias because of line measure, which shrinks with more angles, hence the apparent angle dependence |
| X artefact = "missing cos weighting" (Yaazarai) vs "equal-angle rays" (Cody) | **neither is the root** in our implementation | X came from corner-degenerate ±45° seeds plus thin-ray line measure (diagonal at 0.58 → fixed). Equal-angle rays keep the thin-ray measure, which fits "mitigated, not eliminated, and also in other topologies" |
| Centre-aligned interpolation compounds into Gaussian blur (AdrianM) | **true but not the limiter** | merge-up spread σ ≈ ½√levels; cubic signed mixtures cut it from 0.74 to 0.04 px and the output is unchanged |
| Stripes vanish when the footprint height equals the probe spacing (AdrianM 06-10) | **true for emission, breaks occlusion** | width-2 strips fix the PSF (0.064/0.051) but leak +15 % through thin walls (product of averaged transmittances) |
| Extended gathering fixes small-source aliasing (Alexander 09-2026) | **untested in HRC; low prior** | our nearest analogue (depth-aware angular refocus in merge) was much worse (0.28 vs 0.062). His wins are in vanilla RC with narrow relative hit-distance ranges; HRC's bands are 2× wide (his (10,120) case: no aliasing, wrong shape) |
| Gaussian overlapping lobes / prefiltered cones (Alexander 04-2026) | **trades aliasing for blur** | soften / tent / emission-only-widening tests all worse (Rounds 6, 9) |
| Gram-matrix-correct interpolation (−¼ ¾ ¾ −¼) (Alexander/fad 05-2026) | **untested**; linear, so expected to stay under the cap | cheap to check |
| "Trilemma: correct falloff, no aliasing, finite rays — pick 2" (Alexander 04-21) | **false for emission, true for visibility** | the free-space kernel is known, so free fluence is an exact finite convolution. Ratio de-aliasing removes PSF aliasing exactly (bias / shimmer / cross 0 / 0 / 0). The trilemma survives only for V (shadows, beams) |
| "HRC is a local minimum" (Alexander) | **consistent** | every equal-cost structural variant failed; evolution collapsed onto local tweaks |
| Store absorption, not transmittance | **true for media precision** (8-bit t compounds in fog); not an aliasing lever | Round 9 fogcheck |

The Discord's most consistent blind spot: most proposals try to make individual intervals or cones more accurate.
HRC's quality comes from partition and cancellation, so those proposals lose.

## 4. The reframing that opens the space

Fluence F(p) = Σ_q e(q) · K(p,q) · V(p,q), where K is the free-space kernel (subtended angle, known exactly) and V is
visibility.

- **Aliasing lives in K.** Sharp source stripes in line space are point-sampled at c = 2.
- **Shadow error lives in V.** Sharp occluder edges are sampled at the line spacing.

HRC estimates the product with one quadrature, so the two defects are entangled and every fix for one hurts the other.
That is why prefilters (good for K) leak (bad for V), and why the c = 1 lattice (better V) produces a cross (worse K).
Once they are decoupled, each factor can use the method suited to it.

### Axes of the search space

1. **Who computes K:**
   - the cascade's thin rays (HRC);
   - strips;
   - an exact global convolution (FFT / multilevel summation);
   - **an exact counting cascade with falloff channels** (polygonal tiling, in-cascade, O(N² log N), no FFT);
   - analytic per-cone kernels.
2. **Granularity at which V is formed and recombined with K:**
   - per pixel (global ratio);
   - per quadrant;
   - per level (distance band);
   - **per cone inside the merge**;
   - per line.

   Finer granularity shrinks the partial-occlusion residual (the faint axis lines), but makes 0/0 (no sample of a light)
   more frequent, which calls for hierarchical fallback to the parent cone's V.
3. **Lattice for V:** c = 2 (HRC), c = 1 (full), interlaced, or per-level phase permutation (Alexander's digit permutation).
4. **What V is stored as:** transmittance, optical depth, or depth / edge moments (nonlinear; the virtual-source cells were
   near-exact in the oracle, Round 7).
5. **Reconstruction:** cross blur, per-quadrant 1-2-1, Gram-corrected, or none.

**Explored points:**

| point on the axes | loss | notes |
|---|---|---|
| strip HRC (thin/strip K, joint, c = 2) | 0.844 | |
| global ratio + FFT, c = 2 | 0.375 | |
| global ratio + FFT, c = 1 | 0.116 | 2× cascade; faint axis lines under partial occlusion |

**Unexplored and most promising:** per-cone V combined with an exact per-cone K, at c = 2. Everything stays inside one
cascade: no FFT, no 2× lattice, same asymptotics. The partial-occlusion residual should shrink because V becomes local in
direction and distance. The unknowns are whether per-cone V at c = 2 is good enough (0/0 handling via the parent cone), and
what the counting cascade with falloff channels costs (estimate: comparable to a second cascade).

### What "~perfect" can mean

The aliasing part can be exactly zero. V at a finite line spacing cannot be perfect: shadow edges are bounded by the
lattice. So the visibility floor needs measuring with a per-pixel brute force at the same line density (`ideal.py`-style:
0.012 nrmse on a 1-px light). "~Perfect" is then "K exact, V at that floor".

## 5. Result of the per-cone oracle (Round 14)

- Per-cone V at c = 2 (0.383) is no better than per-pixel V (0.375). Correcting at every level is worse (0.568).
  **Granularity of V is not a lever.**
- Visibility floor with brute force and exact K: 4096 rays per pixel gives err .014 and edge .018, against HRC's
  V at .031 / .176.
- The whole remaining gap to "~perfect" is V's edge resolution: shadow and beam sharpness, about 10× on the edge term.
- The counting-cascade-for-K plan is moot: K can already be made exact, and it doesn't touch the remaining error.

## 6. Original plan (superseded by §5)

1. **Oracle:** exact per-cone free values (brute force, 256²), combined with HRC's per-cone V = r / r_free and parent-cone
   fallback, scored with the v2 loss.
   - If this doesn't approach the V-floor, a counting cascade isn't worth building.
2. **If the oracle is good:** build the counting-cascade K with 2–3 falloff channels, then measure cost on GPU against
   committed HRC.
3. **Cheap side checks:**
   - Gram-corrected merge interpolation;
   - the V-floor reference itself.
