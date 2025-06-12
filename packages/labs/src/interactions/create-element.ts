import type { Point } from 'packages/geometry/dist/Vector2';
import type { FolkBaseConnection } from '../folk-base-connection';

export function clickToCreateElement<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
): Promise<T | null> {
  return new Promise((resolve) => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      onCancel();
    }

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
      window.removeEventListener('click', onClick, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    }

    // should this just be applied to the container
    document.body.inert = true;
    cancellationSignal.addEventListener('abort', onCancel);
    window.addEventListener('click', onClick, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
  });
}

export function dragToCreateElement<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
  updateElement: (element: T, point: Point) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      onCancel();
    }

    let el: T | null = null;

    function onPointerDown(event: PointerEvent) {
      el = createElement({ x: event.pageX, y: event.pageY });
      // should be generalize this?
      container.appendChild(el);
    }

    function onPointerMove(event: PointerEvent) {
      if (el === null) return;

      updateElement(el, { x: event.pageX, y: event.pageY });
    }

    function onPointerUp(event: PointerEvent) {
      if (el === null) return;

      updateElement(el, { x: event.pageX, y: event.pageY });
      cleanUp();
      resolve(el);
    }

    function onCancel() {
      cleanUp();
      resolve(null);
    }

    function cleanUp() {
      container.inert = false;
      cancellationSignal.removeEventListener('abort', onCancel);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    }

    document.body.inert = true;
    cancellationSignal.addEventListener('abort', onCancel);
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
  });
}

export function dragToCreateConnection<T extends FolkBaseConnection = FolkBaseConnection>(
  container: Element,
  cancellationSignal: AbortSignal,
  createElement: (point: Point) => T,
): Promise<T | null> {
  return new Promise((resolve) => {});
}
