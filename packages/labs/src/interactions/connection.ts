import type { Point } from '@folkjs/geometry/Vector2';
import type { FolkBaseConnection } from '../folk-base-connection';

export async function retargetConnection(
  connection: FolkBaseConnection,
  type: 'source' | 'target',
  cancellationSignal: AbortSignal,
) {}

export function dragToCreateConnection<T extends FolkBaseConnection = FolkBaseConnection>(
  container: Element,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
): Promise<T | null> {
  return new Promise((resolve) => {});
}
