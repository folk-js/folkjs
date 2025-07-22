import { TransformStack } from '@folkjs/canvas';
import { CustomAttribute, customAttributes } from '@folkjs/dom/CustomAttribute';
import { ResizeManager } from '@folkjs/dom/ResizeManger';
import { css } from '@folkjs/dom/tags';
import * as S from '@folkjs/geometry/Shape2D';
import type { Vector2 } from '@folkjs/geometry/Vector2';
import { toDOMPrecision } from '@folkjs/geometry/utilities';
import { FolkShapeOverlay } from './folk-shape-overlay';
import { ShapeConnectedEvent, ShapeDisconnectedEvent, TransformEvent, type Shape2DObject } from './shape-events';

declare global {
  interface Element {
    shape: FolkShapeAttribute | undefined;
  }
}

const resizeManager = new ResizeManager();

// TODO: if an auto position/size is defined as a style then we should probably save it and set it back
export class FolkShapeAttribute extends CustomAttribute implements Shape2DObject {
  static override attributeName = 'folk-shape';

  static override define() {
    if (!customAttributes.isDefined(this.attributeName)) {
      FolkShapeOverlay.define();

      Object.defineProperty(Element.prototype, 'shape', {
        get() {
          return customAttributes.get(this, FolkShapeAttribute.attributeName) as FolkShapeAttribute | undefined;
        },
      });
    }

    super.define();
  }

  static #overlay = document.createElement('folk-shape-overlay');

  static styles = css`
    @layer folk {
      [folk-shape] {
        box-sizing: border-box;
        position: relative;
        overflow: scroll;
        transform-origin: center center;
        rotate: var(--folk-rotation);
        outline: none;
      }

      [folk-shape*='x:'][folk-shape*='y:'] {
        position: absolute;
        left: var(--folk-x) !important;
        top: var(--folk-y) !important;
        margin: 0;
      }

      [folk-shape*='width:'] {
        width: var(--folk-width) !important;
      }

      [folk-shape*='height:'] {
        height: var(--folk-height) !important;
      }
    }
  `;

  static {
    // TODO: detect how to inject styles into shadowroot
    document.adoptedStyleSheets.push(this.styles);
  }

  #autoPosition = false;
  #autoHeight = false;
  #autoWidth = false;
  #previousShape = S.fromValues();
  #shape = S.fromValues();

  get x(): number {
    return this.#shape.x;
  }
  set x(value: number) {
    this.autoPosition = false;
    this.#previousShape.x = this.#shape.x;
    this.#shape.x = value;
    this.#requestUpdate();
  }

  get y(): number {
    return this.#shape.y;
  }
  set y(value: number) {
    this.autoPosition = false;
    this.#previousShape.y = this.#shape.y;
    this.#shape.y = value;
    this.#requestUpdate();
  }

  get autoPosition(): boolean {
    return this.#autoPosition;
  }
  set autoPosition(value: boolean) {
    if (value === this.#autoPosition) return;

    this.#autoPosition = value;

    if (this.#autoPosition) {
      const el = this.ownerElement as HTMLElement;
      el.style.display = '';
      this.#previousShape.x = this.#shape.x;
      this.#previousShape.y = this.#shape.y;
      // we need to update the attribute to cause a relayout
      this.#updateValue();
      this.#shape.x = el.offsetLeft;
      this.#shape.y = el.offsetTop;

      // Inline elements dont work with the
      if (this.#autoWidth) {
        this.#shape.width = el.offsetWidth;
      }

      if (this.#autoHeight) {
        this.#shape.height = el.offsetHeight;
      }

      this.#requestUpdate();
    } else if (getComputedStyle(this.ownerElement).display === 'inline') {
      (this.ownerElement as HTMLElement).style.display = 'inline-block';
    }
  }

  get width(): number {
    return this.#shape.width;
  }
  set width(value: number) {
    this.autoWidth = false;
    // this.#previousRect.width = this.#shape.width;
    this.#shape.width = value;
    this.#requestUpdate();
  }

  get autoWidth(): boolean {
    return this.#autoWidth;
  }
  set autoWidth(value: boolean) {
    if (value === this.#autoWidth) return;

    this.#autoWidth = value;

    if (this.#autoWidth && !this.#autoHeight) {
      resizeManager.observe(this.ownerElement, this.#onResize);
    } else if (!this.#autoWidth && !this.#autoHeight) {
      resizeManager.unobserve(this.ownerElement, this.#onResize);
    }

    if (this.#autoWidth) {
      const el = this.ownerElement as HTMLElement;
      el.style.width = '';
      this.#previousShape.width = this.#shape.width;
      this.#shape.width = el.offsetWidth;
      this.#requestUpdate();
    }
  }

  get height(): number {
    return this.#shape.height;
  }
  set height(value: number) {
    this.autoHeight = false;
    this.#previousShape.height = this.#shape.height;
    this.#shape.height = value;
    this.#requestUpdate();
  }

  get autoHeight(): boolean {
    return this.#autoHeight;
  }
  set autoHeight(value: boolean) {
    if (value === this.#autoHeight) return;

    this.#autoHeight = value;

    if (this.#autoHeight && !this.#autoWidth) {
      resizeManager.observe(this.ownerElement, this.#onResize);
    } else if (!this.#autoHeight && !this.#autoWidth) {
      resizeManager.unobserve(this.ownerElement, this.#onResize);
    }

    if (this.#autoHeight) {
      const el = this.ownerElement as HTMLElement;
      el.style.height = '';
      this.#previousShape.height = this.#shape.height;
      this.#shape.height = el.offsetWidth;
      this.#requestUpdate();
    }
  }

  get rotation(): number {
    return this.#shape.rotation;
  }
  set rotation(value: number) {
    this.#previousShape.rotation = this.#shape.rotation;
    this.#shape.rotation = value;
    this.#requestUpdate();
  }

  get top() {
    return this.y;
  }

  set top(value) {
    this.y = value;
  }

  get right() {
    return this.x + this.width;
  }

  set right(value) {
    this.width = value - this.x;
  }

  get bottom() {
    return this.y + this.height;
  }

  set bottom(value) {
    this.height = value - this.y;
  }

  get left() {
    return this.x;
  }

  set left(value) {
    this.x = value;
  }

  get vertices() {
    return this.#shape.vertices;
  }

  get topLeft(): Vector2 {
    return S.topLeftCorner(this.#shape);
  }

  set topLeft(point: Vector2) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    S.copy(this.#shape, this.#previousShape);
    S.setTopLeftCorner(this.#shape, point);
    this.#requestUpdate();
  }

  get topRight(): Vector2 {
    return S.topRightCorner(this.#shape);
  }
  set topRight(point: Vector2) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    S.copy(this.#shape, this.#previousShape);
    S.setTopRightCorner(this.#shape, point);
    this.#requestUpdate();
  }

  get bottomRight(): Vector2 {
    return S.bottomRightCorner(this.#shape);
  }
  set bottomRight(point: Vector2) {
    this.autoWidth = false;
    this.autoHeight = false;
    S.copy(this.#shape, this.#previousShape);
    S.setBottomRightCorner(this.#shape, point);
    this.#requestUpdate();
  }

  get bottomLeft(): Vector2 {
    return S.bottomLeftCorner(this.#shape);
  }
  set bottomLeft(point: Vector2) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    S.copy(this.#shape, this.#previousShape);
    S.setBottomLeftCorner(this.#shape, point);
    this.#requestUpdate();
  }

  get center(): Vector2 {
    return S.center(this.#shape);
  }

  #shapeOverlay = (this.constructor as typeof FolkShapeAttribute).#overlay;

  get bounds() {
    return S.boundingBox(this.#shape);
  }

  #transformStack = new TransformStack();

  get transformStack() {
    return this.#transformStack;
  }

  override connectedCallback(): void {
    const el = this.ownerElement as HTMLElement;

    el.addEventListener('focus', this);
    el.addEventListener('blur', this);

    // We need to make this element focusable if it isn't already
    // Edge case: <video> tabIndex property is 0, but we need a tab index attribute to focus it.
    if (!el.hasAttribute('tab-index')) {
      el.tabIndex = 0;
    }

    const event = new ShapeConnectedEvent(this);
    this.ownerElement.dispatchEvent(event);
    this.#transformStack = new TransformStack(event.spaces);
  }

  override changedCallback(_oldValue: string, newValue: string): void {
    let autoX = true;
    let autoY = true;
    let autoHeight = true;
    let autoWidth = true;

    for (const property of newValue.split(';')) {
      const [name, value] = property.split(':').map((str) => str.trim());
      const parsedValue = Number(value);

      if (
        !Number.isNaN(parsedValue) &&
        (name === 'x' || name === 'y' || name === 'width' || name === 'height' || name === 'rotation')
      ) {
        if (name === 'height') {
          autoHeight = false;
        } else if (name === 'width') {
          autoWidth = false;
        } else if (name === 'x') {
          autoX = false;
        } else if (name === 'y') {
          autoY = false;
        }
        this[name] = parsedValue;
      }
    }

    if (autoX && !autoY) {
      this.x = 0;
    }

    if (autoY && !autoX) {
      this.y = 0;
    }

    this.autoPosition = autoX || autoY;
    this.autoHeight = autoHeight;
    this.autoWidth = autoWidth;
  }

  override disconnectedCallback(): void {
    const el = this.ownerElement as HTMLElement;

    if (document.activeElement === el) {
      this.#shapeOverlay.close();
      el.blur();
    }

    el.removeEventListener('focus', this);
    el.removeEventListener('blur', this);

    if (this.#autoHeight || this.#autoWidth) {
      resizeManager.unobserve(el, this.#onResize);
    }

    el.style.removeProperty('--folk-x');
    el.style.removeProperty('--folk-y');
    el.style.removeProperty('--folk-height');
    el.style.removeProperty('--folk-width');
    el.style.removeProperty('--folk-rotation');

    this.ownerElement.dispatchEvent(new ShapeDisconnectedEvent(this));
    this.#transformStack = new TransformStack();
  }

  handleEvent(event: FocusEvent) {
    // If someone is tabbing backwards and hits an element with a shadow DOM, we cant tell the difference between is that element is focused of if something in it is.
    // FIX: Safari doesnt focus audio and video elements from pointer events
    if (event.type === 'focus') {
      // this is a hack until we observe the position changing
      if (this.autoPosition) {
        const el = this.ownerElement as HTMLElement;
        this.#shape.x = el.offsetLeft;
        this.#shape.y = el.offsetTop;
      }
      this.ownerElement.appendChild(this.#shapeOverlay);
      this.#shapeOverlay.open(this, this.ownerElement as HTMLElement);
    } else if (event.type === 'blur' && event.relatedTarget !== this.#shapeOverlay) {
      this.#shapeOverlay.close();
      this.#shapeOverlay.remove();
    }
  }

  #updateRequested = false;

  async #requestUpdate() {
    if (this.#updateRequested) return;

    this.#updateRequested = true;
    await true;
    this.#updateRequested = false;
    this.#update();
  }

  #update() {
    const el = this.ownerElement as HTMLElement;

    const event = new TransformEvent(S.clone(this.#shape), this.#previousShape);

    el.dispatchEvent(event);

    if (event.xPrevented) {
      this.#shape.x = this.#previousShape.x;
    }
    if (event.yPrevented) {
      this.#shape.y = this.#previousShape.y;
    }
    if (event.widthPrevented) {
      this.#shape.width = this.#previousShape.width;
    }
    if (event.heightPrevented) {
      this.#shape.height = this.#previousShape.height;
    }
    if (event.rotationPrevented) {
      this.#shape.rotation = this.#previousShape.rotation;
    }

    el.style.setProperty('--folk-x', toDOMPrecision(this.#shape.x) + 'px');
    el.style.setProperty('--folk-y', toDOMPrecision(this.#shape.y) + 'px');
    el.style.setProperty('--folk-height', toDOMPrecision(this.#shape.height) + 'px');
    el.style.setProperty('--folk-width', toDOMPrecision(this.#shape.width) + 'px');
    el.style.setProperty('--folk-rotation', toDOMPrecision(this.#shape.rotation) + 'rad');

    this.#updateValue();
  }

  #updateValue() {
    this.value = (
      (this.#autoPosition ? '' : `x: ${toDOMPrecision(this.#shape.x)}; y: ${toDOMPrecision(this.#shape.y)}; `) +
      (this.#autoWidth ? '' : `width: ${toDOMPrecision(this.#shape.width)}; `) +
      (this.#autoHeight ? '' : `height: ${toDOMPrecision(this.#shape.height)}; `) +
      (this.#shape.rotation === 0 ? '' : `rotation: ${toDOMPrecision(this.#shape.rotation)};`)
    ).trim();
  }

  #onResize = (entry: ResizeObserverEntry) => {
    let { blockSize: height = 0, inlineSize: width = 0 } = entry.borderBoxSize[0] || {};

    // this is likely a inline element so let's try to use the bounding box
    const el = entry.target as HTMLElement;
    if (height === 0 && width === 0) {
      height = el.offsetHeight;
      width = el.offsetWidth;
    }

    if (this.#autoHeight) {
      this.#previousShape.height = this.#shape.height;
      this.#shape.height = height;
    }

    if (this.#autoWidth) {
      this.#previousShape.width = this.#shape.width;
      this.#shape.width = width;
    }

    // any DOM updates should happen in the next frame
    requestAnimationFrame(() => this.#update());
  };
}
