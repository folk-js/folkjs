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

Originally framed as "additive, unlocks recursive zoom." Re-scoped post-A/C/B as the **substrate-completion move that retires the asymmetric edge-twin model entirely**. Today's `linkEdgeToTwin` × 2 wrap-toggle in `folk-atlas.ts` is morally a poorly-typed Link — `substrate.md`'s "closed surface placed by a Link" pattern. Once Link exists at the substrate level, the asymmetric model is redundant and `Side.twin` / `Side.transform` can go away entirely. Done in three phases:

#### Phase 1 — introduce `Link` (additive) ✅ landed

**Change:** add the substrate primitive without touching existing wraps.

**What landed:**
- `Link` class: `from`, `to`, `transform` (direction `to → from` per `substrate.md`'s "places child inside parent at T" reading).
- `Atlas.links: Set<Link>` — explicitly persisted (unlike `Atlas.stitches`, which can be derived from edge back-references; Link has no natural per-face holder since many parents may target one child).
- `Atlas.outgoingLinks(face)` — linear-scan helper.
- `link(atlas, from, to, T): Link` and `unlink(atlas, l)` exports.
- `Atlas.computeImages` BFS extended to follow outgoing links with the **same cap and self-loop semantics as twin pointers**: a self-link only tiles when the linked face is the BFS root, matching today's wrap-region behaviour for the asymmetric-twin pattern (this is what "default to current behaviour" means for return-path policy).
- `validateAtlas` extended: per-Link endpoint membership check; reachability traversal extended to follow links in both directions.
- 10 new tests covering link/unlink, the recursive-zoom 1-line spike (which now actually works), non-root self-link suppression, and Link reachability.

**Net delta:** +~120 lines `atlas.ts`, +~150 lines tests. All 230 tests pass.

**Available now:** recursive zoom as a one-line configuration (`link(atlas, face, face, scaleTransform)`), and the substrate primitive needed for Phases 2 + 3.

#### Phase 2 — rewrite `FolkAtlas#wrapRegionAxis` to use Link ✅ landed

**Change:** the wrap toggle in `folk-atlas.ts` switched from `linkEdgeToTwin` × 2 (raw asymmetric edge twins) to a clean `stitch` (cylinder loop) + `link` (face placement) composition.

**What landed:**
- Wrap-on captures the outer↔region edge stitches' state (the partner Side reference plus the original outer→region transform), `unstitch`es them, installs `stitch(atlas, heA, heB, translationToWrap(heA, heB))` for the cylinder loop, and `link(atlas, outerFace, regionFace, inv(outerToRegion))` from each formerly-bordering outer face to the region.
- Wrap-off reads the saved state, dismantles the cylinder Stitch and Links via `unstitch`/`unlink`, then `stitch`es the original outer↔region edges back with the captured transforms.
- A WeakMap-keyed `#wrapMetadata` on `FolkAtlas` holds per-region per-axis state across the wrap toggle. Captured at wrap-on, consulted at wrap-off, dropped after each transition.
- `rescaleFaceFrame` extended to also conjugate Link transforms touching the rescaled face — analogous to its existing twin-transform conjugation. Without this, `setRegionScale` on a wrapped region would visibly snap the placement.
- `#findExternalIncomingTwin` deleted (only consumer was the old wrap-off path; the new path reads outer-side references straight from the saved state).
- 2 new tests at the substrate level (since `wrapRegionAxis` itself is on a DOM element and not unit-testable in node): one composes the full wrap-on → BFS-tile → wrap-off cycle and verifies the topology / images / restoration; one verifies `rescaleFaceFrame` correctly conjugates Link transforms.

**Net delta:** −5 lines `folk-atlas.ts` (`#findExternalIncomingTwin` deleted; `wrapRegionAxis` slightly longer due to saved-state plumbing — that growth is paid back when Phase 3 deletes `linkEdgeToTwin` / `unlinkEdgeFromTwin` entirely), +20 lines `atlas.ts` (Link conjugation in `rescaleFaceFrame`), +130 lines tests. All 232 tests pass.

**Walker compatibility (no extra work needed):** `screenToFaceLocal` and shape drag already iterate `computeImages`, which after Phase 1 includes Link-placed images. So a pointer over a Link-placed copy of the wrapped region correctly resolves to the region face; shape drags into / out of a wrapped region work without renderer changes. The original concern about "walking off a free edge into a Link's child" turned out to be a non-issue for our pointer-pick path because we already do polygon-in-polygon containment checks against every BFS image, not edge-following.

#### Phase 3 — retire the asymmetric machinery ✅ landed

**Change:** delete the named asymmetric primitives, drop the validator's similarity-only and bidirectional-reachability blocks, migrate the test corpus.

**What landed:**
- `linkEdgeToTwin` deleted. Its precondition / junction-correspondence checks are inlined into `stitch`, which now stands alone (no longer routes through two `linkEdgeToTwin` calls + a `setTwin` promotion).
- `unlinkEdgeFromTwin` deleted (its only role was breaking asymmetric twins; with no asymmetric model there's nothing to break).
- `wrapEdges` and `untwinEdges` deleted (deprecated aliases since chunk C).
- `validateAtlas`'s **similarity-only** edge-transform block deleted (~25 lines). Klein-bottle, RP², Dehn-twisted torus, and arbitrary affine stitch transforms are now legal at the substrate level. Per-face model spaces (substrate.md's `(R², similarity)`, `(H², Möbius)`, etc.) will, when introduced, take over the job of constraining transforms by model.
- `validateAtlas`'s **bidirectional-incoming-twin reachability** special case deleted (~25 lines). Twin reciprocity is structural now (Stitch invariants enforce it), so the forward-only twin walk reaches every stitch-connected face. Link reachability remains bidirectional (an isolated face only connected via incoming Link is reachable).
- The `atlas.ts` module-header commentary on "Twins are NOT required to be reciprocal" / "Similarity-only edge transforms" replaced with the new substrate description (Stitch is structural, Link handles asymmetric cross-face structure, transforms are unconstrained at this layer).
- Test corpus migrated:
  - `describe('untwinEdges', …)` block deleted (no behaviour to test).
  - Asymmetric-only tests inside the `Stitch` block deleted; the legacy-alias round-trip test rewritten to use `stitch` / `unstitch` directly.
  - `describe('linkEdgeToTwin (asymmetric primitive)', …)` deleted.
  - `describe('unlinkEdgeFromTwin (asymmetric inverse)', …)` deleted.
  - `describe('asymmetric wrap semantics (region-style)', …)` rewritten as `describe('closed-surface wrap (torus / Klein-style topologies via Stitch only)', …)` — the doubly-wrapped torus is built with two reciprocal stitches instead of four `linkEdgeToTwin` calls; the strip-style asymmetric tests are gone (their behaviour is covered by the substrate wrap test in the `Stitch` block plus chunk E Phase 2's substrate composition).
  - The `splitFaceAtVertices preserves an asymmetric wrap` test rewritten as "preserves a Link + cylinder-Stitch wrap when splitting a host face" — same scenario, expressed via the substrate primitives.
  - Two `validateAtlas` similarity-rejection tests replaced with one acceptance test confirming non-similarity transforms now pass.

**`Side.twin` / `Side.transform` retained** as the storage backing `Stitch`'s transform getter and the BFS step in `computeImages`. Removing those fields entirely (replacing every read with `side.stitch.transformFrom(side)`) is a follow-up cleanup with no substrate consequences — the asymmetric model is already gone in spirit; what remains is just internal storage.

**Net delta:** −426 lines combined (Phases 2 + 3 since the previous commit) across `atlas.ts` and tests, of which Phase 3 contributes roughly −300 (the deletions above). 216 tests pass (was 232 before Phase 3 — net −14 after pruning the asymmetric-only describe blocks). TypeScript build clean.

**Unlocked:**
- Klein bottle: `stitch(face, opposite_edges, T_with_reflection_in_linear_part)` now passes validation.
- RP², Dehn-twisted torus: same story.
- Recursive zoom: already worked in Phase 1; still works here.
- Embedded closed regions (cylinders / tori inside hosts): expressed via `stitch` (cylinder loop) + `link` (host placement), per the chunk E Phase 2 wrap rewrite.

The asymmetric-twin trap is eliminated by construction. `Stitch` is reciprocal-only (a class invariant); `Link` is the only directional binding; there is no third "asymmetric edge twin" axis at the substrate level.

### Chunk F — folded into Phase 3

The original chunk F (drop similarity-only + delete the named twin primitives) was carved out as a separate step before we recognised Link was the underlying substrate gap. With Link in place, those weren't separate work — they were things that fell out of Phase 3 once the asymmetric model became unreachable.

### Cleanup pass — drop deprecated aliases, consolidate dispatch ✅ landed

After Phase 3 there was a layer of transitional debris: deprecated type aliases (`HalfEdge = Side`), deprecated result fields (`SplitChordResult.faces`, `chordSides`), deprecated getters (`Side.isAtInfinity`, `Side.isChord`), and `Side`'s redundant `originKind`/`ox`/`oy`/`twin`/`transform` storage (now derivable from `a: Junction` plus `stitch`).

**What landed:**
- `HalfEdge` type alias deleted; ~150 reads/writes migrated to use `Side` and `Side.a` directly.
- `SplitChordResult.faces` and `chordSides` array accessors deleted; consumers migrated to direct fields (`face`, `fresh`, `faceChordSide`, `freshChordSide`).
- `Side.isAtInfinity` / `Side.isChord` getters deleted; ~40 call sites migrated to `side.kind === 'arc'` / `=== 'chord'`.
- `BoundaryHit` / `CapturedHit` rewritten as proper discriminated unions (`{ kind: 'finite', … } | { kind: 'ideal', … }`), eliminating optional-field plumbing across consumers.
- `Side.originKind` / `ox` / `oy` collapsed into `Side.a: Junction`. The Junction descriptor was already canonical for `Face.junctions()` consumers; now it's also the storage shape on `Side` itself.
- `Side.twin` / `Side.transform` *fields* deleted and replaced by getters that delegate to `Stitch` (`stitch.other(self)` / `stitch.transformFrom(self)`). `Stitch` gained `transformAtoB` / `transformBtoA` direct fields and is now the single source of truth for edge-level transforms; arcs (which have no stitch) just expose `null` / identity.
- Internal `matricesAreClose` / `matrixToString` helpers deleted; `validateAtlas` uses `M.equals` and inlines string formatting.

**Net delta:** ~−180 lines `atlas.ts` net (after accounting for new Stitch storage and discriminated-union reshaping); 216 tests pass; TypeScript build clean.

**Why this matters:** the post-cleanup substrate is genuinely smaller. `Side` is now a thin geometry+topology pointer record (origin junction, neighbour pointers, optional anchor, optional stitch back-ref) with derived getters; `Stitch` is the authoritative edge-binding object; `Link` handles directed cross-face placement. The "asymmetric edge twin" axis is gone in storage as well as in spirit.

### `createFace` substrate primitive ✅ landed

Adds the missing "build a polygon face from a CCW list of junctions and register it with the atlas" primitive — until now, the only way to construct a face was either via the seed-atlas builders (`createInitialAtlas`, `createAllIdealAtlas`), via `splitFaceAtVertices` (which reuses pre-existing Side objects), or by hand inside `insertStrip` (~30 lines of side-allocation + rotation + cycle wiring + atlas registration).

**What landed:**
- `createFace(atlas, junctions, options?)` exported as the substrate primitive: takes a CCW list of `Junction`s, builds the `Side` objects, wires the cycle, optionally pins ideal-ideal chord lines via an `anchors: Map<number, Point>` option, registers the face + its sides with the atlas, returns the new `Face`.
- `insertStrip` rewritten on top of `createFace`. The bottom/top junction arrays are computed as before (this is the strip-specific layout logic), but the side construction, cycle rotation, anchor pinning, `new Face`, and `attachFace` are replaced by a single `createFace` call. Recovery of `bottomSides` / `topSides` from the new face's `sides` array becomes a slice + a small reverse loop (the legacy "rotate so first finite vertex is at sides[0]" cosmetic was dropped — Face's `sides[0]` no longer carries any anchor convention; the strip's `(0, 0)` anchor lives in its frame, not in cycle position).
- The chord-twin stitching loop in `insertStrip` was extracted into a small `stitchAndTranslate` helper that captures the "translate to whichever endpoint is finite, fall back to chord anchor for ideal-ideal" pattern in one place. Right and left chords pass different `(stripForOrigin, stripForTarget)` pairs to express their direction asymmetry (right goes B→A, left goes A→B).

**Net delta:** atlas.ts +33 lines (createFace primitive ~50 with full doc; insertStrip body shrank ~17 net). 220 tests pass (was 215, added 5 direct `createFace` tests; one `insertStrip` test rewritten to assert the semantic property `(0, 0) is a finite vertex of the strip` instead of the former cosmetic `sides[0].a is finite at (0, 0)`).

**Why the LOC didn't drop the way the audit projected:** the audit estimated `−80` LOC for "createFace + partial insertStrip dissolution." Reality: `insertStrip`'s 250-line body is dominated by line-direction inference (~30), vertex-layout maths (~30), chord-twin wiring (~50) and digon-special-case bookkeeping (~10). Face construction proper was ~20 lines pre-refactor. `createFace` can only dissolve those 20 — the rest is genuinely strip-specific and stays. The audit's "strip isn't special" instinct is right at the level of substrate primitives (the strip face IS just `createFace + stitching`), but the *layout maths* between the chord chain and the strip's vertex coordinates is something only the strip macro knows, and that's where most of the lines are.

**What this unlocks anyway:**
- Future macros that build a face from junctions (recess scheme, hex tile, Klein-bottle quad, …) can now do it in one line instead of copy-pasting the side-build + face-construction + atlas-register dance.
- The `Face` constructor + `attachFace` helper combo is no longer a public composition contract; `createFace` is the single substrate entry point. Direct `new Face(...)` survives only inside the seed-atlas builders (which precede `Atlas` itself) and inside `splitFaceAtVertices` (which reuses pre-existing Side objects rather than building from junctions).

### Macro surface collapse — split primitives ✅ landed

The post-cleanup audit flagged the surgery surface as suspicious: `subdivideSide` and `subdivideAtInfinityArc` were two near-identical functions distinguished only by whether the side being subdivided was an arc; `splitFaceAlongLine` and `splitAtlasAlongLine` were two ways to start a line cut, diverging only on whether the cut propagated through twin edges.

**What landed:**
- `subdivideAtInfinityArc` deleted; `subdivideSide` now handles both arc and non-arc inputs uniformly. The `at: Point` argument is interpreted as a finite point on non-arcs, and as a unit ideal direction on arcs (the side's `kind` discriminator picks). Result type unified: `SubdivideSideResult { newVertex, faceHalves, twinHalves: [Side, Side] | null }` where `twinHalves` is `null` for arcs (and for free non-arc sides, just like before).
- `splitFaceAlongLine` and `splitAtlasAlongLine` deleted; both folded into `splitAlongLine(atlas, host, seam, direction, options?: { propagate?: boolean })`. `propagate: true` (default) walks the chain across the atlas; `propagate: false` cuts only the host face. Result type unified: `SplitAlongLineResult { pairs: ChainSplitPair[] }` always — face-bounded cuts return a single-element `pairs` array.

**Net delta:** −68 lines `atlas.ts`, −10 lines tests, −1 line `folk-atlas.ts`. 215 tests pass (was 216; one redundant "throws on at-infinity arcs" test deleted as the new `subdivideSide` handles both cases natively, replaced with two more meaningful arc-edge-case tests).

**Why this matters:** the substrate primitive surface is now strictly smaller. A subdivision is "insert a vertex on this side at this location" — one operation, kind-dispatched internally. A line cut is "cut along this line, optionally propagating" — one operation, parameterised. Callers no longer have to know the side is an arc to pick the right function; they no longer have to know whether they want propagation to import the right name. The mental model is "what do I want to do (subdivide / cut)" instead of "which kind of input am I starting from."

## Status / current ordering

Landed: **A** → **C** → **B** → **E Phase 1** → **E Phase 2** → **E Phase 3** → **cleanup pass** → **macro surface collapse** → **`createFace` primitive**.

### Bug fix: Link transforms now re-derive from the stitch chain after cuts ✅ landed

The `links` commit (`e644523`, `E Phase 1`) replaced the asymmetric edge-twin wrap pattern with `Stitch` (cylinder loop) + `Link` (host-side placement). For a cylinder region this installs **two** Links — one from each side neighbour — and the wrap-on logic chooses both transforms so that, in the pre-cut topology, walking from any root via either link reaches the region at the same world position. Composite consistency is encoded by the equation
`composite(link_a.from, R) · link_a.transform = composite(link_b.from, R) · link_b.transform` for every BFS root `R`.

Cuts on a face adjacent to the wrapped region break this equation. The cut chain conjugates `Stitch` transforms, which shifts `composite(link.from, R)` for each link source. `link.transform` was a one-time snapshot at wrap-on, so it stays frozen while the chain composites drift. When BFS from one root picks `link_a` (e.g. because `link_a.from` is dequeued first) and BFS from another root picks `link_b`, the two roots place the region at *different* world positions. The user-visible symptom is the region appearing to "stay put" while the surrounding geometry shifts by exactly the strip's `height · perp` — a clean signature of the link-vs-chain divergence.

**Fix.** Both `splitFaceAtVertices` AND `insertStrip` now re-derive each `Link.transform` from a stitch-only BFS along `link.from → link.to`:

```
function recomputeLinkTransformsFromStitchChain(atlas) {
  for (const link of atlas.links) {
    if (link.from === link.to) continue;            // self-link (recursive zoom): no chain to derive
    const chain = bfsCompositeViaStitchesOnly(atlas, link.from, link.to);
    if (chain) link.transform = chain;
  }
}
```

The helper `bfsCompositeViaStitchesOnly(atlas, from, target)` BFS-walks twins (no link traversal) from `from` to `target`, returning the composite mapping `target`-frame → `from`-frame, or `null` if `target` is unreachable via stitches.

Three call sites are needed: `splitFaceAtVertices` (post stitch conjugation), `insertStrip` (post chord-stitch → strip-stitch swap), and `resizeStrip` (post top-stitch `Δ·perp` shift).

The `resizeStrip` call site is the one that completes the fix. The line-cut UI flow is:
1. `#commitCutGizmo` triggers `splitAlongLine + insertStrip` *once* at the gesture's first-cross-epsilon delta — this is the strip's *initial* height, not the user's final intended height.
2. Subsequent drag motion in the same gesture calls `#resizeCutStrip` → `resizeStrip(... newHeight)` repeatedly, mutating the strip top-row stitches by `Δ·perp` each tick.

Without a `resizeStrip` recompute, every cut leaves Link transforms frozen at the *initial-commit* height while the visible strip is at the *final-drag* height, so links are stale by `(finalH − initialH) · perp`. This produced the user-reported "each cut introduces error, the next cut 'fixes' the previous" cascade: each `splitAlongLine + insertStrip` call inside the next gesture re-derives links against the *current* (post-resize) state of all earlier strips, fixing the previous cut's stale value, but the new gesture's own resize phase then leaves *its* link-derived chain stale until the next cut.

`resizeStrip` now takes an optional `atlas` parameter and calls `recomputeLinkTransformsFromStitchChain(atlas)` after mutating top-row transforms. `folk-atlas.ts` passes `this.#atlas` through. With all three call sites in place, link composites stay synchronised through arbitrarily long cut + resize sequences.

Self-links (recursive zoom) keep their original transform — there's no stitch chain to derive it from, and the self-link's transform encodes a deliberate scale/translate.

**Why this works.** Re-derivation keeps every Link in sync with the post-cut conjugated stitch reality. From any root, the stitch chain to `link.to` via `link.from` and the link path to `link.to` give identical composites, so multi-link wrap setups stay self-consistent through any sequence of cuts. The pattern mirrors how the asymmetric-twin model handled this pre-`E1`: the asymmetric edge's transform got conjugated in place by `splitFaceAtVertices`, keeping the wrap edge in sync with the cut. The `Link` system lost this property when transforms became face-level rather than side-level, and recomputing from the chain restores it.

**Constraints.**
- Faces with closed-surface topology (a torus region: every wrap-axis edge has a self-stitch) are unreachable via stitches from outside, so `bfsCompositeViaStitchesOnly` returns `null` and the Link is left alone — its transform is the *only* placement of the region inside its host, and there's no chain to compete with.
- The cylinder-h, cylinder-v, and torus scenes all stay consistent under propagating line cuts after this fix, with the wrapped region's BFS image staying anchored to its world position from any root.

All 221 substrate tests pass; manual verification via `cylinder-h` scene + diagonal cut on the left of the region confirms the region no longer drifts as the BFS root crosses the cut.

Chunk D ("lift macros to a folder") was reconsidered and dropped — moving `splitFaceAlongChord` etc. to `atlas/macros/` is organizational, not substrate, work. The macros stay where they are; what improves them is *better building blocks*, not better folder structure. Better building blocks is what E Phases 2 + 3 + the macro-surface collapse delivered.

## How we'll know we're on the right track

After chunk A, the spike examples from the design discussion (hex torus in 13 lines, recess scheme in 10 lines, Klein bottle in 6 lines, recursive zoom in 1 line) should *not yet* be expressible — but the path to them should be visibly shorter. Specifically: after A, the "what code do I have to write to add a new scheme" question should already feel less like editing surgery internals and more like composing primitives.

After B + D + F, the spike examples should be literal — pasteable into a test file and runnable.

If after chunk A the codebase isn't visibly simpler — if the `K`-matrix appears in surprising places, or if shape-relocation logic survived in some other shape — we stop and re-examine before starting B/C.

**Chunk A retrospective:** the K-matrix is gone from the cut path (the only `M.invert` left in the cut commit is a single `inv(stripComp)` for the gizmo follow-strip behaviour, which is a UX feature not a substrate one). Shape/region re-validation is now a generic "does the face's current boundary still contain me?" check — agnostic to which mutation just ran. Identity preservation through splits means `atlas.root` is never replaced automatically. The conceptual cleanup landed; raw LOC deletion was modest because the original orphan-relocation code was smaller than estimated (see chunk A entry above). Onwards to B/C.
