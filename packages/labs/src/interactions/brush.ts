import * as R from '@folkjs/geometry/Rect2D';
import { toDOMPrecision } from '@folkjs/geometry/utilities';
import * as V from '@folkjs/geometry/Vector2';
import type { FolkInk, StrokePoint } from 'src/folk-ink';

export function brushInkShape(container: HTMLElement, cancellationSignal: AbortSignal) {
  return new Promise<FolkInk | null>((resolve) => {
    const ink = document.createElement('folk-ink');
    const points: StrokePoint[] = [];

    function updatePoints(point: StrokePoint) {
      point.x = toDOMPrecision(point.x);
      point.y = toDOMPrecision(point.y);
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
      container.setPointerCapture(event.pointerId);

      container.addEventListener('pointermove', onPointerMove, { capture: true });
      container.addEventListener('pointerup', onPointerUp, { capture: true });

      ink.setAttribute('folk-shape', '');

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

    function onTouch(event: TouchEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }

    function onCancel() {
      cleanUp();
      resolve(null);
    }

    function cleanUp() {
      container.style.cursor = '';
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('touchmove', onTouch, { capture: true });
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
    }

    container.style.cursor = 'crosshair';
    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('touchmove', onTouch, { capture: true });
  });
}
