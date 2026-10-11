# hrc-lab — research notes

CPU testbed (numba) for fundamental improvements to 2D HRC. Reference = exact-integration fluence
(`reference_fluence`: 8192 jittered angles per pixel, exact per-cell chords, own cell excluded).
Metrics over non-opaque pixels: `nrmse` = RMSE / RMS(ref); `lowfreq` = the same after a σ=2 Gaussian
on the error, i.e. *visible structure* (X, wedges, rings, bias) rather than per-pixel speckle.
"HRC" below always means the faithful paper implementation **plus its cross blur**.

Files: `core.py` (tracer, reference, paper HRC, cross blur, scenes, metrics), `adrt.py` (all ADRT /
scan variants; the method below is `adrt_v(S, sig, k, 'hrc', 0, Q)`), `ideal.py` (O(N³) brute-force
bounds), `run_*.py` (experiments), `test_*_exact.py` (exactness proofs-by-test), `out/` (images;
`out/summary.png` is the headline figure), `digests/` (Discord digests + extracted papers).

## ★ Update — a cheap, validated fix to HRC itself (corner-degenerate seed rays)

HRC's directly-traced shortest intervals (T0, T1 — the ±45° ones) run from pixel centre to pixel
centre, i.e. **exactly through pixel corners**. A DDA then sees only the diagonal chain of cells
(zero-length chords through the two side cells), so at 45°:
- opaque/emissive cells are under-counted by ~½  → the **X artefact** (diagonal at ~0.58 of reference);
- rays slip between diagonally-adjacent opaque pixels → **light leaks through 1-px diagonal walls**
  (7× the reference behind a staircase wall on CPU; 0.10 vs exactly 0 on GPU against the path tracer).

Fix: trace T0 and T1 as the mean of two rays offset by ±ε perpendicular (any ε ∈ (0, ½] gives
identical results — it only resolves the corner degeneracy). Everything else is unchanged HRC;
extension starts at level 2. Implemented as `strip-seeds` (default on) in `folk-holographic-rc`.

First-principles checks (128², 1-px source; `run_principles.py`, `run_diag.py`, `run_leak.py`):
- translation invariance (move source 1 px, compare shifted back): reference 0.6%, HRC 34–49%,
  fixed HRC 2–3% → far less shimmer for moving lights;
- F·r along 8 rays (should be flat): HRC 0.6–2.0 by direction; fixed HRC mostly within ±10%;
- penumbra cross-sections: unchanged (both ~2 px softer than reference);
- GPU 64² 1-px light vs 400-frame PT: angular ratio 0.56–0.88 → 0.97–1.01, nrmse 0.35 → 0.12.

Remaining: exact-diagonal band now **+10% (CPU) to +30% (GPU, 64²)** instead of −42%; HRC's own dim
axis near the source (0.75 at 4–7 px) is unchanged. These are visible as lines — see "validation".

### Systematic bias vs shimmer (`psf.py`)
Without occluders a scheme is linear; average its 1-px-source response over 16 sub-cell source
positions (aligned on the source) → **systematic bias** (stable patterns) vs **shimmer** (std over
positions). 64², ring 4–26 px:

| | bias rms | shimmer rms | bias at 45° |
|---|---|---|---|
| HRC (+ cross blur) | 0.186 | 0.200 | −40% |
| HRC + corner fix | 0.062 | 0.031 | +11% |
| + corner fix, no cross blur | 0.079 | 0.53 | +11% |

The +11% is a stable 1–2 px band exactly along 45°. Scaling the frustum-boundary edge weights (γ)
only trades it for a broader dim band (γ=0.9: bias rms 0.055) — not adopted. HRC's on-axis gaps
(odd probes never sample the cone-centre sliver at short range → zero at alternate columns before
blur) also remain; sampling the cone-centre endpoint fixes the gaps but breaks normalisation.

### Why small sources are hard: hierarchical line blur (`spread.py`)
Linearising in a thin medium, every stored interval is a weighted mixture of cell paths; emission
y⁰, y¹, y² per column gives the exact mean and spread of its effective line. HRC intervals: mean
position essentially exact (≤0.04 px bias) but **spread σ ≈ 0.7–1.0 px (max 1.2)** vs 0.29 px for an
ideal unit strip. Model: each odd junction must land on a half-integer row; with exact mean that is a
½/½ mix of the two neighbouring rows (variance ¼), and junction mixes at successive levels are
independent → σ ≈ ½√(levels). Brute-force ideals show error rising steeply with σ (0.29 → 0.012,
0.41 → 0.069, ~0.8 → ~HRC). Conjecture: any binary-merge hierarchy on an integer offset lattice must
choose between blur (path mixtures, HRC) and bending (deterministic digital lines, ADRT); escaping it
needs sub-pixel offsets at upper levels (memory), receiver-anchored straight traces (compute; scan-HRC),
or temporal jitter of the lattice origin (averages position-dependent error, not blur).

### Escaping blur-vs-bend: signed path mixtures (`hrc_extend_cubic`, `spread.py`)
Joining is affine in the far part, so any weighted combination of whole paths (weights summing to 1,
negatives allowed) keeps an exact transpose and conserves energy. For odd directions use 4 paths whose
midpoints sit at −1.5, −0.5, +0.5, +1.5 rows from the true midpoint with weights (−1/16, 9/16, 9/16,
−1/16): mean 0 *and* second moment 0 (cubic interpolation in line space). Merge-up line spread drops
from 0.74 → 0.04 px (shallow slopes). This **falsifies the blur-or-bend conjecture** above.
But HRC's output is unchanged (bias 0.062, shimmer 0.031): merge-up blur is not HRC's limiter.

### HRC's limiter is merge-down (`run_attrib.py`)
Replacing every stored interval with an exact directly-traced strip (diagnostic, O(N³)) leaves HRC's
bias at 0.063 / shimmer 0.036 (diagonal +11% → +3%). Merge-down (cone translation to neighbouring
probes, even-probe averaging) + cross blur set the floor.

### Bounds at HRC's angular density (`run_bound.py`, 64², 1-px)
HRC+corner 0.137; ideal with HRC slopes + pixel-centred unit strips 0.020; same with tent 0.078; thin
0.098. But the 0.020 ideal uses a per-pixel line set (N³). For shared hierarchical lattices at HRC
density: HRC's lattice (all start rows, even rises) has **parity holes** — a line of rise 2t, t odd,
can only be split at rows y₀+t±1, so lines from row j touch only rows ≡ j (mod 2) at junctions; signed
mixtures remove spread but cannot fill holes (`pathscan.py` reproduces the old R=2 scan exactly and
cubic doesn't fix its axis stripes). Checked alternatives (alternating half-pixel offsets per level,
alternating start parity per section) leave holes or bends.

### Interlaced line lattices (Natterer's efficient Radon sampling) (`lattice.py`)
Non-hierarchical test, equal line counts, 64²: interlaced half-density lattice (all slopes, every
other row, alternate slopes shifted one row) matches the *full* lattice on bias (0.020 vs 0.024) and
shimmer (0.018 vs 0.017), beating HRC-like rectangular half density (0.043 / 0.036); per-pixel nrmse
is worse (0.193) with my crude quincunx kernel. Open: (1) a sharper quincunx reconstruction kernel;
(2) hierarchical composition rules for an interlaced lattice (holes for some rise classes appear in
paths but may be covered by neighbouring slopes — exactly what interlacing relies on).

### Validation lesson
Blurred/aggregate metrics (`lowfreq`, 15° angular bins) hide 1-px-wide line artefacts that the eye
picks out immediately. Always check: rendered images, exact-axis/diagonal profiles, translation
invariance, F·r falloff, penumbra cross-sections, leak tests. Earlier tables using `lowfreq` overstate
scan-HRC's visual quality (see below).

## Headline (scan-HRC; see caveats above — aggregate metrics)

**scan-HRC** (k=2, Q=4; ≈1.4× HRC's per-pixel work by a rough op count — needs a GPU port to confirm):

| scene (256²) | HRC nrmse / lowfreq | scan-HRC nrmse / lowfreq |
|---|---|---|
| 1-px source | 0.319 / 0.251 | **0.093 / 0.021** |
| 2-px source | 0.153 / 0.103 | **0.037 / 0.007** |
| occluder + 8-px light | 0.046 / 0.030 | **0.015 / 0.003** |
| thin walls | 0.159 / 0.109 | **0.042 / 0.005** |
| 12 lights + 6 walls | 0.096 / 0.067 | **0.026 / 0.006** |
| fog (volumetric) | 0.062 / 0.043 | **0.020 / 0.004** |

At 128² the same ratios hold; scan-HRC (k=4, ≈2× cost) also beats **HRC at 2N downsampled (4× cost)**
on every scene. Even k=2/Q=2 (≈ equal cost) beats HRC everywhere.

## Equal-cost variant: HRC's own line set — ✗ fails visually

(Reproduced from Orion's 64² screenshot: strong alternating-row stripes along the axes. Structural:
with row step 2 and unit strips, near-axis slopes (step 2/N) leave every other row with no strip
through the source. Aggregate metrics missed it.)
 (CPU, 128²; nrmse / lowfreq)

HRC's endpoints are always even, i.e. its lines are unit strips on two row-parity sublattices with
slopes in steps of 2/2^m. Keeping exactly that line set (≈ HRC cost) but using the exact scan gather,
strip seeds and **phase-coupled receivers** (blend the nearest strip of *either* phase — replaces the
checkerboard + cross blur) — `scan_hrcset(S, sig, k=3, Q=4)`:

| scene | HRC | scan, HRC line set (≈1×) | scan, full lattice (≈2×) |
|---|---|---|---|
| 1-px source | 0.322 / 0.246 | 0.169 / 0.029 | 0.098 / 0.022 |
| 2-px source | 0.158 / 0.103 | 0.073 / 0.015 | 0.039 / 0.007 |
| occluder | 0.050 / 0.032 | 0.031 / 0.006 | 0.016 / 0.003 |
| thin walls | 0.167 / 0.109 | 0.085 / 0.009 | 0.046 / 0.006 |
| multi | 0.114 / 0.084 | 0.056 / 0.012 | 0.030 / 0.007 |
| fog | 0.061 / 0.043 | 0.038 / 0.007 | 0.019 / 0.005 |
| big box | 0.027 / 0.016 | 0.023 / 0.004 | 0.009 / 0.002 |

(2-row-wide strips at half cost were much worse: width-2 strips blur — see `ideal.py`, box w=2 → 0.145.)

## WebGPU implementation

`packages/labs/src/scan-hrc.ts`, wired into `folk-holographic-rc` as `algorithm="scan"` (HRC line
set, k=3, Q=4) or `"scan-full"` (full lattice, k=2, Q=4); demo selector "algo". Debug helpers on the
element: `step(n)`, `readFluence()`, `readPathTrace()`, `readOpacity()`; harness in `browser/bench.js`
(compares against the in-page path tracer, opaque pixels masked, lowfreq = box radius 4).

M2 Pro, 1024×733, bounces off, vs ≥200-frame path trace:

| scene | config | GPU ms | nrmse | lowfreq | bias |
|---|---|---|---|---|---|
| colour shadows | HRC @1024 | 8.0 | 0.032 | 0.0188 | −1.6% |
| | scan @512 | 8.7 | 0.028 | **0.0047** | 0.0% |
| | scan @1024 | 32.7 | 0.025 | 0.0029 | 0.0% |
| | scan-full @1024 | 41.7 | 0.025 | 0.0028 | 0.0% |
| thin walls + 4-px light | HRC @1024 | 8.1 | 0.154 | 0.068 | +2.8% |
| | scan @512 | 9.0 | 0.204 | 0.095 | +1.4% |
| | scan @1024 | 32.7 | 0.110 | **0.0136** | −0.3% |
| mouse light (r=3) | fluence/PT by angle | | HRC 0.91–1.18 | scan 1.000±0.001 | |

Cost breakdown @1024 (scan): cells 0.1, seed 11.9, extend 3.9, gather 5.9, receive 10.8 ms
(HRC: extend 2.7, merge 4.9). The scan trees are at ~1.3× HRC; the direct tracing (seeds + receivers)
is the remaining cost. Equal-time (scan@512 ≈ HRC@1024) wins when features are ≥ a probe, loses on
sub-probe walls.

Perf notes: precomputing per-level constants in the uniform halved the tree passes (integer division
in index math dominated); a column stepper beat DDA for receivers, DDA beat it for seeds; sharing
per-column loads across sub-lines via private arrays was 2× *slower* (register spill).

## The method (one octant; 8 octants via the dihedral group, Voronoi angular weights)

1. **Seeds (level k):** every (section l, offset h, slope s/2^k) is a *unit strip* — lines entering the
   section at y₀ ∈ [h, h+1) with slope s/2^k — stored as the mean ⟨r,t⟩ of Q exact sub-line traces.
   (Correct line measure + exact chords.)
2. **Merge up (levels k+1..M):** HRC's own odd rule, read as an exact path mixture:
   even `T(h,2t) = T(h,t) ∘ T(h+t,t)`; odd
   `T(h,2t+1) = ½[T(h,t+1) ∘ T(h+t+1,t)] + ½[T(h,t) ∘ T(h+t,t+1)]`.
   The mean path is exactly straight (both halves' slopes and the junction are exact in expectation).
3. **Merge down (levels M..k+1):** the exact transpose — a parallel-prefix down-sweep over the same
   butterfly. `S(σ) = Σ_{lines ⊇ σ} w · (radiance entering σ's far end)`; each child has 3 parent paths
   (`gather_down_hrc`). Verified equal to brute-force path mixtures to ~1e-13.
4. **Receivers (level k → pixels):** each pixel traces its own straight line (slope s/2^k) to the end
   of its level-k section and composites with the S of the strip containing it, *linearly blending the
   two nearest strips* by the receiver's strip coordinate `u = j + .5 − σ(c + .5) − .5`
   (c = column within the section; note the **column-centre** term — getting this wrong produced a
   +50% ridge along every diagonal).

## Why it works — the four error sources in HRC-like hierarchies

Isolated one at a time with the brute-force bounds in `ideal.py`. The ideal (same N+1 slopes per
octant, straight unit strips centred on each receiver, O(N³)) has nrmse 0.012 on a 1-px source,
~1% at every distance — so angular sampling is *not* the bottleneck; how the hierarchy approximates
"the straight line through this receiver" is.

1. **Line measure (the X artefact).** A one-pixel-per-column line measures an opaque pixel as 1; a
   real line of slope σ crosses it over 1+|σ|. Thin-line ADRT under-counts by exactly 1/(1+|tan θ|)
   (measured 0.533 at 45° vs 0.500 predicted). HRC is right inside a frustum (its odd averaging gives
   lines thickness) but drops to **0.57 at 40–50°**: at the ±45° frustum edges the averaging partner
   is missing and the thin-line measure returns. Fix: strip seeds.
2. **Receiver displacement.** On an integer-offset lattice the strip containing a receiver is not
   centred on it; per slope the effective line is displaced by U(−½, ½). Brute-force shows this alone
   costs 0.012 → 0.109. Fix: blend the two nearest strips (tent; 0.069 in the ideal), anchored at the
   receiver's column centre.
3. **Bending.** ADRT's odd rule (`near(t) ∘ far(h+t+1, t)`) rounds slopes down and sags; mixtures of
   far halves fix the joins but keep the sag; HRC's odd rule is mean-exact. Fix: HRC's rule.
4. **Interpolated merging.** HRC's merge-down (Eq. 14–17: translating cones to the next probe column,
   interpolating even probes) and its parity sublattices (endpoints `2k − 2^n` are always even, so
   odd/even rows never interact → checkerboard) add error and need the cross blur. Fix: the exact scan
   transpose over the full integer lattice.

## Theory notes

- **HRC extensions are an attenuated Brady / Götz–Druckmüller approximate discrete Radon transform**
  (ADRT; digital lines `D_m(h,s) = D_{m−1}(h, s>>1) ∪ D_{m−1}(h + (s>>1) + (s&1), s>>1)`, Rim 2020 Eq 2.2)
  with `+` replaced by the over-monoid ⟨r,t⟩. Merge-down is the down-sweep of a parallel prefix scan over
  the same butterfly. Without occlusion this is R*R (dual Radon ∘ Radon) = convolution with 1/|x|, the
  2D point-source kernel (the Discord's June 2026 "GI = DualRadon(Radon(sources))").
- **Mixtures are free.** `a ∘ x` is affine in x, so any rule that averages *compositions* is an exact
  probability mixture of digital paths, with an exact transpose gather and per-slope partition of unity
  (energy conservation). The design space is "which path mixture", not "which interpolation".
- **HRC's line set = the full integer lattice restricted to two row-parity sublattices** — the source
  of both its ½ cost and its checkerboard.

## Remaining issues / next

- Faint (~5%) spokes around 1-px sources; shadow-edge slivers ~1 px.
- GPU cost: seeds + receivers (direct tracing) are ~70% of scan's time. Ideas: shared-memory tiles of
  cells per workgroup; cheaper analytic-coverage seeds (exact for opaque, small fog bias); receivers at
  a lower level than seeds; tiling the tree passes to cut the 3× parent re-reads.
- Exact inverse (Rim 2020): the over-monoid is the affine group when t>0 → reversible cascades?
- Radon sampling theory (Natterer's bowtie / interlaced lattices) as a principled per-level
  offset/slope resolution rule.

## Step-back round (Oct 9): merge-down redesigns — all negative, and why

Visible residual of HRC + corner fix (`run_look.py`, `out/look.png`, 128²): **radial spokes** around
1-px lights at ±10–20% of the unoccluded fluence, plus a ~1 px displaced pinhole beam. Tests (64² PSF
bias/shimmer; HRC+corner = 0.062 / 0.031):

| idea (file) | rationale | result |
|---|---|---|
| depth moment per interval, depth-aware angular refocus in merge (`refocus.py`) | plenoptic sampling: interpolate along a source's EPI line | 0.28 / 0.19, −17% energy |
| emission-centroid moments (Σe·x, Σe·y compose linearly), centroid splat (`centroid.py`) | one-step oracle with exact inputs: per-fan L1 55% → 10% | 0.41 / 0.47; normalised per child bin 0.136 / 0.096 |
| consistent semantics: every bin a true angular integral, oracle near fans, centroid + distance ratio (`centroid_oracle.py`) | falloff from geometry instead of counting | ≥ 0.20 / 0.12, −12% energy |
| wedge (angle-integrated) intervals, oracle (`wedge.py`) | angular anti-aliasing of each interval | 0.078 / 0.085 |
| apex-consistent fetch: sub-fan read at its centre-line crossing (`apex.py`) | adjacent bins jump apex by 2 rows | 0.133 / 0.126 |

Key lesson: **HRC's individual cone values are poor (50–75% L1 vs exact fans at every level), yet its
fluence is good** — falloff comes from *counting* (each child bin is handed to exactly one parent fan,
a partition), and errors cancel across levels and across the two halves of a cone. Locally "more
correct" geometry breaks the partition/cancellation and loses. Improving HRC needs a change that keeps
an exact partition of line space at every level, not better per-cone estimates.

Literature: Basu–Bresler / George–Bresler hierarchical backprojection (the tomography twin of RC's
merge-down: sub-image of size L needs ∝ L angles) reach near-direct accuracy only with modest radial/
angular oversampling and higher-order interpolators (error constant 4 linear → 10 cubic spline in one
analysis) — i.e. HRC sits at the critically-sampled, low-order corner of that design space.
Plenoptic sampling (Chai et al. 2000): depth-aware reconstruction lowers required sampling, optimal
single depth = harmonic mean of depth range — but see the refocus result above.

## Structural findings (Oct 9, later): what an HRC pixel actually integrates

**Effective transport kernel** (`kernel.py`, `run_kernel*.py`, `out/kernels.png`): K(p,q) = fluence at
pixel p from a thin unit emitter at q, brute-forced over all q, vs the exact ∫cell 1/|p−x|.
- HRC + corner fix *without* cross blur: K/K_ref is a ±60% stripe pattern of period 2 px across the
  travel direction of each quadrant (rows in ±x quadrants, columns in ±y) — **per quadrant a pixel only
  sees emitters on rows of its own parity, at double weight.** Cause: every merge reads child probes at
  even row offsets (edge-ray endpoints 2k−2^n), and extension junctions are parity-preserving. So HRC
  samples at half lateral resolution and the cross blur *is the reconstruction step* (it brings in the
  other parity from the neighbouring pixel). rms kernel error by distance band: 0.50–0.71 without blur,
  0.08–0.15 with. The spokes are this reconstruction's residual.
- **Point-apex cones always leave a one-row gap per child bin**: a child cone has zero width at its own
  plane, the parent's sub-fan there is one row wide. Any choice of which child to read (HRC edge,
  centre, interpolation) gives binary coverage whose weights are right only on average (one-step check,
  `dbg`: L1 per bin 0.55–0.63 for both HRC and a centred read).

**Line-space finite volumes** (`frustum.py`, `frustum2.py`, `muscl.py`): every stored value is the
average over a line-space cell (unit cell of the probe plane × ray-centred slope bin); merges and
extensions are exact overlap-fraction mixtures (¾,⅛,⅛ / ⅜,⅛ for odd merges; exact rebin for even;
⅛,¾,⅛ / ⅜,⅛ pairs for extensions). Ray-centred bins make the next level's rays land on integer rows.
Requirement found on the way: **junction planes must lie on pixel edges, not centres** — with centred
planes every opaque pixel is split across a junction and averaged transmittance double-counts it (+21%).
Results (64², noblur): shimmer **0.055 vs HRC's 0.53** (point response nearly translation invariant, no
parity/checkerboard, no cross blur needed); but systematic bias 0.20 (HRC+blur 0.062), a cos θ-shaped
angular bias from numerical diffusion in angle (light drifts across bins, piles at the clipped 45° bins,
then gets sheared wrongly), and thin-wall leaks (+20%) from product-of-averages transmittance. Directly
traced cells at every level: bias 0.159 — so first-order extensions cause most of it; MUSCL/minmod
second-order splits in the merges did not help.
Open: a less diffusive conservative scheme (aliasing ↔ diffusion is the trade between HRC and FV), and
an occlusion treatment that keeps per-line correlation of near transmittance and far radiance.

## Round 3 (Oct 9–10): polygonal thread, exact tilings, and the falloff dichotomy

**From #polygonal-hrc (raw export, not the digest).** Alexander: "HRC without a falloff is an algorithm to
quickly count pixels in cones"; gapless frustum tilings = monotone staircases (1:1 bands advance the
intercept, 0:1 wedges advance the angle) in (slope, intercept) line space, i.e. Bresenham in line space
(Orion's own observation: the bits of the direction index are the floor/ceil decisions). Primal polygonal
with falloff was never solved in the channel (Alexander, 09-12: "still don't understand how"); RC's
hrcviz2 "pixel-accurate sums" uses exact polygon∩pixel areas plus an offline per-pixel residual stencil
(`generate_merging_scheme`) — a diagnostic oracle, O(N³). Dual (scatter) polygonal: exact falloff and
cone-shaped shadows for any sources, gathering ("contractions") with occlusion unsolved.

**Exact straight gapless tiling, verified** (`tiling.py`, `run_tiling.py`): for an unaligned cone (rises
i..i+1 per run s) the far part is exactly two child cones from the edge endpoints (half slopes) plus a
**unit-wide strip on the centre line** (the two child cones leave a gap of exactly one row at every depth);
aligned cones split into nested children; strips recurse the same way and form their own O(N²)-per-level
hierarchy (foci on half-integer rows). All regions are straight convex polygons. Counting test (emitting
area seen by a receiver, 400 random receiver/source pairs): error exactly 0.

**The dichotomy.** In (x-distance, slope) coordinates a quadrant's fluence has *no falloff*:
F(p) = ∫∫ e·V·cosθ dσ dx. A receiver's lines are a 1-D subset of line space, so shared line-space cells
can only cover them approximately → line-space schemes alias (HRC) or blur (finite volumes). Area
(counting) representations tile exactly (above), but the falloff weight 1/x is receiver-relative. A falloff
that composes exactly under plane shifts must lie in an exponential-polynomial span; global exponential
sums for 1/x on [1,128]: K=2 41%, K=4 4%, K=5 1% max error. **But per level the shift is bounded by the
level's scale** (o ≤ 2^n, distance ≥ 2^n): the scale-free kernel 1/(D+o), D≥1, 0≤o≤1 has singular values
1, 0.041, 0.0019, 8e-5 → rank 2 = 2.9% worst-case, rank 3 = 0.19% (FMM-style translation).
So: exact tiling + 2–3 falloff channels per region would be alias-free with small *smooth* falloff error,
at a memory cost (cones 2N² + strips 2N² per level at this angular density, × channels).
Open: occlusion inside area regions (visibility per point vs per line), near-section polygon sums
(Green's theorem: line integrals of a row-prefix-summed field = HRC-style extensions on that field),
and the memory multiple.

**Diagnostics this round.** Polar error decomposition of HRC+corner+blur (`run_polar.py`): errors are radial
spokes (constant angle), strongest along slope 0 (+0.09) and ½ (+0.14) — directions that are cone edges at
the most levels — but non-dyadic directions (⅓, ⅖) are also raised, so dyadic nesting is only part of it;
thin sources show a ~+4% overall bias. Per-quadrant across-only reconstruction does not beat the cross blur
(HRC's sampling is checkerboarded in both axes). Finite-volume variants: centred bins diffuse in angle (a
45°-wide level-1 bin sends light 45% to the wrong neighbour; shear then misplaces it); fan bins nest but
showed a different strong angular bias even with traced cells — FV filters at every level where HRC samples
then reconstructs once.

## Round 4 (Oct 10): lattices for an exact-adjoint gather; the penumbra constant c

**Hierarchy, not line density, is HRC's limiter** (`run_lattice_look.py`): HRC's own line set traced as
global straight lines with a tent receiver (non-hierarchical) shows far weaker spokes and a correctly placed
pinhole beam than hierarchical HRC.

**Exact-adjoint (scan) gather on the full lattice** (`interlace.py`, lattice='full', cubic or 2-path mean
mixtures, receivers at level 1 tracing ≤2 px, Catmull-Rom across strips, no blur):
64² PSF bias/shimmer 0.037/0.034 (HRC+corner+blur 0.062/0.031); 128² error/unoccluded rms: 1px+wall
0.048 vs 0.092, two 1px 0.043 vs 0.051, multi 0.018 vs 0.033, thinwalls 0.017 vs 0.050 (`out/scan128.png`).
Remaining defect: thin streaks exactly along 0°/90° through sources (octant seams). 2-path 'mean' rule
≈ cubic. Cost: twice HRC's line count per level (≈2× memory and compute).

**Equal-count attempts all fail**, each for a specific reason:
- HRC lattice (even rises, all rows) with exact adjoint: bias 0.43 (0.18–0.22 with blur) — odd half-rises
  force junctions onto same-parity rows (parity holes), and the transpose carries them to receivers.
- Natterer interlaced lattice (row parity = slope parity): composition closes (a ≡ s, b even; exact for
  s ≡ 0 mod 4, signed mixtures otherwise), but width-1 strips leave per-slope gaps (±50% octant-wide
  bias); width-2 strips (the correct prefilter for interlaced sampling) fix the PSF (0.064/0.051) but leak
  through thin walls (+15%) — product-of-averages transmittance. Linear sampling theory vs occlusion.
- Quincunx (angular-neighbour) receivers: leaves have only 3–5 slopes, so angular interpolation is too
  coarse (−12…−25% energy, large shimmer).
- Hybrid (full lattice for levels ≤ L, HRC lattice above): parity damage wherever an HRC-lattice level feeds
  another; good only once most levels are full (L=4 of 6).
- 'Jump' paths (far half from the true midpoint row, near half as an even-rise neighbour mixture): parity
  holes reduced (0.21) but light jumps walls (+23% thinwalls).
- HRC on the full lattice (consecutive rises, paper merge): −17% energy with opaque sources, on-axis
  +26% — HRC's merge is calibrated to its strip-width : ray-spacing ratio; not a valid density control.

**Synthesis.** The *penumbra constant* c = lateral sweep per angular step of a level (HRC 2, full lattice 1)
is the dominant quality knob, and cost ∝ 1/c. Index-2 sublattices of the full lattice don't compose
without parity holes, prefilter/occlusion conflicts, or leaks; the full lattice is the closed object for
binary line hierarchies. HRC's cone merge + cross blur is a good way to operate at c=2 (it reconstructs
under-sampled data); exact-adjoint gathers need c=1.

## Round 5 (Oct 10): what HRC *is* — a causal dual Radon transform in line space

**Line-space duality.** In a quadrant, parametrise lines by (y0 = intercept at x=0, σ = slope). A point (X,Y)
is the dual line y0 = Y − σX; a receiver's pencil is the dual line of the receiver; a 1-px source is a dual
*stripe* of width ≈ 1+|σ|. Free-space fluence from q at p = overlap of q's stripe with p's dual line:
(1+|σ|)/|X−x| in σ-measure → with dθ = dσ/(1+σ²) this is exactly projected size / distance. **The 1/r falloff
is the crossing-angle Jacobian of two dual lines** (their slope difference is the x-distance).

**HRC = R̃_causal ∘ R.** Extensions are the primal Brady/ADRT digital-line transform (scene → line space).
Merge-down is a Brady/ADRT-style transform *in line space* whose lines are the receivers' pencils: a pencil
over a σ-range of width δ is shared by receivers whose x differ by < ~1/δ, which is exactly why level-n
probes sit on planes every 2^n with bins of width ~2^-n. HRC's probe planes are the dual transform's
slope-sharing; the penumbra constant c = δ·(plane spacing) is the dual transform's rounding granularity.
Occlusion forces near→far composition (transmittance is not invertible where t=0), so the dual digital lines
can only be anchored on planes *ahead*: halves are anchored at the parent's ends with the wrong slope,
leaving the 2-row gap (in line space) found earlier. The exact-adjoint scan instead realises R* as the
transpose of R — no causality problem, but needs c=1.
Other identifications: spokes along dyadic directions = receivers' dual digital lines phase-locked across
levels along directions that are cone edges at every level; cross blur = averaging the dual lines of
neighbouring receivers (shifted rounding phase); parity checkerboard = c=2 rounding granularity.

**Prediction tested and refuted** (`extrap.py`): if the error were a first-order (mean) apex deviation,
linear extrapolation from two ahead apexes on the same edge ray (a = s, 3s; weights 3/2, −1/2) would cancel
it causally. Result: much worse (bias 0.25–0.30). Reason: coverage by a point-apex child cone is 0/1 per
source; extrapolating binary coverage amplifies aliasing. Together with the partition result (Round 2):
**HRC is unbiased-but-aliased** — its error is the variance of point-sampling sharp line-space features
(source stripes, occluder edges) at critical density, not a mean geometric bias. Fixes must reduce that
variance: supersample (cost), prefilter (blur/leaks), decorrelate the aliasing phase across receivers
(so the final reconstruction filter averages it out), or represent the sharp features explicitly.

## Round 6 (Oct 10): decorrelating HRC's aliasing — and why linear schemes are capped

- **Softened bin edges** (`soften.py`): each sub-fan reads its child bin plus neighbouring bins of the same
  child probe (partition preserved), symmetric tent or receiver-parity dither. Monotonically worse
  (tent ¼: bias 0.142; dither ½: 0.149). Hard bin edges are not the spoke mechanism.
- **Where the errors originate** (`oracle_low.py`): exact cone integrals at levels ≤ L with HRC above, or
  HRC below and exact above, are *worse* than all-HRC (0.21–0.32 vs 0.062). The final gather alone, made
  exact from probe x+1, gives 0.207 — HRC's +1 read offset is itself compensated by the rest of the chain.
  HRC's per-level errors are tuned to cancel each other. Cleanest description: **a deterministic ray
  tree, shared between receivers, with arc weights; total weight exact; residual errors are fixed
  patterns per tree class (x mod 2^n), so they appear as spokes rather than noise.**
- **Gather-offset decorrelation** (`gatherphase.py`): reading probe x (offset 0) is far worse (0.205);
  averaging or alternating offsets 0/1 by row worse; ¾·(x+1) + ¼·(x+2) slightly better (bias 0.054,
  shimmer 0.027): HRC's effective sampling point lags its nominal apex by ≈ 1.25 px.
- **Why linear schemes are capped at a given sample count.** In line space, fluence from a source is the
  integral of its dual stripe along the receiver's dual line; the two cross in a region of σ-extent w/r,
  i.e. ≈ 1/c cells of the level that handles distance r. Any linear representation (point samples, box or
  B-spline cells, Galerkin with exact cell overlaps) must resolve *where inside a cell* two sharp stripes
  cross; with ≲1 cell per crossing the error is O(1) per contribution and depends on sub-cell phase. The
  contribution itself depends only on the crossing angle (= distance) and stripe width, not on position —
  but recovering it needs per-cell orientation (depth) information, i.e. a nonlinear representation.
  So at HRC's sample count, linear schemes can at best trade aliasing for blur (consistent with all the
  equal-cost attempts so far); the full lattice wins by halving c (≈1 cell per crossing) at 2× cost.
  The route to large equal-memory gains is a line-space finite-volume representation whose cells carry
  a depth moment (stripe orientation) so splits and receiver crossings are computed geometrically —
  consistent in line space, unlike the earlier fan-based refocus attempts.

## Round 7 (Oct 10): line-space cells with virtual sources — ~exact in the oracle; near parts are the crux

**Representation.** R cells = row [y,y+1) on a probe plane × HRC cone (line-space finite volume). Each stores
its light m and a moment-matched *virtual source* (X, Y, varX, varY): the light is modelled as uniform
radiance on exactly the cell's lines that hit that rectangle. Odd merge: the parent gets, from each child
cell, I_child × line-measure(parent lines in the sub-fan that cross the child row and hit the child's
rectangle) × slab transmittance. Even merge: exact rebin. Planes on pixel edges (required).
Second-moment (ū, σ̄, covariance) cells were tried first (`mom2.py`): 4% rms, 17–22% max — moments
can't capture how a pixel source's band is clipped by row boundaries.

**Oracle results** (`vsrc.py`, exact near parts, 32², vs exact cell values at the same receivers):
single 1-px source 0.56% rms / 4% max (→0 as quadrature improves); 2×2 and 4×4 sources ~1% (after
adding per-line slab transmittance — extended opaque sources occlude themselves); 1×6 bar 1.2%;
two / three separate 1-px lights 2.5% / 5.6% rms (moment-matched mixing); occluded scenes ≤0.6% of peak
rms, errors confined to a thin band along penumbra edges (≤3% of peak) — a virtual source can't encode
where an occluder edge clips its lines.

**Practical near parts** (`vshrc.py`, `vshrc2.py`): HRC's intervals sample each slab with edge strips 2 rows
apart at the slab's far end (penumbra constant 2), so light between them is absent and the virtual-source
near parts are wrong (practical vs exact: 26% rel). Two adjacent parallel strips per sub-fan with
per-strip depth and lateral moments (both compose exactly under extensions): 22–24% with extension-built
intervals (cubic rule barely helps), 7–12% with directly traced intervals. HRC's intervals are mixtures
of bent paths at c=2; the virtual-source cells need straight, fully covering line sets — the
approximation lives at that interface. A fully consistent version would build near parts as
virtual-source cells hierarchically (finite-volume extensions with exact line-measure restriction);
memory ≈ 2× HRC's interval storage, ≈ break-even if intervals are stored at every other level and the
rest recomputed.

## Round 8 (Oct 10): ground-truth audit + an evolutionary-search harness

**Ground truth.** `exact_ref.py`: exact fluence for opaque-grid scenes — inside each angular interval
between consecutive opaque-cell corner angles the first cell hit cannot change, so one exact traversal of
the mid-ray per interval gives F(p) = Σ Δθ·S(first hit) with no sampling error (64² in ≤2 s).
The old reference (8192 rotated equi-angular samples, σ=1e4 "opaque") vs exact: nrmse 0.03–0.3%, max
2.4% in lit regions, unbiased; at 32768 angles 0.07%. Earlier conclusions stand; exact is used from now on.

**Search harness** (`evolve/`, for OpenEvolve): the evolved program implements `fluence(tracer)` in
numpy; scene access only via a budgeted `Tracer.trace` (charged per cell visited) + free opacity mask.
Hard budgets vs the HRC seed: peak memory (tracemalloc) ≤1.3×, trace cells ≤1.3×, time ≤3×, and
asymptotic growth 64²→128² within 1.25× (memory, cells) / 1.6× (time) of HRC's — a brute-force ray
tracer is rejected (27× trace, growth 7.9 vs 4.1), source peeking is screened. Score = 1/(1+5·loss),
loss = error/unoccluded (6 randomised families × 2) + low-frequency structured error + 1-px PSF bias +
shimmer (8 sub-positions), all vs exact references. Seed (HRC + corner fix + cross blur) = 0.501
(loss 0.199; held-out set: err 0.066 vs 0.070 validation). Zero output = 0.074.

**GPU-model harness (v2, `evolve/gpu.py`, `evaluator_gpu.py`, `config_gpu.yaml`).** Programs are written
against a compute-shader model: explicit buffers, gather dispatches (`ctx.read` counted per element,
`ctx.trace` for scene access), no scatter/atomics/global ops; every kernel is re-run on a random element
subset and must reproduce its values (locality check — rejects reductions). Budgets from deterministic
counters vs the HRC seed: peak buffer memory ≤1.3×, reads ≤1.5×, dispatches ≤2×, traced cells ≤1.3×,
growth 64²→128² ≤1.25× seed's. Score 1/(1+5·loss), loss = err + struct + 2·edge + psf_bias + psf_shimmer;
`edge` = gradient-magnitude error at strong reference gradients (normalised by unoccluded fluence) — added
after the smoke test's first "improvement" was simply a second cross-blur pass (now score-neutral).
Seed loss 0.4587 (score 0.304). Models via OpenRouter: Sonnet 5.5 (0.6), Haiku 5.5 (0.3), Opus 5.5 (0.1).

**Run 1 result (400 iterations, diff-based, ~10.7M tokens ≈ $20–25).** Best score 0.3128 vs seed 0.3036
(validation loss 0.459 → 0.439; held-out 0.465 → 0.444, −4.5%). All gains came in the first ~30 min from
local changes: per-quadrant opacity-aware 1-2-1 reconstruction along each quadrant's travel axis instead of
the cross blur, and 3 stratified / parity-interleaved sub-rays for level-0/1 seeds. Held-out: edge error
0.137 → 0.125 and shimmer 0.029 → 0.026 improve, PSF bias 0.065 → 0.069 worsens. The population collapsed
to near-copies (81 programs, interquartile score range 0.3109–0.3127); no structural change survived.
Consistent with the local-optimum picture: diff-sized mutations of HRC don't move it.

## Round 9 (Oct 9): real-GPU harness (wgpu/WGSL on the M2 Pro) + exact refs at 256²

**Harness** (`wg/`): `graph.py` — a static WebGPU graph (`g.buffer`, `g.dispatch(wgsl, grid, bufs, ints, floats)`,
prelude with `cell/opaque/trace`), wall-clock timing over batched frames (agrees with timestamp-query medians),
per-dispatch profiling. `hrc_base.py` — the production HRC passes (strip seeds, extend, merge-down writing
fluence at level 0, opacity-aware cross blur), mono, f16x2 intervals / f32 merge; **matches the numpy model to
1e-7** (loss 0.4587 on the 64² set, identical). `scenes_n.py` — scene families at any N with *pixel-scale*
features (1-px lights/walls/slits), exact refs (angular corner sweep, ~1 s per 256² scene). `evalwg.py` — loss
(same terms as before) + cost. `evo/` — OpenEvolve on WGSL: `initial_program.py` (seed, production-sized
buffers), `wgsl_evaluator.py` (quality @256², GPU time @512²/1024² interleaved with the seed, memory;
J = loss ratio × time ratio × √mem ratio; GPU file lock so parallel workers don't perturb timings).

**Baseline @1024² (mono, production buffer sizes):** 11.8 ms, 68 MB (T levels 52, R ping-pong 8, F/out 8).
Profile: seeds ≈ 2.4–4.1 ms (scene-dependent), extend ≈ 2.7, merge ≈ 5.2. Tree passes ≈ 0.13–0.2 ms per
level per quadrant, roughly bandwidth-bound but encode/decode ALU is *not* free (see bidir).
Quality @256²: loss 0.497 — edge 0.177 (×2) dominates, err 0.042, psf bias 0.063, shimmer 0.016.

Findings:
- **Fixed-chord seeds** (level-0/1 seed rays have fixed geometry → precomputed chord tables, no DDA loop):
  identical output, seeds ≈ 3× cheaper, ≈ −5…−15% frame time. Production still uses the DDA `traceCells`.
- Seed knobs on real cost: Q=1 (no corner fix) loss 1.04 vs 0.50 (corner/strip seeds are a 2× quality win by
  this metric; remaining issue is the +10…30% band exactly along 45°); direct tracing of level 2 needs Q≥4
  (Q=2 → 0.74); Q=4 = Q=2 at levels 0–1 (2 sub-lines already integrate those strips exactly).
- **Spoke spectrum:** PSF error energy 76% at 0.05–0.15 cycles/px, <1% at Nyquist. Spokes are radial patterns
  fixed in angle within a distance octave (ray spacing at the source distance 2–4 px vs 1-px strips) —
  undersampling with a too-narrow prefilter; image-space filters can't remove them. Beams through 1-px slits
  come out ~3–4× too wide; shadow edges ~2 px soft (the edge term).
- Emission-only widened seeds (prefilter r, keep t thin): monotonically worse (0.80–1.32).
- **Opposite-quadrant sharing (E/W, N/S on one interval tree, (r_fwd, r_bwd, t) in 4 B with a shared
  exponent):** requires the reversed frame shifted by 1 px so planes coincide — production's E/W lattices
  are offset by one column (complementary parity); losing that costs only ~2–4% per scene. But (a) the
  shared tree also needs segments *entering* the scene from above/below (start rows outside) → extra rows
  (+8% T memory with a per-ray row offset layout, +30% naive); (b) measured: seeds 4.1 → 2.6 ms, but
  pack/unpack ALU makes the two shared extend passes slower than four plain ones (3.3 vs 2.7 ms) and the
  reversed merges +30% → net 1.07–1.13× *slower* as built. Best case after fixes ≈ −10%. Not worth it.
- **Edge term, concretely** (`wg/evo/manual/edges2.png`): beams through 1-px slits ~4× too wide and dim; a beam
  through a wall gap spills into the shadow ~12 px early; room shadow edges ~6 px soft; ±0.1 parity oscillation.
  Removing the cross blur makes edge *worse* (0.193) and shimmer 0.53 — the edge error is intrinsic.
  Mechanism: each merge applies one edge-strip transmittance to the parent's *whole* sub-bin (c = 2).
- **Opposite-parity rays + trapezoid sub-bins** (`manual/trap.py`): add the extra lattice (rise 2m+1−2^n — exactly
  the missing inner edge of every sub-bin; extends exactly as bent mixtures of one HRC + one extra ray at the
  level below; verified against direct strip traces) and sample each sub-bin at both edges (½/½; even probes
  ¼/½/¼ at distance 2s). Removes the pre-blur parity checkerboard completely (no-blur shimmer 0.53 → 0.016),
  but creates dark spokes exactly along dyadic directions (ratio 0.1–0.4) and +20% elsewhere: loss 0.94
  (from any starting level: L=5 still 0.59). Reason: the extra apex (row P+1) evaluates the parent's *whole*
  bin from a point one row over; a source on a bin boundary is shifted by parallax (1/r') out of both
  neighbouring sub-bins. Doing it right needs the parent's radiance at half-bin resolution (each half from its
  own apex) ≈ c = 1 merges + 1-byte extra-lattice transmittance: est. 1.6× time, 1.3× memory, for at most ~2×
  quality — break-even at best. HRC's single-apex rectangle rule is internally consistent; mixing apexes is not.

- **HRC on the full integer-rise lattice (c = 1) on the GPU** (`manual/c1.py`: 2^(n+1)+1 rays, 2^(n+1) bins of
  slope width 2^-n, paper merge unchanged): loss 0.549 vs 0.497 — edge 0.159 (better than 0.177), shimmer 0.009
  (better), but PSF bias 0.118: away from the axes/diagonals it is *smoother* than HRC, yet it double-counts
  exactly along the axes (ratio ≈ 2) and under-counts exactly along the diagonals (≈ 0.65) — 1-px cross lines
  through every source. Strip width at the seeds is irrelevant. Even with the cross fixed (≈ 0.40 est.) it costs
  ≈ 2× time and memory: not an efficient point. HRC's c = 2 with its specific merge is genuinely well balanced.

- **Split sub-line transmittance** (`manual/splitt.py`: store (r, t−, t+) for the two strip sub-lines; they compose
  exactly; each sub-bin uses the sub-line inside its own footprint): no effect (0.4974–0.5048). Visibility
  *inside* the strip is not the limiter — the apex/sheared-path geometry at c = 2 is.

- **Engineering levers (identical output), measured on the M2 Pro @1024²** (seed 11.7 ms / 68 MB):
  * y-fastest layout `[(plane·K + ray)·H + row]` with 3-D dispatch (no integer div/mod by 2^n+1, coalesced
    row access): extend 2.63 → 2.05 ms, merge 5.18 → 4.10 ms; seeds must keep a plane-fastest thread order
    (scene reads) → **0.855× time** (`manual/yfast2.py`).
  * 16-bit intervals (r e4m4 mini-float + t unorm8, two per u32): quality unchanged on the opaque set
    (0.4969–0.4987), T memory −33% — **but in fog/semi-transparent media 8-bit t compounds: 1.5–2.2% rms,
    p99 4–6%, +0.3–1% bias vs f16** (`manual/fogcheck.py`); needs an optical-depth encoding for media; but pack/unpack ALU makes passes ~10% slower.
    Combined with f16 merge pairs: **40 MB (0.60×) at 1.0× time** (`manual/fast.py`). A memory lever, not a time one.
  * Seeds cost ≈ 3.4 ms of real tracing on a native 1024² scene (~1 ms/quadrant); not the exp, not the chord
    tables (unrolled = same) — scene-read latency. Likely fix: workgroup tile of cells in shared memory.
  * The passes are NOT purely bandwidth-bound on this GPU: fewer bytes with more ALU (bidir 3-channel packing,
    16-bit intervals) loses time; removing index divisions wins.

- Fragment pass into an rg16float render target vs compute into a storage buffer (one extend level):
  0.77–1.19× — no big lever from render-target compression here.

## WGSL harness — plan (superseded by Round 9)
- wgpu 0.32.0 is installed in research/.venv-oe and verified on the M2 Pro (Metal, timestamp-query True).
- Plan: port the production passes from packages/labs/src/folk-holographic-rc.ts (raySeedShader ~L286, rayExtendShader, cascadeMergeShader ~L494, fluenceBlurShader ~L720) into a wgpu-py pipeline.
  - Host orchestration to mirror is `#runCascade` (seed → extend → merge per direction).
  - Ray buffer widths: ceilDiv(P, 2^i)·(2^i+1). Merge buffers: nextPow2(P)·P.
- Next steps:
  1. Check the port against initial_program_gpu.py / core.hrc_v2 and exact_ref.
  2. Measure baseline timestamp timings at 512² and 1024².
  3. Wrap it as an OpenEvolve evaluator over WGSL plus a pipeline description.
  4. Re-test the corner fix and opposite-quadrant sharing on real GPU cost and quality.

## Round 10 (Oct 9): end-to-end — evolved optimisations ported into folk-holographic-rc.ts

OpenEvolve on real WGSL (`wg/evo`, run r3, ~200 iterations, ≈$45 total API spend) reached 0.45× GPU time and 0.60×
memory vs the production-equivalent seed with identical output (held-out max rel diff 1.2e-4, fog 1e-4).
Ported the parts that apply to production (whose merges already compose T_{n+1} even rays from T_n, so the split
layout / on-the-fly top level don't transfer). Now the only path: the old per-ray seed / extend / merge shaders, the
`strip-seeds` option and its thin-ray legacy seed were removed (fluence re-checked bit-identical afterwards):
- per-probe strip seeds: footprint cells fetched once (world + bounce), all 2^n+1 rays × 2 sub-lines composed from
  registers with constant chords (generated at pipeline creation from a TS port of the chord DDA);
- extend: one invocation per ray pair (5 loads instead of 8; even rays composed once);
- merge: one invocation per cone pair (shared edge ray + extension), fast level-0 variant writing fluence;
- slice-fastest ray/merge layouts with 64-wide workgroups along slices (this is what made extend/merge faster —
  pairing alone did nothing, and private arrays of RayData made merge slower).
Measured in headless Chrome 154 (Metal, M2 Pro), interleaved A/B, 180 frames each, `research/.../cdp/ab2.js`;
fluence read back is **bit-identical** in every config:
| config (probes) | base ms | fast ms | ratio |
|---|---|---|---|
| rgb 1024×698 | 11.85 (seed 3.81, ext 2.74, merge 5.16) | 7.78 (1.40, 2.35, 3.91) | 0.66 |
| color-scale 0.5 (rgb+mono) 1024×698 | 12.72 | 7.20 | 0.57 |
| 512×349 | 2.58 | 1.87 | 0.72 |
| color-scale 0.25, 2048×1396 | 37.98 | 23.55 | 0.62 |
Not yet ported: f16 merge buffers for mono, T0 inline in the level-0 merge (memory), 16-bit intervals (memory,
needs a media-safe t encoding).

## Round 11 (Oct 9, evening): measurement audit + aliasing as the search target

**Perf measurement correction.** The 1.5× in Round 10 was against the uncommitted strip-seed build (seeds 3.8 ms).
Against committed HRC (one thin own-cell seed level, 0.2 ms), uncapped frame throughput in headless Chrome
(--disable-gpu-vsync --disable-frame-rate-limit): 175.6 → 172 fps — the layout/pairing saves ~0.9 ms (extend −14%,
merge −13%) and strip seeds spend ~1.1 ms. Timestamp sums agree with uncapped frame time within ~0.3 ms; capped rAF
(60 fps headless, display-bound in the pane) is useless. Rule: A/B against the committed build.

**Aliasing metric suite** (`wg/alias.py`, exact refs): 1-px light at 40 lattice phases (dx, dy ∈ [0, 32) + the old
8 small shifts), ratios aligned on the light, annulus 3 < r < 90. Findings:
- the old shimmer (8 shifts of 0–3 px) **underestimates far-field shimmer ~2×** (0.014 vs 0.030): small shifts never
  change the phase relative to the coarse levels;
- **committed HRC renders 1-px lights 28% too dark everywhere except the axes** (radial mean 0.72; axes ≈ 1 → bright
  cross): thin rays count a pixel with line measure 1 instead of 1+|tan θ|. Strip seeds fix it (radial 1.00);
- **strip seeds trade bias for shimmer**: bias 0.31 → 0.047 but shimmer 0.024 → 0.031 (moving lights flicker more) —
  plausibly why the corner fix did not feel like a clear win in practice;
- c = 1: lowest shimmer (0.019), 1-px cross (axes ×2, diagonals ×0.65); the even-probe ½/½ rule is optimal for
  shimmer (0.25/0.75/0/1 all worse), the cross is independent of it.
- extra 3×3 tent blur improves bias/shimmer ~6% while the edge term barely moves → added a **sharpness** term
  (fraction of the exact gradient captured at strong edges: seed 0.561, tent 0.535, no blur 0.575, c=1 0.628).

**Phase-lock mechanism.** On dyadic directions every receiver's sample ray passes exactly through the source centre →
coverage always full instead of its average (strip width / sample spacing). Vanilla HRC survives because its parity
checkerboard gives 2×/0 on alternating receivers and the cross blur averages to ~1 (the checkerboard + blur is HRC's
de-facto anti-aliasing on dyadic directions); c = 1 has no checkerboard → cross.

**Polygonal HRC (Discord; PolygonalHRC45.ls read):** a dual/scatter free-space demo — extension sums emission into
polygons (no transmittance), gather splats per pixel over all probes with a per-cascade linear falloff between 1/2^i and
1/2^(i+1) by the pixel's position along the frustum (Chebyshev-like; Euclidean correction disabled). Exact counting
removes aliasing; correct per-pixel angular weights in a shared hierarchy and occlusion remain open.

**Search v2** (`wg/evo2`): seed = strip HRC; loss = 4·bias + 4·shimmer + cross + 2·falloff + err + struct + 2·edge
+ 2·(0.5613 − sharpness) + fog guard; J = loss ratio · time^¼ · mem^¼ (≤1.5× / 1.3×). First run (a1) drifted to
reconstruction-kernel and sub-line-count tweaks → restarted (a2) with the blur fixed outside the evolve block and the
rule that changes must alter what the cascade computes.

**Ground truth re-checked:** brute-force angular integration (exact per-cell chords) vs exact_ref at 256²: 8192 angles →
rms 1–2.6% (zero mean, = brute-force sampling noise); 65536 angles → 0.32% / max 1.3% on a 1-px light. exact_ref is exact.

**Search a2 (structural rules, 38 iterations, ~$60, Opus-heavy):** frustum-shaped strips, per-probe sub-line phase
dithering, angular prefilters on parent bins, sub-bin-centre sampling, 2-px "gapless" strips — none improved quality
(equal or 1.2–4× worse); best scores were memory/time engineering. Paused.

## Round 12 (Oct 9, night): free-space de-aliasing by ratio — HRC only supplies visibility

In free space fluence is an exact, shift-invariant convolution of emission with each pixel's subtended angle
(computable exactly: FFT / multilevel summation). HRC's aliasing for unoccluded light is a deterministic function of
the emitter positions. So estimate
    F ≈ F_exact_free · F_HRC / F_HRC_free,
F_HRC_free = HRC's response to the emitters with no transmittance (each emitter as if alone). Where light is unoccluded
the aliasing pattern cancels exactly; in shadow the ratio → 0.
- F_HRC_free must count each emitter cell exactly once per line: with t forced to 1, saturated opaque emission is counted
  in both halves of every interval split. Fix: a *free channel* whose seeds add S·(chord piece / full chord of the
  straight line through that cell) (`hrc_base.trace_free`), composed additively, merged with t = 1. It matches the
  per-emitter-pixel sum of isolated HRC runs to 0.2–0.7% rms.
- Results (256², exact refs; `wg/ratio.py`, FFT on CPU for now):
  | | strip HRC | ratio-corrected |
  |---|---|---|
  | v2 loss | 0.844 | **0.375** |
  | PSF bias / shimmer / cross / falloff (40 phases) | .047 / .031 / .096 / .010 | **0 / 0 / 0 / 0** |
  | err / struct / edge / sharpness | .042 / .022 / .177 / .561 | .030 / .016 / .184 / .581 |
  | held-out err / struct / edge | .041 / .020 / .188 | .028 / .013 / .196 |
  | moving light + wall + stair (40 phases): shimmer / mean abs err | .028 / .040 | .011 / .014 |
  Every occluded family improves (wall .061→.040, diag .063→.042, pinhole .045→.031, room .032→.025; big unchanged).
  Residual error = HRC's visibility errors in beams/penumbrae.
- Colour: per-channel free channels best (red .073→.059, blue .062→.047); one luminance channel helps less (.061/.059) —
  natural fit for the production split mode (full-res mono luminance + low-res colour).
- Cost to engineer: one extra f16 channel per interval and per merge cone (or the free cascade as a separate pass), plus
  the exact free-space convolution (GPU FFT ≈ 2 ms @1024², or multilevel summation ≈ 0.2–0.5 ms).
- **Single pass** (`wg/hrc_free.py`: r_free per interval + R_free per cone in the same cascade, both fluences blurred,
  ratio on the CPU with the FFT term): identical quality to the two-run version. Unoptimised prototype cost (free
  channel f32, seed rays traced twice, f32 merges): 1.35× time @512², 1.47× @1024², memory 92 → 136 MB. Expected after
  the usual engineering (f16 free channel, one fused per-probe seed pass, f16 merges, T0/top-level not stored): ≈ +25%
  time, memory ≈ committed; plus the exact free-space convolution (GPU FFT 2048² padded, mono ≈ 1 ms @1024²).
- Visual check (`wg/out/ratio_visual.png`): spokes gone around 1-px and small lights; open areas match exact; remaining
  differences are HRC's visibility (beam width, soft thin shadows), unchanged.

## Round 13 (Oct 10): reframing — aliasing and visibility decouple

With the ratio, the residual error is exactly F_exact_free · (V_HRC − V), where V = emission-weighted visible fraction
(bounded [0,1], smooth except at shadow edges). Aliasing is gone from the problem, so lattice/merge choices that were
rejected *for aliasing* can be judged on visibility alone.
- Removing the cross blur makes it worse (loss 1.28): HRC's checkerboard leaves receivers with no samples of a light
  (0/0); the blur is what interpolates V there.
- **c = 1 lattice + ratio: loss 0.116** (held-out 0.072) vs strip HRC 0.844 and HRC+ratio 0.375 (held-out 0.352).
  Its cross was pure emission aliasing and cancels completely; what remains is c=1's sharper visibility:
  err .026, struct .013, edge .157, sharpness .680 (held-out .025/.011/.161/.704). Big light slightly worse (.012 vs .0075).
  Visual (`wg/out/c1ratio_visual.png`): close to exact; tighter beams; faint axis lines where lights are partly occluded
  (cancellation is exact only for unoccluded light). Cost: c = 1 doubles rays and bins (≈2× cascade), + free channel + FFT.

## Round 14 (Oct 10): per-cone oracle and the visibility floor

**Per-cone oracle** (`wg/percone.py`, `wg/run_percone.py`). Each merged cone gets an exact free value K (the sector-clipped
angle of every emitter cell from the cone's apex, by brute force). HRC supplies only V = R / R_free per cone, pooled 1-2-1
over y±1. With V = 1 a lone 1-px light reproduces exact_free to float precision.

| variant (256², v2 loss) | loss | err / struct / edge / sharp |
|---|---|---|
| strip HRC | 0.844 | .042 / .022 / .177 / .561 |
| global per-pixel ratio, c=2 (Round 12) | 0.375 | .030 / .016 / .184 / .581 |
| per-cone at level 0 only | 0.383 | .031 / .017 / .176 / .570 |
| per-cone at all levels | 0.568 | .046 / .033 / .198 / .515 |
| per-cone, no pooling | 2.96 | (0/0 holes) |

- PSF bias, shimmer and cross are exactly 0 in every variant.
- At c=2, the granularity at which V is formed does not matter. Correcting at upper levels is worse: the K-apex vs HRC's
  effective apex mismatch compounds down the levels (shifting the apex by dx = −1 gives 0.99).
- Cone-level V adds nothing over pixel-level V.

**Visibility floor** (`wg/vfloor.py`). Brute force per pixel: A equi-angular full-length rays give V, which is combined
with exact free K.

| rays per pixel | err | edge | struct |
|---|---|---|---|
| 256 | .354 | | |
| 1024 | .043 | .079 | |
| 4096 | **.014** | **.018** | .004 |

- 256 rays miss small lights entirely (0/0).
- The `sharp` term is unreliable on noisy images (it reached .95–.98).
- Long dispatches must be split into short command buffers: the Metal watchdog silently zeroes them. Unsplit runs gave
  garbage; the earlier per-cone numbers were re-checked with K chunked and reproduced exactly.

**Conclusion.** With exact K, aliasing is gone. What separates HRC from ~perfect is now one number: visibility edge
resolution (edge .18 vs a floor of .02, err .031 vs .014). HRC's V comes from lines 2 px apart with one apex per cone,
so beams and penumbrae come out about 2–4 px too soft. This is the only remaining target, and it is a
sampling-density / representation problem for V, not for emission.

## Round 15 (Oct 10): visibility edge resolution — where it's lost

All runs: exact free K × V, 256², occluded families; `edge` = gradient error at strong reference gradients.

**Where the error lives** (`wg/vedge_split.py`, `wg/out/vedge_look.png`). 86 % of HRC's squared edge error sits more than
8 px from any occluder: beams through slits come out about 2× too wide and misdirected, and long shadow edges are too soft.
Contact shadows (≤ 3 px from an occluder) are only 4 %. Per family:

| | wall | pinhole | diag | room | multi | big |
|---|---|---|---|---|---|---|
| edge rms | .25 | .25 | .20 | .17 | .11 | .06 |

Per-pixel V also shows spokes inside the room: an occluded outside light imprints its aliasing through the global ratio.

**Ruled out at c = 2:**

| change | edge | err |
|---|---|---|
| baseline (blurred V, Round 12) | .172 | .030 |
| unblurred own V (blurred only where there are no samples) | .173 | .06 |
| seed width: 2 sub-lines | .172 | |
| seed width: 4 sub-lines | .172 | |
| seed width: thin + 0.1 offset | .173 | |
| seed width: thin, centred (corner-degenerate) | | .15 |
| ½/½ mix of a sub-bin's two edge paths | .220 | |
| slope-moment refocus (`hrc_refocus.py`): stored R·σ̄, near t and far read lerped toward the light's mean slope | .192 | |
| slope-moment refocus, gain 2 | .203 | |

Mixing apexes adds parallax error to V just as it did to emission.

**Density vs hierarchy** (`wg/videal.py`). A non-hierarchical ideal: each receiver traces straight thin rays with
2πR/c rays per distance shell (R/2, R], so lines are c px apart at every distance.

| | edge | err |
|---|---|---|
| ideal c = 2 | .174 (= HRC) | .206 (thin rays miss small lights; HRC's strips and merges don't) |
| ideal c = 1 | .080 | .054 |
| ideal c = 0.5 | .035 | .026 |
| brute 4096 rays | .018 | .014 |
| HRC on the c = 1 lattice (`c1v.py`) | .131 | |
| c = 1, even = 0 | .125 | |
| c = 1, cubic mixtures | .127 | (err up) |

The c = 1 lattice's free channel undercounts extended opaque lights by about 18 % (big-light err .22). Its visibility ratio
is biased there; the c = 2 free channel is unbiased (1.000).

**Conclusions.**
- At c = 2, edge sharpness is a pure line-density limit. HRC already equals the non-hierarchical ideal, so no merge or
  seed change can sharpen far shadows at this density.
- Edge error roughly halves with each halving of c (ideal: .17 → .08 → .035).
- HRC's hierarchy captures only part of the c = 1 gain (.13 vs .08 ideal).
- The way to "~perfect" V: a hierarchy that reaches the non-hierarchical ideal at c = 1 or 0.5. Cost is 2–4× lines at the
  same asymptotics. Candidate: the exact-adjoint, receiver-anchored scan gather (Rounds 4/Headline), which was near-ideal
  for the PSF on the full lattice. Its GPU cost was dominated by seeds and receiver traces, not the trees.
