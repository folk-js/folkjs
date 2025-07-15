import { selectElement } from './dom-selection';

export async function deleteElementByClick<T extends Element = Element>(
  container: HTMLElement,
  cancellationSignal: AbortSignal,
  filter?: (el: Element) => T | null,
): Promise<T | null> {
  const el = await selectElement(cancellationSignal, container, filter);

  el?.remove();

  return el;
}

export async function deleteElementsByDragging(cancellationSignal: AbortSignal) {}
