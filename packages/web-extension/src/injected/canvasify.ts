import '@folkjs/labs/standalone/folk-shape-attribute';
import '@folkjs/labs/standalone/folk-zoomable';

document.body.setAttribute('folk-zoomable', '');

document.body.addEventListener('dblclick', (e) => {
  const el = e.target as HTMLElement;
  // don't allow nesting of shapes
  if (el.closest('[folk-shape]') === null && el.querySelector('[folk-shape]') === null) {
    el.setAttribute('folk-shape', `width: ${el.clientWidth}`);
    requestAnimationFrame(() => el.focus());
  }
});
