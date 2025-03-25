import {
  css,
  CustomAttribute,
  customAttributes,
  DOMRectTransform,
  Matrix,
  type Point,
  ResizeManager,
  toDOMPrecision,
  TransformEvent,
} from '@folkjs/canvas';
import { FolkShapeOverlay } from './folk-shape-overlay';

declare global {
  interface Element {
    shape: FolkShapeAttribute | undefined;
  }
}

Object.defineProperty(Element.prototype, 'shape', {
  get() {
    return customAttributes.get(this, FolkShapeAttribute.attributeName) as FolkShapeAttribute | undefined;
  },
});

const resizeManager = new ResizeManager();

interface Space {}

export class ShapeConnectedEvent extends Event {
  #spaces: Space[] = [];

  get spaces() {
    return this.#spaces;
  }

  #shape;

  get shape() {
    return this.#shape;
  }

  constructor(shape: FolkShapeAttribute) {
    super('shape-connected', { bubbles: true });

    this.#shape = shape;
  }

  registerSpace(space: Space) {
    this.#spaces.unshift(space);
  }
}

export class ShapeDisconnectedEvent extends Event {
  #shape;

  get shape() {
    return this.#shape;
  }

  constructor(shape: FolkShapeAttribute) {
    super('shape-disconnected', { bubbles: true });

    this.#shape = shape;
  }
}

declare global {
  interface ElementEventMap {
    'shape-connected': ShapeConnectedEvent;
    'shape-disconnected': ShapeDisconnectedEvent;
  }
}

// TODO: if an auto position/size is defined as a style then we should probably save it and set it back
export class FolkShapeAttribute extends CustomAttribute {
  static override attributeName = 'folk-shape';

  static override define() {
    FolkShapeOverlay.define();
    super.define();
  }

  static #overlay = document.createElement('folk-shape-overlay');

  static styles = css`
    @layer folk {
      [folk-shape] {
        box-sizing: border-box;
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
    this.autoPosition = false;
    this.#previousRect.x = this.#rect.x;
    this.#rect.x = value;
    this.#requestUpdate();
  }

  get y(): number {
    return this.#rect.y;
  }
  set y(value: number) {
    this.autoPosition = false;
    this.#previousRect.y = this.#rect.y;
    this.#rect.y = value;
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
      this.#previousRect.x = this.#rect.x;
      this.#previousRect.y = this.#rect.y;
      // this is broken, we need update the attribute value and relayout before we can apply these values
      this.#rect.x = el.offsetLeft;
      this.#rect.y = el.offsetTop;

      // Inline elements dont work with the
      if (this.#autoWidth) {
        this.#rect.width = el.offsetWidth;
      }

      if (this.#autoHeight) {
        this.#rect.height = el.offsetHeight;
      }

      this.#requestUpdate();
    } else if (getComputedStyle(this.ownerElement).display === 'inline') {
      (this.ownerElement as HTMLElement).style.display = 'inline-block';
    }
  }

  get width(): number {
    return this.#rect.width;
  }
  set width(value: number) {
    this.autoWidth = false;
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

    if (this.#autoWidth) {
      const el = this.ownerElement as HTMLElement;
      el.style.width = '';
      this.#previousRect.width = this.#rect.width;
      this.#rect.width = el.offsetWidth;
      this.#requestUpdate();
    }
  }

  get height(): number {
    return this.#rect.height;
  }
  set height(value: number) {
    this.autoHeight = false;
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

    if (this.#autoHeight) {
      const el = this.ownerElement as HTMLElement;
      el.style.height = '';
      this.#previousRect.height = this.#rect.height;
      this.#rect.height = el.offsetWidth;
      this.#requestUpdate();
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
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    this.#previousRect.topLeft = this.#rect.topLeft;
    this.#rect.topLeft = point;
    this.#requestUpdate();
  }

  get topRight(): Point {
    return this.#rect.topRight;
  }
  set topRight(point: Point) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    this.#previousRect.topRight = this.#rect.topRight;
    this.#rect.topRight = point;
    this.#requestUpdate();
  }

  get bottomRight(): Point {
    return this.#rect.bottomRight;
  }
  set bottomRight(point: Point) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#previousRect.bottomRight = this.#rect.bottomRight;
    this.#rect.bottomRight = point;
    this.#requestUpdate();
  }

  get bottomLeft(): Point {
    return this.#rect.bottomLeft;
  }
  set bottomLeft(point: Point) {
    this.autoWidth = false;
    this.autoHeight = false;
    this.#autoPosition = false;
    this.#previousRect.bottomLeft = this.#rect.bottomLeft;
    this.#rect.bottomLeft = point;
    this.#requestUpdate();
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

  getBounds(): Required<DOMRectInit> {
    return this.#rect.getBounds();
  }

  #spaces: Space[] = [];

  constructor(ownerElement: Element, name: string, value: string) {
    super(ownerElement, name, value);

    ownerElement.addEventListener('focus', this);
    ownerElement.addEventListener('blur', this);
  }

  override connectedCallback(): void {
    const el = this.ownerElement as HTMLElement;

    // We need to make this element focusable if it isn't already
    if (el.tabIndex === -1) {
      el.tabIndex = 0;
    }

    const event = new ShapeConnectedEvent(this);
    this.ownerElement.dispatchEvent(event);
    this.#spaces = Array.from(event.spaces);
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

    if (this.#autoHeight || this.#autoWidth) {
      resizeManager.unobserve(el, this.#onResize);
    }

    el.style.removeProperty('--folk-x');
    el.style.removeProperty('--folk-y');
    el.style.removeProperty('--folk-height');
    el.style.removeProperty('--folk-width');
    el.style.removeProperty('--folk-rotation');

    this.ownerElement.dispatchEvent(new ShapeDisconnectedEvent(this));
  }

  handleEvent(event: FocusEvent) {
    // If someone is tabbing backwards and hits an element with a shadow DOM, we cant tell the difference between is that element is focused of if something in it is.
    if (event.type === 'focus') {
      // this is a hack until we observe the position changing
      if (this.autoPosition) {
        const el = this.ownerElement as HTMLElement;
        this.#rect.x = el.offsetLeft;
        this.#rect.y = el.offsetTop;
      }
      this.#shapeOverlay.open(this);
    } else if (event.type === 'blur' && event.relatedTarget !== this.#shapeOverlay) {
      this.#shapeOverlay.close();
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

    el.style.setProperty('--folk-x', toDOMPrecision(this.#rect.x) + 'px');
    el.style.setProperty('--folk-y', toDOMPrecision(this.#rect.y) + 'px');
    el.style.setProperty('--folk-height', toDOMPrecision(this.#rect.height) + 'px');
    el.style.setProperty('--folk-width', toDOMPrecision(this.#rect.width) + 'px');
    el.style.setProperty('--folk-rotation', toDOMPrecision(this.#rect.rotation) + 'rad');

    this.value = (
      (this.#autoPosition ? '' : `x: ${toDOMPrecision(this.#rect.x)}; y: ${toDOMPrecision(this.#rect.y)}; `) +
      (this.#autoWidth ? '' : `width: ${toDOMPrecision(this.#rect.width)}; `) +
      (this.#autoHeight ? '' : `height: ${toDOMPrecision(this.#rect.height)}; `) +
      (this.#rect.rotation === 0 ? '' : `rotation: ${toDOMPrecision(this.#rect.rotation)};`)
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
      this.#previousRect.height = this.#rect.height;
      this.#rect.height = height;
    }

    if (this.#autoWidth) {
      this.#previousRect.width = this.#rect.width;
      this.#rect.width = width;
    }

    // any DOM updates should happen in the next frame
    requestAnimationFrame(() => this.#update());
  };
}
