const styles = new CSSStyleSheet();
styles.replaceSync(`
  html:has([folk-hovered-element]) * {
    cursor: default;
  }

  [folk-hovered-element] {
    outline: solid 1px blue !important;
    outline-offset: -1px;
  }

  [folk-hovered-element],
  [folk-hovered-element] * {
    cursor: pointer !important;
  }
`);

export function selectElement<T extends Element = Element>(
  cancellationSignal: AbortSignal,
  container: HTMLElement | DocumentOrShadowRoot = document.documentElement,
  filter?: (el: Element) => T | null,
) {
  const containerDocument = container instanceof HTMLElement ? container.ownerDocument : container;

  return new Promise<T | null>((resolve) => {
    let el: Element | null = null;

    function onPointerOver(event: PointerEvent) {
      if (event.target === container) return;

      el?.removeAttribute('folk-hovered-element');
      if (filter !== undefined) {
        el = filter(event.target as T);
      } else {
        el = event.target as Element;
      }
      el?.setAttribute('folk-hovered-element', '');
    }

    function onPointerLeave(event: PointerEvent) {
      if (event.target === el) {
        el?.removeAttribute('folk-hovered-element');
      }
    }

    function onCancel() {
      cleanUp();
      resolve(null);
    }

    // Prevent focus from being received
    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }

    function onSelection(event: MouseEvent) {
      if (event.target === container) return;

      if (filter !== undefined) {
        const el = filter(event.target as T);

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
        resolve(event.target as T);
      }
    }

    function cleanUp() {
      el?.removeAttribute('folk-hovered-element');
      cancellationSignal.removeEventListener('abort', onCancel);
      (container as HTMLElement).removeEventListener('pointerdown', onPointerDown, { capture: true });
      (container as HTMLElement).removeEventListener('pointerover', onPointerOver, { capture: true });
      (container as HTMLElement).removeEventListener('pointerleave', onPointerLeave, { capture: true });
      (container as HTMLElement).removeEventListener('click', onSelection, { capture: true });
      containerDocument.adoptedStyleSheets.splice(containerDocument.adoptedStyleSheets.indexOf(styles), 1);
    }

    cancellationSignal.addEventListener('abort', onCancel);
    (container as HTMLElement).addEventListener('pointerdown', onPointerDown, { capture: true });
    (container as HTMLElement).addEventListener('pointerover', onPointerOver, { capture: true });
    (container as HTMLElement).addEventListener('pointerleave', onPointerLeave, { capture: true });
    (container as HTMLElement).addEventListener('click', onSelection, { capture: true });
    containerDocument.adoptedStyleSheets.push(styles);
  });
}
