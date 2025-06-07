import { css } from '@folkjs/dom/tags';

const styles = css`
  body:has([folk-hovered-element]) {
    cursor: default !important;
  }

  [folk-hovered-element] {
    outline: solid 1px blue !important;
    cursor: pointer !important;
  }
`;

export function selectDOMElement(signal: AbortSignal, selectorFilter: string = '*'): Promise<Element> {
  document.adoptedStyleSheets.push(styles);

  const { resolve, reject, promise } = Promise.withResolvers<Element>();

  let el: HTMLElement | null = null;

  function onPointerOver(event: PointerEvent) {
    el?.removeAttribute('folk-hovered-element');
    el = (event.target as HTMLElement).closest(selectorFilter);
    el?.setAttribute('folk-hovered-element', '');
  }

  function cleanUp() {
    el?.removeAttribute('folk-hovered-element');
    signal.removeEventListener('abort', onAbort);
    window.removeEventListener('pointerover', onPointerOver, { capture: true });
    window.removeEventListener('click', onSelection, { capture: true });
    document.adoptedStyleSheets.splice(document.adoptedStyleSheets.indexOf(styles), 1);
  }

  function onAbort() {
    cleanUp();
    reject(new DOMException(signal.reason || 'signal is aborted without reason', 'AbortError'));
  }

  function onSelection(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    cleanUp();
    resolve(event.target);
  }

  signal.addEventListener('abort', onAbort);
  window.addEventListener('pointerover', onPointerOver, { capture: true });
  window.addEventListener('click', onSelection, { capture: true });

  return promise;
}
