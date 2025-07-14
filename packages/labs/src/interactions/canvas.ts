import { selectElement } from './dom-selection';

export async function mergeShapesByClick(
  cancellationSignal: AbortSignal,
  container: HTMLElement,
): Promise<HTMLElement | null> {
  const el1 = await selectElement(cancellationSignal, document.documentElement, (el) =>
    el.shape === undefined ? null : el,
  );
  const el2 = await selectElement(cancellationSignal, document.documentElement, (el) =>
    el.shape === undefined || el === el1 ? null : el,
  );

  if (el1 === null || el2 === null) return null;

  const shape = el1.shape!;
  const section = document.createElement('section');
  section.setAttribute('folk-shape', `x: ${shape.x}; y: ${shape.y}`);
  // TODO: there is a bug where removing the attributes after appending them to the section fails
  // I think it's because weak map losses their reference?
  el1.removeAttribute('folk-shape');
  el2.removeAttribute('folk-shape');
  section.append(el1, el2);

  container.appendChild(section);

  return section;
}
