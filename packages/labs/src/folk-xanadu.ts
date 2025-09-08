import { verticesToPolygon } from '@folkjs/canvas';
import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { bounds, type Point } from '@folkjs/geometry/Vector2';
import { FolkBaseConnection } from './folk-base-connection.js';

export class FolkXanadu extends FolkBaseConnection {
  static override tagName = 'folk-xanadu';

  static override styles = css`
    :host {
      display: block;
      position: absolute;
      pointer-events: none;
    }
  `;

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    let { sourceRect, targetRect } = this;

    if (sourceRect === null || targetRect === null) {
      this.style.clipPath = '';
      this.style.display = 'none';
      return;
    }

    this.style.display = '';

    // If the right side of the target is to the left of the right side of the source then swap them
    if (sourceRect.x + sourceRect.width > targetRect.x + targetRect.width) {
      const temp = sourceRect;
      sourceRect = targetRect;
      targetRect = temp;
    }

    // TODO: add getTransformDOMRects to iframe protocol.
    let sourceVertices = computeInlineVertices(Array.from([sourceRect]));
    const targetVertices = computeInlineVertices(Array.from([targetRect]));

    if (sourceVertices.length === 0 || targetVertices.length === 0) {
      this.style.clipPath = '';
      return;
    }

    // To trace the link we need to rotate the vertices of the source to start on the bottom right corner.
    const maxRightCoordinate = Math.max.apply(
      null,
      sourceVertices.map((vertex) => vertex.x),
    );
    const maxBottomCoordinate = Math.max.apply(
      null,
      sourceVertices.filter((vertex) => vertex.x === maxRightCoordinate).map((vertex) => vertex.y),
    );

    const index = sourceVertices.findIndex(
      (vertex) => vertex.x === maxRightCoordinate && vertex.y === maxBottomCoordinate,
    );

    sourceVertices = sourceVertices.slice(index).concat(sourceVertices.slice(0, index));

    const vertices = sourceVertices.concat(targetVertices);
    const rect = bounds.apply(null, vertices);

    // Make curve relative to it's bounding box
    for (const point of vertices) {
      point.x -= rect.x;
      point.y -= rect.y;
    }

    this.style.top = `${rect.y}px`;
    this.style.left = `${rect.x}px`;
    this.style.width = `${rect.width}px`;
    this.style.height = `${rect.height}px`;
    this.style.clipPath = verticesToPolygon(vertices);
  }
}

// The order that vertices are returned is significant
function computeInlineVertices(rects: DOMRect[]): Point[] {
  rects = rects.map((rect) =>
    DOMRectReadOnly.fromRect({
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    }),
  );

  if (rects.length === 0) return [];
  else if (rects.length === 1) {
    const rect = rects[0];
    return [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
  }

  const vertices: Point[] = [];

  if (rects[1].left < rects[0].left) {
    vertices.push({ x: rects[1].left, y: rects[1].top }, { x: rects[0].left, y: rects[0].bottom });
  }

  vertices.push({ x: rects[0].left, y: rects[0].top }, { x: rects[0].right, y: rects[0].top });

  const maxRightCoordinate = Math.max.apply(
    null,
    rects.map((rect) => rect.right),
  );
  const maxBottomCoordinate = Math.max.apply(
    null,
    rects.filter((rect) => rect.right === maxRightCoordinate).map((rect) => rect.bottom),
  );

  vertices.push({
    x: maxRightCoordinate,
    y: maxBottomCoordinate,
  });

  const lastRect = rects.at(-1)!;

  if (lastRect.bottom > maxBottomCoordinate) {
    vertices.push({ x: lastRect.right, y: lastRect.top }, { x: lastRect.right, y: lastRect.bottom });
  }

  vertices.push({ x: lastRect.left, y: lastRect.bottom });

  return vertices;
}
