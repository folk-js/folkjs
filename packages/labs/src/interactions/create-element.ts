import type { Point } from '@folkjs/geometry/Vector2';
import { selectElements } from './dom-multi-selection';

export function clickToCreateElement<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
): Promise<T | null> {
  return new Promise((resolve) => {
    function onClick(event: MouseEvent) {
      const el = createElement({ x: event.pageX, y: event.pageY });
      // should be generalize this?
      container.appendChild(el);
      cleanUp();
      resolve(el);
    }

    function onCancel() {
      cleanUp();
      resolve(null);
    }

    function cleanUp() {
      document.body.inert = false;
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('click', onClick, { capture: true });
    }

    // should this just be applied to the container
    document.body.inert = true;
    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('click', onClick, { capture: true });
  });
}

export function dragToCreateElement<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
  updateElement: (element: T, point: Point) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    let el: T | null = null;

    function onPointerDown(event: PointerEvent) {
      const point = container.space!.mapPointFromParent({ x: event.pageX, y: event.pageY });
      el = createElement(point);
      container.addEventListener('pointermove', onPointerMove, { capture: true });
      container.addEventListener('pointerup', onPointerUp, { capture: true });
      // should be generalize this?
      container.appendChild(el);
    }

    function onPointerMove(event: PointerEvent) {
      if (el === null) return;
      const point = container.space!.mapPointFromParent({ x: event.pageX, y: event.pageY });
      updateElement(el, point);
    }

    function onPointerUp(event: PointerEvent) {
      if (el === null) return;
      const point = container.space!.mapPointFromParent({ x: event.pageX, y: event.pageY });
      updateElement(el, point);
      cleanUp();
      resolve(el);
    }

    function onCancel() {
      cleanUp();
      el?.remove();
      resolve(null);
    }

    function cleanUp() {
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
    }

    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
  });
}

export async function dragToCreateShape<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: () => T,
): Promise<T | null> {
  const el = await dragToCreateElement(
    container,
    cancellationSignal,
    (point) => {
      const element = createElement();
      element.setAttribute('folk-shape', `x: ${point.x}; y: ${point.y}; width: 0; height: 0`);
      return element;
    },
    (el, point) => {
      const shape = el.shape;

      if (shape === undefined) return;

      shape.width = point.x - shape.x;
      shape.height = point.y - shape.y;
    },
  );
  return el;
}

export function clickToCreateShapes<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  completionSignal: AbortSignal,
): Promise<T[] | null> {
  return new Promise(async (resolve) => {
    const elements = await selectElements(completionSignal, cancellationSignal);

    for (const el of elements) {
      el.setAttribute('folk-shape', '');
    }
  });
}
