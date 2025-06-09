import { css } from '@folkjs/dom/tags';
import { selectDOMElement } from './dom-selection';

const styles = css`
  body:has([folk-selected-element]) {
    cursor: default !important;
  }

  [folk-selected-element] {
    outline: solid 1px blue !important;
    cursor: pointer !important;
  }
`;

export function selectDOMElements(
  completionSignal: AbortSignal,
  cancellationSignal: AbortSignal,
  filter?: (el: Element) => Element | null,
) {
  return new Promise<Element[]>(async (resolve) => {
    const elements: Element[] = [];

    function onCancel() {
      cleanUp();
      resolve([]);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      onCancel();
    }

    function onComplete() {
      resolve(elements);
      cleanUp();
    }

    function cleanUp() {
      completionSignal.removeEventListener('abort', onComplete);
      cancellationSignal.removeEventListener('abort', onCancel);
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      elements.forEach((el) => el.removeAttribute('folk-selected-element'));
      document.adoptedStyleSheets.splice(document.adoptedStyleSheets.indexOf(styles), 1);
    }

    completionSignal.addEventListener('abort', onComplete);
    cancellationSignal.addEventListener('abort', onCancel);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    document.adoptedStyleSheets.push(styles);

    const selectionFilter = (el: Element) => {
      if (elements.includes(el)) return null;

      return filter !== undefined ? filter(el) : el;
    };

    const signal = AbortSignal.any([completionSignal, cancellationSignal]);

    while (!(completionSignal.aborted || cancellationSignal.aborted)) {
      const el = await selectDOMElement(signal, selectionFilter);

      if (el) {
        el.setAttribute('folk-selected-element', '');
        elements.push(el);
      }
    }
  });
}
