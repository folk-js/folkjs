import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';
import {
  cross,
  HomLine,
  HomPoint,
  isPolygonCCW,
  isPolygonCW,
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  parameterOnSegment,
  polygonContains,
  polygonContainsStrict,
  sameIdealDirection,
  signedTurn,
} from './atlas/geometry/index.ts';

// Re-export the geometry primitives so existing consumers of `./atlas.ts`
// continue to work unchanged. New code should import directly from
// `./atlas/geometry/index.ts`.
export {
  cross,
  HomLine,
  HomPoint,
  isPolygonCCW,
  isPolygonCW,
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  polygonContains,
  polygonContainsStrict,
  sameIdealDirection,
  signedTurn,
};

// ============================================================================
// Sparse Ideal Atlas — pure data structure (edge-primary)
// ============================================================================
//
// See `sia.md` for the full design. Summary of the model used here:
//
// **Edge-primary geometry.** The atlas is a graph of half-edges. There is no
// `Vertex` class. Each `Side` carries its own intrinsic geometric data:
// the kind (`finite` or `ideal`) and face-local coordinates of its starting
// junction (a face-local point for finite, a unit direction for ideal). A
// half-edge's target is just `next.origin` (derived).
//
// "Vertices" / "junctions" are the equivalence classes of half-edges that
// meet at the same physical point — recoverable by walking
// `next-around-junction = he.twin?.next` (forward) and
// `prev-around-junction = he.prev.twin` (backward, used at boundaries).
//
// **Face frame.** Each `Face` owns k ≥ 3 half-edges in CCW order forming a
// convex polygonal boundary. The face's local coordinate system is whatever
// the half-edge origins are expressed in — there's no required vertex at
// `(0, 0)`. A face also carries an explicit `frame: Matrix2D` that maps its
// face-local coordinates into a chosen reference (consulted as the seed of
// {@link Atlas.computeComposites} when this face is the root). This lets a
// face be "moved" by overwriting `frame`, and lets sub-faces produced by a
// split inherit their parent's frame so that no re-anchoring is needed.
// At-infinity-only faces are first-class: a single face whose boundary is
// k ≥ 3 ideal directions covering S¹ is a valid all-ideal face — the empty
// scene as one face rather than k wedges meeting at a sentinel origin.
//
// **Edge transforms.** Each non-null `h.twin` link is paired by construction
// — every twin pair is reciprocal (`h.twin.twin === h`) because the only way
// to install a twin pair is via {@link stitch} or the internal split /
// subdivision primitives, all of which allocate a {@link Stitch} that owns
// both endpoints. The per-side `h.transform` stores the change of frame
// from `h.face` to `h.twin.face`; `h.twin.transform` is its inverse.
//
// `Stitch.transformFrom(h)` is the substrate-level accessor for "the
// transform out of h's face frame." `h.twin` and `h.transform` are kept as
// the storage backing it (and the BFS step in {@link Atlas.computeImages}).
//
// The geometric junction-correspondence invariant is local to each
// stitched pair:
//   - `h.transform · h.next.origin = h.twin.origin`
//   - `h.transform · h.origin     = h.twin.next.origin`
// For ideal junctions only the linear part of the transform applies (and
// the result is renormalized to unit length).
//
// **Cross-face structure that isn't symmetric** — e.g. embedding a closed
// or wrapped region inside a host, where there's no two-way edge-level
// reciprocity — goes through {@link Link} at the face level, not through
// edge twins. See {@link Link} for the broader picture.
//
// **At-infinity half-edges.** A half-edge with both `origin` and `target`
// ideal is the boundary between two ideal directions — a piece of the line
// at infinity. It has no twin (`null`) and no meaningful transform. It still
// participates in the face's 3-cycle so that face iteration is uniform.
//
// **No global frame.** Every coordinate, vector, and direction stored or
// returned by this module is face-relative. The choice of `atlas.root` is a
// rendering convention only.
//
// **No similarity-only constraint on transforms.** Stitch transforms may be
// arbitrary affine maps (rotation, reflection, non-uniform scale, shear all
// legal). Klein-bottle, RP², and Dehn-twisted-torus topologies are
// expressible directly via `stitch` with the appropriate transform. Per-face
// model spaces (substrate.md's `(R², similarity)`, `(H², Möbius)`, etc.)
// will, when introduced, constrain transforms based on the source/target
// model — that's where transform-shape rules naturally live.

// The `Junction` value type and the oriented-projective-plane primitives that
// operate on it now live in `./atlas/geometry/`. They are re-exported at the
// top of this file for backward compatibility.

// Shared identity matrix returned by `Side.transform` on free sides. Frozen
// so accidental mutation surfaces as a runtime error rather than silently
// corrupting every free side at once.
const IDENTITY_TRANSFORM: M.Matrix2DReadonly = Object.freeze(M.fromValues());

// ----------------------------------------------------------------------------
// Side
// ----------------------------------------------------------------------------

/**
 * A boundary segment of one face's loop. `a` is the origin junction in
 * face-local coordinates; `b` (= `next.a`) is derived from container
 * iteration. Two sides form a twin pair across a shared face seam, bound
 * by a {@link Stitch} which owns the cross-face transform; `twin` and
 * `transform` on `Side` are kept as the storage backing Stitch (they
 * mirror `Stitch.a/b/transformAtoB` for the duration of the binding).
 *
 * **Chord-vs-arc disambiguation for ideal-ideal sides.** A side whose
 * origin and target are both ideal can be one of two geometrically
 * distinct things:
 *
 *   - An **at-infinity arc** on S¹: the boundary of an unbounded face
 *     along a piece of the line at infinity. The endpoints span an
 *     angular wedge CCW on S¹. `twin === null` and `anchor === null`.
 *   - A **chord** through R²: a real straight line whose two limit
 *     directions on S¹ are antipodal (`a` and `next.a` are negatives of
 *     each other). `twin !== null` and `anchor` stores any one finite
 *     point on the line, in face-local coordinates.
 *
 * Two ideal directions don't pin down a chord by themselves (any
 * parallel line shares the same antipodal endpoints); hence `anchor`.
 */
export class Side {
  /** Origin point in face-local homogeneous coordinates. */
  a: HomPoint;
  /** Next side CCW around `face`. */
  next!: Side;
  /** Previous side CCW around `face` (i.e. the side `s` with `s.next === this`). */
  prev!: Side;
  /** Owning face. */
  face!: Face;
  /**
   * Any one finite point on the chord line, in face-local coordinates.
   * Only set on chord sides (both endpoints ideal AND stitched). For all
   * other sides this is `null`. See class docstring.
   *
   * Future refactor (`step-6.md` Stage 4): replace with `line: HomLine`,
   * making the line first-class on every side and dissolving `anchor`
   * entirely. Today still patch-shaped.
   */
  anchor: Point | null = null;
  /**
   * Reciprocal-binding back-reference. Every stitched side references the
   * same {@link Stitch} object as its partner; reciprocity is structural.
   * `null` when this side has no stitch (free side).
   */
  stitch: Stitch | null = null;

  /**
   * The partner side under this side's stitch, or `null` for free sides.
   * Convenience accessor — equivalent to `this.stitch?.other(this) ?? null`.
   */
  get twin(): Side | null {
    return this.stitch ? this.stitch.other(this) : null;
  }

  /**
   * Affine map from this side's face frame to its partner's face frame.
   * For free sides (no stitch), returns the identity matrix.
   */
  get transform(): M.Matrix2DReadonly {
    return this.stitch ? this.stitch.transformFrom(this) : IDENTITY_TRANSFORM;
  }

  constructor(a: HomPoint) {
    this.a = a;
  }

  /** This side's starting point. Equivalent to `this.a`. */
  origin(): HomPoint {
    return this.a;
  }

  /** This side's target point (= origin of `next`). */
  target(): HomPoint {
    return this.next.a;
  }

  /**
   * The projective line this side lies on, in face-local coordinates.
   *
   * Derived on demand from the endpoints (and `anchor` for the chord
   * case where two antipodal ideal endpoints don't determine a unique
   * line — `anchor` supplies a finite point on the chord line). Same
   * three cases recur:
   *
   *  - one or both endpoints finite, OR both ideal but non-antipodal:
   *    `HomLine.through(origin, target)` — endpoints determine the line.
   *  - both endpoints ideal antipodal AND `anchor !== null`: chord;
   *    line passes through the anchor finite point in the origin's
   *    ideal direction.
   *  - both endpoints ideal antipodal AND `anchor === null`: arc on the
   *    line at infinity.
   *
   * Substrate operations that need the side's line geometry (parameter
   * of a point along the side, line tangent direction, line-on-line
   * intersections) call `side.line` uniformly — there is no kind switch
   * at the operation layer.
   */
  get line(): HomLine {
    if (this.a.isIdeal && this.next.a.isIdeal && this.anchor !== null) {
      // Chord case: ideal endpoints don't pin down which parallel line;
      // the anchor finite point + origin's ideal direction does.
      return HomLine.withDirection(
        HomPoint.finite(this.anchor.x, this.anchor.y),
        { x: this.a.x, y: this.a.y },
      );
    }
    return HomLine.through(this.a, this.next.a);
  }

  /**
   * Single-discriminator classification of this side's geometric kind:
   *
   *   - `'segment'` — both endpoints finite. Straight line segment in R².
   *   - `'ray'`     — origin finite, target ideal. Half-line from origin
   *                   in the target's direction.
   *   - `'antiRay'` — origin ideal, target finite. Half-line ending at the
   *                   target, coming from the origin's direction.
   *   - `'chord'`   — both endpoints ideal AND `anchor !== null`. A real
   *                   line through R² whose two limit directions are
   *                   antipodal; `anchor` pins the line's perpendicular
   *                   offset.
   *   - `'arc'`     — both endpoints ideal AND `anchor === null`. A piece
   *                   of S¹ on the boundary of an unbounded face.
   *
   * Used for diagnostic messages and for the few sites where chord-vs-arc
   * disambiguation is genuinely needed (e.g. arc subdivision uses an
   * angular sweep rather than a parametric position). Most operations
   * use {@link line} directly and branch on its `isAtInfinity` property
   * rather than dispatching on `kind`.
   */
  get kind(): 'segment' | 'ray' | 'antiRay' | 'chord' | 'arc' {
    if (this.a.isFinite && this.next.a.isFinite) return 'segment';
    if (this.a.isFinite && this.next.a.isIdeal) return 'ray';
    if (this.a.isIdeal && this.next.a.isFinite) return 'antiRay';
    return this.anchor === null ? 'arc' : 'chord';
  }
}

// ----------------------------------------------------------------------------
// Stitch — reciprocal binding between two sides
// ----------------------------------------------------------------------------

/**
 * A reciprocal binding between two half-edges with an implicit transform.
 *
 * `Stitch` is a thin handle that names a bidirectional twin pair as a single
 * first-class object. Both `a` and `b` hold a back-reference to the same
 * `Stitch` via their `.stitch` field; reciprocity is structural — there is
 * no way to construct a `Stitch` whose endpoints disagree.
 *
 * The transform `(a.face frame → b.face frame)` lives on `a.transform` (and
 * its inverse on `b.transform`); `Stitch.transform` is a getter that reads
 * from `a` so there is no synchronization burden between Stitch and HE state.
 *
 * Stitches are allocated by the only symmetric edge-binding primitive,
 * {@link stitch}, and by the internal split / subdivision primitives that
 * produce reciprocal pairs (chord pairs from {@link splitFaceAtVertices},
 * subdivided pairs from {@link subdivideSide}, strip-to-chord pairs from
 * {@link insertStrip}). There is no asymmetric edge-twin counterpart in the
 * substrate — closed/wrapped regions placed inside a host go through
 * {@link link} at the face level instead.
 *
 * The set of all stitches in an atlas is derived on demand via the
 * {@link Atlas.stitches} getter; it is not persisted state, so there is no
 * separate atlas-level bookkeeping to keep in sync.
 */
export class Stitch {
  a: Side;
  b: Side;
  /**
   * Atlas back-reference. Set by {@link setTwin} (the only place
   * `Stitch` instances are constructed); used by {@link setTransforms}
   * and {@link unstitch} to mark Link transforms dirty without callers
   * having to thread `atlas` through.
   */
  readonly atlas: Atlas;
  /**
   * Transform `a.face` → `b.face` and its inverse. Held privately so the
   * only mutation path is {@link setTransforms}, which routes through
   * `atlas.markLinksDirty()`. See {@link recomputeLinkTransformsFromStitchChain}
   * for why every transform mutation has to invalidate cached Link composites.
   */
  #transformAtoB: M.Matrix2D;
  #transformBtoA: M.Matrix2D;

  constructor(atlas: Atlas, a: Side, b: Side, transformAtoB: M.Matrix2D, transformBtoA: M.Matrix2D) {
    this.atlas = atlas;
    this.a = a;
    this.b = b;
    this.#transformAtoB = transformAtoB;
    this.#transformBtoA = transformBtoA;
  }

  /** Transform mapping `a.face` frame → `b.face` frame. */
  get transformAtoB(): M.Matrix2DReadonly {
    return this.#transformAtoB;
  }

  /** Transform mapping `b.face` frame → `a.face` frame (= `inv(transformAtoB)`). */
  get transformBtoA(): M.Matrix2DReadonly {
    return this.#transformBtoA;
  }

  /** Transform mapping `a.face` frame → `b.face` frame. */
  get transform(): M.Matrix2DReadonly {
    return this.#transformAtoB;
  }

  /**
   * Replace this stitch's transforms in place and notify the atlas that
   * cached Link composites need re-derivation.
   *
   * This is the *only* mutation entry point for stitch transforms. The
   * `transformAtoB` / `transformBtoA` getters are read-only on purpose:
   * any mutation that bypasses this method would leave Link transforms
   * stale (the bug class that motivated this design — see
   * {@link recomputeLinkTransformsFromStitchChain}'s docstring).
   *
   * If many stitches will be mutated in a single logical step (e.g. the
   * conjugation loop in {@link splitFaceAtVertices}, the strip wiring
   * loop in {@link insertStrip}), wrap the work in {@link Atlas.mutate}
   * so the dirty marks coalesce into a single recompute at the end.
   */
  setTransforms(transformAtoB: M.Matrix2D, transformBtoA: M.Matrix2D): void {
    this.#transformAtoB = transformAtoB;
    this.#transformBtoA = transformBtoA;
    this.atlas.markLinksDirty();
  }

  /** Given one of the stitch's endpoints, return the other. */
  other(self: Side): Side {
    if (self === this.a) return this.b;
    if (self === this.b) return this.a;
    throw new Error('Stitch.other: argument is not an endpoint of this stitch');
  }

  /** Transform mapping `self.face` frame → the other endpoint's frame. */
  transformFrom(self: Side): M.Matrix2DReadonly {
    if (self === this.a) return this.#transformAtoB;
    if (self === this.b) return this.#transformBtoA;
    throw new Error('Stitch.transformFrom: argument is not an endpoint of this stitch');
  }
}

// ----------------------------------------------------------------------------
// Link — directed face → face binding
// ----------------------------------------------------------------------------

/**
 * A directed binding from one face to another, with a transform placing the
 * `to` face's outline inside the `from` face's frame.
 *
 * Where `Stitch` is the symmetric edge-level binding (used to glue two
 * face-local boundary segments into one logical seam), `Link` is the
 * face-level binding used to express:
 *
 *  - **Recursive structures**: a face linked to itself with a similarity
 *    transform tiles depth-bounded copies of itself (`recursive zoom`).
 *  - **Hypertext-like multigraphs**: many parents pointing at one child face,
 *    each with its own placement transform.
 *  - **Embedding closed/wrapped regions**: a face whose interior edges are
 *    fully self-stitched (a closed surface) can be placed inside a host
 *    face by a single Link. From outside, the host renders the wrapped
 *    region at the link's placement; from inside, the region's stitches
 *    loop forever and there is no automatic exit. Today's "asymmetric edge
 *    twin" pattern in `folk-atlas.ts`'s region-wrap toggle is morally a
 *    poorly-typed instance of this — see `step-4.md` Phase 2.
 *
 * The transform's direction is `to → from`: a `to`-local point `p` is
 * placed at parent-frame coordinates `transform · p` inside `from`. This
 * matches `substrate.md`'s natural reading "places the child inside the
 * parent at transform T" and means a child's composite is `composite[from]
 * · link.transform`.
 *
 * Multiplicity:
 *  - Many parents may target the same `to` face (the same child rendered
 *    in many places).
 *  - A face may have multiple outgoing links (to the same or different
 *    children).
 *  - A face linked to itself (`from === to`) is a self-link, used for
 *    recursive zoom.
 *
 * Return-path policy is per-walker. {@link Atlas.computeImages} (the BFS
 * renderer) follows links forward but does not synthesise a return — once
 * a walker enters a child via Link, the only way back out is through some
 * other binding the child has, OR by terminating the walk. The renderer's
 * cap on images-per-face plus self-loop suppression for non-root faces
 * preserves the same surface behaviour today's asymmetric-twin pattern
 * delivered for the wrap-region case.
 */
export class Link {
  from: Face;
  to: Face;
  transform: M.Matrix2D;
  /**
   * If true, the substrate auto-recomputes `transform` from the
   * stitch-chain BFS composite `from → to` after every mutation that
   * could shift the chain (see {@link recomputeLinkTransformsFromStitchChain}).
   * Set automatically by {@link link} based on whether the caller-supplied
   * `transform` matches the chain composite at link-creation time:
   *
   *  - **`true` when `transform === chainComposite(from, to)`**: the link
   *    is a *cached chain composite* (e.g. cylinder/wrap links — the
   *    pattern that originally bit us by going stale after cuts). The
   *    substrate keeps it in sync automatically.
   *  - **`false` otherwise** (transforms supplied independently of the
   *    chain, including the closed-surface case where BFS returns `null`,
   *    recursive zoom self-links, and "place B inside A here regardless
   *    of the underlying stitches" manual placements). The substrate
   *    treats `transform` as opaque and never overwrites it.
   *
   * Callers can flip this after creation if their use case requires it,
   * but the auto-detection covers every current use site.
   */
  tracksStitchChain: boolean;

  constructor(from: Face, to: Face, transform: M.Matrix2D, tracksStitchChain: boolean) {
    this.from = from;
    this.to = to;
    this.transform = transform;
    this.tracksStitchChain = tracksStitchChain;
  }
}

// ----------------------------------------------------------------------------
// Face
// ----------------------------------------------------------------------------

/**
 * A convex polygonal face with one outer (CCW) boundary loop and zero or more
 * inner (CW) boundary loops.
 *
 * **Outer loop.** `sides` holds the k ≥ 3 CCW-ordered half-edges of the
 * outer boundary. There is no special "anchor" half-edge: any vertex (finite
 * or ideal) may sit at `sides[0]`, and the face's local coordinates can
 * be chosen freely. Convexity (every interior angle < π) is a model-level
 * invariant checked by {@link validateAtlas}.
 *
 * Faces with no finite vertex (every `sides[i].origin` is ideal) are
 * legal — they represent unbounded regions that cover an arc of the line at
 * infinity. The simplest example is a single all-ideal face whose boundary
 * is k ideal directions spanning S¹ in CCW order, which is the empty-scene
 * seed that replaces the four-wedge collapse.
 *
 * **Inner loops.** `innerLoops` holds zero or more CW cycles of half-edges,
 * each describing an inner boundary ("hole") inside the outer one. Inner-loop
 * half-edges have their `face` set to this face and are wired into a CW
 * cycle via `next`/`prev`. They may be untwinned (a free hole) or twinned to
 * half-edges in another face. Inner loops do NOT have to be convex; they
 * just have to be simple, CW, and lie inside the outer polygon.
 *
 * **Frame.** `frame` is an explicit affine transform that says where this
 * face's face-local coordinates sit in some external reference. It is
 * consulted as the seed of {@link Atlas.computeComposites} when this face is
 * the atlas root: `composite(root) := root.frame`. Inter-face composites
 * still propagate via `inv(he.transform)`, so for non-root faces `frame` is
 * carried but not consulted directly — it becomes meaningful when the face
 * becomes the root (via {@link Atlas.switchRoot}). Defaults to identity, so
 * a face with `frame = identity` behaves exactly as it did before frames
 * existed.
 *
 * Sub-faces produced by {@link splitFaceAtVertices} inherit their parent's
 * `frame` but **re-anchor** their boundary: each sub-face's finite vertices
 * are translated so that the centroid of those finite vertices sits at
 * face-local `(0, 0)`. Twin transforms across the new chord are pure
 * translations encoding the offset diff between the two sub-faces, and
 * external twins absorb the offset by composition. This keeps stored
 * vertex magnitudes bounded by the sub-face's own intrinsic size so that
 * deeply-nested rescales don't accumulate float error in storage — the
 * depth-locality invariant.
 */
export class Face {
  /**
   * The outer boundary loop, CCW. Always present, k ≥ 2. The k=2 case is
   * a "digon" face — a slab bounded by two parallel chord half-edges; both
   * boundary HEs must be chords with antipodal ideal endpoints (validated
   * in {@link validateAtlas}).
   */
  sides: Side[];
  /** Inner boundary loops, each CW, each with k ≥ 3. Empty if the face has no holes. */
  innerLoops: Side[][];
  /**
   * Affine map: face-local coordinates → reference frame in which this face
   * is "pinned" when it acts as the atlas root. See class docstring.
   */
  frame: M.Matrix2D;
  /** Shapes assigned to this face (managed by the atlas's owner). */
  shapes: Set<Element> = new Set();

  constructor(sides: Side[], innerLoops: Side[][] = [], frame: M.Matrix2D = M.fromValues()) {
    // k=2 is allowed: a "digon" face whose two boundary HEs are both
    // chords (a slab between two parallel lines through R²). Inner loops
    // remain k≥3 (holes don't have a meaningful 2-edge configuration —
    // they're CW finite cycles).
    if (sides.length < 2) {
      throw new Error(`Face needs at least 2 half-edges, got ${sides.length}`);
    }
    // Defensive copy: every mutation primitive (subdivideSide, …) splices
    // `face.sides` in place. If the
    // caller hands us an array that's also referenced from elsewhere
    // (e.g. `atlas.sides`), every splice would silently mutate both
    // — corrupting both arrays. Owning a private copy makes such aliasing
    // impossible from the Face's side, regardless of what the caller does
    // with the original array.
    this.sides = sides.slice();
    const k = this.sides.length;
    for (let i = 0; i < k; i++) {
      const he = this.sides[i];
      he.next = this.sides[(i + 1) % k];
      he.prev = this.sides[(i - 1 + k) % k];
      he.face = this;
    }

    // Same defensive rationale as the outer loop: store our own copy of
    // each inner-loop array so external mutation of the caller's array
    // can't reach into the Face.
    this.innerLoops = innerLoops.map((loop) => loop.slice());
    for (const loop of this.innerLoops) {
      if (loop.length < 3) {
        throw new Error(`Inner loop needs at least 3 half-edges, got ${loop.length}`);
      }
      const m = loop.length;
      for (let i = 0; i < m; i++) {
        const he = loop[i];
        he.next = loop[(i + 1) % m];
        he.prev = loop[(i - 1 + m) % m];
        he.face = this;
      }
    }

    this.frame = frame;
  }

  /** This face's k outer-loop vertex points (origins of its outer half-edges) in CCW order. */
  junctions(): HomPoint[] {
    return this.sides.map((h) => h.origin());
  }

  /**
   * Iterate this face's outer-loop half-edges in CCW order, starting at the
   * anchor. (Inner-loop half-edges are reached via {@link allSides} or
   * by indexing {@link innerLoops}.)
   */
  *sidesCCW(): IterableIterator<Side> {
    let he: Side = this.sides[0];
    do {
      yield he;
      he = he.next;
    } while (he !== this.sides[0]);
  }

  /** Iterate every half-edge of this face, outer loop first then each inner loop. */
  *allSides(): IterableIterator<Side> {
    for (const he of this.sides) yield he;
    for (const loop of this.innerLoops) {
      for (const he of loop) yield he;
    }
  }

  /**
   * Test whether `p` (in this face's local frame) lies inside the face — i.e.
   * inside the outer loop and *not strictly inside* any inner loop. Points
   * exactly on an inner-loop boundary count as inside the face (they lie on
   * the rim of a hole, not inside it).
   *
   * Inner loops are stored CW; the strict-containment test below assumes a
   * CCW polygon, so we reverse each inner loop's vertex order before testing.
   *
   * **Chord half-edges** (ideal-ideal with `anchor !== null`) need an
   * extra half-plane test on top of `polygonContains`: that predicate treats
   * any ideal-ideal edge as "the line at infinity, no constraint on finite
   * points", which is correct for at-infinity arcs but wrong for chords —
   * a chord is a real line through R² and excludes one half-plane. We add
   * an explicit cross-product test against the chord line for each chord HE.
   */
  contains(p: Point): boolean {
    const hp = HomPoint.finite(p.x, p.y);
    if (!polygonContains(this.junctions(), hp)) return false;
    for (const he of this.sides) {
      if (he.kind !== 'chord') continue;
      const a = he.origin();
      const b = he.target();
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ax = he.anchor!;
      const c = dx * (p.y - ax.y) - dy * (p.x - ax.x);
      if (c < 0) return false;
    }
    for (const loop of this.innerLoops) {
      const verts = loop.map((h) => h.origin()).reverse();
      if (polygonContainsStrict(verts, hp)) return false;
    }
    return true;
  }
}

// ----------------------------------------------------------------------------
// Junction-walking iterators (the "vertex identity" recovery)
// ----------------------------------------------------------------------------

/**
 * Walk all half-edges that originate at the same physical junction as `he`'s
 * origin, including `he` itself. Walks both forward and backward through
 * twin/next so that boundary junctions (where forward walks hit a null twin)
 * are still fully enumerated.
 */
export function* aroundJunction(he: Side): IterableIterator<Side> {
  // Forward: cur, cur.twin?.next, cur.twin?.next.twin?.next, ...
  // Stops at null twin or when the cycle closes back to `he`.
  const seen = new Set<Side>();
  let cur: Side | null = he;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    const t: Side | null = cur.twin;
    cur = t ? t.next : null;
  }
  if (cur === he) return; // closed cycle
  // Backward from `he`: he.prev.twin, then keep stepping prev.twin.
  // (Uses the explicit `prev` pointer wired by Face's constructor; works
  // uniformly for any k-gon face.)
  cur = he.prev.twin;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    cur = cur.prev.twin;
  }
}

// ----------------------------------------------------------------------------
// Geometry primitives
// ----------------------------------------------------------------------------
//
// All atlas computation lives on top of a small set of geometry primitives
// that work uniformly on `Junction`s — i.e. on the affine plane R² extended
// with a directional "line at infinity" (each ideal junction is a unit
// direction; antipodes are distinct points). The pure-geometry layer lives
// in `./atlas/geometry/`:
//
//   - low-level (`./atlas/geometry/point.ts`): `cross`, `applyLinearToDirection`
//   - junctions (`./atlas/geometry/junction.ts`): `Junction`,
//     `sameIdealDirection`
//   - line predicates (`./atlas/geometry/line.ts`):
//     `leftOfDirectedEdge[Strict]`, `parameterOnSegment`
//   - convex polygons (`./atlas/geometry/polygon.ts`):
//     `polygonContains[Strict]`, `isPolygonCCW`
//
// Atlas-aware geometry — parameterisation and traversal of `Side`s —
// stays here, defined further down near `walkLine`:
//   - `pointOnSideAtU`, `uOfPointOnSide`, `intersectLineWithSide`, `findExit`
//   - line traversal: `walkLine` (returns a chain of `FaceCrossing`s)
//
// The mutation primitives further down (`subdivideSide`,
// `splitFaceAtVertices`, `splitFaceAlongChord`, …) all consume these.

// ----------------------------------------------------------------------------
// Atlas
// ----------------------------------------------------------------------------

/**
 * A single rendered "image" of a face in the root frame. For tree atlases
 * there is exactly one image per reachable face; for atlases with loops a face
 * may have many images (each at a different composite — these are the
 * "ghosts" rendered around the canvas).
 */
export interface AtlasImage {
  face: Face;
  /** Face-local → root-local for this particular walk. */
  composite: M.Matrix2D;
  /** BFS depth from the root (root itself is depth 0). */
  depth: number;
}

/** Options for {@link Atlas.computeImages}. */
export interface ComputeImagesOptions {
  /** Hard cap on BFS depth (default 8). */
  maxDepth?: number;
  /** Hard cap on images per face (default 16). */
  maxImagesPerFace?: number;
  /**
   * Optional predicate. Returning `false` records the image but skips
   * enqueuing its neighbours — the hook for visibility-based pruning.
   */
  shouldExpand?: (image: AtlasImage) => boolean;
  /**
   * When true (default), images that land at the same (face, composite) via
   * different walks are merged: only the first BFS occurrence is recorded.
   * This is correct behaviour for a closed loop (a genuine torus has each
   * face appearing exactly once per geometric copy), and avoids drawing the
   * same ghost on top of itself when the cycle math closes.
   *
   * Set to false for diagnostic / structural traversal where you want to see
   * every walk independently.
   */
  dedupeImages?: boolean;
  /**
   * Quantization step for the composite-equality check used by `dedupeImages`.
   * Two composites whose entries all round to the same `quantum` multiple are
   * considered the same image. Default 1e-6, generous enough to absorb the
   * floating-point drift accumulated by short BFS walks.
   */
  dedupeQuantum?: number;
}

/**
 * The atlas: a collection of faces glued by half-edge twin pointers and
 * transforms, plus a chosen `root` face from which composite transforms are
 * computed at render time.
 *
 * Composite transforms (face-local → root-local) are derived per call and
 * never persisted; only canonical edge transforms and per-half-edge origin
 * data are stored. This is the contract that lets us never accumulate
 * floating-point drift.
 */
export class Atlas {
  sides: Side[] = [];
  faces: Face[] = [];
  /**
   * Directed face → face bindings ({@link Link}). Persisted explicitly
   * because Links don't have a natural per-face back-reference holder
   * (a child face may be the target of many Links from many parents),
   * unlike {@link stitches} which is derivable from edge-level back-refs.
   */
  links: Set<Link> = new Set();
  root: Face;

  /**
   * Reentrant batching depth for {@link mutate}. While positive,
   * {@link markLinksDirty} only sets {@link #linksDirty} instead of
   * recomputing eagerly; the outermost {@link mutate} call commits the
   * accumulated dirty mark with one Link recompute pass.
   */
  #mutationDepth = 0;
  #linksDirty = false;

  constructor(root: Face) {
    this.root = root;
  }

  /**
   * Notify the atlas that some stitch transform changed and that cached
   * {@link Link} composites need to be re-derived from the post-mutation
   * stitch chain. Called automatically by {@link Stitch.setTransforms},
   * {@link setTwin}, and {@link unstitch} — *every* substrate operation
   * that touches a stitch's reciprocal binding routes through here, so
   * forgetting to invalidate is structurally impossible.
   *
   * Behaviour depends on whether the call is inside a {@link mutate}
   * batch:
   *  - **Outside** a batch (`#mutationDepth === 0`): runs the recompute
   *    immediately. The caller can rely on Link transforms being current
   *    before any subsequent read.
   *  - **Inside** a batch (`#mutationDepth > 0`): just sets
   *    {@link #linksDirty}. The outermost {@link mutate} call commits
   *    the dirty mark with one recompute pass, regardless of how many
   *    stitch mutations the batch performed.
   */
  markLinksDirty(): void {
    if (this.#mutationDepth > 0) {
      this.#linksDirty = true;
      return;
    }
    recomputeLinkTransformsFromStitchChain(this);
  }

  /**
   * Run `fn` as a single logical atlas mutation, batching dirty marks
   * from any stitch operations inside so the substrate only re-derives
   * Link transforms once at the end. Nesting is supported (only the
   * outermost call commits) — this lets a high-level macro like
   * {@link splitAlongLine} wrap an entire chain-cut without each
   * inner {@link splitFaceAtVertices} triggering its own recompute.
   *
   * Why this is the substrate's mutation discipline: every macro that
   * touches stitches must wrap its work in `mutate`, both for
   * efficiency (one BFS instead of N) and to make the "cache must be
   * invalidated after structural mutation" contract impossible to
   * silently violate. Direct stitch transform writes are blocked by
   * {@link Stitch} private fields; the only paths that reach the atlas
   * are {@link Stitch.setTransforms}, {@link setTwin}, and
   * {@link unstitch}, all of which fire {@link markLinksDirty}.
   */
  mutate<T>(fn: () => T): T {
    this.#mutationDepth++;
    try {
      return fn();
    } finally {
      this.#mutationDepth--;
      if (this.#mutationDepth === 0 && this.#linksDirty) {
        this.#linksDirty = false;
        recomputeLinkTransformsFromStitchChain(this);
      }
    }
  }

  /**
   * Every reciprocal-binding {@link Stitch} reachable in this atlas, derived
   * on demand from the half-edges' `.stitch` back-references.
   *
   * Not persisted state — the set is rebuilt each call. For atlas sizes that
   * fit on a screen this is cheap (one pass over `sides` with a Set
   * de-dup). Callers that need to iterate stitches many times in a frame
   * should cache the result.
   */
  get stitches(): Set<Stitch> {
    const set = new Set<Stitch>();
    for (const he of this.sides) {
      if (he.stitch) set.add(he.stitch);
    }
    return set;
  }

  /**
   * Outgoing {@link Link}s from `face`. Linear scan over `atlas.links`;
   * cheap for the small link counts typical schemes use, but callers in
   * hot paths should cache.
   */
  outgoingLinks(face: Face): Link[] {
    const out: Link[] = [];
    for (const link of this.links) {
      if (link.from === face) out.push(link);
    }
    return out;
  }

  /**
   * BFS from `root`, computing the composite transform (face-local →
   * "root reference frame") for every reachable face.
   *
   * The root face is seeded with `root.frame` (its explicit
   * face-local-to-reference matrix), so `composite(root) = root.frame`. For
   * the default `root.frame = identity`, this matches the simpler "composite
   * is face-local → root-local" interpretation used throughout the rest of
   * the codebase.
   *
   * Convention: `he.transform` maps `he.face local → he.twin.face local`. So
   * the change-of-frame from neighbour B back to the known face A is
   * `inv(he.transform)`, and `M_B = M_A * inv(he.transform)`.
   *
   * (We use `inv(he.transform)` rather than `he.twin.transform` because
   * `he.twin.transform` is only equal to the inverse for reciprocal twin
   * pairs. Asymmetric twins — used for wrapping — break that equality.)
   */
  computeComposites(): Map<Face, M.Matrix2D> {
    const out = new Map<Face, M.Matrix2D>();
    out.set(this.root, this.root.frame);
    const queue: Face[] = [this.root];
    while (queue.length > 0) {
      const f = queue.shift()!;
      const mf = out.get(f)!;
      for (const he of f.sidesCCW()) {
        const twin = he.twin;
        if (twin && !out.has(twin.face)) {
          out.set(twin.face, M.multiply(mf, M.invert(he.transform)));
          queue.push(twin.face);
        }
      }
    }
    return out;
  }

  /**
   * BFS from `root`, enumerating every reachable *image* of every face in the
   * root frame. Unlike {@link computeComposites}, faces may appear multiple
   * times — once per distinct walk that reaches them. This is what enables
   * rendering of looping / wrapped / recursive topologies, where a single face
   * can be visible at multiple screen locations as a "ghost" copy.
   *
   * For tree-shaped atlases (the common case today), each face is reached
   * exactly once and the first image of each face has the same composite as
   * `computeComposites().get(face)`.
   *
   * Tiling is asymmetric by design: only the *root face* is allowed to appear
   * at multiple composites (its wrap loops tile the canvas). Every *other*
   * face is capped at one image, no matter how many distinct BFS walks reach
   * it. This is what makes "from inside a wrapped region, the rest of the
   * world looks like a single canonical layout, with the wrapped region
   * repeating around it" — without it, every wrap-tile of the root would
   * fan out into the outside, producing a sea of ghost copies of normal
   * (non-wrapped) faces. From an outside root the wrapped face still appears
   * exactly once: its self-loops are hidden because the viewer isn't inside
   * the wrap.
   *
   * Traversal is bounded so loops cannot blow up:
   *  - `maxDepth`           — hard cap on BFS depth from root.
   *  - `maxImagesPerFace`   — hard cap on number of images per face. Only
   *                           the root face actually uses the full cap;
   *                           non-root faces are pinned at 1.
   *  - `shouldExpand(img)`  — optional predicate; if it returns false we still
   *                           record the image but do not enqueue its
   *                           neighbours. This is the hook for visibility-based
   *                           pruning (drop ghosts whose face is too small or
   *                           too far off-screen).
   *
   * Images are returned in BFS order — the first image of each face is the
   * shortest-path one, so callers wanting "the canonical composite for shape
   * placement" can take the first occurrence.
   */
  computeImages(opts: ComputeImagesOptions = {}): AtlasImage[] {
    const maxDepth = opts.maxDepth ?? 8;
    const maxImagesPerFace = opts.maxImagesPerFace ?? 16;
    const shouldExpand = opts.shouldExpand;
    const dedupeImages = opts.dedupeImages ?? true;
    const quantum = opts.dedupeQuantum ?? 1e-6;
    const invQ = 1 / quantum;

    const out: AtlasImage[] = [];
    const counts = new Map<Face, number>();
    const seenKeys = dedupeImages ? new Map<Face, Set<string>>() : null;

    const keyOf = (m: M.Matrix2D): string =>
      `${Math.round(m.a * invQ)}_${Math.round(m.b * invQ)}_${Math.round(m.c * invQ)}_${Math.round(m.d * invQ)}_${Math.round(m.e * invQ)}_${Math.round(m.f * invQ)}`;

    // Asymmetric image cap: root tiles freely, everything else is single.
    const capOf = (f: Face) => (f === this.root ? maxImagesPerFace : 1);

    // Track whether either of our hard limits ever rejected a would-be
    // image. Healthy renders should never trip these — `shouldExpand` (the
    // visibility-based pruner) is supposed to bound the BFS first. If we
    // hit a limit, surface it as a warning so the bug shows up instead of
    // silently producing the wrong picture.
    let hitDepthLimit = false;
    let hitImagesLimit = false;

    const queue: AtlasImage[] = [{ face: this.root, composite: this.root.frame, depth: 0 }];
    let head = 0;
    while (head < queue.length) {
      const img = queue[head++];
      const c = counts.get(img.face) ?? 0;
      if (c >= capOf(img.face)) {
        // Only count this as an "unwanted" cap-hit when something legitimately
        // wanted to be drawn here; root cap >1 is the case where overflow
        // matters (off-screen tiles past the visible window). Non-root faces
        // are intentionally pinned to 1, so re-rejection is normal.
        if (capOf(img.face) > 1) hitImagesLimit = true;
        continue;
      }

      if (seenKeys) {
        let set = seenKeys.get(img.face);
        if (!set) {
          set = new Set();
          seenKeys.set(img.face, set);
        }
        const k = keyOf(img.composite);
        if (set.has(k)) continue;
        set.add(k);
      }

      counts.set(img.face, c + 1);
      out.push(img);

      if (img.depth >= maxDepth) {
        hitDepthLimit = true;
        continue;
      }
      if (shouldExpand && !shouldExpand(img)) continue;

      for (const he of img.face.sidesCCW()) {
        const twin = he.twin;
        if (!twin) continue;
        if ((counts.get(twin.face) ?? 0) >= capOf(twin.face)) {
          if (capOf(twin.face) > 1) hitImagesLimit = true;
          continue;
        }
        // Wrap self-loop suppression: an edge whose twin lives in the
        // *same* face is a wrap loop (e.g. a region's right edge twinned
        // to its own left edge). We only follow such loops when the BFS
        // root is the wrapped face itself — that's "the viewer is inside
        // the wrapped region", in which case we want the cylinder/torus
        // to repeat outwards. From outside the wrapped face the loop is
        // hidden so the region looks like a normal face.
        if (twin.face === img.face && img.face !== this.root) continue;
        // Stepping across `he` into the neighbour: the neighbour's frame
        // expressed in the current frame is `inv(he.transform)`.
        // (Equivalently: `he.twin.transform` — they're inverses by Stitch's
        // structural reciprocity, so either is correct.)
        queue.push({
          face: twin.face,
          composite: M.multiply(img.composite, M.invert(he.transform)),
          depth: img.depth + 1,
        });
      }

      // Outgoing {@link Link} expansion. Same cap / self-loop semantics
      // as twin-based wraps: a self-link (link.from === link.to) only
      // tiles when the linked face is the BFS root, matching today's
      // wrap-region behaviour. The link's transform maps
      // `link.to`-local coordinates into `link.from`-local coordinates,
      // so the child's composite is `parent.composite · link.transform`.
      for (const link of this.links) {
        if (link.from !== img.face) continue;
        if ((counts.get(link.to) ?? 0) >= capOf(link.to)) {
          if (capOf(link.to) > 1) hitImagesLimit = true;
          continue;
        }
        if (link.to === img.face && img.face !== this.root) continue;
        queue.push({
          face: link.to,
          composite: M.multiply(img.composite, link.transform),
          depth: img.depth + 1,
        });
      }
    }

    // Only the renderer (which passes `shouldExpand` to bound BFS by
    // visibility) treats these caps as an emergency hatch — for that
    // caller, hitting a cap means visibility-based pruning failed and
    // the picture is wrong. Tests and other callers that use the caps
    // as the *primary* bound (no `shouldExpand`) shouldn't be warned.
    if (shouldExpand) {
      if (hitDepthLimit) {
        console.error(
          `[atlas.computeImages] hit maxDepth=${maxDepth} — emergency hatch tripped. ` +
            `BFS should normally be bounded by shouldExpand (visibility); reaching the ` +
            `depth cap means a tighter cull is missing.`,
        );
      }
      if (hitImagesLimit) {
        console.error(
          `[atlas.computeImages] hit maxImagesPerFace=${maxImagesPerFace} on the root face — ` +
            `emergency hatch tripped. BFS should normally be bounded by shouldExpand ` +
            `(visibility-based culling); reaching the per-face cap means a tighter cull is ` +
            `missing.`,
        );
      }
    }

    return out;
  }

  /**
   * Find the face containing `rootLocalPoint`. Walks all faces (brute force
   * for now), expressing the query in each face's local frame via the inverse
   * composite. Returns `null` if no face contains the point (shouldn't happen
   * for a well-formed atlas covering the plane).
   */
  locate(rootLocalPoint: Point): Face | null {
    const composites = this.computeComposites();
    for (const [face, mf] of composites) {
      const local = M.applyToPoint(M.invert(mf), rootLocalPoint);
      if (face.contains(local)) return face;
    }
    return null;
  }

  /**
   * Re-anchor the atlas so that `newRoot` is the root face.
   *
   * Returns the change-of-view matrix `C` such that callers who maintain a
   * view transform on top of composites can right-multiply their view by `C`
   * to keep all on-screen positions invariant under the swap:
   *
   *     view_old · composite_old(X) = (view_old · C) · composite_new(X)
   *
   * for every face X reachable from both roots. With explicit per-face
   * frames `composite(root) = root.frame`, this works out to:
   *
   *     C = composite_old(newRoot) · inv(newRoot.frame)
   *
   * which collapses to the simpler `C = composite_old(newRoot)` when all
   * frames are identity.
   *
   * Returns identity if `newRoot` is already the root, or if it isn't
   * reachable from the current root (defensive — should not happen).
   */
  switchRoot(newRoot: Face): M.Matrix2D {
    if (newRoot === this.root) return M.fromValues();
    const composites = this.computeComposites();
    const oldComposite = composites.get(newRoot);
    if (!oldComposite) return M.fromValues();
    this.root = newRoot;
    return M.multiply(oldComposite, M.invert(newRoot.frame));
  }
}

// ----------------------------------------------------------------------------
// Empty-canvas seed
// ----------------------------------------------------------------------------

/**
 * Construct the simplest non-trivial atlas: `idealDirections.length`
 * triangular wedges meeting at the origin, with one ideal direction at each
 * boundary spoke.
 *
 * `idealDirections` must be CCW-ordered (each direction is to the
 * counter-clockwise side of the previous one) and span all of S¹ — the wedges
 * are formed between consecutive directions. Defaults to the four cardinal
 * directions, producing 4 quadrant faces.
 */
export function createInitialAtlas(
  idealDirections: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ],
): Atlas {
  const n = idealDirections.length;
  if (n < 3) throw new Error('createInitialAtlas needs at least 3 ideal directions');

  const faces: Face[] = [];
  const allSides: Side[] = [];

  // For each adjacent pair (a, b) in idealDirections, create a wedge face
  // with origin O = (0, 0), then ideal directions a, b in CCW order.
  for (let i = 0; i < n; i++) {
    const [ax, ay] = idealDirections[i];
    const [bx, by] = idealDirections[(i + 1) % n];
    const he0 = new Side(HomPoint.finite(0, 0)); // O → A
    const he1 = new Side(HomPoint.idealDir(ax, ay)); // A → B (at infinity)
    const he2 = new Side(HomPoint.idealDir(bx, by)); // B → O
    const f = new Face([he0, he1, he2]);
    faces.push(f);
    allSides.push(he0, he1, he2);
  }

  // Construct the atlas first so we can pass it to setTwin (which needs
  // it for the Stitch back-reference and links-dirty notification).
  const atlas = new Atlas(faces[0]);
  atlas.sides = allSides;
  atlas.faces = faces;

  // Stitch the half-axes shared between consecutive wedges (identity
  // transforms — wedges all share the same origin and CCW frame).
  // Wedge i's "B → O" side (sides[2]) stitches to wedge (i+1)%n's "O → A"
  // side (sides[0]); both lie along the same physical half-axis.
  for (let i = 0; i < n; i++) {
    const me = faces[i];
    const next = faces[(i + 1) % n];
    setTwin(atlas, me.sides[2], next.sides[0], M.fromValues(), M.fromValues());
  }

  // The ideal-ideal half-edges within each face (he[1]) lie at infinity and
  // have no twin — already null by default.

  return atlas;
}

/**
 * Construct the simplest possible non-empty atlas: a single convex face
 * whose entire boundary lies on the line at infinity.
 *
 * `idealDirections` are the face's vertices in CCW order (each direction is
 * a unit vector) and together cover S¹ with no gaps. There are no finite
 * vertices, so the face has no "anchor at the origin"; coordinates inside
 * the face are simply face-local R². This is the four-wedge collapse: the
 * empty scene as one face rather than k wedges meeting at a sentinel
 * origin. Defaults to the four cardinal directions (same axes as the wedge
 * seed, but with a single face instead of four).
 */
export function createAllIdealAtlas(
  idealDirections: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ],
): Atlas {
  const n = idealDirections.length;
  if (n < 3) throw new Error('createAllIdealAtlas needs at least 3 ideal directions');
  const hes = idealDirections.map(([x, y]) => new Side(HomPoint.idealDir(x, y)));
  const face = new Face(hes);
  const atlas = new Atlas(face);
  // Critical: `atlas.sides` must NOT alias `face.sides`. The Face
  // constructor stores its argument array by reference, and atlas-wide
  // mutators (e.g. `subdivideSide`'s `atlas.sides.splice`)
  // would otherwise also splice the face's outer-loop array, doubling the
  // mutation and corrupting the face's HE list. Take a fresh copy here.
  atlas.sides = [...hes];
  atlas.faces = [face];
  return atlas;
}

// ----------------------------------------------------------------------------
// stitch / unstitch — symmetric edge-binding primitives
// ----------------------------------------------------------------------------

/**
 * Compute the translation that stitches `heA` to `heB` under the standard
 * convention `T · heA.next.origin = heB.origin` and `T · heA.origin =
 * heB.next.origin`.
 *
 * For a translation to satisfy both equations the two edges must be
 * anti-parallel as oriented vectors of the same length — geometrically, the
 * left and right sides of a strip, or two opposite edges of a parallelogram.
 *
 * Throws if the geometry is incompatible with a pure translation, or if
 * either side has an ideal endpoint.
 */
export function translationToWrap(heA: Side, heB: Side, eps = 1e-6): M.Matrix2D {
  if (!heA.a.isFinite || !heA.next.a.isFinite) {
    throw new Error('translationToWrap: heA must have two finite endpoints');
  }
  if (!heB.a.isFinite || !heB.next.a.isFinite) {
    throw new Error('translationToWrap: heB must have two finite endpoints');
  }
  // T(p) = p + t; from T·heA.next.origin = heB.origin we get
  //   t = heB.origin - heA.next.origin
  // From T·heA.origin = heB.next.origin we get
  //   t = heB.next.origin - heA.origin
  // The two must agree.
  const tx1 = heB.a.x - heA.next.a.x;
  const ty1 = heB.a.y - heA.next.a.y;
  const tx2 = heB.next.a.x - heA.a.x;
  const ty2 = heB.next.a.y - heA.a.y;
  if (Math.abs(tx1 - tx2) > eps || Math.abs(ty1 - ty2) > eps) {
    throw new Error(
      `translationToWrap: edges are not translation-compatible (${tx1.toFixed(6)}, ${ty1.toFixed(6)}) vs (${tx2.toFixed(6)}, ${ty2.toFixed(6)})`,
    );
  }
  return M.fromTranslate((tx1 + tx2) / 2, (ty1 + ty2) / 2);
}

/**
 * Reciprocally bind two sides with a transform, returning the resulting
 * {@link Stitch} handle. This is the substrate's only edge-level binding
 * primitive — there is no asymmetric-edge counterpart. (Asymmetric cross-
 * face structures — closed/wrapped regions placed inside a host — go
 * through {@link link} instead, at the face level.)
 *
 * `Stitch.a` is `heA`, `Stitch.b` is `heB`, and `Stitch.transform` is the
 * `a → b` change of frame. Both endpoints get a back-reference to the same
 * `Stitch` via `.stitch`, so reciprocity is structurally guaranteed.
 *
 * Pre-conditions:
 *  - both sides live in `atlas`
 *  - `heA !== heB`
 *  - both are currently untwinned (and unstitched — a side cannot belong
 *    to two stitches)
 *  - both have two finite endpoints (no ideal-arc / chord stitches at the
 *    public API; chord twin pairs are installed internally by the split
 *    primitives)
 *  - `transformAtoB` satisfies the junction-correspondence equations
 *      transformAtoB · heA.next.origin ≈ heB.origin
 *      transformAtoB · heA.origin       ≈ heB.next.origin
 *
 * Effect:
 *  - allocates a new {@link Stitch} `s`; `s.a = heA`, `s.b = heB`
 *  - `heA.twin = heB`; `heB.twin = heA`
 *  - `heA.transform = transformAtoB`; `heB.transform = inv(transformAtoB)`
 *  - `heA.stitch = heB.stitch = s`
 */
export function stitch(atlas: Atlas, heA: Side, heB: Side, transformAtoB: M.Matrix2D, eps = 1e-6): Stitch {
  if (heA === heB) throw new Error('stitch: cannot stitch a side to itself');
  if (!atlas.sides.includes(heA) || !atlas.sides.includes(heB)) {
    throw new Error('stitch: sides must belong to atlas');
  }
  if (heA.twin !== null || heB.twin !== null) {
    throw new Error('stitch: both sides must currently be untwinned');
  }
  if (heA.kind === 'arc' || heB.kind === 'arc') {
    throw new Error('stitch: cannot stitch at-infinity arcs');
  }
  // Reject mixed kinds (one chord and one non-chord) — geometric alignment
  // would require the chord's line-at-infinity behaviour to mesh with a
  // bounded segment, which has no consistent transform.
  if ((heA.kind === 'chord') !== (heB.kind === 'chord')) {
    throw new Error('stitch: cannot stitch a chord to a non-chord side');
  }
  // Chord-chord pairs need anchors on both sides and must be a pure
  // translation (linear part = identity), since chord lines only map to
  // chord lines under translations of R².
  if (heA.kind === 'chord') {
    if (heA.anchor === null || heB.anchor === null) {
      throw new Error('stitch: chord sides must have anchors set');
    }
    if (
      Math.abs(transformAtoB.a - 1) > eps ||
      Math.abs(transformAtoB.d - 1) > eps ||
      Math.abs(transformAtoB.b) > eps ||
      Math.abs(transformAtoB.c) > eps
    ) {
      throw new Error('stitch: chord-chord stitches must be pure translations');
    }
  }
  const transformBtoA = M.invert(transformAtoB);
  // Junction-correspondence: T_AB maps heA's endpoints to heB's endpoints.
  // `junctionImageMatches` handles both finite (point-equality) and ideal
  // (direction-equality after linear-part-only transform) cases.
  if (!junctionImageMatches(transformAtoB, heA.next.origin(), heB.origin(), eps)) {
    throw new Error('stitch: transformAtoB·heA.target does not match heB.origin');
  }
  if (!junctionImageMatches(transformAtoB, heA.origin(), heB.next.origin(), eps)) {
    throw new Error('stitch: transformAtoB·heA.origin does not match heB.target');
  }
  // Chord anchor consistency: the transform must map heA's chord line
  // (anchored at heA.anchor) to heB's chord line (anchored at heB.anchor).
  if (heA.kind === 'chord' && heA.anchor !== null && heB.anchor !== null) {
    const imgAnchor = M.applyToPoint(transformAtoB, heA.anchor);
    if (Math.abs(imgAnchor.x - heB.anchor.x) > eps || Math.abs(imgAnchor.y - heB.anchor.y) > eps) {
      throw new Error(
        `stitch: transformAtoB·heA.anchor = (${imgAnchor.x.toFixed(6)}, ${imgAnchor.y.toFixed(6)}) does not match heB.anchor = (${heB.anchor.x.toFixed(6)}, ${heB.anchor.y.toFixed(6)})`,
      );
    }
  }
  return setTwin(atlas, heA, heB, transformAtoB, transformBtoA);
}

/**
 * Symmetric inverse of {@link stitch}: clear the reciprocal binding and
 * dispose of the {@link Stitch} object. Both endpoints' `.stitch` is
 * reset to `null`; the Stitch becomes unreferenced and gc'd. Marks the
 * stitch's atlas links-dirty so any cached Link composite that walked
 * through this stitch is re-derived before the next read.
 *
 * The atlas-level stitch view ({@link Atlas.stitches}) is derived from
 * the sides' back-references, so there is no separate de-registration.
 */
export function unstitch(s: Stitch): void {
  if (s.a.stitch === s) s.a.stitch = null;
  if (s.b.stitch === s) s.b.stitch = null;
  s.atlas.markLinksDirty();
}

/**
 * Place `to` inside `from`'s frame at `transform`, returning the resulting
 * {@link Link} handle. The directed face → face binding allows recursive
 * structures, hypertext-style multigraphs, and embedded closed/wrapped
 * regions — see {@link Link} for the broader picture.
 *
 * Pre-conditions:
 *  - both faces live in `atlas`
 *
 * Effect:
 *  - allocates a new `Link l = { from, to, transform }`
 *  - adds `l` to `atlas.links`
 *
 * Multiplicity is unrestricted: the same `(from, to)` pair may be linked
 * multiple times with different transforms (rare but legal — e.g. tiling
 * a child at several positions inside one parent), and any face may have
 * many incoming or outgoing links. A self-link (`from === to`) is the
 * substrate-level expression of recursive zoom.
 */
export function link(atlas: Atlas, from: Face, to: Face, transform: M.Matrix2D): Link {
  if (!atlas.faces.includes(from)) throw new Error('link: from face not in atlas');
  if (!atlas.faces.includes(to)) throw new Error('link: to face not in atlas');
  // Auto-detect "this link is a cached chain composite" by comparing the
  // caller-supplied transform to the BFS chain composite at link-creation
  // time. Wrap-on (folk-atlas's `wrapRegionAxis`) sets `transform` to
  // `inv(outer→region stitch)`, which equals the chain composite by
  // Stitch reciprocity, so it gets `tracksStitchChain = true` and the
  // substrate keeps it in sync with subsequent stitch mutations. Manual
  // placements with arbitrary transforms (and self-links / closed-surface
  // links where chain is null) get `tracksStitchChain = false` and are
  // never auto-overwritten. See {@link Link} for the broader rationale.
  let tracksStitchChain = false;
  if (from !== to) {
    const chain = bfsCompositeViaStitchesOnly(atlas, from, to);
    if (chain !== null && M.equals(transform, chain)) {
      tracksStitchChain = true;
    }
  }
  const l = new Link(from, to, transform, tracksStitchChain);
  atlas.links.add(l);
  return l;
}

/**
 * Remove a {@link Link} from the atlas. No-op if the link is already absent.
 */
export function unlink(atlas: Atlas, l: Link): void {
  atlas.links.delete(l);
}

/**
 * Rescale a face's local frame by a uniform positive factor `R` around the
 * face-local origin `(0, 0)`. The face's own stored geometry (every finite
 * half-edge of `face.sides`) is transformed as `p ↦ R·p`, and every twin
 * transform that touches the face's frame is conjugated by `scale(R)` so
 * projected screen positions of the boundary stay invariant.
 *
 * Intended for **scaled regions / nested faces**: a region declares its
 * "interior scale" relative to outside, and updating that declared value
 * runs this primitive with `R = newScale / oldScale`.
 *
 * Sub-faces produced by {@link splitFaceAtVertices} are re-anchored so that
 * the centroid of their finite vertices sits at face-local `(0, 0)` — that
 * makes the face-local origin a meaningful interior point for *every* face
 * the system can produce, so we don't need an explicit pivot argument.
 * Stored vertex magnitudes stay bounded by the face's own intrinsic size,
 * which is what keeps deeply-nested rescales numerically stable
 * (the depth-locality invariant).
 *
 * Cases handled per twin link, with `S = scale(R)`:
 *
 * | `he.face === face` | `he.twin.face === face` | new transform     |
 * | ------------------ | ----------------------- | ----------------- |
 * | yes                | no                      | `T · S⁻¹`         |
 * | no                 | yes                     | `S · T`           |
 * | yes                | yes                     | `S · T · S⁻¹`     |
 * | no                 | no                      | unchanged         |
 *
 * For pure translation twins (the common case for canvas wraps), `S` is a
 * similarity (uniform scale), so the conjugated transform remains a
 * similarity — no rotation introduced.
 *
 * Pre-conditions:
 *   - `R > 0` (a non-positive `R` would flip orientation / collapse the
 *     face).
 *   - `face` belongs to `atlas`.
 *   - All boundary half-edges' finite endpoints stay finite; ideal
 *     endpoints are unaffected (their stored direction is independent
 *     of frame scale, and the twin transform's linear part scales
 *     directions uniformly which cancels under renormalization).
 */
export function rescaleFaceFrame(atlas: Atlas, face: Face, R: number): void {
  if (!Number.isFinite(R) || R <= 0) {
    throw new Error(`rescaleFaceFrame: R must be a positive finite number, got ${R}`);
  }
  if (!atlas.faces.includes(face)) {
    throw new Error('rescaleFaceFrame: face must belong to atlas');
  }
  if (R === 1) return;

  atlas.mutate(() => {
    const S = M.fromValues(R, 0, 0, R, 0, 0);
    const Sinv = M.fromValues(1 / R, 0, 0, 1 / R, 0, 0);
    // `applyAffine` scales finite vertex positions by R; ideal directions
    // get `(R*dx, R*dy, 0)` which `HomPoint.fromHomogeneous` re-normalises
    // to unit length — i.e., ideal directions are scale-invariant under
    // pure scale, so this is correctly a no-op for them.
    for (const he of face.allSides()) {
      he.a = he.a.applyAffine(S);
    }
    // Conjugate every {@link Stitch} transform that touches `face`. Stitch is
    // the source of truth for cross-side bindings: each Stitch holds both
    // directions explicitly (`transformAtoB` and `transformBtoA`), so we
    // rewrite both whenever the corresponding endpoint's face is the one
    // being rescaled.
    for (const s of atlas.stitches) {
      const aIsFace = s.a.face === face;
      const bIsFace = s.b.face === face;
      if (!aIsFace && !bIsFace) continue;
      // transformAtoB: a-frame → b-frame. Rescaling `a`'s frame means stored
      // a-frame coords are R× bigger → right-multiply by Sinv. Rescaling
      // `b`'s frame means b-frame outputs need to be R× bigger → left-
      // multiply by S.
      let TAB = s.transformAtoB;
      if (aIsFace) TAB = M.multiply(TAB, Sinv);
      if (bIsFace) TAB = M.multiply(S, TAB);
      // transformBtoA is the symmetric inverse, with the role of `a` and `b`
      // swapped: rescaling `b`'s frame → right-multiply by Sinv; rescaling
      // `a`'s frame → left-multiply by S.
      let TBA = s.transformBtoA;
      if (bIsFace) TBA = M.multiply(TBA, Sinv);
      if (aIsFace) TBA = M.multiply(S, TBA);
      s.setTransforms(TAB, TBA);
    }
    // Same conjugation for {@link Link} transforms touching `face`. A link's
    // transform maps `to` frame → `from` frame; if the rescaled face is one
    // of the endpoints, we must rewrite the transform so the on-screen
    // placement of the link's child stays invariant under the rescale.
    //
    // This runs *after* the stitch loop so that the implicit
    // `recomputeLinkTransformsFromStitchChain` (fired by `mutate`'s
    // commit) sees the post-rescale stitch state, then we overwrite for
    // closed-surface targets where BFS finds no chain. For
    // stitch-reachable targets the recompute already produced the same
    // S·old value; the overwrite is benign.
    for (const link of atlas.links) {
      const fromIsFace = link.from === face;
      const toIsFace = link.to === face;
      if (!fromIsFace && !toIsFace) continue;
      let T = link.transform;
      if (toIsFace) T = M.multiply(T, Sinv);
      if (fromIsFace) T = M.multiply(S, T);
      link.transform = T;
    }
  });
}

// ----------------------------------------------------------------------------
// addInnerLoop — add a hole to an existing face
// ----------------------------------------------------------------------------

/**
 * Add an inner (CW) boundary loop to `face`, with all half-edges initially
 * "free" (`twin = null`). The loop describes a hole in the face: walking off
 * one of its edges terminates the walk, since there's no neighbour on the
 * other side. A subsequent `stitch`/`linkEdgeToTwin` call can bind any of
 * the new free edges to a half-edge in another face.
 *
 * `vertices` must be:
 *   - At least 3 finite points.
 *   - In CW order (the opposite winding to the face's outer loop).
 *   - All strictly inside (or on the boundary of) the outer polygon.
 *
 * Returns the array of newly-created half-edges, in the order matching
 * `vertices`. The face's `innerLoops` array is appended to with the same
 * array, and every new half-edge is added to `atlas.sides`.
 */
export function addInnerLoop(atlas: Atlas, face: Face, vertices: ReadonlyArray<Point>): Side[] {
  if (!atlas.faces.includes(face)) {
    throw new Error('addInnerLoop: face must belong to atlas');
  }
  if (vertices.length < 3) {
    throw new Error(`addInnerLoop: need at least 3 vertices, got ${vertices.length}`);
  }

  const loop: Side[] = vertices.map((v) => new Side(HomPoint.finite(v.x, v.y)));
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    const he = loop[i];
    he.next = loop[(i + 1) % m];
    he.prev = loop[(i - 1 + m) % m];
    he.face = face;
    // twin remains null — these are free edges.
  }

  if (!isPolygonCW(loop.map((h) => h.origin()))) {
    throw new Error('addInnerLoop: vertices must be in CW order (a hole is wound opposite to the outer face)');
  }

  const outer = face.junctions();
  for (let i = 0; i < m; i++) {
    if (!polygonContains(outer, HomPoint.finite(vertices[i].x, vertices[i].y))) {
      throw new Error(`addInnerLoop: vertex (${vertices[i].x}, ${vertices[i].y}) lies outside the outer loop`);
    }
  }

  face.innerLoops.push(loop);
  for (const he of loop) atlas.sides.push(he);

  return loop;
}

// ----------------------------------------------------------------------------
// validateAtlas — invariant checker
// ----------------------------------------------------------------------------

/**
 * Throw if the atlas violates any structural or geometric invariant.
 * Intended for use in tests and after every mutation during development.
 */
export function validateAtlas(atlas: Atlas, eps = 1e-9): void {
  const errs: string[] = [];

  if (!atlas.faces.includes(atlas.root)) {
    errs.push('atlas.root not in atlas.faces');
  }

  const allSidesSet = new Set(atlas.sides);
  const allFaceSet = new Set(atlas.faces);

  // ---- per-face checks ----
  for (const f of atlas.faces) {
    const k = f.sides.length;
    // k=2 (digon / slab) is allowed; see the chord-vs-arc invariant block
    // below for the additional requirements that case imposes.
    if (k < 2) {
      errs.push(`face has ${k} half-edges, expected at least 2`);
      continue;
    }

    // Half-edge cycle integrity (next/prev consistency).
    for (let i = 0; i < k; i++) {
      const he = f.sides[i];
      if (!allSidesSet.has(he)) errs.push('half-edge in face not in atlas.sides');
      if (he.face !== f) errs.push('half-edge in face has wrong .face');
      if (he.next !== f.sides[(i + 1) % k]) {
        errs.push(`face.sides[${i}].next !== face.sides[${(i + 1) % k}]`);
      }
      if (he.prev !== f.sides[(i - 1 + k) % k]) {
        errs.push(`face.sides[${i}].prev !== face.sides[${(i - 1 + k) % k}]`);
      }
      if (he.next.prev !== he) {
        errs.push(`face.sides[${i}].next.prev !== self`);
      }
    }

    // Ideal direction unit length.
    for (const he of f.sides) {
      if (he.a.isIdeal) {
        const len = Math.hypot(he.a.x, he.a.y);
        if (Math.abs(len - 1) > eps) {
          errs.push(`ideal half-edge direction length ${len}, expected 1`);
        }
      }
    }

    // CCW + convexity. `isPolygonCCW` returns true iff every consecutive
    // triple makes a strict left turn, which for a closed polygon is equivalent
    // to "CCW *and* convex" — so this single check enforces both invariants.
    try {
      if (!isPolygonCCW(f.junctions())) errs.push('face junctions not in CCW convex order');
    } catch (e) {
      errs.push(`face CCW check failed: ${(e as Error).message}`);
    }

    // Boundary half-edge invariants for ideal-ideal HEs:
    //   - An at-infinity arc (`anchor === null`) has null twin: the
    //     line at infinity is not crossed by twin links.
    //   - A chord (`anchor !== null`) MUST have a non-null twin (the
    //     chord HE on the other sub-face), and its origin/target ideal
    //     directions must be antipodal (the two limit directions of a real
    //     line in R²).
    for (const he of f.sides) {
      if (!he.a.isIdeal || !he.next.a.isIdeal) continue;
      if (he.anchor === null) {
        if (he.twin !== null) errs.push('at-infinity arc half-edge has non-null twin');
      } else {
        if (he.twin === null) errs.push('chord half-edge has null twin');
        if (!he.origin().isAntipodalTo(he.target(), eps * 100)) {
          errs.push('chord half-edge endpoints are not antipodal on S¹');
        }
      }
    }

    // Digon (k=2) face: must be a "slab" — both HEs are chords with
    // antipodal endpoints (already enforced above) and the two chord
    // lines must be DISTINCT parallel lines with the second anchor on
    // the LEFT of the first chord's direction (interior side under CCW
    // traversal).
    if (k === 2) {
      const h0 = f.sides[0];
      const h1 = f.sides[1];
      if (h0.kind !== 'chord' || h1.kind !== 'chord') {
        errs.push('digon face: both half-edges must be chord HEs');
      } else {
        const a0 = h0.anchor!;
        const a1 = h1.anchor!;
        const o0 = h0.origin();
        const t0 = h0.target();
        const dirX = t0.x - o0.x;
        const dirY = t0.y - o0.y;
        const dx = a1.x - a0.x;
        const dy = a1.y - a0.y;
        // Cross of h0's direction with (a1 - a0). Positive ⇒ a1 is on
        // the left of h0 (CCW interior side). Zero ⇒ degenerate slab.
        const cross = dirX * dy - dirY * dx;
        if (Math.abs(cross) <= eps) {
          errs.push('digon face: chord anchors are collinear (degenerate slab)');
        } else if (cross < 0) {
          errs.push('digon face: chord half-edges wound CW (inverted slab)');
        }
      }
    }

    // Inner loops: each is a CW cycle inside the outer loop, with proper
    // wiring and finite vertices. Convexity is NOT required for inner loops.
    for (let li = 0; li < f.innerLoops.length; li++) {
      const loop = f.innerLoops[li];
      const m = loop.length;
      if (m < 3) {
        errs.push(`face innerLoops[${li}] has ${m} half-edges, expected at least 3`);
        continue;
      }
      for (let i = 0; i < m; i++) {
        const he = loop[i];
        if (!allSidesSet.has(he)) {
          errs.push(`innerLoops[${li}][${i}] not in atlas.sides`);
        }
        if (he.face !== f) errs.push(`innerLoops[${li}][${i}] has wrong .face`);
        if (he.next !== loop[(i + 1) % m]) {
          errs.push(`innerLoops[${li}][${i}].next !== innerLoops[${li}][${(i + 1) % m}]`);
        }
        if (he.prev !== loop[(i - 1 + m) % m]) {
          errs.push(`innerLoops[${li}][${i}].prev !== innerLoops[${li}][${(i - 1 + m) % m}]`);
        }
        if (he.next.prev !== he) {
          errs.push(`innerLoops[${li}][${i}].next.prev !== self`);
        }
      }
      // Inner loops are required to be CW. We don't currently support ideal
      // vertices on inner loops (a hole is a finite region), so a normal
      // CW check applies.
      try {
        const verts = loop.map((h) => h.origin());
        if (!isPolygonCW(verts)) {
          errs.push(`face innerLoops[${li}] not in CW order`);
        }
        // Every inner-loop vertex must lie inside (or on the boundary of)
        // the outer loop.
        for (let i = 0; i < m; i++) {
          const v = verts[i];
          if (v.isIdeal) {
            errs.push(`face innerLoops[${li}][${i}] is ideal; inner loops must be finite`);
            continue;
          }
          if (!polygonContains(f.junctions(), v)) {
            errs.push(`face innerLoops[${li}][${i}] at (${v.x}, ${v.y}) lies outside the outer loop`);
          }
        }
      } catch (e) {
        errs.push(`face innerLoops[${li}] orientation check failed: ${(e as Error).message}`);
      }
    }
  }

  // ---- per-side checks (twin transform consistency) ----
  // Junction-correspondence is enforced for every twinned side. The
  // similarity-only constraint (translation + uniform scale only) that
  // used to live here was dropped along with the asymmetric edge-twin
  // model — Klein-bottle, RP², and Dehn-twisted-torus topologies all
  // need rotation/reflection in stitch transforms. Per-face model spaces
  // (substrate.md's `(R², similarity)` etc.) will, when introduced, take
  // over the job of constraining transforms based on source/target model.
  for (const h of atlas.sides) {
    if (!allFaceSet.has(h.face)) errs.push('side.face not in atlas');
    if (h.twin) {
      if (!allSidesSet.has(h.twin)) errs.push('side.twin not in atlas');
      const T = h.transform;
      if (!junctionImageMatches(T, h.target(), h.twin.origin(), eps * 100)) {
        errs.push("twin endpoint b' does not match T·b");
      }
      if (!junctionImageMatches(T, h.origin(), h.twin.target(), eps * 100)) {
        errs.push("twin endpoint a' does not match T·a");
      }
    }
  }

  // ---- per-stitch checks (reciprocal-binding consistency) ----
  // A Stitch is a structural reciprocity contract: both endpoints reference
  // the same Stitch object, both twin pointers go each way, and the two
  // transforms are mutually inverse. The Atlas-level set is derived from
  // .stitch back-references, so we iterate that for free.
  const seenStitches = new Set<Stitch>();
  for (const h of atlas.sides) {
    const s = h.stitch;
    if (s === null) continue;
    if (s.a !== h && s.b !== h) {
      errs.push('halfEdge.stitch does not reference this half-edge as a or b');
      continue;
    }
    if (seenStitches.has(s)) continue;
    seenStitches.add(s);
    if (!allSidesSet.has(s.a) || !allSidesSet.has(s.b)) {
      errs.push('stitch endpoint not in atlas.sides');
      continue;
    }
    if (s.a.stitch !== s || s.b.stitch !== s) {
      errs.push('stitch back-references not symmetric (a.stitch !== s || b.stitch !== s)');
    }
    if (s.a.twin !== s.b || s.b.twin !== s.a) {
      errs.push('stitch endpoints are not reciprocally twinned');
    }
    // Transforms must be mutually inverse.
    const composed = M.multiply(s.a.transform, s.b.transform);
    if (!M.equals(composed, M.fromValues())) {
      errs.push(
        `stitch transforms not mutually inverse (a·b = [${composed.a}, ${composed.b}, ${composed.c}, ${composed.d}, ${composed.e}, ${composed.f}])`,
      );
    }
  }

  // ---- per-link checks ----
  for (const link of atlas.links) {
    if (!allFaceSet.has(link.from)) {
      errs.push('link.from not in atlas.faces');
    }
    if (!allFaceSet.has(link.to)) {
      errs.push('link.to not in atlas.faces');
    }

    // For chain-tracked links: link.transform is a cached chain
    // composite (cylinder-style wraps); it MUST equal the BFS chain
    // composite, otherwise the renderer disagrees with itself depending
    // on which BFS path it picks (link path vs stitch path) and the
    // wrapped region drifts.
    //
    // This is a cache-invalidation invariant — every stitch-mutating
    // operation routes through {@link Atlas.markLinksDirty} so tracked
    // links are re-derived before the next read. Validating here in
    // `validateAtlas` makes a missed invalidation site fail loudly the
    // next time *any* test re-validates that atlas, instead of shipping
    // as a visual drift discovered by a user under multi-step interactive
    // input.
    //
    // Non-tracked links (manual placements, self-links, closed-surface
    // targets) skip this check — their transforms are caller-owned. See
    // {@link Link.tracksStitchChain} for the discrimination.
    if (link.tracksStitchChain && allFaceSet.has(link.from) && allFaceSet.has(link.to)) {
      const chain = bfsCompositeViaStitchesOnly(atlas, link.from, link.to);
      if (chain !== null && !M.equals(link.transform, chain)) {
        const fIdx = atlas.faces.indexOf(link.from);
        const tIdx = atlas.faces.indexOf(link.to);
        errs.push(
          `link transform stale vs stitch chain (F${fIdx} → F${tIdx}): ` +
            `stored=[${link.transform.a.toFixed(4)}, ${link.transform.b.toFixed(4)}, ` +
            `${link.transform.c.toFixed(4)}, ${link.transform.d.toFixed(4)}, ` +
            `${link.transform.e.toFixed(4)}, ${link.transform.f.toFixed(4)}], ` +
            `chain=[${chain.a.toFixed(4)}, ${chain.b.toFixed(4)}, ` +
            `${chain.c.toFixed(4)}, ${chain.d.toFixed(4)}, ` +
            `${chain.e.toFixed(4)}, ${chain.f.toFixed(4)}]`,
        );
      }
    }
  }

  // ---- reachability from root ----
  // Twin reciprocity is structural now (see Stitch invariants above), so
  // the forward-only twin walk reaches every stitch-connected face. Links
  // are still walked in both directions: an isolated face that is the
  // target of a Link from the root chain is reachable, and a face whose
  // only out-binding is a Link can be reached by walking back from the
  // child.
  const linksByTo = new Map<Face, Link[]>();
  for (const link of atlas.links) {
    const toList = linksByTo.get(link.to);
    if (toList) toList.push(link);
    else linksByTo.set(link.to, [link]);
  }
  const reachable = new Set<Face>();
  const queue: Face[] = [atlas.root];
  reachable.add(atlas.root);
  while (queue.length > 0) {
    const f = queue.shift()!;
    for (const he of f.sidesCCW()) {
      if (he.twin && !reachable.has(he.twin.face)) {
        reachable.add(he.twin.face);
        queue.push(he.twin.face);
      }
    }
    for (const link of atlas.links) {
      if (link.from !== f) continue;
      if (!reachable.has(link.to)) {
        reachable.add(link.to);
        queue.push(link.to);
      }
    }
    const inLinks = linksByTo.get(f);
    if (inLinks) {
      for (const l of inLinks) {
        if (!reachable.has(l.from)) {
          reachable.add(l.from);
          queue.push(l.from);
        }
      }
    }
  }
  for (const f of atlas.faces) {
    if (!reachable.has(f)) errs.push('face unreachable from root');
  }

  if (errs.length > 0) {
    throw new Error('atlas invariant violations:\n  - ' + errs.join('\n  - '));
  }
}

/**
 * Whether the affine `T` maps `src` (a homogeneous point in some face's
 * frame) to `dst` (in the partner face's frame), within tolerance.
 *
 * Single-line homogeneous test: `T·src = dst` up to projective scale.
 * `HomPoint.applyAffine` handles the finite vs ideal distinction
 * uniformly — translations drop out for ideal points (w=0), persist for
 * finite points (w=1). The previous kind-dispatched implementation had
 * separate branches for finite-finite vs ideal-ideal mismatches; the
 * homogeneous version makes mismatched kinds fail the `equals` check
 * naturally (different `w` components).
 */
function junctionImageMatches(T: M.Matrix2DReadonly, src: HomPoint, dst: HomPoint, eps: number): boolean {
  return src.applyAffine(T).equals(dst, eps);
}

// ----------------------------------------------------------------------------
// Mutation primitives
// ----------------------------------------------------------------------------

/**
 * Result of an identity-preserving split.
 *
 *  - `face` is the original face that was passed to the split, mutated in
 *    place to hold the CCW arc from `vIdxA` to `vIdxB` (inclusive) plus
 *    the new chord HE that closes back to `vIdxA`. Identity is preserved:
 *    shapes inside this side keep their face-local coordinates, external
 *    bindings on the kept arc stay attached, and `atlas.root` is
 *    unaffected.
 *  - `fresh` is a newly-allocated face holding the CCW arc from `vIdxB`
 *    to `vIdxA` (inclusive) plus its closing chord HE. Re-anchored: its
 *    finite vertices are translated so the centroid sits at face-local
 *    `(0, 0)`. Callers that track per-face data (shape coordinates,
 *    region outline vertices) for points that fell on this side should
 *    apply `(p.x - freshOffset.x, p.y - freshOffset.y)` to translate
 *    them into `fresh`'s frame.
 *  - `faceChordSide` and `freshChordSide` are the new chord half-edges, twin-
 *    paired with translation transforms encoding the offset between
 *    `face`'s frame (unchanged) and `fresh`'s frame (translated by
 *    `-freshOffset`).
 *
 * Note: `face` and `fresh` correspond to the legacy `faces[0]` (right of
 * the chord under CCW convention) and `faces[1]` respectively.
 * `splitFaceAlongChord`'s docstring convention — "faces[0] is on the
 * RIGHT of entry→exit direction" — translates to "`face` is on the right,
 * `fresh` is on the left."
 */
export interface SplitChordResult {
  face: Face;
  fresh: Face;
  faceChordSide: Side;
  freshChordSide: Side;
  /**
   * Translation applied to `fresh`'s local frame relative to the original
   * face's frame. A point at `p` in the pre-split face's frame is at
   * `(p.x - freshOffset.x, p.y - freshOffset.y)` in `fresh`'s frame.
   * `face` itself is NOT re-anchored (its frame matches the pre-split frame).
   */
  freshOffset: Point;
}

/**
 * Result of {@link subdivideSide}: the new vertex's position and the
 * replacement sides in both the source face and (if the original side
 * was stitched) the partner face.
 */
export interface SubdivideSideResult {
  /**
   * Origin of the inserted vertex, in `side.face`'s local frame. For arcs
   * this is the unit direction of the new ideal vertex; otherwise it is the
   * finite point that was inserted.
   */
  newVertex: Point;
  /** Replacement sides in `side.face`, in CCW order: `[origin→new, new→target]`. */
  faceHalves: [Side, Side];
  /**
   * Replacement sides in the partner face if the original side was stitched,
   * else `null`. CCW order: `[oldTwin.origin→new, new→oldTwin.target]` (i.e.
   * opposite directions of `faceHalves`). Always `null` for arc subdivisions
   * (arcs are never stitched).
   */
  twinHalves: [Side, Side] | null;
}

/**
 * Insert a vertex on a side (and its stitched twin, if any), without
 * otherwise changing either incident face's shape.
 *
 * After this call, the affected face(s) gain one chain vertex (`k → k+1`)
 * collinear with its two adjacent vertices; the face's interior is unchanged.
 *
 * Behaviour by side kind (the `at` argument is interpreted accordingly):
 *   - `segment` / `ray` / `antiRay`: `at` is a finite point on the side,
 *     strictly between the two endpoints.
 *   - `chord` (ideal-ideal stitched, `anchor` set): `at` is a finite point
 *     on the chord line. Subdividing replaces the chord with a
 *     (ideal-finite, finite-ideal) pair — neither needs an `anchor` because
 *     the finite midpoint pinpoints the line.
 *   - `arc` (ideal-ideal untwinned): `at` is interpreted as the unit
 *     direction of the new ideal vertex, which must lie strictly inside the
 *     arc's CCW angular sweep. Arcs have no twin so only the one face is
 *     touched.
 *
 * Mutates the existing `Face` objects in place — face identity is preserved,
 * shapes assigned to either face stay assigned.
 */
export function subdivideSide(atlas: Atlas, side: Side, at: Point): SubdivideSideResult {
  if (!atlas.sides.includes(side)) {
    throw new Error('subdivideSide: side not in atlas');
  }

  // ---- validate `at` and compute the inserted-point descriptor ----
  //
  // Two cases dispatched on whether the side lies on a finite line in R²
  // or on the line at infinity (arc). The line at infinity has no metric
  // parameterisation in R², so arcs use angular sweep on S¹ separately.
  // For every finite-line case (segment / ray / antiRay / chord), the
  // logic is uniform: lift `at` to a HomPoint, check it's on the line,
  // check its parameter is strictly between the endpoints' parameters
  // along the line's tangent direction. Endpoints at infinity have
  // ±Infinity parameters by `HomLine.parameterOf`'s convention, so the
  // betweenness comparison absorbs ray / antiRay / chord parametric
  // ranges without per-kind dispatch.
  const eps = 1e-9;
  let newOrigin: HomPoint;
  const sideLine = side.line;
  if (sideLine.isAtInfinity) {
    // Arc: `at` is a unit ideal direction strictly inside the CCW angular sweep.
    const len = Math.hypot(at.x, at.y);
    if (len < eps) throw new Error('subdivideSide: arc subdivision direction has zero length');
    const dir = { x: at.x / len, y: at.y / len };
    const a = side.origin();
    const b = side.next.origin();
    if (cross(a.x, a.y, dir.x, dir.y) <= eps || cross(dir.x, dir.y, b.x, b.y) <= eps) {
      throw new Error('subdivideSide: ideal direction is not strictly inside the arc (a×d, d×b must both be > 0)');
    }
    newOrigin = HomPoint.idealDir(dir.x, dir.y);
  } else {
    const atP = HomPoint.finite(at.x, at.y);
    if (Math.abs(sideLine.evalAt(atP)) > eps) {
      throw new Error('subdivideSide: point is not on the edge');
    }
    const pa = sideLine.parameterOf(side.origin());
    const pb = sideLine.parameterOf(side.next.origin());
    const pp = sideLine.parameterOf(atP);
    const between = (pa < pp && pp < pb) || (pa > pp && pp > pb);
    if (!between) {
      throw new Error(
        `subdivideSide: point not strictly between endpoints (param=${pp}, range=[${pa}, ${pb}])`,
      );
    }
    newOrigin = atP;
  }

  // ---- F side ----
  const F = side.face;
  const origin = side.origin();
  const s_A = new Side(origin); // origin → newVertex
  const s_B = new Side(newOrigin); // newVertex → target
  s_A.face = F;
  s_B.face = F;

  const fIdx = F.sides.indexOf(side);
  F.sides.splice(fIdx, 1, s_A, s_B);
  rewireFaceCycle(F);

  const sIdx = atlas.sides.indexOf(side);
  atlas.sides.splice(sIdx, 1, s_A, s_B);

  // ---- G (twin) side, only when stitched (arcs are never stitched) ----
  let twinHalves: [Side, Side] | null = null;
  if (side.stitch) {
    const T = side.transform;
    const twin = side.stitch.other(side);
    const G = twin.face;
    const tOrigin = twin.origin();
    const pointInG = M.applyToPoint(T, at);

    const tw_A = new Side(tOrigin);
    const tw_B = new Side(HomPoint.finite(pointInG.x, pointInG.y));
    tw_A.face = G;
    tw_B.face = G;

    const gIdx = G.sides.indexOf(twin);
    G.sides.splice(gIdx, 1, tw_A, tw_B);
    rewireFaceCycle(G);

    const twinIdx = atlas.sides.indexOf(twin);
    atlas.sides.splice(twinIdx, 1, tw_A, tw_B);

    // Twin pairs (T preserves frame relationships F ↔ G):
    //   s_A (F: origin → newP)  ↔  tw_B (G: newP' → twin.target = origin')
    //   s_B (F: newP → target)  ↔  tw_A (G: twin.origin = target' → newP')
    const T_fwd = M.fromValues(T.a, T.b, T.c, T.d, T.e, T.f);
    const T_rev = M.invert(T_fwd);
    setTwin(atlas, s_A, tw_B, T_fwd, M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f));
    setTwin(
      atlas,
      s_B,
      tw_A,
      M.fromValues(T_fwd.a, T_fwd.b, T_fwd.c, T_fwd.d, T_fwd.e, T_fwd.f),
      M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f),
    );
    twinHalves = [tw_A, tw_B];
  }

  return { newVertex: at, faceHalves: [s_A, s_B], twinHalves };
}

/**
 * Strict inverse of {@link subdivideSide}. Eliminate the vertex at
 * `side.next.origin` by fusing `side` and `side.next` into a single side
 * spanning `side.origin → side.next.next.origin`.
 *
 * If `side` is stitched, the partner pair (`side.twin`, `side.next.twin`)
 * is symmetrically joined in the partner face; reciprocity is preserved.
 *
 * **API rationale.** The argument is the side *ending* at the vertex
 * being eliminated, so `side.next` is the side *starting* there. This
 * matches `subdivideSide`'s `faceHalves[0]`: the natural round-trip is
 * `joinSidesAtVertex(atlas, subdivideSide(atlas, e, p).faceHalves[0])`.
 *
 * **Preconditions** (each violation throws a clearly-named error):
 *  - `side ∈ atlas.sides`
 *  - `side.next.face === side.face` (consecutive in the same loop)
 *  - `face.sides.length >= 3` (joining a digon would produce a 1-edge face)
 *  - **Collinearity**: the kind combination of `(side.origin, side.next.origin,
 *    side.next.next.origin)` must be a recognised subdivision-pair shape, AND
 *    the eliminated middle vertex must lie on the line through the two
 *    survivors. Recognised shapes:
 *      - `(finite, finite, finite)`: middle on segment between survivors
 *      - `(finite, finite, ideal)`: middle on the ray from `a` toward ideal `b`
 *      - `(ideal, finite, finite)`: middle on the antiRay from finite `b` toward ideal `a`
 *      - `(ideal, ideal, ideal)`: middle ideal direction strictly inside arc `a→b` (CCW sweep)
 *      - `(ideal, finite, ideal)` with antipodal ideals: chord — joined side becomes a chord with anchor at the eliminated finite vertex
 *  - **If stitched**:
 *      - `side.next.stitch !== null` (subdivisions stitch both halves; an
 *        asymmetric pair signals a non-subdivision origin and is refused)
 *      - The partner pair is consecutive in the partner face: `side.twin.prev === side.next.twin`
 *      - The two paired stitches still hold the same transform
 *        (`subdivideSide` installed identical `T_fwd`s; later mutations
 *        could have desynced them, in which case the join is geometrically invalid)
 *
 * **Effect:**
 *  - Replaces `[side, side.next]` in the face's outer loop with one new
 *    `joined` side spanning the surviving endpoints
 *  - For chord joins, sets the joined side's `anchor` to the eliminated
 *    finite vertex (the chord line passes through it by construction)
 *  - Removes `side` and `side.next` from `atlas.sides`; adds `joined`
 *  - If stitched: symmetrically replaces the partner pair in the partner
 *    face, removes them from `atlas.sides`, and re-stitches `joined` ↔
 *    `joinedTwin` with the recovered transform
 *
 * **Identity preservation:** the face's identity is preserved (mutated
 * in place); the `joined` side is a fresh `Side` object (not one of the
 * eliminated ones).
 */
export function joinSidesAtVertex(atlas: Atlas, side: Side): void {
  if (!atlas.sides.includes(side)) {
    throw new Error('joinSidesAtVertex: side not in atlas');
  }
  const next = side.next;
  if (next === side) {
    throw new Error('joinSidesAtVertex: side has no successor (k=1 face)');
  }
  if (next.face !== side.face) {
    throw new Error('joinSidesAtVertex: side and side.next live in different faces (cannot join)');
  }
  const F = side.face;
  if (F.sides.length < 3) {
    throw new Error('joinSidesAtVertex: face has fewer than 3 sides; joining would produce a degenerate result');
  }

  // ---- Capture stitch references before any mutation ----
  const stitchA = side.stitch;
  const stitchB = next.stitch;
  let tw_A: Side | null = null;
  let tw_B: Side | null = null;
  let G: Face | null = null;
  let recoveredTransform: M.Matrix2D | null = null;

  if (stitchA !== null) {
    if (stitchB === null) {
      throw new Error(
        'joinSidesAtVertex: side is stitched but side.next is not (asymmetric pair, not subdivision-shaped)',
      );
    }
    tw_B = stitchA.other(side);
    tw_A = stitchB.other(next);
    if (tw_A.face !== tw_B.face) {
      throw new Error('joinSidesAtVertex: paired stitches go to different partner faces');
    }
    if (tw_B.prev !== tw_A) {
      throw new Error('joinSidesAtVertex: twin sides are not consecutive in the partner face (not subdivision-shaped)');
    }
    if (!M.equals(side.transform, next.transform)) {
      throw new Error(
        'joinSidesAtVertex: paired stitch transforms diverged after some intervening mutation; cannot join geometrically',
      );
    }
    G = tw_B.face;
    const T = side.transform;
    recoveredTransform = M.fromValues(T.a, T.b, T.c, T.d, T.e, T.f);
  }

  // ---- Validate collinearity and build the joined side ----
  //
  // Two genuine geometric cases (both compact, no per-endpoint-kind dispatch):
  //
  //  1. **All-ideal triple (arc + arc → arc).** All three points lie on
  //     the line at infinity; betweenness is angular sweep on S¹, not
  //     parametric distance. (signedTurn is structurally zero for
  //     all-w=0 rows so it can't witness collinearity here.)
  //
  //  2. **Otherwise.** signedTurn(a, v, b) tests collinearity uniformly.
  //     Then the line through a and b (or, for the antipodal-ideal case,
  //     through v in a's direction) gives a parametric line; v's parameter
  //     must strictly lie between a's and b's parameters. Ideal endpoints
  //     have parameter ±Infinity (sign = direction along tangent), so the
  //     comparison `pa < pv < pb || pa > pv > pb` works uniformly across
  //     finite-finite, finite-ideal, ideal-finite, and antipodal-ideal cases.
  //     The antipodal-ideal-finite-middle case additionally re-forms a
  //     chord (sets `joined.anchor = v`).
  const a = side.origin();
  const v = next.origin();
  const b = next.next.origin();
  const eps = 1e-9;
  const joined = new Side(a);

  if (a.isIdeal && v.isIdeal && b.isIdeal) {
    const aCrossV = cross(a.x, a.y, v.x, v.y);
    const vCrossB = cross(v.x, v.y, b.x, b.y);
    if (aCrossV <= eps || vCrossB <= eps) {
      throw new Error('joinSidesAtVertex: middle ideal not strictly inside arc a→b');
    }
  } else {
    if (Math.abs(signedTurn(a, v, b)) > eps) {
      throw new Error('joinSidesAtVertex: a, v, b are not collinear');
    }
    // Build the joined-side's line. For the antipodal-ideal case (a, b
    // both ideal antipodal, v finite) the endpoints alone don't determine
    // the line — derive it from v + a's direction. Otherwise the line is
    // fixed by the two endpoints.
    let line: HomLine;
    if (a.isIdeal && b.isIdeal) {
      if (!a.isAntipodalTo(b, eps)) {
        throw new Error('joinSidesAtVertex: ideal endpoints are not antipodal — cannot reform chord');
      }
      line = HomLine.withDirection(v, { x: a.x, y: a.y });
      // Joined side becomes a chord anchored at the eliminated finite vertex.
      joined.anchor = { x: v.x, y: v.y };
    } else {
      line = HomLine.through(a, b);
    }
    const pa = line.parameterOf(a);
    const pv = line.parameterOf(v);
    const pb = line.parameterOf(b);
    const between = (pa < pv && pv < pb) || (pa > pv && pv > pb);
    if (!between) {
      throw new Error('joinSidesAtVertex: middle vertex is not strictly between a and b');
    }
  }

  // ---- Build the joined twin (if stitched) ----
  let twinJoined: Side | null = null;
  if (tw_A !== null && tw_B !== null) {
    // tw_A ends at the partner-face vertex; tw_B starts there. The joined
    // twin spans tw_A.origin → tw_B.next.origin in G's frame.
    const tA_origin = tw_A.origin();
    twinJoined = new Side(tA_origin);
    if (joined.anchor !== null) {
      // Chord case: project the F-frame anchor through the stitch transform
      // to recover G's anchor for the same line.
      const anchorInG = M.applyToPoint(recoveredTransform!, joined.anchor);
      twinJoined.anchor = { x: anchorInG.x, y: anchorInG.y };
    }
  }

  // ---- Atomic mutation ----
  atlas.mutate(() => {
    if (stitchA !== null) unstitch(stitchA);
    if (stitchB !== null) unstitch(stitchB);

    // Splice F's outer loop: replace [side, next] with [joined].
    const fIdx = F.sides.indexOf(side);
    F.sides.splice(fIdx, 2, joined);
    joined.face = F;
    rewireFaceCycle(F);

    const sideIdx = atlas.sides.indexOf(side);
    atlas.sides.splice(sideIdx, 1);
    const nextIdx = atlas.sides.indexOf(next);
    atlas.sides.splice(nextIdx, 1);
    atlas.sides.push(joined);

    if (twinJoined !== null && tw_A !== null && tw_B !== null && G !== null) {
      const gIdx = G.sides.indexOf(tw_A);
      G.sides.splice(gIdx, 2, twinJoined);
      twinJoined.face = G;
      rewireFaceCycle(G);

      const taIdx = atlas.sides.indexOf(tw_A);
      atlas.sides.splice(taIdx, 1);
      const tbIdx = atlas.sides.indexOf(tw_B);
      atlas.sides.splice(tbIdx, 1);
      atlas.sides.push(twinJoined);

      const T_fwd = recoveredTransform!;
      const T_rev = M.invert(T_fwd);
      setTwin(atlas, joined, twinJoined, T_fwd, T_rev);
    }
  });
}

/**
 * Area-weighted centroid of the finite vertices of a (possibly mixed) ring
 * of junctions. Ideal vertices are translation-invariant and contribute
 * nothing to the position of the face in R²; we ignore them and centroid
 * only the finite ones. Falls back to the simple average when the finite
 * sub-polygon has near-zero area (e.g. a single finite vertex flanked by
 * ideals), and to `(0, 0)` when there are no finite vertices at all.
 */
function centroidOfFinite(verts: HomPoint[]): Point {
  const fin: Point[] = [];
  for (const j of verts) {
    if (j.isFinite) fin.push({ x: j.x, y: j.y });
  }
  if (fin.length === 0) return { x: 0, y: 0 };
  if (fin.length === 1) return fin[0];
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < fin.length; i++) {
    const p = fin[i];
    const q = fin[(i + 1) % fin.length];
    const cr = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
    a2 += cr;
  }
  if (Math.abs(a2) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of fin) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / fin.length, y: sy / fin.length };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/**
 * Split `face` along a straight chord between two of its existing vertices
 * `face.sides[vIdxA].origin()` and `face.sides[vIdxB].origin()`.
 *
 * **Identity-preserving.** `face` is mutated in place to hold the CCW arc
 * from `vIdxA` to `vIdxB` plus the new chord HE; a freshly-allocated `fresh`
 * face holds the other half. Consequences for callers:
 *
 *  - `atlas.root` is never replaced by this primitive — `face` survives,
 *    so a root that was the split face stays root.
 *  - Shapes and per-face data tracked against `face` stay attached without
 *    any K-matrix view compensation. (Whether they belong on the kept side
 *    or on `fresh` is a containment check the caller does — see
 *    `freshOffset`.)
 *  - External stitches/links on the kept arc are unchanged.
 *  - External stitches on the moved arc keep their `.twin` pointers (the
 *    HE objects move from `face` to `fresh`, identity preserved); their
 *    transforms are rebased so they map into `fresh`'s frame.
 *
 * Constraints:
 *   - `vIdxA !== vIdxB` and the two indices are non-adjacent (the chord
 *     would otherwise coincide with an existing edge).
 *   - When BOTH chord endpoints are ideal, `anchor` (a finite point on
 *     the chord line, in `face`-local coordinates) is REQUIRED and the two
 *     ideal endpoints must be antipodal on S¹ (so they really are the limit
 *     directions of the same line). This is the only case where the chord's
 *     line is underdetermined by its endpoints alone — see {@link Side}
 *     class doc.
 *
 * **Re-anchoring.** Only `fresh` is re-anchored: its finite vertices are
 * translated so the centroid sits at face-local `(0, 0)`. `face` keeps its
 * original frame and vertex coordinates. The depth-locality invariant
 * (vertex magnitudes bounded by face size for safe rescaling around (0, 0))
 * holds for `fresh` by construction; for `face` it holds inductively
 * provided the original face already satisfied it.
 *
 * The chord twin transforms are pure translations encoding `(0 - freshOffset)`
 * (face → fresh) and `(freshOffset - 0)` (fresh → face). Ideal vertices
 * (unit directions on S¹) are translation-invariant so their stored
 * components are unchanged; chord-HE anchors on the moved arc are
 * translated by `-freshOffset` to match the re-anchored frame.
 *
 * Inner loops on `face` are dropped (set to `[]`) by this primitive — same
 * behaviour as before. Inner-loop preservation across cuts is a future
 * concern.
 */
export function splitFaceAtVertices(
  atlas: Atlas,
  face: Face,
  vIdxA: number,
  vIdxB: number,
  anchor: Point | null = null,
): SplitChordResult {
  if (!atlas.faces.includes(face)) throw new Error('splitFaceAtVertices: face not in atlas');
  const k = face.sides.length;
  if (vIdxA === vIdxB) throw new Error('splitFaceAtVertices: vIdxA === vIdxB');
  if (vIdxA < 0 || vIdxA >= k || vIdxB < 0 || vIdxB >= k) {
    throw new Error('splitFaceAtVertices: vertex index out of range');
  }
  // Ideal-ideal chord case: validate that the two endpoints are antipodal on
  // S¹ (limit directions of the same line through R²) and that the caller
  // supplied a finite `anchor` to pin down which parallel line it is.
  // For all other cases (at least one finite endpoint), the chord is fully
  // determined by its endpoints, and `anchor` is ignored.
  const eps = 1e-9;
  const origJ = face.junctions();
  const jA = origJ[vIdxA];
  const jB = origJ[vIdxB];
  let chordIsIdealIdeal = false;
  if (jA.isIdeal && jB.isIdeal) {
    chordIsIdealIdeal = true;
    if (!anchor) {
      throw new Error(
        'splitFaceAtVertices: ideal-ideal chord requires a finite anchor (the chord line is otherwise underdetermined)',
      );
    }
    if (!jA.isAntipodalTo(jB, eps)) {
      throw new Error('splitFaceAtVertices: ideal-ideal chord endpoints must be antipodal on S¹');
    }
  }
  // Adjacency check.
  //
  // dist=1 (one existing HE between the two vertices): the new chord is on
  // the same vertex pair as the existing HE. We allow this iff the existing
  // HE is itself an ideal-ideal chord — then the cut produces a "slab" digon
  // bounded by the existing chord + the new chord on parallel lines. For
  // every other dist<2 configuration the new chord would coincide with the
  // existing edge.
  //
  // For k=2 we're always in dist=1 (both arcs have length 1). The face must
  // already be a slab digon, so both adjacent HEs are chords; we additionally
  // require the new anchor to lie strictly inside the slab so neither
  // sub-face collapses.
  const dAbs = Math.abs(vIdxA - vIdxB);
  const dist = Math.min(dAbs, k - dAbs);
  if (dist < 2) {
    if (!chordIsIdealIdeal) {
      throw new Error('splitFaceAtVertices: chord endpoints are adjacent (would coincide with an edge)');
    }
    const dirX = jB.x - jA.x;
    const dirY = jB.y - jA.y;
    for (let i = 0; i < k; i++) {
      const he = face.sides[i];
      const ni = (i + 1) % k;
      const isBetween = (i === vIdxA && ni === vIdxB) || (i === vIdxB && ni === vIdxA);
      if (!isBetween) continue;
      if (he.kind !== 'chord') {
        throw new Error(
          'splitFaceAtVertices: adjacent side between ideal endpoints is not a chord (cannot produce a valid digon)',
        );
      }
      const existing = he.anchor!;
      const dx = anchor!.x - existing.x;
      const dy = anchor!.y - existing.y;
      const cr = dirX * dy - dirY * dx;
      if (Math.abs(cr) <= eps) {
        throw new Error(
          'splitFaceAtVertices: parallel-chord cut anchor lies on existing chord line (degenerate digon)',
        );
      }
    }
  }

  // Build the two boundary arcs of original-face vertex INDICES.
  // arc0 (CCW from vIdxA to vIdxB, inclusive) → kept by `face`.
  // arc1 (CCW from vIdxB to vIdxA, inclusive) → moves to `fresh`.
  const arc0: number[] = [];
  for (let i = vIdxA; ; i = (i + 1) % k) {
    arc0.push(i);
    if (i === vIdxB) break;
  }
  const arc1: number[] = [];
  for (let i = vIdxB; ; i = (i + 1) % k) {
    arc1.push(i);
    if (i === vIdxA) break;
  }

  // The actual HE objects per arc, keyed off the original index. arc[i] is
  // the index of the HE going from vertex `arc[i]` to vertex `arc[i+1]`;
  // the closing HE (arc[length-1]) is the *next* arc's first HE — it's not
  // part of THIS arc. So the HEs we keep/move per arc are arc[0..length-2].
  const arc0Sides = arc0.slice(0, -1).map((i) => face.sides[i]);
  const arc1Sides = arc1.slice(0, -1).map((i) => face.sides[i]);
  const arc1Set = new Set(arc1Sides);

  // Re-anchor offset: `face` stays at offset (0, 0) (identity-preserving);
  // `fresh` re-anchors its finite-vertex centroid to face-local (0, 0).
  const verts1 = arc1.map((i) => origJ[i]);
  const freshOffset = centroidOfFinite(verts1);

  // Build the new chord half-edges. faceChordSide closes face's loop from
  // vIdxB back to vIdxA (origin at vIdxB's position in face's UNCHANGED
  // frame). freshChordSide closes fresh's loop from vIdxA back to vIdxB
  // (origin at vIdxA's position, translated into fresh's re-anchored frame).
  // `applyAffine` handles finite + ideal uniformly: translations apply to
  // finite points and drop out for ideal directions (w = 0 zeroes the
  // translation column).
  const T_faceToFresh = M.fromTranslate(-freshOffset.x, -freshOffset.y);
  const T_freshToFace = M.fromTranslate(freshOffset.x, freshOffset.y);
  const faceChordSide = new Side(jB);
  const freshChordSide = new Side(jA.applyAffine(T_faceToFresh));

  // Chord anchors for the ideal-ideal case. The parent-frame `anchor`
  // pinpoints which parallel real line the chord represents; in `face`'s
  // unchanged frame we store it verbatim, in `fresh`'s frame we translate
  // by `-freshOffset` so the line equation matches its re-anchored coords.
  if (chordIsIdealIdeal) {
    faceChordSide.anchor = { x: anchor!.x, y: anchor!.y };
    freshChordSide.anchor = {
      x: anchor!.x - freshOffset.x,
      y: anchor!.y - freshOffset.y,
    };
  }

  // Twin the chord HEs. face → fresh translates by -freshOffset (fresh's
  // origin sits at +freshOffset in face's frame), and the inverse goes
  // the other way. Linear part stays identity (pure translation).
  setTwin(atlas, faceChordSide, freshChordSide, T_faceToFresh, T_freshToFace);

  // Re-anchor arc1's HEs in place: they're moving from face's frame into
  // fresh's frame (translated by -freshOffset). `applyAffine` handles
  // finite shifts and ideal-direction invariance uniformly — no kind
  // dispatch. Chord anchors are mutable Cartesian Points and shift in place.
  for (const he of arc1Sides) {
    he.a = he.a.applyAffine(T_faceToFresh);
    if (he.anchor !== null) {
      he.anchor = {
        x: he.anchor.x - freshOffset.x,
        y: he.anchor.y - freshOffset.y,
      };
    }
  }

  // Allocate `fresh` from the moved arc1 HEs plus the new closing chord.
  // Face's constructor wires .face / .next / .prev on every HE in the
  // passed list, including reassigning .face on the moved HEs to `fresh`.
  const cloneMat = (m: M.Matrix2DReadonly): M.Matrix2D => M.fromValues(m.a, m.b, m.c, m.d, m.e, m.f);
  const fresh = new Face([...arc1Sides, freshChordSide], [], cloneMat(face.frame));

  // Reset `face`'s outer loop to the kept arc plus the new closing chord,
  // and rewire its cycle. Inner loops are dropped (matching pre-existing
  // behaviour — preservation across cuts is future work). This also sets
  // faceChordSide.face = face via rewireFaceCycle.
  face.sides = [...arc0Sides, faceChordSide];
  face.innerLoops = [];
  rewireFaceCycle(face);

  // Update transforms across the split. Each HE's transform maps its own
  // face's frame to its twin's face's frame; if either endpoint moved
  // (i.e. is in arc1Set, hence now lives in `fresh` instead of `face`),
  // the transform must be conjugated to absorb the frame shift.
  //
  // Rules (with offset_face = (0, 0), offset_fresh = freshOffset):
  //   - me in arc1, twin in arc1 (both moved):
  //       T_new = translate(-fresh) · T_old · translate(+fresh)
  //   - me in arc1, twin elsewhere (external or kept):
  //       T_new = T_old · translate(+fresh)
  //   - me elsewhere, twin in arc1:
  //       T_new = translate(-fresh) · T_old
  //   - neither: unchanged.
  //
  // Each HE updates its own transform independently — symmetric pairs are
  // both visited and both get the right answer; asymmetric wraps (where
  // partner.twin !== me) work by construction because we only ever touch
  // *our* transform based on where *we* point.
  //
  // The chord HEs themselves were just allocated and explicitly twinned;
  // skip them so we don't double-conjugate.
  if (freshOffset.x !== 0 || freshOffset.y !== 0) {
    const posOff = M.fromTranslate(freshOffset.x, freshOffset.y);
    const negOff = M.fromTranslate(-freshOffset.x, -freshOffset.y);
    // Iterate Stitches (the source of truth); for each, rewrite both
    // transformAtoB and transformBtoA when an endpoint is in arc1Set.
    // Skip the freshly-installed chord stitch — already correct.
    // `setTransforms` is the only Stitch transform mutation entry point;
    // it routes through `atlas.markLinksDirty()` which is batched by the
    // outer `atlas.mutate(...)` wrapper around this whole function.
    for (const s of atlas.stitches) {
      if (s.a === faceChordSide || s.b === faceChordSide) continue;
      const aInArc1 = arc1Set.has(s.a);
      const bInArc1 = arc1Set.has(s.b);
      if (!aInArc1 && !bInArc1) continue;
      let TAB = s.transformAtoB;
      if (aInArc1) TAB = M.multiply(TAB, posOff);
      if (bInArc1) TAB = M.multiply(negOff, TAB);
      let TBA = s.transformBtoA;
      if (bInArc1) TBA = M.multiply(TBA, posOff);
      if (aInArc1) TBA = M.multiply(negOff, TBA);
      s.setTransforms(TAB, TBA);
    }
  }

  // Register the new face and its two new chord HEs with the atlas.
  // The arc1 HEs that moved to `fresh` are already in `atlas.sides` —
  // they kept their object identity, only their .face pointer changed.
  atlas.sides.push(faceChordSide, freshChordSide);
  atlas.faces.push(fresh);

  return { face, fresh, faceChordSide, freshChordSide, freshOffset };
}

/**
 * Split `face` along a chord whose endpoints are described by two
 * {@link BoundaryHit}s on `face`'s boundary. Composes
 * {@link subdivideSide} (to materialise each chord endpoint as an actual
 * vertex when it lands mid-side) followed by {@link splitFaceAtVertices}.
 *
 * Side-effect: subdividing a stitched side also subdivides the partner
 * face's side (introducing one collinear chain vertex over there — see
 * {@link subdivideSide}). Arc subdivisions only touch `face`.
 *
 * `anchor` (in `face`-local coordinates) is required when both
 * boundary hits are at-infinity (i.e. both endpoints will be ideal); see
 * {@link splitFaceAtVertices}. Otherwise it's ignored — the chord is
 * already pinpointed by its finite endpoint(s). Callers walking a finite
 * line through the face typically pass the seam point.
 *
 * Result ordering: `faces[0]` is the side reached by walking CCW around the
 * original face from `entryHit` to `exitHit` — geometrically, the *right*
 * of the directed chord `entry → exit`. `faces[1]` is the *left* side.
 */
export function splitFaceAlongChord(
  atlas: Atlas,
  face: Face,
  entryHit: BoundaryHit,
  exitHit: BoundaryHit,
  anchor: Point | null = null,
): SplitChordResult {
  if (!atlas.faces.includes(face)) {
    throw new Error('splitFaceAlongChord: face not in atlas');
  }
  if (entryHit.he.face !== face) {
    throw new Error('splitFaceAlongChord: entryHit.he is not on face');
  }
  if (exitHit.he.face !== face) {
    throw new Error('splitFaceAlongChord: exitHit.he is not on face');
  }
  if (entryHit.he === exitHit.he) {
    throw new Error('splitFaceAlongChord: entry and exit hits on the same half-edge');
  }

  // ---- materialise each hit as an actual vertex (subdivide if needed) ----

  const eps = 1e-9;

  /**
   * Materialise a boundary hit to the half-edge whose `origin()` IS the
   * chord-endpoint vertex. Subdivides the hit's host edge in place if the
   * vertex doesn't already exist there.
   *
   * Uniform across hit kinds: lift the hit's location into a `HomPoint`,
   * then short-circuit if the side's origin or target already equals that
   * point — otherwise subdivide. The previous five-case kind switch
   * (finite-finite / non-FF / chord / arc-origin / arc-target) collapses
   * because `HomPoint.equals` natively distinguishes finite-vs-ideal and
   * the chord case (ideal endpoints, finite hit) never short-circuits
   * since ideal endpoints can't equal a finite query point.
   */
  const materialise = (hit: BoundaryHit): Side => {
    const hitPoint =
      hit.kind === 'finite'
        ? HomPoint.finite(hit.point.x, hit.point.y)
        : HomPoint.idealDir(hit.idealDir.x, hit.idealDir.y);
    if (hit.he.origin().equals(hitPoint, eps)) return hit.he;
    if (hit.he.target().equals(hitPoint, eps)) return hit.he.next;
    const at = hit.kind === 'finite' ? hit.point : hit.idealDir;
    const r = subdivideSide(atlas, hit.he, at);
    return r.faceHalves[1];
  };

  // Subdivision is in-place and preserves Face identity; HE object references
  // for the OTHER hit's `.he` remain valid even if their array index shifts.
  const entryVertSide = materialise(entryHit);
  const exitVertSide = materialise(exitHit);

  if (entryVertSide === exitVertSide) {
    throw new Error('splitFaceAlongChord: entry and exit collapsed to the same vertex');
  }

  const entryIdx = face.sides.indexOf(entryVertSide);
  const exitIdx = face.sides.indexOf(exitVertSide);
  if (entryIdx < 0 || exitIdx < 0) {
    throw new Error('splitFaceAlongChord: post-materialisation vertex HE not in face');
  }

  return splitFaceAtVertices(atlas, face, entryIdx, exitIdx, anchor);
}

/**
 * Strict inverse of {@link splitFaceAtVertices}. Fuses two faces sharing
 * a chord stitch into a single face along that chord. The face owning
 * `sharedChordSide` is **kept** (its identity preserved); the partner
 * face is **deleted**.
 *
 * **API rationale.** The argument is a chord side; its `.face` is the
 * survivor. The natural round-trip:
 * `mergeFaces(atlas, splitFaceAtVertices(atlas, f, vA, vB).faceChordSide).face === f`.
 * Pass the *other* chord side instead (`freshChordSide`) to keep the
 * fresh half and delete the original.
 *
 * **Preconditions** (each violation throws a clearly-named error):
 *  - `sharedChordSide ∈ atlas.sides` and `sharedChordSide.stitch !== null`
 *  - The chord stitch's two endpoints are in *different* faces
 *    (refuse self-stitched chords — those are wrap loops, not splits)
 *  - The chord stitch's `transformAtoB` is a **pure translation**
 *    (linear part = identity). Klein-bottle / rotated chord stitches are
 *    not flattenable to a single face; they're refused with a clear error.
 *  - The fresh face is not the source or target of any {@link Link}
 *    (caller migrates first; strict-inverse contract)
 *  - The fresh face's `shapes` set is empty (caller migrates first)
 *  - The fresh face is not the atlas root
 *
 * **Effect** (atomic, inside `atlas.mutate`):
 *  1. Recover `freshOffset` from the chord stitch transform.
 *  2. Unstitch the chord pair.
 *  3. Shift every fresh-side finite vertex by `+freshOffset` (un-do
 *     `splitFaceAtVertices`'s re-anchoring); shift every fresh-side
 *     chord anchor by `+freshOffset`.
 *  4. Un-conjugate every stitch with an endpoint in fresh's sides
 *     (outer + inner loops minus the chord side) by `-freshOffset` —
 *     mirrors `splitFaceAtVertices`'s `+freshOffset` conjugation.
 *  5. Splice fresh's outer loop (minus its chord side, in CCW order
 *     starting at `freshChordSide.next`) into kept's outer loop in
 *     place of `sharedChordSide`. Re-parent the moved sides to kept.
 *  6. Migrate `fresh.innerLoops` (already coordinate-shifted in step 3)
 *     into `kept.innerLoops`; re-parent their sides to kept.
 *  7. Remove both chord sides from `atlas.sides`.
 *  8. Empty `fresh.sides` / `fresh.innerLoops`, then `deleteFace(atlas, fresh)`.
 *
 * **Identity preservation:** `kept` keeps its identity (its `.frame`,
 * `.shapes`, and outer-loop side references for the kept arc are
 * unchanged); the fresh face is deleted.
 *
 * Returns `{ face: kept }` for caller convenience (mirrors
 * `splitFaceAtVertices`'s return shape).
 */
export function mergeFaces(atlas: Atlas, sharedChordSide: Side): { face: Face } {
  if (!atlas.sides.includes(sharedChordSide)) {
    throw new Error('mergeFaces: sharedChordSide not in atlas');
  }
  const chordStitch = sharedChordSide.stitch;
  if (chordStitch === null) {
    throw new Error('mergeFaces: sharedChordSide is not stitched');
  }
  const partnerSide = chordStitch.other(sharedChordSide);
  const kept = sharedChordSide.face;
  const fresh = partnerSide.face;
  if (kept === fresh) {
    throw new Error('mergeFaces: chord stitch is a self-loop on one face (this is a wrap, not a split)');
  }
  if (fresh === atlas.root) {
    throw new Error('mergeFaces: fresh face is the atlas root; merge would orphan it');
  }
  if (fresh.shapes.size > 0) {
    throw new Error(`mergeFaces: fresh face has ${fresh.shapes.size} shape(s) assigned; migrate them before merging`);
  }
  for (const link of atlas.links) {
    if (link.from === fresh || link.to === fresh) {
      throw new Error('mergeFaces: fresh face is a source or target of a Link; unlink before merging');
    }
  }

  // Pure-translation check on the chord stitch transform. The merge
  // un-does `splitFaceAtVertices`'s pure-translation re-anchoring; if
  // the chord stitch has been replaced (e.g. by a Klein-bottle wrap)
  // with a non-translation transform, there's no valid single-face
  // result and we refuse explicitly.
  const T = chordStitch.transformFrom(sharedChordSide);
  const eps = 1e-9;
  if (Math.abs(T.a - 1) > eps || Math.abs(T.d - 1) > eps || Math.abs(T.b) > eps || Math.abs(T.c) > eps) {
    throw new Error('mergeFaces: chord stitch must be a pure translation');
  }
  // T_keptToFresh = translate(-freshOffset)  ⟹  freshOffset = -(T.e, T.f).
  const freshOffset: Point = { x: -T.e, y: -T.f };

  // Recover fresh's "kept-frame" sides (everything except the chord we're
  // about to delete). These are the sides that need coordinate-shifting
  // and stitch un-conjugation. Capture references *before* mutation.
  const freshChordIdx = fresh.sides.indexOf(partnerSide);
  if (freshChordIdx < 0) {
    throw new Error('mergeFaces: chord stitch endpoint not on fresh face outer loop');
  }
  const freshOuterLen = fresh.sides.length;
  const arc1Sides: Side[] = [];
  // CCW order starting just after the chord side: this is the order in
  // which the splice into kept's outer loop should appear.
  for (let i = 1; i < freshOuterLen; i++) {
    arc1Sides.push(fresh.sides[(freshChordIdx + i) % freshOuterLen]);
  }
  // arc1 set for stitch un-conjugation: outer arc1 + every inner-loop side.
  const arc1Set = new Set<Side>(arc1Sides);
  for (const loop of fresh.innerLoops) {
    for (const s of loop) arc1Set.add(s);
  }

  atlas.mutate(() => {
    // 1. Drop the chord stitch first so the chord sides become free; this
    //    lets the subsequent splices and the final deleteFace proceed
    //    against the strict-inverse precondition (no stitched sides).
    unstitch(chordStitch);

    // 2 + 3. Shift fresh-side points and chord anchors back into kept's frame.
    // `applyAffine` is uniform: translates finite, no-ops on ideal directions.
    const T_unshift = M.fromTranslate(freshOffset.x, freshOffset.y);
    for (const s of arc1Set) {
      s.a = s.a.applyAffine(T_unshift);
      if (s.anchor !== null) {
        s.anchor = { x: s.anchor.x + freshOffset.x, y: s.anchor.y + freshOffset.y };
      }
    }

    // 4. Un-conjugate stitches whose endpoints are in arc1Set. Mirrors
    //    `splitFaceAtVertices`'s conjugation but with negOff/posOff swapped
    //    so the net effect is identity.
    if (freshOffset.x !== 0 || freshOffset.y !== 0) {
      const negOff = M.fromTranslate(-freshOffset.x, -freshOffset.y);
      const posOff = M.fromTranslate(freshOffset.x, freshOffset.y);
      for (const s of atlas.stitches) {
        const aInArc1 = arc1Set.has(s.a);
        const bInArc1 = arc1Set.has(s.b);
        if (!aInArc1 && !bInArc1) continue;
        let TAB = s.transformAtoB;
        if (aInArc1) TAB = M.multiply(TAB, negOff);
        if (bInArc1) TAB = M.multiply(posOff, TAB);
        let TBA = s.transformBtoA;
        if (bInArc1) TBA = M.multiply(TBA, negOff);
        if (aInArc1) TBA = M.multiply(posOff, TBA);
        s.setTransforms(TAB, TBA);
      }
    }

    // 5. Splice arc1Sides into kept's outer loop in place of sharedChordSide.
    const keptChordIdx = kept.sides.indexOf(sharedChordSide);
    kept.sides.splice(keptChordIdx, 1, ...arc1Sides);
    for (const s of arc1Sides) s.face = kept;
    rewireFaceCycle(kept);

    // 6. Migrate fresh.innerLoops to kept.
    for (const loop of fresh.innerLoops) {
      for (const s of loop) s.face = kept;
      kept.innerLoops.push(loop);
    }
    fresh.innerLoops = [];

    // 7. Remove the chord sides from atlas.sides.
    atlas.sides = atlas.sides.filter((s) => s !== sharedChordSide && s !== partnerSide);

    // 8. Empty fresh.sides so deleteFace's allSides() loop has nothing to
    //    re-iterate (the arc1 sides have been re-parented to kept).
    fresh.sides = [];
    deleteFace(atlas, fresh);
  });

  return { face: kept };
}

// ----------------------------------------------------------------------------
// Internal helpers for atlas mutation
// ----------------------------------------------------------------------------

/**
 * Re-establish `next`, `prev`, and `face` pointers across `face.sides`
 * after an in-place mutation that changed the array's contents/length.
 */
function rewireFaceCycle(face: Face) {
  const k = face.sides.length;
  for (let i = 0; i < k; i++) {
    const he = face.sides[i];
    he.face = face;
    he.next = face.sides[(i + 1) % k];
    he.prev = face.sides[(i - 1 + k) % k];
  }
}

/**
 * Internal helper: install (or update) a reciprocal {@link Stitch} between
 * two sides. Returns the resulting Stitch. Used by the symmetric mutation
 * primitives ({@link splitFaceAtVertices}, {@link subdivideSide},
 * {@link insertStrip}) and by the public {@link stitch} export.
 *
 * Three cases:
 *  - Both `a` and `b` already share the same Stitch: just update its
 *    transforms in place — same Stitch identity is preserved (the
 *    resize-an-existing-pair case, e.g. {@link resizeStrip}).
 *  - One or both has a different/dangling Stitch: clear back-refs on the
 *    stale Stitch's endpoints, then allocate a fresh Stitch.
 *  - Neither has a Stitch: allocate a fresh Stitch.
 */
function setTwin(atlas: Atlas, a: Side, b: Side, transformAB: M.Matrix2D, transformBA: M.Matrix2D): Stitch {
  if (a.stitch !== null && a.stitch === b.stitch) {
    const s = a.stitch;
    // Same-pair update: keep Stitch identity, refresh transforms (handle
    // either orientation of (a, b) versus (s.a, s.b)). `setTransforms`
    // calls `atlas.markLinksDirty()` for us.
    if (s.a === a) {
      s.setTransforms(transformAB, transformBA);
    } else {
      s.setTransforms(transformBA, transformAB);
    }
    return s;
  }
  if (a.stitch !== null) {
    const s = a.stitch;
    s.a.stitch = null;
    s.b.stitch = null;
  }
  if (b.stitch !== null) {
    const s = b.stitch;
    s.a.stitch = null;
    s.b.stitch = null;
  }
  const fresh = new Stitch(atlas, a, b, transformAB, transformBA);
  a.stitch = fresh;
  b.stitch = fresh;
  // New stitch: chain reachability changed, so any existing Link whose
  // BFS path now picks this stitch needs re-derivation.
  atlas.markLinksDirty();
  return fresh;
}

function attachFace(atlas: Atlas, face: Face) {
  atlas.faces.push(face);
  for (const he of face.allSides()) atlas.sides.push(he);
}

/**
 * BFS from `from` to `target` via stitches only (no link traversal).
 * Returns the composite mapping `target`-frame → `from`-frame, or `null`
 * if `target` is unreachable from `from` via stitches.
 */
function bfsCompositeViaStitchesOnly(atlas: Atlas, from: Face, target: Face): M.Matrix2D | null {
  const out = new Map<Face, M.Matrix2D>();
  out.set(from, M.fromValues());
  if (from === target) return out.get(from)!;
  const queue: Face[] = [from];
  while (queue.length > 0) {
    const f = queue.shift()!;
    const mf = out.get(f)!;
    for (const he of f.sidesCCW()) {
      const twin = he.twin;
      if (!twin || out.has(twin.face)) continue;
      const composite = M.multiply(mf, M.invert(he.transform));
      if (twin.face === target) return composite;
      out.set(twin.face, composite);
      queue.push(twin.face);
    }
  }
  void atlas;
  return null;
}

/**
 * Re-derive every {@link Link}'s `transform` from the current stitch
 * chain `link.from → link.to`. Called by {@link splitFaceAtVertices}
 * after stitch conjugation AND by {@link insertStrip} after the strip's
 * chord stitches replace the temporary kept↔fresh chord stitch.
 *
 * **Why this is needed.** Wrap-on captures `link.transform` as a
 * snapshot of the original outer↔region stitch transform. Subsequent
 * mutations (cuts that conjugate stitches, strip insertions that re-wire
 * stitches with strip-thickness offsets) shift `composite(link.to from
 * link.from)` along the surviving stitch chain, but `link.transform`
 * stays frozen. With multiple Links to the same wrapped region (e.g. a
 * cylinder's left- and right-side Links), BFS from different roots picks
 * different links and the two link-derived composites drift apart by the
 * accumulated stitch conjugations — visible as "the wrapped region stays
 * in place while everything else shifts by the strip thickness" when the
 * BFS root crosses the cut.
 *
 * The fix: every time the substrate mutates stitches in a way that could
 * shift the chain composite (`splitFaceAtVertices`, `insertStrip`),
 * recompute every Link's transform from the post-mutation chain. This
 * keeps the link consistent with the stitch reality, and consistent with
 * any sibling link to the same target.
 *
 * Self-links (`from === to`, recursive-zoom pattern) are left alone:
 * there's no stitch chain to derive from, and the self-link's transform
 * is the deliberate recursive transform.
 *
 * Closed-surface targets (e.g. a torus region whose every wrap-axis edge
 * is self-stitched) are unreachable from outside via stitches, so
 * `bfsCompositeViaStitchesOnly` returns `null` and the Link is left
 * untouched — its transform is the *only* placement of the region.
 */
function recomputeLinkTransformsFromStitchChain(atlas: Atlas): void {
  for (const link of atlas.links) {
    // Only chain-tracked links get auto-updated. Non-tracked links
    // (manual placements, self-links, closed-surface targets) hold their
    // caller-supplied transform verbatim — see {@link Link.tracksStitchChain}.
    if (!link.tracksStitchChain) continue;
    const composite = bfsCompositeViaStitchesOnly(atlas, link.from, link.to);
    if (composite) {
      link.transform = composite;
    }
  }
}

/**
 * Build a fresh face from a CCW polygon of {@link HomPoint}s and register
 * it with `atlas`. Returns the new {@link Face}; its `sides` array follows
 * the input point order, so callers can index `face.sides[i]` to find
 * the side whose origin is `points[i]` for subsequent stitching.
 *
 * The new sides are unstitched and unlinked — caller wires whatever
 * topology they need afterwards.
 *
 * `options.anchors` provides per-side line-pinning anchors for ideal-ideal
 * chord sides (a finite point on the chord line, in face-local
 * coordinates). Map keys are side indices into `points`. Required for
 * any side whose origin AND target (= next point) are both ideal and
 * antipodal, ignored otherwise — matching the {@link Side.anchor}
 * convention. See the {@link Side} class doc for why ideal-ideal chords
 * need an anchor.
 *
 * `options.frame` defaults to identity. Pass an existing frame to align
 * the new face with another (e.g. `splitFaceAtVertices` reuses the parent
 * face's frame for its `fresh` half).
 */
export function createFace(
  atlas: Atlas,
  points: ReadonlyArray<HomPoint>,
  options?: {
    anchors?: ReadonlyMap<number, Point>;
    frame?: M.Matrix2D;
  },
): Face {
  if (points.length < 2) {
    throw new Error(`createFace: need at least 2 sides, got ${points.length}`);
  }
  const sides: Side[] = points.map((p) => new Side(p));
  if (options?.anchors) {
    for (const [i, p] of options.anchors) {
      if (i < 0 || i >= sides.length) {
        throw new Error(`createFace: anchor index ${i} out of range`);
      }
      sides[i].anchor = { x: p.x, y: p.y };
    }
  }
  const face = new Face(sides, [], options?.frame);
  attachFace(atlas, face);
  return face;
}

/**
 * Strict inverse of {@link createFace}. Removes `face` from the atlas
 * and de-registers all of its sides (outer loop + every inner loop).
 *
 * Strict-inverse contract: `face` must be in the same shape `createFace`
 * produces — fully unbound. The caller is responsible for `unstitch`-ing
 * any stitched sides, `unlink`-ing any incident Links, and migrating any
 * shapes off the face *before* calling `deleteFace`. Forced-delete-with-
 * cleanup is a macro layered on top, not a substrate primitive.
 *
 * **Preconditions** (each violation throws a clearly-named error):
 *  - `face` is in `atlas.faces`
 *  - `face !== atlas.root`
 *  - Every side of `face` (outer + every inner loop) has `stitch === null`
 *  - `face` is not the source or target of any {@link Link}
 *  - `face.shapes.size === 0`
 *
 * **Effect:**
 *  - Removes `face` from `atlas.faces`
 *  - Removes every side of `face` from `atlas.sides`
 *
 * **Does not:**
 *  - Touch any other face's state (no stitches to invalidate per
 *    precondition; no chain-composite recompute needed since no Stitch
 *    transforms changed)
 *  - Modify `face`'s side objects (they remain reachable through the
 *    returned-but-unrooted face if the caller kept a reference; this is
 *    the symmetric equivalent of `createFace` returning the new face)
 *
 * Symmetric round-trip: `createFace(atlas, j) → deleteFace(atlas, f)`
 * leaves `atlas.faces` and `atlas.sides` structurally identical to their
 * pre-call state.
 */
export function deleteFace(atlas: Atlas, face: Face): void {
  if (!atlas.faces.includes(face)) {
    throw new Error('deleteFace: face not in atlas');
  }
  if (face === atlas.root) {
    throw new Error('deleteFace: cannot delete the atlas root');
  }
  for (const s of face.allSides()) {
    if (s.stitch !== null) {
      throw new Error('deleteFace: face has stitched sides; unstitch them before deleting');
    }
  }
  for (const link of atlas.links) {
    if (link.from === face || link.to === face) {
      throw new Error('deleteFace: face is a source or target of a Link; unlink before deleting');
    }
  }
  if (face.shapes.size > 0) {
    throw new Error(`deleteFace: face has ${face.shapes.size} shape(s) assigned; migrate them before deleting`);
  }

  // Free of bindings. Drop sides and the face from the atlas registries.
  // Use a Set for O(1) `has` against the face's side roster (could include
  // 30+ sides for a region with inner loops); a linear filter is then one
  // pass over `atlas.sides` instead of N filters.
  const toRemove = new Set<Side>();
  for (const s of face.allSides()) toRemove.add(s);
  atlas.sides = atlas.sides.filter((s) => !toRemove.has(s));
  const fIdx = atlas.faces.indexOf(face);
  atlas.faces.splice(fIdx, 1);
}

// ----------------------------------------------------------------------------
// Line-walking primitive (line cut traversal)
// ----------------------------------------------------------------------------

/**
 * Where a line passes through one boundary of a face. Used by {@link walkLine}.
 * Discriminated by `kind`:
 *  - `'finite'` — line crosses a non-arc side at a finite point. `point`
 *    is the intersection in the face's local frame; `u` is the side
 *    parameter (range depends on side `kind`: `[0,1]` for segment,
 *    `[0,∞)` for ray/antiRay, `(-∞,∞)` for chord).
 *  - `'ideal'` — line exits through an at-infinity arc, or through an
 *    ideal "corner" between two finite-bearing sides (see {@link findExit}).
 *    `idealDir` is the unit line direction in the face's frame.
 */
export interface FiniteBoundaryHit {
  kind: 'finite';
  he: Side;
  point: Point;
  u: number;
}

/**
 * An at-infinity hit: the line exits through an at-infinity arc (or a
 * "corner exit" — see {@link findExit}) in direction `idealDir`. There's
 * no finite point on the boundary; `idealDir` is the unit direction in
 * the host face's frame.
 */
export interface IdealBoundaryHit {
  kind: 'ideal';
  he: Side;
  idealDir: Point;
}

export type BoundaryHit = FiniteBoundaryHit | IdealBoundaryHit;

/**
 * One face crossed by a walked line. The `entry` is where the line enters
 * the face (going in `+direction`); the `exit` is where it leaves. For the
 * host face only, `entry` is `null` (the line starts at `seam` inside the
 * face — see {@link walkLine}'s return shape).
 */
export interface FaceCrossing {
  face: Face;
  entry: BoundaryHit | null;
  exit: BoundaryHit;
  /** Line direction (unit) in this face's local frame. */
  direction: Point;
  /** True if `seam` is in this face's interior. */
  isHost: boolean;
  /** Seam point in this face's local frame (only set when `isHost`). */
  seam: Point | null;
}

const WALK_EPS = 1e-9;

/**
 * Find where the line `p + s * d` (s > eps) exits `face`. Returns `null` if
 * no forward exit exists (degenerate face / numerical issue) or if the only
 * candidate exit would equal `excludeSide` (the boundary the line just entered).
 *
 * Three exit kinds are supported, in priority order:
 *
 *   1. **Finite hit** — line crosses a finite-bearing edge at a finite point.
 *      Returned with `point` set, `idealDir` null.
 *   2. **Arc exit** — line exits through an at-infinity arc edge (ideal-ideal).
 *      Returned with `point` null, `idealDir` set to the line direction.
 *   3. **Corner exit** — line exits through an ideal vertex shared between two
 *      finite-bearing edges (an "infinite corner"). This happens when the line
 *      direction is parallel to both adjacent edges and there's no arc to use.
 *      Such a corner is created whenever a chord materialises *at* an existing
 *      arc-endpoint vertex (the arc on the other side of the chord lives on,
 *      but on this side the corner is no longer protected by an arc), then a
 *      subsequent parallel cut tries to exit through it. Returned with `point`
 *      null, `idealDir` set to the line direction, and `he` chosen so its
 *      origin matches `idealDir` — this lets the existing materialise() in
 *      splitFaceAlongChord short-circuit cleanly without arc subdivision.
 */
function findExit(face: Face, p: Point, d: Point, excludeSide: Side | null, eps = WALK_EPS): BoundaryHit | null {
  let best: { he: Side; s: number; u: number } | null = null;
  let arcExit: Side | null = null;

  for (const he of face.sidesCCW()) {
    if (he === excludeSide) continue;
    if (he.kind === 'arc') {
      const a = he.origin();
      const b = he.next.origin();
      // Use `>= -eps` (rather than `> eps`) so the line direction may exactly
      // coincide with one of the arc's ideal endpoints. Geometrically the
      // line still exits through that ideal vertex; a strictly-inside check
      // wrongly rejects axis-aligned directions in cardinal seed wedges
      // (e.g. d=(1,0) inside the +x/+y wedge whose arc spans (1,0)→(0,1)).
      if (cross(a.x, a.y, d.x, d.y) >= -eps && cross(d.x, d.y, b.x, b.y) >= -eps) {
        arcExit = he;
      }
      continue;
    }
    const hit = intersectLineWithSide(p, d, he, eps);
    if (!hit) continue;
    if (best === null || hit.s < best.s) best = { he, s: hit.s, u: hit.u };
  }

  if (best) {
    return {
      kind: 'finite',
      he: best.he,
      point: pointOnSideAtU(best.he, best.u),
      u: best.u,
    };
  }
  if (arcExit) {
    return { kind: 'ideal', he: arcExit, idealDir: { x: d.x, y: d.y } };
  }

  // Corner exit. Look for an ideal vertex of `face` whose direction matches
  // `d` and which is bounded on both sides by finite-bearing (non-arc) edges.
  // Skip vertices adjacent to an arc — those are already handled by the
  // arcExit branch above. `d` is unit-length; ideal-vertex directions are
  // unit-length by construction.
  const cornerEps = 1e-6;
  for (const he of face.sidesCCW()) {
    if (he === excludeSide) continue;
    if (!he.a.isIdeal) continue;
    if (he.kind === 'arc') continue;
    if (he.prev.kind === 'arc') continue;
    const dx = d.x - he.a.x;
    const dy = d.y - he.a.y;
    if (dx * dx + dy * dy < cornerEps * cornerEps) {
      return { kind: 'ideal', he, idealDir: { x: d.x, y: d.y } };
    }
  }

  return null;
}

/**
 * Per-side ray parametrisation. Every non-arc side carries a finite line
 * `start + u · dir` with a u-range `[uMin, uMax]`; this helper extracts that
 * representation in one place so dispatch on side kind happens exactly once
 * per query path. The unified form replaces what used to be a 5-way `if`
 * cascade in every geometry helper that operated on a side.
 *
 * Returns `null` for at-infinity arcs (which have no finite parametrisation).
 *
 * Conventions per kind:
 *  - `segment` (finite → finite): `start = origin`, `dir = target − origin`,
 *    `u ∈ [0, 1]`. `|dir|` is the edge length.
 *  - `ray` (finite → ideal): `start = origin`, `dir = target's ideal
 *    direction` (unit vector), `u ∈ [0, ∞)`.
 *  - `antiRay` (ideal → finite): `start = target` (the finite end),
 *    `dir = origin's ideal direction` (unit vector), `u ∈ [0, ∞)`.
 *  - `chord` (ideal → ideal, `anchor !== null`): `start = anchor`, `dir =
 *    origin's ideal direction` (unit vector), `u ∈ (-∞, ∞)`.
 *
 * Because `dir` is unit-length for ray/antiRay/chord but a real edge vector
 * for segment, callers that compute distances from `dir` should normalise
 * by `|dir|²` (which equals 1 in the unit cases — so a single uniform
 * formula `((p − start) · dir) / |dir|²` works for every kind).
 */
function rayParam(side: Side): { start: Point; dir: Point; uMin: number; uMax: number } | null {
  const o = side.origin();
  const t = side.target();
  switch (side.kind) {
    case 'segment':
      return {
        start: { x: o.x, y: o.y },
        dir: { x: t.x - o.x, y: t.y - o.y },
        uMin: 0,
        uMax: 1,
      };
    case 'ray':
      return {
        start: { x: o.x, y: o.y },
        dir: { x: t.x, y: t.y },
        uMin: 0,
        uMax: Infinity,
      };
    case 'antiRay':
      return {
        start: { x: t.x, y: t.y },
        dir: { x: o.x, y: o.y },
        uMin: 0,
        uMax: Infinity,
      };
    case 'chord':
      return {
        start: side.anchor!,
        dir: { x: o.x, y: o.y },
        uMin: -Infinity,
        uMax: Infinity,
      };
    case 'arc':
      return null;
  }
}

/**
 * Intersect the parametric line `p + s * d` with side `side` (in the same
 * frame as `p` and `d`). Returns `(s, u)` for a valid forward intersection
 * (`s > eps`, `u` within the side's parameter range). At-infinity arcs
 * are handled separately by the caller (returns `null` here).
 */
function intersectLineWithSide(p: Point, d: Point, side: Side, eps: number): { s: number; u: number } | null {
  const r = rayParam(side);
  if (!r) return null;
  const det = r.dir.x * d.y - r.dir.y * d.x;
  if (Math.abs(det) < eps) return null;
  const rx = r.start.x - p.x;
  const ry = r.start.y - p.y;
  const s = (r.dir.x * ry - r.dir.y * rx) / det;
  const u = (d.x * ry - d.y * rx) / det;
  if (s < eps) return null;
  if (Number.isFinite(r.uMin) && u < r.uMin - eps) return null;
  if (Number.isFinite(r.uMax) && u > r.uMax + eps) return null;
  return { s, u: Math.max(r.uMin, Math.min(r.uMax, u)) };
}

/**
 * Position on `side` at edge-parameter `u`, in `side.face`'s local frame.
 *
 * Parameter conventions (matching {@link uOfPointOnSide}, see {@link rayParam}):
 *   - segment: `u ∈ [0, 1]`.
 *   - ray / antiRay: `u ∈ [0, ∞)`.
 *   - chord: `u ∈ (-∞, ∞)`, `u = 0` at `anchor`.
 *   - at-infinity arc: throws — there's no finite point on S¹.
 */
export function pointOnSideAtU(side: Side, u: number): Point {
  const r = rayParam(side);
  if (!r) throw new Error('pointOnSideAtU: at-infinity arc has no finite point');
  return { x: r.start.x + u * r.dir.x, y: r.start.y + u * r.dir.y };
}

/**
 * Compute the edge-parameter `u` of finite point `p` on side `side`
 * (in `side.face`'s frame), assuming `p` is collinear with the edge.
 * Parameter conventions match {@link pointOnSideAtU}.
 */
export function uOfPointOnSide(side: Side, p: Point): number {
  const r = rayParam(side);
  if (!r) throw new Error('uOfPointOnSide: at-infinity arc has no finite point');
  const len2 = r.dir.x * r.dir.x + r.dir.y * r.dir.y;
  return ((p.x - r.start.x) * r.dir.x + (p.y - r.start.y) * r.dir.y) / len2;
}

/**
 * Walk a line through the atlas, starting from `seam` (an interior point of
 * `host`) going in `+direction`, then again going in `-direction`. Returns the
 * full ordered chain of crossed faces, in line-traversal order from `-direction`
 * infinity to `+direction` infinity. The host appears once in the chain (with
 * `isHost: true` and `seam` set), with the line passing through both its
 * boundaries.
 *
 * The chain ends at faces whose exit half-edge has no twin (boundary edges)
 * — typically at-infinity arcs. Throws if a degenerate exit is found, e.g.
 * the line passes exactly through an existing vertex; callers should perturb.
 */
export function walkLine(host: Face, seam: Point, direction: Point): FaceCrossing[] {
  if (!polygonContainsStrict(host.junctions(), HomPoint.finite(seam.x, seam.y))) {
    throw new Error('walkLine: seam is not strictly interior to host');
  }
  const len = Math.hypot(direction.x, direction.y);
  if (len < WALK_EPS) throw new Error('walkLine: zero-length direction');
  const d = { x: direction.x / len, y: direction.y / len };
  const dNeg = { x: -d.x, y: -d.y };

  const forwardExit = findExit(host, seam, d, null);
  const backwardExit = findExit(host, seam, dNeg, null);
  if (!forwardExit) throw new Error('walkLine: no forward exit from host');
  if (!backwardExit) throw new Error('walkLine: no backward exit from host');

  const hostCrossing: FaceCrossing = {
    face: host,
    entry: backwardExit,
    exit: forwardExit,
    direction: d,
    isHost: true,
    seam,
  };

  const forwardChain = walkLineDirection(host, forwardExit, d);
  const backwardChain = walkLineDirection(host, backwardExit, dNeg);

  // Backward chain was walked in -d; flip each crossing so its
  // entry/exit/direction match +d (entry/exit swap, direction negated).
  const backwardChainFlipped = backwardChain.map<FaceCrossing>((c) => ({
    face: c.face,
    entry: c.exit,
    exit: c.entry!,
    direction: { x: -c.direction.x, y: -c.direction.y },
    isHost: false,
    seam: null,
  }));
  backwardChainFlipped.reverse();

  return [...backwardChainFlipped, hostCrossing, ...forwardChain];
}

/**
 * Walk forward from `startFace` after exiting through `startExit`. Stops at
 * a boundary (at-infinity arc or no-twin edge). Each returned crossing has
 * `entry` non-null (it's the boundary the line entered through).
 */
function walkLineDirection(startFace: Face, startExit: BoundaryHit, startDirection: Point): FaceCrossing[] {
  const out: FaceCrossing[] = [];
  let prevExit = startExit;
  let prevDirection = startDirection;
  let prevFace = startFace;

  const maxSteps = 256;
  for (let step = 0; step < maxSteps; step++) {
    if (!prevExit.he.twin) break;
    if (prevExit.he.kind === 'arc') break;
    if (prevExit.kind !== 'finite') break; // ideal-arc exit; can't cross into twin

    const twin = prevExit.he.twin;
    const T = prevExit.he.transform;
    const entryPointInTwin = M.applyToPoint(T, prevExit.point);
    // `applyAffine` on an ideal point applies only the linear part (the
    // translation column zeros out against w=0) and re-normalises the
    // result to unit length — exactly what we used to do via the
    // dedicated `applyLinearToDirection` + `Math.hypot` divide combo.
    const dirInTwinUnit = HomPoint.idealDir(prevDirection.x, prevDirection.y).applyAffine(T).dir();
    const uOnTwin = uOfPointOnSide(twin, entryPointInTwin);
    const entryHit: BoundaryHit = {
      kind: 'finite',
      he: twin,
      point: entryPointInTwin,
      u: uOnTwin,
    };

    const nextFace = twin.face;
    const exit = findExit(nextFace, entryPointInTwin, dirInTwinUnit, twin);
    if (!exit) throw new Error('walkLine: no forward exit from intermediate face');

    out.push({
      face: nextFace,
      entry: entryHit,
      exit,
      direction: dirInTwinUnit,
      isHost: false,
      seam: null,
    });

    prevExit = exit;
    prevDirection = dirInTwinUnit;
    prevFace = nextFace;
    if (!exit.he.twin) break;
    if (exit.he.kind === 'arc') break;
  }

  return out;
}

// ----------------------------------------------------------------------------
// Line cut: splitAlongLine
// ----------------------------------------------------------------------------

/**
 * One sub-face pair from a {@link splitAlongLine} chain step.
 *
 * `rightFace` is the sub-face on the *right* of the line direction at this
 * step (−perp side). It is the original Face object that was split, mutated
 * in place by the identity-preserving {@link splitFaceAtVertices} — its
 * frame and the coordinates of its kept vertices are unchanged.
 *
 * `leftFace` is on the *left* of the line direction (+perp side) and is
 * a freshly-allocated face. `leftOffset` is the re-anchor translation
 * applied to its frame: a point at parent-frame coordinates `p` is at
 * `(p.x - leftOffset.x, p.y - leftOffset.y)` in `leftFace`'s frame.
 *
 * `leftChordSide` and `rightChordSide` are the chord half-edges in their
 * respective sub-faces (twin pair within this step).
 */
export interface ChainSplitPair {
  rightFace: Face;
  leftFace: Face;
  rightChordSide: Side;
  leftChordSide: Side;
  /** Re-anchor offset of `leftFace`'s frame relative to the pre-split frame. */
  leftOffset: Point;
}

/**
 * Result of {@link splitAlongLine}: per-step sub-face pairs in the order
 * they were crossed by the walked line (from −direction infinity to
 * +direction infinity). For face-bounded cuts (`propagate: false`) `pairs`
 * has exactly one element — the host's split.
 *
 * Consumers (e.g. the line-cut tool gizmo) hold this result during a drag
 * so they can update the affected sub-faces in real-time as the chord is
 * pulled apart by a strip insertion.
 */
export interface SplitAlongLineResult {
  pairs: ChainSplitPair[];
}

export interface SplitAlongLineOptions {
  /**
   * When true (default), the line is propagated through the atlas — every
   * face crossed by the line is split, with chord HE pairs stitched
   * together across face boundaries. When false, only `host` is split;
   * neighbouring faces are untouched (the cut terminates at the host's
   * own boundary). Use `propagate: false` for region-creation primitives
   * where deep nested regions shouldn't slice every level above them.
   */
  propagate?: boolean;
}

/**
 * Captured geometry of a {@link BoundaryHit} for re-resolution after
 * intervening atlas mutations may have invalidated `hit.he`.
 */
type CapturedHit = { kind: 'finite'; point: Point } | { kind: 'ideal'; idealDir: Point };

function captureHit(hit: BoundaryHit): CapturedHit {
  if (hit.kind === 'finite') {
    return { kind: 'finite', point: { x: hit.point.x, y: hit.point.y } };
  }
  return { kind: 'ideal', idealDir: { x: hit.idealDir.x, y: hit.idealDir.y } };
}

/**
 * Find a finite-bearing side of `face` whose parameter range contains the
 * geometric point `p` (in `face`'s frame). Prefers a side whose origin
 * coincides with `p` (returns u=0) so chord-endpoint vertices created by
 * prior subdivisions are reused rather than duplicated.
 */
function findSideForFinitePoint(face: Face, p: Point): { he: Side; u: number } {
  const eps = 1e-7;
  // Prefer side whose ORIGIN matches p (existing vertex coincidence).
  for (const side of face.sides) {
    if (!side.a.isFinite) continue;
    if (Math.abs(side.a.x - p.x) < eps && Math.abs(side.a.y - p.y) < eps) {
      return { he: side, u: 0 };
    }
  }
  // Otherwise find any non-arc side that contains p in its parameter range
  // (with collinearity tolerance). Per-kind u-range comes from `rayParam`.
  for (const side of face.sides) {
    const r = rayParam(side);
    if (!r) continue; // at-infinity arc — no finite point on it
    const u = uOfPointOnSide(side, p);
    if (!Number.isFinite(u)) continue;
    if (Number.isFinite(r.uMin) && u < r.uMin - eps) continue;
    if (Number.isFinite(r.uMax) && u > r.uMax + eps) continue;
    const uClamped = Math.max(r.uMin, Math.min(r.uMax, u));
    const proj = pointOnSideAtU(side, uClamped);
    const dx = proj.x - p.x;
    const dy = proj.y - p.y;
    if (dx * dx + dy * dy < eps * eps) {
      return { he: side, u: uClamped };
    }
  }
  throw new Error(`findSideForFinitePoint: no side contains point (${p.x}, ${p.y})`);
}

/**
 * Find a half-edge on `face` whose `origin()` IS the ideal vertex with
 * direction `idealDir`, or — failing that — an at-infinity arc whose CCW
 * sweep contains it. Used by {@link refreshHit} to re-resolve a captured
 * ideal-exit after intervening face mutations.
 *
 * Two ideal-exit kinds need this:
 *   1. Arc exit: line exits through an at-infinity arc. The matching HE is
 *      either an arc whose origin equals `idealDir` (preferred — already at
 *      a vertex, materialise short-circuits) or any arc whose CCW sweep
 *      contains `idealDir` (will be subdivided).
 *   2. Corner exit ({@link findExit}): line exits through an ideal vertex
 *      bounded by two finite-bearing edges (no adjacent arc). The matching
 *      HE is the finite-bearing HE whose origin equals `idealDir`. There
 *      is no arc to fall back on; arc-sweep search will not find anything.
 *
 * The first loop covers both cases by accepting any HE (arc or finite-
 * bearing) whose origin matches the direction.
 */
function findSideForIdealDir(face: Face, idealDir: Point): Side {
  const eps = 1e-9;
  // Either an arc starting at idealDir, or a finite-bearing HE coming out
  // of the ideal corner (corner exit). materialise() short-circuits in
  // both cases since the chord endpoint already coincides with origin().
  for (const he of face.sides) {
    if (!he.a.isIdeal) continue;
    if (Math.abs(he.a.x - idealDir.x) >= eps) continue;
    if (Math.abs(he.a.y - idealDir.y) >= eps) continue;
    return he;
  }
  // Arc sweep fallback: a stale `idealDir` may sit strictly inside an arc
  // whose endpoints didn't yet contain a vertex matching it — materialise()
  // will subdivide.
  for (const he of face.sides) {
    if (he.kind !== 'arc') continue;
    const a = he.origin();
    const b = he.next.origin();
    if (cross(a.x, a.y, idealDir.x, idealDir.y) >= -eps && cross(idealDir.x, idealDir.y, b.x, b.y) >= -eps) {
      return he;
    }
  }
  throw new Error(`findSideForIdealDir: no at-infinity arc contains direction (${idealDir.x}, ${idealDir.y})`);
}

/**
 * Given a captured hit and a (possibly mutated) face, build a fresh
 * {@link BoundaryHit} with an HE reference that is guaranteed to be in
 * `face.sides`.
 */
function refreshHit(face: Face, captured: CapturedHit): BoundaryHit {
  if (captured.kind === 'finite') {
    const { he, u } = findSideForFinitePoint(face, captured.point);
    return { kind: 'finite', he, point: captured.point, u };
  }
  const he = findSideForIdealDir(face, captured.idealDir);
  return { kind: 'ideal', he, idealDir: captured.idealDir };
}

/**
 * Cut faces along a line. Composes {@link splitFaceAlongChord} per face,
 * optionally walking through twin edges to propagate the cut across the
 * atlas.
 *
 * Geometry:
 *   - `seam` must be strictly interior to `host` (in `host`'s local frame).
 *   - `direction` is a non-zero 2D vector; the function normalises it.
 *   - The cut is the chord through `seam` in `±direction`, clipped at each
 *     face's boundary.
 *
 * Behaviour by `options.propagate`:
 *   - `true` (default): line is propagated through the atlas via
 *     {@link walkLine}. Every face crossed is split; chord HEs across
 *     face boundaries are stitched. `pairs[i]` corresponds to the i-th
 *     face in the walk chain (−direction infinity to +direction infinity).
 *   - `false`: face-bounded cut — only `host` is split. Neighbouring faces
 *     are untouched (the cut terminates at the host's own boundary).
 *     Used by region-creation primitives where deep nested regions
 *     shouldn't slice every parent above them. Returns a `pairs` array
 *     with exactly one element.
 *
 * For each pair, `leftFace` is on the +perp side of the line direction
 * and `rightFace` is on the −perp side. `rightFace` always equals the
 * identity-preserved original; `leftFace` is freshly allocated.
 *
 * Limitations:
 * - The walked line must not pass exactly through an existing vertex
 *   (degenerate exit). Callers should perturb if needed.
 * - In the propagating case, throws if the chain visits the same face
 *   twice — a signal that the line crossed a wrapped edge and looped
 *   back. Refuses before any mutation so callers can recover.
 * - When a face's chord has both endpoints at infinity (e.g. cutting an
 *   all-ideal face entirely with no finite crossings), the chord line is
 *   recorded via {@link Side.anchor}. For the host face this anchor is
 *   `seam` directly; for non-host faces in a propagating chain we use
 *   the entry-hit's finite point when available.
 */
export function splitAlongLine(
  atlas: Atlas,
  host: Face,
  seam: Point,
  direction: Point,
  options: SplitAlongLineOptions = {},
): SplitAlongLineResult {
  const { propagate = true } = options;

  if (!atlas.faces.includes(host)) {
    throw new Error('splitAlongLine: host not in atlas');
  }
  if (!polygonContainsStrict(host.junctions(), HomPoint.finite(seam.x, seam.y))) {
    throw new Error('splitAlongLine: seam is not strictly interior to host');
  }
  const len = Math.hypot(direction.x, direction.y);
  if (len < WALK_EPS) throw new Error('splitAlongLine: zero-length direction');
  const d = { x: direction.x / len, y: direction.y / len };

  const toPair = (r: SplitChordResult): ChainSplitPair => ({
    rightFace: r.face,
    leftFace: r.fresh,
    rightChordSide: r.faceChordSide,
    leftChordSide: r.freshChordSide,
    leftOffset: r.freshOffset,
  });

  if (!propagate) {
    // Face-bounded path: find both boundary exits in `host` and split.
    // splitFaceAlongChord materialises both endpoints (subdividing host's
    // boundary edges if needed) but never reaches into their twins — so
    // only `host` is mutated. We pass `seam` as the chord anchor: it's a
    // finite point on the chord line, in `host`-local coordinates, which
    // is exactly what {@link splitFaceAtVertices} needs when both
    // boundary hits land at infinity.
    const dNeg = { x: -d.x, y: -d.y };
    const forwardExit = findExit(host, seam, d, null);
    if (!forwardExit) throw new Error('splitAlongLine: no forward exit from host');
    const backwardExit = findExit(host, seam, dNeg, null);
    if (!backwardExit) throw new Error('splitAlongLine: no backward exit from host');
    return atlas.mutate(() => {
      const r = splitFaceAlongChord(atlas, host, backwardExit, forwardExit, seam);
      return { pairs: [toPair(r)] };
    });
  }

  // Propagating path: walk the line, refuse on wrapped chains, split
  // each face. HE references go stale as we mutate; capture the geometric
  // position up front and re-resolve before each split.
  const chain = walkLine(host, seam, d);

  {
    const seen = new Set<Face>();
    for (const c of chain) {
      if (seen.has(c.face)) {
        throw new Error('splitAlongLine: cut crosses a wrapped (asymmetric) edge — refusing');
      }
      seen.add(c.face);
    }
  }

  // Capture each crossing's chord anchor for the ideal-ideal-chord case:
  // host crossings have `seam` directly; non-host crossings use the entry
  // hit's finite point when present.
  const captured = chain.map((c) => ({
    face: c.face,
    entry: c.entry ? captureHit(c.entry) : null,
    exit: captureHit(c.exit),
    anchor:
      c.isHost && c.seam
        ? { x: c.seam.x, y: c.seam.y }
        : c.entry && c.entry.kind === 'finite'
          ? { x: c.entry.point.x, y: c.entry.point.y }
          : null,
  }));

  for (const c of captured) {
    if (!c.entry) throw new Error('splitAlongLine: missing entry for crossing');
  }

  return atlas.mutate(() => {
    const pairs: ChainSplitPair[] = [];
    for (const c of captured) {
      const entryHit = refreshHit(c.face, c.entry!);
      const exitHit = refreshHit(c.face, c.exit);
      pairs.push(toPair(splitFaceAlongChord(atlas, c.face, entryHit, exitHit, c.anchor)));
    }
    return { pairs };
  });
}

// ----------------------------------------------------------------------------
// Atlas-level strip insertion: insertStrip
// ----------------------------------------------------------------------------

/**
 * Result of {@link insertStrip}: the new strip face, plus references to the
 * strip's bottom/top half-edges per chain step. The line-cut tool's gizmo
 * holds these so the strip can be re-shaped (heightened, narrowed) during
 * a drag — for now, that means tearing the strip down and re-inserting
 * with the new height; future versions could mutate vertex positions in
 * place.
 */
export interface InsertStripResult {
  stripFace: Face;
  /** Strip's bottom half-edge per chain step (twin of `splitResult.pairs[i].rightChordSide`). */
  bottomSides: Side[];
  /** Strip's top half-edge per chain step (twin of `splitResult.pairs[i].leftChordSide`). */
  topSides: Side[];
}

/**
 * Open the chord twin pairs from a {@link splitAlongLine} result by
 * `height` perpendicular to the line direction, inserting a single strip
 * face between the left (above) and right (below) sub-faces.
 *
 * Strip face shape: a long thin polygon spanning the entire chain, with
 * `2N` half-edges (`N` bottom edges twin to the right-side chords, `N`
 * top edges twin to the left-side chords). The two ideal vertices at
 * `±line direction infinity` appear once each as shared corners between
 * adjacent bottom/top half-edges (no separate "perpendicular end" arcs —
 * those would degenerate to zero-sweep arcs).
 *
 * **Digon strip (`N = 1`)**: when the chain consists of a single host
 * crossing — typically because the host was an all-ideal face like the
 * empty-canvas seed — the chord HE pair is ideal-ideal. The resulting
 * strip is a digon (k=2 face) bounded by two parallel chord HEs: bottom
 * twin to `rightChordSide`, top twin to `leftChordSide`, anchored `height`
 * perpendicular apart in the strip's local frame.
 *
 * Strip frame: global-aligned (translation-only twins, matching the rest
 * of the atlas). For `N >= 2`, anchored at the first interior chord-vertex
 * (the spoke crossing between the chain's first and second face) on the
 * bottom side. For `N = 1` (digon), anchored so the bottom chord passes
 * through `(0, 0)` (top chord through `height · perp`).
 *
 * Constraints:
 * - Chain length `N >= 1`.
 * - `height > 0`.
 *
 * Twin transforms: pure translations. Each chord twin pair `right ↔ strip`
 * uses `translate(stripPos − rightFacePos)` for the finite chord endpoint
 * (or chord anchors when both endpoints are ideal); the ideal endpoint
 * matches automatically because translation preserves direction. Same for
 * `left ↔ strip` on the top side.
 */
export function insertStrip(atlas: Atlas, splitResult: SplitAlongLineResult, height: number): InsertStripResult {
  const N = splitResult.pairs.length;
  if (N < 1) {
    throw new Error('insertStrip: chain must contain at least one face crossing');
  }
  if (!(height > 0)) {
    throw new Error('insertStrip: height must be positive');
  }
  // N=1 case: the strip face is a digon bounded by two parallel chords.
  // This is only valid when the underlying chord is ideal-ideal (the line
  // ran entirely through an unbounded face — e.g. an all-ideal seed). For
  // a single-face crossing with FINITE endpoints we'd need a 4-HE strip
  // (parallelogram with two free side boundaries), which isn't supported
  // yet — reject explicitly so callers get a clear signal.
  if (N === 1) {
    const r = splitResult.pairs[0].rightChordSide;
    if (!r.origin().isIdeal || !r.target().isIdeal) {
      throw new Error(
        'insertStrip: single-face chain with finite chord endpoints is not yet supported (only ideal-ideal chords produce a valid digon strip)',
      );
    }
  }

  // ---- Determine line direction d in any face's frame ----
  // Translation-only twins → d is the same across all faces and the strip.
  // rightChordSide goes B → A in -d direction; the chord's `line` exposes
  // a unit `tangent` oriented from target (A) to origin (B), which is +d.
  // Uniform across all endpoint-kind combinations — no per-case dispatch.
  if (splitResult.pairs.length === 0) {
    throw new Error('insertStrip: could not determine line direction');
  }
  const d = splitResult.pairs[0].rightChordSide.line.tangent;
  const perp = { x: -d.y, y: d.x };

  // ---- Strip-frame positions of finite chord vertices c[1..N-1] ----
  // c[i] is the spoke crossing between chain face[i-1] and face[i].
  // Anchor: c[1] = (0, 0). c[i] = c[i-1] + chordLen[i-1] * d, where
  // chordLen[k] is the (finite) chord length of chain step k (only
  // defined for middle steps k in [1, N-2]). For N=1 there are no
  // interior crossings — the strip-frame anchor is implicitly (0, 0)
  // on the bottom chord line (used by the chord-anchor setup below).
  const cPositions: Point[] = new Array(N + 1);
  if (N >= 2) cPositions[1] = { x: 0, y: 0 };
  for (let i = 2; i < N; i++) {
    const r = splitResult.pairs[i - 1].rightChordSide;
    const ro = r.origin();
    const rt = r.target();
    if (!ro.isFinite || !rt.isFinite) {
      throw new Error(`insertStrip: middle chain step ${i - 1} has non-finite chord (chain shape unexpected)`);
    }
    const chordLen = Math.hypot(ro.x - rt.x, ro.y - rt.y);
    cPositions[i] = {
      x: cPositions[i - 1].x + chordLen * d.x,
      y: cPositions[i - 1].y + chordLen * d.y,
    };
  }

  // ---- Per-chain-step vertex point at A or B side, on bot or top of strip ----
  // A is the −d-end vertex of step i; B is the +d-end vertex. For the
  // first/last step these are ideal (the line direction itself); for
  // interior steps they're the spoke-crossing finite vertices c[i] / c[i+1].
  const aJunction = (i: number, perpSide: 'bot' | 'top'): HomPoint => {
    if (i === 0) return HomPoint.idealDir(-d!.x, -d!.y);
    const p = cPositions[i];
    const dy = perpSide === 'top' ? height * perp.y : 0;
    const dx = perpSide === 'top' ? height * perp.x : 0;
    return HomPoint.finite(p.x + dx, p.y + dy);
  };
  const bJunction = (i: number, perpSide: 'bot' | 'top'): HomPoint => {
    if (i === N - 1) return HomPoint.idealDir(d!.x, d!.y);
    const p = cPositions[i + 1];
    const dy = perpSide === 'top' ? height * perp.y : 0;
    const dx = perpSide === 'top' ? height * perp.x : 0;
    return HomPoint.finite(p.x + dx, p.y + dy);
  };

  // ---- Strip face vertices in CCW order ----
  // Bottom edges go +d (B[0] → … → B[N-1]); top edges go −d (T[N-1] → … → T[0]).
  // CCW: [B[0], B[1], …, B[N-1], T[N-1], T[N-2], …, T[0]]. For N=1 this
  // is [B[0], T[0]] — a 2-HE digon between two parallel chord lines.
  const bottomJ: HomPoint[] = [];
  const topJ: HomPoint[] = [];
  for (let i = 0; i < N; i++) {
    bottomJ.push(aJunction(i, 'bot'));
    topJ.push(bJunction(i, 'top'));
  }
  const stripJ: HomPoint[] = [...bottomJ, ...topJ.slice().reverse()];

  // For N=1 (digon strip) both sides are ideal-ideal chords; pin them so
  // the slab has bottom at (0, 0) and top at height·perp. Index 0 is
  // the bottom chord, index 1 the top.
  const anchors =
    N === 1
      ? new Map<number, Point>([
          [0, { x: 0, y: 0 }],
          [1, { x: height * perp.x, y: height * perp.y }],
        ])
      : undefined;

  return atlas.mutate(() => {
    const stripFace = createFace(atlas, stripJ, { anchors });

    // stripFace.sides[i] follows stripJ[i]: bottom sides at indices 0..N-1,
    // top sides at indices N..2N-1 in reverse (T[N-1] first).
    const bottomSides: Side[] = stripFace.sides.slice(0, N);
    const topSides: Side[] = new Array(N);
    for (let i = 0; i < N; i++) topSides[i] = stripFace.sides[2 * N - 1 - i];

    // ---- Wire chord twin pairs to strip's bottom/top half-edges ----
    // T_CtoS is a pure translation from the chord's face frame to the strip
    // frame. Anchor the translation to whichever chord endpoint is finite
    // (or the chord anchor for N=1 ideal-ideal chords). The caller passes
    // the strip-frame junctions matching chord.origin / chord.target — the
    // mapping is direction-dependent (right chord goes B→A, left goes A→B).
    // `setTwin` calls `atlas.markLinksDirty()` per call; this outer mutate
    // batches them into a single Link recompute at commit, which captures
    // the full strip-routed chain (replacing the cut's temporary
    // kept↔fresh chord stitch with the strip's `height·perp` indirection).
    const stitchAndTranslate = (
      chord: Side,
      stripSide: Side,
      stripForOrigin: HomPoint,
      stripForTarget: HomPoint,
      stripAnchor: Point,
    ): void => {
      const co = chord.origin();
      const ct = chord.target();
      let off: Point;
      if (co.isFinite) {
        off = { x: stripForOrigin.x - co.x, y: stripForOrigin.y - co.y };
      } else if (ct.isFinite) {
        off = { x: stripForTarget.x - ct.x, y: stripForTarget.y - ct.y };
      } else {
        const a = chord.anchor!;
        off = { x: stripAnchor.x - a.x, y: stripAnchor.y - a.y };
      }
      const T_CtoS = M.fromTranslate(off.x, off.y);
      setTwin(atlas, chord, stripSide, T_CtoS, M.invert(T_CtoS));
    };

    const bottomAnchor: Point = { x: 0, y: 0 };
    const topAnchor: Point = { x: height * perp.x, y: height * perp.y };
    for (let i = 0; i < N; i++) {
      const r = splitResult.pairs[i].rightChordSide;
      const l = splitResult.pairs[i].leftChordSide;
      // Right chord r is B → A in rightFace frame; bottom strip side is
      // A → B in strip frame.
      stitchAndTranslate(r, bottomSides[i], bJunction(i, 'bot'), aJunction(i, 'bot'), bottomAnchor);
      // Left chord l is A → B in leftFace frame; top strip side is
      // B → A in strip frame.
      stitchAndTranslate(l, topSides[i], aJunction(i, 'top'), bJunction(i, 'top'), topAnchor);
    }

    return { stripFace, bottomSides, topSides };
  });
}

/**
 * Resize an existing strip's perpendicular thickness in place.
 *
 * Mutates only the +n (top) side of the strip:
 *  - Each finite `topSides[i]` origin shifts by `Δ · perp` in the strip's frame
 *    (where `Δ = newHeight − oldHeight`, `perp = (-d.y, d.x)`, the 90° CCW
 *    rotation of the line direction).
 *  - The `leftChordSide ↔ topSides[i]` twin transforms shift by the same `Δ · perp`,
 *    keeping the chord-image correspondence (`T · h.next.origin = h.twin.origin`)
 *    exact under the new height.
 *
 * Untouched (independent of `height` by construction):
 *  - `bottomSides` and `rightChordSide ↔ bottomSides[i]` twin transforms.
 *  - The strip face's anchor (`sides[0]`, which is `bottomSides[1]`).
 *
 * Visual effect: the −n side of the cut (the "right" side) stays planted,
 * while the +n side gets pushed away as the strip grows. This matches the
 * asymmetric expansion the line-cut UI uses (the "side being pushed"
 * matches the drag direction, with the line direction flipped to switch
 * sides as needed).
 *
 * Constraints:
 *  - `newHeight > 0`. Shrinking back to zero would make the strip
 *    degenerate and require a separate "remove strip" primitive.
 *  - `oldHeight` must be the strip's current thickness (callers track it
 *    alongside the `InsertStripResult`).
 *
 * Caller responsibilities:
 *  - Track `currentHeight` between successive `resizeStrip` calls; this
 *    function does not store it on the strip.
 *  - Call after the strip was created by {@link insertStrip}; passing a
 *    foreign strip/split pair is undefined behaviour.
 *
 * O(N) in the chain length. Performs no allocations beyond the
 * per-step transform matrices.
 */
export function resizeStrip(
  atlas: Atlas,
  stripResult: InsertStripResult,
  splitResult: SplitAlongLineResult,
  oldHeight: number,
  newHeight: number,
): void {
  if (!(newHeight > 0)) {
    throw new Error('resizeStrip: newHeight must be positive');
  }
  const N = stripResult.bottomSides.length;
  if (N !== splitResult.pairs.length) {
    throw new Error(`resizeStrip: chain length mismatch (strip ${N} vs split ${splitResult.pairs.length})`);
  }
  if (N < 1) {
    throw new Error('resizeStrip: invalid strip (chain length < 1)');
  }

  // ---- Recover the strip-frame line direction d (and perp = 90° CCW d) ----
  // Three strategies, in order of preference:
  //  (a) For N >= 3 there are two adjacent finite bottom origins (c[1], c[2]),
  //      and c[2] - c[1] = chordLen[1] · d. Direction is exact.
  //  (b) For N == 2 there is only c[1] on the bottom, so we read perp directly
  //      from topSides[0] - bottomSides[1] = oldHeight · perp, then derive d.
  //  (c) For N == 1 (digon strip from an ideal-ideal cut) all bottom/top HEs
  //      are ideal-ideal chords; d is one of the chord's ideal endpoints,
  //      and perp is recovered from the (top.anchor − bot.anchor)
  //      direction (which equals oldHeight · perp).
  let d: Point;
  if (N === 1) {
    const b = stripResult.bottomSides[0];
    const t = stripResult.topSides[0];
    if (b.kind !== 'chord' || t.kind !== 'chord') {
      throw new Error('resizeStrip: N=1 strip must have chord sides on bottom and top');
    }
    const o = t.origin();
    if (!o.isIdeal) {
      throw new Error('resizeStrip: N=1 chord origin must be ideal');
    }
    // `insertStrip` builds the digon strip so that `topSides[0].origin` is
    // the +d ideal vertex (per the bJunction(0, 'top') case where i ===
    // N-1). Reading the line direction off the top HE's origin keeps
    // `perp = (-d.y, d.x)` consistent with the original construction —
    // top anchor sat at `+height · perp`, so growing it by `Δ · perp`
    // moves it the right way.
    d = { x: o.x, y: o.y };
  } else {
    const b1 = stripResult.bottomSides[1].origin();
    if (!b1.isFinite) {
      throw new Error('resizeStrip: bottomSides[1] expected to be finite');
    }
    let dxRaw = 0;
    let dyRaw = 0;
    if (N >= 3) {
      const b2 = stripResult.bottomSides[2].origin();
      if (b2.isFinite) {
        dxRaw = b2.x - b1.x;
        dyRaw = b2.y - b1.y;
      }
    }
    if (dxRaw === 0 && dyRaw === 0) {
      // N == 2 fallback (or unexpected ideal middle origin): derive perp first.
      const t0 = stripResult.topSides[0].origin();
      if (!t0.isFinite) {
        throw new Error('resizeStrip: cannot recover line direction from strip');
      }
      const px = t0.x - b1.x;
      const py = t0.y - b1.y;
      const plen = Math.hypot(px, py);
      if (plen === 0) {
        throw new Error('resizeStrip: zero-thickness strip (oldHeight inconsistent)');
      }
      // perp = (px, py) / plen → d = 90° CW(perp) = (perp.y, -perp.x)
      d = { x: py / plen, y: -px / plen };
    } else {
      const dlen = Math.hypot(dxRaw, dyRaw);
      d = { x: dxRaw / dlen, y: dyRaw / dlen };
    }
  }
  const perp = { x: -d.y, y: d.x };
  const delta = newHeight - oldHeight;
  if (delta === 0) return;
  const dpx = delta * perp.x;
  const dpy = delta * perp.y;

  atlas.mutate(() => {
    // ---- Shift the strip's "top" boundary by Δ · perp ----
    // For finite top HEs we just bump the origin. For ideal-ideal chord
    // top HEs (the N=1 digon case, or any future case where insertStrip
    // put a chord at the top) we bump the chord anchor instead — the
    // ideal direction is translation-invariant, but the line through R²
    // shifts perpendicularly by exactly Δ · perp.
    // `applyAffine` shifts finite origins and is a no-op on ideal
    // directions; the chord-anchor shift is a separate concern (the
    // anchored real line through R² moves perpendicularly even when the
    // ideal endpoints don't).
    const T_topShift = M.fromTranslate(dpx, dpy);
    for (let i = 0; i < N; i++) {
      const t = stripResult.topSides[i];
      t.a = t.a.applyAffine(T_topShift);
      if (t.anchor !== null) {
        t.anchor = { x: t.anchor.x + dpx, y: t.anchor.y + dpy };
      }
    }

    // ---- Update left-chord twin transforms ----
    // Translation-only invariant: T_LtoS gains exactly Δ·perp on its
    // translation part. The linear part is identity (translation), so we
    // build the new matrix by adding to .e/.f and inverting for the
    // back-edge. `setTwin` calls `atlas.markLinksDirty()` per call; the
    // outer `mutate(...)` coalesces those into one Link recompute.
    for (let i = 0; i < N; i++) {
      const l = splitResult.pairs[i].leftChordSide;
      const t = stripResult.topSides[i];
      const oldT = l.transform;
      const T_LtoS = M.fromValues(oldT.a, oldT.b, oldT.c, oldT.d, oldT.e + dpx, oldT.f + dpy);
      const T_StoL = M.invert(T_LtoS);
      setTwin(atlas, l, t, T_LtoS, T_StoL);
    }
  });
}
