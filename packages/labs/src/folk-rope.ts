// This is a rewrite of https://github.com/guerrillacontra/html5-es6-physics-rope

import {
  AnimationFrameController,
  AnimationFrameControllerHost,
  DOMRectTransform,
  Vector,
  type Point,
} from '@folkjs/lib';
import { css, property, PropertyValues } from '@folkjs/lib/reactive-element';
import { FolkBaseConnection } from './folk-base-connection';

// Each rope part is one of these uses a high precision variant of Störmer–Verlet integration to keep the simulation consistent otherwise it would "explode"!
interface RopePoint {
  pos: Point;
  distanceToNextPoint: number;
  isFixed: boolean;
  oldPos: Point;
  velocity: Point;
  mass: number;
  damping: number;
  prev: RopePoint | null;
  next: RopePoint | null;
}

declare global {
  interface HTMLElementTagNameMap {
    'folk-rope': FolkRope;
  }
}

export class FolkRope extends FolkBaseConnection implements AnimationFrameControllerHost {
  static override tagName = 'folk-rope';

  static #resolution = 5;

  static override styles = [
    FolkBaseConnection.styles,
    css`
      svg {
        height: 100%;
        pointer-events: none;
        width: 100%;
      }

      path {
        fill: none;
        pointer-events: stroke;
        stroke: var(--folk-rope-color, black);
        stroke-width: var(--folk-rope-width, 3);
        stroke-linecap: var(--folk-rope-linecap, round);
      }
    `,
  ];

  // TODO: stop simulation when energy approaches 0
  #rAF = new AnimationFrameController(this, 10000);

  #svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  #path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  #path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  #points: RopePoint[] = [];

  get points() {
    return this.#points;
  }

  @property({ type: Object }) gravity = { x: 0, y: 3000 };

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#svg.append(this.#path, this.#path2);

    root.appendChild(this.#svg);

    return root;
  }

  tick() {
    for (const point of this.#points) {
      this.#integratePoint(point, this.gravity);
    }

    // 3 constraint iterations is enough for fixed timestep
    for (let iteration = 0; iteration < 3; iteration++) {
      for (const point of this.#points) {
        this.#constrainPoint(point);
      }
    }
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    const { sourceRect, targetRect } = this;

    if (sourceRect === null || targetRect === null) {
      this.#rAF.stop();
      this.#points = [];
      this.#path.removeAttribute('d');
      this.#path2.removeAttribute('d');
      return;
    }

    let source: Point;
    let target: Point;

    if (sourceRect instanceof DOMRectTransform) {
      source = sourceRect.center;
    } else {
      source = {
        x: sourceRect.x + sourceRect.width / 2,
        y: sourceRect.y + sourceRect.height,
      };
    }

    if (targetRect instanceof DOMRectTransform) {
      target = targetRect.center;
    } else {
      target = {
        x: targetRect.x + targetRect.width / 2,
        y: targetRect.y + targetRect.height,
      };
    }

    if (this.#points.length === 0) {
      this.#points = this.#generatePoints(source, target);
      this.#rAF.start();
    }

    const startingPoint = this.#points.at(0);
    const endingPoint = this.#points.at(-1);

    if (startingPoint === undefined || endingPoint === undefined) return;

    startingPoint.pos = source;
    endingPoint.pos = target;
  }

  /** add/remove points based on distance between source and target rects */
  stretch() {
    if (this.sourceRect === null || this.targetRect === null || this.#points.length < 2) return;

    // Calculate desired length based on source and target positions
    const distance = Vector.distance(this.sourceRect, this.targetRect);
    // Apply a nonlinear scaling to gradually increase point spacing with distance
    const scaleFactor = Math.log10(distance + 10) / 2; // adjust the '+10' and '/2' to tune the curve
    const effectiveResolution = FolkRope.#resolution * scaleFactor;
    const desiredPoints = Math.floor(distance / effectiveResolution);

    while (this.#points.length < desiredPoints) {
      const lastPoint = this.#points.at(-1)!;
      lastPoint.isFixed = false;
      const newPoint = {
        pos: { ...lastPoint.pos },
        oldPos: { ...lastPoint.pos },
        distanceToNextPoint: FolkRope.#resolution,
        mass: 1,
        damping: 0.99,
        velocity: Vector.zero(),
        isFixed: true,
        prev: lastPoint,
        next: null,
      };
      lastPoint.next = newPoint;
      this.#points.push(newPoint);
    }

    while (this.#points.length > desiredPoints) {
      this.#points.pop();
      this.#points.at(-1)!.isFixed = true;
    }
  }

  render() {
    if (this.#points.length < 2) return;

    let pathData = `M ${this.#points[0].pos.x} ${this.#points[0].pos.y}`;

    let path2Data = '';
    let isBroken = false;

    for (let i = 1; i < this.#points.length; i++) {
      const point = this.#points[i];

      if (point.prev === null) {
        isBroken = true;
        path2Data = `M ${point.pos.x} ${point.pos.y}`;
      } else if (isBroken) {
        path2Data += ` L ${point.pos.x} ${point.pos.y}`;
      } else {
        pathData += ` L ${point.pos.x} ${point.pos.y}`;
      }
    }

    this.#path.setAttribute('d', pathData);

    if (path2Data) {
      this.#path2.setAttribute('d', path2Data);
    } else {
      this.#path2.removeAttribute('d');
    }
  }

  #generatePoints(start: Point, end: Point) {
    const delta = Vector.sub(end, start);
    const len = Vector.mag(delta);
    const points: RopePoint[] = [];
    const pointsLen = Math.floor(len / FolkRope.#resolution);

    for (let i = 0; i < pointsLen; i++) {
      const percentage = i / (pointsLen - 1);
      const pos = Vector.lerp(start, end, percentage);

      points.push({
        pos,
        oldPos: { ...pos },
        distanceToNextPoint: FolkRope.#resolution,
        mass: 1,
        damping: 0.99,
        velocity: Vector.zero(),
        isFixed: i === 0 || i === pointsLen - 1,
        prev: null,
        next: null,
      });
    }

    // Link nodes into a doubly linked list
    for (let i = 0; i < pointsLen; i++) {
      const prev = i != 0 ? points[i - 1] : null;
      const curr = points[i];
      const next = i != pointsLen - 1 ? points[i + 1] : null;

      curr.prev = prev;
      curr.next = next;
    }

    return points;
  }

  #integratePoint(point: RopePoint, gravity: Point) {
    if (!point.isFixed) {
      point.velocity = Vector.sub(point.pos, point.oldPos);
      point.oldPos = { ...point.pos };

      const accel = Vector.add(gravity, { x: 0, y: point.mass });
      const tsSq = this.#rAF.fixedTimestep ** 2;

      point.pos.x += point.velocity.x * point.damping + accel.x * tsSq;
      point.pos.y += point.velocity.y * point.damping + accel.y * tsSq;
    } else {
      point.velocity = Vector.zero();
      point.oldPos = { ...point.pos };
    }
  }

  // Apply constraints related to other nodes next to it (keeps each node within distance)
  #constrainPoint(point: RopePoint) {
    if (point.next) applyConstraint(point, point.next);
    if (point.prev) applyConstraint(point, point.prev);
  }

  #cutIndex = -1;

  get isCut() {
    return this.#cutIndex !== -1;
  }

  cut(atPercentage = 0.5) {
    if (this.isCut) return;

    this.#cutIndex = this.#getPointIndexAt(atPercentage);

    this.#points[this.#cutIndex].next = null;
    this.#points[this.#cutIndex + 1].prev = null;
    this.#rAF.reset();
  }

  mend() {
    if (!this.isCut) return;

    this.#points[this.#cutIndex].next = this.#points[this.#cutIndex + 1];
    this.#points[this.#cutIndex + 1].prev = this.#points[this.#cutIndex];
    this.#cutIndex = -1;
    this.#rAF.reset();
  }

  getPointAt(percentage: number) {
    return this.#points[this.#getPointIndexAt(percentage)];
  }

  #getPointIndexAt(percentage: number) {
    const clamped = Math.min(Math.max(percentage, 0), 1);
    return Math.floor(this.#points.length * clamped);
  }

  getPercentageFromPoint(hitPoint: Point): number | null {
    for (let i = 0; i < this.#points.length - 1; i++) {
      const point = this.#points[i];
      const nextPoint = point.next;

      if (nextPoint === null) return null;

      if (
        Vector.distance(point.pos, hitPoint) +
          Vector.distance(hitPoint, nextPoint.pos) -
          Vector.distance(point.pos, nextPoint.pos) <
        1
      ) {
        return i / this.#points.length;
      }
    }
    return null;
  }
}

function applyConstraint(p1: RopePoint, p2: RopePoint) {
  const delta = Vector.sub(p2.pos, p1.pos);
  const len = Vector.mag(delta);

  // Prevent division by zero
  if (len < 0.0001) return;

  const diff = len - p1.distanceToNextPoint;
  const normal = Vector.normalized(delta);
  const adjustment = Vector.scale(normal, diff * 0.75);

  if (!p1.isFixed) {
    p1.pos = Vector.add(p1.pos, adjustment);
  }
  if (!p2.isFixed) {
    p2.pos = Vector.sub(p2.pos, adjustment);
  }
}
