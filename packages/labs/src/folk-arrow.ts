import { getSvgPathFromStroke, pointsOnBezierCurves } from '@folkjs/canvas';
import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import * as V from '@folkjs/geometry/Vector2';
import { getBoxToBoxArrow } from 'perfect-arrows';
import { getStroke } from 'perfect-freehand';
import { FolkBaseConnection } from './folk-base-connection';

export type Arrow = [
  /** The x position of the (padded) starting point. */
  sx: number,
  /** The y position of the (padded) starting point. */
  sy: number,
  /** The x position of the control point. */
  cx: number,
  /** The y position of the control point. */
  cy: number,
  /** The x position of the (padded) ending point. */
  ex: number,
  /** The y position of the (padded) ending point. */
  ey: number,
  /** The angle (in radians) for an ending arrowhead. */
  ae: number,
  /** The angle (in radians) for a starting arrowhead. */
  as: number,
  /** The angle (in radians) for a center arrowhead. */
  ac: number,
];

export class FolkArrow extends FolkBaseConnection {
  static override tagName = 'folk-arrow';

  static override styles = css`
    :host {
      display: block;
      position: absolute;
      pointer-events: none;
    }

    [part='arc'] {
      position: absolute;
      inset: 0;
      background: black;
    }

    [part='source'] {
      display: none;
    }

    [part='target'] {
      position: absolute;
      top: var(--folk-target-y);
      left: var(--folk-target-x);
      translate: -50% -50%;
      width: 22px;
      aspect-ratio: 1;
      rotate: var(--folk-target-angle);
      background: black;
    }
  `;

  #arc = document.createElement('div');
  #source = document.createElement('div');
  #target = document.createElement('div');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#arc.part.add('arc');
    this.#source.part.add('source');
    this.#target.part.add('target');

    const stroke = getStroke(
      [
        { x: -8, y: -8 },
        { x: 7, y: 0 },
        { x: -8, y: 8 },
      ],
      {
        size: 5,
        thinning: -0.25,
        smoothing: 0.5,
        streamline: 0,
        simulatePressure: false,
        // TODO: figure out how to expose these as attributes
        easing: (t) => t,
        start: {
          taper: 0,
          easing: (t) => t,
          cap: true,
        },
        end: {
          taper: 0,
          easing: (t) => t,
          cap: true,
        },
      },
    ).map(([x, y]) => ({ x, y }));

    const bounds = V.bounds.apply(null, stroke);

    // Make curve relative to it's bounding box
    for (const point of stroke) {
      point.x -= bounds.x;
      point.y -= bounds.y;
    }

    const path = getSvgPathFromStroke(stroke);

    this.#target.style.clipPath = `path("${path}")`;

    root.append(this.#arc, this.#source, this.#target);
    return root;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    const { sourceRect, targetRect } = this;

    if (sourceRect === null || targetRect === null) {
      this.style.display = 'none';
      return;
    }

    this.style.display = '';

    const [sx, sy, cx, cy, ex, ey, ae, as, ac] = getBoxToBoxArrow(
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      targetRect.x,
      targetRect.y,
      targetRect.width,
      targetRect.height,
      { padStart: 5, padEnd: 15 },
    ) as Arrow;

    const curve = [
      { x: sx, y: sy },
      { x: cx, y: cy },
      { x: ex, y: ey },
      // Need a forth point for the bezier curve util
      { x: ex, y: ey },
    ];

    const points = pointsOnBezierCurves(curve);

    const stroke = getStroke(points, {
      size: 6,
      thinning: 0.4,
      smoothing: 0,
      streamline: 0,
      simulatePressure: true,
      start: {
        cap: true,
      },
      end: {
        cap: true,
      },
    }).map(([x, y]) => ({ x, y }));

    const bounds = V.bounds.apply(null, stroke);

    // Make curve relative to it's bounding box
    for (const point of stroke) {
      point.x -= bounds.x;
      point.y -= bounds.y;
    }

    const path = getSvgPathFromStroke(stroke);

    this.style.top = `${bounds.y}px`;
    this.style.left = `${bounds.x}px`;
    this.style.width = `${bounds.width}px`;
    this.style.height = `${bounds.height}px`;
    this.#arc.style.clipPath = `path("${path}")`;

    this.style.setProperty('--folk-source-x', `${sx - bounds.x}px`);
    this.style.setProperty('--folk-source-y', `${sy - bounds.y}px`);
    this.style.setProperty('--folk-target-x', `${ex - bounds.x}px`);
    this.style.setProperty('--folk-target-y', `${ey - bounds.y}px`);
    this.style.setProperty('--folk-source-angle', `${as}rad`);
    this.style.setProperty('--folk-center-angle', `${ac}rad`);
    this.style.setProperty('--folk-target-angle', `${ae}rad`);
  }
}
