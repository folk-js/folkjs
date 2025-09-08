import type { Point } from '@folkjs/geometry/Vector2';
import type { FolkBaseConnection } from '../folk-base-connection';
import { selectElement } from './dom-selection';

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

export async function clickToCreateConnection<T extends FolkBaseConnection = FolkBaseConnection>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: () => T,
) {
  const connection = createElement();
  // F
  connection.style.zIndex = '-1';

  container.appendChild(connection);

  function onPointerMove(event: PointerEvent) {
    let pointerPosition = { x: event.pageX, y: event.pageY };

    if (container.space) {
      pointerPosition = container.space?.mapPointFromParent(pointerPosition);
    }

    connection.target = pointerPosition;
  }

  container.addEventListener('pointermove', onPointerMove, { capture: true, signal: cancellationSignal });

  const source = await selectElement(cancellationSignal, container);

  if (!source) return;

  connection.source = source;

  const target = await selectElement(cancellationSignal, container);
  console.log(target);
  connection.style.zIndex = '';
  container.removeEventListener('pointermove', onPointerMove, { capture: true });

  if (!target) return;

  connection.target = target;

  return connection;
}

export function clickToCreateArrow(container: HTMLElement, cancellationSignal: AbortSignal) {
  return clickToCreateConnection(container, cancellationSignal, () => document.createElement('folk-arrow'));
}

export async function clickToCreateEventPropagator(container: HTMLElement, cancellationSignal: AbortSignal) {
  const ep = await clickToCreateConnection(container, cancellationSignal, () =>
    document.createElement('folk-event-propagator'),
  );

  if (ep) {
    setTimeout(() => ep.focus(), 0);
  }

  return ep;
}
