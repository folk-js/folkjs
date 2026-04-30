# Step 5: The missing inverses

Companion to `substrate.md` and `step-4.md`. Narrowly scopes the next refactor: add the three substrate primitives that complete `substrate.md`'s "every primitive has a paired inverse" discipline, then re-express the existing surgery macros as compositions of the now-complete primitive set.

The point: today's `atlas.ts` is 3,746 lines and ~44% of it is the line-cut/strip surgery cluster (~1,650 lines / 30 helpers). The cluster is large because three of `substrate.md`'s five primitive pairs are half-paired — `createFace` has no `deleteFace`, `subdivideSide` has no `joinSidesAtVertex`, `splitFaceAtVertices` has no `mergeFaces` — so every composite operation is a hand-written orchestration rather than a sequence of primitives. Once the inverses exist, we expect a net **deletion of ~700–900 lines** in the surgery section as macros collapse to paragraph-sized compositions.

If the deletion isn't materialising at the expected rate after the inverses land, something is mis-shaped and we stop before doing the macro rewrite.

## The three contracts

### `deleteFace(atlas, face): void`

The strict inverse of `createFace`: requires `face` to be in the same shape `createFace` produces — fully free of bindings.

**Preconditions:**
- `face ∈ atlas.faces`
- `face !== atlas.root`
- Every side of `face` (outer + every inner loop) has `stitch === null`
- `face` is not the source or target of any `Link`
- `face.shapes.size === 0`

**Effect:**
- Removes `face` from `atlas.faces`
- Removes every side of `face` (outer + all inner loops) from `atlas.sides`
- Does **not** touch any other state — there are no stitches to invalidate (precondition forbids), no links to update (precondition forbids), no chain-composites to recompute (no Stitch mutations involved)

**Refusal modes:** clear errors per failed precondition. Forced-delete-with-cleanup is a *macro* layered on top (`unbindFace(atlas, face)` + `deleteFace`), not a substrate-level concern.

**Notes:**
- All-ideal faces are deletable as long as they're not the root. The empty-seed atlas's all-ideal face is special only because it's typically the root; once you've switched the root elsewhere, deleting it is fine.
- Inner loops contribute their sides to the side-removal list but are otherwise no different from outer-loop sides for deletion purposes.

### `joinSidesAtVertex(atlas, side): void`

The strict inverse of `subdivideSide`. Takes a side ending at the vertex to be eliminated; that side and its successor (`side.next`) fuse into a single side.

**Preconditions:**
- `side ∈ atlas.sides`
- `side.next.face === side.face` (consecutive in the same loop — automatic from cycle structure but asserted defensively)
- The two sides are **collinear under their kind**:
  - `finite-finite + finite-finite`: `side.next.origin` lies on the directed segment from `side.origin` to `side.next.next.origin` (the "subdivide-then-join" round-trip case).
  - `finite-ideal + ideal-finite`: refused (no meaningful join across an ideal vertex)
  - `chord + chord` (both ideal-ideal with anchors): same anchored line — anchors collinear under the line direction, both shared ideal endpoints aligned.
- If `side.stitch !== null`, the symmetric pair on the twin side must also be collinear (`side.twin.prev` and `side.twin` form the partner subdivision pair). This is automatically true if the subdivision was done by `subdivideSide`, which subdivides both sides of a stitched pair symmetrically.

**Effect:**
- `side.next.origin` is dropped as a vertex.
- `side`'s endpoint becomes what was `side.next.next.origin` (achieved by re-wiring `side.next` to be what was `side.next.next`).
- The eliminated side (`side.next`, pre-rewire) is removed from `atlas.sides` and from its face's outer loop.
- If stitched: the twin's eliminated side is symmetrically removed; the remaining stitch keeps its existing transform (subdivideSide already preserved transform across both sub-pairs, so the join is a structural-only change).
- The remaining stitch's transform is unchanged. (No `markLinksDirty` needed — chain composites are unaffected by collinear-side fusion.)

**API rationale for "side ending at the vertex":**
- `subdivideSide` returns `{ faceHalves: [s_A, s_B], twinHalves }` where `s_A.next.origin = s_B.origin = newP` (the new vertex). So `joinSidesAtVertex(s_A)` is the natural inverse of `subdivideSide(...).faceHalves[0]`.
- Alternatives considered (`joinAtVertex(face, vIdx)`, `joinSides(s_A, s_B)`) are worse: the first requires explicit indexing, the second is over-specified (s_B = s_A.next is implied by the face's cycle).

**Notes:**
- The "vertex isn't shared with any third side" check is structurally guaranteed by DCEL: vertices aren't first-class objects, each face stores its own copy. The only sides involved are `side`, `side.next`, and (if stitched) `side.twin`, `side.twin.prev`.
- If `side.stitch !== null` but the stitched chord wasn't produced by `subdivideSide` (i.e., the partner side wasn't symmetrically subdivided), the partner-collinearity check fails and the join is refused. This is the right behaviour — joining one side without joining its twin would break twin reciprocity.

### `mergeFaces(atlas, sharedChordSide): { face: Face }`

The strict inverse of `splitFaceAtVertices`. Takes a side whose stitch's other endpoint is a chord side of another face; the two faces fuse into one along that chord. The `sharedChordSide`'s face is kept; the partner face is deleted.

**Preconditions:**
- `sharedChordSide ∈ atlas.sides` and `sharedChordSide.stitch !== null`
- Let `s = sharedChordSide.stitch`, `kept = sharedChordSide.face`, `fresh = s.other(sharedChordSide).face`
- `kept !== fresh` (refuse self-stitched chords — that's a wrap loop, not a split)
- `s.transformAtoB` is a **pure translation**: linear part is identity. Non-translation chord stitches are degenerate as merge inputs (a Klein-bottle interior chord cannot be flattened). Refused with a clear error.
- `fresh` is not the source or target of any `Link` (caller migrates first; the strict-inverse contract makes link policy the caller's responsibility).
- `fresh.shapes.size === 0` (caller migrates first; same rationale).
- `fresh !== atlas.root` (would orphan the root).
- Every other stitch with an endpoint in `fresh`'s sides has a transform compatible with un-conjugation by `freshOffset` (automatic for pure-translation atlases; would be checked explicitly when non-translation stitches exist).

**Effect:**
1. Recover `freshOffset` from `s.transformAtoB`'s translation part. (`freshOffset = (s.transformAtoB.e, s.transformAtoB.f)`'s sign convention matches `splitFaceAtVertices`'s `T_faceToFresh = translate(-freshOffset)`.)
2. Atomically (inside `atlas.mutate(...)`):
   a. Shift every finite vertex on `fresh`'s sides by `+freshOffset`. Shift every chord anchor on `fresh`'s sides by `+freshOffset`.
   b. Conjugate every stitch with an endpoint in `fresh`'s sides by the *inverse* of the freshOffset conjugation `splitFaceAtVertices` applied. This un-does the conjugation symmetrically.
   c. Splice `fresh`'s outer-loop sides (minus its chord side) into `kept`'s outer loop, replacing the kept chord side. Re-wire the cycle.
   d. Re-parent `fresh`'s sides to `kept` (`.face = kept`).
   e. Migrate `fresh.innerLoops` into `kept.innerLoops` (already coordinate-shifted in step a).
   f. `unstitch(s)` to clear the chord stitch.
   g. Remove the now-orphaned chord sides (kept's and fresh's) from `kept.outer` (kept's was replaced in step c) and from `atlas.sides`.
   h. `deleteFace(atlas, fresh)` (now free of bindings).
3. Returns `{ face: kept }` for caller convenience.

**Refusal modes:**
- "merge: chord stitch must be a pure translation" — non-translation chord stitch
- "merge: cannot self-merge a wrapped face" — `kept === fresh`
- "merge: fresh face has shapes; migrate them before merging"
- "merge: fresh face is the source/target of links; unlink before merging"
- "merge: fresh face is the atlas root"

**Identity preservation:**
- `kept` keeps its identity (matches `splitFaceAtVertices`'s contract that `face` is identity-preserved on the kept side).
- The round-trip `face === mergeFaces(splitFaceAtVertices(face, ...).faceChordSide).face` is an explicit test.

**Open question (deferred):** what if the caller wants the *other* face to survive? Today this is achieved by passing the *other* chord side: `mergeFaces(freshChordSide)` keeps `fresh` and deletes the original `face`. So the API is symmetric in which face survives — the passed-side's face is always the survivor. No second argument needed.

## Why these three are enough

`substrate.md`'s primitive set is:

| forward | inverse | substrate's existing primitive count after step 5 |
|---|---|---|
| `stitch` | `unstitch` | ✅ paired |
| `link` | `unlink` | ✅ paired |
| `createFace` | **`deleteFace`** | ✅ paired |
| `subdivideSide` | **`joinSidesAtVertex`** | ✅ paired |
| `splitFaceAtVertices` | **`mergeFaces`** | ✅ paired |

Five pairs. Every other operation in the surgery cluster is a *macro* — a finite, named composition of these ten primitives plus the geometry-layer helpers. After step 5 lands, the macro audit (`splitFaceAlongChord`, `splitAlongLine`, `insertStrip`, `resizeStrip`) becomes a strictly smaller refactor against a complete primitive set.

## Forcing function: the round-trip test

The substrate-level discipline introduced by step 5 is **invertibility**. The single test that proves it works:

```ts
// Starting atlas: any well-formed atlas A.
const validateAtlasSnapshot = makeStructuralSnapshot(A);

const split = splitAlongLine(A, host, seam, dir);
const strip = insertStrip(A, split, height);

// Inverse, in reverse order:
deleteStripAndUnsplit(A, strip, split);  // composed: deleteFace + mergeFaces × N + joinSidesAtVertex × M

assertStructurallyIdentical(A, validateAtlasSnapshot);
validateAtlas(A);
```

A passing round-trip on the existing scenes (cylinder-h, torus, etc.) is the gating condition for moving to step 6 (the macro rewrite). If it fails, the inverses are mis-specified and we re-design before rewriting.

The composed `deleteStripAndUnsplit` macro is itself a forcing-function artefact: writing it should be ≤30 lines if the primitives are sized right.

## What we are NOT doing in step 5

- Rewriting `splitFaceAlongChord`, `splitAlongLine`, `insertStrip`, `resizeStrip`. That's step 6, layered on the new primitive set.
- Moving any code into `atlas/face.ts`, `atlas/edge.ts`, etc. The user has been clear: file splits are organisational and not the point. They happen in step 6 if at all.
- Force-delete / force-merge convenience macros that auto-unbind. Strict-inverse contracts only. Convenience can be layered later if a real use case demands it.
- Anything in folk-atlas.ts. The substrate gains the inverses; how the application uses them is a downstream question.

## Sequencing

Each item below is independently shippable, individually reduces complexity, and individually tests something concrete:

1. `deleteFace` + tests (`createFace + deleteFace` round-trip; refusals for each precondition)
2. `joinSidesAtVertex` + tests (`subdivideSide + joinSidesAtVertex` round-trip on finite-finite, chord-chord, and stitched cases; refusals for non-collinear and non-symmetric)
3. `mergeFaces` + tests (`splitFaceAtVertices + mergeFaces` round-trip on translation-only chords; refusals for each precondition)
4. The composed `deleteStripAndUnsplit` round-trip test against existing scenes

## Retrospective (landed)

Phase 1 + 2 + 3 + 4 all landed in one session. Test suite went 221 → 250 (+29 tests across `deleteFace` ×9, `joinSidesAtVertex` ×9, `mergeFaces` ×8, round-trip forcing function ×3).

### Three substrate primitives added

| primitive | implementation | tests | purpose |
|---|---|---|---|
| `deleteFace(atlas, face): void` | ~50 lines (5 precondition checks + remove sides + remove face) | 9 | strict inverse of `createFace` |
| `joinSidesAtVertex(atlas, side): void` | ~190 lines (collinearity dispatch by endpoint kind + symmetric twin handling + atomic mutate) | 9 | strict inverse of `subdivideSide` |
| `mergeFaces(atlas, sharedChordSide): { face }` | ~140 lines (precondition checks + un-conjugation + outer-loop splice + inner-loop migration + chord cleanup + delegated `deleteFace`) | 8 | strict inverse of `splitFaceAtVertices` |

### What this changed about the substrate beyond the inverses themselves

**`stitch()` now accepts chord-chord pairs.** The forcing function (round-trip on the all-ideal seed) revealed that the public `stitch` rejected chord-chord pairs that the substrate's *internal* `setTwin` happily accepted. Fixed by:
- Generalising the junction-correspondence check to use `junctionImageMatches` (handles ideal endpoints natively)
- Adding chord-anchor consistency check (`T·heA.anchor === heB.anchor`)
- Requiring chord-chord stitches to be pure translations (the only kind that maps a real line to a real line)
- Rejecting mixed kinds (one chord, one segment)

This was a substrate gap that the forcing function exposed *because* it tried to express the inverse using only public API. Without the round-trip test, the gap would have stayed hidden. Forcing functions earn their keep.

### What the forcing function actually proved

The composed `undoSplitAndStrip(atlas, split, strip)` macro lives in test code — not yet in the substrate. It's ~30 lines of executable logic and uses *only* public substrate primitives:

```ts
atlas.mutate(() => {
  for (const pair of split.pairs) {
    const T = recoverChordTransform(pair);  // ~6 lines, derives from chord side coords
    unstitch(pair.rightChordSide.stitch);
    unstitch(pair.leftChordSide.stitch);
    stitch(atlas, pair.rightChordSide, pair.leftChordSide, T);
  }
  deleteFace(atlas, strip.stripFace);
  for (let i = split.pairs.length - 1; i >= 0; i--) {
    mergeFaces(atlas, split.pairs[i].rightChordSide);
  }
});
```

**Three properties this confirms**:
1. Every primitive used (`unstitch`, `stitch`, `deleteFace`, `mergeFaces`, `mutate`) has well-defined behaviour, sensible failure modes, and the right shape for composition.
2. The primitives' contracts match: `splitFaceAtVertices`'s output (`SplitChordResult.faceChordSide`) is exactly the input `mergeFaces` needs. `createFace`'s output is exactly the input `deleteFace` needs. The pairings *fit*.
3. Step 6 (the macro rewrite) is now a pure-mechanical refactor: the existing surgery cluster's macros can be re-expressed as compositions of the now-complete primitive set. The `undoSplitAndStrip` shape above is roughly half of what `step-6.md`'s `removeStrip` primitive will look like.

### Caveats / known limitations

- **`undoSplitAndStrip` skips `joinSidesAtVertex` cleanup.** Test scenes (all-ideal seed cuts) don't subdivide any sides, so no leftover collinear vertices need joining. A more general round-trip macro would walk every face's outer loop after merge looking for collinear-side pairs and `joinSidesAtVertex` them. Will land alongside step 6's macro rewrite.

- **Multi-cut undo on overlapping chains is harder.** Each cut's chain references stay valid through subsequent forward operations, but the *undo order* becomes coupled when later cuts traverse earlier strips. The single-cut round-trip is the tight invariant; the multi-cut one is a step-6 question.

- **`mergeFaces` is restricted to pure-translation chord stitches.** Klein-bottle / cone interiors cannot be `splitFaceAtVertices`'d and then reassembled with the current primitives. This is the right scope for the strict-inverse contract; non-translation merges would need a separate, model-aware primitive.

### Net effect

`atlas.ts` grew by ~380 lines (the three inverses, plus the `stitch()` chord-chord generalisation). This is the *up-front* cost; step 6 will pay it back several times over by collapsing the ~1,650-line surgery cluster against the now-complete primitive set. The user's framing — "the goal is elegant, simple, robust, composable building blocks" — gets the *building blocks* fully in place with this step; *elegant* and *simple* arrive when step 6 dissolves the macros that exist only because the primitives weren't.
