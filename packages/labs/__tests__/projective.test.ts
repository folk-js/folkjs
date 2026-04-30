import * as M from '@folkjs/geometry/Matrix2D';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  HomLine,
  HomPoint,
  lerpHom,
  signedTurn,
} from '../src/atlas/geometry/projective.ts';

const APPROX_EPS = 1e-9;

const approx = (got: number, expected: number, msg = '') => {
  assert.ok(
    Math.abs(got - expected) < APPROX_EPS,
    `${msg}: got ${got}, expected ${expected}`,
  );
};

const approxPoint = (got: HomPoint, expected: HomPoint, msg = '') => {
  assert.ok(
    got.equals(expected),
    `${msg}: got (${got.x}, ${got.y}, ${got.w}) vs expected (${expected.x}, ${expected.y}, ${expected.w})`,
  );
};

const approxLine = (got: HomLine, expected: HomLine, msg = '') => {
  assert.ok(
    got.equals(expected),
    `${msg}: got (${got.a}, ${got.b}, ${got.c}) vs expected (${expected.a}, ${expected.b}, ${expected.c})`,
  );
};

// ---------------------------------------------------------------------------
// HomPoint construction & basic predicates
// ---------------------------------------------------------------------------

describe('HomPoint', () => {
  it('finite() stores Cartesian coords with w = 1', () => {
    const p = HomPoint.finite(3, -4);
    assert.equal(p.x, 3);
    assert.equal(p.y, -4);
    assert.equal(p.w, 1);
    assert.ok(p.isFinite);
    assert.ok(!p.isIdeal);
    assert.equal(p.kind, 'finite');
  });

  it('idealDir() normalizes the direction to unit length', () => {
    const p = HomPoint.idealDir(3, 4);
    assert.equal(p.w, 0);
    approx(p.x, 0.6, 'normalised x');
    approx(p.y, 0.8, 'normalised y');
    assert.ok(p.isIdeal);
    assert.ok(!p.isFinite);
    assert.equal(p.kind, 'ideal');
  });

  it('idealDir() throws on a zero direction', () => {
    assert.throws(() => HomPoint.idealDir(0, 0), /zero-length direction/);
  });

  it('fromHomogeneous() rescales finite triples to canonical w = 1', () => {
    const p = HomPoint.fromHomogeneous(6, 8, 2);
    assert.equal(p.w, 1);
    approx(p.x, 3, 'rescaled x');
    approx(p.y, 4, 'rescaled y');
  });

  it('fromHomogeneous() canonicalizes w-negative finite triples to positive w', () => {
    const p = HomPoint.fromHomogeneous(-6, -8, -2);
    assert.equal(p.w, 1);
    approx(p.x, 3, 'sign-flipped x');
    approx(p.y, 4, 'sign-flipped y');
  });

  it('fromHomogeneous() normalizes ideal triples to unit direction', () => {
    const p = HomPoint.fromHomogeneous(3, 4, 0);
    assert.equal(p.w, 0);
    approx(p.x, 0.6, 'normalised x');
    approx(p.y, 0.8, 'normalised y');
  });

  it('fromHomogeneous() rejects the zero triple', () => {
    assert.throws(
      () => HomPoint.fromHomogeneous(0, 0, 0),
      /zero vector has no projective meaning/,
    );
  });

  it('cart() returns Cartesian for finite points; throws for ideal', () => {
    const fin = HomPoint.finite(3, 4);
    assert.deepEqual(fin.cart(), { x: 3, y: 4 });
    const idl = HomPoint.idealDir(1, 0);
    assert.throws(() => idl.cart(), /point is ideal/);
  });

  it('dir() returns unit direction for ideal points; throws for finite', () => {
    const idl = HomPoint.idealDir(0, 1);
    assert.deepEqual(idl.dir(), { x: 0, y: 1 });
    const fin = HomPoint.finite(3, 4);
    assert.throws(() => fin.dir(), /point is finite/);
  });

  it('applyAffine() translates finite points', () => {
    const p = HomPoint.finite(1, 2);
    const T = M.fromTranslate(10, 20);
    approxPoint(p.applyAffine(T), HomPoint.finite(11, 22), 'translated finite');
  });

  it('applyAffine() leaves ideal points invariant under translations', () => {
    const p = HomPoint.idealDir(1, 0);
    const T = M.fromTranslate(10, 20);
    approxPoint(p.applyAffine(T), p, 'ideal under translation');
  });

  it('applyAffine() rotates ideal directions correctly', () => {
    const p = HomPoint.idealDir(1, 0);
    const T = M.fromValues(0, 1, -1, 0, 99, -42); // 90° CCW + translation
    approxPoint(p.applyAffine(T), HomPoint.idealDir(0, 1), 'rotated ideal');
  });

  it('equals() distinguishes finite from ideal points', () => {
    const fin = HomPoint.finite(1, 0);
    const idl = HomPoint.idealDir(1, 0);
    assert.ok(!fin.equals(idl), 'finite ≠ ideal even with same xy');
  });
});

// ---------------------------------------------------------------------------
// HomLine construction & basic operations
// ---------------------------------------------------------------------------

describe('HomLine', () => {
  it('through() builds the standard line through two finite points', () => {
    // x-axis: through (0, 0) and (1, 0). Equation y = 0 ⇒ (a, b, c) = (0, 1, 0).
    const l = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    approx(l.a, 0, 'a');
    approx(l.b, 1, 'b');
    approx(l.c, 0, 'c');
    assert.ok(!l.isAtInfinity);
  });

  it('through() with one finite + one ideal builds a ray-bearing line', () => {
    // Through finite (3, 4) toward ideal (1, 0) — the line y = 4.
    // Equation y - 4 = 0 ⇒ (0, 1, -4).
    const l = HomLine.through(HomPoint.finite(3, 4), HomPoint.idealDir(1, 0));
    approx(l.a, 0, 'a');
    approx(l.b, 1, 'b');
    approx(l.c, -4, 'c');
  });

  it('through() with two non-antipodal ideal points returns the line at infinity', () => {
    const l = HomLine.through(HomPoint.idealDir(1, 0), HomPoint.idealDir(0, 1));
    assert.ok(l.isAtInfinity);
    approx(Math.abs(l.c), 1, '|c| = 1 (line at infinity normalised)');
  });

  it('withDirection() builds the chord through a finite point in a direction', () => {
    // Line through (0, 0) in direction (1, 0) — the x-axis.
    const l = HomLine.withDirection(HomPoint.finite(0, 0), { x: 1, y: 0 });
    approx(l.a, 0, 'a');
    approx(l.b, 1, 'b');
    approx(l.c, 0, 'c');

    // Line through (0, 5) in direction (1, 0) — the line y = 5.
    const l5 = HomLine.withDirection(HomPoint.finite(0, 5), { x: 1, y: 0 });
    approx(l5.a, 0, 'a');
    approx(l5.b, 1, 'b');
    approx(l5.c, -5, 'c');
  });

  it('atInfinity() is canonical (0, 0, 1)', () => {
    const l = HomLine.atInfinity();
    assert.equal(l.a, 0);
    assert.equal(l.b, 0);
    assert.equal(l.c, 1);
    assert.ok(l.isAtInfinity);
  });

  it('evalAt() is positive on the left of an oriented line', () => {
    // x-axis oriented +x: through (0, 0) → (1, 0). Left side is +y.
    const l = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    assert.ok(l.evalAt(HomPoint.finite(5, 1)) > 0, 'point above x-axis is left of +x');
    assert.ok(l.evalAt(HomPoint.finite(5, -1)) < 0, 'point below x-axis is right of +x');
    approx(l.evalAt(HomPoint.finite(5, 0)), 0, 'point on x-axis evaluates to zero');
  });

  it('evalAt() handles ideal query points', () => {
    const l = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    approx(l.evalAt(HomPoint.idealDir(1, 0)), 0, '+x ideal direction is on the x-axis');
    approx(l.evalAt(HomPoint.idealDir(-1, 0)), 0, '-x ideal direction is on the x-axis');
    assert.ok(l.evalAt(HomPoint.idealDir(0, 1)) > 0, '+y ideal direction is left of +x');
  });

  it('intersect() finds the meeting point of two lines', () => {
    // x-axis ∩ y-axis = origin.
    const xAxis = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    const yAxis = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(0, 1));
    approxPoint(xAxis.intersect(yAxis), HomPoint.finite(0, 0), 'x ∩ y = origin');
  });

  it('intersect() of parallel lines returns an ideal point in the lines\' direction', () => {
    // y = 0 ∩ y = 5 → ideal point in +x direction.
    const l1 = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    const l2 = HomLine.through(HomPoint.finite(0, 5), HomPoint.finite(1, 5));
    const meet = l1.intersect(l2);
    assert.ok(meet.isIdeal, 'parallel lines meet at infinity');
    // Direction is (±1, 0); with our orientation conventions both signs are
    // observationally valid. Just check we landed on the x-axis at infinity.
    approx(meet.y, 0, 'parallel lines meet at the x-axis ideal point');
  });

  it('applyAffine() translates a line correctly', () => {
    // y = 0 translated by (5, 7) is y = 7.
    const l = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    const T = M.fromTranslate(5, 7);
    const moved = l.applyAffine(T);
    approxLine(moved, HomLine.through(HomPoint.finite(0, 7), HomPoint.finite(1, 7)), 'translated y=0');
  });

  it('applyAffine() rotates a line correctly', () => {
    // x-axis rotated 90° CCW becomes y-axis.
    const xAxis = HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(1, 0));
    const rot = M.fromValues(0, 1, -1, 0, 0, 0); // 90° CCW
    const rotated = xAxis.applyAffine(rot);
    // y-axis: through (0, 0) → (0, 1).
    approxLine(rotated, HomLine.through(HomPoint.finite(0, 0), HomPoint.finite(0, 1)), 'rotated x-axis');
  });

  it('perpFromOrigin reads off the signed perpendicular distance', () => {
    // Line y = 5: normal is (0, 1), c = -5; perpFromOrigin = -c = 5.
    const l = HomLine.through(HomPoint.finite(0, 5), HomPoint.finite(1, 5));
    approx(l.perpFromOrigin, 5, 'perp from origin to y=5');
  });
});

// ---------------------------------------------------------------------------
// signedTurn — the headline replacement for the 9-case branch
// ---------------------------------------------------------------------------

describe('signedTurn', () => {
  it('is positive for a CCW triple of finite points', () => {
    const a = HomPoint.finite(0, 0);
    const b = HomPoint.finite(1, 0);
    const c = HomPoint.finite(1, 1);
    assert.ok(signedTurn(a, b, c) > 0, 'CCW finite triple → positive turn');
  });

  it('is negative for a CW triple of finite points', () => {
    const a = HomPoint.finite(0, 0);
    const b = HomPoint.finite(1, 0);
    const c = HomPoint.finite(1, -1);
    assert.ok(signedTurn(a, b, c) < 0, 'CW finite triple → negative turn');
  });

  it('is zero for collinear finite points', () => {
    const a = HomPoint.finite(0, 0);
    const b = HomPoint.finite(1, 0);
    const c = HomPoint.finite(2, 0);
    approx(signedTurn(a, b, c), 0, 'collinear finite triple');
  });

  it('handles mixed finite / ideal triples uniformly', () => {
    // a = (0, 0) finite, b = (1, 0) finite, c = +y ideal direction.
    // The directed edge a → b points along +x; +y is to its left → positive.
    const a = HomPoint.finite(0, 0);
    const b = HomPoint.finite(1, 0);
    const cLeft = HomPoint.idealDir(0, 1);
    assert.ok(signedTurn(a, b, cLeft) > 0, 'finite + finite + ideal-left → positive');
    const cRight = HomPoint.idealDir(0, -1);
    assert.ok(signedTurn(a, b, cRight) < 0, 'finite + finite + ideal-right → negative');
  });

  it('returns zero for all-ideal triples', () => {
    // Three projective points at infinity are projectively coplanar (their
    // homogeneous triples all live in the w=0 plane), so the determinant
    // is structurally zero. CCW-on-the-line-at-infinity is a separate
    // orientation question that needs a direction-cross check, not a
    // homogeneous-determinant check. (`isPolygonCCW`'s all-ideal branch
    // continues to use cross-of-directions for this; signedTurn isn't
    // the right tool for arcs.)
    const a = HomPoint.idealDir(1, 0);
    const b = HomPoint.idealDir(0, 1);
    const c = HomPoint.idealDir(-1, 0);
    approx(signedTurn(a, b, c), 0, 'all-ideal triple has det = 0');
  });
});

// ---------------------------------------------------------------------------
// lerpHom
// ---------------------------------------------------------------------------

describe('lerpHom', () => {
  it('interpolates linearly between two finite points', () => {
    const p1 = HomPoint.finite(0, 0);
    const p2 = HomPoint.finite(10, 0);
    approxPoint(lerpHom(p1, p2, 0.5), HomPoint.finite(5, 0), 'midpoint');
    approxPoint(lerpHom(p1, p2, 0), p1, 't=0');
    approxPoint(lerpHom(p1, p2, 1), p2, 't=1');
  });

  it('walks from a finite point toward an ideal direction at t=1', () => {
    const finite = HomPoint.finite(0, 0);
    const ideal = HomPoint.idealDir(1, 0);
    approxPoint(lerpHom(finite, ideal, 0), finite, 't=0 → finite endpoint');
    approxPoint(lerpHom(finite, ideal, 1), ideal, 't=1 → ideal endpoint');
    // At t=0.5, w=0.5 in raw form; normalized to w=1 gives Cartesian (1, 0).
    approxPoint(
      lerpHom(finite, ideal, 0.5),
      HomPoint.finite(1, 0),
      'midpoint along ray',
    );
  });

  it('lerps two ideal directions linearly in direction-space', () => {
    const p1 = HomPoint.idealDir(1, 0);
    const p2 = HomPoint.idealDir(0, 1);
    // Raw lerp: (0.5, 0.5, 0); normalized to unit length: (√½, √½, 0).
    const mid = lerpHom(p1, p2, 0.5);
    approx(mid.w, 0, 'midpoint stays ideal');
    approx(mid.x, Math.SQRT1_2, 'normalised x');
    approx(mid.y, Math.SQRT1_2, 'normalised y');
  });

  it('throws when lerping antipodal ideal directions at the midpoint', () => {
    const p1 = HomPoint.idealDir(1, 0);
    const p2 = HomPoint.idealDir(-1, 0);
    assert.throws(
      () => lerpHom(p1, p2, 0.5),
      /zero vector has no projective meaning/,
    );
  });
});
