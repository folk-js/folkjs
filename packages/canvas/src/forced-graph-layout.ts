import { DOMRectTransform } from './DOMRectTransform';
import type { Point } from './types';
import { Vector } from './Vector';

class Rect {
  static center(rect: DOMRectReadOnly): Point {
    return {
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    };
  }

  static area(rect: DOMRectReadOnly): number {
    return rect.width * rect.height;
  }

  static expand(rect: DOMRectReadOnly, amount: number) {
    return new DOMRect();
  }

  static translate(rect: DOMRect, vector: Point) {
    rect.x += vector.x;
    rect.y += vector.y;
  }

  static intersect(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly): DOMRectReadOnly {
    const x = Math.max(rect1.x, rect2.x);
    const y = Math.max(rect1.y, rect2.y);
    const width = Math.min(rect1.right, rect2.right);
    const height = Math.min(rect1.bottom, rect2.bottom);

    return new DOMRectTransform({ x, y, width, height });
  }

  static intersects(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly, proximity = 0): boolean {
    return (
      rect1.left - rect2.right < proximity &&
      rect2.left - rect1.right < proximity &&
      rect1.top - rect2.bottom < proximity &&
      rect2.top - rect1.bottom < proximity
    );
  }
}

// Ported from https://gist.github.com/juancampa/330949688776a46ae03302a134609c79
export function arrange(rects: DOMRectTransform[], repulsionSteps: number, compactionSteps: number): void {
  if (rects.length === 0) return;

  // First pass, resolve overlaps
  for (let i = 0; i < repulsionSteps; i++) {
    const forces: Map<DOMRect, Point> = new Map();

    for (const r1 of rects) {
      for (const r2 of rects) {
        if (r1 === r2) continue;

        const overlap = Rect.intersect(r1, r2);

        if (overlap.width > 0 && overlap.height > 0) {
          const expandedOverlap = Rect.expand(overlap, 10);

          const accumulated = forces.get(r1) || Vector.zero();

          // Small random perturbation to handle blocks that perfectly overlap
          const permutedCenter = Vector.add(r1.center, { x: Math.random(), y: Math.random() });
          const direction = Vector.normalized(Vector.sub(permutedCenter, Rect.center(expandedOverlap)));

          // Divide by area so "heavier" blocks move less
          const force = Vector.scale(direction, (Rect.area(expandedOverlap) / Rect.area(r1)) * 50.0);
          forces.set(r1, Vector.add(accumulated, force));
        }
      }
    }

    if (forces.size === 0) break;

    // Apply forces
    forces.forEach((force, r) => Rect.translate(r, force));
  }

  // Find the average center
  const center = Vector.center(rects.map((r) => r.center));

  // Find block closest to center and keep it fixed
  const centerBlock = minBy(center, rects);

  const centerPosition = centerBlock.center;

  // Compaction pass
  for (let i = 0; i < compactionSteps; i++) {
    for (const r1 of rects) {
      if (r1 === centerBlock) continue;

      const toCenter = Vector.sub(centerPosition, r1.center);
      const step = Vector.scale(Vector.normalized(toCenter), Math.min(r1.width, r1.height, Vector.mag(toCenter)) * 0.1);
      Rect.translate(r1, step);

      // Solve collisions
      for (const r2 of rects) {
        if (r1 === r2) continue;

        const overlap = Rect.intersect(r1, r2);

        if (overlap.width > 0 && overlap.height > 0) {
          if (overlap.width >= overlap.height) {
            Rect.translate(r1, { x: 0, y: -Math.sign(step.y) * overlap.height });
          } else {
            Rect.translate(r1, { x: -Math.sign(step.x) * overlap.width, y: 0 });
          }
        }
      }

      // rects.set(b1, r1);
    }
  }

  // Animate the transitions
  // for (const b of keys) {
  //   const layer = new Area(blockAreaId(this.id, b)).layer();
  //   AreaTransition.trigger(ui.ctx(), layer, original.get(b)!.min);
  // }
}

function minBy(center: Point, [closest, ...rects]: DOMRectTransform[]): DOMRectTransform {
  let distance = Vector.distanceSquared(center, closest.center);

  for (const rect of rects) {
    const d = Vector.distanceSquared(center, rect.center);
    if (d < distance) {
      distance = d;
      closest = rect;
    }
  }

  return closest;
}
