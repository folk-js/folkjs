# Distance through the HRC cascade (design note, before any code)

## The question

HRC computes, for every pixel, an aggregate over everything visible along a fixed hierarchical line set, at fixed cost
N² log N. It does this by composing ray intervals (extensions) and recombining them into cones (merges), with
transmittance as the occlusion monoid. If the same structure carries a **min-plus** quantity instead of fluence, one pass
computes, for every pixel, the best "source value + straight-line distance" over everything it can see. That is one
relaxation step of any-angle (Euclidean) shortest paths, for all pixels at once, with no corner extraction and no
visibility graph.

## What is stored and how it composes

- **Source field per frame:** s(y) = 0 at goals, ∞ at obstacles; on later passes s(y) = current distance estimate d(y).
- **Interval** (a straight segment from start point p, length L), the analogue of (radiance, transmittance):
  - m = min over free pixels y crossed by the segment *before any blocking pixel* of s(y) + |y − p|;
  - o = segment is unblocked.
- **Extension** (two halves, near then far): (m₁, o₁) ∘ (m₂, o₂) = (min(m₁, o₁ ? L₁ + m₂ : ∞), o₁ ∧ o₂).
  - This is exact for straight composites (HRC's even rays).
  - HRC's odd rays are averages of two slightly bent paths. In min-plus, take the **min** of the two. Each is the length
    of a real path, so it's still a valid upper bound.
- **Merge into cones:** a cone's value is the min over its two edge sides of
  [edge interval ∘ child cone read at the edge ray's endpoint].
  - No arc weights, because nothing is integrated.
  - Even probes take the min of HRC's two alternatives instead of their average.
  - Level-0 output: d(x) = min over all cones and quadrants.

**Invariant:** every value produced is the length of a real path (straight, or bent slightly at probe planes) from x to a
source. So the output **never underestimates** the true geodesic distance. That's a stronger property than GI-RC has, and
it means errors can only be detours.

## One pass = one bounce = one bend

Euclidean shortest paths among blocked pixels are straight between reflex corners.
- Pass 1 gives each pixel the distance to the nearest goal it can see.
- Pass k+1 uses pass k's field as the source, so a path's next straight leg can start anywhere already reached.
- After (bends + 1) passes, every pixel is correct up to line-set error.

This is the exact counterpart of GI bounces: direct light is one RC pass, and each bounce is another pass.

Measured bends of shortest paths (Round 9):

| scenes | bends: median | bends: p90 |
|---|---|---|
| DAO maps | 3 | 7 |
| streets | 4 | 11 |
| rooms 32–64 | 9–13 | 14–24 |
| mazes | 100–800 | |

## Error sources (to measure, not assume)

1. **Line-set coverage: the RC "1-px light" problem in min-plus form.** A source pixel is only seen along rays that pass
   through it.
   - At HRC's c = 2 spacing, a receiver whose rays miss a small source gets it by a longer route (a detour), which shows
     up as **spoke-shaped overestimates**.
   - Unlike GI, the next pass partly repairs this: after one pass the neighbourhood of the source is itself a source.
     So coverage error may shrink with passes. Unknown.
2. **Bends at probe planes.** HRC's composed paths bend slightly at plane crossings, and the odd-ray mixtures are bent
   paths. These add small detours that grow with the number of levels a path spans. Expected ≪ 1 px; to be measured.
3. **Bends at pixel centres, not at corners.** The path turns at pixel centres next to a corner, not at the lattice corner
   itself, so up to ~0.5 px per bend.
4. **Visibility to a pixel's centre.** ℓ = |y − p| is the length of a straight segment p → centre(y). The segment crosses
   y but may clip an obstacle corner, so this can *underestimate* by a fraction of a pixel. It breaks the invariant
   slightly and needs either a fix (sample on the segment, not at the centre) or a bound.

## The hard part I'm not glossing over: dynamics

GI handles bounces temporally, and stale light decays because albedo < 1. Min-plus has no decay. If obstacles move and a
pixel's old (too low) value is fed back as a source, it can keep supporting itself through other stale pixels. That's the
count-to-infinity problem of distance-vector routing.

Two honest options:
- **(a) Fixed K passes from scratch per frame:** correct for paths with ≤ K−1 bends; cost K × pass.
- **(b) Temporal accumulation with a safeguard** against stale lows, e.g. recompute from goals with a pass budget, or
  invalidate values whose justifying path is now blocked.

(b) is open, and it's where an RC-flavoured idea would have to earn its keep.

## Honest positioning against existing methods (to be tested, not claimed)

| method | metric | per-pass / per-frame cost | sequential steps |
|---|---|---|---|
| BFS / FIM on 4- or 8-connected grids | grid metric: 8-connected up to ~8 % longer than Euclidean (straight-line); 4-connected up to ~41 % | cheap work | path length / tile size |
| eikonal FMM / FIM / sweeping | approximate Euclidean, first-order error, worst near corners and sources | | sweeps ~ direction changes |
| exact shortest-path maps (Camporesi & Kallmann) | exact Euclidean | needs corners and a CPU shortest-path tree | |
| **min-plus HRC** | Euclidean up to line-set error; never underestimates (modulo error source 4) | fixed N² log N per pass | log N per pass × (bends + 1) passes |

Where it could stand: exact-geometry any-angle distance with no corner extraction, at a fixed cost per pass,
competitive on game scenes (few bends) and not on mazes. That is "comparable to existing methods, novel in approach", not
a breakthrough, and I want to be explicit about that.

**Faux-novelty risks:**
- At bottom it is Bellman–Ford over the visibility graph, with HRC as an implicit visibility-and-min oracle. The novelty
  would be the oracle: a min-plus line-space hierarchy computing all-pixels "min over visible" in N² log N.
- If its error from line-set coverage is worse than a simple eikonal solver's, the novelty buys nothing. That must be
  measured honestly.

## Plan, with stopping points

1. **CPU prototype (exact references exist: `geo.py` visibility-graph geodesics).** Min-plus HRC on small maps
   (64²–128²).
   - (i) one pass vs exact "distance to nearest visible goal";
   - (ii) iterated vs exact geodesic;
   - (iii) error maps, error vs passes, passes vs bends.

   *Stop here and review* if coverage error looks structural (spokes that don't heal).
2. **Same maps, other methods:** 8-connected Dijkstra, an eikonal solver (FMM), each against the same exact reference.
   This gives an accuracy-per-cost picture.
3. **GPU:** reuse the production HRC WGSL structure with the min-plus monoid; cost per pass at 512²–1024²; compared with
   GPU FIM eikonal and BFS.
4. **Dynamics:** a stale-value study under moving obstacles, and a design for (b).
