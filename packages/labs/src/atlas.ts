import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';

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
// `prev-around-junction = he.next.next.twin` (backward, used at boundaries).
//
// **Canonical face frame.** Each `Face` owns three CCW half-edges. By
// convention `halfEdges[0]` is the anchor: its origin is finite at face-local
// `(0, 0)`. This pins down the face's local frame.
//
// **Edge transforms.** A non-null twin pair `(h, h.twin)` carries an affine
// `transform` mapping `h.face`'s frame to `h.twin.face`'s frame. The pair is
// constrained:
//   - `h.transform * h.twin.transform = identity`
//   - `h.transform · h.next.origin = h.twin.origin`
//   - `h.transform · h.origin     = h.twin.next.origin`
// For ideal junctions only the linear part of the transform applies (and the
// result is renormalized to unit length).
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
// **No rotation in edge transforms.** By model invariant, transforms are
// translations + (potentially non-uniform) scales. The implementation does
// not currently enforce this — it is a design constraint that operations
// must respect.

// ----------------------------------------------------------------------------
// Junction (a derived "vertex" descriptor)
// ----------------------------------------------------------------------------

/**
 * A junction is a kind + a pair of numbers, in some face's local frame.
 *
 *  - `kind: 'finite'` — `(x, y)` is a face-local position.
 *  - `kind: 'ideal'`  — `(x, y)` is a unit direction in the face-local frame
 *    representing "at infinity in this direction".
 *
 * Junctions are derived data (read off `HalfEdge.originKind/ox/oy`); they are
 * not separately allocated objects in the atlas.
 */
export interface Junction {
  kind: 'finite' | 'ideal';
  x: number;
  y: number;
}

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
  /** Owning face. */
  face!: Face;
  /** Twin half-edge in the adjacent face, or null at a boundary. */
  twin: HalfEdge | null = null;
  /**
   * Affine map: this face's local frame → twin face's local frame.
   *
   * Unused (but kept identity) when `twin` is null.
   *
   * Invariants when `twin` is non-null:
   *   transform * twin.transform = identity
   *   transform * this.next.origin = twin.origin
   *   transform * this.origin       = twin.next.origin
   * For ideal-kind origins only the linear part applies and the image is
   * renormalized to unit length.
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
 * A triangular face owning three CCW half-edges.
 *
 * Convention: `halfEdges[0]` is the canonical anchor — its origin is finite
 * at face-local `(0, 0)`. This pins down the face's local frame uniquely.
 */
export class Face {
  halfEdges: [HalfEdge, HalfEdge, HalfEdge];
  /** Shapes assigned to this face (managed by the atlas's owner). */
  shapes: Set<Element> = new Set();

  constructor(halfEdges: [HalfEdge, HalfEdge, HalfEdge]) {
    if (halfEdges[0].originKind !== 'finite') {
      throw new Error('halfEdges[0] (anchor) must have finite origin');
    }
    if (halfEdges[0].ox !== 0 || halfEdges[0].oy !== 0) {
      throw new Error(
        `halfEdges[0] (anchor) origin must be at face-local (0, 0); got (${halfEdges[0].ox}, ${halfEdges[0].oy})`,
      );
    }
    this.halfEdges = halfEdges;
    for (let i = 0; i < 3; i++) {
      halfEdges[i].next = halfEdges[(i + 1) % 3];
      halfEdges[i].face = this;
    }
  }

  /** This face's three junctions (origins of its half-edges) in CCW order. */
  junctions(): [Junction, Junction, Junction] {
    return [
      this.halfEdges[0].origin(),
      this.halfEdges[1].origin(),
      this.halfEdges[2].origin(),
    ];
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
    return triangleContains(this.junctions(), p);
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
  // Backward from `he`: he.prev.twin, he.prev.twin.prev.twin, ...
  // (prev = .next.next in a 3-cycle.)
  cur = he.next.next.twin;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    cur = cur.next.next.twin;
  }
}

// ----------------------------------------------------------------------------
// Geometry helpers
// ----------------------------------------------------------------------------

/** 2D scalar cross product (ax*by - ay*bx). */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Apply only the linear (2x2) part of an affine to a direction vector. */
export function applyLinearToDirection(
  m: M.Matrix2DReadonly,
  d: { x: number; y: number },
): { x: number; y: number } {
  return { x: m.a * d.x + m.c * d.y, y: m.b * d.x + m.d * d.y };
}

/**
 * Whether `p` lies on the left of (or on) the directed edge `a → b`.
 * Junctions may be finite or ideal.
 *
 * - finite → finite: standard half-plane test.
 * - finite → ideal: edge is a ray from `a` in direction `(b.x, b.y)`.
 * - ideal → finite: edge "comes from infinity in direction a" toward `b`;
 *   the locally-effective travel direction is `-a`.
 * - ideal → ideal: edge lies at infinity, doesn't constrain finite query
 *   points; returns `true`.
 */
export function leftOfDirectedEdge(a: Junction, b: Junction, p: Point): boolean {
  if (a.kind === 'finite' && b.kind === 'finite') {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) >= 0;
  }
  if (a.kind === 'finite' && b.kind === 'ideal') {
    return cross(b.x, b.y, p.x - a.x, p.y - a.y) >= 0;
  }
  if (a.kind === 'ideal' && b.kind === 'finite') {
    return cross(a.x, a.y, b.x - p.x, b.y - p.y) >= 0;
  }
  return true;
}

/** Strict version of {@link leftOfDirectedEdge}: `> 0` instead of `≥ 0`. */
export function leftOfDirectedEdgeStrict(a: Junction, b: Junction, p: Point): boolean {
  if (a.kind === 'finite' && b.kind === 'finite') {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0;
  }
  if (a.kind === 'finite' && b.kind === 'ideal') {
    return cross(b.x, b.y, p.x - a.x, p.y - a.y) > 0;
  }
  if (a.kind === 'ideal' && b.kind === 'finite') {
    return cross(a.x, a.y, b.x - p.x, b.y - p.y) > 0;
  }
  return true;
}

/**
 * Test whether `p` lies inside (or on the boundary of) the CCW triangle
 * defined by `verts`. Junctions may be finite or ideal.
 */
export function triangleContains(
  verts: [Junction, Junction, Junction],
  p: Point,
): boolean {
  for (let i = 0; i < 3; i++) {
    if (!leftOfDirectedEdge(verts[i], verts[(i + 1) % 3], p)) return false;
  }
  return true;
}

/** Strict version: returns `true` only if `p` is strictly interior. */
export function triangleContainsStrict(
  verts: [Junction, Junction, Junction],
  p: Point,
): boolean {
  for (let i = 0; i < 3; i++) {
    if (!leftOfDirectedEdgeStrict(verts[i], verts[(i + 1) % 3], p)) return false;
  }
  return true;
}

/**
 * Whether the triangle `(a, b, c)` is wound CCW. Handles 0, 1, or 2 ideal
 * vertices (3 ideals are not produced by our operations and not supported).
 */
export function isTriangleCCW(verts: [Junction, Junction, Junction]): boolean {
  const idealCount = verts.filter((v) => v.kind === 'ideal').length;
  if (idealCount >= 3) {
    throw new Error('isTriangleCCW: all-ideal triangle not supported');
  }
  // Pick a "far enough" R for ideal-vertex stand-ins. Sign is preserved
  // for any sufficiently large R.
  const R = 1e12;
  const asFinite = (v: Junction): Point =>
    v.kind === 'finite' ? { x: v.x, y: v.y } : { x: v.x * R, y: v.y * R };

  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 3];
    const c = verts[(i + 2) % 3];
    if (!leftOfDirectedEdgeStrict(a, b, asFinite(c))) return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Atlas
// ----------------------------------------------------------------------------

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
   * Convention: `he.transform` maps `he.face → he.twin.face`. So going from a
   * known face A to neighbour B via `he` in A: `M_B = M_A * he.twin.transform`
   * (B → A composed with A → root).
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
          out.set(twin.face, M.multiply(mf, twin.transform));
          queue.push(twin.face);
        }
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
    if (f.halfEdges.length !== 3) {
      errs.push(`face has ${f.halfEdges.length} half-edges, expected 3`);
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

    // Half-edge cycle integrity.
    for (let i = 0; i < 3; i++) {
      const he = f.halfEdges[i];
      if (!allHESet.has(he)) errs.push('half-edge in face not in atlas.halfEdges');
      if (he.face !== f) errs.push('half-edge in face has wrong .face');
      if (he.next !== f.halfEdges[(i + 1) % 3]) {
        errs.push(`face.halfEdges[${i}].next !== face.halfEdges[${(i + 1) % 3}]`);
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

    // CCW orientation.
    try {
      if (!isTriangleCCW(f.junctions())) errs.push('face junctions not in CCW order');
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
      if (h.twin.twin !== h) errs.push('halfEdge.twin.twin !== self');
      if (!allHESet.has(h.twin)) errs.push('halfEdge.twin not in atlas');

      // Transform consistency: T_twin · T = identity.
      const composed = M.multiply(h.twin.transform, h.transform);
      if (!matricesAreClose(composed, M.fromValues(), eps * 100)) {
        errs.push(
          `twin transforms not inverse pair (composed = ${matrixToString(composed)})`,
        );
      }

      // Junction correspondence: T · h.next.origin = h.twin.origin
      //                          T · h.origin      = h.twin.next.origin
      const T = h.transform;
      if (!junctionImageMatches(T, h.target(), h.twin.origin(), eps * 100)) {
        errs.push("twin endpoint b' does not match T·b");
      }
      if (!junctionImageMatches(T, h.origin(), h.twin.target(), eps * 100)) {
        errs.push("twin endpoint a' does not match T·a");
      }
    }
  }

  // ---- reachability from root ----
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

export interface SplitInteriorResult {
  /**
   * The three new sub-faces. `faces[i]` touches the old face's edge between
   * old-junctions `i` and `(i+1) % 3` (i.e. the one originally bounded by
   * `oldFace.halfEdges[i]`).
   */
  faces: [Face, Face, Face];
}

/**
 * Split `face` by inserting a finite junction at `point` strictly inside it.
 * Replaces the single face with 3 new sub-faces fanning around the point.
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
  if (!triangleContainsStrict(face.junctions(), point)) {
    throw new Error('splitFaceAtInterior: point is not strictly interior to face');
  }

  // Capture the old face's junctions and external twins (in neighbour faces)
  // and their old transforms BEFORE we mutate.
  const oldJunctions = face.junctions();
  const oldHEs = face.halfEdges;
  // For each side i = old half-edge oldHEs[i] going from oldJunctions[i] to
  // oldJunctions[(i+1)%3], capture its twin and twin-direction transform.
  const externalTwins: Array<{ ext: HalfEdge | null; T_old: M.Matrix2DReadonly | null }> = [];
  for (let i = 0; i < 3; i++) {
    externalTwins.push({
      ext: oldHEs[i].twin,
      T_old: oldHEs[i].twin ? oldHEs[i].transform : null,
    });
  }

  // Build the three sub-faces. Each is anchored at the inserted point (which
  // sits at (0, 0) in each sub-face's frame). The other two junctions are
  // re-coordinated copies of the old face's corresponding pair.
  //
  // Convention:  subFaces[i]'s CCW corners are (p, oldJ[i], oldJ[(i+1)%3])
  //              => halfEdges[0] = p → oldJ[i]      (anchor)
  //                 halfEdges[1] = oldJ[i] → oldJ[(i+1)%3]   (matches old side i)
  //                 halfEdges[2] = oldJ[(i+1)%3] → p
  const subFaces: Face[] = [];
  for (let i = 0; i < 3; i++) {
    const a = oldJunctions[i];
    const b = oldJunctions[(i + 1) % 3];
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
  //   subFaces[i].halfEdges[2] (b_i → p)  ↔  subFaces[(i+1)%3].halfEdges[0] (p → a_{i+1})
  //   where b_i = a_{i+1} physically.
  for (let i = 0; i < 3; i++) {
    const next = (i + 1) % 3;
    const h2 = subFaces[i].halfEdges[2]; // b_i → p
    const h0 = subFaces[next].halfEdges[0]; // p → a_{i+1}
    setTwin(h2, h0, M.fromValues(), M.fromValues());
  }

  // External twins: re-attach each old neighbour to the new corresponding
  // sub-face's outer half-edge (halfEdges[1], the one matching old side i).
  // Frame change is `translate(-p)` (sub-face's frame is F's translated by -p):
  //
  //   x_F   = translate(p) · x_sub          (sub → F)
  //   x_ext = T_old · x_F                   (F → ext)
  //   ⇒ T_sub_to_ext = T_old · translate(p)
  //
  // and going ext → sub: T_ext_to_sub = translate(-p) · inv(T_old).
  for (let i = 0; i < 3; i++) {
    const ext = externalTwins[i].ext;
    if (!ext) continue;
    const T_old = externalTwins[i].T_old!;
    const subOuter = subFaces[i].halfEdges[1];

    const T_sub_to_ext = M.multiply(T_old, M.fromTranslate(point.x, point.y));
    const T_ext_to_sub = M.multiply(M.fromTranslate(-point.x, -point.y), M.invert(T_old));
    setTwin(subOuter, ext, T_sub_to_ext, T_ext_to_sub);
  }

  // Detach old face from atlas state, attach new ones.
  detachFace(atlas, face);
  for (const sub of subFaces) attachFace(atlas, sub);

  if (atlas.root === face) atlas.root = subFaces[0];

  return { faces: [subFaces[0], subFaces[1], subFaces[2]] };
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
 * incident to the edge each become two new triangles.
 *
 * `point` is in `halfEdge.face`'s local frame and must lie strictly between
 * the two endpoints of `halfEdge` (not coincident with either, both of which
 * must be finite for now).
 *
 * If `halfEdge.twin` is null (e.g. an at-infinity boundary) only
 * `halfEdge.face` is split.
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
  // F_B and F_A respectively. Both new faces are F's frame translated by -p.
  if (ext_F_BC) {
    const T_old = T_F_BC!;
    const T_sub_to_ext = M.multiply(T_old, M.fromTranslate(point.x, point.y));
    const T_ext_to_sub = M.multiply(M.fromTranslate(-point.x, -point.y), M.invert(T_old));
    setTwin(Fsplit.sideB.halfEdges[1], ext_F_BC, T_sub_to_ext, T_ext_to_sub);
  }
  if (ext_F_CA) {
    const T_old = T_F_CA!;
    const T_sub_to_ext = M.multiply(T_old, M.fromTranslate(point.x, point.y));
    const T_ext_to_sub = M.multiply(M.fromTranslate(-point.x, -point.y), M.invert(T_old));
    setTwin(Fsplit.sideA.halfEdges[1], ext_F_CA, T_sub_to_ext, T_ext_to_sub);
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

    // Re-attach G's outer external twins.
    if (ext_G_BC) {
      const T_old_outer = T_G_BC!;
      const T_sub_to_ext = M.multiply(T_old_outer, M.fromTranslate(pointInG.x, pointInG.y));
      const T_ext_to_sub = M.multiply(M.fromTranslate(-pointInG.x, -pointInG.y), M.invert(T_old_outer));
      setTwin(G_results.sideB.halfEdges[1], ext_G_BC, T_sub_to_ext, T_ext_to_sub);
    }
    if (ext_G_CA) {
      const T_old_outer = T_G_CA!;
      const T_sub_to_ext = M.multiply(T_old_outer, M.fromTranslate(pointInG.x, pointInG.y));
      const T_ext_to_sub = M.multiply(M.fromTranslate(-pointInG.x, -pointInG.y), M.invert(T_old_outer));
      setTwin(G_results.sideA.halfEdges[1], ext_G_CA, T_sub_to_ext, T_ext_to_sub);
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
    // F's-sub-frame → G's-sub-frame =
    //   translate(-pointInG) · T_he_old · translate(point)
    const T_subF_to_subG = M.multiply(
      M.fromTranslate(-pointInG.x, -pointInG.y),
      M.multiply(T_he_old as M.Matrix2D, M.fromTranslate(point.x, point.y)),
    );
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

// ----------------------------------------------------------------------------
// Internal helpers for atlas mutation
// ----------------------------------------------------------------------------

/**
 * Express a junction `j` (in some face's frame) in a frame translated by
 * `+translation` (i.e., where `translation` is the new origin). For finite
 * junctions this subtracts the translation; for ideal directions it's a no-op.
 */
function junctionInTranslatedFrame(j: Junction, translation: Point): Junction {
  if (j.kind === 'finite') {
    return { kind: 'finite', x: j.x - translation.x, y: j.y - translation.y };
  }
  return { kind: 'ideal', x: j.x, y: j.y };
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

/**
 * Parameter `t` such that `p = a + t * (b - a)`, or `null` if `p` is not
 * (sufficiently) collinear with the segment.
 */
function parameterOnSegment(a: Point, b: Point, p: Point, eps = 1e-9): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < eps * eps) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  // Collinearity check: perpendicular component must be tiny.
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const perp2 = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
  if (perp2 > eps * eps * Math.max(1, len2)) return null;
  return t;
}
