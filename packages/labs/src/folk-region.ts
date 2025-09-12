import { css, ReactiveElement } from '@folkjs/dom/ReactiveElement';
import * as R from '@folkjs/geometry/Rect2D';
import type { Shape2DObject, TransformEvent } from './shape-events';

export class FolkRegion extends ReactiveElement {
  static override tagName = 'folk-region';

  static override styles = css`
    :host {
      background-color: oklch(87% 0.065 274.039);
      box-shadow:
        inset 0 2px 4px color-mix(in oklab, oklch(58.5% 0.233 277.117) 100%, transparent),
        0 0 #0000,
        0 0 #0000,
        0 0 #0000,
        0 0 #0000;
    }
  `;

  #slot = document.createElement('slot');

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.appendChild(this.#slot);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    this.parentElement!.addEventListener('transform', this.#onTransform);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    this.parentElement!.removeEventListener('transform', this.#onTransform);
  }

  #onTransform = (event: TransformEvent) => {
    const el = event.target as Element;

    if (this === el || this.shape === undefined || el.shape === undefined) return;

    const overlap = R.overlap(getAbsoluteRectangle(this.shape), getAbsoluteRectangle(el.shape));
    if (this.contains(el) && overlap < 0.49) {
      this.parentElement!.moveBefore!(el, null);

      el.shape!.x += this.shape!.x;
      el.shape!.y += this.shape!.y;
    } else if (!this.contains(el) && overlap > 0.51) {
      this.moveBefore!(el, null);

      el.shape!.x -= this.shape!.x;
      el.shape!.y -= this.shape!.y;
    }
  };
}

function getAbsoluteRectangle(shape: Shape2DObject): R.Rect2D {
  const p0 = shape.transformStack.mapPointToParent({ x: shape.x, y: shape.y });
  const p1 = shape.transformStack.mapPointToParent({ x: shape.right, y: shape.bottom });

  return R.fromPoints(p0, p1);
}
