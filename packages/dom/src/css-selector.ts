// Ported from firefox dev tools: https://github.com/mozilla/gecko-dev/blob/5f29a6d696276d03836c7b94d81e8d3b57f2969d/devtools/shared/inspector/css-logic.js#L586
function getElementIndex(element: Element): number {
  let count = 0;

  while ((element = element.previousElementSibling!)) {
    count += 1;
  }

  return count;
}

function isSelectorUnique(selector: string): boolean {
  return document.querySelectorAll(selector).length === 1;
}

/**
 * Find a unique CSS selector for a given element
 * @returns a string such that:
 *   - document.querySelector(selector) === el
 *   - document.querySelectorAll(selector).length === 1
 */
export function findCssSelector(el: Element): string {
  if (el.id) {
    const id = '#' + CSS.escape(el.id);

    // Check that the id is unique.
    if (id && isSelectorUnique(id)) return id;
  }

  const tagName = CSS.escape(el.localName);

  // Inherently unique by tag name
  if (tagName === 'html' || tagName === 'head' || tagName === 'body') return tagName;

  let selector;
  // We might be able to find a unique class name
  for (let i = 0; i < el.classList.length; i++) {
    // Is this className unique by itself?
    selector = '.' + CSS.escape(el.classList.item(i)!);
    if (isSelectorUnique(selector)) return selector;

    // Maybe it's unique with a tag name?
    selector = tagName + selector;
    if (isSelectorUnique(selector)) return selector;

    // Maybe it's unique using a tag name and nth-child?
    selector = `${selector}:nth-child(${getElementIndex(el) + 1})`;
    if (isSelectorUnique(selector)) return selector;
  }

  // No guarantee of uniqueness so append unique parent selector
  selector = `${tagName}:nth-child(${getElementIndex(el) + 1})`;

  if (el.parentElement) {
    selector = findCssSelector(el.parentElement) + ' > ' + selector;
  }

  return selector;
}
