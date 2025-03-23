import { getSvgPathFromStroke, pointsOnBezierCurves } from '@folkjs/lib';
import { css, type PropertyValues } from '@lit/reactive-element';
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

declare global {
  interface HTMLElementTagNameMap {
    'folk-arrow': FolkArrow;
  }
}

export class FolkArrow extends FolkBaseConnection {
  static override tagName = 'folk-arrow';

  static styles = [
    FolkBaseConnection.styles,
    css`
      svg {
        width: 100%;
        height: 100%;
        stroke: black;
        fill: black;
        pointer-events: none;

        path {
          pointer-events: all;
        }

        polygon {
          pointer-events: all;
        }
      }
    `,
  ];

  #svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  #path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  #headPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  override createRenderRoot() {
    const root = super.createRenderRoot();

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

    this.#headPath.setAttribute('d', path);

    this.#svg.append(this.#path, this.#headPath);

    root.append(this.#svg);
    return root;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    const { sourceRect, targetRect } = this;

    if (sourceRect === null || targetRect === null) {
      this.#svg.style.display = 'none';
      return;
    }

    this.#svg.style.display = '';

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

    const points = pointsOnBezierCurves([
      { x: sx, y: sy },
      { x: cx, y: cy },
      { x: ex, y: ey },
      { x: ex, y: ey },
    ]);

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
    const path = getSvgPathFromStroke(stroke);

    this.#path.setAttribute('d', path);

    const endAngleAsDegrees = ae * (180 / Math.PI);
    this.#headPath.setAttribute('transform', `translate(${ex},${ey}) rotate(${endAngleAsDegrees})`);
  }
}
