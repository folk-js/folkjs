import { videoFrameToImage } from '../utils/video';

const styles = new CSSStyleSheet();
styles.replaceSync(`
  html:has([folk-placing-element]) * {
    cursor: grabbing !important;
  }

  [folk-placing-element] {
    opacity: 0.65;
  }
`);

export function dragImageOutOfVideoFrame(
  cancellationSignal: AbortSignal,
  container: HTMLElement = document.body,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let figure: HTMLElement | null = null;

    function onPointerDown(event: PointerEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!(event.target instanceof HTMLVideoElement)) return;

      const x = event.target.offsetLeft;
      const y = event.target.offsetTop;

      figure = document.createElement('figure');
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = event.target.currentTime.toString();
      const image = videoFrameToImage(event.target);
      figure.append(image, figcaption);

      figure.setAttribute('folk-placing-element', '');
      figure.setAttribute('folk-shape', `x: ${x}; y: ${y}`);

      container.appendChild(figure);
      container.addEventListener('pointermove', onPointerMove, { capture: true });
      container.addEventListener('pointerup', onPointerUp, { capture: true });
    }

    function onPointerMove(event: PointerEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const shape = figure?.shape;
      if (shape === undefined) return;

      const parentPoint = shape.transformStack.mapPointToParent({ x: shape.x, y: shape.y });

      const { x, y } = shape.transformStack.mapPointToLocal({
        x: parentPoint.x + event.movementX,
        y: parentPoint.y + event.movementY,
      });

      shape.x = x;
      shape.y = y;
    }

    function onPointerUp(event: PointerEvent) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      cleanUp();

      resolve(figure);
    }

    function onCancel() {
      figure?.remove();
      cleanUp();
      resolve(null);
    }

    function cleanUp() {
      figure?.removeAttribute('folk-placing-element');
      figure = null;
      cancellationSignal.removeEventListener('abort', onCancel);
      container.removeEventListener('pointerdown', onPointerDown, { capture: true });
      container.removeEventListener('pointermove', onPointerMove, { capture: true });
      container.removeEventListener('pointerup', onPointerUp, { capture: true });
      container.ownerDocument.adoptedStyleSheets.splice(container.ownerDocument.adoptedStyleSheets.indexOf(styles), 1);
    }

    cancellationSignal.addEventListener('abort', onCancel);
    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    container.ownerDocument.adoptedStyleSheets.push(styles);
  });
}
