import { getSvgPathFromStroke, pointsOnBezierCurves } from '@folkjs/canvas';
import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import * as R from '@folkjs/geometry/Rect2D';
import { getBoxToBoxArrow } from 'perfect-arrows';
import { getStroke } from 'perfect-freehand';
import { FolkBaseConnection } from './folk-base-connection';

function boundingBoxFromCurve(points: number[][]): R.Rect2D {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const [x, y] of points) {
    if (y < top) top = y;
    if (y > bottom) bottom = y;
    if (x < left) left = x;
    if (x > right) right = x;
  }

  return R.fromValues(left, top, right - left, bottom - top);
}

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

    /*[part='source'] {
      position: absolute;
    }

    

    [part='target'] {
      position: absolute;
      inset: 0;
      background: black;
    }*/
  `;

  #source = document.createElement('div');
  #arc = document.createElement('div');
  #target = document.createElement('div');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#source.part.add('source');
    this.#arc.part.add('arc');
    this.#target.part.add('target');

    const stroke = getStroke(
      [
        { x: -8, y: -8 },
        { x: 7, y: 0 },
        { x: -8, y: 8 },
      ],
      {
        size: 4,
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
    );

    const path = getSvgPathFromStroke(stroke);

    this.#target.style.clipPath = `path("${path}")`;

    root.append(this.#source, this.#arc, this.#target);
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

    const [sx, sy, cx, cy, ex, ey, ae] = getBoxToBoxArrow(
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      targetRect.x,
      targetRect.y,
      targetRect.width,
      targetRect.height,
      { padStart: 1, padEnd: 15 },
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
      size: 5,
      thinning: 0.4,
      smoothing: 0,
      streamline: 0,
      simulatePressure: true,
      // TODO: figure out how to expose these as attributes
      easing: (t) => t,
      start: {
        taper: 40,
        easing: (t) => t,
      },
      end: {
        cap: true,
      },
    });

    const bounds = boundingBoxFromCurve(stroke);

    // Make curve relative to it's bounding box
    for (const point of stroke) {
      point[0] -= bounds.x;
      point[1] -= bounds.y;
    }

    const path = getSvgPathFromStroke(stroke);

    this.style.top = `${bounds.y}px`;
    this.style.left = `${bounds.x}px`;
    this.style.width = `${bounds.width}px`;
    this.style.height = `${bounds.height}px`;
    this.#arc.style.clipPath = `path("${path}")`;

    const start = stroke[0];
    const end = stroke.at(-1)!;

    this.style.setProperty('--folk-source-x', `${start[0]}px`);
    this.style.setProperty('--folk-source-y', `${start[1]}px`);
    this.style.setProperty('--folk-target-x', `${end[0]}px`);
    this.style.setProperty('--folk-target-y', `${end[1]}px`);

    this.#target.style.translate = `${ex}px ${ey}px`;
    this.#target.style.rotate = `${ae}rad`;
  }
}
