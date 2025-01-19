import { FolkElement, Point, Vector } from '@lib';
import { FolkShape } from './folk-shape';
import { FolkSpace, RegisterSpaceEvent, UnregisterSpaceEvent } from './utils/space';

declare global {
  interface HTMLElementTagNameMap {
    'folk-fisheye-space': FolkFisheyeSpace;
  }
}

export class FolkFisheyeSpace extends FolkElement implements FolkSpace {
  static tagName = 'folk-fisheye-space';

  #elements = new Set<FolkShape>();

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.addEventListener('register-space', this);
    this.addEventListener('unregister-space', this);
    this.addEventListener('pointermove', this);

    root.appendChild(document.createElement('slot'));

    return root;
  }

  handleEvent(event: Event) {
    if (event instanceof RegisterSpaceEvent && event.target instanceof FolkShape) {
      this.#elements.add(event.target);
    } else if (event instanceof UnregisterSpaceEvent && event.target instanceof FolkShape) {
      event.target.style.scale = '';
      event.target.style.transform = '';
      this.#elements.delete(event.target);
    } else if (event instanceof PointerEvent && event.type === 'pointermove') {
      const pointer: Point = { x: event.clientX, y: event.clientY };
      // const fishEyeRect = this.getBoundingClientRect();
      this.#elements.forEach((el) => {
        const rect = el.getTransformDOMRect();
        // const currentScale = Number(el.style.scale);
        // const center = Vector.scale(rect.center, currentScale);
        const center = rect.center;
        const distance = Vector.distance(pointer, center);
        const scale = 10000 / (distance + 75) ** 2;
        el.style.scale = scale.toString();
      });
    }
  }

  transformPoint(point: Point): Point {
    return { x: 0, y: 0 };
  }

  elementsFromPoint(point: Point): Element[] {
    return [];
  }

  elementsFromRect(rect: DOMRectReadOnly): Element[] {
    return [];
  }
}
