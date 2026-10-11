# folk-flow-field: notes

Element: `packages/labs/src/folk-flow-field.ts`. Demo: `website/demos/shaders/flow-field.html`.

## Algorithm

Per pixel: distance + visibility (packed u32: 1/1024 px fixed point | 6-bit visibility) and emitter + goal label (packed
u32: 11 + 11 + 10 bits).
- **Emitter:** the point the pixel measures a straight line from (a goal, or the pixel where the path bends).
- **Lineage:** parent/pivot marching (Visibility-Based Marching, Ibrahim et al., RA-L 2024, arXiv 2409.11545).
- **What differs from VBM:**
  - parallel instead of a priority queue;
  - visibility is stored only for each pixel's own emitter;
  - ties are broken toward farther emitters.

Rules for pixel p from the three pixels behind it in a sweep:
- **Inherit q's emitter E** if E lies behind p within 45°. Visibility is carried upwind: the line p→E crosses between
  the two pixels behind, at offset f, so v = (1−f)·vis(a) + f·vis(b), where vis(x) = v(x) if x's emitter is E (1 if x is
  E), else 0. Accept if v ≥ 0.5. Value = d(q) − |q−E| + |p−E|.
- **Bend at q:** value = d(q) + |p−q|, accepted only if strictly better.
- **Ties** at equal distance switch to the farther emitter. Without this, a bend picked up before the true emitter
  arrived sticks, and error grows with distance (seen as octant patterns in open space).

Scheduling:
- **Tiles:** 32×32 tiles in workgroup memory, relaxed by directional sweeps (→ ← ↓ ↑).
  - One thread per row or column; with 32-wide subgroups the step-to-step exchange is a shuffle.
  - Stop when 3 sweeps after the last change were quiet (a sweep cannot improve on itself).
- **Order:** 2×2 checkerboard of tiles, so updates are in place and race-free.
- **Wake-ups:**
  - a tile wakes only if the neighbour edge/corner facing it changed;
  - a woken tile first checks only its border (4 single steps) and skips the sweeps if nothing improves.
- **Edits** only reset what they can affect:
  - new wall pixel s → pixels with s's goal label and distance ≥ 0.9·d(s) − 2;
  - erased goal → its label.

  Only tiles with changed pixels run in full.
- **Frame budget:** rounds per frame come from measured GPU time.

## Validation (vs exact visibility-graph geodesics, 256², 6 goals; `make_testdata.py`)

| scene | mean (px) | max (px) | min (px) |
|---|---|---|---|
| empty | 0.00 | 0.08 | −0.01 |
| boxes | 0.53 | 5.7 | −0.04 |
| rooms | 0.42 | 1.9 | −0.05 |
| maze | 0.84 | 3.8 | −0.04 |
| Berlin | 0.30 | 2.3 | −0.08 |
| lak303d | 0.37 | 8.9 | −0.1 |

- No unreached pixels in any scene.
- The remaining error is mostly paths bending at pixel centres instead of wall corners (up to ~0.5 px per bend).

## Performance (Apple GPU, Metal; 1024², cold solve, seed 42 presets, GPU timestamps)

| scene | ms | rounds |
|---|---|---|
| open + goals | 19.7 | 11 |
| scatter | 23.3 | 12 |
| rooms | 21.4 | 11 |
| spiral | 31.9 | 31 |
| maze | 59.5 | 29 |

History (open + goals): Jacobi tiles 150 ms → sweeps 37 → wake/border checks 27 → subgroup shuffles 19–21.

Tried and rejected:
- **Per-pixel change bits:** SIMD divergence made them useless.
- **Early hand-off after the arrival sweep:** 30–50 % slower because of extra rounds.
- **Deduplicating identical emitters:** no gain.

Bottleneck: sweep-step latency (~1 µs) on sparse fronts (maze, spiral), and ~5 tile runs per tile on dense fronts.

## Update: corner bends, half-tiles (rejected), wall bitmasks

- **Corner bends.**
  - Emitter coordinates are now in half pixels (canvas ≤ 1024²), so an emitter can be a wall corner.
  - A pixel can take its own corner C on the swept-from side when exactly one of the 4 cells around C is a wall:
    w(C) = w(E_q) + |E_q − C| from a behind pixel touching C (rejected if E_q would see C through the wall quadrant).
  - Pixel-centre bends remain as a fallback.
- **Accuracy at 256²** (mean / max px):

  | scene | mean / max |
  |---|---|
  | empty | 0.00 / 0.2 |
  | boxes | 0.36 / 5.5 |
  | rooms | 0.32 / 1.5 |
  | maze | 0.41 / 2.2 |
  | Berlin | 0.26 / 2.1 |
  | lak303d | 0.23 / 8.9 |

  - Underestimates stay ≤ 0.18 px.
  - lak303d's max is a 42-px pocket behind a jagged diagonal wall, reachable only through 1-px diagonal gaps.
- **16×16 half-tiles, two per 32-lane subgroup.** Correct, but slower (open + goals 29 ms vs 20): rounds double and tile
  runs rise 5.5×. The kernel is generic in TS / K; TS = 32 is used.
- **Wall lookups** in a sweep step now come from per-lane register bitmasks: the lane's line and the two beside it (row
  masks by ballot, column masks accumulated during the tile load).
- **1024² cold** (seed 42):

  | scene | ms |
  |---|---|
  | open + goals | 21.8 |
  | scatter | 31.9 |
  | rooms | 23.7 |
  | maze | 58.7 |
  | spiral | 36.3 |

  Corner bends cost ~0–8 ms (most on scatter, which has many wall corners).

## Experiment: jump flooding with visibility (the "hierarchical straight-line transport" test)

- **Wall distance field.** Jump flooding with wall seeds (11 passes + 1 at 1024²), conservative: centre distance minus
  0.71.
- **Emitter passes** at steps N/2 .. 1, nine candidates each.
  - Take q's emitter E if w(E) + |p − E| is shorter and E is visible.
  - Visibility: sphere-trace P → E through the wall distance field; reject when it gets within 0.25 px of a wall,
    accept when E is within reach.
  - Tiles that changed are marked for a full sweep run.
- **Cost:** about 2–4 ms at 1024² (wall distance field + 10 emitter passes).
- **Cold (seed 42):**

  | scene | without | with (sweeps + flood) | rounds |
  |---|---|---|---|
  | open + goals | 21.8 | 3.6 + 4.1 = 7.7 (2.8×) | 11 → 1 |
  | scatter | 32.8 | 27.0 + 2.3 | 12 → 11 |
  | rooms | 23.7 | 20.4 + 2.3 | 11 → 10 |
  | maze | 58.5 | 57.8 + 1.8 | 25 → 24 |

- **Adding a goal in open space:** 9.3 ms / 9 rounds → 1.6 ms / 1 round (+ flood). In scatter and rooms there is no gain.
- **Re-flooding every k rounds** (so corner emitters flood into their shadows): worse. Each flood finds new sub-pixel
  improvements (straight distances to far emitters are slightly shorter than the sweeps' approximations), so
  convergence never settles: 40–60 rounds, 130–320 ms.
- **Accuracy unchanged or better** (empty becomes exact); min −0.23 px, so no leaks.

**Reading.** Hierarchical straight-line transport removes the path-length factor exactly where paths are straight and
visible. As soon as most of the field lies behind obstacles, the depth is set by bends and local corner turning, and
the flood doesn't help. This matches the research prediction (rounds ∝ bends, not path length). A version that floods
from newly created corner emitters only, instead of re-flooding everything, is the obvious next variant, but the
sub-pixel-improvement churn would have to be controlled (e.g. a larger improvement threshold for flood updates).

Default: flood after full resets and goal additions only (it is pure overhead for wall edits).
