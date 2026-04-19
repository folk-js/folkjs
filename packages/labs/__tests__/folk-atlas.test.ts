import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as M from '@folkjs/geometry/Matrix2D';
import {
  Atlas,
  aroundJunction,
  createInitialAtlas,
  Face,
  HalfEdge,
  isPolygonCCW,
  type Junction,
  splitFaceAlongEdge,
  splitFaceAtInterior,
  validateAtlas,
} from '../src/atlas.ts';

// ---------------------------------------------------------------------------
// HalfEdge construction
// ---------------------------------------------------------------------------

describe('HalfEdge', () => {
  it('finite half-edge stores its origin position verbatim', () => {
    const h = new HalfEdge('finite', 3, -4);
    assert.equal(h.originKind, 'finite');
    assert.equal(h.ox, 3);
    assert.equal(h.oy, -4);
  });

  it('ideal half-edge normalises its direction to unit length', () => {
    const h = new HalfEdge('ideal', 3, 4);
    assert.equal(h.originKind, 'ideal');
    assert.ok(Math.abs(Math.hypot(h.ox, h.oy) - 1) < 1e-12);
    assert.ok(Math.abs(h.ox - 0.6) < 1e-12);
    assert.ok(Math.abs(h.oy - 0.8) < 1e-12);
  });

  it('ideal half-edge with zero direction throws', () => {
    assert.throws(() => new HalfEdge('ideal', 0, 0));
  });
});

// ---------------------------------------------------------------------------
// Face construction & contains
// ---------------------------------------------------------------------------

describe('Face', () => {
  const finite = (x: number, y: number) => new HalfEdge('finite', x, y);
  const ideal = (x: number, y: number) => new HalfEdge('ideal', x, y);

  it('rejects construction whose anchor (halfEdges[0]) is not finite at (0, 0)', () => {
    assert.throws(() => new Face([finite(1, 1), finite(10, 0), finite(0, 10)]), /\(0, 0\)/);
    assert.throws(() => new Face([ideal(1, 0), finite(10, 0), finite(0, 10)]), /finite origin/);
  });

  it('successful construction wires next and face pointers on each half-edge', () => {
    const h0 = finite(0, 0);
    const h1 = finite(10, 0);
    const h2 = finite(0, 10);
    const f = new Face([h0, h1, h2]);
    for (let i = 0; i < 3; i++) {
      assert.equal(f.halfEdges[i].face, f);
      assert.equal(f.halfEdges[i].next, f.halfEdges[(i + 1) % 3]);
    }
    assert.deepEqual(f.junctions(), [
      { kind: 'finite', x: 0, y: 0 },
      { kind: 'finite', x: 10, y: 0 },
      { kind: 'finite', x: 0, y: 10 },
    ]);
  });

  it('detects points inside an all-finite CCW triangle', () => {
    const f = new Face([finite(0, 0), finite(10, 0), finite(0, 10)]);
    assert.equal(f.contains({ x: 1, y: 1 }), true);
    assert.equal(f.contains({ x: 3, y: 3 }), true);
    assert.equal(f.contains({ x: -1, y: 1 }), false);
    assert.equal(f.contains({ x: 6, y: 6 }), false);
  });

  it('handles a wedge face with one finite + two ideal vertices', () => {
    const f = new Face([finite(0, 0), ideal(1, 0), ideal(0, 1)]);
    assert.equal(f.contains({ x: 5, y: 5 }), true);
    assert.equal(f.contains({ x: 1000, y: 0.0001 }), true);
    assert.equal(f.contains({ x: -1, y: 5 }), false);
    assert.equal(f.contains({ x: 5, y: -1 }), false);
  });

  it('halfEdgesCCW iterates the cycle starting at the anchor', () => {
    const f = new Face([finite(0, 0), finite(10, 0), finite(0, 10)]);
    const collected = [...f.halfEdgesCCW()];
    assert.equal(collected.length, 3);
    assert.equal(collected[0], f.halfEdges[0]);
    assert.equal(collected[1], f.halfEdges[1]);
    assert.equal(collected[2], f.halfEdges[2]);
  });

  it('rejects construction with fewer than 3 half-edges', () => {
    assert.throws(() => new Face([finite(0, 0), finite(10, 0)]), /at least 3/);
  });

  it('supports a convex quadrilateral face (k = 4) with finite vertices', () => {
    const f = new Face([finite(0, 0), finite(10, 0), finite(10, 10), finite(0, 10)]);
    assert.equal(f.halfEdges.length, 4);
    assert.deepEqual(f.junctions(), [
      { kind: 'finite', x: 0, y: 0 },
      { kind: 'finite', x: 10, y: 0 },
      { kind: 'finite', x: 10, y: 10 },
      { kind: 'finite', x: 0, y: 10 },
    ]);
    // contains
    assert.equal(f.contains({ x: 5, y: 5 }), true);
    assert.equal(f.contains({ x: 11, y: 5 }), false);
    assert.equal(f.contains({ x: 5, y: -1 }), false);
    // cycle pointers
    for (let i = 0; i < 4; i++) {
      assert.equal(f.halfEdges[i].next, f.halfEdges[(i + 1) % 4]);
      assert.equal(f.halfEdges[i].prev, f.halfEdges[(i + 3) % 4]);
    }
  });

  it('supports a k = 4 face mixing finite and ideal junctions', () => {
    const f = new Face([finite(0, 0), finite(10, 0), ideal(1, 0), ideal(0, 1)]);
    assert.equal(f.halfEdges.length, 4);
    assert.equal(f.contains({ x: 5, y: 5 }), true);
    assert.equal(f.contains({ x: 100, y: 100 }), true);
    assert.equal(f.contains({ x: -1, y: 5 }), false);
    assert.equal(f.contains({ x: 5, y: -1 }), false);
  });

  it('wires prev pointers for triangle faces', () => {
    const f = new Face([finite(0, 0), finite(10, 0), finite(0, 10)]);
    for (let i = 0; i < 3; i++) {
      assert.equal(f.halfEdges[i].prev, f.halfEdges[(i + 2) % 3]);
      assert.equal(f.halfEdges[i].next.prev, f.halfEdges[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// CCW orientation predicate
// ---------------------------------------------------------------------------

describe('isPolygonCCW', () => {
  const fin = (x: number, y: number): Junction => ({ kind: 'finite', x, y });
  const idl = (x: number, y: number): Junction => {
    const len = Math.hypot(x, y);
    return { kind: 'ideal', x: x / len, y: y / len };
  };

  it('returns true for CCW finite triangles', () => {
    assert.equal(isPolygonCCW([fin(0, 0), fin(1, 0), fin(0, 1)]), true);
  });

  it('returns false for CW finite triangles', () => {
    assert.equal(isPolygonCCW([fin(0, 0), fin(0, 1), fin(1, 0)]), false);
  });

  it('handles 1-ideal-vertex triangles', () => {
    assert.equal(isPolygonCCW([fin(0, 0), idl(1, 0), fin(0, 1)]), true);
  });

  it('handles 2-ideal-vertex (wedge) triangles', () => {
    assert.equal(isPolygonCCW([fin(0, 0), idl(1, 0), idl(0, 1)]), true);
    assert.equal(isPolygonCCW([fin(0, 0), idl(0, 1), idl(1, 0)]), false);
  });

  it('throws for all-ideal polygons', () => {
    assert.throws(
      () => isPolygonCCW([idl(1, 0), idl(0, 1), idl(-1, 0)]),
      /all-ideal/,
    );
  });

  it('returns true for a CCW finite quadrilateral (k = 4)', () => {
    assert.equal(
      isPolygonCCW([fin(0, 0), fin(10, 0), fin(10, 10), fin(0, 10)]),
      true,
    );
  });

  it('returns false for a CW finite quadrilateral (k = 4)', () => {
    assert.equal(
      isPolygonCCW([fin(0, 0), fin(0, 10), fin(10, 10), fin(10, 0)]),
      false,
    );
  });

  it('returns false for a non-convex quadrilateral (one reflex angle)', () => {
    // CCW outer hull would be (0,0), (10,0), (10,10), (0,10), but inserting
    // a reflex vertex at (5, 5) breaks convexity.
    assert.equal(
      isPolygonCCW([fin(0, 0), fin(10, 0), fin(5, 5), fin(0, 10)]),
      false,
    );
  });

  it('handles a k = 4 face with two finite + two ideal vertices', () => {
    // A "trapezoid going to infinity" where every interior angle is < π:
    // (0, 0) → (10, 0) → +(1, 1) → +(-1, 1). Strictly convex.
    assert.equal(
      isPolygonCCW([fin(0, 0), fin(10, 0), idl(1, 1), idl(-1, 1)]),
      true,
    );
  });

  it('rejects a degenerate k = 4 with three colinear vertices', () => {
    // (0, 0) → (10, 0) → ideal +x → ideal +y. The first three are colinear
    // along the x-axis, so the (V0, V1, V2) triple has zero turn — fails
    // strict-left-turn convexity.
    assert.equal(
      isPolygonCCW([fin(0, 0), fin(10, 0), idl(1, 0), idl(0, 1)]),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// createInitialAtlas
// ---------------------------------------------------------------------------

describe('createInitialAtlas', () => {
  it('has 4 wedge faces and 12 half-edges', () => {
    const atlas = createInitialAtlas();
    assert.equal(atlas.faces.length, 4);
    assert.equal(atlas.halfEdges.length, 12);
  });

  it('every face has anchor at finite (0, 0) and 2 ideal half-edges', () => {
    const atlas = createInitialAtlas();
    for (const f of atlas.faces) {
      assert.equal(f.halfEdges[0].originKind, 'finite');
      assert.equal(f.halfEdges[0].ox, 0);
      assert.equal(f.halfEdges[0].oy, 0);
      assert.equal(f.halfEdges[1].originKind, 'ideal');
      assert.equal(f.halfEdges[2].originKind, 'ideal');
    }
  });

  it('twins 8 half-edges along the cardinal half-axes; 4 at-infinity boundaries are untwined', () => {
    const atlas = createInitialAtlas();
    let twinned = 0;
    let boundary = 0;
    for (const he of atlas.halfEdges) {
      if (he.twin) {
        twinned++;
        assert.equal(he.twin.twin, he);
        assert.equal(he.isAtInfinity, false, 'twined half-edge should not be at-infinity');
      } else {
        boundary++;
        assert.equal(he.isAtInfinity, true, 'untwined half-edge should be at-infinity');
      }
    }
    assert.equal(twinned, 8);
    assert.equal(boundary, 4);
  });

  it('every face cycle is exactly 3 half-edges', () => {
    const atlas = createInitialAtlas();
    for (const face of atlas.faces) {
      const seen = [...face.halfEdgesCCW()];
      assert.equal(seen.length, 3);
      for (const he of seen) assert.equal(he.face, face);
    }
  });

  it('passes validateAtlas with no errors', () => {
    const atlas = createInitialAtlas();
    assert.doesNotThrow(() => validateAtlas(atlas));
  });
});

// ---------------------------------------------------------------------------
// aroundJunction — vertex identity recovery from edge topology
// ---------------------------------------------------------------------------

describe('aroundJunction', () => {
  it('walks all 4 half-edges around the central finite junction in the seed', () => {
    const atlas = createInitialAtlas();
    const start = atlas.faces[0].halfEdges[0]; // anchor of the first quadrant
    assert.equal(start.originKind, 'finite');
    const fan = [...aroundJunction(start)];
    assert.equal(fan.length, 4);
    // All should originate at finite (0, 0) in their respective face frames.
    for (const he of fan) {
      assert.equal(he.originKind, 'finite');
      assert.equal(he.ox, 0);
      assert.equal(he.oy, 0);
    }
    // All four faces should be represented exactly once.
    const faces = new Set(fan.map((h) => h.face));
    assert.equal(faces.size, 4);
  });

  it('walks both half-edges around an ideal cardinal junction (boundary fan)', () => {
    const atlas = createInitialAtlas();
    // Find one ideal half-edge that is NOT at-infinity (so it has the
    // ideal-finite kind and a twin).
    const start = atlas.halfEdges.find(
      (h) => h.originKind === 'ideal' && !h.isAtInfinity,
    )!;
    const fan = [...aroundJunction(start)];
    // An ideal cardinal direction is shared by exactly 2 faces in the seed
    // (e.g. +X is shared by NE and SE).
    assert.equal(fan.length, 2);
    for (const he of fan) {
      assert.equal(he.originKind, 'ideal');
      // Same physical direction (in their respective face frames, which are
      // identity-related in the seed).
      assert.ok(Math.abs(he.ox - start.ox) < 1e-12);
      assert.ok(Math.abs(he.oy - start.oy) < 1e-12);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAtlas — invariant violations
// ---------------------------------------------------------------------------

describe('validateAtlas', () => {
  it('throws when a face anchor is moved off (0, 0)', () => {
    const atlas = createInitialAtlas();
    atlas.faces[0].halfEdges[0].ox = 5;
    assert.throws(() => validateAtlas(atlas), /\(0, 0\)/);
  });

  it('throws when twin transforms are not inverses', () => {
    const atlas = createInitialAtlas();
    const he = atlas.halfEdges.find((h) => h.twin)!;
    he.transform = M.fromTranslate(10, 0);
    assert.throws(() => validateAtlas(atlas), /not inverse/);
  });

  it('throws when an ideal half-edge has non-unit direction', () => {
    const atlas = createInitialAtlas();
    const he = atlas.halfEdges.find((h) => h.originKind === 'ideal')!;
    he.ox = 99;
    assert.throws(() => validateAtlas(atlas), /direction length|T·a|endpoint/);
  });
});

// ---------------------------------------------------------------------------
// Atlas.computeComposites & Atlas.locate
// ---------------------------------------------------------------------------

describe('Atlas.computeComposites', () => {
  it('produces identity for every face in the empty seed', () => {
    const atlas = createInitialAtlas();
    const composites = atlas.computeComposites();
    assert.equal(composites.size, atlas.faces.length);
    for (const m of composites.values()) {
      assert.ok(M.equals(m, M.fromValues()));
    }
  });

  it('reachable faces propagate non-identity transforms (synthetic)', () => {
    // We can manually tweak a twin pair to a non-identity translation; the
    // resulting endpoint coords would now be inconsistent with the edge
    // transform (so validateAtlas would fail), but computeComposites only
    // looks at the transforms.
    const atlas = createInitialAtlas();
    const root = atlas.root;
    const heInner = [...root.halfEdgesCCW()].find((he) => he.twin)!;
    const otherFace = heInner.twin!.face;
    heInner.transform = M.fromTranslate(10, 0);
    heInner.twin!.transform = M.fromTranslate(-10, 0);

    const composites = atlas.computeComposites();
    assert.ok(M.equals(composites.get(root)!, M.fromValues()));
    assert.ok(M.equals(composites.get(otherFace)!, M.fromTranslate(-10, 0)));
  });
});

describe('Atlas.switchRoot', () => {
  it('returns identity and is a no-op when target is already root', () => {
    const atlas = createInitialAtlas();
    const C = atlas.switchRoot(atlas.root);
    assert.ok(M.equals(C, M.fromValues()));
  });

  it('returns C = composite_old(newRoot) and re-anchors composites at newRoot', () => {
    // Inject a non-identity translation across one twin pair so the two roots
    // disagree about coordinates (otherwise the test is trivial).
    const atlas = createInitialAtlas();
    const heInner = [...atlas.root.halfEdgesCCW()].find((he) => he.twin)!;
    const oldRoot = atlas.root;
    const newRoot = heInner.twin!.face;
    heInner.transform = M.fromTranslate(7, -3);
    heInner.twin!.transform = M.fromTranslate(-7, 3);

    const compositesOld = atlas.computeComposites();
    const expectedC = compositesOld.get(newRoot)!;
    const C = atlas.switchRoot(newRoot);
    assert.ok(M.equals(C, expectedC), 'C equals composite_old(newRoot)');

    const compositesNew = atlas.computeComposites();
    assert.equal(atlas.root, newRoot);
    assert.ok(M.equals(compositesNew.get(newRoot)!, M.fromValues()));

    // And the directly-adjacent old root maps via the inverse of C in the
    // new frame: composite_new(oldRoot) = inv(C). (For faces along arbitrary
    // BFS paths, this only holds in a globally-consistent atlas — see the
    // round-trip test below for a cleaner statement.)
    const oldRootComposite = compositesNew.get(oldRoot)!;
    assert.ok(M.equals(oldRootComposite, M.invert(C)));
  });

  it('preserves screen positions for every face on a fully-consistent atlas', () => {
    // The empty seed has all-identity edge transforms, hence is globally
    // consistent. switchRoot then preserves screen positions for every face
    // simultaneously when the view absorbs the returned C.
    const atlas = createInitialAtlas();
    const newRoot = atlas.faces[2];
    const viewOld = M.scaleSelf(M.fromTranslate(100, 50), 1.25);
    const compositesOld = atlas.computeComposites();

    const C = atlas.switchRoot(newRoot);
    const compositesNew = atlas.computeComposites();
    const viewNew = M.multiply(viewOld, C);

    const probe = { x: 3, y: 4 };
    for (const face of atlas.faces) {
      const screenOld = M.applyToPoint(M.multiply(viewOld, compositesOld.get(face)!), probe);
      const screenNew = M.applyToPoint(M.multiply(viewNew, compositesNew.get(face)!), probe);
      assert.ok(Math.abs(screenOld.x - screenNew.x) < 1e-9);
      assert.ok(Math.abs(screenOld.y - screenNew.y) < 1e-9);
    }
  });

  it('switching back to the original root yields inverse compensation', () => {
    const atlas = createInitialAtlas();
    const heInner = [...atlas.root.halfEdgesCCW()].find((he) => he.twin)!;
    const originalRoot = atlas.root;
    const otherFace = heInner.twin!.face;
    heInner.transform = M.fromTranslate(7, -3);
    heInner.twin!.transform = M.fromTranslate(-7, 3);

    const C1 = atlas.switchRoot(otherFace);
    const C2 = atlas.switchRoot(originalRoot);
    // C1 * C2 should equal identity (we got back where we started).
    const composed = M.multiply(C1, C2);
    assert.ok(M.equals(composed, M.fromValues()));
    assert.equal(atlas.root, originalRoot);
  });
});

describe('Atlas.locate', () => {
  it('places points in their cardinal-quadrant face', () => {
    const atlas = createInitialAtlas();
    // Faces are in CCW order starting from +X→+Y wedge, etc. We don't rely on
    // a specific ordering; just check each cardinal quadrant point gets some face.
    assert.ok(atlas.locate({ x: 5, y: 5 }) !== null);
    assert.ok(atlas.locate({ x: -5, y: 5 }) !== null);
    assert.ok(atlas.locate({ x: -5, y: -5 }) !== null);
    assert.ok(atlas.locate({ x: 5, y: -5 }) !== null);
    // And different quadrants give different faces.
    const ne = atlas.locate({ x: 5, y: 5 });
    const sw = atlas.locate({ x: -5, y: -5 });
    assert.notEqual(ne, sw);
  });

  it('always finds a face for any finite point', () => {
    const atlas = createInitialAtlas();
    const samples: Array<[number, number]> = [
      [0.001, 0.001],
      [1e6, 1e6],
      [-1e6, 1e6],
      [-1e6, -1e6],
      [1e6, -1e6],
      [0.001, -0.001],
    ];
    for (const [x, y] of samples) {
      assert.ok(atlas.locate({ x, y }) !== null, `failed to locate (${x}, ${y})`);
    }
  });
});

// ---------------------------------------------------------------------------
// splitFaceAtInterior
// ---------------------------------------------------------------------------

describe('splitFaceAtInterior', () => {
  it('replaces 1 face with 3 sub-faces', () => {
    const atlas = createInitialAtlas();
    const before = atlas.faces.length;
    // Find the face containing (100, 100) — it's whichever wedge covers +X, +Y.
    const target = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, target, { x: 100, y: 100 });
    assert.equal(atlas.faces.length, before + 2);
  });

  it('passes validateAtlas after splitting an inner face', () => {
    const atlas = createInitialAtlas();
    const target = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, target, { x: 100, y: 100 });
    assert.doesNotThrow(() => validateAtlas(atlas));
  });

  it('preserves point coverage for finite samples', () => {
    const atlas = createInitialAtlas();
    const target = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, target, { x: 100, y: 100 });
    const samples: Array<[number, number]> = [
      [10, 10],
      [50, 50],
      [200, 50],
      [50, 200],
      [-5, 5],
      [-5, -5],
      [5, -5],
    ];
    for (const [x, y] of samples) {
      assert.ok(atlas.locate({ x, y }) !== null, `lost coverage at (${x}, ${y})`);
    }
  });

  it('the inserted point is the same physical point across all 3 sub-faces', () => {
    const atlas = createInitialAtlas();
    const target = atlas.locate({ x: 100, y: 100 })!;
    const result = splitFaceAtInterior(atlas, target, { x: 100, y: 100 });
    // The interior point lives at (0, 0) in each sub-face's local frame.
    const composites = atlas.computeComposites();
    const rootPositions = result.faces.map((f) =>
      M.applyToPoint(composites.get(f)!, { x: 0, y: 0 }),
    );
    for (let i = 1; i < 3; i++) {
      assert.ok(
        Math.abs(rootPositions[i].x - rootPositions[0].x) < 1e-9 &&
          Math.abs(rootPositions[i].y - rootPositions[0].y) < 1e-9,
        `sub-face ${i} disagrees on inserted-point root position`,
      );
    }
  });

  it('throws when point is outside the face', () => {
    const atlas = createInitialAtlas();
    // Pick the +X+Y wedge and try to split at (-100, -100), clearly outside.
    const target = atlas.locate({ x: 100, y: 100 })!;
    assert.throws(
      () => splitFaceAtInterior(atlas, target, { x: -100, y: -100 }),
      /not strictly interior/,
    );
  });

  it('throws when point lies on a face boundary', () => {
    const atlas = createInitialAtlas();
    const target = atlas.locate({ x: 100, y: 100 })!;
    // A point on the +x axis (boundary of two quadrants) — pick one along the
    // first half-edge of the face.
    assert.throws(
      () => splitFaceAtInterior(atlas, target, { x: 100, y: 0 }),
      /not strictly interior/,
    );
  });

  it('preserves composites of unrelated faces across a split', () => {
    const atlas = createInitialAtlas();
    const before = atlas.computeComposites();
    // Split a non-root face.
    const target = atlas.faces.find((f) => f !== atlas.root)!;
    // Pick an interior point: face's interior contains a finite point along
    // the bisector of its two ideal directions, near (0, 0).
    const a = target.halfEdges[1];
    const b = target.halfEdges[2];
    const pt = { x: (a.ox + b.ox) * 50, y: (a.oy + b.oy) * 50 };
    splitFaceAtInterior(atlas, target, pt);
    const after = atlas.computeComposites();
    for (const f of atlas.faces) {
      const b0 = before.get(f);
      const a0 = after.get(f);
      if (b0 && a0) {
        assert.ok(M.equals(a0, b0), 'composite for surviving face changed unexpectedly');
      }
    }
  });

  // TODO: add a regression test that exercises non-translation transforms.
  // The current pure-translation paths in splitFaceAtInterior/splitFaceAlongEdge
  // mean that the matrix-multiplication ORDER for transform composition is
  // not exercised — translations commute. Once non-identity (e.g. scale) edge
  // transforms exist (either via expand/contract operations or a synthetic
  // constructor for testing), add tests that catch the order bug.

  it('handles repeated splits without violating invariants', () => {
    const atlas = createInitialAtlas();
    const t1 = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, t1, { x: 100, y: 100 });
    validateAtlas(atlas);
    const t2 = atlas.locate({ x: -50, y: 50 });
    assert.ok(t2, 'no face contains (-50, 50) in root coords');
    const composites = atlas.computeComposites();
    const localPoint = M.applyToPoint(M.invert(composites.get(t2!)!), { x: -50, y: 50 });
    splitFaceAtInterior(atlas, t2!, localPoint);
    validateAtlas(atlas);
  });
});

// ---------------------------------------------------------------------------
// splitFaceAlongEdge
// ---------------------------------------------------------------------------

describe('splitFaceAlongEdge', () => {
  it('splits a finite-finite edge after a prior interior split', () => {
    const atlas = createInitialAtlas();
    const t = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, t, { x: 100, y: 100 });
    validateAtlas(atlas);

    const candidate = atlas.halfEdges.find(
      (h) =>
        h.originKind === 'finite' &&
        h.next.originKind === 'finite' &&
        h.twin !== null &&
        h.twin.originKind === 'finite' &&
        h.twin.next.originKind === 'finite',
    );
    assert.ok(candidate, 'expected a finite-finite half-edge after interior split');
    const beforeFaces = atlas.faces.length;
    const mid = {
      x: (candidate!.ox + candidate!.next.ox) / 2,
      y: (candidate!.oy + candidate!.next.oy) / 2,
    };
    splitFaceAlongEdge(atlas, candidate!, mid);
    assert.equal(atlas.faces.length, beforeFaces + 2, 'expected +2 faces (each side split into 2)');
    assert.doesNotThrow(() => validateAtlas(atlas));
  });

  it('throws when point is not on the edge', () => {
    const atlas = createInitialAtlas();
    const t = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, t, { x: 100, y: 100 });
    const candidate = atlas.halfEdges.find(
      (h) => h.originKind === 'finite' && h.next.originKind === 'finite' && h.twin !== null,
    )!;
    assert.throws(
      () => splitFaceAlongEdge(atlas, candidate, { x: 1000, y: 1000 }),
      /not strictly between/,
    );
  });

  it('throws when point is at an edge endpoint', () => {
    const atlas = createInitialAtlas();
    const t = atlas.locate({ x: 100, y: 100 })!;
    splitFaceAtInterior(atlas, t, { x: 100, y: 100 });
    const candidate = atlas.halfEdges.find(
      (h) => h.originKind === 'finite' && h.next.originKind === 'finite' && h.twin !== null,
    )!;
    assert.throws(
      () => splitFaceAlongEdge(atlas, candidate, { x: candidate.ox, y: candidate.oy }),
      /not strictly between/,
    );
  });
});

// ---------------------------------------------------------------------------
// Tag unused imports to suppress noise
// ---------------------------------------------------------------------------

void Atlas;
