# Step 4: Sides, Stitches, Links

Companion to `substrate.md`. Narrowly scopes the next refactor: introduce `Side`, `Stitch`, and `Link` as primitives, replace `HalfEdge`, narrow the surgery API, and make `splitFace` identity-preserving. This doc is **not** a full substrate spec — it pins only the decisions needed for the first chunk to land.

The point of the rewrite is concrete: today's hairballs (`splitFaceAtVertices` + chord/arc branches; `#relocateOrphanedShapes` and friends; the surgery zoo of macros that each do their own wiring) should collapse into paragraph-sized compositions of a small primitive set. We expect a net **deletion of ~1,500–2,500 lines** across `atlas.ts` and `folk-atlas.ts` once the chunks land. If the deletion isn't materialising at the expected rate, something is mis-shaped and we stop and reconsider before continuing.

## Vocabulary

The atlas is a multigraph in two senses: faces connected by stitches (an undirected face-adjacency multigraph), and faces connected by links (a directed multigraph layered on top). Naming is chosen to keep the per-face boundary structure distinct from the multigraph edges.

| Term | Plays role of | Replaces today |
|---|---|---|
| `Face` | polygon node; has a frame, an outer loop, zero or more inner loops, a set of shapes | `Face` |
| `Side` | one boundary segment of a face, in face-local coordinates | `HalfEdge` |
| `Loop` | an array of sides forming a cycle (outer CCW, inner CW) | implicit (`Face.halfEdges`, `Face.innerLoops`) |
| `Junction` | internal: a point in the oriented projective plane, in some face's frame | `Junction` |
| `Stitch` | reciprocal binding between two sides, with a transform | `HalfEdge.twin` + `HalfEdge.transform` |
| `Link` | directed binding from one face to another, with a transform | (does not exist today) |
| `Atlas` | container of faces, stitches, links, plus a chosen root | `Atlas` |

`HalfEdge` goes away. The "half-edge" structure (two side-objects per logical seam, one per face) remains — that's unavoidable while faces have face-local coordinates — but `Stitch` becomes the load-bearing first-class object for cross-face information instead of being smeared across `twin` + `transform` + a per-side asymmetry tax.

## Pinned decisions

### Types

```ts
class Side {
  a: Junction;
  b: Junction;
  // R²/OPP-specific disambiguator: when both endpoints are ideal-antipodal,
  // names which real line they bound; null = at-infinity arc on S¹.
  // Future: this slot generalises with the per-face model space.
  anchor: Point | null = null;
  stitch: Stitch | null = null;
}

type Loop = Side[];

class Face {
  outer: Loop;             // CCW
  inner: Loop[];           // each CW; default []
  frame: Matrix2D;         // face-local → reference (composite seed when root)
  shapes: Set<Element>;
}

class Stitch {
  a: Side;
  b: Side;
  transform: Matrix2D;     // a.face frame → b.face frame
  other(self: Side): Side;
  transformFrom(self: Side): Matrix2D;  // self.face frame → other.face frame
}

class Link {
  from: Face;              // parent
  to: Face;                // child
  transform: Matrix2D;     // from.frame → to.frame
}

class Atlas {
  faces: Set<Face>;
  stitches: Set<Stitch>;
  links: Set<Link>;
  root: Face;
}
```

### Naming convention

- **Symmetric** (stitch endpoints, side endpoints): `a` / `b`. No semantic difference between the two; either may appear in either slot.
- **Directed** (link source/target): `from` / `to`. Asymmetry is the whole point.
- **Self/other helpers** for symmetric bindings: `stitch.other(self)`, `stitch.transformFrom(self)`. Caller doesn't need to know which slot they hold.

### Identity

- **`splitFace(face, sideA, sideB)` preserves `face`'s identity.** The original `face` becomes the side of the loop traversal `sideA → … → sideB` (CCW from A, exclusive of B). The other half is returned as `fresh: Face`. The chord between them is `chord: Stitch`. The caller flips by passing `(sideB, sideA)`. This is the rule that makes most of the orphan-relocation code disappear: shapes inside the kept half don't move, and external stitches/links on the kept half stay attached without rewiring.
- **`splitSide(side, t)` preserves `side`'s identity.** The original `side` becomes the segment from its `a` endpoint to the new vertex. The new segment from the new vertex to the original `b` is returned as `fresh: Side`. If `side.stitch` exists, the partner side is split symmetrically and both halves are re-stitched.
- **Root consumption.** If `splitFace` happens to discard the side containing the atlas root, root is automatically swapped to a surviving face and the change-of-view matrix is returned (same shape as today's `switchRoot`). Common case: split doesn't touch the root, no swap needed, no view compensation.

### Where bindings live

- **`Stitch` is held by both sides** (`sideA.stitch === sideB.stitch === s`) **and tracked on the atlas** (`atlas.stitches`). Reciprocity is structural.
- **`Link` lives only on the atlas** (`atlas.links`), not on sides. Links are face → face; they don't enter through a specific side. (Performance lookups like "all outgoing links of this face" are derivable on demand or memoised; not part of the substrate.)
- A side's binding slot is `stitch: Stitch | null`. There is no `Side | Link | null` union, because links don't bind to sides. If a future binding kind shows up that does bind to a side, we revisit.

### Model space

Hardcoded R² with the OPP compactification. One single-line comment on `Side.anchor` marks the future generalisation point. No `Model` interface, no per-face `model` field. We do this in step 9, not step 4.

### Macros vs primitives

- The substrate primitive set is exactly: `createFace` / `deleteFace`, `splitSide` / `joinSides`, `splitFace` / `mergeFaces`, `stitch` / `unstitch`, `link` / `unlink`, plus `addInnerLoop` / `removeInnerLoop`. Six pairs, twelve functions.
- Today's `splitFaceAlongChord`, `splitFaceAlongLine`, `splitAtlasAlongLine`, `insertStrip`, `resizeStrip` become **macros**: free functions in `packages/labs/src/atlas/macros/`, each implemented as `walkLine + splitSide × N + splitFace + stitch × M`. They are not methods on `Atlas`.
- Parametric changes (move, rotate, scale a face, drag a shape) are **plain setters** on existing fields, not surgery calls.

### Open questions (deferred; do not block first chunk)

- `Loop` as a type vs. a plain array. Currently a plain array; promote only if a downstream step demands it.
- Return-path policy for links. Per-walker decision; substrate doesn't pick.
- Cross-model-space stitch transform shape. Comes up in step 9.
- Whether validation should drop the similarity-only check entirely or keep it gated on a per-face flag. Decided alongside chunk F.
- Journaling/undo. Free side benefit of paired inverses; not built now.

## Chunks, ranked by simplification yield

Each chunk is independently shippable, lands a measurable code reduction, and unblocks subsequent chunks.

### Chunk A — identity-preserving `splitFaceAtVertices` ✅ landed

**Change:** `splitFaceAtVertices(face, …)` mutates `face` in place (it becomes the CCW arc from `vIdxA` to `vIdxB` plus the new chord HE) and returns `{ face, fresh, faceChordHE, freshChordHE, freshOffset }`. Only `fresh` is re-anchored; `face`'s frame and vertex coordinates are unchanged.

**Depends on:** nothing.

**What landed:**
- `splitFaceAtVertices` rewritten in place; result type cleaned up (`face`/`fresh`/`faceChordHE`/`freshChordHE`/`freshOffset`) with `faces`/`chordHEs` kept as deprecated array aliases for one transitional commit.
- `splitFaceAlongChord`, `splitFaceAlongLine`, `splitAtlasAlongLine` updated to use the new fields. `ChainSplitPair` lost `originalFace` (always equal to `rightFace` now); gained `leftOffset` so callers can re-translate per-face data on the moved side.
- `FolkAtlas#relocateOrphanedShapes` → `#revalidateShapePlacements`. `FolkAtlas#relocateOrphanedRegions` → `#revalidateRegionPlacements`. Both reduced to "for each tracked thing, check if its current face still contains it; if not, find the new host." No K-matrix.
- `FolkAtlas#compensateViewAfterMutation` deleted entirely. Identity preservation means `atlas.root` is never replaced by a cut, so the view never needs compensating.
- `#commitCutGizmo` and `#runOneRegionCut` simplified accordingly.
- `detachFace` helper deleted (no longer called).

**Net delta:** −128 lines across `atlas.ts` + `folk-atlas.ts` (−60 / −68). All 207 tests pass.

**Why the LOC delta is smaller than originally estimated:** the doc projected −600 to −800. The actual orphan-relocation code was ~130 lines (not 400–600), so its replacement was a wash on size. The K-matrix view-compensation was ~30 lines (not 100–200). The chunk's value is *conceptual cleanliness*, not raw deletion: the orphan-relocation doesn't stay because the K-matrix is gone, the cut path no longer thinks about root swaps, and `splitFaceAtVertices` returns a structurally honest shape (`face` is the original, `fresh` is the new one) instead of two interchangeable sub-faces.

**Lessons recalibrating later chunk estimates:** in this codebase the load-bearing complexity per pain point is closer to ~100–200 lines than to ~500 lines. Subsequent chunks (B/D) likely deliver −300 to −500 lines each rather than the −600 to −1,000 the doc projected — but the *conceptual* simplification per chunk should still hold.

### Chunk C — introduce `Stitch` as object alongside existing twins (transitional) ✅ landed

**Change:** add a `Stitch` class as a thin reciprocal-pair handle held by both endpoints. The `twin` / `transform` fields stay (chunk B will remove them); Stitch is a parallel view that names every reciprocal pair as a first-class object.

**Depends on:** nothing structural (independent of A).

**What landed:**
- `Stitch` class: holds `a`, `b`; exposes `transform` (getter delegating to `a.transform`), `other(self)`, `transformFrom(self)`. No persistent transform field of its own.
- `HalfEdge.stitch: Stitch | null` back-reference.
- `Atlas.stitches`: derived `Set<Stitch>` getter — no separate persisted set to keep in sync.
- `setTwin` (internal) modified to manage Stitch lifecycle automatically: reuses the existing Stitch when both endpoints already share one (the resize-an-existing-pair case), otherwise clears stale back-refs and allocates a fresh Stitch. Every call site (`splitFaceAtVertices` chord pair, `subdivideHalfEdge` subdivided pair, `insertStrip`, `resizeStrip`) now produces stitched pairs without source-level changes.
- New `stitch(atlas, a, b, T)` and `unstitch(s)` exports as the canonical names. `wrapEdges` / `untwinEdges` retained as deprecated aliases that delegate to the new primitives.
- `unlinkEdgeFromTwin` updated: when the asymmetric break invalidates a Stitch's reciprocity contract, both endpoints' `.stitch` back-refs are cleared.
- `validateAtlas` grew a per-stitch invariant block (back-refs symmetric, twin pointers reciprocal, transforms mutually inverse).
- 12 new tests covering the Stitch API and invariant checks.

**Net delta:** +159 lines in `atlas.ts` (mostly the Stitch class, new API, and validation block). No change in `folk-atlas.ts`. All 219 tests pass (207 existing + 12 new).

**This is purely setup.** Chunk C alone delivers no visible deletion — its value is that chunk B can now replace `HalfEdge.twin` / `HalfEdge.transform` with `Side.stitch.transformFrom(self)` mechanically, because every reciprocal pair already has a Stitch to delegate to. The asymmetric region-wrap pattern in `folk-atlas.ts` (which uses `linkEdgeToTwin` × 2 to make a fake-reciprocal pair without a Stitch) survives unchanged as a known transitional artefact; resolving it is a chunk B/E concern.

### Chunk B — `Side` replaces `HalfEdge` ✅ landed

**Change:** `HalfEdge` renamed to `Side`. `chordAnchor` renamed to `anchor`. New `Side.kind` getter consolidates `originKind` + `isChord` + `isAtInfinity` into a single 5-way discriminator (`'segment' | 'ray' | 'antiRay' | 'chord' | 'arc'`). The 5-way pattern dispatch in `pointOnSideAtU` / `uOfPointOnSide` / `intersectLineWithSide` / `findSideForFinitePoint` collapses behind a single `rayParam(side)` helper that returns the per-kind `(start, dir, uMin, uMax)` parametrisation.

**What landed:**
- Class rename: `HalfEdge` → `Side`. Field renames: `Atlas.halfEdges` → `Atlas.sides`, `Face.halfEdges` → `Face.sides`, `Face.halfEdgesCCW` → `Face.sidesCCW`, `Face.allHalfEdges` → `Face.allSides`, `Side.chordAnchor` → `Side.anchor`. Helper renames: `pointOnHEAtU` → `pointOnSideAtU`, `uOfPointOnHE` → `uOfPointOnSide`, `intersectLineWithHE` → `intersectLineWithSide`, `findHEForFinitePoint` → `findSideForFinitePoint`, `findArcForIdealDir` → `findSideForIdealDir`, `subdivideHalfEdge` → `subdivideSide`. Result-type field renames: `faceChordHE` → `faceChordSide`, `freshChordHE` → `freshChordSide`, `leftChordHE` → `leftChordSide`, `rightChordHE` → `rightChordSide`, `topHEs` → `topSides`, `bottomHEs` → `bottomSides`, `chordHEs` → `chordSides`.
- New `Side.kind` getter; `isAtInfinity` / `isChord` retained as deprecated aliases.
- New `rayParam(side)` internal helper that returns `{ start, dir, uMin, uMax }` for non-arc sides, `null` for arcs. Every geometry helper that used to switch on `originKind` + `isChord` now dispatches once via `rayParam`.
- New deprecated type alias `export type HalfEdge = Side;`.
- New test for `Side.kind` covering all five kinds.

**Net delta:** roughly flat in `atlas.ts` (~+13 lines despite massive renames; the geometry consolidation deleted ~30 lines of dispatch but the new `rayParam` helper plus longer docstrings explaining `kind` add similar volume back). All 220 tests pass. TypeScript build clean.

**Why the LOC delta is again smaller than estimated:** the doc projected −400 to −600 lines from "isAtInfinity / isChord branches across the codebase." Counting actual call sites: most uses of `isChord` / `isAtInfinity` are one-off boolean predicates (`if (side.isChord) ...`), not 5-way dispatches. The 5-way dispatches were already concentrated in just three geometry helpers, which we did consolidate. Outside those, the predicates legitimately need to remain — they're not redundancy, they're feature checks. Recalibration carries forward into D's estimate.

**What chunk B did NOT do (deferred):**
- Removing `Side.twin` / `Side.transform` in favour of `Side.stitch.transformFrom(self)`. Blocked by the asymmetric region-wrap pattern in `folk-atlas.ts` which uses raw `linkEdgeToTwin` × 2 to make a Stitch-less reciprocal pair. Resolving this needs either edge-to-edge `Link` or a redesign of the wrap mechanism.
- Moving from `(originKind, ox, oy)` storage with `target = next.origin()` to explicit `(a: Junction, b: Junction)` storage. Mostly cosmetic at this point; the `kind` getter abstracts over it.
- Using polymorphic `Curve` subclasses instead of `kind` discriminator. The functional `rayParam` dispatch is sufficient for the current workload.

### Chunk D — lift macros

**Change:** `splitFaceAlongChord`, `splitFaceAlongLine`, `splitAtlasAlongLine`, `insertStrip`, `resizeStrip` become 20–40 line free functions in `atlas/macros/`, each implemented as `walkLine + splitSide × N + splitFace + stitch × M`. No inline transform math, no inline wiring.

**Depends on:** B.

**Deletes:**
- Inline wiring/transform/rebasing inside each of the above (~600–1,000 lines from `atlas.ts`)

### Chunk E — `Link` as a second binding kind

**Change:** add `Link`, `link`, `unlink`. `computeImages` BFS extends to follow links as well as stitches. Returns the same `AtlasImage[]` shape.

**Depends on:** nothing (additive); cleaner with B done first.

**Deletes:** nothing existing. Unlocks the recursive-zoom and hypertext demos as one-paragraph configurations.

### Chunk F — drop the similarity-only constraint and the named twin primitives

**Change:** `wrapEdges` / `linkEdgeToTwin` / `untwinEdges` / `unlinkEdgeFromTwin` are deleted in favour of `stitch` / `unstitch`. The similarity-only check is removed from `validateAtlas` (rotation, reflection, non-uniform scale, shear all become legal in stitch transforms).

**Depends on:** B, C.

**Deletes:**
- The four primitive functions above (~150 lines from `atlas.ts`)
- The similarity-only block in `validateAtlas` (~30 lines)

**Unlocks:** Klein bottle, RP², Dehn-twisted torus, recursive zoom with similarity transforms (the substrate stops refusing them).

## Suggested ordering

1. **A** — independent, biggest deletion, no new types. Start here.
2. **C** — independent of A; preps B.
3. **B** — the structural redesign. Pairs naturally with D and F as a single "kill HalfEdge" milestone if appetite allows; otherwise B alone first, D and F follow.
4. **D** — payoff after B.
5. **F** — small cleanup once B + C are in.
6. **E** — any time after C; not on the critical path.

A and C can land in either order; they don't interact. B + D + F together comprise the "kill HalfEdge" milestone and may want to be one PR or three back-to-back.

## How we'll know we're on the right track

After chunk A, the spike examples from the design discussion (hex torus in 13 lines, recess scheme in 10 lines, Klein bottle in 6 lines, recursive zoom in 1 line) should *not yet* be expressible — but the path to them should be visibly shorter. Specifically: after A, the "what code do I have to write to add a new scheme" question should already feel less like editing surgery internals and more like composing primitives.

After B + D + F, the spike examples should be literal — pasteable into a test file and runnable.

If after chunk A the codebase isn't visibly simpler — if the `K`-matrix appears in surprising places, or if shape-relocation logic survived in some other shape — we stop and re-examine before starting B/C.

**Chunk A retrospective:** the K-matrix is gone from the cut path (the only `M.invert` left in the cut commit is a single `inv(stripComp)` for the gizmo follow-strip behaviour, which is a UX feature not a substrate one). Shape/region re-validation is now a generic "does the face's current boundary still contain me?" check — agnostic to which mutation just ran. Identity preservation through splits means `atlas.root` is never replaced automatically. The conceptual cleanup landed; raw LOC deletion was modest because the original orphan-relocation code was smaller than estimated (see chunk A entry above). Onwards to B/C.
