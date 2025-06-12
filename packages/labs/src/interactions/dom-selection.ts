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

export function selectElement(cancellationSignal: AbortSignal, filter?: (el: Element) => Element | null) {
  return new Promise<Element | null>((resolve) => {
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
      if (filter !== undefined) {
        const el = filter(event.target as Element);

        if (el) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          cleanUp();
          resolve(el);
        }
      } else {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
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
  });
}
