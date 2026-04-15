# Polygonal HRC — Working Notes

## Core Idea

A polygonal variant of Holographic Radiance Cascades (HRC) using two shape types
— 0:1 triangles and 1:1 parallelograms — as "interval polygons" (segments) that
tile the radiance field with zero gaps and zero overlap. Each segment is analogous
to a ray interval in standard HRC: independently addressable, carrying its own
radiance + transmittance data.

Currently implemented in the "dual" (scatter) formulation: radiance is seeded at a
source and extended outward over the scene, then gathered for display. This is the
opposite of "primal" (gather) HRC, where each point collects incoming radiance from
all directions. As Alexander puts it: primal polygons represent pixels that
*contribute* fluence to a polygon; dual polygons represent pixels that *receive*
fluence from a polygon. The polygonal tiling itself works for both formulations.

## The Bresenham Connection

The tessellation is **Bresenham line rasterization in linespace** (intercept, slope).
Each segment is one step in a Bresenham walk:

- **1:1 parallelogram (band)** = H-step: advances the intercept axis
- **0:1 triangle** = V-step: advances the slope axis

For a line at position `lineIdx` with stride S, the walk draws a line of slope S
from (0-intercept, 0-slope) outward. Since S is integer (1 or 2), the walk is
trivially periodic: `[1 band, S triangles]` repeated. This is Bresenham-optimal
(maximally uniform spacing of bands among triangles for integer slope).

The Bresenham accumulator that generates the pattern:

```
step = 1 / (stride + 1)        // 1/3 for stride=2, 1/2 for stride=1
acc  = 1 - step                 // band-first phase: emit band at D=0
for each angular step:
    acc += step
    if acc >= 1.0: emit Band, acc -= 1.0
    else:          emit Triangle
```

## Recursive Subdivision: Bits of D

The extend operation across cascades is **recursive Bresenham at half resolution**.
Each cascade level adds one bit of angular precision:

| Cascade | dirCount | Angular precision |
|---------|----------|-------------------|
| C0      | 2        | 1 bit             |
| C1      | 4        | 2 bits            |
| C2      | 8        | 3 bits            |
| C3      | 16       | 4 bits            |
| CN      | 2^(N+1)  | N+1 bits          |

Angular distance D at cascade N is an N-bit number. Tracing the extend path
backwards, each cascade transition peels off one bit:

```
C(N) -> C(N-1):  srcD = D >> 1,  err = D & 1        (bit 0 of D)
C(N-1) -> C(N-2): srcD = D >> 2, err = (D>>1) & 1   (bit 1 of D)
...
C(1) -> C(0):    srcD = D >> N,  err = (D>>N-1) & 1  (bit N-1 of D)
```

**The bits of D are the complete Bresenham error history across all cascades.**
Each bit is one subdivision decision: "above or below the ideal line" at that
cascade level. Reading D's binary representation from MSB to LSB gives the
cascade-by-cascade path from coarse (C0) to fine (CN).

This is **binary search / successive approximation** of the angular direction,
implemented as recursive line subdivision in linespace.

## Bias Correction = Bresenham Antialiasing

When resampling the Bresenham walk at half resolution (the extend operation),
each angular step falls between two coarse-grid positions. The error bit
`err = D & 1` determines whether ceil or floor rounding is used.

Two independent propagation chains carry the two rounding modes:

- **Ceil chain** (shapeInDir < outerSeg): uses `oddOff = ceil(D/2) = (D+1)/2`
- **Floor chain** (shapeInDir == outerSeg): uses `D` directly or `floor(D/2)`

Together they provide both Bresenham neighbors at every angular step. This is
analogous to 2× MSAA for the angular sampling: two samples at each position
with different rounding, preventing the systematic staircase bias that would
otherwise compound across cascades.

This maps directly to the HRC paper's bias correction:
- **Eq. 14 (odd x)**: trace cone edges → ceil chain behavior
- **Eq. 15 (even x)**: average sub-probes → floor chain behavior

The floor chain cross-pollinates at odd D: it reads from the ceil chain's
shape 0 instead of its own outerSeg. This alternation IS the Bresenham
correction step — when the error accumulates past threshold, you peek at
the neighboring cell to prevent systematic drift.

### Why outerSeg Can't Be Dropped

Shape 0 and outerSeg share identical geometry but carry independent data
because they maintain the two rounding chains. Dropping outerSeg removes
the floor chain, leaving only ceil rounding — equivalent to aliased
Bresenham rendering. The systematic ceil-only bias compounds multiplicatively
across cascade levels, causing progressive angular drift.

The outerSeg IS the antialiasing.

## Terminology

| Term | Meaning |
|------|---------|
| **cascade** | Hierarchy level (C0–C5). Higher = coarser spatial, finer angular. |
| **lineIdx** | Spatial position along X in the probe grid. |
| **probeIdx** | Spatial position along Y in the probe grid. |
| **angleIdx** | Flat index for one angular sample. `angleIdx = dirGroup * SEGS_PER_DIR + shapeInDir`. |
| **dirGroup** | Direction group = `angleIdx / SEGS_PER_DIR`. Groups of 4 shapes share extend logic. |
| **shapeInDir** | Shape within direction group = `angleIdx % SEGS_PER_DIR`. |
| **dirCount** | Number of direction groups per cascade = `2^(n+1)`. |
| **dirMid** | Midpoint of direction range = `dirCount / 2 = 2^n`. Pivot for `angularDist`. |
| **stride** | 1 or 2, from line parity: `select(1, 2, (lineIdx & 1) == 0)`. |
| **outerSeg** | Index of floor-chain shape within group = `stride + 1`. |
| **D** | Angular distance from center direction. `D = angularDist(dirGroup, dirMid)`. |
| **err** | Bresenham error bit = `D & 1`. Controls bias correction (HRC even/odd x). |
| **oddOff** | Ceil-chain probe offset = `(D + 1) / 2 = srcD + err`. |

## Property Table — What's Computable from Indices

Given **(cascadeN, lineIdx, probeIdx, angleIdx)**, everything is pure arithmetic:

| Property | Formula |
|----------|---------|
| dirCount | `2 << cascadeN` |
| dirMid | `1 << cascadeN` |
| lineSpacing | `LINE_SPACING << cascadeN` |
| stride | `select(1, 2, (lineIdx & 1) == 0)` |
| dirGroup | `angleIdx / SEGS_PER_DIR` |
| shapeInDir | `angleIdx % SEGS_PER_DIR` |
| outerSeg | `stride + 1` |
| shape type | `shapeInDir >= 1 && shapeInDir < outerSeg` → triangle, else → parallelogram |
| D | `angularDist(dirGroup, dirMid)` |
| shape exists? | `shapeInDir <= outerSeg` |
| full geometry | determined by above (see `segmentTest`) |
| err | `D & 1` — Bresenham error bit |
| oddOff | `(D + 1) / 2` — ceil-chain probe offset |
| buffer offset | `probeIdx * CASCADE_W + lineIdx * dirCount * SEGS_PER_DIR + angleIdx` |
| extend sources | `srcBase = (dirGroup / 2) * SEGS_PER_DIR`, err-based arithmetic |

No geometry buffers, no shape type flags, no vertex data stored.
The address IS the geometry. Only radiometric payload `(r, g, b, t)` lives in the buffer.

## Data Layout — Constant per Cascade

Spatial resolution halves while angular resolution doubles, so data per cascade is constant:

| Cascade | Lines | dirCount | Segs/dir | **Used per row** |
|---------|-------|----------|----------|-----------------|
| C0 | 32 | 2 | 4 | 256 |
| C1 | 16 | 4 | 4 | 256 |
| C2 | 8 | 8 | 4 | 256 |
| C3 | 4 | 16 | 4 | 256 |
| C4 | 2 | 32 | 4 | 256 |
| C5 | 1 | 64 | 4 | 256 |

Each cascade: **256 × NUM_PROBES = 8,192 entries** = 131KB (vec4f).
Total for all cascades: ~786KB.

Note: odd lines use 3 of 4 segment slots (1 wasted). ~12.5% padding, acceptable.

## Direction Scheme — 90° Cone

`dirCount = 2^(n+1)` direction groups per cascade (always even).
`dirMid = dirCount / 2` is the center pivot.

- `offset = dirGroup - dirMid`
- `offset >= 0`: downward. Triangles expand downward from probe.
- `offset < 0`: upward. Geometry mirrored around `P + 0.5`.
- Two center direction groups (offset=0 and offset=-1) share the same 1:1 at D=0
  but carry independent data.

## Shape Layout per Direction Group

Per direction group (4 entries, `shapeInDir` 0–3):

- Even line (stride=2): `[1:1, 0:1, 0:1, 1:1]` — shapeInDir 0,1,2,3
- Odd line (stride=1): `[1:1, 0:1, 1:1, ---]` — shapeInDir 0,1,2 (3 unused)

Shape 0 and outerSeg (`stride+1`) are 1:1 parallelograms (shared geometry, independent data).
Shapes 1..`outerSeg-1` are 0:1 triangles.

Bresenham interpretation: per direction group, the walk does 1 H-step (shape 0 = band)
then `stride` V-steps (shapes 1..stride = triangles). outerSeg is a second H-sample
at the same position — the floor-chain complement of shape 0's ceil-chain sample.

## Extend Rules

Each destination shape reads from two source lines: `lineIdx*2 - 2` (even, stride=2)
and `lineIdx*2 - 1` (odd, stride=1). The Bresenham error bit `err = D & 1` controls
bias correction, directly analogous to HRC paper Eq. 14 (odd x) / Eq. 15 (even x).

**Ceil chain** (shapeInDir < outerSeg):
- `oddOff = (D + 1) / 2 = srcD + err`
- Even source line: probe offset `2 * oddOff`, same shapeInDir
- Odd source line: probe offset `oddOff`, shapeInDir clamped to 1

**Floor chain** (shapeInDir == outerSeg):
- Even source line: probe offset `D`, source shape = outerSeg (err=0) or shape 0 (err=1)
- Odd source line (err=0 only): probe offset `D / 2`, source shape = outerSeg of odd line

The floor chain exists because 1:1 shapes span a nonzero left-edge height,
requiring two independent spatial samples. Merging them causes progressive blur
(averaging before propagating is lossy across cascades). This is specific to the
dual (scatter) formulation — primal HRC avoids it by computing top-down.

Cross-pollination at odd D (err=1): the floor chain reads from ceil chain shape 0
instead of its own outerSeg. This is the Bresenham corrective step that prevents
systematic rounding bias.

## C0 — Special Case

C0 is a single 0:1 triangle from the source probe's center to its right edge.
It is 4 pixels (half a probe) wide. It does NOT leave the source probe horizontally.
All subsequent cascade geometries are shifted +LINE_SPACING along X.

## Storage — vec4f payload

Each segment stores `vec4f(r, g, b, t)`:
- `rgb`: radiance
- `a`: transmittance (not yet implemented — currently binary 0/1)

Merge formula (from HRC paper, premultiplied alpha):
- `r_combined = r_near + t_near · r_far`
- `t_combined = t_near · t_far`

## TODO

- [x] Independent angular data per segment (extend reads from matching source segments)
- [x] Simplify extend rules: oddOff = (D+1)/2, eliminate isInner/srcD/srcDirGroup
- [x] Bresenham equivalence proof and documentation
- [ ] Right-size cascade buffers (256-wide, not 8192-wide)
- [ ] Per-cascade dispatch sizing (32 workgroups, not 1024)
- [ ] Implement transmittance (r,g,b,t) with proper merge
- [ ] Efficient gather (direct segment lookup instead of brute-force loop)
