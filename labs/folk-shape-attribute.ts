import { CustomAttribute, DOMRectTransform, Matrix, Point, toDOMPrecision, TransformEvent } from '@lib';
import { css } from '@lib/tags';
import { FolkShapeOverlay } from './folk-shape-overlay';

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
      display: block;
      position: absolute;
      top: 0;
      left: 0;
      outline: solid 0 hsl(214, 84%, 56%);
      overflow: scroll;
      transform-origin: center center;
      transition: outline-width 75ms ease-out;

      --folk-x: 0;
      --folk-y: 0;
      --folk-rotation: 0;
      --folk-width: 0;
      --folk-height: 0;

      width: calc(var(--folk-width) * 1px);
      height: calc(var(--folk-height) * 1px);
      translate: calc(var(--folk-x) * 1px) calc(var(--folk-y) * 1px);
      rotate: calc(var(--folk-rotation) * 1rad);

      &:focus,
      &:focus-visible {
        outline-width: 1.5px;
      }

      &:hover {
        outline-width: 2.25px;
      }

      & > * {
        cursor: default;
      }
    }
  `;

  static {
    // TODO: detect how to inject styles into shadowroot
    document.adoptedStyleSheets.push(this.styles);
    document.documentElement.appendChild(this.#overlay);
  }

  #previousRect = new DOMRectTransform();
  #rect = new DOMRectTransform();

  get x(): number {
    return this.#rect.x;
  }
  set x(value: number) {
    this.#previousRect.x = this.#rect.x;
    this.#rect.x = value;
    this.#requestUpdate();
  }

  get y(): number {
    return this.#rect.y;
  }
  set y(value: number) {
    this.#previousRect.y = this.#rect.y;
    this.#rect.y = value;
    this.#requestUpdate();
  }

  get width(): number {
    return this.#rect.width;
  }
  set width(value: number) {
    this.#previousRect.width = this.#rect.width;
    this.#rect.width = value;
    this.#requestUpdate();
  }

  get height(): number {
    return this.#rect.height;
  }
  set height(value: number) {
    this.#previousRect.height = this.#rect.height;
    this.#rect.height = value;
    this.#requestUpdate();
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

  get #shapeOverlay() {
    return (this.constructor as typeof FolkShapeAttribute).#overlay;
  }

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

  changedCallback(_oldValue: string, newValue: string): void {
    for (const property of newValue.split(';')) {
      const [name, value] = property.split(':').map((str) => str.trim());
      const parsedValue = Number(value);

      if (
        !Number.isNaN(parsedValue) &&
        (name === 'x' || name === 'y' || name === 'width' || name === 'height' || name === 'rotation')
      ) {
        this[name] = parsedValue;
      }
    }
  }

  disconnectedCallback(): void {
    const el = this.ownerElement as HTMLElement;
    el.removeEventListener('focus', this);
    el.removeEventListener('blur', this);
  }

  handleEvent(event: Event) {
    if (event.type === 'focus') {
      this.#shapeOverlay.addShape(this);
      this.#shapeOverlay.open();
    } else if (event.type === 'blur') {
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

    // if (this.#attrHeight === 'auto') {
    //   this.#internals.states.add('auto-height');
    // } else {
    //   this.#internals.states.delete('auto-height');
    // }

    // if (this.#attrWidth === 'auto') {
    //   this.#internals.states.add('auto-width');
    // } else {
    //   this.#internals.states.delete('auto-width');
    // }

    el.style.setProperty('--folk-x', toDOMPrecision(this.#rect.x).toString());
    el.style.setProperty('--folk-y', toDOMPrecision(this.#rect.y).toString());
    el.style.setProperty('--folk-width', toDOMPrecision(this.#rect.width).toString());
    el.style.setProperty('--folk-height', toDOMPrecision(this.#rect.height).toString());
    el.style.setProperty('--folk-rotation', toDOMPrecision(this.#rect.rotation).toString());
  }

  // #onAutoResize = (entry: ResizeObserverEntry) => {
  //   if (this.#attrHeight === 'auto') {
  //     this.#previousRect.height = this.#rect.height;
  //     this.#rect.height = entry.contentRect.height;
  //   }

  //   if (this.#attrWidth === 'auto') {
  //     this.#previousRect.width = this.#rect.width;
  //     this.#rect.width = entry.contentRect.width;
  //   }

  //   // Using requestAnimationFrame prevents warnings of "Uncaught ResizeObserver loop completed with undelivered notifications."
  //   requestAnimationFrame(() => this.#update());
  // };
}
