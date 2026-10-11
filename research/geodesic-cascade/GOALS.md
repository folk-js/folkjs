# Geodesic cascades: goals, evaluation, kill criteria

The idea: an RC-style hierarchy (quadtree / nested dissection) for distance fields on grids with obstacles. Each block
stores the boundary-to-boundary distances through its interior, which are Monge because planar shortest paths don't
cross. A per-goal query is one bottom-up pass plus one top-down pass, so the number of sequential steps is about log N,
whatever the map looks like.

**This is only interesting if it beats real state-of-the-art implementations on real workloads,** or matches them with a
credible path to better constants. A theoretical win is not the goal: Klein–Subramanian (1993) already give polylog-depth,
linear-processor planar shortest paths.

## Problems

| | metric | exactness target | notes |
|---|---|---|---|
| **P1** | 4-connected, unit cost | exact (integers) | planar; Monge holds exactly; unit-Monge compression may apply |
| **P2** | 8-connected, costs 1 / √2 | exact for the graph | **not planar** (diagonals cross): the Monge argument fails as stated; open |
| **P3** | Euclidean geodesic (any-angle) around blocked cells | relative error ≤ 1e-3 vs exact | the continuous plane is planar, so Monge holds; error comes only from boundary sampling |

**Input:** an N×N occupancy grid plus a goal set (cells; one or many). **Output:** distance at every free cell centre.
The gradient or next-step direction follows from that.

## Workloads (where each method should win or lose)

Every evaluation reports all of these; no cherry-picking.

1. **Open / sparse obstacles:** random disks and boxes at 5–20 % fill. Sweeping and eikonal methods converge in a few
   passes here. **Expected: we lose or tie.**
2. **Rooms and doors:** game-like indoor maps.
3. **Mazes:** corridor widths 1, 2, 4, 8, 16, 32 px. Paths are long and winding (path length up to ~N²/w).
   **Expected: our best case.**
4. **Real game maps:** the Moving AI benchmarks (DAO, Starcraft, Baldur's Gate, city maps). These need a download; ask
   first.
5. **Goal patterns:** one goal; many goals (multi-source); and many independent goal sets on one static map (a crowd with
   different targets).
6. **Dynamic:** k random cell toggles per frame, measuring the cost to restore an exact field.

Sizes are N = 256, 512, 1024, 2048. Report scaling, not single points.

## Baselines (implemented seriously, same hardware: M2 Pro, WebGPU/wgpu harness plus native CPU)

- **CPU BFS** (P1/P2) and **CPU Dijkstra** or a bucket queue (P2): single-thread, cache-friendly, flat arrays.
  - At 1024², BFS should take a few ms. This is the bar to beat; a GPU method that loses to one CPU core is not a result.
- **GPU wavefront / Jacobi relaxation** (P1/P2/P3): plain, then the strong version: tile-local iteration in workgroup
  memory, with active-tile lists (FIM-style).
- **GPU fast iterative method (FIM)** and **parallel fast sweeping** (P3, eikonal). Also report their first-order error
  against exact.
- **Fast marching** (CPU) for P3.
- **JFA** (no obstacles) only as a lower bound on pass cost; it does not solve P3.
- **Hierarchical / portal flow fields** (games practice): approximate, so report as an accuracy–latency point.
- **Exact P3 reference:** visibility graph over the convex corners of free space, plus Dijkstra, plus per-cell visible-corner
  minimisation. Offline ground truth only (N ≤ 512).

## Metrics

- **Query latency:** end-to-end GPU (or CPU) time from "goals given" to "field ready", median and p95, interleaved runs.
- **Throughput:** goal sets per second on a static map.
- **Precompute:** obstacle-dependent build time; **update** time per k toggles.
- **Memory:** bytes resident.
- **Depth:** dispatches and global barriers per query. This is the latency-floor proxy.
- **Accuracy:**
  - P1/P2: exact match required.
  - P3: max and mean relative error vs the exact reference. Report the eikonal baselines the same way.
- **Measurement discipline:** wall time with GPU timestamps cross-checked; same hardware; baselines tuned with equal
  effort. See [[perf-baseline-discipline]].

## Asymptotics (CPU vs GPU timings are not like for like)

Compare methods in the **work–depth model**, plus measured scaling curves (N = 256 … 4096), not single wall-clock points.

| method | work | depth (sequential steps) |
|---|---|---|
| CPU BFS | N² | N² (serial) |
| wavefront / block FIM / sweeping | ≥ N² | ∝ path length (up to ~N² in mazes): local propagation moves information O(tile) per step |
| cascade | ~N² log N (more with squaring in merges) | polylog N, independent of obstacles and goals |

**"Depth ≥ path length" holds only for local propagation.** Hierarchical shortcuts break it. A 1-px unbranched maze is a
list, and its distance field is a prefix sum (list ranking): O(log n) depth, O(n) work. Trees: Euler tour plus list
ranking. Planar graphs: separators (Klein–Subramanian). HRC does the same for light: rays of length N in log N extension
levels. Work cannot drop below N², since every cell must be written.

The wall-clock comparison with single-thread CPU BFS stays as a practical reference: for a GPU-resident consumer, the
alternative is a CPU solve plus transfer.

## Cost model (predictions to check, not results)

**Notation.** Block at level M: side 2^M, k ≈ 4·2^M boundary cells.

**Per query** (bottom-up goal vectors plus top-down vector × table min-plus):

| | per level | total over log N levels |
|---|---|---|
| brute-force min-plus, O(k²) per block | 16 N² ops | 16 N² log N ops |
| Monge row minima (SMAWK / parallel D&C), O(k) to O(k log k) per block | ~N² | ~N² to N² log N |

**Memory traffic** (brute force, which reads every table each query): ~16 N² log N entries.
- At 1024² with 16-bit entries that is ~320 MB per query, about 1.5–2 ms at ~200 GB/s.
- **Memory traffic is the likely limiter, not ALU.**

**Structure memory:**

| tables stored as | memory | at 1024² |
|---|---|---|
| plain k² per block | ~16 N² log N entries | ~160 M |
| unit-Monge / seaweed form (if it applies), ~k per block | ~N² total | |

The compressed form is what would make 2048² and dynamic updates viable.

**Rough competitors on a 1024² maze:**

| method | rough cost |
|---|---|
| CPU BFS | ~5–10 ms (to measure) |
| GPU wavefront | ~path length / tile size global iterations, ~10⁴+ dispatches on a w=1 maze: hopeless |
| cascade | ~1–3 ms per goal set if memory-bound as above |

**Kill criteria.** Stop or re-scope if any of these holds:

- **(a) Query latency:** on mazes (w ≤ 4) at N ≥ 1024, a P1 query is not clearly faster than the best of CPU BFS and
  GPU tile-FIM.
- **(b) Memory:** structure memory at 1024² can't be brought under ~100 MB, i.e. no compression.
- **(c) P3 accuracy:** boundary-sampling error can't beat eikonal solvers' error at equal or lower cost.

## Order of work

1. **Information tests** (CPU, exact, cheap; no design yet):
   - P1: are maze-block boundary tables Monge per arc pair, and unit-Monge (density a permutation, i.e. seaweed form)?
     How many nonzeros does the density have relative to k?
   - P3: are geodesic boundary tables Monge, and how compressible are they (numerical rank, piecewise structure)?
     How large is the snapping error?
2. **Exact CPU reference cascade** for P1, checked cell-for-cell against BFS, with instrumented work, depth and memory
   counts. This validates the cost model.
3. **Strong baselines** on the GPU harness. Do this before the GPU cascade, so the target is known.
4. **GPU cascade**, only if 1–3 leave a credible win region.
