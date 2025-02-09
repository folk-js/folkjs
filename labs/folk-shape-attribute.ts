import {
  CustomAttribute,
  customAttributes,
  DOMRectTransform,
  Matrix,
  Point,
  ResizeManager,
  toDOMPrecision,
  TransformEvent,
} from '@lib';
import { css } from '@lib/tags';
import { FolkShapeOverlay } from './folk-shape-overlay';

declare global {
  interface Element {
    getShape(): FolkShapeAttribute | undefined;
  }
}

Element.prototype.getShape = function getShape() {
  return customAttributes.get(this, 'folk-shape') as FolkShapeAttribute | undefined;
};

const resizeManager = new ResizeManager();

export class FolkShapeAttribute extends CustomAttribute {
  static attributeName = 'folk-shape';

  static define() {
    FolkShapeOverlay.define();
    super.define();
  }

  static #overlay = document.createElement('folk-shape-overlay');

  static styles = css`
    [folk-shape] {
      box-sizing: border-box;
      cursor: move;
      inset: 0 auto auto 0;
      margin: 0;
      overflow: scroll;
      transform-origin: center center;
    }
  `;

  static {
    // TODO: detect how to inject styles into shadowroot
    document.adoptedStyleSheets.push(this.styles);
    document.documentElement.appendChild(this.#overlay);
  }

  #autoPosition = false;
  #autoHeight = false;
  #autoWidth = false;
  #previousRect = new DOMRectTransform();
  #rect = new DOMRectTransform();

  get x(): number {
    return this.#rect.x;
  }
  set x(value: number) {
    if (this.#autoPosition) {
      this.autoPosition = false;
    }
    this.#previousRect.x = this.#rect.x;
    this.#rect.x = value;
    this.#requestUpdate();
  }

  get y(): number {
    return this.#rect.y;
  }
  set y(value: number) {
    if (this.#autoPosition) {
      this.autoPosition = false;
    }
    this.#previousRect.y = this.#rect.y;
    this.#rect.y = value;
    this.#requestUpdate();
  }

  get autoPosition(): boolean {
    return this.autoPosition;
  }
  set autoPosition(value: boolean) {
    if (value === this.#autoPosition) return;

    this.#autoPosition = value;

    if (this.#autoPosition) {
      // TODO: we need to observe changes to this position.
      const rect = this.ownerElement.getBoundingClientRect();

      this.#rect.x = rect.x;
      this.#rect.y = rect.y;
    }

    this.#requestUpdate();
  }

  get width(): number {
    return this.#rect.width;
  }
  set width(value: number) {
    if (this.#autoWidth) {
      this.autoWidth = false;
    }
    this.#previousRect.width = this.#rect.width;
    this.#rect.width = value;
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
  }

  get height(): number {
    return this.#rect.height;
  }
  set height(value: number) {
    if (this.#autoHeight) {
      this.autoHeight = false;
    }
    this.#previousRect.height = this.#rect.height;
    this.#rect.height = value;
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
  }

  get rotation(): number {
    return this.#rect.rotation;
  }
  set rotation(value: number) {
    this.#previousRect.rotation = this.#rect.rotation;
    this.#rect.rotation = value;
    this.#requestUpdate();
  }

  get transformOrigin(): Point {
    return this.#rect.transformOrigin;
  }
  set transformOrigin(value: Point) {
    this.#previousRect.transformOrigin = this.#rect.transformOrigin;
    this.#rect.transformOrigin = value;
    this.#requestUpdate();
  }

  get rotateOrigin(): Point {
    return this.#rect.rotateOrigin;
  }
  set rotateOrigin(value: Point) {
    this.#previousRect.rotateOrigin = this.#rect.rotateOrigin;
    this.#rect.rotateOrigin = value;
    this.#requestUpdate();
  }

  get left(): number {
    return this.#rect.left;
  }

  get top(): number {
    return this.#rect.top;
  }

  get right(): number {
    return this.#rect.right;
  }

  get bottom(): number {
    return this.#rect.bottom;
  }

  get transformMatrix(): Matrix {
    return this.#rect.transformMatrix;
  }

  get inverseMatrix(): Matrix {
    return this.#rect.inverseMatrix;
  }

  get topLeft(): Point {
    return this.#rect.topLeft;
  }
  set topLeft(point: Point) {
    throw new Error('Method not implemented.');
  }

  get topRight(): Point {
    return this.#rect.topRight;
  }
  set topRight(point: Point) {
    throw new Error('Method not implemented.');
  }

  get bottomRight(): Point {
    return this.#rect.bottomRight;
  }
  set bottomRight(point: Point) {
    throw new Error('Method not implemented.');
  }

  get bottomLeft(): Point {
    return this.#rect.bottomLeft;
  }
  set bottomLeft(point: Point) {
    throw new Error('Method not implemented.');
  }

  get center(): Point {
    return this.#rect.center;
  }

  #shapeOverlay = (this.constructor as typeof FolkShapeAttribute).#overlay;

  toLocalSpace(point: Point): Point {
    return this.#rect.toLocalSpace(point);
  }

  toParentSpace(point: Point): Point {
    return this.#rect.toParentSpace(point);
  }

  vertices(): Point[] {
    return this.#rect.vertices();
  }

  toCssString(): string {
    return this.#rect.toCssString();
  }

  toJSON(): { x: number; y: number; width: number; height: number; rotation: number } {
    return this.#rect.toJSON();
  }

  getBounds(): DOMRectInit {
    return this.#rect.getBounds();
  }

  connectedCallback(): void {
    const el = this.ownerElement as HTMLElement;

    // We need to make this element focusable if it isn't already
    if (el.tabIndex === -1) {
      el.tabIndex = 0;
    }

    el.addEventListener('focus', this);
    el.addEventListener('blur', this);
  }

  #ignoreAttributeChange = false;

  changedCallback(_oldValue: string, newValue: string): void {
    if (this.#ignoreAttributeChange) {
      this.#ignoreAttributeChange = false;
    }

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

  disconnectedCallback(): void {
    const el = this.ownerElement as HTMLElement;

    el.removeEventListener('focus', this);
    el.removeEventListener('blur', this);

    el.style.setProperty('translate', '');
    el.style.setProperty('height', '');
    el.style.setProperty('width', '');
    el.style.setProperty('rotate', '');

    if (this.#autoHeight || this.#autoWidth) {
      resizeManager.unobserve(el, this.#onResize);
    }
  }

  handleEvent(event: Event) {
    // If someone is tabbing backwards and hits an element with a shadow DOM, we cant tell the difference between is that element is focused of if something in it is.
    if (event.type === 'focus') {
      this.#shapeOverlay.open(this);
    } else if (event.type === 'blur') {
      if (this.#shapeOverlay.isOpen) {
        this.#shapeOverlay.close();
      }
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

    const event = new TransformEvent(new DOMRectTransform(this.#rect), this.#previousRect);

    el.dispatchEvent(event);

    if (event.xPrevented) {
      this.#rect.x = this.#previousRect.x;
    }
    if (event.yPrevented) {
      this.#rect.y = this.#previousRect.y;
    }
    if (event.widthPrevented) {
      this.#rect.width = this.#previousRect.width;
    }
    if (event.heightPrevented) {
      this.#rect.height = this.#previousRect.height;
    }
    if (event.rotationPrevented) {
      this.#rect.rotation = this.#previousRect.rotation;
    }

    el.style.setProperty('position', this.#autoPosition ? '' : 'absolute');
    el.style.setProperty(
      'translate',
      this.#autoPosition ? '' : toDOMPrecision(this.#rect.x) + 'px ' + toDOMPrecision(this.#rect.y) + 'px',
    );
    el.style.setProperty('height', this.#autoHeight ? '' : toDOMPrecision(this.#rect.height) + 'px');
    el.style.setProperty('width', this.#autoWidth ? '' : toDOMPrecision(this.#rect.width) + 'px');
    el.style.setProperty('rotate', this.#rect.rotation === 0 ? '' : toDOMPrecision(this.#rect.rotation) + 'rad');

    this.value = (
      (this.#autoPosition ? '' : `x: ${this.#rect.x}; y: ${this.#rect.y}; `) +
      (this.#autoWidth ? '' : `width: ${this.#rect.y}; `) +
      (this.#autoHeight ? '' : `height: ${this.#rect.y}; `) +
      (this.#rect.rotation === 0 ? '' : `rotation: ${this.#rect.x};`)
    ).trim();
    // We don't need this reflection to cause another update.
    this.#ignoreAttributeChange = true;
  }

  #onResize = (entry: ResizeObserverEntry) => {
    const rect = entry.borderBoxSize[0];

    if (rect === undefined) return;

    if (this.#autoHeight) {
      this.#previousRect.height = this.#rect.height;
      this.#rect.height = rect.blockSize;
    }

    if (this.#autoWidth) {
      this.#previousRect.width = this.#rect.width;
      this.#rect.width = rect.inlineSize;
    }

    this.#update();
  };
}
