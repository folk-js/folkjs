import { TransformStack } from '@folkjs/canvas';
import * as R from '@folkjs/geometry/Rect2D';
import { toDOMPrecision } from '@folkjs/geometry/utilities';
import * as V from '@folkjs/geometry/Vector2';
import type { FolkInk, StrokePoint } from 'src/folk-ink';

export function brushInkShape(container: HTMLElement, cancellationSignal: AbortSignal) {
  return new Promise<FolkInk | null>((resolve) => {
    const transformStack = new TransformStack(container.folkSpace ? [container.folkSpace] : []);
    const ink = document.createElement('folk-ink');
    const points: StrokePoint[] = [];

    function updatePoints(point: StrokePoint) {
      const transformedPoint = transformStack.mapPointToLocal(point);

      points.push({
        x: toDOMPrecision(transformedPoint.x),
        y: toDOMPrecision(transformedPoint.y),
        pressure: point.pressure,
      });

      if (ink.folkShape === undefined) return;

      const bounds = R.expand(V.bounds.apply(null, points), ink.size);

      ink.folkShape.x = bounds.x;
      ink.folkShape.y = bounds.y;
      ink.folkShape.width = bounds.width;
      ink.folkShape.height = bounds.height;

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

      // need to wait for the shape to be added
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

const styles = new CSSStyleSheet();
styles.replaceSync(`
  html:has([folk-selected-element]) * {
    cursor: crosshair;
  }

  [folk-selected-element] {
    outline: solid 1px blue !important;
    outline-offset: -1px;
  }
`);

export function brushToSelectElements<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  filter?: (el: Element) => T | null,
) {
  return new Promise<T[]>((resolve) => {
    const elements = new Set<T>();

    function elementsToSelect(event: PointerEvent) {
      document.elementsFromPoint(event.pageX, event.pageY).forEach((el) => {
        if (filter === undefined) {
          el.setAttribute('folk-selected-element', '');
          elements.add(el as T);
          return;
        }

        const filteredEl = filter(el);
        if (filteredEl) {
          elements.add(el as T);
          el.setAttribute('folk-selected-element', '');
        }
      });
    }

    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      container.setPointerCapture(event.pointerId);

      container.addEventListener('pointermove', onPointerMove, { capture: true });
      container.addEventListener('pointerup', onPointerUp, { capture: true });
      elementsToSelect(event);
    }

    function onPointerMove(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      elementsToSelect(event);
    }

    function onPointerUp(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      cleanUp();
      resolve(Array.from(elements));
    }

    function onTouch(event: TouchEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }

    function onCancel() {
      cleanUp();
      resolve([]);
    }

    function cleanUp() {
      elements.forEach((el) => el.removeAttribute('folk-selected-element'));
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('touchmove', onTouch, { capture: true });
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
      container.ownerDocument.adoptedStyleSheets.splice(container.ownerDocument.adoptedStyleSheets.indexOf(styles), 1);
    }

    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.addEventListener('touchmove', onTouch, { capture: true });
    container.ownerDocument.adoptedStyleSheets.push(styles);
  });
}

const deleteStyles = new CSSStyleSheet();
styles.replaceSync(`
  [folk-selected-element] {
    outline: none;
    opacity: 0.4;
  }
`);

export async function brushToDeleteElements<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  filter?: (el: Element) => T | null,
) {
  container.ownerDocument.adoptedStyleSheets.push(deleteStyles);
  const elements = await brushToSelectElements<T>(container, cancellationSignal, filter);
  container.ownerDocument.adoptedStyleSheets.splice(
    container.ownerDocument.adoptedStyleSheets.indexOf(deleteStyles),
    1,
  );

  elements.forEach((el) => el.remove());

  return elements;
}
