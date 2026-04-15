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
| **outerSeg** | Index of boundary shape within group = `stride + 1`. |
| **D** | Angular distance from center direction. `D = angularDist(dirGroup, dirMid)`. |

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
| buffer offset | `probeIdx * CASCADE_W + lineIdx * dirCount * SEGS_PER_DIR + angleIdx` |
| extend sources | `srcDirGroup = dirGroup / 2`, stride/D-parity arithmetic |

No geometry buffers, no shape type flags, no vertex data stored.
The address IS the geometry. Only radiometric payload `(r, g, b, t)` lives in the buffer.

## outerSeg — Why It Can't Be Dropped

Shape 0 and outerSeg (shape `stride+1`) within each direction group share identical
geometry but carry **independent propagation chains**:

- **Shape 0**: reads at `oddOff`-based probe offsets (inner angular sampling)
- **outerSeg**: reads at `D`-based probe offsets (boundary angular sampling)

Together they capture the full angular extent of the 1:1 parallelogram. Merging them
into one buffer entry causes cross-contamination that compounds at every cascade level.
This is analogous to the HRC paper's even/odd bias correction — two samples at the
same position with different source offsets, combined for accuracy.

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

## Extend Rules

Each source shape feeds into `outerSeg + 1` destination shapes = the 1:1 it meets
plus `stride` adjacent triangles (`stride` = 1 or 2 depending on destination line parity).

This naturally encodes the even/odd bias correction from the HRC paper:
stride=2 lines get wider angular spread, stride=1 lines get narrower.

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
- [ ] Right-size cascade buffers (256-wide, not 8192-wide)
- [ ] Per-cascade dispatch sizing (32 workgroups, not 1024)
- [ ] Simplify extend rules: collapse inner/outer branches into unified segment spread
- [ ] Implement transmittance (r,g,b,t) with proper merge
- [ ] Efficient gather (direct segment lookup instead of brute-force loop)
