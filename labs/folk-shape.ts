import { getResizeCursorUrl, getRotateCursorUrl } from '@labs/utils/cursors';
import {
  DOMRectTransform,
  DOMRectTransformReadonly,
  FolkElement,
  Point,
  round,
  toDOMPrecision,
  TransformEvent,
  Vector,
} from '@lib';
import { ResizeManager } from '@lib/resize-manger';
import { html } from '@lib/tags';
import { TransformStack } from '@lib/TransformStack';
import { MAX_Z_INDEX } from '@lib/utils';
import { css } from '@lit/reactive-element';

const resizeManager = new ResizeManager();

type ResizeHandle = 'resize-top-left' | 'resize-top-right' | 'resize-bottom-right' | 'resize-bottom-left';
type RotateHandle = 'rotation-top-left' | 'rotation-top-right' | 'rotation-bottom-right' | 'rotation-bottom-left';
type Handle = ResizeHandle | RotateHandle | 'move';
export type Dimension = number | 'auto';

type HandleMap = Record<ResizeHandle, ResizeHandle>;

const oppositeHandleMap: HandleMap = {
  'resize-bottom-right': 'resize-top-left',
  'resize-bottom-left': 'resize-top-right',
  'resize-top-left': 'resize-bottom-right',
  'resize-top-right': 'resize-bottom-left',
};

const flipXHandleMap: HandleMap = {
  'resize-bottom-right': 'resize-bottom-left',
  'resize-bottom-left': 'resize-bottom-right',
  'resize-top-left': 'resize-top-right',
  'resize-top-right': 'resize-top-left',
};

const flipYHandleMap: HandleMap = {
  'resize-bottom-right': 'resize-top-right',
  'resize-bottom-left': 'resize-top-left',
  'resize-top-left': 'resize-bottom-left',
  'resize-top-right': 'resize-bottom-right',
};

const styles = css`
  * {
    box-sizing: border-box;
  }

  :host {
    display: block;
    position: absolute;
    top: 0;
    left: 0;
    cursor: move;
    transform-origin: center center;
    box-sizing: border-box;
    --folk-x: 0;
    --folk-y: 0;
    --folk-rotation: 0;
    --folk-width: 0;
    --folk-height: 0;
    width: calc(var(--folk-width) * 1px);
    height: calc(var(--folk-height) * 1px);
    translate: calc(var(--folk-x) * 1px) calc(var(--folk-y) * 1px);
    rotate: calc(var(--folk-rotation) * 1rad);
    outline: solid 0 hsl(214, 84%, 56%);
    transition: outline-width 75ms ease-out;
  }

  :host(:state(auto-height)) {
    height: auto;
  }

  :host(:state(auto-width)) {
    width: auto;
  }

  :host::before {
    content: '';
    position: absolute;
    inset: -15px;
    z-index: -1;
  }

  div {
    height: 100%;
    width: 100%;
    overflow: scroll;
    pointer-events: none;
  }

  ::slotted(*) {
    cursor: default;
    pointer-events: auto;
  }

  :host(:focus-within),
  :host(:focus-visible) {
    z-index: calc(${MAX_Z_INDEX} - 1);
    outline-width: 1px;
  }

  :host(:hover),
  :host(:state(highlighted)) {
    outline-width: 2px;
  }

  :host(:state(move)),
  :host(:state(rotate)),
  :host(:state(resize-top-left)),
  :host(:state(resize-top-right)),
  :host(:state(resize-bottom-right)),
  :host(:state(resize-bottom-left)) {
    user-select: none;
  }

  [part] {
    all: unset;
    aspect-ratio: 1;
    display: none;
    position: absolute;
    z-index: calc(${MAX_Z_INDEX} - 1);
    padding: 0;
  }

  [part^='resize'] {
    background: hsl(210, 20%, 98%);
    width: 10px;
    transform: translate(-50%, -50%);
    border: 1.5px solid hsl(214, 84%, 56%);
    border-radius: 3px;

    @media (any-pointer: coarse) {
      width: 15px;
    }
  }

  [part^='rotation'] {
    opacity: 0;
    width: 15px;

    @media (any-pointer: coarse) {
      width: 25px;
    }
  }

  [part$='top-left'] {
    top: 0;
    left: 0;
  }

  [part='rotation-top-left'] {
    translate: -100% -100%;
  }

  [part$='top-right'] {
    top: 0;
    left: 100%;
  }

  [part='rotation-top-right'] {
    translate: 0% -100%;
  }

  [part$='bottom-right'] {
    top: 100%;
    left: 100%;
  }

  [part='rotation-bottom-right'] {
    translate: 0% 0%;
  }

  [part$='bottom-left'] {
    top: 100%;
    left: 0;
  }

  [part='rotation-bottom-left'] {
    translate: -100% 0%;
  }

  :host(:focus-within) :is([part^='resize'], [part^='rotation']) {
    display: block;
  }
`;

declare global {
  interface HTMLElementTagNameMap {
    'folk-shape': FolkShape;
  }
}

export class FolkShape extends FolkElement {
  static tagName = 'folk-shape';
  static importSrc = '/labs/standalone/folk-shape.ts';

  static styles = styles;

  #internals = this.attachInternals();

  #attrWidth: Dimension = 'auto';
  #attrHeight: Dimension = 'auto';

  #rect = new DOMRectTransform();
  #previousRect = new DOMRectTransform();
  #readonlyRect = new DOMRectTransformReadonly();

  #handles!: Record<ResizeHandle | RotateHandle, HTMLElement>;

  #startAngle = 0;

  // List of ancestor folk-space point transforms
  #transformStack!: TransformStack;

  get x() {
    return this.#rect.x;
  }

  set x(x) {
    this.#previousRect.x = this.#rect.x;
    this.#rect.x = x;
    this.requestUpdate('x');
  }

  get y() {
    return this.#rect.y;
  }

  set y(y) {
    this.#previousRect.y = this.#rect.y;
    this.#rect.y = y;
    this.requestUpdate('x');
  }

  get position(): Point {
    return { x: this.#rect.x, y: this.#rect.y };
  }

  set position(position: Point) {
    this.x = position.x;
    this.y = position.y;
  }

  get width(): number {
    return this.#rect.width;
  }

  set width(width: Dimension) {
    if (width === 'auto') {
      resizeManager.observe(this, this.#onAutoResize);
    } else {
      if (this.#attrWidth === 'auto' && this.#attrHeight !== 'auto') {
        resizeManager.unobserve(this, this.#onAutoResize);
      }
      this.#previousRect.width = this.#rect.width;
      this.#rect.width = width;
    }
    this.#attrWidth = width;
    this.requestUpdate('width');
  }

  get height(): number {
    return this.#rect.height;
  }

  set height(height: Dimension) {
    if (height === 'auto') {
      resizeManager.observe(this, this.#onAutoResize);
    } else {
      if (this.#attrHeight === 'auto' && this.#attrWidth !== 'auto') {
        resizeManager.unobserve(this, this.#onAutoResize);
      }
      this.#previousRect.height = this.#rect.height;
      this.#rect.height = height;
    }

    this.#attrHeight = height;
    this.requestUpdate('height');
  }

  get rotation(): number {
    return this.#rect.rotation;
  }

  set rotation(rotation: number) {
    this.#previousRect.rotation = this.#rect.rotation;
    this.#rect.rotation = rotation;
    this.requestUpdate('rotation');
  }

  #highlighted = false;
  get highlighted() {
    return this.#highlighted;
  }
  set highlighted(highlighted) {
    if (this.#highlighted === highlighted) return;

    this.#highlighted = highlighted;

    highlighted ? this.#internals.states.add('highlighted') : this.#internals.states.delete('highlighted');
  }

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.addEventListener('pointerdown', this);
    this.addEventListener('dblclick', this);
    this.addEventListener('touchmove', this, { passive: false });
    this.addEventListener('keydown', this);

    // Ideally we would creating these lazily on first focus, but the resize handlers need to be around for delegate focus to work.
    // Maybe can add the first resize handler here, and lazily instantiate the rest when needed?
    // I can see it becoming important at scale
    (root as ShadowRoot).setHTMLUnsafe(
      html` <button part="rotation-top-left" tabindex="-1"></button>
        <button part="rotation-top-right" tabindex="-1"></button>
        <button part="rotation-bottom-right" tabindex="-1"></button>
        <button part="rotation-bottom-left" tabindex="-1"></button>
        <button part="resize-top-left" aria-label="Resize shape from top left"></button>
        <button part="resize-top-right" aria-label="Resize shape from top right"></button>
        <button part="resize-bottom-right" aria-label="Resize shape from bottom right"></button>
        <button part="resize-bottom-left" aria-label="Resize shape from bottom left"></button>
        <div><slot></slot></div>`,
    );

    this.#handles = Object.fromEntries(
      Array.from(root.querySelectorAll('[part]')).map((el) => [
        el.getAttribute('part') as ResizeHandle | RotateHandle,
        el as HTMLElement,
      ]),
    ) as Record<ResizeHandle | RotateHandle, HTMLElement>;

    this.#updateCursors();

    this.x = Number(this.getAttribute('x')) || this.x;
    this.y = Number(this.getAttribute('y')) || this.y;
    this.width = Number(this.getAttribute('width')) || this.#attrWidth;
    this.height = Number(this.getAttribute('height')) || this.#attrHeight;
    this.rotation = (Number(this.getAttribute('rotation')) || 0) * (Math.PI / 180);

    this.#rect.transformOrigin = { x: 0, y: 0 };
    this.#rect.rotateOrigin = { x: 0.5, y: 0.5 };

    this.#previousRect = new DOMRectTransform(this.#rect);

    this.setAttribute('tabindex', '0');

    return root;
  }

  connectedCallback(): void {
    super.connectedCallback();
    // Find all ancestor folk-space elements when connected to the DOM
    this.refreshTransformStack();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
  }

  refreshTransformStack() {
    this.#transformStack = TransformStack.fromElement(this);
    console.log(this.#transformStack);
  }

  // todo: rename to `getDOMRectTransform`
  getTransformDOMRect() {
    return this.#readonlyRect;
  }

  handleEvent(event: PointerEvent | KeyboardEvent) {
    // prevent IOS Safari from scrolling when a shape is interacted with.
    if (event.type === 'touchmove') {
      event.preventDefault();
      return;
    }

    const focusedElement = (this.renderRoot as ShadowRoot).activeElement as HTMLElement | null;
    const target = event.composedPath()[0] as HTMLElement;
    let handle: Handle | null = null;
    if (target) {
      handle = target.getAttribute('part') as Handle | null;
    } else if (focusedElement) {
      handle = focusedElement.getAttribute('part') as Handle | null;
    }

    if (event.type === 'dblclick') {
      if (handle?.startsWith('resize')) {
        this.height = 'auto';
        this.width = 'auto';
        return;
      }

      if (handle?.startsWith('rotation')) {
        this.rotation = 0;
        return;
      }
    }

    // Handle pointer capture setup/cleanup
    if (event instanceof PointerEvent) {
      event.stopPropagation();
      if (event.type === 'pointerdown') {
        if (target !== this && !handle) return;

        // Setup rotation initial state if needed
        if (handle?.startsWith('rotation')) {
          const parentRotateOrigin = this.#rect.toParentSpace({
            x: this.#rect.width * this.#rect.rotateOrigin.x,
            y: this.#rect.height * this.#rect.rotateOrigin.y,
          });
          // Calculate initial angle including current rotation
          // Transform the mouse position through any folk-space ancestors
          const pageMousePos = { x: event.pageX, y: event.pageY };
          const transformedMousePos = this.#transformStack.mapPointToLocal(pageMousePos);
          this.#startAngle = Vector.angleFromOrigin(transformedMousePos, parentRotateOrigin) - this.#rect.rotation;
        }

        // If we're resizing and
        if (handle?.startsWith('resize') && (this.#attrHeight === 'auto' || this.#attrWidth === 'auto')) {
          this.#attrHeight = this.#rect.height;
          this.#attrWidth = this.#rect.width;
          resizeManager.unobserve(this, this.#onAutoResize);
        }

        // Setup pointer capture
        target.addEventListener('pointermove', this);
        target.addEventListener('lostpointercapture', this);
        target.setPointerCapture(event.pointerId);
        this.#internals.states.add(handle || 'move');
        this.focus();
        return;
      }

      if (event.type === 'lostpointercapture') {
        this.#internals.states.delete(handle || 'move');
        target.removeEventListener('pointermove', this);
        target.removeEventListener('lostpointercapture', this);
        this.#updateCursors();
        return;
      }
    }

    // Calculate movement delta from either keyboard or pointer
    let moveDelta: Point | null = null;
    if (event instanceof KeyboardEvent) {
      const MOVEMENT_MUL = event.shiftKey ? 20 : 2;
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!arrowKeys.includes(event.key)) return;

      moveDelta = {
        x: (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * MOVEMENT_MUL,
        y: (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * MOVEMENT_MUL,
      };

      // Transform the keyboard delta through any folk-space ancestors
      moveDelta = this.#transformStack.mapVectorToLocal(moveDelta);
    } else if (event.type === 'pointermove') {
      if (!target) return;
      const zoom = window.visualViewport?.scale ?? 1;
      moveDelta = {
        x: event.movementX / zoom,
        y: event.movementY / zoom,
      };

      // Transform the pointer movement delta through any folk-space ancestors
      moveDelta = this.#transformStack.mapVectorToLocal(moveDelta);
    }

    if (!moveDelta) return;

    // Handle shape movement and rotation
    // target === this || (!handle && event instanceof KeyboardEvent) causes movement when content is inside is focused
    // so removing for now, not sure why it's
    if (target === this) {
      if (event instanceof KeyboardEvent && event.altKey) {
        const ROTATION_MUL = event.shiftKey ? Math.PI / 12 : Math.PI / 36;
        const rotationDelta = moveDelta.x !== 0 ? (moveDelta.x > 0 ? ROTATION_MUL : -ROTATION_MUL) : 0;
        this.rotation += rotationDelta;
      } else {
        this.x += moveDelta.x;
        this.y += moveDelta.y;
      }
      event.preventDefault();
      return;
    }

    // Handle resize
    if (handle?.startsWith('resize') || handle?.startsWith('resize')) {
      const rect = this.#rect;
      const corner = {
        'resize-top-left': rect.topLeft,
        'resize-top-right': rect.topRight,
        'resize-bottom-right': rect.bottomRight,
        'resize-bottom-left': rect.bottomLeft,
      }[handle as ResizeHandle];

      const currentPos = rect.toParentSpace(corner);
      const mousePos =
        event instanceof KeyboardEvent
          ? { x: currentPos.x + moveDelta.x, y: currentPos.y + moveDelta.y }
          : this.#transformStack.mapPointToLocal({ x: event.pageX, y: event.pageY });

      this.#handleResize(handle as ResizeHandle, mousePos, target, event instanceof PointerEvent ? event : undefined);
      event.preventDefault();
      return;
    }

    // Handle pointer rotation
    if (handle?.startsWith('rotation') && event instanceof PointerEvent) {
      const parentRotateOrigin = this.#rect.toParentSpace({
        x: this.#rect.width * this.#rect.rotateOrigin.x,
        y: this.#rect.height * this.#rect.rotateOrigin.y,
      });

      // Transform the mouse position through any folk-space ancestors
      const pageMousePos = { x: event.pageX, y: event.pageY };
      const transformedMousePos = this.#transformStack.mapPointToLocal(pageMousePos);

      const currentAngle = Vector.angleFromOrigin(transformedMousePos, parentRotateOrigin);

      // Apply rotation relative to start angle
      // If the spaces had rotation, the angle would already be transformed correctly
      // since we're using transformed points to calculate it
      this.rotation = currentAngle - this.#startAngle;

      const degrees = (this.#rect.rotation * 180) / Math.PI;
      const cursorRotation = {
        'rotation-top-left': degrees,
        'rotation-top-right': (degrees + 90) % 360,
        'rotation-bottom-right': (degrees + 180) % 360,
        'rotation-bottom-left': (degrees + 270) % 360,
      }[handle as RotateHandle];

      target.style.setProperty('cursor', getRotateCursorUrl(cursorRotation));
      return;
    }
  }

  protected override willUpdate(): void {
    this.#dispatchTransformEvent();
  }

  #dispatchTransformEvent() {
    // we must emit a new reference to the rect
    const event = new TransformEvent(new DOMRectTransform(this.#rect), this.#previousRect);
    this.dispatchEvent(event);
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

    if (this.#attrHeight === 'auto') {
      this.#internals.states.add('auto-height');
    } else {
      this.#internals.states.delete('auto-height');
    }

    if (this.#attrWidth === 'auto') {
      this.#internals.states.add('auto-width');
    } else {
      this.#internals.states.delete('auto-width');
    }

    this.style.setProperty('--folk-x', toDOMPrecision(this.#rect.x).toString());
    this.style.setProperty('--folk-y', toDOMPrecision(this.#rect.y).toString());
    this.style.setProperty('--folk-width', toDOMPrecision(this.#rect.width).toString());
    this.style.setProperty('--folk-height', toDOMPrecision(this.#rect.height).toString());
    this.style.setProperty('--folk-rotation', toDOMPrecision(this.#rect.rotation).toString());

    this.#readonlyRect = new DOMRectTransformReadonly(this.#rect);
  }

  #onAutoResize = (entry: ResizeObserverEntry) => {
    if (this.#attrHeight === 'auto') {
      this.#previousRect.height = this.#rect.height;
      this.#rect.height = entry.contentRect.height;
    }

    if (this.#attrWidth === 'auto') {
      this.#previousRect.width = this.#rect.width;
      this.#rect.width = entry.contentRect.width;
    }

    // Using requestAnimationFrame prevents warnings of "Uncaught ResizeObserver loop completed with undelivered notifications."
    requestAnimationFrame(() => this.#dispatchTransformEvent());
  };

  #updateCursors() {
    const degrees = (this.#rect.rotation * 180) / Math.PI;

    const resizeCursor0 = getResizeCursorUrl(degrees);
    const resizeCursor90 = getResizeCursorUrl((degrees + 90) % 360);

    this.#handles['resize-top-left'].style.setProperty('cursor', resizeCursor0);
    this.#handles['resize-bottom-right'].style.setProperty('cursor', resizeCursor0);
    this.#handles['resize-top-right'].style.setProperty('cursor', resizeCursor90);
    this.#handles['resize-bottom-left'].style.setProperty('cursor', resizeCursor90);

    this.#handles['rotation-top-left'].style.setProperty('cursor', getRotateCursorUrl(degrees));
    this.#handles['rotation-top-right'].style.setProperty('cursor', getRotateCursorUrl((degrees + 90) % 360));
    this.#handles['rotation-bottom-right'].style.setProperty('cursor', getRotateCursorUrl((degrees + 180) % 360));
    this.#handles['rotation-bottom-left'].style.setProperty('cursor', getRotateCursorUrl((degrees + 270) % 360));
  }

  #handleResize(handle: ResizeHandle, pointerPos: Point, target: HTMLElement, event?: PointerEvent) {
    const localPointer = this.#rect.toLocalSpace(pointerPos);

    // FIX: this is a bandaid for sub-pixel jitter that happens in the opposite resize handle
    // It seems like there is sub-pixel imprecision happening in DOMRectTransform, but I haven't figured out where yet.
    // If the coordinates are rounded to 2 decimal places, no jitter happens.
    this.#rect[getCornerName(handle)] = { x: round(localPointer.x, 2), y: round(localPointer.y, 2) };

    let nextHandle: ResizeHandle = handle;

    const flipWidth = this.#rect.width < 0;
    const flipHeight = this.#rect.height < 0;

    if (flipWidth && flipHeight) {
      nextHandle = oppositeHandleMap[handle];
    } else if (flipWidth) {
      nextHandle = flipXHandleMap[handle];
    } else if (flipHeight) {
      nextHandle = flipYHandleMap[handle];
    }

    // When a flip happens the old handler should be at the position of the new handler and the new handler should be where the old handler was.
    if (flipHeight || flipWidth) {
      const handlePoint = this.#rect[getCornerName(handle)];
      this.#rect[getCornerName(handle)] = this.#rect[getCornerName(nextHandle)];
      this.#rect[getCornerName(nextHandle)] = handlePoint;
    }

    const newTarget = this.renderRoot.querySelector(`[part="${nextHandle}"]`) as HTMLElement;

    if (newTarget) {
      // Update focus for keyboard events
      newTarget.focus();

      // Update handle state
      this.#internals.states.delete(handle);
      this.#internals.states.add(nextHandle);

      // Handle pointer capture swap for mouse events
      if (event && 'setPointerCapture' in target) {
        // Clean up old handle state
        target.removeEventListener('pointermove', this);
        target.removeEventListener('lostpointercapture', this);

        // Set up new handle state
        newTarget.addEventListener('pointermove', this);
        newTarget.addEventListener('lostpointercapture', this);

        // Transfer pointer capture
        target.releasePointerCapture(event.pointerId);
        newTarget.setPointerCapture(event.pointerId);
      }
    }

    this.requestUpdate();
  }
}

function getCornerName(handle: ResizeHandle) {
  switch (handle) {
    case 'resize-bottom-right':
      return 'bottomRight';
    case 'resize-bottom-left':
      return 'bottomLeft';
    case 'resize-top-left':
      return 'topLeft';
    case 'resize-top-right':
      return 'topRight';
  }
}
