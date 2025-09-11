import * as R from './Rect2D';
import * as V from './Vector2';

// Ported from https://gist.github.com/juancampa/330949688776a46ae03302a134609c79
// TODO: finish port
export function arrange(rects: R.Rect2D[], repulsionSteps: number, compactionSteps: number): void {
  if (rects.length === 0) return;

  // First pass, resolve overlaps
  for (let i = 0; i < repulsionSteps; i++) {
    const forces: Map<R.Rect2D, V.Vector2> = new Map();

    for (const r1 of rects) {
      for (const r2 of rects) {
        if (r1 === r2) continue;

        const overlap = R.intersection(r1, r2);

        if (overlap !== null) {
          const expandedOverlap = R.expand(overlap, 10);

          const accumulated = forces.get(r1) || V.zero();

          // Small random perturbation to handle blocks that perfectly overlap
          const permutedCenter = V.add(R.center(r1), { x: Math.random(), y: Math.random() });
          const direction = V.normalized(V.subtract(permutedCenter, R.center(expandedOverlap)));

          // Divide by area so "heavier" blocks move less
          const force = V.scale(direction, (R.area(expandedOverlap) / R.area(r1)) * 50.0);
          forces.set(r1, V.add(accumulated, force));
        }
      }
    }

    if (forces.size === 0) break;

    // Apply forces
    forces.forEach((force, r) => R.translateSelf(r, force));
  }

  // Find the average center
  const center = V.center(...rects.map((r) => R.center(r)));

  // Find block closest to center and keep it fixed
  const centerBlock = minBy(center, rects);

  const centerPosition = R.center(centerBlock);

  // Compaction pass
  for (let i = 0; i < compactionSteps; i++) {
    for (const r1 of rects) {
      if (r1 === centerBlock) continue;

      const toCenter = V.subtract(centerPosition, R.center(r1));
      const step = V.scale(V.normalized(toCenter), Math.min(r1.width, r1.height, V.magnitude(toCenter)) * 0.1);
      R.translateSelf(r1, step);

      // Solve collisions
      for (const r2 of rects) {
        if (r1 === r2) continue;

        const overlap = R.intersection(r1, r2);

        if (overlap !== null) {
          if (overlap.width >= overlap.height) {
            R.translateSelf(r1, { x: 0, y: -Math.sign(step.y) * overlap.height });
          } else {
            R.translateSelf(r1, { x: -Math.sign(step.x) * overlap.width, y: 0 });
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

function minBy(center: V.Point, [closest, ...rects]: R.Rect2D[]): R.Rect2D {
  let distance = V.distanceSquared(center, R.center(closest));

  for (const rect of rects) {
    const d = V.distanceSquared(center, rect);
    if (d < distance) {
      distance = d;
      closest = rect;
    }
  }

  return closest;
}
