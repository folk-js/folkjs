import { FolkShapeAttribute } from '@folkjs/labs/folk-shape-attribute';
import { FolkZoomable } from '@folkjs/labs/folk-zoomable';

FolkShapeAttribute.define();
FolkZoomable.define();

document.documentElement.setAttribute('folk-zoomable', '');

document.body.addEventListener('dblclick', (e) => {
  const el = e.target as HTMLElement;
  // don't allow nesting of shapes
  if (el.closest('[folk-shape]') === null && el.querySelector('[folk-shape]') === null) {
    el.setAttribute('folk-shape', `width: ${el.clientWidth}`);
    requestAnimationFrame(() => el.focus());
  }
});
