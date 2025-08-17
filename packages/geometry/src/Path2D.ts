import { type Rect2D } from './Rect2D';
import { average, toDOMPrecision } from './utilities';
import type { Point } from './Vector2';
import * as V from './Vector2';

export interface Path2D {
  closed: boolean;
  vertices: Point[];
}

export type ReadonlyPath2D = Readonly<Path2D>;

export function bounds({ vertices }: Path2D): Rect2D {
  return V.bounds.apply(null, vertices);
}

export function toSVGPath({ vertices, closed }: Path2D): string {
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

  if (closed) {
    result += 'Z';
  }

  return result;
}

function relativePoint(bounds: Rect2D, point: Point): Point {
  return {
    x: ((point.x - bounds.x) / bounds.width) * 100,
    y: ((point.y - bounds.y) / bounds.height) * 100,
  };
}

export function toCSSShape(path: Path2D): string {
  if (path.vertices.length < 4) return '';

  const b = bounds(path);
  const vertices = path.vertices.map((point) => relativePoint(b, point));
  const commands: string[] = [];

  const a = vertices[0];
  commands.push(`from ${toDOMPrecision(a.x)}% ${toDOMPrecision(a.y)}%`);

  for (let i = 0, max = vertices.length - 1; i < max; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    commands.push(`smooth to ${toDOMPrecision(average(p1.x, p2.x))}% ${toDOMPrecision(average(p1.y, p2.y))}%`);
  }

  if (closed) {
    commands.push('close');
  }

  return `shape(
    ${commands.join(',\n\t')}
)`;
}
