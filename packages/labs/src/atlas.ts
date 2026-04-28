import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';
import {
  applyLinearToDirection,
  cross,
  isPolygonCCW,
  type Junction,
  junctionInTranslatedFrame,
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
// `Vertex` class. Each `HalfEdge` carries its own intrinsic geometric data:
// the kind (`finite` or `ideal`) and face-local coordinates of its starting
// junction (a face-local point for finite, a unit direction for ideal). A
// half-edge's target is just `next.origin` (derived).
//
// "Vertices" / "junctions" are the equivalence classes of half-edges that
// meet at the same physical point — recoverable by walking
// `next-around-junction = he.twin?.next` (forward) and
// `prev-around-junction = he.prev.twin` (backward, used at boundaries).
//
// **Canonical face frame.** Each `Face` owns k ≥ 3 half-edges in CCW order
// forming a convex polygonal boundary. By convention `halfEdges[0]` is the
// anchor: its origin is finite at face-local `(0, 0)`. This pins down the
// face's local frame. The implementation today only constructs triangle faces
// (k = 3); the geometry layer is k-gon-ready so future operations (expand,
// contract, polygon regions) can introduce higher-k faces without touching
// the core invariants.
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
// HalfEdge
// ----------------------------------------------------------------------------

/**
 * A directed edge belonging to one face. The triple
 * `(originKind, ox, oy)` describes this half-edge's starting junction in
 * face-local coordinates.
 *
 * Two half-edges form a twin pair across a shared edge of the atlas. The
 * `transform` maps `this.face`'s frame to `twin.face`'s frame; see the
 * twin invariants in the file header. `twin = null` for unbounded edges
 * (currently only the at-infinity half-edges within faces that have two
 * ideal junctions).
 */
export class HalfEdge {
  originKind: 'finite' | 'ideal';
  /** Face-local x of starting junction (finite) or unit-direction x (ideal). */
  ox: number;
  /** Face-local y of starting junction (finite) or unit-direction y (ideal). */
  oy: number;
  /** Next half-edge CCW around `face`. */
  next!: HalfEdge;
  /** Previous half-edge CCW around `face` (i.e. the `he` such that `he.next === this`). */
  prev!: HalfEdge;
  /** Owning face. */
  face!: Face;
  /** Twin half-edge in the adjacent face, or null at a boundary. */
  twin: HalfEdge | null = null;
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

  /** Whether this is the (no-twin) at-infinity boundary half-edge. */
  get isAtInfinity(): boolean {
    return this.originKind === 'ideal' && this.next.originKind === 'ideal';
  }
}

// ----------------------------------------------------------------------------
// Face
// ----------------------------------------------------------------------------

/**
 * A convex polygonal face owning k ≥ 3 CCW-ordered half-edges.
 *
 * Convention: `halfEdges[0]` is the canonical anchor — its origin is finite
 * at face-local `(0, 0)`. This pins down the face's local frame uniquely.
 *
 * Convexity (every interior angle < π) is a model-level invariant checked by
 * {@link validateAtlas}; operations are responsible for producing only convex
 * sub-faces (decomposing as needed). The implementation today only constructs
 * triangle faces (k = 3), but every method here operates over the full k-gon
 * cycle.
 */
export class Face {
  halfEdges: HalfEdge[];
  /** Shapes assigned to this face (managed by the atlas's owner). */
  shapes: Set<Element> = new Set();

  constructor(halfEdges: HalfEdge[]) {
    if (halfEdges.length < 3) {
      throw new Error(`Face needs at least 3 half-edges, got ${halfEdges.length}`);
    }
    if (halfEdges[0].originKind !== 'finite') {
      throw new Error('halfEdges[0] (anchor) must have finite origin');
    }
    if (halfEdges[0].ox !== 0 || halfEdges[0].oy !== 0) {
      throw new Error(
        `halfEdges[0] (anchor) origin must be at face-local (0, 0); got (${halfEdges[0].ox}, ${halfEdges[0].oy})`,
      );
    }
    this.halfEdges = halfEdges;
    const k = halfEdges.length;
    for (let i = 0; i < k; i++) {
      const he = halfEdges[i];
      he.next = halfEdges[(i + 1) % k];
      he.prev = halfEdges[(i - 1 + k) % k];
      he.face = this;
    }
  }

  /** This face's k junctions (origins of its half-edges) in CCW order. */
  junctions(): Junction[] {
    return this.halfEdges.map((h) => h.origin());
  }

  /** Iterate this face's half-edges in CCW order, starting at the anchor. */
  *halfEdgesCCW(): IterableIterator<HalfEdge> {
    let he: HalfEdge = this.halfEdges[0];
    do {
      yield he;
      he = he.next;
    } while (he !== this.halfEdges[0]);
  }

  /** Test whether `p` (in this face's local frame) lies inside the face. */
  contains(p: Point): boolean {
    return polygonContains(this.junctions(), p);
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
export function* aroundJunction(he: HalfEdge): IterableIterator<HalfEdge> {
  // Forward: cur, cur.twin?.next, cur.twin?.next.twin?.next, ...
  // Stops at null twin or when the cycle closes back to `he`.
  const seen = new Set<HalfEdge>();
  let cur: HalfEdge | null = he;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    const t: HalfEdge | null = cur.twin;
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
//     `sameIdealDirection`, `junctionInTranslatedFrame`
//   - line predicates (`./atlas/geometry/line.ts`):
//     `leftOfDirectedEdge[Strict]`, `parameterOnSegment`
//   - convex polygons (`./atlas/geometry/polygon.ts`):
//     `polygonContains[Strict]`, `isPolygonCCW`
//
// Atlas-aware geometry — parameterisation and traversal of `HalfEdge`s —
// stays here, defined further down near `walkLine`:
//   - `pointOnHEAtU`, `uOfPointOnHE`, `intersectLineWithHE`, `findExit`
//   - line traversal: `walkLine` (returns a chain of `FaceCrossing`s)
//   - boundary-hit utilities: `boundaryHitToJunction`
//
// The mutation primitives further down (`splitFaceAtInterior`,
// `splitFaceAlongEdge`, `subdivideHalfEdge`, `subdivideAtInfinityArc`, …)
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
  halfEdges: HalfEdge[] = [];
  faces: Face[] = [];
  root: Face;

  constructor(root: Face) {
    this.root = root;
  }

  /**
   * BFS from `root`, computing the composite transform (face-local →
   * root-local) for every reachable face.
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
    out.set(this.root, M.fromValues());
    const queue: Face[] = [this.root];
    while (queue.length > 0) {
      const f = queue.shift()!;
      const mf = out.get(f)!;
      for (const he of f.halfEdgesCCW()) {
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

    const queue: AtlasImage[] = [{ face: this.root, composite: M.fromValues(), depth: 0 }];
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

      for (const he of img.face.halfEdgesCCW()) {
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
   * Returns the matrix `C = composite_old(newRoot)` (the new root's composite
   * in the old root's frame). Callers that maintain a view transform on top of
   * composites should right-multiply their view by `C` to keep all on-screen
   * positions invariant under the swap, since by construction:
   *
   *     view_old · composite_old(X) = (view_old · C) · composite_new(X)
   *
   * for every face X reachable from both roots. No structural data changes;
   * this is purely a "what frame are composites expressed in?" change.
   *
   * Returns identity if `newRoot` is already the root, or if it isn't
   * reachable from the current root (defensive — should not happen).
   */
  switchRoot(newRoot: Face): M.Matrix2D {
    if (newRoot === this.root) return M.fromValues();
    const composites = this.computeComposites();
    const C = composites.get(newRoot);
    if (!C) return M.fromValues();
    this.root = newRoot;
    return C;
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
  const allHalfEdges: HalfEdge[] = [];

  // For each adjacent pair (a, b) in idealDirections, create a wedge face
  // with origin O = (0, 0), then ideal directions a, b in CCW order.
  for (let i = 0; i < n; i++) {
    const [ax, ay] = idealDirections[i];
    const [bx, by] = idealDirections[(i + 1) % n];
    const he0 = new HalfEdge('finite', 0, 0); // O → A
    const he1 = new HalfEdge('ideal', ax, ay); // A → B (at infinity)
    const he2 = new HalfEdge('ideal', bx, by); // B → O
    const f = new Face([he0, he1, he2]);
    faces.push(f);
    allHalfEdges.push(he0, he1, he2);
  }

  // Twin the half-axes shared between consecutive wedges.
  // Wedge i's "B → O" half-edge (he[2]) twins wedge (i+1)%n's "O → A" half-edge (he[0]).
  // (Both lie along the same physical half-axis, opposite directions.)
  for (let i = 0; i < n; i++) {
    const me = faces[i];
    const next = faces[(i + 1) % n];
    const a = me.halfEdges[2];
    const b = next.halfEdges[0];
    a.twin = b;
    b.twin = a;
    // transforms remain identity (default)
  }

  // The ideal-ideal half-edges within each face (he[1]) lie at infinity and
  // have no twin — already null by default.

  const atlas = new Atlas(faces[0]);
  atlas.halfEdges = allHalfEdges;
  atlas.faces = faces;
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
export function translationToWrap(heA: HalfEdge, heB: HalfEdge, eps = 1e-6): M.Matrix2D {
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
  he: HalfEdge,
  target: HalfEdge,
  transform: M.Matrix2D,
  eps = 1e-6,
): void {
  if (he === target) throw new Error('linkEdgeToTwin: cannot twin a half-edge to itself');
  if (!atlas.halfEdges.includes(he) || !atlas.halfEdges.includes(target)) {
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
 * No-op when `he.twin === null`.
 */
export function unlinkEdgeFromTwin(he: HalfEdge): void {
  if (!he.twin) return;
  he.twin = null;
  he.transform = M.fromValues();
}

/**
 * Twin `heA` to `heB` under `transformAtoB` *symmetrically* — both
 * `heA.twin = heB` and `heB.twin = heA`, with mutually inverse transforms.
 *
 * This is the natural "wrap a strip into a cylinder" operation: a single
 * cycle, both edges referring to each other. For an asymmetric link
 * (e.g. one-way wrap where outside still points in but the wrap loops back
 * to itself), use {@link linkEdgeToTwin} directly.
 *
 * The standard cycle-closure invariant (walks between two faces give a
 * unique composite) is *intentionally* violated in the global sense once
 * non-trivial twin transforms exist on a loop — that's what gives us
 * holonomy. Per-link junction-correspondence is still required and
 * `validateAtlas` still checks it.
 *
 * Pre-conditions (all enforced via the underlying primitive):
 *  - both half-edges live in `atlas`
 *  - both have `twin === null`
 *  - both are finite-finite
 *  - `transformAtoB` satisfies the junction-correspondence equations
 *
 * Effect:
 *  - heA.twin = heB; heB.twin = heA
 *  - heA.transform = transformAtoB; heB.transform = inv(transformAtoB)
 */
export function wrapEdges(
  atlas: Atlas,
  heA: HalfEdge,
  heB: HalfEdge,
  transformAtoB: M.Matrix2D,
  eps = 1e-6,
): void {
  if (heB.twin !== null) {
    throw new Error('wrapEdges: heB must currently be untwinned (use linkEdgeToTwin for asymmetric links)');
  }
  linkEdgeToTwin(atlas, heA, heB, transformAtoB, eps);
  linkEdgeToTwin(atlas, heB, heA, M.invert(transformAtoB), eps);
}

/**
 * Symmetric inverse of {@link wrapEdges}: clear both `he.twin` and its
 * current partner's `twin` pointer (when the pointer is reciprocal).
 *
 * For asymmetric cleanup, use {@link unlinkEdgeFromTwin} directly on each
 * side independently.
 *
 * No-op when `he.twin === null`. When `he`'s partner is not reciprocal
 * (`he.twin.twin !== he`), only `he`'s pointer is cleared.
 */
export function untwinEdges(he: HalfEdge): void {
  const partner = he.twin;
  if (!partner) return;
  unlinkEdgeFromTwin(he);
  if (partner.twin === he) unlinkEdgeFromTwin(partner);
}

/**
 * Rescale a face's local frame by a uniform positive factor `R`. The face's
 * own stored geometry (every finite half-edge of `face.halfEdges`) gets its
 * coordinates multiplied by `R`, and every twin transform that touches the
 * face's frame is conjugated to compensate.
 *
 * Intended for **scaled regions / nested faces**: a region declares its
 * "interior scale" relative to outside, and updating that declared value
 * runs this primitive with `R = newScale / oldScale`.
 *
 * Junction correspondence is preserved by construction. The face anchor
 * stays at `(0, 0)` since `0 · R = 0`.
 *
 * Cases handled per twin link:
 *
 * | `he.face === face` | `he.twin.face === face` | new transform                                    |
 * | ------------------ | ----------------------- | ------------------------------------------------ |
 * | yes                | no                      | `T · scale(1/R)`  (boundary out: linear → 1/R)   |
 * | no                 | yes                     | `scale(R) · T`   (boundary in:  linear → R)      |
 * | yes                | yes                     | `scale(R) · T · scale(1/R)`  (wrap, conjugate)   |
 * | no                 | no                      | unchanged                                        |
 *
 * For the "wrap partner" row, conjugating a translation `T(p) = p + t` by a
 * uniform scale yields another translation: `T_new(p) = p + R·t`. So a
 * wrap that was previously a translation of length `L` becomes a
 * translation of length `R·L` — exactly what the now-`R`-times-bigger
 * boundary requires.
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

  for (const he of face.halfEdges) {
    if (he.originKind === 'finite') {
      he.ox *= R;
      he.oy *= R;
    }
  }

  const scaleR = M.fromScale(R);
  const scaleInvR = M.fromScale(1 / R);
  for (const he of atlas.halfEdges) {
    if (!he.twin) continue;
    const sourceIsFace = he.face === face;
    const targetIsFace = he.twin.face === face;
    if (!sourceIsFace && !targetIsFace) continue;
    let T = he.transform;
    if (sourceIsFace) T = M.multiply(T, scaleInvR);
    if (targetIsFace) T = M.multiply(scaleR, T);
    he.transform = T;
  }
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

  const allHESet = new Set(atlas.halfEdges);
  const allFaceSet = new Set(atlas.faces);

  // ---- per-face checks ----
  for (const f of atlas.faces) {
    const k = f.halfEdges.length;
    if (k < 3) {
      errs.push(`face has ${k} half-edges, expected at least 3`);
      continue;
    }

    // Anchor canonicality.
    const anchor = f.halfEdges[0];
    if (anchor.originKind !== 'finite') {
      errs.push('face anchor (halfEdges[0]) must have finite origin');
    }
    if (Math.abs(anchor.ox) > eps || Math.abs(anchor.oy) > eps) {
      errs.push(
        `face anchor origin must be at (0, 0), got (${anchor.ox}, ${anchor.oy})`,
      );
    }

    // Half-edge cycle integrity (next/prev consistency).
    for (let i = 0; i < k; i++) {
      const he = f.halfEdges[i];
      if (!allHESet.has(he)) errs.push('half-edge in face not in atlas.halfEdges');
      if (he.face !== f) errs.push('half-edge in face has wrong .face');
      if (he.next !== f.halfEdges[(i + 1) % k]) {
        errs.push(`face.halfEdges[${i}].next !== face.halfEdges[${(i + 1) % k}]`);
      }
      if (he.prev !== f.halfEdges[(i - 1 + k) % k]) {
        errs.push(`face.halfEdges[${i}].prev !== face.halfEdges[${(i - 1 + k) % k}]`);
      }
      if (he.next.prev !== he) {
        errs.push(`face.halfEdges[${i}].next.prev !== self`);
      }
    }

    // Ideal direction unit length.
    for (const he of f.halfEdges) {
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

    // At-infinity half-edges must have null twin (no transition across the
    // line at infinity).
    for (const he of f.halfEdges) {
      if (he.isAtInfinity && he.twin !== null) {
        errs.push('at-infinity half-edge has non-null twin');
      }
    }
  }

  // ---- per-half-edge checks (twin transform consistency) ----
  for (const h of atlas.halfEdges) {
    if (!allFaceSet.has(h.face)) errs.push('halfEdge.face not in atlas');

    if (h.twin) {
      if (!allHESet.has(h.twin)) errs.push('halfEdge.twin not in atlas');

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

  // ---- reachability from root (bidirectional under asymmetric twins) ----
  // A face is "reachable" if it can be visited by following twin links
  // either OUT of the current face (`he.twin.face`) OR INTO the current
  // face (some other half-edge `g` with `g.twin === he`). Symmetric twins
  // make these two equivalent; asymmetric wraps may make them diverge.
  // We pre-compute incoming pointers once per validation pass.
  const incoming = new Map<Face, HalfEdge[]>();
  for (const h of atlas.halfEdges) {
    if (h.twin) {
      const list = incoming.get(h.twin.face);
      if (list) list.push(h);
      else incoming.set(h.twin.face, [h]);
    }
  }
  const reachable = new Set<Face>();
  const queue: Face[] = [atlas.root];
  reachable.add(atlas.root);
  while (queue.length > 0) {
    const f = queue.shift()!;
    for (const he of f.halfEdgesCCW()) {
      if (he.twin && !reachable.has(he.twin.face)) {
        reachable.add(he.twin.face);
        queue.push(he.twin.face);
      }
    }
    const incomingHEs = incoming.get(f);
    if (incomingHEs) {
      for (const ih of incomingHEs) {
        if (!reachable.has(ih.face)) {
          reachable.add(ih.face);
          queue.push(ih.face);
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
// Frame-change-at-point helper
// ----------------------------------------------------------------------------

/**
 * Recompute a twin pair's transforms after re-anchoring one side's frame.
 *
 * Setup:
 *   - `T_old` is the existing edge transform `F → ext` (i.e. `h.transform`,
 *     where `h` lives in face F and `h.twin` lives in face `ext`).
 *   - We're replacing F with a sub-face whose frame relates to F by `R`:
 *     a point `(x, y)` in the sub-frame equals `R · (x, y)` in F's frame.
 *     (`R` is "sub → F"; equivalently, F's frame is the sub-frame composed
 *     with `R`.)
 *
 * After the rebase, the new edge transforms are:
 *   - `fwd: sub → ext  =  T_old · R`  (re-express in the sub-frame, then jump to ext)
 *   - `rev: ext → sub  =  inv(fwd)`   (twins are always inverse pairs)
 *
 * In the operational regime (invariant 7 — translation-only edges), `R` is
 * always a translation. The signature accepts a general `Matrix2DReadonly`
 * so the same helper carries through unchanged once uniform scale is enabled.
 *
 * Pure function: doesn't mutate anything. Returns fresh matrices.
 */
export function rebaseTwinTransform(
  T_old: M.Matrix2DReadonly,
  R: M.Matrix2DReadonly,
): { fwd: M.Matrix2D; rev: M.Matrix2D } {
  const fwd = M.multiply(T_old, R);
  const rev = M.invert(fwd);
  return { fwd, rev };
}

/**
 * Convenience for the common case: `R = translate(point)`. Used by the splits
 * to re-anchor a sub-face whose origin sits at `point` in the parent's frame.
 */
export function rebaseTwinTransformByTranslation(
  T_old: M.Matrix2DReadonly,
  point: Point,
): { fwd: M.Matrix2D; rev: M.Matrix2D } {
  return rebaseTwinTransform(T_old, M.fromTranslate(point.x, point.y));
}

// ----------------------------------------------------------------------------
// Mutation primitives
// ----------------------------------------------------------------------------

export interface SplitInteriorResult {
  /**
   * The k new sub-faces (one per side of the original face). `faces[i]`
   * touches the old face's edge between old-junctions `i` and `(i+1) % k`
   * (i.e. the side originally bounded by `oldFace.halfEdges[i]`).
   */
  faces: Face[];
}

/**
 * Split `face` (a convex k-gon, k ≥ 3) by inserting a finite junction at
 * `point` strictly inside it. Replaces the single face with k triangle
 * sub-faces fanning around the point.
 *
 * `point` is in `face`'s local frame and must lie strictly inside (use
 * {@link splitFaceAlongEdge} for points on a boundary).
 *
 * Each new sub-face's anchor is at the inserted point. Their frames are
 * `face`'s frame translated by `-point`, so the inserted point sits at the
 * canonical `(0, 0)` of every new sub-face.
 */
export function splitFaceAtInterior(
  atlas: Atlas,
  face: Face,
  point: Point,
): SplitInteriorResult {
  if (!atlas.faces.includes(face)) throw new Error('face not in atlas');
  if (!polygonContainsStrict(face.junctions(), point)) {
    throw new Error('splitFaceAtInterior: point is not strictly interior to face');
  }

  const k = face.halfEdges.length;

  // Capture the old face's junctions and external twins (in neighbour faces)
  // and their old transforms BEFORE we mutate.
  const oldJunctions = face.junctions();
  const oldHEs = face.halfEdges;
  // For each side i = old half-edge oldHEs[i] going from oldJunctions[i] to
  // oldJunctions[(i+1)%k], capture its twin and twin-direction transform.
  const externalTwins: Array<{ ext: HalfEdge | null; T_old: M.Matrix2DReadonly | null }> = [];
  for (let i = 0; i < k; i++) {
    externalTwins.push({
      ext: oldHEs[i].twin,
      T_old: oldHEs[i].twin ? oldHEs[i].transform : null,
    });
  }

  // Build the k sub-triangles. Each is anchored at the inserted point (which
  // sits at (0, 0) in each sub-face's frame). The other two junctions are
  // re-coordinated copies of the old face's corresponding pair.
  //
  // Convention:  subFaces[i]'s CCW corners are (p, oldJ[i], oldJ[(i+1)%k])
  //              => halfEdges[0] = p → oldJ[i]            (anchor)
  //                 halfEdges[1] = oldJ[i] → oldJ[(i+1)%k]   (matches old side i)
  //                 halfEdges[2] = oldJ[(i+1)%k] → p
  const subFaces: Face[] = [];
  for (let i = 0; i < k; i++) {
    const a = oldJunctions[i];
    const b = oldJunctions[(i + 1) % k];
    const aShifted = junctionInTranslatedFrame(a, point);
    const bShifted = junctionInTranslatedFrame(b, point);

    const he0 = new HalfEdge('finite', 0, 0); // p → a
    const he1 = new HalfEdge(aShifted.kind, aShifted.x, aShifted.y); // a → b
    const he2 = new HalfEdge(bShifted.kind, bShifted.x, bShifted.y); // b → p
    const sub = new Face([he0, he1, he2]);
    subFaces.push(sub);
  }

  // Internal twins between adjacent sub-faces (all share a single frame, so
  // identity transforms throughout):
  //   subFaces[i].halfEdges[2] (b_i → p)  ↔  subFaces[(i+1)%k].halfEdges[0] (p → a_{i+1})
  //   where b_i = a_{i+1} physically.
  for (let i = 0; i < k; i++) {
    const next = (i + 1) % k;
    const h2 = subFaces[i].halfEdges[2]; // b_i → p
    const h0 = subFaces[next].halfEdges[0]; // p → a_{i+1}
    setTwin(h2, h0, M.fromValues(), M.fromValues());
  }

  // External twins: re-attach each old neighbour to the new corresponding
  // sub-face's outer half-edge (halfEdges[1], the one matching old side i).
  // Frame change is sub → F = translate(p) — sub-face's frame is F's frame
  // translated so that the inserted point sits at sub-frame's (0, 0).
  for (let i = 0; i < k; i++) {
    const ext = externalTwins[i].ext;
    if (!ext) continue;
    const T_old = externalTwins[i].T_old!;
    const subOuter = subFaces[i].halfEdges[1];
    const { fwd, rev } = rebaseTwinTransformByTranslation(T_old, point);
    setTwin(subOuter, ext, fwd, rev);
  }

  // Detach old face from atlas state, attach new ones.
  detachFace(atlas, face);
  for (const sub of subFaces) attachFace(atlas, sub);

  if (atlas.root === face) atlas.root = subFaces[0];

  return { faces: subFaces };
}

export interface SplitEdgeResult {
  /**
   * The new sub-faces, in this order:
   *   [0] in `halfEdge.face`, on the side of `halfEdge.origin`
   *   [1] in `halfEdge.face`, on the side of `halfEdge.target`
   *   [2] in `halfEdge.twin.face`, on the side of `twin.origin`
   *   [3] in `halfEdge.twin.face`, on the side of `twin.target`
   * If `halfEdge.twin` is null only the first two are returned.
   */
  faces: Face[];
}

/**
 * Split a half-edge by inserting a finite junction on it. The two faces
 * incident to the edge each become two new triangles via an interior edge
 * from the inserted point to the opposite vertex.
 *
 * `point` is in `halfEdge.face`'s local frame and must lie strictly between
 * the two endpoints of `halfEdge` (not coincident with either, both of which
 * must be finite for now).
 *
 * If `halfEdge.twin` is null (e.g. an at-infinity boundary) only
 * `halfEdge.face` is split.
 *
 * NOTE: Currently restricted to triangle faces (k = 3) on each side of the
 * edge. Generalising to k-gon inputs requires choosing a strategy for the
 * interior cut: in a k-gon "the opposite vertex" isn't unambiguous. The
 * simplest k-gon strategy — insert the vertex without cutting, turning the
 * face into a (k+1)-gon — is a *different* primitive and not implemented
 * here. TODO: revisit once the first non-triangle face exists in the atlas
 * (likely once the expand operation lands).
 */
export function splitFaceAlongEdge(
  atlas: Atlas,
  halfEdge: HalfEdge,
  point: Point,
): SplitEdgeResult {
  if (!atlas.halfEdges.includes(halfEdge)) {
    throw new Error('halfEdge not in atlas');
  }

  // For now we require both endpoints of the splitting edge to be finite.
  if (halfEdge.originKind !== 'finite' || halfEdge.next.originKind !== 'finite') {
    throw new Error('splitFaceAlongEdge: only finite-finite edges are supported');
  }

  // Triangle-only restriction (see header comment).
  if (halfEdge.face.halfEdges.length !== 3) {
    throw new Error('splitFaceAlongEdge: only triangle faces are supported (k = 3)');
  }
  if (halfEdge.twin && halfEdge.twin.face.halfEdges.length !== 3) {
    throw new Error('splitFaceAlongEdge: twin face must also be a triangle (k = 3)');
  }

  const a = halfEdge.origin();
  const b = halfEdge.target();
  // Verify point is strictly between a and b on the line ab.
  const t = parameterOnSegment(
    { x: a.x, y: a.y },
    { x: b.x, y: b.y },
    point,
  );
  if (t === null || t <= 1e-12 || t >= 1 - 1e-12) {
    throw new Error('splitFaceAlongEdge: point not strictly between edge endpoints');
  }

  const result: SplitEdgeResult = { faces: [] };

  /**
   * Split one side of the edge. `side` is the half-edge in face F whose
   * (a → b) we're splitting at face-local point `pInF`. F's CCW junctions
   * are `(a, b, c)` where a = side.origin, b = side.next.origin,
   * c = side.next.next.origin.
   *
   * Produces two sub-faces both anchored at `p` (so they share F's frame
   * translated by -pInF):
   *   sideA = (p, a, c)   — touches old edge (c → a)
   *   sideB = (p, b, c)   — touches old edge (b → c)
   *                      (also note a-side and b-side are flipped vs. naïve;
   *                       we re-anchor at p so the orientations are CCW.)
   *
   * Wait that's wrong, let me redo.
   *
   * Old face F has CCW junctions (a, b, c). We split edge a→b at p, getting:
   *   F_A = (a, p, c)  — uses old edge (c → a) on its side
   *   F_B = (p, b, c)  — uses old edge (b → c) on its side
   *
   * Re-anchored at p, these become (in sub-face frame = F's translated by -pInF):
   *   F_A vertices: (a-p, 0, c-p);  CCW order anchored at p: (p, c, a)... hmm
   *
   * To keep things simple and uniform we just anchor each sub-face at p
   * directly, with halfEdges[0] = p → x for some appropriate x to keep CCW.
   */
  const splitOneSide = (
    side: HalfEdge,
    pInF: Point,
  ): { sideA: Face; sideB: Face } => {
    const F = side.face;
    const sideIdx = F.halfEdges.indexOf(side);
    const aJ = F.halfEdges[sideIdx].origin();
    const bJ = F.halfEdges[(sideIdx + 1) % 3].origin();
    const cJ = F.halfEdges[(sideIdx + 2) % 3].origin();

    const aShift = junctionInTranslatedFrame(aJ, pInF);
    const bShift = junctionInTranslatedFrame(bJ, pInF);
    const cShift = junctionInTranslatedFrame(cJ, pInF);

    // F_A (a, p, c) → re-anchored CCW at p: order is (p, c, a) [going around p].
    // Verify: original (a, p, c) CCW means going a→p→c is CCW. Going p→c→a is
    // a CCW rotation of that 3-cycle (still CCW).
    // halfEdges of F_A:
    //   he0 = p → c   (anchor at p)
    //   he1 = c → a   (this is the original (c → a) edge; matches outer twin slot)
    //   he2 = a → p   (will be twinned to F_B's he0)
    const F_A_he0 = new HalfEdge('finite', 0, 0);
    const F_A_he1 = new HalfEdge(cShift.kind, cShift.x, cShift.y);
    const F_A_he2 = new HalfEdge(aShift.kind, aShift.x, aShift.y);
    const F_A = new Face([F_A_he0, F_A_he1, F_A_he2]);

    // F_B (p, b, c) → already anchored at p. CCW order: (p, b, c).
    // halfEdges:
    //   he0 = p → b
    //   he1 = b → c   (this is the original (b → c) edge; matches outer twin slot)
    //   he2 = c → p
    const F_B_he0 = new HalfEdge('finite', 0, 0);
    const F_B_he1 = new HalfEdge(bShift.kind, bShift.x, bShift.y);
    const F_B_he2 = new HalfEdge(cShift.kind, cShift.x, cShift.y);
    const F_B = new Face([F_B_he0, F_B_he1, F_B_he2]);

    return { sideA: F_A, sideB: F_B };
  };

  // Capture external twins of the four "outer" half-edges in F before mutation.
  // F's outer edges are the two NOT being split:
  //   F_he_BC = (b → c)
  //   F_he_CA = (c → a)
  const F = halfEdge.face;
  const sideIdx = F.halfEdges.indexOf(halfEdge);
  const F_he_BC = F.halfEdges[(sideIdx + 1) % 3];
  const F_he_CA = F.halfEdges[(sideIdx + 2) % 3];

  const ext_F_BC = F_he_BC.twin;
  const T_F_BC = ext_F_BC ? F_he_BC.transform : null;
  const ext_F_CA = F_he_CA.twin;
  const T_F_CA = ext_F_CA ? F_he_CA.transform : null;

  // Split F.
  const Fsplit = splitOneSide(halfEdge, point);

  // Internal twin within F's split: F_A.he2 (a → p) ↔ F_B.he0 (p → b).
  // Both share F's frame translated by -p, so identity.
  // Wait, F_A.he2 is (a → p), and F_B.he0 is (p → b). These are *not* twins —
  // they're consecutive segments along the original a→b edge. The twins should
  // be inside the face, on the (p → c) edge:
  //   F_A.he0 (p → c) ↔ F_B.he2 (c → p).  ✓ These are opposite directions on the same internal edge.
  setTwin(Fsplit.sideA.halfEdges[0], Fsplit.sideB.halfEdges[2], M.fromValues(), M.fromValues());

  // Re-attach external twins of the two preserved edges (b→c and c→a) to
  // F_B and F_A respectively. Both new faces are F's frame translated by -p,
  // i.e. sub → F = translate(p).
  if (ext_F_BC) {
    const { fwd, rev } = rebaseTwinTransformByTranslation(T_F_BC!, point);
    setTwin(Fsplit.sideB.halfEdges[1], ext_F_BC, fwd, rev);
  }
  if (ext_F_CA) {
    const { fwd, rev } = rebaseTwinTransformByTranslation(T_F_CA!, point);
    setTwin(Fsplit.sideA.halfEdges[1], ext_F_CA, fwd, rev);
  }

  // If there's a twin face on the other side of the split edge, split it too.
  let G_results: ReturnType<typeof splitOneSide> | null = null;
  let T_he_old: M.Matrix2DReadonly | null = null;
  if (halfEdge.twin) {
    T_he_old = halfEdge.transform;
    const twinHE = halfEdge.twin;
    const G = twinHE.face;
    const twinIdx = G.halfEdges.indexOf(twinHE);
    const G_he_BC = G.halfEdges[(twinIdx + 1) % 3];
    const G_he_CA = G.halfEdges[(twinIdx + 2) % 3];
    const ext_G_BC = G_he_BC.twin;
    const T_G_BC = ext_G_BC ? G_he_BC.transform : null;
    const ext_G_CA = G_he_CA.twin;
    const T_G_CA = ext_G_CA ? G_he_CA.transform : null;

    // The split point in G's frame is T_he_old · point.
    const pointInG = M.applyToPoint(T_he_old, point);
    G_results = splitOneSide(twinHE, pointInG);
    setTwin(
      G_results.sideA.halfEdges[0],
      G_results.sideB.halfEdges[2],
      M.fromValues(),
      M.fromValues(),
    );

    // Re-attach G's outer external twins. G's sub-frame → G = translate(pointInG).
    if (ext_G_BC) {
      const { fwd, rev } = rebaseTwinTransformByTranslation(T_G_BC!, pointInG);
      setTwin(G_results.sideB.halfEdges[1], ext_G_BC, fwd, rev);
    }
    if (ext_G_CA) {
      const { fwd, rev } = rebaseTwinTransformByTranslation(T_G_CA!, pointInG);
      setTwin(G_results.sideA.halfEdges[1], ext_G_CA, fwd, rev);
    }

    // Wire the new internal twins ACROSS the split edge between F's sub-faces
    // and G's sub-faces.
    //
    // In F: F_A.halfEdges[2] = (a → p),  F_B.halfEdges[0] = (p → b).
    // In G: G's twin half-edge originally went b' → a' (opposite of F's a → b).
    //       G_A.halfEdges[2] = (b' → p),  G_B.halfEdges[0] = (p → a').
    //
    // Twin pairs across the split (opposite directions on the same physical
    // half-segment, transform = T_he_old between F's frame and G's frame):
    //
    //   F_A.halfEdges[2] (a → p)  ↔  G_B.halfEdges[0] (p → a')
    //   F_B.halfEdges[0] (p → b)  ↔  G_A.halfEdges[2] (b' → p)
    //
    // The composite of two frame changes (re-anchor F by point, then jump
    // F→G via T_he_old, then re-anchor G by pointInG):
    //   subF → subG = translate(-pointInG) · T_he_old · translate(point)
    // which is exactly `rebaseTwinTransform(T_he_old, R_F)` re-anchored on
    // the G side by `inv(R_G)`. Compose by stacking the helper twice (once
    // on each side):
    const R_F = M.fromTranslate(point.x, point.y); // subF → F
    const R_G = M.fromTranslate(pointInG.x, pointInG.y); // subG → G
    // Go subF → F → G → subG by composing all three:
    const T_subF_to_G = M.multiply(T_he_old as M.Matrix2D, R_F);
    const T_subF_to_subG = M.multiply(M.invert(R_G), T_subF_to_G);
    const T_subG_to_subF = M.invert(T_subF_to_subG);

    setTwin(Fsplit.sideA.halfEdges[2], G_results.sideB.halfEdges[0], T_subF_to_subG, T_subG_to_subF);
    setTwin(Fsplit.sideB.halfEdges[0], G_results.sideA.halfEdges[2], T_subF_to_subG, T_subG_to_subF);
  }
  // If no twin (boundary edge), F_A.halfEdges[2] and F_B.halfEdges[0] just
  // remain twin = null.

  // Detach old faces, attach new ones.
  const oldFaces: Face[] = [F];
  if (halfEdge.twin) oldFaces.push(halfEdge.twin.face);
  for (const f of oldFaces) detachFace(atlas, f);

  attachFace(atlas, Fsplit.sideA);
  attachFace(atlas, Fsplit.sideB);
  result.faces.push(Fsplit.sideA, Fsplit.sideB);

  if (G_results) {
    attachFace(atlas, G_results.sideA);
    attachFace(atlas, G_results.sideB);
    result.faces.push(G_results.sideA, G_results.sideB);
  }

  if (oldFaces.includes(atlas.root)) {
    atlas.root = Fsplit.sideA;
  }

  return result;
}

/**
 * Result of {@link subdivideHalfEdge}: the new vertex's position and the
 * two replacement half-edges in each affected face.
 */
export interface SubdivideHalfEdgeResult {
  /** Position of the inserted vertex in `halfEdge.face`'s local frame. */
  newVertex: Point;
  /** Replacement half-edges in `halfEdge.face`, in CCW order: `[origin→new, new→target]`. */
  faceHalves: [HalfEdge, HalfEdge];
  /**
   * Replacement half-edges in `halfEdge.twin.face` (or `null` if no twin),
   * in CCW order: `[oldTwin.origin→new, new→oldTwin.target]` (i.e. opposite
   * directions of `faceHalves`).
   */
  twinHalves: [HalfEdge, HalfEdge] | null;
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
 * Supported edge kinds: finite-finite, finite-ideal, ideal-finite. Use
 * {@link subdivideAtInfinityArc} for ideal-ideal arcs.
 *
 * Mutates the existing `Face` objects in place — face identity is preserved,
 * shapes assigned to either face stay assigned.
 */
export function subdivideHalfEdge(
  atlas: Atlas,
  halfEdge: HalfEdge,
  point: Point,
): SubdivideHalfEdgeResult {
  if (!atlas.halfEdges.includes(halfEdge)) {
    throw new Error('subdivideHalfEdge: halfEdge not in atlas');
  }
  if (halfEdge.isAtInfinity) {
    throw new Error('subdivideHalfEdge: at-infinity arc — use subdivideAtInfinityArc');
  }

  // Validate the point lies strictly between the two endpoints, with
  // collinearity tolerance.
  const u = uOfPointOnHE(halfEdge, point);
  const isFF = halfEdge.originKind === 'finite' && halfEdge.next.originKind === 'finite';
  const uMin = 1e-9;
  const uMaxEnd = isFF ? 1 - 1e-9 : Infinity;
  if (!Number.isFinite(u) || u <= uMin || u >= uMaxEnd) {
    throw new Error(
      `subdivideHalfEdge: point not strictly between endpoints (u = ${u}, isFF = ${isFF})`,
    );
  }
  const projected = pointOnHEAtU(halfEdge, u);
  const dx = projected.x - point.x;
  const dy = projected.y - point.y;
  if (dx * dx + dy * dy > 1e-12) {
    throw new Error('subdivideHalfEdge: point is not on the edge');
  }

  // ---- F side ----
  const F = halfEdge.face;
  const origin = halfEdge.origin();
  const he_A = new HalfEdge(origin.kind, origin.x, origin.y); // origin → newVertex
  const he_B = new HalfEdge('finite', point.x, point.y); // newVertex → target
  he_A.face = F;
  he_B.face = F;

  const fIdx = F.halfEdges.indexOf(halfEdge);
  F.halfEdges.splice(fIdx, 1, he_A, he_B);
  rewireFaceCycle(F);

  // Update atlas half-edge index.
  const heIdx = atlas.halfEdges.indexOf(halfEdge);
  atlas.halfEdges.splice(heIdx, 1, he_A, he_B);

  // ---- G (twin) side ----
  let twinHalves: [HalfEdge, HalfEdge] | null = null;
  if (halfEdge.twin) {
    const T = halfEdge.transform;
    const twin = halfEdge.twin;
    const G = twin.face;
    const tOrigin = twin.origin();
    const pointInG = M.applyToPoint(T, point);

    const tw_A = new HalfEdge(tOrigin.kind, tOrigin.x, tOrigin.y); // twin.origin → newVertex'
    const tw_B = new HalfEdge('finite', pointInG.x, pointInG.y); // newVertex' → twin.target
    tw_A.face = G;
    tw_B.face = G;

    const gIdx = G.halfEdges.indexOf(twin);
    G.halfEdges.splice(gIdx, 1, tw_A, tw_B);
    rewireFaceCycle(G);

    const twinIdx = atlas.halfEdges.indexOf(twin);
    atlas.halfEdges.splice(twinIdx, 1, tw_A, tw_B);

    // Twin pairs (transforms preserve the original T — frames F and G are unchanged):
    //   he_A (F: origin → newP)  ↔  tw_B (G: newP' → twin.target = origin')
    //   he_B (F: newP → target)  ↔  tw_A (G: twin.origin = target' → newP')
    const T_fwd = M.fromValues(T.a, T.b, T.c, T.d, T.e, T.f);
    const T_rev = M.invert(T_fwd);
    setTwin(he_A, tw_B, T_fwd, M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f));
    setTwin(
      he_B,
      tw_A,
      M.fromValues(T_fwd.a, T_fwd.b, T_fwd.c, T_fwd.d, T_fwd.e, T_fwd.f),
      M.fromValues(T_rev.a, T_rev.b, T_rev.c, T_rev.d, T_rev.e, T_rev.f),
    );
    twinHalves = [tw_A, tw_B];
  }

  return { newVertex: point, faceHalves: [he_A, he_B], twinHalves };
}

/**
 * Result of {@link subdivideAtInfinityArc}: the new ideal vertex's direction
 * and the two replacement half-edges in the affected face.
 */
export interface SubdivideAtInfinityArcResult {
  /** Unit direction of the inserted ideal vertex, in the face's frame. */
  newIdealDir: Point;
  /** Replacement half-edges, in CCW order: `[arcStart→new, new→arcEnd]`. */
  arcHalves: [HalfEdge, HalfEdge];
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
  arcHE: HalfEdge,
  idealDir: Point,
): SubdivideAtInfinityArcResult {
  if (!atlas.halfEdges.includes(arcHE)) {
    throw new Error('subdivideAtInfinityArc: arcHE not in atlas');
  }
  if (!arcHE.isAtInfinity) {
    throw new Error('subdivideAtInfinityArc: half-edge is not an at-infinity arc');
  }
  if (arcHE.twin !== null) {
    throw new Error('subdivideAtInfinityArc: at-infinity arc unexpectedly has a twin');
  }

  const len = Math.hypot(idealDir.x, idealDir.y);
  if (len < 1e-9) throw new Error('subdivideAtInfinityArc: idealDir has zero length');
  const dir = { x: idealDir.x / len, y: idealDir.y / len };

  const a = arcHE.origin();
  const b = arcHE.next.origin();
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

  const F = arcHE.face;
  const arc_A = new HalfEdge('ideal', a.x, a.y); // a → newIdeal
  const arc_B = new HalfEdge('ideal', dir.x, dir.y); // newIdeal → b
  arc_A.face = F;
  arc_B.face = F;

  const fIdx = F.halfEdges.indexOf(arcHE);
  F.halfEdges.splice(fIdx, 1, arc_A, arc_B);
  rewireFaceCycle(F);

  const heIdx = atlas.halfEdges.indexOf(arcHE);
  atlas.halfEdges.splice(heIdx, 1, arc_A, arc_B);

  // No twins for at-infinity arc halves.

  return { newIdealDir: dir, arcHalves: [arc_A, arc_B] };
}

/**
 * Result of a chord split: the two sub-faces and the two half-edges of the
 * new chord (twin pair). The sub-face ordering is documented per primitive:
 * - {@link splitFaceAtVertices}: `faces[0]` is the sub-face whose boundary
 *   arc traverses CCW from vertex A to vertex B (geometrically: on the
 *   *right* of the directed chord A → B). `faces[1]` is the other side.
 * - {@link splitFaceAlongChord}: `faces[0]` is the side on the *right* of
 *   the chord direction `entry → exit` (= the side reached by going CCW
 *   around the original face from entry to exit).
 *
 * `chordHEs[i]` is the chord's half-edge in `faces[i]`. They are twins of
 * each other, with a translation transform encoding the two sub-faces'
 * differing anchor offsets.
 */
export interface SplitChordResult {
  faces: [Face, Face];
  chordHEs: [HalfEdge, HalfEdge];
}

/**
 * Split `face` along a straight chord between two of its existing vertices
 * `face.halfEdges[vIdxA].origin()` and `face.halfEdges[vIdxB].origin()`.
 *
 * Constraints:
 *   - `vIdxA !== vIdxB` and the two indices are non-adjacent (the chord
 *     would otherwise coincide with an existing edge).
 *   - Each resulting sub-face must contain at least one finite vertex (used
 *     as its anchor). Throws otherwise.
 *
 * The original face is detached and replaced by two new convex sub-faces.
 * External twin pointers are rewired with a translation update on each
 * preserved edge (sub-frame → original frame is `translate(subAnchor)`).
 * The two new chord half-edges are twins of each other with a translation
 * transform `translate(leftAnchor − rightAnchor)`.
 *
 * The atlas's `root` is replaced with `faces[0]` if it was the split face.
 */
export function splitFaceAtVertices(
  atlas: Atlas,
  face: Face,
  vIdxA: number,
  vIdxB: number,
): SplitChordResult {
  if (!atlas.faces.includes(face)) throw new Error('splitFaceAtVertices: face not in atlas');
  const k = face.halfEdges.length;
  if (vIdxA === vIdxB) throw new Error('splitFaceAtVertices: vIdxA === vIdxB');
  if (vIdxA < 0 || vIdxA >= k || vIdxB < 0 || vIdxB >= k) {
    throw new Error('splitFaceAtVertices: vertex index out of range');
  }
  // Adjacency check: dist=1 means the chord would coincide with an existing edge.
  const dAbs = Math.abs(vIdxA - vIdxB);
  const dist = Math.min(dAbs, k - dAbs);
  if (dist < 2) {
    throw new Error(
      'splitFaceAtVertices: chord endpoints are adjacent (would coincide with an edge)',
    );
  }

  // Build the two boundary arcs of original-face vertex INDICES.
  // arc0: CCW from vIdxA to vIdxB (inclusive both ends).
  // arc1: CCW from vIdxB to vIdxA (inclusive both ends).
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

  // Cache external twins of the preserved HEs (every HE EXCEPT the closing
  // chord) for each arc. arc[i] is the index in face.halfEdges of the HE that
  // goes from vertex `arc[i]` to vertex `arc[i+1]`. Preserved indices are
  // `arc[0..arc.length-2]`; arc[-1] would be the chord which doesn't exist
  // pre-split.
  const cacheExt = (arc: number[]) => {
    const exts: Array<{ twin: HalfEdge | null; T_old: M.Matrix2DReadonly | null }> = [];
    for (let i = 0; i < arc.length - 1; i++) {
      const he = face.halfEdges[arc[i]];
      exts.push({ twin: he.twin, T_old: he.twin ? he.transform : null });
    }
    return exts;
  };
  const ext0 = cacheExt(arc0);
  const ext1 = cacheExt(arc1);

  // Junction lists in original-face frame.
  const origJ = face.junctions();
  const verts0 = arc0.map((i) => origJ[i]);
  const verts1 = arc1.map((i) => origJ[i]);

  // Pick anchor: first finite vertex in each arc.
  const findAnchorIdx = (verts: Junction[]): number => {
    for (let i = 0; i < verts.length; i++) if (verts[i].kind === 'finite') return i;
    return -1;
  };
  const anchor0 = findAnchorIdx(verts0);
  const anchor1 = findAnchorIdx(verts1);
  if (anchor0 < 0) {
    throw new Error('splitFaceAtVertices: sub-face 0 has no finite vertex for anchor');
  }
  if (anchor1 < 0) {
    throw new Error('splitFaceAtVertices: sub-face 1 has no finite vertex for anchor');
  }
  const a0Pt = { x: (verts0[anchor0] as Junction).x, y: (verts0[anchor0] as Junction).y };
  const a1Pt = { x: (verts1[anchor1] as Junction).x, y: (verts1[anchor1] as Junction).y };

  // Build sub-face HE list. Pre-rotation index `i` corresponds to vertex
  // verts[i] and edge verts[i] → verts[(i+1) % n]. Post-rotation index
  // (so that anchor sits at hes[0]) is `(i - anchorIdx + n) % n`.
  const buildSubFace = (
    verts: Junction[],
    anchorIdx: number,
    anchorPt: Point,
  ): { face: Face; hes: HalfEdge[]; preIndexToHE: HalfEdge[]; chordHE: HalfEdge } => {
    const n = verts.length;
    const rotated: Junction[] = [];
    for (let i = 0; i < n; i++) rotated.push(verts[(i + anchorIdx) % n]);
    const translated = rotated.map((j) => junctionInTranslatedFrame(j, anchorPt));
    const hes = translated.map((j) => new HalfEdge(j.kind, j.x, j.y));
    const f = new Face(hes);
    // Map pre-rotation index → HE for external rewiring.
    const preIndexToHE: HalfEdge[] = new Array(n);
    for (let i = 0; i < n; i++) preIndexToHE[i] = hes[((i - anchorIdx) % n + n) % n];
    // Chord HE: pre-rotation index `n - 1` (closing edge from last vertex to first).
    const chordHE = preIndexToHE[n - 1];
    return { face: f, hes, preIndexToHE, chordHE };
  };

  const sub0 = buildSubFace(verts0, anchor0, a0Pt);
  const sub1 = buildSubFace(verts1, anchor1, a1Pt);

  // Wire the chord twin pair. sub0's chord goes from arc-last (vIdxB) to
  // arc-first (vIdxA) in sub0's frame; sub1's chord goes from arc-last
  // (vIdxA) to arc-first (vIdxB) in sub1's frame. They're the same physical
  // edge in opposite directions.
  // Frame change sub0 → sub1 = translate(a0Pt − a1Pt): a point (x, y) in sub0
  // is at (x + a0Pt.x, y + a0Pt.y) in original frame, which is at
  // (x + a0Pt.x − a1Pt.x, y + a0Pt.y − a1Pt.y) in sub1's frame.
  const sub0ToSub1 = M.fromTranslate(a0Pt.x - a1Pt.x, a0Pt.y - a1Pt.y);
  const sub1ToSub0 = M.invert(sub0ToSub1);
  setTwin(sub0.chordHE, sub1.chordHE, sub0ToSub1, sub1ToSub0);

  // Rewire external twins of preserved HEs.
  const wireExternals = (
    sub: { preIndexToHE: HalfEdge[] },
    ext: Array<{ twin: HalfEdge | null; T_old: M.Matrix2DReadonly | null }>,
    anchorPt: Point,
  ) => {
    for (let i = 0; i < ext.length; i++) {
      const e = ext[i];
      if (!e.twin) continue;
      const subHE = sub.preIndexToHE[i];
      const { fwd, rev } = rebaseTwinTransformByTranslation(e.T_old!, anchorPt);
      setTwin(subHE, e.twin, fwd, rev);
    }
  };
  wireExternals(sub0, ext0, a0Pt);
  wireExternals(sub1, ext1, a1Pt);

  // Detach old, attach new.
  detachFace(atlas, face);
  attachFace(atlas, sub0.face);
  attachFace(atlas, sub1.face);

  if (atlas.root === face) atlas.root = sub0.face;

  return {
    faces: [sub0.face, sub1.face],
    chordHEs: [sub0.chordHE, sub1.chordHE],
  };
}

/**
 * Split `face` along a chord whose endpoints are described by two
 * {@link BoundaryHit}s on `face`'s boundary. Composes
 * {@link subdivideHalfEdge} / {@link subdivideAtInfinityArc} (to materialise
 * each chord endpoint as an actual vertex when it lands mid-edge or
 * mid-arc) followed by {@link splitFaceAtVertices}.
 *
 * Side-effect: subdividing a non-arc edge also subdivides the neighbouring
 * face's twin half-edge (introducing one collinear chain vertex over there
 * — see {@link subdivideHalfEdge}). At-infinity-arc subdivisions only touch
 * `face`.
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
   */
  const materialise = (hit: BoundaryHit): HalfEdge => {
    if (hit.point) {
      const u = hit.u!;
      // Endpoint coincidence checks, treating tolerance:
      if (u <= eps) return hit.he; // at origin vertex
      const isFF = hit.he.originKind === 'finite' && hit.he.next.originKind === 'finite';
      if (isFF && u >= 1 - eps) return hit.he.next; // at target vertex (FF only — F-I/I-F have u → ∞ at the ideal end, can't land "at" it)
      // Otherwise subdivide. faceHalves[1] starts at the new vertex.
      const r = subdivideHalfEdge(atlas, hit.he, hit.point);
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
  const entryVertHE = materialise(entryHit);
  const exitVertHE = materialise(exitHit);

  if (entryVertHE === exitVertHE) {
    throw new Error('splitFaceAlongChord: entry and exit collapsed to the same vertex');
  }

  const entryIdx = face.halfEdges.indexOf(entryVertHE);
  const exitIdx = face.halfEdges.indexOf(exitVertHE);
  if (entryIdx < 0 || exitIdx < 0) {
    throw new Error('splitFaceAlongChord: post-materialisation vertex HE not in face');
  }

  return splitFaceAtVertices(atlas, face, entryIdx, exitIdx);
}

// ----------------------------------------------------------------------------
// Internal helpers for atlas mutation
// ----------------------------------------------------------------------------

/**
 * Re-establish `next`, `prev`, and `face` pointers across `face.halfEdges`
 * after an in-place mutation that changed the array's contents/length.
 * The anchor invariant (halfEdges[0].origin at (0, 0), finite kind) is the
 * caller's responsibility.
 */
function rewireFaceCycle(face: Face) {
  const k = face.halfEdges.length;
  for (let i = 0; i < k; i++) {
    const he = face.halfEdges[i];
    he.face = face;
    he.next = face.halfEdges[(i + 1) % k];
    he.prev = face.halfEdges[(i - 1 + k) % k];
  }
}

function setTwin(
  a: HalfEdge,
  b: HalfEdge,
  transformAB: M.Matrix2D,
  transformBA: M.Matrix2D,
) {
  a.twin = b;
  b.twin = a;
  a.transform = transformAB;
  b.transform = transformBA;
}

function detachFace(atlas: Atlas, face: Face) {
  atlas.faces = atlas.faces.filter((f) => f !== face);
  const heSet = new Set<HalfEdge>(face.halfEdges);
  atlas.halfEdges = atlas.halfEdges.filter((he) => !heSet.has(he));
  // Note: external twins still point INTO this face's half-edges. The caller
  // (a split routine) is expected to re-attach them to new sub-faces' edges.
}

function attachFace(atlas: Atlas, face: Face) {
  atlas.faces.push(face);
  for (const he of face.halfEdges) atlas.halfEdges.push(he);
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
  he: HalfEdge;
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
 * Convert a `BoundaryHit` into the {@link Junction} at that hit, in the same
 * frame as `hit.he.face`. Finite hits become finite junctions at the hit
 * point; at-infinity-arc hits become ideal junctions in the line direction.
 *
 * Used by chord-cut primitives to materialise the chord's endpoint vertices
 * before splitting a face.
 */
export function boundaryHitToJunction(hit: BoundaryHit): Junction {
  if (hit.point) return { kind: 'finite', x: hit.point.x, y: hit.point.y };
  if (hit.idealDir) {
    return { kind: 'ideal', x: hit.idealDir.x, y: hit.idealDir.y };
  }
  throw new Error('boundaryHitToJunction: hit has neither point nor idealDir');
}

/**
 * Find where the line `p + s * d` (s > eps) exits `face`. Returns `null` if
 * no forward exit exists (degenerate face / numerical issue) or if the only
 * candidate exit would equal `excludeHE` (the boundary the line just entered).
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
  excludeHE: HalfEdge | null,
  eps = WALK_EPS,
): BoundaryHit | null {
  let best: { he: HalfEdge; s: number; u: number } | null = null;
  let arcExit: HalfEdge | null = null;

  for (const he of face.halfEdgesCCW()) {
    if (he === excludeHE) continue;
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
    const hit = intersectLineWithHE(p, d, he, eps);
    if (!hit) continue;
    if (best === null || hit.s < best.s) best = { he, s: hit.s, u: hit.u };
  }

  if (best) {
    return {
      he: best.he,
      point: pointOnHEAtU(best.he, best.u),
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
  for (const he of face.halfEdgesCCW()) {
    if (he === excludeHE) continue;
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
 * Intersect the parametric line `p + s * d` with half-edge `he` (in the same
 * frame as `p` and `d`). Returns `(s, u)` for a valid forward intersection
 * (`s > eps`, `u` within the edge's parameter range). At-infinity edges are
 * handled separately by the caller.
 */
function intersectLineWithHE(
  p: Point,
  d: Point,
  he: HalfEdge,
  eps: number,
): { s: number; u: number } | null {
  const o = he.origin();
  const t = he.target();
  if (he.isAtInfinity) return null;

  let edgeStart: Point;
  let A: Point;
  let uMax: number;

  if (o.kind === 'finite' && t.kind === 'finite') {
    edgeStart = { x: o.x, y: o.y };
    A = { x: t.x - o.x, y: t.y - o.y };
    uMax = 1;
  } else if (o.kind === 'finite' && t.kind === 'ideal') {
    edgeStart = { x: o.x, y: o.y };
    A = { x: t.x, y: t.y };
    uMax = Infinity;
  } else if (o.kind === 'ideal' && t.kind === 'finite') {
    // Edge runs from ideal direction `o` to finite `t`. Parameterize with
    // `u = 0` at the finite target and `u → ∞` at the ideal end; travel
    // direction from target toward the ideal end is `+o`.
    edgeStart = { x: t.x, y: t.y };
    A = { x: o.x, y: o.y };
    uMax = Infinity;
  } else {
    return null;
  }

  const det = A.x * d.y - A.y * d.x;
  if (Math.abs(det) < eps) return null;
  const rx = edgeStart.x - p.x;
  const ry = edgeStart.y - p.y;
  const s = (A.x * ry - A.y * rx) / det;
  const u = (d.x * ry - d.y * rx) / det;
  if (s < eps) return null;
  if (u < -eps) return null;
  if (uMax !== Infinity && u > uMax + eps) return null;
  const uClamped = Math.max(0, uMax === Infinity ? u : Math.min(uMax, u));
  return { s, u: uClamped };
}

/**
 * Position on `he` at edge-parameter `u`, in `he.face`'s local frame.
 *
 * Parameter conventions (matching {@link uOfPointOnHE}):
 *   - finite → finite: `u ∈ [0, 1]`, `u = 0` at origin, `u = 1` at target.
 *   - finite → ideal:  `u ∈ [0, ∞)`, `u = 0` at the finite origin.
 *   - ideal  → finite: `u ∈ [0, ∞)`, `u = 0` at the finite target,
 *     increasing toward the ideal direction.
 *   - ideal  → ideal: throws (no finite point on the at-infinity arc).
 */
export function pointOnHEAtU(he: HalfEdge, u: number): Point {
  const o = he.origin();
  const t = he.target();
  if (o.kind === 'finite' && t.kind === 'finite') {
    return { x: o.x + u * (t.x - o.x), y: o.y + u * (t.y - o.y) };
  }
  if (o.kind === 'finite' && t.kind === 'ideal') {
    return { x: o.x + u * t.x, y: o.y + u * t.y };
  }
  if (o.kind === 'ideal' && t.kind === 'finite') {
    return { x: t.x + u * o.x, y: t.y + u * o.y };
  }
  throw new Error('pointOnHEAtU: ideal-ideal edges have no finite point');
}

/**
 * Compute the edge-parameter `u` of finite point `p` on half-edge `he`
 * (in `he.face`'s frame), assuming `p` is collinear with the edge.
 * Parameter conventions match {@link pointOnHEAtU}.
 */
export function uOfPointOnHE(he: HalfEdge, p: Point): number {
  const o = he.origin();
  const t = he.target();
  if (o.kind === 'finite' && t.kind === 'finite') {
    const Ax = t.x - o.x;
    const Ay = t.y - o.y;
    const len2 = Ax * Ax + Ay * Ay;
    return ((p.x - o.x) * Ax + (p.y - o.y) * Ay) / len2;
  }
  if (o.kind === 'finite' && t.kind === 'ideal') {
    return (p.x - o.x) * t.x + (p.y - o.y) * t.y;
  }
  if (o.kind === 'ideal' && t.kind === 'finite') {
    return (p.x - t.x) * o.x + (p.y - t.y) * o.y;
  }
  throw new Error('uOfPointOnHE: ideal-ideal edges have no finite point');
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
    const uOnTwin = uOfPointOnHE(twin, entryPointInTwin);
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
 * `leftFace` is the sub-face on the *left* of the line direction at this
 * step (i.e., +perp side); `rightFace` is on the *right* (−perp side).
 * `leftChordHE` and `rightChordHE` are the chord half-edges in their
 * respective sub-faces (twin pair within this step).
 *
 * `originalFace` is kept as a record of which face was split — note the
 * original Face object has been detached from the atlas and should not be
 * dereferenced for geometry afterwards.
 */
export interface ChainSplitPair {
  originalFace: Face;
  leftFace: Face;
  rightFace: Face;
  leftChordHE: HalfEdge;
  rightChordHE: HalfEdge;
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
 * Find a finite-bearing half-edge of `face` whose parameter range contains
 * the geometric point `p` (in `face`'s frame). Prefers an HE whose origin
 * coincides with `p` (returns u=0) so chord-endpoint vertices created by
 * prior subdivisions are reused rather than duplicated.
 */
function findHEForFinitePoint(face: Face, p: Point): { he: HalfEdge; u: number } {
  const eps = 1e-7;
  // Prefer HE whose ORIGIN matches p (existing vertex coincidence).
  for (const he of face.halfEdges) {
    if (he.originKind !== 'finite') continue;
    if (Math.abs(he.ox - p.x) < eps && Math.abs(he.oy - p.y) < eps) {
      return { he, u: 0 };
    }
  }
  // Then any HE that contains p in its parameter range (with collinearity
  // tolerance).
  for (const he of face.halfEdges) {
    if (he.isAtInfinity) continue;
    const isFF = he.originKind === 'finite' && he.next.originKind === 'finite';
    const u = uOfPointOnHE(he, p);
    if (!Number.isFinite(u)) continue;
    if (u < -eps) continue;
    if (isFF && u > 1 + eps) continue;
    const uClamped = Math.max(0, isFF ? Math.min(1, u) : u);
    const proj = pointOnHEAtU(he, uClamped);
    const dx = proj.x - p.x;
    const dy = proj.y - p.y;
    if (dx * dx + dy * dy < eps * eps) {
      return { he, u: uClamped };
    }
  }
  throw new Error(`findHEForFinitePoint: no half-edge contains point (${p.x}, ${p.y})`);
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
function findArcForIdealDir(face: Face, idealDir: Point): HalfEdge {
  const eps = 1e-9;
  // Either an arc starting at idealDir, or a finite-bearing HE coming out
  // of the ideal corner (corner exit). materialise() short-circuits in
  // both cases since the chord endpoint already coincides with origin().
  for (const he of face.halfEdges) {
    if (he.originKind !== 'ideal') continue;
    if (Math.abs(he.ox - idealDir.x) >= eps) continue;
    if (Math.abs(he.oy - idealDir.y) >= eps) continue;
    return he;
  }
  // Arc sweep fallback: a stale `idealDir` may sit strictly inside an arc
  // whose endpoints didn't yet contain a vertex matching it — materialise()
  // will subdivide.
  for (const he of face.halfEdges) {
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
    `findArcForIdealDir: no at-infinity arc contains direction (${idealDir.x}, ${idealDir.y})`,
  );
}

/**
 * Given a captured hit and a (possibly mutated) face, build a fresh
 * {@link BoundaryHit} with an HE reference that is guaranteed to be in
 * `face.halfEdges`.
 */
function refreshHit(face: Face, captured: CapturedHit): BoundaryHit {
  if (captured.point) {
    const { he, u } = findHEForFinitePoint(face, captured.point);
    return { he, point: captured.point, u, idealDir: null };
  }
  if (captured.idealDir) {
    const he = findArcForIdealDir(face, captured.idealDir);
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
 * - Chord endpoints are determined by `walkLine`'s entry/exit hits. If a
 *   face has both endpoints at infinity (e.g., the line passes a single
 *   host face entirely with no crossings), the chord is ideal-to-ideal
 *   and one sub-face would be all-ideal — this throws. The line-cut tool
 *   should combine this primitive with strip insertion atomically to
 *   avoid creating such transient states.
 * - The walked line must not pass exactly through an existing vertex
 *   (degenerate exit). Callers should perturb if needed.
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
  const captured = chain.map((c) => ({
    face: c.face,
    entry: c.entry ? captureHit(c.entry) : null,
    exit: captureHit(c.exit),
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
    const result = splitFaceAlongChord(atlas, c.face, entryHit, exitHit);
    // splitFaceAlongChord doc: faces[0] is on the RIGHT of entry→exit
    // direction; faces[1] is on the LEFT. Line direction in this face's
    // frame matches entry→exit direction (translation-only twins
    // preserve direction across the chain).
    pairs.push({
      originalFace: c.face,
      rightFace: result.faces[0],
      leftFace: result.faces[1],
      rightChordHE: result.chordHEs[0],
      leftChordHE: result.chordHEs[1],
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
  return splitFaceAlongChord(atlas, host, backwardExit, forwardExit);
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
  /** Strip's bottom half-edge per chain step (twin of `splitResult.pairs[i].rightChordHE`). */
  bottomHEs: HalfEdge[];
  /** Strip's top half-edge per chain step (twin of `splitResult.pairs[i].leftChordHE`). */
  topHEs: HalfEdge[];
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
 * Strip frame: global-aligned (translation-only twins, matching the rest
 * of the atlas). Anchored at the first interior chord-vertex (the spoke
 * crossing between the chain's first and second face) on the bottom side.
 *
 * Constraints:
 * - Chain length `N >= 2`. (`N = 1` would have an ideal-to-ideal chord
 *   which {@link splitFaceAtVertices} already rejects.)
 * - `height > 0`.
 *
 * Twin transforms: pure translations. Each chord twin pair `right ↔ strip`
 * uses `translate(stripPos − rightFacePos)` for the finite chord endpoint;
 * the ideal endpoint matches automatically because translation preserves
 * direction. Same for `left ↔ strip` on the top side.
 */
export function insertStrip(
  atlas: Atlas,
  splitResult: SplitAtlasAlongLineResult,
  height: number,
): InsertStripResult {
  const N = splitResult.pairs.length;
  if (N < 2) {
    throw new Error(
      'insertStrip: chain length must be >= 2 (single-host with ideal-ideal chord is unsupported)',
    );
  }
  if (!(height > 0)) {
    throw new Error('insertStrip: height must be positive');
  }

  // ---- Determine line direction d in any face's frame ----
  // Translation-only twins → d is the same across all faces and the strip.
  // rightChordHE goes B → A (i.e., in -d direction).
  let d: Point | null = null;
  for (const pair of splitResult.pairs) {
    const r = pair.rightChordHE;
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
  }
  if (!d) {
    throw new Error('insertStrip: could not determine line direction (all chords ideal-ideal?)');
  }
  const perp = { x: -d.y, y: d.x };

  // ---- Strip-frame positions of finite chord vertices c[1..N-1] ----
  // c[i] is the spoke crossing between chain face[i-1] and face[i].
  // Anchor: c[1] = (0, 0). c[i] = c[i-1] + chordLen[i-1] * d, where
  // chordLen[k] is the (finite) chord length of chain step k (only
  // defined for middle steps k in [1, N-2]).
  const cPositions: Point[] = new Array(N + 1);
  cPositions[1] = { x: 0, y: 0 };
  for (let i = 2; i < N; i++) {
    const r = splitResult.pairs[i - 1].rightChordHE;
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
  // bottomHEs[i]: origin = A in bot, target (implicit via .next) = B in bot.
  // topHEs[i]:    origin = B in top, target (implicit via .next) = A in top.
  const bottomHEs: HalfEdge[] = [];
  for (let i = 0; i < N; i++) {
    const j = aJunction(i, 'bot');
    bottomHEs.push(new HalfEdge(j.kind, j.x, j.y));
  }
  const topHEs: HalfEdge[] = [];
  for (let i = 0; i < N; i++) {
    const j = bJunction(i, 'top');
    topHEs.push(new HalfEdge(j.kind, j.x, j.y));
  }

  // CCW order around the strip:
  //   [B[0], B[1], ..., B[N-1], T[N-1], T[N-2], ..., T[0]]
  // Anchor (first finite vertex with origin (0, 0)) is B[1].origin = c[1].
  // Rotate so anchor is hes[0]:
  //   [B[1], B[2], ..., B[N-1], T[N-1], ..., T[0], B[0]]
  const stripHEs: HalfEdge[] = [
    ...bottomHEs.slice(1),
    ...topHEs.slice().reverse(),
    bottomHEs[0],
  ];

  const stripFace = new Face(stripHEs);

  // ---- Wire chord twin pairs to strip's bottom/top half-edges ----
  for (let i = 0; i < N; i++) {
    const r = splitResult.pairs[i].rightChordHE;
    const l = splitResult.pairs[i].leftChordHE;
    const ro = r.origin(); // B in rightFace frame
    const rt = r.target(); // A in rightFace frame
    const lo = l.origin(); // A in leftFace frame
    const lt = l.target(); // B in leftFace frame

    // T_RtoS: pick whichever chord endpoint is finite to anchor the translation.
    let oR: Point;
    if (ro.kind === 'finite') {
      const stripB = bJunction(i, 'bot');
      // stripB is finite for i < N-1; for i = N-1, ro is ideal (caught above), so this branch
      // only runs when stripB is finite.
      oR = { x: (stripB as { x: number; y: number }).x - ro.x, y: (stripB as { x: number; y: number }).y - ro.y };
    } else if (rt.kind === 'finite') {
      const stripA = aJunction(i, 'bot');
      oR = { x: (stripA as { x: number; y: number }).x - rt.x, y: (stripA as { x: number; y: number }).y - rt.y };
    } else {
      throw new Error(`insertStrip: chord step ${i} right-side has both endpoints ideal`);
    }

    let oL: Point;
    if (lo.kind === 'finite') {
      const stripA = aJunction(i, 'top');
      oL = { x: (stripA as { x: number; y: number }).x - lo.x, y: (stripA as { x: number; y: number }).y - lo.y };
    } else if (lt.kind === 'finite') {
      const stripB = bJunction(i, 'top');
      oL = { x: (stripB as { x: number; y: number }).x - lt.x, y: (stripB as { x: number; y: number }).y - lt.y };
    } else {
      throw new Error(`insertStrip: chord step ${i} left-side has both endpoints ideal`);
    }

    const T_RtoS = M.fromTranslate(oR.x, oR.y);
    const T_StoR = M.invert(T_RtoS);
    const T_LtoS = M.fromTranslate(oL.x, oL.y);
    const T_StoL = M.invert(T_LtoS);

    setTwin(r, bottomHEs[i], T_RtoS, T_StoR);
    setTwin(l, topHEs[i], T_LtoS, T_StoL);
  }

  attachFace(atlas, stripFace);

  return { stripFace, bottomHEs, topHEs };
}

/**
 * Resize an existing strip's perpendicular thickness in place.
 *
 * Mutates only the +n (top) side of the strip:
 *  - Each finite `topHEs[i]` origin shifts by `Δ · perp` in the strip's frame
 *    (where `Δ = newHeight − oldHeight`, `perp = (-d.y, d.x)`, the 90° CCW
 *    rotation of the line direction).
 *  - The `leftChordHE ↔ topHEs[i]` twin transforms shift by the same `Δ · perp`,
 *    keeping the chord-image correspondence (`T · h.next.origin = h.twin.origin`)
 *    exact under the new height.
 *
 * Untouched (independent of `height` by construction):
 *  - `bottomHEs` and `rightChordHE ↔ bottomHEs[i]` twin transforms.
 *  - The strip face's anchor (`halfEdges[0]`, which is `bottomHEs[1]`).
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
  const N = stripResult.bottomHEs.length;
  if (N !== splitResult.pairs.length) {
    throw new Error(
      `resizeStrip: chain length mismatch (strip ${N} vs split ${splitResult.pairs.length})`,
    );
  }
  if (N < 2) {
    throw new Error('resizeStrip: invalid strip (chain length < 2)');
  }

  // ---- Recover the strip-frame line direction d (and perp = 90° CCW d) ----
  // Two strategies, in order of preference:
  //  (a) For N >= 3 there are two adjacent finite bottom origins (c[1], c[2]),
  //      and c[2] - c[1] = chordLen[1] · d. Direction is exact.
  //  (b) For N == 2 there is only c[1] on the bottom, so we read perp directly
  //      from topHEs[0] - bottomHEs[1] = oldHeight · perp, then derive d.
  //      Falls back to this when (a) fails (e.g. unexpected ideal entries).
  let d: Point;
  const b1 = stripResult.bottomHEs[1].origin();
  if (b1.kind !== 'finite') {
    throw new Error('resizeStrip: bottomHEs[1] expected to be finite');
  }
  let dxRaw = 0;
  let dyRaw = 0;
  if (N >= 3) {
    const b2 = stripResult.bottomHEs[2].origin();
    if (b2.kind === 'finite') {
      dxRaw = b2.x - b1.x;
      dyRaw = b2.y - b1.y;
    }
  }
  if (dxRaw === 0 && dyRaw === 0) {
    // N == 2 fallback (or unexpected ideal middle origin): derive perp first.
    const t0 = stripResult.topHEs[0].origin();
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
  const perp = { x: -d.y, y: d.x };
  const delta = newHeight - oldHeight;
  if (delta === 0) return;
  const dpx = delta * perp.x;
  const dpy = delta * perp.y;

  // ---- Shift finite topHE origins ----
  // Ideal topHEs (specifically topHEs[N-1] when present) are direction-only
  // and stay put — the perpendicular shift doesn't change the at-infinity
  // arc's direction.
  for (let i = 0; i < N; i++) {
    const t = stripResult.topHEs[i];
    if (t.originKind === 'finite') {
      t.ox += dpx;
      t.oy += dpy;
    }
  }

  // ---- Update left-chord twin transforms ----
  // Translation-only invariant: T_LtoS gains exactly Δ·perp on its
  // translation part. The linear part is identity (translation), so we
  // build the new matrix by adding to .e/.f and inverting for the back-edge.
  for (let i = 0; i < N; i++) {
    const l = splitResult.pairs[i].leftChordHE;
    const t = stripResult.topHEs[i];
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

// ----------------------------------------------------------------------------
// Line-cut mutation primitive (cutAtlasByLine + insertStrip) — STUB / PREVIEW
// ----------------------------------------------------------------------------
//
// NOTE: The full implementation of cutAtlasByLine (cut all crossed faces +
// insert a 2-rect strip + rewire all twin pairs) is now achievable by
// composing splitAtlasAlongLine + insertStrip. The standalone stub below is
// retained for backwards compatibility with the demo's preview path while
// the UI is being wired through.

/** Result of a successful line-cut + strip insertion. */
export interface CutAtlasResult {
  /** All sub-faces, in [below, above] pairs in line-traversal order. */
  subFaces: Face[];
  /** The two new strip rectangles: `[left, right]` of the seam. */
  stripFaces: [Face, Face];
}

/**
 * Stubbed: would cut the atlas along the walked line and insert a strip.
 * Currently throws. See note above.
 */
export function cutAtlasByLine(_atlas: Atlas, _crossings: FaceCrossing[], _delta: number): CutAtlasResult {
  throw new Error('cutAtlasByLine: not yet implemented (use walkLine + UI preview for now)');
}
