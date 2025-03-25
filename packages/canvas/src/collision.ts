import { DOMRectTransform } from './DOMRectTransform';
import { Point } from './types';

const sign = (value: number): -1 | 1 => (value < 0 ? -1 : 1);

export class Hit {
  /** The point of contact between the two objects. */
  pos: Point = { x: 0, y: 0 };

  /** The a vector representing the overlap between the two objects. */
  delta: Point = { x: 0, y: 0 };

  /** The surface normal at the point of contact. */
  normal: Point = { x: 0, y: 0 };
}

const center = (rect: DOMRectReadOnly) => ({
  width: rect.width / 2,
  height: rect.height / 2,
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

export function aabbHitDetection(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly): Hit | null {
  const center1 = center(rect1);
  const center2 = center(rect2);

  const dx = center2.x - center1.x;
  const px = center2.width + center1.width - Math.abs(dx);
  if (px <= 0) return null;

  const dy = center2.y - center1.y;
  const py = center2.height + center1.height - Math.abs(dy);
  if (py <= 0) return null;

  const hit = new Hit();
  if (px < py) {
    const sx = sign(dx);
    hit.delta.x = px * sx;
    hit.normal.x = sx;
    hit.pos.x = center1.x + center1.width * sx;
    hit.pos.y = center2.y;
  } else {
    const sy = sign(dy);
    hit.delta.y = py * sy;
    hit.normal.y = sy;
    hit.pos.x = center2.x;
    hit.pos.y = center1.y + center1.height * sy;
  }
  return hit;
}

export function aabbIntersection(rect1: DOMRect, rect2: DOMRect, proximity = 0) {
  return (
    rect1.left - rect2.right < proximity &&
    rect2.left - rect1.right < proximity &&
    rect1.top - rect2.bottom < proximity &&
    rect2.top - rect1.bottom < proximity
  );
}

export function collisionDetection(rect1: DOMRectTransform, rect2: DOMRectTransform) {
  // Performance optimization to test if
  if (!aabbIntersection(rect1, rect2)) return false;
}
