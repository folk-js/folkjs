import { CanIUse, TransformEvent, Vector } from '@folkjs/canvas';
import { css, type PropertyValues } from '@folkjs/canvas/reactive-element';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

export class FolkSpaceRadial extends FolkBaseSet {
  static override tagName = 'folk-space-radial';
  static override styles = [
    FolkBaseSet.styles,
    css`
      :host {
        border: 2px dashed hsl(214, 84%, 56%);
        border-radius: 50%;
        box-sizing: border-box;
      }

      .center-point {
        position: absolute;
        width: 8px;
        height: 8px;
        background: hsl(214, 84%, 56%);
        border-radius: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        left: 50%;
        top: 50%;
      }
    `,
  ];

  #centerPoint: HTMLDivElement | null = null;

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#centerPoint = document.createElement('div');
    this.#centerPoint.className = 'center-point';
    root.appendChild(this.#centerPoint);

    // Add transform listeners to source elements
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        element.addEventListener('transform', this.#onTransform);
      }
    });

    return root;
  }

  protected override updated(changedProperties: PropertyValues<this>) {
    super.updated(changedProperties);

    // Update transform listeners when source elements change
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        element.addEventListener('transform', (event) => {
          this.#onTransform(event);
          // this.#handleMoveBefore(event);
        });
      }
    });
  }

  #handleMoveBefore(event: Event) {
    if (!CanIUse.moveBefore()) return;

    const shapeElement = event.target as HTMLElement;

    // Calculate the center of the shape
    const shapeBounds = shapeElement.getBoundingClientRect();
    const shapeCenter = {
      x: shapeBounds.left + shapeBounds.width / 2,
      y: shapeBounds.top + shapeBounds.height / 2,
    };

    const bounds = this.getBoundingClientRect();
    const spaceCenter = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };

    // Calculate distance from shape center to circle center
    const distance = Vector.distance(shapeCenter, spaceCenter);

    const circleRadius = bounds.width / 2;
    const isInsideCircle = distance <= circleRadius;
    const isInHost = shapeElement.parentElement === this;

    if (isInsideCircle && !isInHost) {
      (this as any).moveBefore(shapeElement, null);
      // this.#ignoredShapes.delete(shapeElement);
    } else if (!isInsideCircle && isInHost) {
      (document.body as any).moveBefore(shapeElement, null);
      // this.#ignoredShapes.add(shapeElement);
    }
  }

  #onTransform = (event: Event) => {
    if (!(event instanceof TransformEvent)) return;
    const shape = event.target as FolkShape;

    const transform = event.current;

    // Get the center of the radial space
    const bounds = this.getBoundingClientRect();
    const spaceCenter = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };

    // Calculate the absolute position of the rotateOrigin in local space
    const rotateOriginLocal = {
      x: transform.width * transform.rotateOrigin.x,
      y: transform.height * transform.rotateOrigin.y,
    };

    // Convert the local rotateOrigin to parent space
    const rotateOriginParent = transform.toParentSpace(rotateOriginLocal);

    const distance = Vector.distance(rotateOriginParent, spaceCenter);

    // if the shape is outside the circle, don't move it
    // tried using moveBefore, but will leave this here for now
    if (distance > bounds.width / 2) {
      return;
    }

    // Compute vector from space center to rotateOrigin in parent space
    const dx = rotateOriginParent.x - spaceCenter.x;
    const dy = rotateOriginParent.y - spaceCenter.y;

    // Calculate radius and angle
    const radius = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);

    // Update position so that rotateOrigin moves along the circle
    const newRotateOriginParent = {
      x: spaceCenter.x + radius * Math.cos(angle),
      y: spaceCenter.y + radius * Math.sin(angle),
    };

    // Calculate the delta to move the shape so that its rotateOrigin is at the new position
    const deltaX = newRotateOriginParent.x - rotateOriginParent.x;
    const deltaY = newRotateOriginParent.y - rotateOriginParent.y;

    // Update transform position
    shape.x += deltaX;
    shape.y += deltaY;

    // Update rotation
    shape.rotation = angle;
  };

  override disconnectedCallback() {
    super.disconnectedCallback();
    // Clean up event listeners
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        element.removeEventListener('transform', this.#onTransform);
      }
    });
  }
}
