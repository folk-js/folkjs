import * as P from '@folkjs/geometry/Path2D';
import * as R from '@folkjs/geometry/Rect2D';
import * as V from '@folkjs/geometry/Vector2';
import type { FolkInk, StrokePoint } from 'src/folk-ink';

export function brushInkShape(container: HTMLElement, cancellationSignal: AbortSignal) {
  return new Promise<FolkInk | null>((resolve) => {
    const ink = document.createElement('folk-ink');
    const points: StrokePoint[] = [];

    function updatePoints(point: StrokePoint) {
      points.push(point);

      if (ink.shape === undefined) return;

      const bounds = R.expand(V.bounds.apply(null, points), ink.size);

      ink.shape.x = bounds.x;
      ink.shape.y = bounds.y;
      ink.shape.width = bounds.width;
      ink.shape.height = bounds.height;

      ink.points = points.map((p) => ({ ...V.toRelativePoint(bounds, p), pressure: p.pressure }));
    }

    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      container.addEventListener('pointermove', onPointerMove, { capture: true });
      container.addEventListener('pointerup', onPointerUp, { capture: true });

      ink.setAttribute('folk-shape', '');

      if (event.pointerType !== 'mouse') ink.simulatePressure = false;

      container.appendChild(ink);

      setTimeout(() => updatePoints({ x: event.pageX, y: event.pageY, pressure: event.pressure }));
    }

    function onPointerMove(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      updatePoints({ x: event.pageX, y: event.pageY, pressure: event.pressure });
    }

    function onPointerUp(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      cleanUp();
      resolve(ink);
    }

    function onCancel() {
      cleanUp();
      resolve(null);
    }

    function cleanUp() {
      container.style.cursor = '';
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
    }

    container.style.cursor = 'crosshair';
    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
  });
}
