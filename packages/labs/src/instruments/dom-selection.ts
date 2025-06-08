import { css } from '@folkjs/dom/tags';

const styles = css`
  html:has([folk-hovered-element]) * {
    cursor: default;
  }

  [folk-hovered-element] {
    outline: solid 1px blue !important;
  }

  [folk-hovered-element],
  [folk-hovered-element] * {
    cursor: pointer !important;
  }
`;

export function selectDOMElement(cancellationSignal: AbortSignal, filter?: (el: Element) => Element | null) {
  const { resolve, promise } = Promise.withResolvers<Element | null>();

  let el: Element | null = null;

  function onPointerOver(event: PointerEvent) {
    el?.removeAttribute('folk-hovered-element');
    if (filter !== undefined) {
      el = filter(event.target as Element);
    } else {
      el = event.target as Element;
    }
    el?.setAttribute('folk-hovered-element', '');
  }

  function onCancel() {
    cleanUp();
    resolve(null);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    onCancel();
  }

  function onSelection(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (filter !== undefined) {
      const el = filter(event.target as Element);

      if (el) {
        cleanUp();
        resolve(el);
      }
    } else {
      cleanUp();
      resolve(event.target as Element);
    }
  }

  function cleanUp() {
    el?.removeAttribute('folk-hovered-element');
    cancellationSignal.removeEventListener('abort', onCancel);
    window.removeEventListener('pointerover', onPointerOver, { capture: true });
    window.removeEventListener('click', onSelection, { capture: true });
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    document.adoptedStyleSheets.splice(document.adoptedStyleSheets.indexOf(styles), 1);
  }

  cancellationSignal.addEventListener('abort', onCancel);
  window.addEventListener('pointerover', onPointerOver, { capture: true });
  window.addEventListener('click', onSelection, { capture: true });
  window.addEventListener('keydown', onKeyDown, { capture: true });
  document.adoptedStyleSheets.push(styles);

  return promise;
}
