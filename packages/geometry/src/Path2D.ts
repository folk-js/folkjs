import * as R from './Rect2D';
import { average, toDOMPrecision } from './utilities';
import * as V from './Vector2';

export interface Path2D {
  closed: boolean;
  vertices: V.RelativePoint[];
}

export type ReadonlyPath2D = Readonly<{
  closed: boolean;
  vertices: ReadonlyArray<V.ReadonlyRelativePoint>;
}>;

export function bounds({ vertices }: ReadonlyPath2D): R.Rect2D {
  return V.bounds.apply(null, vertices as V.ReadonlyRelativePoint[]);
}

export function addRelativePoint(path: Path2D, point: V.RelativePoint) {
  path.vertices.push(point);
}

export function addAbsolutePoint(path: Path2D, bounds: R.ReadonlyRect2D, point: V.Point) {
  addRelativePoint(path, V.toRelativePoint(bounds, point));
}

export function fromAbsolutePoints(points: ReadonlyArray<V.ReadonlyPoint>): Path2D {
  const b = V.bounds.apply(null, points as V.ReadonlyPoint[]);
  return {
    closed: true,
    vertices: points.map((p) => V.toRelativePoint(b, p)),
  };
}

export function toSVGPath(path: ReadonlyPath2D, rect: R.ReadonlyRect2D): string {
  const vertices = path.vertices.map((v) => V.toAbsolutePoint(rect, v));
  const len = vertices.length;

  if (len < 4) return '';

  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];

  let result = `M${a.x},${a.y} Q${b.x},${b.y} ${average(b.x, c.x)},${average(b.y, c.y)} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    result += `${average(p1.x, p2.x)},${average(p1.y, p2.y)} `;
  }

  if (path.closed) {
    result += 'Z';
  }

  return result;
}

export function toCSSShape({ vertices, closed }: ReadonlyPath2D): string {
  if (vertices.length < 2) return '';

  const commands: string[] = [];

  const a = vertices[0];
  commands.push(`from ${toDOMPrecision(a.x * 100)}% ${toDOMPrecision(a.y * 100)}%`);

  for (let i = 0, max = vertices.length - 1; i < max; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    commands.push(
      `smooth to ${toDOMPrecision(average(p1.x, p2.x) * 100)}% ${toDOMPrecision(average(p1.y, p2.y) * 100)}%`,
    );
  }

  if (closed) {
    commands.push('close');
  }

  return `shape(
    ${commands.join(',\n\t')}
)`;
}
