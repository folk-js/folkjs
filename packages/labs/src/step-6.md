# Step 6: Homogeneous coordinates as the substrate's point representation

Companion to `substrate.md` and `step-{4,5}.md`. Replace the kind-discriminated `Junction = { kind: 'finite' | 'ideal', x, y }` with proper homogeneous coordinates `HomPoint = (x, y, w)` and lines `HomLine = (a, b, c)`. Eliminate the kind-dispatch surface (~60 sites) that currently forks every geometric primitive into a per-kind branch. The substrate's geometry layer should fit on one screen; today it's ~384 lines of branching machinery patching around Cartesian-coordinate limitations.

The point: `signedTurn` (`atlas/geometry/polygon.ts:174`) is nine branches to compute one quantity that's literally `sign(det([a; b; c]))` in homogeneous coordinates. Same shape recurs in `leftOfDirectedEdge`, `subdivideSide`, `joinSidesAtVertex`, `splitFaceAlongChord`'s `materialise` helper, `isPolygonCCW`, `findSideForFinitePoint`/`findSideForIdealDir`, and the four-way conjugation maths in `splitFaceAtVertices`/`mergeFaces`. All are symptoms of representing projective points as `(Cartesian xy + kind discriminator)` instead of homogeneous `(x, y, w)`.

After this step the substrate stops branching on point-kind because there is only one point type.

## Decisions

### Naming

- **`HomPoint`** — homogeneous projective point. Replaces `Junction`.
- **`HomLine`** — homogeneous projective line. Replaces the implicit "line through two endpoints, with `Side.anchor` patching the chord case."
- **`Point`** — unchanged. Continues to mean Cartesian `{ x, y }` from `@folkjs/geometry/Vector2`. Used only at render/UX boundaries and inside model-space-specific helpers; substrate primitives don't talk in `Point` once the migration is done.

The substrate gains one type pair (`HomPoint`, `HomLine`); the existing Cartesian `Point` stays for compatibility. `Junction` retires after Stage 5.

### Representation

```ts
class HomPoint {
  readonly x: number;
  readonly y: number;
  readonly w: number;  // 0 ⇒ ideal (point at infinity); 1 ⇒ finite (canonical scale)
}

class HomLine {
  readonly a: number;
  readonly b: number;
  readonly c: number;  // ax + by + cw = 0 for any homogeneous point on the line
}
```

**Storage convention: always normalized.**

- `HomPoint` finite: `w = 1`, `(x, y)` is the Cartesian position.
- `HomPoint` ideal: `w = 0`, `x² + y² = 1` (unit direction).
- `HomLine` finite: `a² + b² = 1`, `c` is signed perpendicular distance from origin.
- `HomLine` at infinity: `a = b = 0`, `c = 1` (the unique line at infinity, normalized).

Intermediate computations (cross products, transforms) produce unnormalized homogeneous coordinates; a `normalize()` helper canonicalizes before the result reaches stored state. This matches today's behaviour (the `Side` constructor already normalizes ideal directions to unit length).

**Oriented projective**: `(x, y, w) ~ (kx, ky, kw)` only for `k > 0`. The existing left-of and CCW semantics depend on consistent sign; the unoriented quotient (any non-zero `k`) would silently flip orientation conventions. Stay oriented.

### Class vs interface

`HomPoint` and `HomLine` are **classes** with readonly fields, factory statics, and instance methods. Class form lets `point.isFinite()` and `point.applyAffine(T)` read naturally and centralizes invariants in one place.

The classes are **immutable** — every operation returns a new instance. Allocation cost is acceptable; the substrate's hot loops (BFS, validation) iterate over a small finite number of points/lines per face.

### Stitch transforms

**Unchanged in this refactor.** Stitches still hold 2D affine matrices (`M.Matrix2D`). A future refactor could promote them to 3×3 projective matrices to natively support `(H², Möbius)`, but that's a separate decision and not blocked by this one.

For now: a single `applyAffineToHomPoint(T, p)` helper applies a 2D affine to a homogeneous point uniformly:
```ts
applyAffineToHomPoint(T, p) = HomPoint(T.a*p.x + T.c*p.y + T.e*p.w,
                                       T.b*p.x + T.d*p.y + T.f*p.w,
                                       p.w)
```

For ideal points (`w = 0`) the translation drops out automatically — no separate `applyLinearToDirection` path needed.

### Where lines live in `Side`

Today `Side.anchor: Point | null` exists *only* to disambiguate the chord case (two ideal endpoints don't determine the line). After this step:

```ts
class Side {
  a: HomPoint;          // origin (replaces today's `a: Junction`)
  line: HomLine;        // first-class line carrier; computed at construction
  // anchor field removed
  // ... binding fields unchanged: stitch, next, prev, face
}
```

For non-chord sides the line is `crossPP(origin, target)` and stored at construction. For chord sides (both endpoints ideal antipodal), the line must be supplied (the public API's `anchor: Point` parameter is converted to the line internally — `lineThrough(anchor, idealDirection)` derives the carrier from a finite point on it).

`Side.kind` survives as a *derived label* for diagnostics (`get kind()` reads from `(origin.w, target.w, line.a, line.b)`); nothing in the substrate's hot path branches on it.

## Forcing functions

Per stage:

| Stage | Forcing function |
|---|---|
| 1 | `evalLine` and `crossPP` are each one expression with no branching. |
| 2 | All ~250 substrate tests pass with no modification. |
| 3 | All tests still pass after Junction → HomPoint flip. `validateAtlas` produces identical errors on identical inputs. |
| 4 | grep `\.anchor` in atlas.ts returns zero hits. |
| 5 | grep `kind === 'finite'` and `kind === 'ideal'` in atlas.ts returns hits **only** in `validateAtlas` diagnostic messages. |
| 6 | `atlas/geometry/` total LOC ≤ 200. `signedTurn` is one line. |

## Stages

Each stage is independently shippable, individually reduces complexity, and individually tests something concrete.

### Stage 1 — Stand up `HomPoint` / `HomLine` types and helpers

Pure additive scaffolding. New files in `atlas/geometry/`:
- `hom-point.ts` — `HomPoint` class + factory statics (`finite`, `idealDir`).
- `hom-line.ts` — `HomLine` class + factory statics (`through`, `at`, `atInfinity`).
- Operations (free functions or static methods, whichever reads better):
  - `crossPP(p1: HomPoint, p2: HomPoint): HomLine` — line through two points.
  - `crossLL(l1: HomLine, l2: HomLine): HomPoint` — intersection of two lines.
  - `evalLine(line: HomLine, point: HomPoint): number` — `a*x + b*y + c*w`; sign tells side.
  - `pointAtParam(line: HomLine, t: number): HomPoint` — distance `t` along line from foot of perp from origin.
  - `paramOfPoint(line: HomLine, p: HomPoint): number` — inverse.
  - `applyAffine(T, point: HomPoint): HomPoint` (and `HomLine` variant via inverse-transpose).
- Conversion adapters: `HomPoint.fromJunction(j)`, `HomPoint.toJunction()`.

Tests for each helper covering mixed finite/ideal cases (the cases that currently require kind-dispatch in the existing geometry layer).

**No code outside the new files changes. All existing tests pass.**

### Stage 2 — Re-implement existing geometry helpers using homogeneous internally

`leftOfDirectedEdge`, `leftOfDirectedEdgeStrict`, `signedTurn`, `parameterOnSegment`, `polygonContains`, `polygonContainsStrict`, `isPolygonCCW`, `applyLinearToDirection` keep their public Junction-based signatures but route through HomPoint/HomLine internally.

The 9-case `signedTurn` becomes `Math.sign(det([toHomPoint(a); toHomPoint(b); toHomPoint(c)]))` — one expression. `leftOfDirectedEdge` becomes `evalLine(crossPP(toHomPoint(a), toHomPoint(b)), toHomPoint(p)) >= 0`.

Atlas.ts is unchanged (still calls the same Junction-based helpers). Tests pass with no modification.

**Forcing function: zero test churn.**

### Stage 3 — Replace `Junction` with `HomPoint` throughout

`Junction` is removed; `HomPoint` takes its place wherever it appeared:
- `Side.a: Junction` → `Side.a: HomPoint`.
- All `face.junctions(): Junction[]` → `face.junctions(): HomPoint[]` (or rename method).
- All `Junction` parameter types in primitives → `HomPoint`.

`HomPoint.kind` getter (returns `'finite' | 'ideal'` based on `w`) preserves the shape of existing `.kind` access sites. They keep working unchanged. Stage 5 is what eliminates these uses.

External callers that constructed `{ kind: 'finite', x, y }` literals (mostly tests) update to `HomPoint.finite(x, y)` / `HomPoint.idealDir(dx, dy)`. Mechanical migration; ~30-50 sites.

**Forcing function: all tests pass behaviourally identically. Validators produce identical messages.**

### Stage 4 — Add `Side.line`, remove `Side.anchor`

`Side.line: HomLine` is set at construction. For non-chord sides: `crossPP(origin, target)`. For chord sides: derived from caller-supplied `anchor: Point` parameter at the API boundary (`splitFaceAtVertices`'s `anchor` argument, etc.).

`Side.anchor: Point | null` field removed. Anchors that lived in the field now live as line definitions; substrate operations that needed the anchor for chord-disambiguation now use `Side.line` directly.

Cascade:
- `splitFaceAtVertices`'s ideal-ideal branch: anchor → line conversion happens once at the entry, no further branching needed.
- `splitAlongLine`'s captured-hit anchor: same.
- `validateAtlas`'s antipodal-chord check: now reads from `Side.line` directly (the line `(0,0,1)` would be at-infinity, rejected; finite line is what we need).

**Forcing function: grep `\.anchor` in atlas.ts returns zero hits.**

### Stage 5 — Collapse the kind-dispatch sites

The substrate's ~44 `kind === 'finite'/'ideal'` branches in atlas.ts dissolve into uniform homogeneous expressions:
- `subdivideSide`'s 4-way dispatch on `at`'s interpretation collapses (`at: HomPoint` is the parameter).
- `joinSidesAtVertex`'s 5-case kind-combination switch collapses (collinearity = "do these two sides share a line, up to scale?").
- `splitFaceAlongChord`'s `materialise` helper's per-kind short-circuits collapse (uniform parameter comparison).
- `findSideForFinitePoint` and `findSideForIdealDir` collapse into one `findSideContaining(p: HomPoint)`.
- `centroidOfFinite`'s "all-ideal returns (0, 0)" special case loses its specialness — the homogeneous polygon centroid has a uniform formula (returns a HomPoint with `w` proportional to the area; `w = 0` exactly when no finite vertices). This is a *secondary* benefit; `centroidOfFinite` becomes plain `centroid` and the re-anchoring logic becomes one expression.

**Forcing function: grep `kind === ...` in atlas.ts returns hits only in `validateAtlas` diagnostic strings.**

### Stage 6 — Polish

- Remove transitional adapters (`HomPoint.fromJunction`, etc.) if no callers remain.
- Update docs: `substrate.md` notes that `HomPoint` is the substrate's point type; `Junction` is a retired name.
- Audit grep for `.kind`, `.anchor`, `applyLinearToDirection`, etc. — confirm no surprises remain.

## Risks and mitigations

- **Numerical precision on lines from far-apart points.** Cross product of two distant homogeneous points produces large `c` coefficient; subsequent `line · point` evaluations have large-times-small terms. **Mitigation**: line normalization at construction (`a² + b² = 1`). Standard practice. ~3-line helper.

- **Sign convention for the line at infinity.** `(0, 0, 1)` is canonical, but the sign matters for `evalLine(line_at_infinity, ideal_point)`. Pick: `evalLine` of the line at infinity at any ideal point returns `0` (ideal points are on the line at infinity); for a finite point `(x, y, 1)` it returns `1` (finite points are "below" the line at infinity in the oriented convention). Document once; nothing else depends on the choice.

- **External callers of `Junction`.** A grep across the labs package: today's tests construct `{ kind: 'finite', x: 0, y: 0 }` literals heavily. Stage 3 needs a sweep of the test suite and folk-atlas-region.ts / folk-atlas.ts construction sites. Estimate: 50-80 sites, mechanical replacement.

- **Performance.** `HomPoint` allocates an object instead of inlining `(x, y)` numbers. The substrate's hot path is BFS + render, not point arithmetic; the cost is negligible. If profiling later reveals a hot loop, it can specialize.

## What this does NOT do

- Doesn't touch face-level operations (probe 1 from the discussion). `splitFaceAtVertices`/`splitFaceAlongChord`/`splitAlongLine` stay as separate primitives; collapsing them into one `splitFace(face, curve)` is a separate refactor.
- Doesn't touch frame strategy (probe 3). `centroidOfFinite` becomes simpler internally but is still hardcoded into `splitFaceAtVertices`. Lifting re-anchoring out of the substrate is a separate refactor.
- Doesn't touch stitching/binding. `Stitch` and `Link` stay exactly as they are.
- Doesn't promote stitch transforms to 3×3 projective. Affine 2D matrices throughout.
- Doesn't change line-walking. `walkLine` and friends still live in atlas.ts; their internals shrink as kind-dispatch dissolves but their architectural place is unchanged.

This is *one* representational unification. It enables the others; it doesn't do them.
