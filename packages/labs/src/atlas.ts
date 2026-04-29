import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';
import {
  applyLinearToDirection,
  cross,
  isPolygonCCW,
  isPolygonCW,
  type Junction,
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  parameterOnSegment,
  polygonContains,
  polygonContainsStrict,
  sameIdealDirection,
} from './atlas/geometry/index.ts';

// Re-export the geometry primitives so existing consumers of `./atlas.ts`
// continue to work unchanged. New code should import directly from
// `./atlas/geometry/index.ts`.
export {
  applyLinearToDirection,
  cross,
  isPolygonCCW,
  isPolygonCW,
  type Junction,
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  polygonContains,
  polygonContainsStrict,
  sameIdealDirection,
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
// **Edge transforms.** Each non-null `h.twin` link is a *one-way* pointer:
// "exiting through `h` lands you in `h.twin.face`, with frame change
// `h.transform : h.face local → h.twin.face local`". The geometric
// junction-correspondence invariant is local to each link:
//   - `h.transform · h.next.origin = h.twin.origin`
//   - `h.transform · h.origin     = h.twin.next.origin`
// For ideal junctions only the linear part of the transform applies (and the
// result is renormalized to unit length).
//
// **Twins are NOT required to be reciprocal.** It can be the case that
// `h.twin.twin !== h` (and equivalently, `h.transform · h.twin.transform`
// is not identity). This is what enables wrapped/looping topologies: a
// region's "top" and "bottom" edges can twin to *each other* (creating an
// internal cycle that produces the cylinder repetition), while outside
// faces' adjacent edges still point INTO the region (one-way), so shapes
// can cross into the wrap from outside but never back out through the
// wrapped axis.
//
// Reciprocal twin pairs (the common case from face splits) still satisfy
// `h.twin.twin === h` and `h.transform · h.twin.transform = identity` —
// but those are *consequences* of how a particular operation built them,
// not enforced invariants of the data model.
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
// **Similarity-only edge transforms.** By model invariant, every twin
// transform is a *similarity with rotation = 0*: a uniform positive
// scale composed with a translation, of the form
//   `[[s, 0], [0, s], (tx, ty)]`  with  s > 0.
// No rotation, no reflection (det > 0), no shear, no non-uniform scale.
// `validateAtlas` enforces this in development; production skips the
// check. Existing operations (line cut, region cut, wrap) all produce
// pure translations (s = 1); the scale degree of freedom is reserved
// for nesting / infinite-zoom regions.

// The `Junction` value type and the oriented-projective-plane primitives that
// operate on it now live in `./atlas/geometry/`. They are re-exported at the
// top of this file for backward compatibility.

// ----------------------------------------------------------------------------
// Side
// ----------------------------------------------------------------------------

/**
 * A directed edge belonging to one face. The triple
 * `(originKind, ox, oy)` describes this half-edge's starting junction in
 * face-local coordinates.
 *
 * Two half-edges form a twin pair across a shared edge of the atlas. The
 * `transform` maps `this.face`'s frame to `twin.face`'s frame; see the
 * twin invariants in the file header. `twin = null` for unbounded edges
 * (typically at-infinity arcs on the boundary of an unbounded face).
 *
 * **Chord-vs-arc disambiguation for ideal-ideal HEs.** A half-edge whose
 * origin and target are both ideal can be one of two geometrically distinct
 * things:
 *
 *   - An **at-infinity arc** on S¹: the boundary of an unbounded face along
 *     a piece of the line at infinity. The endpoints span an angular wedge
 *     CCW on S¹. `twin === null` and `anchor === null`.
 *   - A **chord** through R²: a real straight line whose two limit
 *     directions on S¹ are antipodal (origin and `next.origin` are negatives
 *     of each other). `twin !== null` (chords are always twinned to the
 *     chord on the other sub-face) and `anchor` stores any one finite
 *     point on the line, in face-local coordinates. The line itself is then
 *     determined by `(anchor, direction = origin)`.
 *
 * Two ideal directions don't pin down a chord by themselves (any parallel
 * line shares the same antipodal endpoints), which is why `anchor` is
 * needed to encode the offset along the chord's perpendicular.
 */
export class Side {
  originKind: 'finite' | 'ideal';
  /** Face-local x of starting junction (finite) or unit-direction x (ideal). */
  ox: number;
  /** Face-local y of starting junction (finite) or unit-direction y (ideal). */
  oy: number;
  /** Next half-edge CCW around `face`. */
  next!: Side;
  /** Previous half-edge CCW around `face` (i.e. the `he` such that `he.next === this`). */
  prev!: Side;
  /** Owning face. */
  face!: Face;
  /** Twin half-edge in the adjacent face, or null at a boundary. */
  twin: Side | null = null;
  /**
   * Any one finite point on the chord line, in face-local coordinates. Only
   * set on chord HEs (both endpoints ideal AND `twin !== null`). For all
   * other HEs this is `null`. See class docstring.
   */
  anchor: Point | null = null;
  /**
   * Affine map: this face's local frame → twin face's local frame.
   *
   * Unused (but kept identity) when `twin` is null.
   *
   * Junction-correspondence invariants when `twin` is non-null:
   *   transform * this.next.origin = twin.origin
   *   transform * this.origin       = twin.next.origin
   * For ideal-kind origins only the linear part applies and the image is
   * renormalized to unit length.
   *
   * Note: `transform` is NOT in general the inverse of `twin.transform`.
   * `twin` is a one-way pointer (see module header). When `twin.twin === this`
   * (a reciprocal pair, e.g. produced by a face split), the inverse
   * relationship does hold by how the operation built them — but it is not
   * a model-level invariant.
   */
  transform: M.Matrix2D = M.fromValues();

  /**
   * Reciprocal-binding back-reference. When this half-edge is part of a
   * symmetric twin pair (`this.twin.twin === this` and the transforms are
   * mutually inverse), both `this.stitch` and `this.twin.stitch` reference
   * the same {@link Stitch} object. When the binding is asymmetric (e.g.
   * region-wrap toggles installed via {@link linkEdgeToTwin}) or when this
   * half-edge has no twin, `stitch` is `null`.
   *
   * Chunk C: this is a parallel view onto the existing twin/transform
   * fields. Chunk B will make `Side.stitch` the source of truth and remove
   * the redundant pointer/transform pair.
   */
  stitch: Stitch | null = null;

  constructor(originKind: 'finite' | 'ideal', ox: number, oy: number) {
    this.originKind = originKind;
    if (originKind === 'ideal') {
      const len = Math.hypot(ox, oy);
      if (len === 0) throw new Error('ideal half-edge direction must be non-zero');
      this.ox = ox / len;
      this.oy = oy / len;
    } else {
      this.ox = ox;
      this.oy = oy;
    }
  }

  /** This half-edge's starting junction as a plain object. */
  origin(): Junction {
    return { kind: this.originKind, x: this.ox, y: this.oy };
  }

  /** This half-edge's target junction (= origin of `next`). */
  target(): Junction {
    return this.next.origin();
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
   * Use this in switch statements / dispatch tables instead of chaining the
   * legacy `originKind` + `isChord` + `isAtInfinity` predicates.
   */
  get kind(): 'segment' | 'ray' | 'antiRay' | 'chord' | 'arc' {
    if (this.originKind === 'finite' && this.next.originKind === 'finite') return 'segment';
    if (this.originKind === 'finite' && this.next.originKind === 'ideal') return 'ray';
    if (this.originKind === 'ideal' && this.next.originKind === 'finite') return 'antiRay';
    return this.anchor === null ? 'arc' : 'chord';
  }

  /**
   * Whether this is an at-infinity arc — both endpoints ideal AND not a
   * chord. Geometrically: a piece of S¹ on the boundary of an unbounded
   * face. Distinguished from a chord (which also has both endpoints ideal,
   * but `anchor !== null` and `twin !== null`).
   *
   * @deprecated Prefer `side.kind === 'arc'`.
   */
  get isAtInfinity(): boolean {
    return this.kind === 'arc';
  }

  /**
   * Whether this is a chord through R² between two antipodal ideal vertices.
   * Geometrically: a real straight line in R² whose two limit directions are
   * stored at the endpoints, with `anchor` pinpointing which parallel
   * line it is.
   *
   * @deprecated Prefer `side.kind === 'chord'`.
   */
  get isChord(): boolean {
    return this.kind === 'chord';
  }
}

/**
 * @deprecated Use {@link Side}. Kept as a type alias for one transitional
 * release so external imports continue to compile.
 */
export type HalfEdge = Side;

// ----------------------------------------------------------------------------
// Stitch — reciprocal binding between two half-edges
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
 * Stitches are allocated automatically by the symmetric primitives — chord
 * pairs from {@link splitFaceAtVertices}, subdivided pairs from
 * {@link subdivideSide}, strip-to-chord pairs from {@link insertStrip},
 * and explicit calls to {@link stitch} or {@link wrapEdges}. Asymmetric
 * one-way bindings established via {@link linkEdgeToTwin} do NOT allocate
 * a Stitch — `.stitch` stays `null` on both endpoints.
 *
 * The set of all stitches in an atlas is derived on demand via the
 * {@link Atlas.stitches} getter; it is not persisted state, so there is no
 * separate atlas-level bookkeeping to keep in sync.
 *
 * After chunk B (when `Side` replaces `Side`), `Stitch` becomes the
 * source of truth for cross-face navigation; the redundant twin/transform
 * pair on the HE will be removed.
 */
export class Stitch {
  a: Side;
  b: Side;

  constructor(a: Side, b: Side) {
    this.a = a;
    this.b = b;
  }

  /** Transform mapping `a.face` frame → `b.face` frame. */
  get transform(): M.Matrix2DReadonly {
    return this.a.transform;
  }

  /** Given one of the stitch's endpoints, return the other. */
  other(self: Side): Side {
    if (self === this.a) return this.b;
    if (self === this.b) return this.a;
    throw new Error('Stitch.other: argument is not an endpoint of this stitch');
  }

  /** Transform mapping `self.face` frame → the other endpoint's frame. */
  transformFrom(self: Side): M.Matrix2DReadonly {
    if (self === this.a) return this.a.transform;
    if (self === this.b) return this.b.transform;
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

  constructor(from: Face, to: Face, transform: M.Matrix2D) {
    this.from = from;
    this.to = to;
    this.transform = transform;
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
    // Defensive copy: every mutation primitive (subdivideAtInfinityArc,
    // subdivideSide, …) splices `face.sides` in place. If the
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

  /** This face's k outer-loop junctions (origins of its outer half-edges) in CCW order. */
  junctions(): Junction[] {
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
    if (!polygonContains(this.junctions(), p)) return false;
    for (const he of this.sides) {
      if (!he.isChord) continue;
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
      if (polygonContainsStrict(verts, p)) return false;
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
// `subdivideAtInfinityArc`, `splitFaceAtVertices`, `splitFaceAlongChord`, …)
// all consume these.

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

  constructor(root: Face) {
    this.root = root;
  }

  /**
   * Every reciprocal-binding {@link Stitch} reachable in this atlas, derived
   * on demand from the half-edges' `.stitch` back-references.
   *
   * Not persisted state — the set is rebuilt each call. For atlas sizes that
   * fit on a screen this is cheap (one pass over `sides` with a Set
   * de-dup). Callers that need to iterate stitches many times in a frame
   * should cache the result.
   *
   * Asymmetric twin pairs (those bound via {@link linkEdgeToTwin} without a
   * matching reciprocal call, e.g. region-wrap toggles) do not appear here —
   * they have no Stitch by design.
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
        // expressed in the current frame is `inv(he.transform)`. We use
        // `inv(he.transform)` (not `he.twin.transform`) because asymmetric
        // twins — used for wrapping — make those two not equal in general.
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
    const he0 = new Side('finite', 0, 0); // O → A
    const he1 = new Side('ideal', ax, ay); // A → B (at infinity)
    const he2 = new Side('ideal', bx, by); // B → O
    const f = new Face([he0, he1, he2]);
    faces.push(f);
    allSides.push(he0, he1, he2);
  }

  // Twin the half-axes shared between consecutive wedges.
  // Wedge i's "B → O" half-edge (he[2]) twins wedge (i+1)%n's "O → A" half-edge (he[0]).
  // (Both lie along the same physical half-axis, opposite directions.)
  for (let i = 0; i < n; i++) {
    const me = faces[i];
    const next = faces[(i + 1) % n];
    const a = me.sides[2];
    const b = next.sides[0];
    a.twin = b;
    b.twin = a;
    // transforms remain identity (default)
  }

  // The ideal-ideal half-edges within each face (he[1]) lie at infinity and
  // have no twin — already null by default.

  const atlas = new Atlas(faces[0]);
  atlas.sides = allSides;
  atlas.faces = faces;
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
  const hes = idealDirections.map(([x, y]) => new Side('ideal', x, y));
  const face = new Face(hes);
  const atlas = new Atlas(face);
  // Critical: `atlas.sides` must NOT alias `face.sides`. The Face
  // constructor stores its argument array by reference, and atlas-wide
  // mutators (e.g. `subdivideAtInfinityArc`'s `atlas.sides.splice`)
  // would otherwise also splice the face's outer-loop array, doubling the
  // mutation and corrupting the face's HE list. Take a fresh copy here.
  atlas.sides = [...hes];
  atlas.faces = [face];
  return atlas;
}

// ----------------------------------------------------------------------------
// wrapEdges — twin two boundary half-edges with a chosen transform
// ----------------------------------------------------------------------------

/**
 * Compute the translation that twins `heA` to `heB` under the standard
 * convention `T · heA.next.origin = heB.origin` and `T · heA.origin =
 * heB.next.origin`.
 *
 * For a translation to satisfy both equations the two edges must be
 * anti-parallel as oriented vectors of the same length — geometrically, the
 * left and right sides of a strip, or two opposite edges of a parallelogram.
 *
 * Throws if the geometry is incompatible with a pure translation, or if
 * either half-edge has an ideal endpoint.
 */
export function translationToWrap(heA: Side, heB: Side, eps = 1e-6): M.Matrix2D {
  if (heA.originKind !== 'finite' || heA.next.originKind !== 'finite') {
    throw new Error('translationToWrap: heA must have two finite endpoints');
  }
  if (heB.originKind !== 'finite' || heB.next.originKind !== 'finite') {
    throw new Error('translationToWrap: heB must have two finite endpoints');
  }
  // T(p) = p + t; from T·heA.next.origin = heB.origin we get
  //   t = heB.origin - heA.next.origin
  // From T·heA.origin = heB.next.origin we get
  //   t = heB.next.origin - heA.origin
  // The two must agree.
  const tx1 = heB.ox - heA.next.ox;
  const ty1 = heB.oy - heA.next.oy;
  const tx2 = heB.next.ox - heA.ox;
  const ty2 = heB.next.oy - heA.oy;
  if (Math.abs(tx1 - tx2) > eps || Math.abs(ty1 - ty2) > eps) {
    throw new Error(
      `translationToWrap: edges are not translation-compatible (${tx1.toFixed(6)}, ${ty1.toFixed(6)}) vs (${tx2.toFixed(6)}, ${ty2.toFixed(6)})`,
    );
  }
  return M.fromTranslate((tx1 + tx2) / 2, (ty1 + ty2) / 2);
}

/**
 * One-way primitive: point `he.twin` at `target`, with frame-change
 * `he.transform = transform`. This does NOT touch `target.twin` —
 * the link is asymmetric.
 *
 * This is the building block for both reciprocal and asymmetric topologies.
 * For the symmetric case (face splits), call it twice with mutually inverse
 * transforms; for asymmetric cycles (wrapped regions), it is called per
 * direction independently.
 *
 * Pre-conditions:
 *  - both half-edges live in `atlas`
 *  - `he !== target`
 *  - `he` is currently untwinned
 *  - both are finite-finite
 *  - `transform` satisfies the junction-correspondence equations
 *      transform · he.next.origin ≈ target.origin
 *      transform · he.origin       ≈ target.next.origin
 *
 * Effect: sets `he.twin = target` and `he.transform = transform`.
 */
export function linkEdgeToTwin(
  atlas: Atlas,
  he: Side,
  target: Side,
  transform: M.Matrix2D,
  eps = 1e-6,
): void {
  if (he === target) throw new Error('linkEdgeToTwin: cannot twin a half-edge to itself');
  if (!atlas.sides.includes(he) || !atlas.sides.includes(target)) {
    throw new Error('linkEdgeToTwin: half-edges must belong to atlas');
  }
  if (he.twin !== null) throw new Error('linkEdgeToTwin: he must currently be untwinned');
  if (he.isAtInfinity || target.isAtInfinity) {
    throw new Error('linkEdgeToTwin: cannot twin at-infinity half-edges');
  }
  if (he.originKind !== 'finite' || he.next.originKind !== 'finite') {
    throw new Error('linkEdgeToTwin: he must have two finite endpoints');
  }
  if (target.originKind !== 'finite' || target.next.originKind !== 'finite') {
    throw new Error('linkEdgeToTwin: target must have two finite endpoints');
  }
  const aTarget = M.applyToPoint(transform, { x: he.next.ox, y: he.next.oy });
  const aOrigin = M.applyToPoint(transform, { x: he.ox, y: he.oy });
  if (Math.abs(aTarget.x - target.ox) > eps || Math.abs(aTarget.y - target.oy) > eps) {
    throw new Error(
      `linkEdgeToTwin: transform·he.target = (${aTarget.x.toFixed(6)}, ${aTarget.y.toFixed(6)}) does not match target.origin = (${target.ox.toFixed(6)}, ${target.oy.toFixed(6)})`,
    );
  }
  if (Math.abs(aOrigin.x - target.next.ox) > eps || Math.abs(aOrigin.y - target.next.oy) > eps) {
    throw new Error(
      `linkEdgeToTwin: transform·he.origin = (${aOrigin.x.toFixed(6)}, ${aOrigin.y.toFixed(6)}) does not match target.target = (${target.next.ox.toFixed(6)}, ${target.next.oy.toFixed(6)})`,
    );
  }
  he.twin = target;
  he.transform = transform;
}

/**
 * One-way unlink primitive: clear `he`'s outbound twin pointer. Does NOT
 * touch the partner's twin pointer (the partner may still point at `he`,
 * which is allowed under the asymmetric model).
 *
 * If the pair was reciprocal-with-{@link Stitch}, this asymmetric break
 * invalidates the Stitch's structural-reciprocity invariant — so we clear
 * the `.stitch` back-reference on BOTH endpoints (the partner's `.stitch`
 * also becomes stale). The atlas-level Stitch view ({@link Atlas.stitches})
 * is derived, so no separate de-registration is needed.
 *
 * No-op when `he.twin === null`.
 */
export function unlinkEdgeFromTwin(he: Side): void {
  if (!he.twin) return;
  if (he.stitch !== null) {
    const s = he.stitch;
    s.a.stitch = null;
    s.b.stitch = null;
  }
  he.twin = null;
  he.transform = M.fromValues();
}

/**
 * Reciprocally bind two half-edges with a transform, returning the resulting
 * {@link Stitch} handle. This is the substrate's symmetric binding primitive.
 *
 * `Stitch.a` is `heA`, `Stitch.b` is `heB`, and `Stitch.transform` is the
 * `a → b` change of frame. Both endpoints get a back-reference to the same
 * `Stitch` via `.stitch`, so reciprocity is structurally guaranteed (the
 * asymmetric-twin trap is impossible to express here).
 *
 * For asymmetric one-way bindings — used today by region-wrap toggling
 * where the outside neighbour still points INTO the wrapped region while
 * the inside loops to itself — use {@link linkEdgeToTwin} directly.
 *
 * Pre-conditions:
 *  - both half-edges live in `atlas`
 *  - both have `twin === null`
 *  - both are finite-finite
 *  - `transformAtoB` satisfies the junction-correspondence equations
 *
 * Effect:
 *  - allocates a new {@link Stitch} `s`; `s.a = heA`, `s.b = heB`
 *  - `heA.twin = heB`; `heB.twin = heA`
 *  - `heA.transform = transformAtoB`; `heB.transform = inv(transformAtoB)`
 *  - `heA.stitch = heB.stitch = s`
 */
export function stitch(
  atlas: Atlas,
  heA: Side,
  heB: Side,
  transformAtoB: M.Matrix2D,
  eps = 1e-6,
): Stitch {
  if (heB.twin !== null) {
    throw new Error('stitch: heB must currently be untwinned (use linkEdgeToTwin for asymmetric links)');
  }
  linkEdgeToTwin(atlas, heA, heB, transformAtoB, eps);
  linkEdgeToTwin(atlas, heB, heA, M.invert(transformAtoB), eps);
  // Both pointers are now in place but neither has a Stitch (linkEdgeToTwin
  // is asymmetric and intentionally doesn't allocate one). Promote the pair
  // to a real Stitch via setTwin, which detects an existing reciprocal pair
  // and just attaches a fresh Stitch back-reference.
  return setTwin(heA, heB, heA.transform, heB.transform);
}

/**
 * Symmetric inverse of {@link stitch}: clear the reciprocal binding and
 * dispose of the {@link Stitch} object. Both endpoints' `.stitch`,
 * `.twin`, and `.transform` are reset.
 *
 * The atlas-level stitch view ({@link Atlas.stitches}) is derived, so the
 * disposed Stitch will simply not appear in the next iteration; there is
 * no separate de-registration step.
 */
export function unstitch(s: Stitch): void {
  if (s.a.twin === s.b) {
    s.a.twin = null;
    s.a.transform = M.fromValues();
  }
  if (s.b.twin === s.a) {
    s.b.twin = null;
    s.b.transform = M.fromValues();
  }
  if (s.a.stitch === s) s.a.stitch = null;
  if (s.b.stitch === s) s.b.stitch = null;
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
export function link(
  atlas: Atlas,
  from: Face,
  to: Face,
  transform: M.Matrix2D,
): Link {
  if (!atlas.faces.includes(from)) throw new Error('link: from face not in atlas');
  if (!atlas.faces.includes(to)) throw new Error('link: to face not in atlas');
  const l = new Link(from, to, transform);
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
 * @deprecated Use {@link stitch}. This is a thin wrapper that ignores the
 * returned `Stitch` handle, kept for source compatibility during the
 * chunk-C transition.
 */
export function wrapEdges(
  atlas: Atlas,
  heA: Side,
  heB: Side,
  transformAtoB: M.Matrix2D,
  eps = 1e-6,
): void {
  stitch(atlas, heA, heB, transformAtoB, eps);
}

/**
 * @deprecated Use {@link unstitch} when you have the {@link Stitch} handle
 * (the common case). This legacy form clears both sides of a reciprocal
 * twin pair given just one of its half-edges.
 *
 * No-op when `he.twin === null`. When `he`'s partner is not reciprocal
 * (`he.twin.twin !== he`), only `he`'s pointer is cleared.
 */
export function untwinEdges(he: Side): void {
  const partner = he.twin;
  if (!partner) return;
  unlinkEdgeFromTwin(he);
  if (partner.twin === he) unlinkEdgeFromTwin(partner);
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

  for (const he of face.allSides()) {
    if (he.originKind === 'finite') {
      he.ox = R * he.ox;
      he.oy = R * he.oy;
    }
  }

  const S = M.fromValues(R, 0, 0, R, 0, 0);
  const Sinv = M.fromValues(1 / R, 0, 0, 1 / R, 0, 0);
  for (const he of atlas.sides) {
    if (!he.twin) continue;
    const sourceIsFace = he.face === face;
    const targetIsFace = he.twin.face === face;
    if (!sourceIsFace && !targetIsFace) continue;
    let T = he.transform;
    if (sourceIsFace) T = M.multiply(T, Sinv);
    if (targetIsFace) T = M.multiply(S, T);
    he.transform = T;
  }
  // Same conjugation for {@link Link} transforms touching `face`. A link's
  // transform maps `to` frame → `from` frame; if the rescaled face is one
  // of the endpoints, we must rewrite the transform so the on-screen
  // placement of the link's child stays invariant under the rescale —
  // exactly analogous to the twin-transform conjugation above.
  for (const link of atlas.links) {
    const fromIsFace = link.from === face;
    const toIsFace = link.to === face;
    if (!fromIsFace && !toIsFace) continue;
    let T = link.transform;
    if (toIsFace) T = M.multiply(T, Sinv);
    if (fromIsFace) T = M.multiply(S, T);
    link.transform = T;
  }
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
export function addInnerLoop(
  atlas: Atlas,
  face: Face,
  vertices: ReadonlyArray<Point>,
): Side[] {
  if (!atlas.faces.includes(face)) {
    throw new Error('addInnerLoop: face must belong to atlas');
  }
  if (vertices.length < 3) {
    throw new Error(`addInnerLoop: need at least 3 vertices, got ${vertices.length}`);
  }

  const loop: Side[] = vertices.map((v) => new Side('finite', v.x, v.y));
  const m = loop.length;
  for (let i = 0; i < m; i++) {
    const he = loop[i];
    he.next = loop[(i + 1) % m];
    he.prev = loop[(i - 1 + m) % m];
    he.face = face;
    // twin remains null — these are free edges.
  }

  if (!isPolygonCW(loop.map((h) => h.origin()))) {
    throw new Error(
      'addInnerLoop: vertices must be in CW order (a hole is wound opposite to the outer face)',
    );
  }

  const outer = face.junctions();
  for (let i = 0; i < m; i++) {
    if (!polygonContains(outer, vertices[i])) {
      throw new Error(
        `addInnerLoop: vertex (${vertices[i].x}, ${vertices[i].y}) lies outside the outer loop`,
      );
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
      if (he.originKind === 'ideal') {
        const len = Math.hypot(he.ox, he.oy);
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
      if (he.originKind !== 'ideal' || he.next.originKind !== 'ideal') continue;
      if (he.anchor === null) {
        if (he.twin !== null) errs.push('at-infinity arc half-edge has non-null twin');
      } else {
        if (he.twin === null) errs.push('chord half-edge has null twin');
        const o = he.origin();
        const t = he.target();
        if (Math.abs(o.x + t.x) > eps * 100 || Math.abs(o.y + t.y) > eps * 100) {
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
      if (!h0.isChord || !h1.isChord) {
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
          if (v.kind !== 'finite') {
            errs.push(`face innerLoops[${li}][${i}] is ideal; inner loops must be finite`);
            continue;
          }
          if (!polygonContains(f.junctions(), { x: v.x, y: v.y })) {
            errs.push(
              `face innerLoops[${li}][${i}] at (${v.x}, ${v.y}) lies outside the outer loop`,
            );
          }
        }
      } catch (e) {
        errs.push(`face innerLoops[${li}] orientation check failed: ${(e as Error).message}`);
      }
    }
  }

  // ---- per-half-edge checks (twin transform consistency) ----
  for (const h of atlas.sides) {
    if (!allFaceSet.has(h.face)) errs.push('halfEdge.face not in atlas');

    if (h.twin) {
      if (!allSidesSet.has(h.twin)) errs.push('halfEdge.twin not in atlas');

      // Junction correspondence (one-way; symmetric inverse-pair is NOT
      // required — see module header on asymmetric twins):
      //   T · h.next.origin = h.twin.origin
      //   T · h.origin      = h.twin.next.origin
      const T = h.transform;
      if (!junctionImageMatches(T, h.target(), h.twin.origin(), eps * 100)) {
        errs.push("twin endpoint b' does not match T·b");
      }
      if (!junctionImageMatches(T, h.origin(), h.twin.target(), eps * 100)) {
        errs.push("twin endpoint a' does not match T·a");
      }

      // Similarity-only edge transforms: T must be of the form
      //   [[s, 0], [0, s], (tx, ty)]  with s > 0.
      // No rotation, no reflection (det > 0), no shear, no non-uniform
      // scale. Tolerance matches the junction check above.
      const simEps = eps * 100;
      if (Math.abs(T.b) > simEps || Math.abs(T.c) > simEps) {
        errs.push(
          `twin transform has rotation/shear (b=${T.b}, c=${T.c}), expected similarity`,
        );
      }
      if (Math.abs(T.a - T.d) > simEps) {
        errs.push(
          `twin transform has non-uniform scale (a=${T.a}, d=${T.d}), expected uniform`,
        );
      }
      if (T.a <= simEps) {
        errs.push(
          `twin transform has non-positive scale (a=${T.a}), expected s > 0`,
        );
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
    // Transforms must be mutually inverse. Tolerance generous enough to
    // absorb compounded floating-point error from chained mutations.
    const composed = M.multiply(s.a.transform, s.b.transform);
    const id = M.fromValues();
    if (!matricesAreClose(composed, id, eps * 1000)) {
      errs.push(
        `stitch transforms not mutually inverse (a·b = ${matrixToString(composed)})`,
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
  }

  // ---- reachability from root ----
  // A face is reachable if it can be visited by following:
  //   - twin pointers in either direction (forward via `he.twin`, backward
  //     via the incoming-pointer index — symmetric twins make these
  //     equivalent, asymmetric wraps don't)
  //   - links in either direction (outgoing via `link.from === f`, incoming
  //     via `link.to === f`)
  // Either kind of binding propagates reachability — an isolated face that
  // is the target of a link from the root chain is considered reachable.
  const incoming = new Map<Face, Side[]>();
  for (const h of atlas.sides) {
    if (h.twin) {
      const list = incoming.get(h.twin.face);
      if (list) list.push(h);
      else incoming.set(h.twin.face, [h]);
    }
  }
  const linksByFrom = new Map<Face, Link[]>();
  const linksByTo = new Map<Face, Link[]>();
  for (const link of atlas.links) {
    const fromList = linksByFrom.get(link.from);
    if (fromList) fromList.push(link);
    else linksByFrom.set(link.from, [link]);
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
    const incomingSides = incoming.get(f);
    if (incomingSides) {
      for (const ih of incomingSides) {
        if (!reachable.has(ih.face)) {
          reachable.add(ih.face);
          queue.push(ih.face);
        }
      }
    }
    const outLinks = linksByFrom.get(f);
    if (outLinks) {
      for (const l of outLinks) {
        if (!reachable.has(l.to)) {
          reachable.add(l.to);
          queue.push(l.to);
        }
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

function matricesAreClose(a: M.Matrix2DReadonly, b: M.Matrix2DReadonly, eps: number): boolean {
  return (
    Math.abs(a.a - b.a) < eps &&
    Math.abs(a.b - b.b) < eps &&
    Math.abs(a.c - b.c) < eps &&
    Math.abs(a.d - b.d) < eps &&
    Math.abs(a.e - b.e) < eps &&
    Math.abs(a.f - b.f) < eps
  );
}

function matrixToString(m: M.Matrix2DReadonly): string {
  return `[${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f}]`;
}

function junctionImageMatches(
  T: M.Matrix2DReadonly,
  src: Junction,
  dst: Junction,
  eps: number,
): boolean {
  if (src.kind !== dst.kind) return false;
  if (src.kind === 'finite') {
    const p = M.applyToPoint(T, { x: src.x, y: src.y });
    return Math.abs(p.x - dst.x) < eps && Math.abs(p.y - dst.y) < eps;
  }
  // Ideal: linear part only, then renormalize for unit-length comparison.
  const d = applyLinearToDirection(T, { x: src.x, y: src.y });
  const len = Math.hypot(d.x, d.y);
  if (len < eps) return false;
  return Math.abs(d.x / len - dst.x) < eps && Math.abs(d.y / len - dst.y) < eps;
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
  /** @deprecated Use `face` / `fresh`. Provided as `[face, fresh]` for back-compat. */
  faces: [Face, Face];
  /** @deprecated Use `faceChordSide` / `freshChordSide`. Provided as `[faceChordSide, freshChordSide]`. */
  chordSides: [Side, Side];
}

/**
 * Result of {@link subdivideSide}: the new vertex's position and the
 * two replacement half-edges in each affected face.
 */
export interface SubdivideSideResult {
  /** Position of the inserted vertex in `halfEdge.face`'s local frame. */
  newVertex: Point;
  /** Replacement half-edges in `halfEdge.face`, in CCW order: `[origin→new, new→target]`. */
  faceHalves: [Side, Side];
  /**
   * Replacement half-edges in `halfEdge.twin.face` (or `null` if no twin),
   * in CCW order: `[oldTwin.origin→new, new→oldTwin.target]` (i.e. opposite
   * directions of `faceHalves`).
   */
  twinHalves: [Side, Side] | null;
}

/**
 * Insert a finite vertex on a half-edge (and its twin), without otherwise
 * changing either incident face's shape.
 *
 * After this call, both incident faces have one extra vertex (`k → k+1`),
 * with the new vertex positioned at `point` in `halfEdge.face`'s frame and
 * at `T·point` in the twin face's frame. The new vertex is collinear with
 * its two adjacent vertices (a "chain vertex" — see {@link isPolygonCCW});
 * the face's interior is unchanged.
 *
 * Supported edge kinds:
 *   - finite-finite, finite-ideal, ideal-finite — `u` is in the standard
 *     edge parameter range.
 *   - **chord** (ideal-ideal twinned, `anchor` set) — `u` is the
 *     position along the chord line relative to `anchor`; subdividing
 *     replaces the chord with a (ideal-finite, finite-ideal) pair, both of
 *     which are regular mixed HEs (no `anchor` needed on the halves
 *     because the finite midpoint pinpoints the line).
 *
 * Use {@link subdivideAtInfinityArc} for at-infinity arcs (ideal-ideal,
 * untwinned, no anchor).
 *
 * Mutates the existing `Face` objects in place — face identity is preserved,
 * shapes assigned to either face stay assigned.
 */
export function subdivideSide(
  atlas: Atlas,
  side: Side,
  point: Point,
): SubdivideSideResult {
  if (!atlas.sides.includes(side)) {
    throw new Error('subdivideSide: side not in atlas');
  }
  if (side.isAtInfinity) {
    throw new Error('subdivideSide: at-infinity arc — use subdivideAtInfinityArc');
  }

  // Validate the point lies strictly between the two endpoints, with
  // collinearity tolerance. Range depends on edge kind:
  //   - finite-finite:    u ∈ (0, 1)
  //   - finite-ideal / ideal-finite: u ∈ (0, ∞)
  //   - chord (ideal-ideal): u ∈ (-∞, ∞) — both endpoints are at infinity
  //     in opposite directions, so any finite u corresponds to a finite
  //     point strictly between them.
  const u = uOfPointOnSide(side, point);
  const isFF = side.originKind === 'finite' && side.next.originKind === 'finite';
  const isChord = side.isChord;
  if (!Number.isFinite(u)) {
    throw new Error(`subdivideSide: u is not finite (u = ${u})`);
  }
  if (!isChord) {
    const uMin = 1e-9;
    const uMaxEnd = isFF ? 1 - 1e-9 : Infinity;
    if (u <= uMin || u >= uMaxEnd) {
      throw new Error(
        `subdivideSide: point not strictly between endpoints (u = ${u}, isFF = ${isFF})`,
      );
    }
  }
  const projected = pointOnSideAtU(side, u);
  const dx = projected.x - point.x;
  const dy = projected.y - point.y;
  if (dx * dx + dy * dy > 1e-12) {
    throw new Error('subdivideSide: point is not on the edge');
  }

  // ---- F side ----
  const F = side.face;
  const origin = side.origin();
  const s_A = new Side(origin.kind, origin.x, origin.y); // origin → newVertex
  const s_B = new Side('finite', point.x, point.y); // newVertex → target
  s_A.face = F;
  s_B.face = F;

  const fIdx = F.sides.indexOf(side);
  F.sides.splice(fIdx, 1, s_A, s_B);
  rewireFaceCycle(F);

  // Update atlas side index.
  const sIdx = atlas.sides.indexOf(side);
  atlas.sides.splice(sIdx, 1, s_A, s_B);

  // ---- G (twin) side ----
  let twinHalves: [Side, Side] | null = null;
  if (side.twin) {
    const T = side.transform;
    const twin = side.twin;
    const G = twin.face;
    const tOrigin = twin.origin();
    const pointInG = M.applyToPoint(T, point);

    const tw_A = new Side(tOrigin.kind, tOrigin.x, tOrigin.y); // twin.origin → newVertex'
    const tw_B = new Side('finite', pointInG.x, pointInG.y); // newVertex' → twin.target
    tw_A.face = G;
    tw_B.face = G;

    const gIdx = G.sides.indexOf(twin);
    G.sides.splice(gIdx, 1, tw_A, tw_B);
    rewireFaceCycle(G);

    const twinIdx = atlas.sides.indexOf(twin);
    atlas.sides.splice(twinIdx, 1, tw_A, tw_B);

    // Twin pairs (transforms preserve the original T — frames F and G are unchanged):
    //   s_A (F: origin → newP)  ↔  tw_B (G: newP' → twin.target = origin')
    //   s_B (F: newP → target)  ↔  tw_A (G: twin.origin = target' → newP')
    const T_fwd = M.fromValues(T.a, T.b, T.c, T.d, T.e, T.f);
    const T_rev = M.invert(T_fwd);
    setTwin(s_A, tw_B, T_fwd, M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f));
    setTwin(
      s_B,
      tw_A,
      M.fromValues(T_fwd.a, T_fwd.b, T_fwd.c, T_fwd.d, T_fwd.e, T_fwd.f),
      M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f),
    );
    twinHalves = [tw_A, tw_B];
  }

  return { newVertex: point, faceHalves: [s_A, s_B], twinHalves };
}

/**
 * Result of {@link subdivideAtInfinityArc}: the new ideal vertex's direction
 * and the two replacement half-edges in the affected face.
 */
export interface SubdivideAtInfinityArcResult {
  /** Unit direction of the inserted ideal vertex, in the face's frame. */
  newIdealDir: Point;
  /** Replacement half-edges, in CCW order: `[arcStart→new, new→arcEnd]`. */
  arcHalves: [Side, Side];
}

/**
 * Insert an ideal vertex on an at-infinity arc, without changing the face's
 * shape. The arc has no twin, so this only touches the one face.
 *
 * `idealDir` must lie strictly inside the arc's CCW angular sweep (between
 * the arc's start and end ideal directions).
 */
export function subdivideAtInfinityArc(
  atlas: Atlas,
  arcSide: Side,
  idealDir: Point,
): SubdivideAtInfinityArcResult {
  if (!atlas.sides.includes(arcSide)) {
    throw new Error('subdivideAtInfinityArc: arcSide not in atlas');
  }
  if (!arcSide.isAtInfinity) {
    throw new Error('subdivideAtInfinityArc: half-edge is not an at-infinity arc');
  }
  if (arcSide.twin !== null) {
    throw new Error('subdivideAtInfinityArc: at-infinity arc unexpectedly has a twin');
  }

  const len = Math.hypot(idealDir.x, idealDir.y);
  if (len < 1e-9) throw new Error('subdivideAtInfinityArc: idealDir has zero length');
  const dir = { x: idealDir.x / len, y: idealDir.y / len };

  const a = arcSide.origin();
  const b = arcSide.next.origin();
  // Arc CCW sweep is from `a` to `b`; `dir` must lie strictly between them
  // angularly. Equivalent: `dir` is left-of-strict the radial `a→0` and
  // right-of-strict the radial `0→b` — i.e. the cross signs match.
  const eps = 1e-9;
  const aCrossDir = cross(a.x, a.y, dir.x, dir.y);
  const dirCrossB = cross(dir.x, dir.y, b.x, b.y);
  if (aCrossDir <= eps || dirCrossB <= eps) {
    throw new Error(
      'subdivideAtInfinityArc: idealDir is not strictly inside the arc (a×d, d×b must both be > 0)',
    );
  }

  const F = arcSide.face;
  const arc_A = new Side('ideal', a.x, a.y); // a → newIdeal
  const arc_B = new Side('ideal', dir.x, dir.y); // newIdeal → b
  arc_A.face = F;
  arc_B.face = F;

  const fIdx = F.sides.indexOf(arcSide);
  F.sides.splice(fIdx, 1, arc_A, arc_B);
  rewireFaceCycle(F);

  const heIdx = atlas.sides.indexOf(arcSide);
  atlas.sides.splice(heIdx, 1, arc_A, arc_B);

  // No twins for at-infinity arc halves.

  return { newIdealDir: dir, arcHalves: [arc_A, arc_B] };
}

/**
 * Area-weighted centroid of the finite vertices of a (possibly mixed) ring
 * of junctions. Ideal vertices are translation-invariant and contribute
 * nothing to the position of the face in R²; we ignore them and centroid
 * only the finite ones. Falls back to the simple average when the finite
 * sub-polygon has near-zero area (e.g. a single finite vertex flanked by
 * ideals), and to `(0, 0)` when there are no finite vertices at all.
 */
function centroidOfFinite(verts: Junction[]): Point {
  const fin: Point[] = [];
  for (const j of verts) {
    if (j.kind === 'finite') fin.push({ x: j.x, y: j.y });
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
  if (jA.kind === 'ideal' && jB.kind === 'ideal') {
    chordIsIdealIdeal = true;
    if (!anchor) {
      throw new Error(
        'splitFaceAtVertices: ideal-ideal chord requires a finite anchor (the chord line is otherwise underdetermined)',
      );
    }
    if (Math.abs(jA.x + jB.x) > eps || Math.abs(jA.y + jB.y) > eps) {
      throw new Error(
        'splitFaceAtVertices: ideal-ideal chord endpoints must be antipodal on S¹',
      );
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
      throw new Error(
        'splitFaceAtVertices: chord endpoints are adjacent (would coincide with an edge)',
      );
    }
    const dirX = jB.x - jA.x;
    const dirY = jB.y - jA.y;
    for (let i = 0; i < k; i++) {
      const he = face.sides[i];
      const ni = (i + 1) % k;
      const isBetween =
        (i === vIdxA && ni === vIdxB) || (i === vIdxB && ni === vIdxA);
      if (!isBetween) continue;
      if (!he.isChord) {
        throw new Error(
          'splitFaceAtVertices: adjacent HE between ideal endpoints is not a chord (cannot produce a valid digon)',
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
  // (origin at vIdxA's position, translated into fresh's re-anchored frame
  // when finite).
  const faceChordSide = new Side(jB.kind, jB.x, jB.y);
  const freshChordOX = jA.kind === 'finite' ? jA.x - freshOffset.x : jA.x;
  const freshChordOY = jA.kind === 'finite' ? jA.y - freshOffset.y : jA.y;
  const freshChordSide = new Side(jA.kind, freshChordOX, freshChordOY);

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
  const T_faceToFresh = M.fromTranslate(-freshOffset.x, -freshOffset.y);
  const T_freshToFace = M.fromTranslate(freshOffset.x, freshOffset.y);
  setTwin(faceChordSide, freshChordSide, T_faceToFresh, T_freshToFace);

  // Re-anchor arc1's HEs in place: they're moving from face's frame into
  // fresh's frame (translated by -freshOffset). Finite origins shift,
  // ideal origins are translation-invariant, chord anchors shift.
  for (const he of arc1Sides) {
    if (he.originKind === 'finite') {
      he.ox -= freshOffset.x;
      he.oy -= freshOffset.y;
    }
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
  const cloneMat = (m: M.Matrix2DReadonly): M.Matrix2D =>
    M.fromValues(m.a, m.b, m.c, m.d, m.e, m.f);
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
    for (const h of atlas.sides) {
      if (!h.twin) continue;
      if (h === faceChordSide || h === freshChordSide) continue;
      const meInArc1 = arc1Set.has(h);
      const twinInArc1 = arc1Set.has(h.twin);
      if (!meInArc1 && !twinInArc1) continue;
      let T = h.transform;
      if (meInArc1) T = M.multiply(T, posOff);
      if (twinInArc1) T = M.multiply(negOff, T);
      h.transform = T;
    }
  }

  // Register the new face and its two new chord HEs with the atlas.
  // The arc1 HEs that moved to `fresh` are already in `atlas.sides` —
  // they kept their object identity, only their .face pointer changed.
  atlas.sides.push(faceChordSide, freshChordSide);
  atlas.faces.push(fresh);

  return {
    face,
    fresh,
    faceChordSide,
    freshChordSide,
    freshOffset,
    faces: [face, fresh],
    chordSides: [faceChordSide, freshChordSide],
  };
}

/**
 * Split `face` along a chord whose endpoints are described by two
 * {@link BoundaryHit}s on `face`'s boundary. Composes
 * {@link subdivideSide} / {@link subdivideAtInfinityArc} (to materialise
 * each chord endpoint as an actual vertex when it lands mid-edge or
 * mid-arc) followed by {@link splitFaceAtVertices}.
 *
 * Side-effect: subdividing a non-arc edge also subdivides the neighbouring
 * face's twin half-edge (introducing one collinear chain vertex over there
 * — see {@link subdivideSide}). At-infinity-arc subdivisions only touch
 * `face`.
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
   * Endpoint-coincidence short-circuits depend on the edge kind:
   *   - finite-finite: `u = 0` is the origin vertex, `u = 1` is the target
   *     vertex.
   *   - finite-ideal / ideal-finite: `u = 0` is the finite endpoint;
   *     the ideal endpoint sits at `u → ∞` (can't land "at" it).
   *   - chord (ideal-ideal twinned): both endpoints are at infinity in
   *     opposite directions, so any finite `u` is interior. There is no
   *     short-circuit — we always subdivide.
   */
  const materialise = (hit: BoundaryHit): Side => {
    if (hit.point) {
      const u = hit.u!;
      const isChord = hit.he.isChord;
      if (!isChord && u <= eps) return hit.he;
      const isFF = hit.he.originKind === 'finite' && hit.he.next.originKind === 'finite';
      if (isFF && u >= 1 - eps) return hit.he.next;
      const r = subdivideSide(atlas, hit.he, hit.point);
      return r.faceHalves[1];
    }
    if (hit.idealDir) {
      const arcStart = hit.he.origin();
      const arcEnd = hit.he.next.origin();
      if (
        Math.abs(arcStart.x - hit.idealDir.x) < eps &&
        Math.abs(arcStart.y - hit.idealDir.y) < eps
      ) {
        return hit.he;
      }
      if (
        Math.abs(arcEnd.x - hit.idealDir.x) < eps &&
        Math.abs(arcEnd.y - hit.idealDir.y) < eps
      ) {
        return hit.he.next;
      }
      const r = subdivideAtInfinityArc(atlas, hit.he, hit.idealDir);
      return r.arcHalves[1];
    }
    throw new Error('splitFaceAlongChord: hit has neither point nor idealDir');
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
 * Internal helper: wire a reciprocal twin pair (twin pointers + transforms)
 * AND ensure both endpoints reference a shared {@link Stitch} back-reference.
 *
 * Three cases:
 *  - Both `a` and `b` already share the same Stitch: just update transforms
 *    (this is the resize-an-existing-pair case, e.g. {@link resizeStrip}).
 *  - One or both has a different/dangling Stitch: clear back-refs on the
 *    stale Stitch's endpoints (no atlas-set bookkeeping needed since
 *    `Atlas.stitches` is derived), then allocate a fresh Stitch.
 *  - Neither has a Stitch: allocate a fresh Stitch.
 *
 * Returns the resulting Stitch. Used by the symmetric mutation primitives
 * ({@link splitFaceAtVertices}, {@link subdivideSide}, {@link insertStrip})
 * and by the public {@link stitch} export.
 */
function setTwin(
  a: Side,
  b: Side,
  transformAB: M.Matrix2D,
  transformBA: M.Matrix2D,
): Stitch {
  if (a.stitch !== null && a.stitch === b.stitch) {
    a.twin = b;
    b.twin = a;
    a.transform = transformAB;
    b.transform = transformBA;
    return a.stitch;
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
  a.twin = b;
  b.twin = a;
  a.transform = transformAB;
  b.transform = transformBA;
  const fresh = new Stitch(a, b);
  a.stitch = fresh;
  b.stitch = fresh;
  return fresh;
}

function attachFace(atlas: Atlas, face: Face) {
  atlas.faces.push(face);
  for (const he of face.allSides()) atlas.sides.push(he);
}

// ----------------------------------------------------------------------------
// Line-walking primitive (line cut traversal)
// ----------------------------------------------------------------------------

/**
 * Where a line passes through one boundary of a face. Used by {@link walkLine}.
 *
 *   - `he` is the boundary half-edge being crossed (always non-null).
 *   - `point` is the finite intersection in the face's local frame, or `null`
 *     if the hit is "at infinity" (i.e. `he.isAtInfinity` is true and the
 *     line direction lies inside the arc — the exit is at the ideal direction
 *     `idealDir`).
 *   - `u` is the parameter along `he` where the line crosses, or `null` for
 *     at-infinity hits. Semantics:
 *       - finite → finite: `u ∈ [0, 1]`, with 0 at origin, 1 at target.
 *       - finite → ideal:  `u ∈ [0, ∞)`, with 0 at the finite origin.
 *       - ideal  → finite: `u ∈ [0, ∞)`, with 0 at the finite target.
 *   - `idealDir` is the line's unit direction (in the face's frame) when the
 *     hit is at infinity, otherwise `null`.
 */
export interface BoundaryHit {
  he: Side;
  point: Point | null;
  u: number | null;
  idealDir: Point | null;
}

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
function findExit(
  face: Face,
  p: Point,
  d: Point,
  excludeSide: Side | null,
  eps = WALK_EPS,
): BoundaryHit | null {
  let best: { he: Side; s: number; u: number } | null = null;
  let arcExit: Side | null = null;

  for (const he of face.sidesCCW()) {
    if (he === excludeSide) continue;
    if (he.isAtInfinity) {
      const a = he.origin();
      const b = he.next.origin();
      // Use `>= -eps` (rather than `> eps`) so the line direction may exactly
      // coincide with one of the arc's ideal endpoints. Geometrically the
      // line still exits through that ideal vertex; a strictly-inside check
      // wrongly rejects axis-aligned directions in cardinal seed wedges
      // (e.g. d=(1,0) inside the +x/+y wedge whose arc spans (1,0)→(0,1)).
      if (
        cross(a.x, a.y, d.x, d.y) >= -eps &&
        cross(d.x, d.y, b.x, b.y) >= -eps
      ) {
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
      he: best.he,
      point: pointOnSideAtU(best.he, best.u),
      u: best.u,
      idealDir: null,
    };
  }
  if (arcExit) {
    return {
      he: arcExit,
      point: null,
      u: null,
      idealDir: { x: d.x, y: d.y },
    };
  }

  // Corner exit. Look for an ideal vertex of `face` whose direction matches
  // `d` and which is bounded on both sides by finite-bearing (non-arc) edges.
  // Skip vertices adjacent to an arc — those are already handled by the
  // arcExit branch above. `d` is unit-length; ideal-vertex directions are
  // unit-length by construction.
  const cornerEps = 1e-6;
  for (const he of face.sidesCCW()) {
    if (he === excludeSide) continue;
    if (he.originKind !== 'ideal') continue;
    if (he.isAtInfinity) continue;
    if (he.prev.isAtInfinity) continue;
    const dx = d.x - he.ox;
    const dy = d.y - he.oy;
    if (dx * dx + dy * dy < cornerEps * cornerEps) {
      return {
        he,
        point: null,
        u: null,
        idealDir: { x: d.x, y: d.y },
      };
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
function rayParam(
  side: Side,
): { start: Point; dir: Point; uMin: number; uMax: number } | null {
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
function intersectLineWithSide(
  p: Point,
  d: Point,
  side: Side,
  eps: number,
): { s: number; u: number } | null {
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
export function walkLine(
  host: Face,
  seam: Point,
  direction: Point,
): FaceCrossing[] {
  if (!polygonContainsStrict(host.junctions(), seam)) {
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
function walkLineDirection(
  startFace: Face,
  startExit: BoundaryHit,
  startDirection: Point,
): FaceCrossing[] {
  const out: FaceCrossing[] = [];
  let prevExit = startExit;
  let prevDirection = startDirection;
  let prevFace = startFace;

  const maxSteps = 256;
  for (let step = 0; step < maxSteps; step++) {
    if (!prevExit.he.twin) break;
    if (prevExit.he.isAtInfinity) break;
    if (!prevExit.point) break; // ideal-arc exit; can't cross into twin

    const twin = prevExit.he.twin;
    const T = prevExit.he.transform;
    const entryPointInTwin = M.applyToPoint(T, prevExit.point);
    const dirInTwin = applyLinearToDirection(T, prevDirection);
    const lenT = Math.hypot(dirInTwin.x, dirInTwin.y);
    const dirInTwinUnit = { x: dirInTwin.x / lenT, y: dirInTwin.y / lenT };
    const uOnTwin = uOfPointOnSide(twin, entryPointInTwin);
    const entryHit: BoundaryHit = {
      he: twin,
      point: entryPointInTwin,
      u: uOnTwin,
      idealDir: null,
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
    if (exit.he.isAtInfinity) break;
  }

  return out;
}

// ----------------------------------------------------------------------------
// Atlas-level line cut: splitAtlasAlongLine
// ----------------------------------------------------------------------------

/**
 * One sub-face pair from a {@link splitAtlasAlongLine} chain step.
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
 * Result of {@link splitAtlasAlongLine}: per-step sub-face pairs in the
 * order they were crossed by the walked line (from −direction infinity to
 * +direction infinity).
 *
 * Consumers (e.g. the line-cut tool gizmo) hold this result during a drag
 * so they can update the affected sub-faces in real-time as the chord is
 * pulled apart by a strip insertion.
 */
export interface SplitAtlasAlongLineResult {
  pairs: ChainSplitPair[];
}

/**
 * Captured geometry of a {@link BoundaryHit} for re-resolution after
 * intervening atlas mutations may have invalidated `hit.he`.
 */
interface CapturedHit {
  point: Point | null;
  idealDir: Point | null;
}

function captureHit(hit: BoundaryHit): CapturedHit {
  return {
    point: hit.point ? { x: hit.point.x, y: hit.point.y } : null,
    idealDir: hit.idealDir ? { x: hit.idealDir.x, y: hit.idealDir.y } : null,
  };
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
    if (side.originKind !== 'finite') continue;
    if (Math.abs(side.ox - p.x) < eps && Math.abs(side.oy - p.y) < eps) {
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
    if (he.originKind !== 'ideal') continue;
    if (Math.abs(he.ox - idealDir.x) >= eps) continue;
    if (Math.abs(he.oy - idealDir.y) >= eps) continue;
    return he;
  }
  // Arc sweep fallback: a stale `idealDir` may sit strictly inside an arc
  // whose endpoints didn't yet contain a vertex matching it — materialise()
  // will subdivide.
  for (const he of face.sides) {
    if (!he.isAtInfinity) continue;
    const a = he.origin();
    const b = he.next.origin();
    if (
      cross(a.x, a.y, idealDir.x, idealDir.y) >= -eps &&
      cross(idealDir.x, idealDir.y, b.x, b.y) >= -eps
    ) {
      return he;
    }
  }
  throw new Error(
    `findSideForIdealDir: no at-infinity arc contains direction (${idealDir.x}, ${idealDir.y})`,
  );
}

/**
 * Given a captured hit and a (possibly mutated) face, build a fresh
 * {@link BoundaryHit} with an HE reference that is guaranteed to be in
 * `face.sides`.
 */
function refreshHit(face: Face, captured: CapturedHit): BoundaryHit {
  if (captured.point) {
    const { he, u } = findSideForFinitePoint(face, captured.point);
    return { he, point: captured.point, u, idealDir: null };
  }
  if (captured.idealDir) {
    const he = findSideForIdealDir(face, captured.idealDir);
    return { he, point: null, u: null, idealDir: captured.idealDir };
  }
  throw new Error('refreshHit: captured has neither point nor idealDir');
}

/**
 * Cut every face crossed by a line through the atlas, in line-traversal
 * order. Composes {@link walkLine} → {@link splitFaceAlongChord}.
 *
 * The line is specified by an interior `seam` point of `host` and a
 * direction; the line extends infinitely in both directions. Each crossed
 * face is split along the chord between its (entry, exit) hits with the
 * line.
 *
 * Result ordering: `pairs[i]` corresponds to the i-th face in the walk
 * chain (from −direction infinity to +direction infinity). For each pair,
 * `leftFace` is on the +perp side of the line direction and `rightFace`
 * is on the −perp side.
 *
 * Limitations:
 * - The walked line must not pass exactly through an existing vertex
 *   (degenerate exit). Callers should perturb if needed.
 * - When a face's chord has both endpoints at infinity (e.g. the line
 *   passes through an all-ideal face entirely with no finite crossings),
 *   the chord line is recorded via {@link Side.anchor}. For the
 *   host face this anchor is `seam` directly; for non-host faces in the
 *   chain we use the entry-hit's finite point if available, falling back
 *   to mapping the host's seam through the chain's twin transforms.
 */
export function splitAtlasAlongLine(
  atlas: Atlas,
  host: Face,
  seam: Point,
  direction: Point,
): SplitAtlasAlongLineResult {
  const chain = walkLine(host, seam, direction);

  // Refuse to cut along a chain that visits the same face twice. That
  // signals the line crossed a wrapped (asymmetric) edge and looped
  // back through a topological cycle (e.g. a cylinder seam). A chord
  // through such a chain would need to be subdivided in lock-step at
  // every revisit (not yet supported) or it would break the wrap.
  // Refuse early — before any mutation — so callers can recover
  // cleanly.
  {
    const seen = new Set<Face>();
    for (const c of chain) {
      if (seen.has(c.face)) {
        throw new Error('splitAtlasAlongLine: cut crosses a wrapped (asymmetric) edge — refusing');
      }
      seen.add(c.face);
    }
  }

  // Capture all entry/exit geometry up front. HE references will become
  // stale as we mutate; the geometric position remains valid in each
  // face's frame because subdivision preserves face identity and frame.
  // We also capture each crossing's chord anchor (a finite point on the
  // chord line, in the face's local frame) for the ideal-ideal-chord
  // case: host crossings have `seam` directly; non-host crossings use
  // the entry hit's finite point when present.
  const captured = chain.map((c) => ({
    face: c.face,
    entry: c.entry ? captureHit(c.entry) : null,
    exit: captureHit(c.exit),
    anchor:
      c.isHost && c.seam
        ? { x: c.seam.x, y: c.seam.y }
        : c.entry && c.entry.point
          ? { x: c.entry.point.x, y: c.entry.point.y }
          : null,
  }));

  for (const c of captured) {
    if (!c.entry) {
      throw new Error('splitAtlasAlongLine: missing entry for crossing');
    }
  }

  const pairs: ChainSplitPair[] = [];
  for (const c of captured) {
    const entryHit = refreshHit(c.face, c.entry!);
    const exitHit = refreshHit(c.face, c.exit);
    const result = splitFaceAlongChord(atlas, c.face, entryHit, exitHit, c.anchor);
    // splitFaceAlongChord doc: faces[0] is on the RIGHT of entry→exit
    // direction; faces[1] is on the LEFT. Line direction in this face's
    // frame matches entry→exit direction (translation-only twins
    // preserve direction across the chain).
    pairs.push({
      rightFace: result.face,
      leftFace: result.fresh,
      rightChordSide: result.faceChordSide,
      leftChordSide: result.freshChordSide,
      leftOffset: result.freshOffset,
    });
  }

  return { pairs };
}

/**
 * Face-bounded line cut: split exactly one face along the chord between
 * the line's two boundary intersections. Does **not** propagate through
 * twin edges to neighbouring faces.
 *
 * Conceptually a single iteration of {@link splitAtlasAlongLine} that
 * skips the {@link walkLine} chain traversal. Used by region-creation
 * primitives where the cut is meant to terminate at the host's bounds
 * (so deep nested regions don't slice every level above them).
 *
 * Geometry:
 *   - `seam` must be strictly interior to `host` (in `host`'s local frame).
 *   - `direction` is a non-zero 2D vector; the function normalises it.
 *   - The cut is the chord through `seam` in `±direction`, clipped to the
 *     host's boundary on both sides.
 *
 * The result mirrors {@link splitFaceAlongChord}: `faces[0]` is on the
 * RIGHT of the (back-exit → forward-exit) direction, `faces[1]` on the
 * LEFT, with their respective chord half-edges twinned across the chord.
 * No twin links outside the host are touched.
 *
 * Throws if the line cannot find both a forward and backward boundary
 * exit, or if the resulting chord would be degenerate (e.g. ideal-to-ideal
 * on a face with no finite intersections).
 */
export function splitFaceAlongLine(
  atlas: Atlas,
  host: Face,
  seam: Point,
  direction: Point,
): SplitChordResult {
  if (!atlas.faces.includes(host)) {
    throw new Error('splitFaceAlongLine: host not in atlas');
  }
  if (!polygonContainsStrict(host.junctions(), seam)) {
    throw new Error('splitFaceAlongLine: seam is not strictly interior to host');
  }
  const len = Math.hypot(direction.x, direction.y);
  if (len < WALK_EPS) throw new Error('splitFaceAlongLine: zero-length direction');
  const d = { x: direction.x / len, y: direction.y / len };
  const dNeg = { x: -d.x, y: -d.y };

  const forwardExit = findExit(host, seam, d, null);
  if (!forwardExit) throw new Error('splitFaceAlongLine: no forward exit from host');
  const backwardExit = findExit(host, seam, dNeg, null);
  if (!backwardExit) throw new Error('splitFaceAlongLine: no backward exit from host');

  // splitFaceAlongChord materialises both endpoints (subdividing host's
  // boundary edges if needed) but never reaches into their twins. So a
  // chord cut here only mutates `host` and its half-edges; neighbouring
  // faces are completely untouched.
  //
  // We pass `seam` as the chord anchor: it's a finite point on the chord
  // line, in `host`-local coordinates, which is exactly what
  // {@link splitFaceAtVertices} needs when both boundary hits land at
  // infinity (e.g. cutting an all-ideal face).
  return splitFaceAlongChord(atlas, host, backwardExit, forwardExit, seam);
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
 * Open the chord twin pairs from a {@link splitAtlasAlongLine} result by
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
export function insertStrip(
  atlas: Atlas,
  splitResult: SplitAtlasAlongLineResult,
  height: number,
): InsertStripResult {
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
    if (r.origin().kind !== 'ideal' || r.target().kind !== 'ideal') {
      throw new Error(
        'insertStrip: single-face chain with finite chord endpoints is not yet supported (only ideal-ideal chords produce a valid digon strip)',
      );
    }
  }

  // ---- Determine line direction d in any face's frame ----
  // Translation-only twins → d is the same across all faces and the strip.
  // rightChordSide goes B → A (i.e., in -d direction). For an ideal-ideal
  // chord (N=1 case), origin is the +d ideal vertex (B) by the convention
  // in splitFaceAtVertices: the right sub-face's chord goes B → A.
  let d: Point | null = null;
  for (const pair of splitResult.pairs) {
    const r = pair.rightChordSide;
    const ro = r.origin();
    const rt = r.target();
    if (ro.kind === 'finite' && rt.kind === 'finite') {
      const dx = ro.x - rt.x;
      const dy = ro.y - rt.y;
      const len = Math.hypot(dx, dy);
      d = { x: dx / len, y: dy / len };
      break;
    }
    if (ro.kind === 'ideal' && rt.kind === 'finite') {
      d = { x: -ro.x, y: -ro.y };
      break;
    }
    if (ro.kind === 'finite' && rt.kind === 'ideal') {
      d = { x: -rt.x, y: -rt.y };
      break;
    }
    if (ro.kind === 'ideal' && rt.kind === 'ideal') {
      d = { x: ro.x, y: ro.y };
      break;
    }
  }
  if (!d) {
    throw new Error('insertStrip: could not determine line direction');
  }
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
    if (ro.kind !== 'finite' || rt.kind !== 'finite') {
      throw new Error(
        `insertStrip: middle chain step ${i - 1} has non-finite chord (chain shape unexpected)`,
      );
    }
    const chordLen = Math.hypot(ro.x - rt.x, ro.y - rt.y);
    cPositions[i] = {
      x: cPositions[i - 1].x + chordLen * d.x,
      y: cPositions[i - 1].y + chordLen * d.y,
    };
  }

  // ---- Per-chain-step junction at A or B side, on bot or top of strip ----
  const aJunction = (i: number, perpSide: 'bot' | 'top'): Junction => {
    if (i === 0) return { kind: 'ideal', x: -d!.x, y: -d!.y };
    const p = cPositions[i];
    if (perpSide === 'top') {
      return { kind: 'finite', x: p.x + height * perp.x, y: p.y + height * perp.y };
    }
    return { kind: 'finite', x: p.x, y: p.y };
  };
  const bJunction = (i: number, perpSide: 'bot' | 'top'): Junction => {
    if (i === N - 1) return { kind: 'ideal', x: d!.x, y: d!.y };
    const p = cPositions[i + 1];
    if (perpSide === 'top') {
      return { kind: 'finite', x: p.x + height * perp.x, y: p.y + height * perp.y };
    }
    return { kind: 'finite', x: p.x, y: p.y };
  };

  // ---- Build strip face's half-edges ----
  // bottomSides[i]: origin = A in bot, target (implicit via .next) = B in bot.
  // topSides[i]:    origin = B in top, target (implicit via .next) = A in top.
  const bottomSides: Side[] = [];
  for (let i = 0; i < N; i++) {
    const j = aJunction(i, 'bot');
    bottomSides.push(new Side(j.kind, j.x, j.y));
  }
  const topSides: Side[] = [];
  for (let i = 0; i < N; i++) {
    const j = bJunction(i, 'top');
    topSides.push(new Side(j.kind, j.x, j.y));
  }

  // CCW order around the strip:
  //   [B[0], B[1], ..., B[N-1], T[N-1], T[N-2], ..., T[0]]
  // Anchor (first finite vertex with origin (0, 0)) is B[1].origin = c[1].
  // Rotate so anchor is hes[0]:
  //   [B[1], B[2], ..., B[N-1], T[N-1], ..., T[0], B[0]]
  // For N=1 this collapses to [T[0], B[0]] — a 2-HE digon.
  const stripSides: Side[] = [
    ...bottomSides.slice(1),
    ...topSides.slice().reverse(),
    bottomSides[0],
  ];

  // For N=1 (digon strip) both HEs are ideal-ideal chords; set their
  // anchors so the slab has bottom at (0, 0) and top at height·perp.
  // Cycle is [topSides[0], bottomSides[0]] for N=1 (verified by the slice
  // construction above with N=1).
  if (N === 1) {
    bottomSides[0].anchor = { x: 0, y: 0 };
    topSides[0].anchor = { x: height * perp.x, y: height * perp.y };
  }

  const stripFace = new Face(stripSides);

  // ---- Wire chord twin pairs to strip's bottom/top half-edges ----
  for (let i = 0; i < N; i++) {
    const r = splitResult.pairs[i].rightChordSide;
    const l = splitResult.pairs[i].leftChordSide;
    const ro = r.origin(); // B in rightFace frame
    const rt = r.target(); // A in rightFace frame
    const lo = l.origin(); // A in leftFace frame
    const lt = l.target(); // B in leftFace frame

    // T_RtoS: pick whichever chord endpoint is finite to anchor the
    // translation. For N=1 (ideal-ideal chord), use the chord anchors:
    // strip bottom anchor (0, 0) maps from right's chord anchor.
    let oR: Point;
    if (ro.kind === 'finite') {
      const stripB = bJunction(i, 'bot');
      oR = { x: (stripB as { x: number; y: number }).x - ro.x, y: (stripB as { x: number; y: number }).y - ro.y };
    } else if (rt.kind === 'finite') {
      const stripA = aJunction(i, 'bot');
      oR = { x: (stripA as { x: number; y: number }).x - rt.x, y: (stripA as { x: number; y: number }).y - rt.y };
    } else {
      const rAnchor = r.anchor!;
      // Strip's bottom chord anchor (in strip frame) is (0, 0).
      oR = { x: -rAnchor.x, y: -rAnchor.y };
    }

    let oL: Point;
    if (lo.kind === 'finite') {
      const stripA = aJunction(i, 'top');
      oL = { x: (stripA as { x: number; y: number }).x - lo.x, y: (stripA as { x: number; y: number }).y - lo.y };
    } else if (lt.kind === 'finite') {
      const stripB = bJunction(i, 'top');
      oL = { x: (stripB as { x: number; y: number }).x - lt.x, y: (stripB as { x: number; y: number }).y - lt.y };
    } else {
      const lAnchor = l.anchor!;
      // Strip's top chord anchor is height · perp.
      oL = { x: height * perp.x - lAnchor.x, y: height * perp.y - lAnchor.y };
    }

    const T_RtoS = M.fromTranslate(oR.x, oR.y);
    const T_StoR = M.invert(T_RtoS);
    const T_LtoS = M.fromTranslate(oL.x, oL.y);
    const T_StoL = M.invert(T_LtoS);

    setTwin(r, bottomSides[i], T_RtoS, T_StoR);
    setTwin(l, topSides[i], T_LtoS, T_StoL);
  }

  attachFace(atlas, stripFace);

  return { stripFace, bottomSides, topSides };
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
  stripResult: InsertStripResult,
  splitResult: SplitAtlasAlongLineResult,
  oldHeight: number,
  newHeight: number,
): void {
  if (!(newHeight > 0)) {
    throw new Error('resizeStrip: newHeight must be positive');
  }
  const N = stripResult.bottomSides.length;
  if (N !== splitResult.pairs.length) {
    throw new Error(
      `resizeStrip: chain length mismatch (strip ${N} vs split ${splitResult.pairs.length})`,
    );
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
    if (!b.isChord || !t.isChord) {
      throw new Error('resizeStrip: N=1 strip must have chord HEs on bottom and top');
    }
    const o = t.origin();
    if (o.kind !== 'ideal') {
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
    if (b1.kind !== 'finite') {
      throw new Error('resizeStrip: bottomSides[1] expected to be finite');
    }
    let dxRaw = 0;
    let dyRaw = 0;
    if (N >= 3) {
      const b2 = stripResult.bottomSides[2].origin();
      if (b2.kind === 'finite') {
        dxRaw = b2.x - b1.x;
        dyRaw = b2.y - b1.y;
      }
    }
    if (dxRaw === 0 && dyRaw === 0) {
      // N == 2 fallback (or unexpected ideal middle origin): derive perp first.
      const t0 = stripResult.topSides[0].origin();
      if (t0.kind !== 'finite') {
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

  // ---- Shift the strip's "top" boundary by Δ · perp ----
  // For finite top HEs we just bump the origin. For ideal-ideal chord top
  // HEs (the N=1 digon case, or any future case where insertStrip put a
  // chord at the top) we bump the chord anchor instead — the ideal
  // direction is translation-invariant, but the line through R² shifts
  // perpendicularly by exactly Δ · perp.
  for (let i = 0; i < N; i++) {
    const t = stripResult.topSides[i];
    if (t.originKind === 'finite') {
      t.ox += dpx;
      t.oy += dpy;
    } else if (t.isChord) {
      const a = t.anchor!;
      t.anchor = { x: a.x + dpx, y: a.y + dpy };
    }
  }

  // ---- Update left-chord twin transforms ----
  // Translation-only invariant: T_LtoS gains exactly Δ·perp on its
  // translation part. The linear part is identity (translation), so we
  // build the new matrix by adding to .e/.f and inverting for the back-edge.
  for (let i = 0; i < N; i++) {
    const l = splitResult.pairs[i].leftChordSide;
    const t = stripResult.topSides[i];
    const oldT = l.transform;
    const T_LtoS = M.fromValues(
      oldT.a,
      oldT.b,
      oldT.c,
      oldT.d,
      oldT.e + dpx,
      oldT.f + dpy,
    );
    const T_StoL = M.invert(T_LtoS);
    setTwin(l, t, T_LtoS, T_StoL);
  }
}

