import { FolkShapeAttribute } from '@labs/folk-shape-attribute.ts';

FolkShapeAttribute.define();

let el = document.body.firstElementChild?.firstElementChild;

while (el) {
  el.setAttribute('folk-shape', '');
  el = el.nextElementSibling;
}
