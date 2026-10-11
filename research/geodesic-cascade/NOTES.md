# geodesic-cascade — notes

## Round 1: P1 information test (`info_p1.py`, `info_p1b.py`, `maps.py`)

**Setup.** 4-connected unit-cost grids. Blocks of side b, cut at random from 512² maps. Each block's boundary-to-boundary
distance table is computed through its interior by BFS from every boundary cell.

**Monge.** For complementary arcs of the boundary cycle (sources in cyclic order, targets reversed), the cross-difference is
≤ 0 with **zero violations** in every case: mazes w = 1–8, 15 % boxes, rooms, empty, at b = 16, 32, 64.

**Unit-Monge (seaweed).**
- Empty blocks: yes. The density is {0, −2} with at most one nonzero per row and column, i.e. a ×2 permutation (the 2 comes
  from grid bipartiteness).
- Blocks with obstacles: **no**. Density values reach −68, with up to 57 nonzeros in one row (rooms).

**Sparse-Monge compressibility.** A Monge table is fixed by its first row and column plus its nonzero cross-differences.
Per table, using the 16 side-pair sub-tables:

| quantity | value |
|---|---|
| stored numbers / k | 8–11, flat over b = 16…128 (8 of that is first-row/column overhead) |
| nonzero density / k | 0.8–2.8 |
| density mass / k | 1–5 (grows slowly with b for rooms 1.8 → 5.1 and w1 mazes 1.8 → 3.2) |
| dense equivalent | k² |

So P1 tables compress to about 10k numbers instead of k².
- **Structure memory:** Σ over levels (N/2^M)² · 40 · 2^M ≈ 40 N² / 2^M_leaf · 2, i.e. about 5 N² entries with 16-px
  leaves (≈ 5 M at 1024²), vs ≥ 16 N² log N dense.
- **Not yet covered:**
  - Disconnected pairs (most pairs in w = 1 mazes) are excluded above. They are set by the boundary's connectivity
    partition, which is non-crossing and O(k) to store, but storing them isn't implemented or measured yet.
  - Samples are small: 4–6 blocks per case.

**Open question this raises.** Merging two tables and the per-query vector × table min-plus step both need to run directly on
the sparse-density form, at O(k polylog k) and in parallel. For the permutation (unit-Monge) case Tiskin's seaweed algebra
does this; for sparse integer densities with mass O(k) I don't yet know of an algorithm. Possible routes:
- split mass into unit strands, which turns a sparse density into a sub-permutation with multiplicities;
- SMAWK on implicit entries;
- a range-tree for prefix sums of the density.

## Round 2: P3 information test (`geo.py`, `info_p3.py`; Moving AI maps in `data/`, loader `maps.load_movingai`)

**Exact geodesic engine** (`geo.py`):
- visibility graph over reflex corners of free space, then Dijkstra;
- no corner cutting; paths may run along edges; pinch points excluded as bends (only 90° wedges there);
- checked: wall detour, pinch detour, symmetric, triangle inequality, never above an independent centre-visibility bound.

**Monge:** 0 violations on every map type, b = 16, 32, 64. Planarity carries over to Euclidean geodesics as expected.

**Compressibility** (numerical rank of side-pair sub-tables, finite ones only):

| tolerance (relative to σ_max) | b = 16 | b = 64 |
|---|---|---|
| 1e-3 | 3–4 | 3–6 (flat) |
| 1e-6 | 6–13 | up to 24–41 of 48–62, i.e. near full |

Low rank holds only at loose tolerance; at 1e-3 the absolute error is about 0.06 px at b = 64. Real values mean
P1-style sparse densities don't apply.

**Snapping error of one merge.** Children tables are computed exactly through samples on the separator line at spacing h;
the merge is a proper multi-crossing shortest path over both children's tables.
- Most maps (boxes, rooms, empty, maze w4), h = 1: mean abs ≈ 0.01–0.05 px, max 0.1–0.5 px. With h = 0.5: max ≈ 0.07–0.23 px.
- **1-px mazes: mean 0.25–0.53 px, max 2.0–2.1 px (h = 1); max 0.6–0.9 px (h = 0.5).** The exact path hugs corridor corners
  and crosses the separator off-centre; forcing it through cell-centre samples costs up to ~2 px per merge.
- Errors will compound over log N merges; not yet measured.

**Reading.**
- P3 by point-sampling separators is **not** exact, and is worst exactly where we hoped to win (narrow mazes).
- Exactness would need the separator crossing to be handled analytically. A child's distance along a free separator
  segment is a lower envelope of cones w_c + |p − c| over visible apices c (corners or sources): continuous-Dijkstra /
  shortest-path-map style.
- That representation is exact, but its size per boundary (number of apices) is unknown. That is the next information
  question for P3.
- P1 (exact integers, sparse Monge) is on firmer ground.

## Round 3: baselines (`base_cpu.py`, `gpu.py`, `base_gpu.py`, `run_base.py`)

P1 (4-connected, unit cost), single goal, M2 Pro. Every GPU field is checked cell-for-cell against CPU BFS: **all exact**.
GPU time is wall clock from goal upload to a converged field, with a convergence-flag readback every 16 rounds (FIM) or
64 levels (wave).

| map | CPU BFS (1 thread) | GPU wavefront | GPU block FIM (16² tiles) | longest path |
|---|---|---|---|---|
| maze512-1 | 2.5 ms | 149 ms (4,747 passes) | 32 ms (308 rounds) | 4,746 |
| maze512-4 | 1.9 ms | 317 ms (5,521) | 42 ms (336) | 5,520 |
| maze512-32 | 1.2 ms | 102 ms | 19 ms (132) | 2,105 |
| 32room 512 | 1.4 ms | 42 ms | 9 ms (49) | 773 |
| Berlin 1024 | 3.4 ms | 127 ms | 20 ms (105) | 1,647 |
| empty 1024 | 5.7 ms | 94 ms | 19 ms (87) | 1,382 |
| maze1024-1 (generated) | 6.9 ms | 8.2 s (83,813) | 940 ms (5,122) | 83,812 |
| maze1024-4 (generated) | 3.6 ms | 2.5 s | 308 ms (1,648) | 23,364 |

**Reading.**
- **Single-thread CPU BFS beats both GPU relaxation methods on every map,** by 5–140×. GPU pass counts scale with path
  length exactly as predicted. Even an optimistic 5× tuning of FIM (active-tile compaction, 32² tiles) leaves mazes
  hundreds of ms behind.
- This matches the known weakness of GPU BFS on high-diameter graphs (road networks).
- So for latency, **the real bar is CPU BFS: ~1–2.5 ms at 512², ~3.5–7 ms at 1024².** GPU relaxation only matters when
  the field must live on the GPU and readback/upload is unacceptable.
- **Implication for the cascade.** It needs a fixed-pass query clearly under CPU BFS: target ≤ 1 ms at 1024² for a
  convincing result, and ≤ ~3 ms to be competitive. That is consistent with the earlier memory-traffic estimate only if
  the compact tables work.
- Not yet run: parallel fast sweeping (expected to behave like FIM on mazes, since sweep count grows with turns). FIM is
  untuned.

## Round 4: exact reference cascade (`cascade_ref.py`, `test_cascade_ref.py`, `stats_cascade.py`, `seam_test.py`)

**Method.**
- Binary splits of the grid, alternating vertical and horizontal, down to 8×8 leaves.
- Node table D = distances between the node's free perimeter cells ("ports") through its interior.
- Merge = shortest paths over both children's tables plus unit seam edges.
- Query: goal vectors go bottom-up (multi-source over the union graph); true port distances go top-down; leaves finish
  with their port-to-cell tables.
- The small solves use dense Dijkstra, as a correctness reference only.

**Exact:** matches BFS cell-for-cell on every case. Sizes 32², 64², 128²; maps empty, 1- and 2-px mazes, boxes, rooms,
35 % noise; 1–6 goals, 3 trials each.

**Tables at 256²** (Moving AI maze512-1/-8, 32room, Berlin, plus empty):
- every node table is Monge on every side pair (0 violations);
- **dense** storage is about 12–18·N² per level, 38–173·N² in total;
- **compressed** storage (first row/column plus nonzero cross-differences per side pair) is 7–17·N² in total, dominated
  by the 8×8 leaves (2–4.7·N²) and decaying geometrically upward. So it is **O(N²), independent of depth**, as predicted.

**The crux: multi-crossing seams.** A maze path can cross a node's seam many times. A fixed-depth query therefore needs
the precomputed **seam closure T**: distances within the parent between all seam ports, both sides. Is T Monge on
non-interleaved halves of the seam?
- Open maps (empty, boxes): yes, trivially; the cross-differences are all 0.
- **Mazes and rooms: no.** Violations appear in both orientations (e.g. maze w4: 5 / 70 each way). Seam ports lie
  inside the parent, so paths go around either side.

**Consequences.**
- T can still be stored dense: about 4·N² per level, ~4·N² log N in total, i.e. ~40 M entries at 1024². A query then
  applies it by brute force at ~4·N² per level, which is fixed and GPU-friendly.
- Alternatively T can be built from the two one-sided (Monge) closures.
- Without T, the query must iterate alternations, and the number of iterations depends on the scene.

**Open:**
1. A Monge-compatible decomposition of T (e.g. split by which side the path last ran along).
2. Building T in fixed depth. Squaring dense T costs s³ log s per node, about N³ at the top level. Cheaper routes:
   alternation squaring on the Monge one-sided pieces, or FR-style.
3. The total query memory traffic this implies, against the ≤ 1–3 ms target at 1024².

## Round 5: option 1 costed, option 2 analysed (`cascade_ref.add_seam_tables/query_fixed`, `test_fixed.py`, `cost1.py`, `seam_compress.py`)

**The fixed-depth query is exact: 54/54 vs BFS** (32²–128², six map types, 1/3/10 goals). Per internal node P = A ∪ B,
with seam ports Σ and T = distances within P among Σ:
- **up:**
  1. hg = g|Σ ⊗ T
  2. g_P(x) = min(g_child(x), hg|Σ_child ⊗ D_child[Σ_child, x])
- **down:**
  1. a(τ) = min(g_child(τ), f|outer(child) ⊗ D_child[outer, τ])
  2. h = a ⊗ T, giving the children's seam values; outer ports keep the exact f.

Proof sketch: split each path at its first seam port. Before it, the path stays in one child (from a goal, or from that
child's last outer-port visit). After it, T covers the rest.

**Option 1 cost** (dense tables; entries read per query, units N², measured at 512² with 12 merge levels; at 1024² add
~2 more levels):

| map | T | D blocks (outer×seam): dense / Monge-compressed | leaf tables (or 0 with an in-tile relaxation) |
|---|---|---|---|
| maze w1 | 9.1 | 8.6 / 0.85 | 14 |
| maze w8 | 29.8 | 29.3 / 1.7 | 25 |
| 32room | 16.9 | 12.7 / 1.7 | 24 |
| Berlin | 23.1 | 24.5 / 1.8 | 21 |
| empty | 36.0 | 41.0 / 2.6 | 28 |

- The per-level totals are flat: about 4·N² and 2·N² on alternating levels for T in the worst case.
- **Worst case at 1024² (open map):**
  - **All dense:** ~90 N² ≈ 94 M entries read per query (≈ 0.2–0.4 GB at 2–4 B, i.e. ~1–2 ms at ~200 GB/s), with min-plus
    ops ≈ 2× entries. Stored: same order, 190–380 MB. **Fails the 100 MB criterion.**
  - **D blocks compressed** (Monge, so SMAWK applies): ~45 N² stored and read, ~0.6–1 ms per query, 90–180 MB.
  - **Mazes: 3–4× cheaper** (fewer free ports).
- Distance widths: 16 bits suffice for blocks up to ~360 px (path ≤ s²/2 in a maze); the top two levels need 32 bits.

**Option 2: can T be split into Monge pieces?**
- **Structural obstruction.** On the seam, D_A is Monge in A's perimeter order, and D_B in B's. The two perimeters run along
  the seam in **opposite directions**, so T, the closure of alternating D_A, seam edges and D_B, mixes Monge with
  inverse-Monge products.
- This is why Klein–Mozes–Weimann need |C| Bellman–Ford rounds of Monge products over a separator cycle, and why FR uses
  Dijkstra ordering. Classifying paths by which side they leave or arrive from doesn't restore non-crossing either: a path
  can dip under the seam outside the interval.
- **I expect no small Monge decomposition** of T in general (argument, not proof).
- **But T is empirically sparse.** First row/column plus nonzero cross-differences cost **4–11 numbers per seam port** on
  every map and level (mixed signs, so not Monge), plus O(|S|) component labels for disconnected pairs. So T has
  O(|S|) storage, and the total structure ~O(N²) with a small constant.

**What actually decides option 2:** a fast **parallel** min-plus product v ⊗ M for an arbitrary matrix stored as sparse
cross-differences.
- **Sequential, exists:** sweep columns j and keep w_i = v_i + R_i + P(i, j) in a segment tree. Each nonzero cross-difference
  at (r, j) is a range-add on rows > r; each output is a global min. Work O((|S| + nnz) log |S|), but depth |S| per node.
  That breaks the polylog claim at the top levels unless it can be parallelised (divide and conquer over j? a scan over
  piecewise-min functions?).
- **Next:** look for this primitive in the literature (dynamic range-add / range-min, "min-plus product with bounded
  total variation / sparse Monge-like matrices", Tiskin's seaweed for unit-Monge as the special case), and test the
  sequential version for exactness.

## Round 6: literature + sparse min-plus (`sparse_minplus.py`, `test_sparse_minplus.py`, `cascade_ref.add_compressed/query_compressed`, `test_compressed.py`, `cost2.py`)

**Literature.**
- **Gawrychowski, Gorbachev & Kociumaka, "Core-Sparse Monge Matrix Multiplication" (ESA 2025; arXiv 2408.04613).** The
  core is the set of nonzero density entries. For core-sparse **Monge** matrices the product costs O(n + δ log δ), and the
  product's core is linearly bounded by the inputs'.
  - This generalises Tiskin's unit-Monge / seaweed product (O(n log n)) and builds on Russo's adaptive SMAWK
    (O((n + δ) log² n)).
  - **Our per-block D tables are exactly core-sparse Monge** (Round 1: core ≈ 1–3 per port), so build-time merges sit
    inside a known framework.
  - Parallel variants: an MPC algorithm for subunit-Monge multiplication exists (LIS literature); not yet read.
- **Bounded-difference and monotone min-plus** (Bringmann, Grandoni, Saha & Vassilevska Williams; Chi, Duan, Xie & Zhang):
  matrix–matrix products, subcubic. Not the primitive we need.
- **I found nothing covering the non-Monge case we need:** the seam closure T (mixed-sign sparse core) applied as
  vector ⊗ matrix in low depth.

**Primitive, derived and verified.** Apply v ⊗ M for any finite matrix stored as R, C, M00 plus sparse cross-differences.
Disconnected pairs are split into component blocks.
- **Sweep:** segment tree over rows; each point is a suffix-add, each output column a global min.
  O((n + m + nnz) log n), sequential in m.
- **Divide and conquer over rows:** f_I(j) = min_{i∈I}(w_i + P_I(i, j)) is a step function whose breakpoints are only
  at the columns of points in I. Merge (I₁ below I₂): f = min(f_I₁, f_I₂ + Q), where Q = prefix sums of I₁'s points over
  columns. Work O((n + nnz) log n), depth O(log n) merge levels, each merge a parallel merge of sorted breakpoint lists.
  **Polylog depth for arbitrary-sign sparse cores.**
- **Exact:** 2,888/2,888 against brute force on real seam tables (6 map types, both methods).

**End to end.** The fixed-depth query on compressed T and D blocks (seam closures plus outer×seam blocks) is exact,
**72/72 vs BFS** (32²–128², 6 map types, 1 and 4 goals, both apply methods).

**Cost at 512²** (per query; "entries" = words stored: rows + cols + 3 per point; leaf tables excluded, to be replaced
by an in-tile relaxation):

| map | compressed read | dense read | ratio | sweep work |
|---|---|---|---|---|
| maze w1 | 7.2·N² | 40.7·N² | 5.6× | ~15·N² |
| maze w8 | 15.7·N² | 132.6·N² | 8.5× | ~33·N² |
| 32room | 14.4·N² | 69.7·N² | 4.8× | ~27·N² |
| Berlin | 16.0·N² | 106·N² | 6.6× | ~32·N² |
| empty | 23.0·N² | 171·N² | 7.4× | ~46·N² |

- **Stored:** about half of the read figure, since T is used up and down: ~4–12·N² words, i.e. **~5–15 M words
  (20–60 MB) at 1024²**, under the 100 MB criterion.
- **Projected at 1024²:**
  - per query ~25–30 M words read (≈ 0.1 GB, ~0.5–0.7 ms if bandwidth-bound) and ~50 M sweep-ops;
  - depth: ~2 log₂(N/8) node levels × (log n D&C levels × parallel-merge depth), fixed and independent of map and
    goals.

**Remaining to establish:** a GPU implementation (the D&C step-function merge in workgroups is the unusual part);
build-time cost and depth of computing T in compressed form; leaf finishing; wall-clock vs CPU BFS (3.5–7 ms) and GPU
FIM (20–940 ms) at 1024², and scaling 256 → 2048.

## Round 7: GPU query (`gpucascade.py` v1, `gpucascade2.py` v2, `gpucascade3.py` v3; tests `test_gpucascade*.py`; bench `bench*.py`)

The structure is prebuilt on the CPU (reference cascade plus compressed tables). Every version is exact against BFS
(36/36 on six map types, 32²–128²) and exact on the 512² benchmark maps with 1, 8 and 64 goals.

**Progression on maze512-8** (GPU time = timestamp span of the whole query):

| version | GPU time | what changed |
|---|---|---|
| v1 | 41 ms | one workgroup per 64-row chunk of each compressed block; prefix sums rebuilt in shared memory by a serial 256-step scan (~1 µs fixed cost × 25–55 k workgroups) |
| v1 | 11 ms | chunk-start prefix rows precomputed (obstacle-only data); no scan |
| v1 | 10 ms | thread-per-column kernel for tiny blocks (34 k of 36.7 k jobs have < 32 columns) |
| v2 | similar | in place on one array d[cell]: every value is a real path length that only decreases, so aliasing all node slots onto cells keeps exactness; no copy dispatches; 52–88 dispatches |
| **v3** | **2.0–3.4 ms** | **one thread per (32-row chunk, column)**: no shared memory, no barriers. The run was latency/occupancy-bound, not throughput-bound (Σ n·m ≈ 26–45 M min-ops ≈ 0.02 ms of ideal throughput) |
| v3 + batched row loads | worse | private arrays spill; reverted |

**v3 at 512², one goal:**

| map | GPU time | wall (Python encode + submit) | CPU BFS | GPU block FIM (Round 3) | memory |
|---|---|---|---|---|---|
| maze w1 | 2.05 ms | 2.8–4.1 ms | 1.8–2.1 ms | 32 ms | 9 MB |
| maze w8 | 2.69 ms | | 1.3–1.4 ms | 21 ms | 20 MB |
| 32room | 2.62 ms | | 1.2–1.3 ms | 9 ms | 20 MB |
| Berlin | 3.37 ms | | 0.8–0.9 ms | | 23 MB |
| empty | 3.17 ms | | ~1.0 ms | | 35 MB |

- **52 dispatches on every map; time is near-flat across maps and goal counts.** That is the HRC-style independence,
  measured.
- **Dispatch-overhead floor** (null kernels): 0.18 ms of GPU time for 137 dispatches. The 1.7 ms of wall time is
  Python-side encoding.
- **At 512² the cascade is ~4–15× faster than GPU block FIM, but 1.5–4× slower than single-thread CPU BFS** in GPU time.
  The 1024² scaling run is pending.

**v3 at 1024²** (`out/bench3_1024.txt`, `out/bench3_1024_empty.txt`; all exact vs BFS with 1, 8 and 64 goals):

| map | GPU time | CPU BFS | GPU block FIM (Round 3) | dispatches | memory |
|---|---|---|---|---|---|
| maze1024-1 | **6.4 ms** | 9.5 ms | 940 ms | 60 | 36 MB |
| maze1024-4 | **3.0 ms** | 4.3 ms | 308 ms | 58 | 15 MB |
| Berlin | 9.2 ms | 3.9 ms | 20 ms | 60 | 101 MB |
| empty | 10.7 ms | 4.7 ms | 19 ms | 60 | 147 MB |

- **Scaling 512² → 1024²:** cascade ×2.7–3.4, CPU BFS ×3–5.
- **Mazes:** the cascade now beats single-thread CPU BFS, and beats GPU relaxation by 100–150×.
- **Open maps:** 2.3× slower than CPU BFS, and memory is over the 100 MB criterion (101–147 MB). Open maps have the most
  ports, so the compressed tables are largest exactly where BFS is cheapest.
- **Build:** the CPU reference build is now parallel over sources (numba prange), ~6× faster (Berlin 512²: 6 s). Empty
  1024² takes 99 s. A GPU build is still needed for dynamic maps.
- **Next targets:** open-map cost and memory (the T tables dominate), and a GPU structure build.

## Step back: self-critique of Rounds 1–7 (written before any further work)

**Comparisons that favour us:**
1. **Weak GPU baselines.** The block FIM is untuned:
   - every tile is dispatched each round instead of an active-tile list;
   - a host readback every 16 rounds;
   - 16² int32 tiles; no persistent kernel; no bitsets for unit costs.

   Wavefront BFS was dense, one dispatch per level. Real high-diameter GPU traversal uses work-efficient frontier queues
   (Merrill et al.). For unit-cost grids the obvious strong design is a **bit-parallel** single-workgroup or persistent
   BFS: one row per thread as 64-bit words, ~a few hundred ns per level. On open maps with diameter ~1.5 k that is
   plausibly ~0.5–3 ms, i.e. faster than our 9–11 ms. **Not measured.** Parallel fast sweeping wasn't implemented at all.
2. **Weak CPU baseline.** Single-thread numba BFS with run-to-run noise (0.8–1.4 ms on the same map). No multithreaded or
   bit-parallel CPU BFS, no SIMD.
3. **Build cost excluded.** "GPU span" counts only the query. The structure takes 6–99 s on the CPU at 1024², and BFS,
   FIM and sweeping need none. For any map that changes, we currently lose by orders of magnitude.
4. **Memory.** We use 15–147 MB; BFS uses ~4–8 MB.
5. **Compute is not compressed.** The GPU kernel does dense-equivalent work Σ n·m ≈ 100–170·N² per query, roughly 100×
   BFS's work. Compression only saves memory. The low-work divide-and-conquer was implemented on the CPU only.
6. **The fixed cost is a worst-case cost.** The open map is the slowest case for us and the cheapest for every baseline,
   so on typical game maps "fixed" means "always paying the expensive case".

**Measurement and coverage:**
7. One machine (M2 Pro, wgpu-native/Metal); Python-side encoding in the wall times; few maps (4–5 per size); single
   runs with medians; a single CPU-BFS goal.
8. Only P1 (4-connected, unit cost), the least practically relevant variant. P2 (8-connected, non-planar) and P3
   (any-angle, snapping error up to ~2 px per merge in 1-px mazes) are unresolved. Most real flow fields use 8-connected
   or any-angle movement.
9. Exactness is tested on synthetic maps up to 128² plus 4–5 benchmark maps per size, not on the full Moving AI sets.

**Novelty, honestly:**
10. The approach is classic separator / dense-distance-graph machinery (Fakcharoenphol–Rao; Klein–Subramanian 1993 for
    polylog depth; GPU separator APSP exists) with standard tricks (Monge, core-sparse tables). The new pieces are modest:
    - the sparse non-Monge seam closure with a divide-and-conquer apply;
    - in-place aliasing;
    - a GPU mapping.

    None is a breakthrough.
11. "HRC-style constant cost" holds, but it's not an advantage by itself if the constant is larger than what adaptive
    methods pay on real maps.

**What a fair evaluation needs before any further claims:**
- strong baselines: bit-parallel GPU BFS (persistent / single-workgroup and multi-workgroup), tuned FIM (active lists,
  persistent, bitsets), parallel fast sweeping, multicore + bit-parallel CPU BFS;
- end-to-end costs: build + query, amortised over the number of queries per map change, plus memory;
- the full Moving AI sets, scaling 256 → 4096, several goals and goal counts;
- the practically relevant metrics (8-connected / any-angle).

## Round 8: information content of the exact structure (`info_core.py`, `maps.spiral`)

**Core** = nonzero cross-differences of every node table D and seam closure T, per port, at 256², levels top → 32 px:

| map | D core / port | T core / port |
|---|---|---|
| empty | 2.0 | ~6 |
| spiral w1 (single 1-D path, ~N turns) | 1.0–3.0 | 1.7–6.9 |
| maze w1 | 1.4–3.0 | 3.4–12.4 (largest seen: top-level T) |
| maze w4 | ≤ 1.4 | 1.9–7.6 |
| rooms | 1.9–3.0 | 2.3–4.5 |
| Berlin | 2.2–2.7 | 4.3–6.0 |
| noise 20 % | ~3 | 3.4–6.3 |
| noise 35 % | ~3 | 4.8–7.9 |
| noise 45 % (fragmented) | ~0.9 | ~2.4 |

**Reading.**
- The exact all-boundary distance structure has **O(1) information per port on every family tested**, from open maps
  to spirals. That is ~O(N²) in total with a small constant.
- Tortuosity, which is what makes local methods slow (spiral ≈ N turns, maze path ≈ N²/2), doesn't show up at all; the
  spiral is among the *smallest*.
- What does grow the structure is the number of free ports (open maps). Even there the information is small, since the
  tables are L1-like. Our v3 memory (147 MB on the empty map) is representation overhead (prefix rows, index lists),
  not information.

**So hardness splits two ways.**
- **Path tortuosity** (turns, length) is hard for local / iterative methods: wavefront, FIM, sweeping, Yaazarai's
  segment sweeps (#turns iterations).
- **Separator coupling** (open area per separator) is hard for hierarchical exact methods, but only in dense form. In
  compressed form it is O(1) per port.

**The well-posed open problem:** build the compressed tables every frame, with work ~ core·polylog and fixed depth.
- Merges of core-sparse Monge tables: known sequentially (Gawrychowski–Gorbachev–Kociumaka, O(n + δ log δ)); no
  parallel/GPU version known to me.
- Seam closure T (non-Monge, mixed-sign core): no known algorithm; the closure needs alternation, i.e. repeated
  squaring or FR-style ordering.

## Round 9: bends, sweeps, monotone strips (`bends.py`, `freefrac.py`, `sweeps.py`, `monosweep.py`, `strip_core.py`)

**Reflex corners per free pixel** (512² scenes):

| scenes | corners per free pixel |
|---|---|
| maze w32, 32room | 0.0007–0.007 |
| streets | 0.015–0.025 |
| maze w4 | 0.04 |
| 8room | 0.11 |
| maze w1 | 0.38 |
| noise 5 % / 20 % | 0.18 / 0.51 |
| DAO maps | 64–1.8 k corners in total |

**Bends of near-shortest any-angle paths.** 8-connected Dijkstra, gradient descent, then greedy exact-visibility
pulling (may slightly overcount):

| scenes | bends: median / p90 | px per bend |
|---|---|---|
| DAO | 3 / 7 | |
| streets | 4 / 11 | |
| 64room / 32room | 9–13 / 14–24 | |
| 8room | 52 / 88 | |
| maze w32 / w8 / w4 / w2 / w1 | 16 / 101 / 190 / 442 / 784 (median) | ≈ 3.4 × corridor width in mazes |

Two regimes: game scenes have a handful of bends; mazes have a bend every few corridor widths.

**"Free" entries.** Exact 4-connected block tables whose entry equals the obstacle-free distance: 27–87 % overall, but
only 0–40 % at the top levels, which carry the cost. Storing only the non-free part is a 2–5× constant. **Dropped.**

**Classic fast sweeping is already bend-efficient.** Iterations (4 raster sweeps each) to exact 8-connected
convergence:

| scenes | iterations | bends (same goals) |
|---|---|---|
| DAO | 2–3 | 5 |
| streets | 4–5 | 6 |
| rooms | 4–17 | |
| maze w32 / w8 / w4 / w1 | 8 / 34 / 52 / 247 | 15 / 83 / 148 / 480 |

So "converges in #bends" is no advantage over sweeping. Sweeping's GPU weakness is the depth *per sweep* (sequential
rows).

**Monotone sweeps** (each resolves all paths monotone in one axis, with any sideways movement inside rows):

| scenes | V (down/up) | VH (down/up/right/left) | classic raster sweeps |
|---|---|---|---|
| game scenes | 5–8 | 6–10 | 8–20 |
| 8room | 22 | 10 | 48 |
| maze w1 | 310 | 370 | 996 |

All three schedules give exact results.

**Monotone strip operators** (top row → bottom row, y-monotone 4-connected paths):
- **Exactly Monge** (0 violations, every scene and height).
- **Core ≤ ~1 per column** at every height 2–512.
- Mazes: tall strips have no monotone connections at all, which is why mazes need many sweeps.

So a down-sweep is a parallel prefix over rows of affine min-plus maps v ↦ min(c, v ⊗ M) with core-sparse Monge M. That
makes the depth per sweep log N instead of N, with per-sweep work ~N² polylog given core-sparse Monge products
(Gawrychowski–Gorbachev–Kociumaka; the parallel / GPU form is unknown to me).
- **Per-frame by construction:** no precomputation; the operators come straight from the occupancy.
- **Exact** for 4-connected movement.
- **Known relatives:** DIST-matrix composition in parallel string comparison (Tiskin, Krusche & Tiskin).

**Status: a lead, not a result.**
- **Promising:** on game scenes it would be ~5–8 log-depth sweeps.
- **Not promising:** mazes remain hundreds of sweeps.
- **Risky:** a GPU core-sparse Monge product.

## Round 10: log-depth monotone sweep prototype; squaring the crossing tables (`scansweep.py`, `test_scansweep.py`, `cost_scansweep.py`, `square_core.py`)

**Log-depth monotone sweep (CPU, exact).** Each row is an affine min-plus map v ↦ min(b_y, v ⊗ A_y); a sweep is a
parallel prefix: an up pass of matrix compositions, a down pass of vector applications, log₂N levels.
- **Exact:** 36/36; a single sweep equals the sequential monotone sweep, and the converged field equals BFS.
- **Composed matrices stay compact:** max core ≤ ~1·N.
- **Cost on 128² crops of real scenes** (core-sparse cost model):

  | scene | work per sweep | total work | sweeps |
  |---|---|---|---|
  | game scenes | ~10–26·N² | 52–131·N² | 2–3 |
  | 8room | | 128·N² | 7 |
  | maze w8 | | 199·N² | 8 |
  | maze w1 | | 422·N² | 110 |
- **The matrix half depends only on occupancy:** build once per frame per direction; later sweeps are vectors only
  (~2–4·N² each).
- **Verdict against the breakthrough criteria:** 50–400× BFS work, and the sweep count is scene-dependent (reversals).
  **Not it.**

**The common obstruction.** Both approaches fail on paths that alternate across a line:
- monotone sweeps restrict to non-reversing paths, so they pay one sweep per reversal;
- the block hierarchy pays inside each merge.

A scene-independent method must resolve unbounded alternation in log rounds.

**Squaring the crossing operator** (256²; one-excursion step M0 = in-block distances on each side + unit crossings;
M_{k+1} = M_k ⊗ M_k):

| scene | max core per seam cell over all intermediate steps | squarings to converge |
|---|---|---|
| Berlin | 4–5 | |
| 32room | ≤ 7 | |
| maze w4 | ≤ 8 | |
| maze w1 | ≤ 10.5 | ≤ 6 |
| spiral w1 | 6.9 at the top level | 8 (≈ 256 alternations) |
| 8room | ≤ 18 | |
| noise 35 % | ≤ 24 | |
| overall | | ≤ 8 = log₂(alternations) |

**Squaring is information-cheap on every scene tested.** The intermediate operators are as compact as the final ones.

**The decisive open piece:** an algorithm for the min-plus product of two such compact **non-Monge** matrices with work
~ core·polylog. Monge has one (Gawrychowski–Gorbachev–Kociumaka); for these I know none.
- Generic structure: A = row + col + piecewise-constant on the δ×δ grid of point coordinates. Grouping the inner index
  gives an O(δ³) product: too slow.
- What these matrices are (closures of two boundary-arc distance matrices joined across a line) must be what makes them
  compact. That structure is what an efficient product would exploit.

**If it exists:** per-frame work ~N² polylog, depth polylog, with scene dependence only in the constant (core per cell,
4–24 measured).

## Round 11: why the crossing tables stay compact; building them by squaring (`trop_rank.py`, `square_build.py`)

**Mechanism (argument, not proof).**
- A row of the crossing table is a distance profile along the dividing line; between adjacent free cells it steps by ±1.
- A nonzero cross-difference at (i, j) means profile i and profile i+1 change direction at different places near j.
- Profile breakpoints are where a family of shortest routes from the source arrives at the line (minima) or where two
  families meet (maxima). Moving the source one cell moves each meeting point by ≤ 1.
- So compact size ≈ Σ over sources of (route families whose meeting points move). Compactness = few route families per
  source along the line.

**Two kinds of compactness, measured** (128²):
- **Hierarchical min-plus rank** (hubs needed so that T(i,j) = d(i,k) + d(k,j) across a row split of the line):
  - 1–5 at every span for empty, streets, rooms, mazes and noise;
  - **63 of 64 for the spiral's top split.** The spiral's natural order is along the spiral, not by row; its distances are
    |p_i − p_j| with p = position along the spiral, and a row split interleaves the two groups.
  - Geometric low-rank (a tropical H-matrix) is therefore **scene-dependent**.
- **Cross-difference sparsity** survives any order of a path metric (|p_i − p_j| has ~2 nonzeros per row under any
  permutation). That is the robust notion, and the one to build on.

**Product cost correction.** A min-plus product C = A ⊗ B is s independent vector products (columns of B). Each uses the
exact divide-and-conquer apply on A's compact form (any sign): O((s + δ) log s). So one product is O(s(s + δ) log s),
about output size × log, not δ³.

**Building T by squaring with column-wise compact products.** "Unreachable" is held as a finite sentinel, because
intermediate tables aren't closed under composition: the component-splitting compression silently dropped entries
until this was fixed.
- **Exact** against the reference closure on Berlin, 8room, maze w1, spiral w1, noise 35 % and empty (128², levels 0/2/4).
- **Per level:**

  | scene | work | dense cubic would be | core per cell (incl. sentinel boundaries) |
  |---|---|---|---|
  | game scenes and mazes | 14–175·N² | 40–2048·N² | ≤ 21 |
  | noise 35 % | 140–360·N² | | ≤ 51 |

  Work per level is roughly constant in N², as predicted (O(s² log s) per merge). Squarings ≤ 8.

**Assessment.**
- In principle: an **exact, per-frame, polylog-depth construction with ~N² polylog work**, assuming the compact size per
  cell stays bounded. That holds on everything measured but is unproven, and adversarial patterns may exist.
- In practice the constants are large: ~100–350·N² per level × ~2 log N levels ⇒ thousands of N² per frame, against
  BFS's 1·N². It isn't competitive as-is.
- The asymptotic advantage over dense (s³) grows with N.

## Round 12: a stronger GPU baseline; graph interfaces; the route-planning literature (`base_gpu2.py`, `run_base2.py`, `graph_iface.py`)

**Block FIM with 32² tiles** (exact local relaxation in shared memory; inactive tiles exit after one uniform load; many
rounds per submission). All exact:

| map | time | rounds | CPU BFS |
|---|---|---|---|
| Berlin 1024² | 10.7 ms | 52 | 3.7 ms |
| empty 1024² | 10.2 ms | 44 | 4.8 ms |
| maze1024-4 | 183 ms | 1,126 | 5.7 ms |
| maze1024-1 | 598 ms | 3,467 | 10.3 ms |

- Each round costs ~0.2 ms because all tiles are dispatched. Indirect dispatch over active tiles should bring open maps
  to ~1 ms.
- Rounds on mazes are inherent: they scale with path length / tile size.

**Block interfaces as small graphs.** Min-plus elimination of non-terminals, kept only when the edge count doesn't grow
after dropping locally dominated edges; exact against BFS terminal distances.

| scene | reduced vertices per terminal | edges per terminal |
|---|---|---|
| mazes / spiral | ~1 | 0.7–1.4 |
| rooms | 1.0–1.2 | 1.4–2.5 |
| noise | 1.1–1.4 | 1.4–4.1 |
| Berlin | 1.0–1.1 | 2.3–4.4 |
| empty | 1.0 | 3.3 / 5.4 / 9.4 at b = 16 / 32 / 64 (greedy is suboptimal; perimeter + row/column edges preserve L1 exactly at ~1.5) |

Graph interfaces are compact exactly where tables were worst (mazes), and merging by elimination handles any number of
seam crossings implicitly.

**This is known machinery.**
- **Customizable Contraction Hierarchies** (Dibbelt, Strasser & Wagner 2014): nested-dissection order, per-weight
  customization by triangle enumeration. Their experiments include game maps.
- **PHAST / GPHAST** (Delling et al.): one-to-all distances by a sweep over the CH order, also on GPU.
- **Grid-specific:** CH on grid graphs (Storandt 2013); subgoal graphs (Uras & Koenig), whose "corner" graph is my
  earlier corner idea.
- **The correspondence:** our separator cascade ≈ CCH, a per-frame obstacle change = a CCH customization (blocked =
  infinite weight), and our query ≈ PHAST.
- **Known cost:** CCH customization enumerates the metric-independent fill (separator cliques), so O(n^1.5) triangles on
  grids. That is the same N³-at-the-top wall as our dense build.

**What may still be open (to verify):**
- GPU, per-frame CCH customization plus a GPHAST-style one-to-all sweep for grid scenes;
- customization whose cost follows the *metric-dependent* sparse interface (measured O(terminals)) instead of the
  metric-independent cliques.

## Round 13: customization literature (read: Dibbelt, Strasser & Wagner, CCH, JEA 2016 / arXiv 1402.0402; Bläsius et al., CCH survey, arXiv 2502.10519; gCRP abstract)

**How customization works.**
- **Basic:** one bottom-up pass over *every lower triangle* of the metric-independent chordal supergraph (separators completed
  to cliques). Cost ∝ number of triangles, independent of the metric. The paper calls customization "essentially a triangle
  enumeration algorithm".
- **Perfect** (prune to the minimal metric-dependent shortcut set): a second, top-down pass over all triangles again, about
  3× the basic cost. **Pruning happens after the dense work; it never avoids it.**
- **Partial updates:** a priority queue of changed arcs. Median ≈ 0.008 ms on TheFrozenSea, but max 100–160 ms at choke
  points. For games they propose amortising over turns, so queries use stale data meanwhile.
- **Parallelism:** level-synchronous, or task-based over the separator tree (Buchhold et al. 2019).

**Game-map numbers.** CCH's motivating scenario is literally RTS games: buildings, fog of war, per-unit metrics. Full
customization of single-metric 512²-class Moving AI maps:

| map | 1 thread | 16 threads |
|---|---|---|
| maze512-4-3 | 138 ms | 35 ms |
| 16room | 359 ms | 41 ms |
| random512-35 | 469 ms | 39 ms |
| TheFrozenSea | 6.7–7.9 s | 0.45 s |

Their own verdict: a second per customization is "still too slow to be usable" in games. Per-frame CCH for one-to-all
fields is 10–100× slower than plain BFS.

**GPU.**
- CRP customization on GPU exists (Delling, Kobitzsch & Werneck, Euro-Par 2014): ~60 ms for continental road networks.
  Roads have small cuts, though; grids have √n separators, so dense cliques.
- I found no GPU CCH customization.

**Open, as far as these sources go:** customization whose cost follows the *metric-dependent* sparse shortcut set rather
than all metric-independent triangles. On grids the gap is orders of magnitude:
- top separator at 512² ≈ 512-clique ≈ 22 M triangles;
- our measured exact interfaces are ~1–5 edges per boundary cell.

Classic metric-dependent CH (witness searches during contraction) is the existing way to build only needed shortcuts, but
it is sequential and slow to preprocess. My `graph_iface.py` is a local, 2-hop-witness version of it.

## Round 14: min-plus HRC, stage 1–2 (`MINPLUS_HRC.md`, `minplus_hrc.py`, `exact_geo.py`, `fmm.py`, `test_minplus*.py`, `diag_minplus.py`, `compare_stage2.py`, `fig_stage2.py`; figures `out/minplus_empty.png`, `out/stage2_errors.png`)

**Method.** HRC unchanged, with the monoid (m, len):
- m = best source-plus-path-length reachable along the interval;
- len = shortest open path to its endpoint (∞ if blocked);
- odd rays take the component-wise min of HRC's two bent alternatives;
- merges take the min over the two edge sides (no arc weights);
- output at the pixel's own probe;
- a pass is repeated with s ← min(goals, d).

**The invariant holds empirically:** every value is the length of a real path inside free space. No underestimates on any
scene (exact reference: corner visibility graph + per-pixel visible-node minimisation, `exact_geo.py`).

**Two mechanisms found while decomposing the error** (empty map, one goal):
1. **Parity lock.** With only level 0 traced (pure diagonal rays), half the pixels are never reached: HRC's row-parity
   structure, which GI hides with the cross blur, is fatal in min-plus. Tracing level 1 removes it, because DDA seeds pass
   through both parities.
2. **HRC extension measures octile length.** Odd rays are staircases at the finest scale. GI is insensitive to that (the
   same cells are crossed), but a sum of lengths along them is the 8-connected metric. With 2 traced levels the converged
   error is exactly the octile pattern: zero on axes/diagonals, peak near 22.5°, 3.9 px at r = 48 (≈ 8 %).
   - Fix that keeps the invariant: trace the first L₀ levels straight. The excess per junction is ~1/2^(L₀+1), so relative
     error ~2^(−2L₀).
   - Result: L₀ = 4–5 brings the empty map from 1.48 to 0.17–0.21 px mean.

**Accuracy against standard methods** (64², one goal, exact Euclidean reference; mean |err| px and mean relative):

| scene | min-plus HRC (L₀ = 5) | 8-connected Dijkstra | first-order FMM | 4-connected BFS | passes |
|---|---|---|---|---|---|
| empty | 0.16 (0.9 %) | 1.49 (5.4 %) | 0.64 (2.8 %) | 7.96 (28 %) | 3 |
| Berlin | 0.22 (0.9 %) | 1.94 (5.8 %) | 0.78 (3.0 %) | 9.2 (27 %) | 8 |
| DAO lak303d | 0.26 (2.4 %) | 0.85 (5.8 %) | 0.80 (6.2 %) | 4.1 (28 %) | 5 |
| rooms | 0.47 (1.7 %) | 2.65 (7.3 %) | 2.07 (6.1 %) | 9.5 (27 %) | 11 |
| boxes | 0.50 (2.1 %) | 1.98 (7.2 %) | 1.67 (6.3 %) | 7.8 (28 %) | 9 |
| noise 10 % | 0.52 (2.2 %) | 2.35 (8.3 %) | 2.43 (8.8 %) | 8.4 (29 %) | 10 |
| noise 25 % | 3.2 (9.8 %) | 6.7 (19.5 %) | 7.8 (22.5 %) | 12.2 (34 %) | 19 |
| maze w4 | 3.0 (3.2 %) | 10.5 (10 %) | 10.2 (9.9 %) | 20.4 (21 %) | 30 |

Min-plus HRC is 3–6× more accurate than 8-connected Dijkstra or FMM on every scene, and never underestimates.

**Weak spots:**
- Clutter: bends happen at pixel centres near corners, and narrow gaps are missed on a given pass. In noise 25 %, 8
  reachable pixels were never reached.
- Passes ≈ bends (3–30 here).

**Not yet measured:**
- cost (per-pass cost with 5 traced levels × passes) against the single-pass cost of BFS / FMM / FIM;
- larger sizes;
- several goals;
- dynamics (stale values under moving obstacles).

## Round 15: the penumbra condition for distance (measured)

Files: `penumbra.py` (exact field with argmin emitter per pixel, near-optimal lists, greedy cover), `penumbra2.py`
(RC diagonal s = R/k, wavefront clustering, gradient spread). Outputs in `out/penumbra*.txt`.

Setup. The exact field is d(x) = min over visible nodes c (goals + reflex corners) of w_c + |x − c|. Each node is an
emitter with value w_c. r(x) = |x − a(x)| is the length of x's first straight leg, i.e. distance along the ray to the
emitter. Banding pixels by r is exactly RC's interval decomposition. For a block of size s, count the emitters needed so
every band pixel gets ≤ d + ε through a visible emitter (greedy cover, an upper bound; candidates never go below d).

Results at 256², 1 goal and 16 goals, ε = 0.25:

| scenes | mean emitters per block at s = R/2 | max |
|---|---|---|
| empty, rooms, maze w8, Berlin, lak303d, boxes | 1.0–1.4, flat in R | 2–4 |
| noise 5% | rises to 2.8 at R = 32–64 | 6 |

- At s = R: 1.3–2.5 on maps; noise up to 7.4 (max 11).
- n_fn ≈ n_src: the extra emitters are genuinely different wavefronts (shadow mosaics behind many small obstacles), not
  visibility masks of one wavefront.
- ε (0.25 vs 1.0) barely matters: wavefronts are separated by kinks, and the cones absorb curvature exactly.
- Gradient spread within a diagonal block is 5–25°.
- Band cost / band pixels falls ~3–4× per octave on maps (≈ 1/R²); on noise it falls ~2×, then flattens.
- Pixels with r < 8: 10–20 % (Berlin, rooms), 40–50 % (boxes, lak, noise). The near field is per-pixel, as in RC
  cascade 0.

Reading: the penumbra condition holds for distance in a *sparser* form than in GI. GI needs angular count ∝ R because
irradiance integrates over all directions. With min, only the winning wavefronts matter, so a probe at spacing ~R/2 needs
O(1) emitters (position, offset), not a dense angular table. Representation cost per band ~ N²/R², so total cost is
dominated by the finest bands (not N² log N).

Not settled:
- (a) w_c are outputs: bends ↔ bounces.
- (b) Finding a block's winning emitters is a search. RC's answer, trace every direction, is dense; sparsity of the
  answer doesn't remove the search.
- The 1-seed-per-region structure is what JFA exploits without obstacles; emitter lists on edges are the continuous
  "windows" of Mitchell–Mount–Papadimitriou. Any algorithm built on this must be checked against obstacle-aware JFA /
  geodesic Voronoi literature before claiming novelty.

Next information question: is a block's emitter set at band 2R contained in a small candidate set formed from its own and
its neighbours' sets at band R (or the parent's)? That decides whether a fixed-depth cascade over emitter lists can do
one bounce without dense search.

## Round 16: the candidate-set question (measured)

Files: `candidates.py`, `probe_prune.py`; outputs `out/cand_256_*.txt`, `out/probe_prune_256.txt`.

Question: are block B's emitters at band n+1 contained in the band-n emitter sets of nearby level-n blocks, and how big is
that candidate pool?

Geometry predicts containment. If x has emitter c with r in [2R, 4R), the points y on segment x→c with |y − c| in [R, 2R)
are band-n pixels with emitter c, within 3R of x.

1. **Containment holds and is local.** With E_n = exact argmin emitters, recall is 100 % at radius h = 4 level-n blocks
   around B's footprint on all scenes, 1 and 16 goals.
   - Exceptions: 98.9–99.9 % at the finest step on Berlin, boxes and lak, from pixel discretisation: the pixel centres
     near the segment have a tied, different argmin.
   - The minimal h needed has median 1, p90 3, max 4, matching the 3R bound.
   - With greedy-cover sets instead of argmins, a few blocks fail (cover non-uniqueness).
2. **The pool grows with scale, the need does not.**
   - |E_{n+1}| stays 1.0–1.9.
   - The deduplicated pool at h = 4 grows ~2× per level, i.e. ∝ R:

     | scene | pool at bands 4–8 → 64–128 |
     |---|---|
     | boxes | 2.9 → 41 |
     | rooms | 1.7 → 33 |
     | Berlin | 2.8 → 20 |
     | lak303d | 3 → 30 |
     | maze w8 | 1.2 → 17 |

   - The ray-direction filter (keep c from B' only if B' lies on the way to c) removes ~5–10 % (128² test).
   - Adjacent level-n blocks share few emitters at large R. The pool is set by how many distinct active corners lie
     within ~3R, so it scales with scene density, which is against the criteria.
3. **One probe per block can't prune much.**
   - Rule: evaluate pool cones at one free pixel o, and keep those within 2ρ (ρ = block radius from o) of the best
     visible one.
   - It removes only ~25–45 %.
   - My "safe" argument was wrong: it assumed d(x) ≤ d(o) + |x − o|, which needs x and o mutually visible. On maze w8 at
     64-px blocks the recall drops to 59 %. Any block-level selection must use geodesic, not Euclidean, block radius.

Reading:
- The min-plus sparsity helps *storage and the final gather*: per pixel, Σ over log N levels of ~1.3 emitters, plus a
  visibility test each.
- It does not help *building* the lists by local search. Per level that costs (N²/R² blocks) × (pool ∝ R) ×
  (visibility test ∝ R) = N² per level, i.e. N² log N total, RC's own cost class, and more on dense scenes because the
  pool tracks corner density.
- So the analogue of RC's angular search survives intact. The answer is sparse, but finding it is not.

Noise 5 % (256², 1 goal), the dense-clutter stress case:
- Containment: 99.7–100 % at h = 4. Minimal h has median 1.
- The need grows a bit: |E_{n+1}| 1.3 → 4.5.
- The pool explodes: 10 → 33 → 92 → 189 → 219 at h = 4. Even at h = 1 it's 1.4 → 40.
- This confirms that the pool tracks the density of active corners, not the information a block needs.

## Round 17: prediction by radial push (measured)

Files: `predict.py` (oracle push from exact band-n argmins), `push_sim.py` (bottom-up simulation with provisional
argmins, one bounce, exact corner values w_c from the reference). Outputs: `out/predict_256_g1.txt`, `out/push_sim_*.txt`.

**Idea.** Along x→c every point has emitter c, so the band-(n+1) pixels of c lie radially outward from its band-n
pixels. Instead of pulling from a neighbourhood, each (level-n block, emitter) group pushes its emitter to the
level-(n+1) blocks meeting the annular sector [2R, 4R) that its pixels span (widened by a half-pixel margin). This is
RC's "the interval continues in its own direction", with the emitter as origin.

**Oracle push** (exact argmins): pool at band 32–64 drops from Round 16's 15–38 to 3.6–6.1.

| scene | Round 16 pool | push pool |
|---|---|---|
| boxes | 37.7 | 6.1 |
| rooms | 21 | 5.7 |
| Berlin | 15 | 3.6 |
| lak303d | 19.5 | 4.0 |
| maze w8 | 15 | 4.5 |

- Pixel recall is 100 % beyond the first level, and 98.6–99.9 % at the first (discretisation).
- Fan-out is ~2–7 blocks per push.

**Bottom-up simulation** (provisional argmins, every pixel of a receiving block evaluates the pushed emitters; base step
= every node within distance 4):
- **Exact on every map scene at 256², with 1 and 16 goals:** 0 wrong pixels, max error 1e-13.
- **Noise 5 %:** 0.014 % of pixels off, by at most 0.008, from ties; no underestimates.

| scene | pool per receiving block | evals/px total |
|---|---|---|
| maps | 3–6.6 | 13–26 |
| noise 5 % | 7 → 19 (peaks at bands 32–64) | 65 |

Scaling (rooms, 1 goal):

| N | evals/px | vis-length/px |
|---|---|---|
| 128 | 12.5 | 192 |
| 256 | 19.5 | — |
| 512 | 25.9 | 838 |

- evals/px grows ≈ log N: one more level, ~+6 per doubling.
- Visibility tests are ~4–14 per pixel, but each walks its full segment, so total length/px ∝ N (rooms: 192 at 128,
  838 at 512).
- As implemented, cost is dominated by visibility: N³-ish.

**Reading.**
- *Which emitter wins* can be propagated radially with a small pool and exact results. That answers the prediction
  question positively for one bounce.
- What remains:
  1. **Visibility:** per-pixel segment walks cost ∝ distance. RC's answer is per-interval transmittance composition.
     The analogue here is that x's visibility to c factors through the pushing group (whose pixels see c), so only the
     part of the segment inside the current band must be checked. Making that O(1) per (pixel, candidate) needs a
     shadow-propagation scheme, and pixel-level shadow propagation is a digital-line approximation of exact visibility
     (the HRC lattice issue again, now with underestimate risk).
  2. **Bends:** w_c was taken from the reference. Iterating passes = bends + 1, unchanged.
- **Literature this sits next to:**
  - Continuous Dijkstra (Mitchell; Hershberger–Suri 1999), whose "wavelets" are exactly (generator, angular range)
    propagated through a quadtree-like conforming subdivision. It handles bends by event (time) ordering, sequentially.
  - Shortest-path maps by GPU cone rasterisation (Camporesi & Kallmann), which pay overdraw ∝ Σ corner regions instead
    of a pushed pool.

  The push cascade reads as a parallel, level-ordered (instead of time-ordered) discretisation of wavelet propagation.
  The novelty, if any, is the level ordering plus the bounded per-block pool, and it must be argued against these.
