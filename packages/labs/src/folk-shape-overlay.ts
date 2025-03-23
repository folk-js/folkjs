import { getResizeCursorUrl, getRotateCursorUrl } from '@folkjs/labs/utils/cursors';
import { FolkElement, type Point, round, toDOMPrecision, Vector } from '@folkjs/lib';
import { html } from '@folkjs/lib/tags';
import { css } from '@lit/reactive-element';
import { FolkShapeAttribute } from './folk-shape-attribute';

type ResizeHandle = 'resize-top-left' | 'resize-top-right' | 'resize-bottom-right' | 'resize-bottom-left';

type RotateHandle = 'rotation-top-left' | 'rotation-top-right' | 'rotation-bottom-right' | 'rotation-bottom-left';

type MoveHandle = 'move-top' | 'move-right' | 'movebottom' | 'move-left' | 'move';

type Handle = ResizeHandle | RotateHandle | MoveHandle;

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

declare global {
  interface HTMLElementTagNameMap {
    'folk-shape-overlay': FolkShapeOverlay;
  }
}

export class FolkShapeOverlay extends FolkElement {
  static tagName = 'folk-shape-overlay';

  static styles = css`
    :host {
      box-sizing: border-box;
      position: absolute;
      transform-origin: center center;
      pointer-events: none;
      overflow: visible;
      padding: 0;
      margin: unset;
      inset: unset;
      border: none;
      background: transparent;
      outline: 1px solid rgb(0, 95, 204);
      outline-offset: -1px;
    }

    :host(:focus),
    :host(:focus-visible) {
      cursor: move;
      background: rgba(0, 0, 0, 0.1);
      pointer-events: all;
      outline-width: 2px;
    }

    :host:has(:focus, :focus-visible) {
      outline-width: 1px;
    }

    [part] {
      box-sizing: border-box;
      position: absolute;
      padding: 0;
      pointer-events: all;
      margin: 0;
    }

    [part^='resize'] {
      aspect-ratio: 1;
      background: hsl(210, 20%, 98%);
      width: 9px;
      translate: -50% -50%;
      outline: 1px solid rgb(0, 95, 204);
      outline-offset: -1px;
      border: unset;
      border-radius: 2px;

      &:focus,
      &:focus-visible {
        outline-width: 2px;
      }

      @media (any-pointer: coarse) {
        width: 15px;
      }
    }

    [part^='rotation'] {
      aspect-ratio: 1;
      opacity: 0;
      width: 15px;

      @media (any-pointer: coarse) {
        width: 25px;
      }
    }

    [part$='top-left'] {
      top: 1px;
      left: 1px;
    }

    [part='rotation-top-left'] {
      translate: -100% -100%;
    }

    [part$='top-right'] {
      top: 1px;
      left: calc(100% - 1px);
    }

    [part='rotation-top-right'] {
      translate: 0% -100%;
    }

    [part$='bottom-right'] {
      top: calc(100% - 1px);
      left: calc(100% - 1px);
    }

    [part='rotation-bottom-right'] {
      translate: 0% 0%;
    }

    [part$='bottom-left'] {
      top: calc(100% - 1px);
      left: 1px;
    }

    [part='rotation-bottom-left'] {
      translate: -100% 0%;
    }

    [part*='move'] {
      opacity: 0;
      cursor: move;
    }

    [part='move-top'] {
      inset: -15px 0 100% 0;
    }

    [part='move-right'] {
      inset: 0 -15px 0 100%;
    }

    [part='move-bottom'] {
      inset: 100% 0 -15px 0;
    }

    [part='move-left'] {
      inset: 0 100% 0 -15px;
    }
  `;

  #internals = this.attachInternals();

  get isOpen() {
    return this.#shape !== null;
  }

  #startAngle = 0;
  #shape: FolkShapeAttribute | null = null;
  #handles!: Record<ResizeHandle | RotateHandle, HTMLElement>;

  #spatialTabMode = false;

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    this.popover = 'manual';
    this.tabIndex = -1;

    this.addEventListener('pointerdown', this);
    this.addEventListener('dblclick', this);
    this.addEventListener('keydown', this);
    this.addEventListener('blur', this);
    // prevent IOS Safari from scrolling when a shape is interacted with.
    this.addEventListener('touchmove', this, { passive: false });

    (root as ShadowRoot).setHTMLUnsafe(html`
      <button part="move-top" tabindex="-1" aria-label="Move shape from top"></button>
      <button part="move-right" tabindex="-1" aria-label="Move shape from right"></button>
      <button part="move-bottom" tabindex="-1" aria-label="Move shape from bottom"></button>
      <button part="move-left" tabindex="-1" aria-label="Move shape from left"></button>
      <button part="rotation-top-left" tabindex="-1" aria-label="Rotate shape from top left"></button>
      <button part="rotation-top-right" tabindex="-1" aria-label="Rotate shape from top right"></button>
      <button part="rotation-bottom-right" tabindex="-1" aria-label="Rotate shape from bottom right"></button>
      <button part="rotation-bottom-left" tabindex="-1" aria-label="Rotate shape from bottom left"></button>
      <button part="resize-top-left" aria-label="Resize shape from top left"></button>
      <button part="resize-top-right" aria-label="Resize shape from top right"></button>
      <button part="resize-bottom-right" aria-label="Resize shape from bottom right"></button>
      <button part="resize-bottom-left" aria-label="Resize shape from bottom left"></button>
    `);

    this.#handles = Object.fromEntries(
      Array.from(root.querySelectorAll('[part]')).map((el) => [
        el.getAttribute('part') as ResizeHandle | RotateHandle,
        el as HTMLElement,
      ]),
    ) as Record<ResizeHandle | RotateHandle, HTMLElement>;

    return root;
  }

  connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('keydown', this.#handleTabbing, { capture: true });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener('keydown', this.#handleTabbing, { capture: true });
  }

  #handleTabbing = (event: KeyboardEvent) => {
    if (event.type === 'keydown' && event.key === 'Tab') {
      if (event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        this.#spatialTabMode = !this.#spatialTabMode;

        if (this.#spatialTabMode) {
          if (this.#shape === null) {
            const firstShape = document.querySelector('[folk-shape]')?.shape;

            if (firstShape === undefined) return;

            this.open(firstShape);
          }

          this.focus();
        } else {
          setTimeout(() => (this.#shape?.ownerElement as HTMLElement).focus(), 0);
        }

        this.focus();
      } else if (
        event.shiftKey &&
        this.#spatialTabMode &&
        document.activeElement === this &&
        this.shadowRoot!.activeElement === null
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setTimeout(() => this.#handles['resize-bottom-left'].focus(), 0);
      } else if (
        !event.shiftKey &&
        this.#spatialTabMode &&
        this.shadowRoot!.activeElement === this.#handles['resize-bottom-left']
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setTimeout(() => this.focus(), 0);
      } else if (
        event.shiftKey &&
        this.#spatialTabMode &&
        this.shadowRoot!.activeElement === this.#handles['resize-top-left']
      ) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setTimeout(() => this.focus(), 0);
      }

      return;
    }

    // if (this.#spatialTabMode && this.#isTabKeyDown) {
    //   switch (event.key) {
    //     case 'ArrowLeft':
    //       // Left pressed
    //       break;
    //     case 'ArrowRight':
    //       // Right pressed
    //       break;
    //     case 'ArrowUp':
    //       // Up pressed
    //       break;
    //     case 'ArrowDown':
    //       // Down pressed
    //       break;
    //   }
    // }
  };

  handleEvent(event: PointerEvent | KeyboardEvent | FocusEvent) {
    if (this.#shape === null) return;

    // prevent IOS Safari from scrolling when a shape is interacted with.
    if (event.type === 'touchmove') {
      event.preventDefault();
      return;
    }

    if (event instanceof FocusEvent) {
      if (event.relatedTarget !== this.shape?.ownerElement) {
        this.#spatialTabMode = false;
        this.close();
      }
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

    if (handle === null) {
      handle = 'move';
    }

    if (event.type === 'dblclick') {
      if (handle.startsWith('resize')) {
        this.#shape.autoHeight = true;
        this.#shape.autoWidth = true;
      } else if (handle.startsWith('rotation')) {
        this.#shape.rotation = 0;
      } else if (handle.startsWith('move')) {
        this.#shape.autoPosition = true;
      }
      return;
    }

    // Handle pointer capture setup/cleanup
    if (event instanceof PointerEvent) {
      event.stopPropagation();
      if (event.type === 'pointerdown') {
        // Setup rotation initial state if needed
        if (handle.startsWith('rotation')) {
          const parentRotateOrigin = this.#shape.toParentSpace({
            x: this.#shape.width * this.#shape.rotateOrigin.x,
            y: this.#shape.height * this.#shape.rotateOrigin.y,
          });
          // Calculate initial angle including current rotation
          const mousePos = { x: event.pageX, y: event.pageY };
          this.#startAngle = Vector.angleFromOrigin(mousePos, parentRotateOrigin) - this.#shape.rotation;
        }

        // Safari has a rendering bug unless we create a new stacking context
        // only apply it while the shape is being moved
        (this.#shape.ownerElement as HTMLElement).style.transform = 'translateZ(0)';

        // Setup pointer capture
        target.addEventListener('pointermove', this);
        target.addEventListener('lostpointercapture', this);
        target.setPointerCapture(event.pointerId);
        this.#internals.states.add(handle);
        this.focus();
        return;
      }

      if (event.type === 'lostpointercapture') {
        (this.#shape.ownerElement as HTMLElement).style.transform = '';
        this.#internals.states.delete(handle);
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
    } else if (event.type === 'pointermove') {
      if (!target) return;
      const zoom = window.visualViewport?.scale ?? 1;
      moveDelta = {
        x: event.movementX / zoom,
        y: event.movementY / zoom,
      };
    }

    if (!moveDelta) return;

    // Handle shape movement and rotation
    if (handle.startsWith('move')) {
      if (event instanceof KeyboardEvent && event.altKey) {
        const ROTATION_MUL = event.shiftKey ? Math.PI / 12 : Math.PI / 36;
        const rotationDelta = moveDelta.x !== 0 ? (moveDelta.x > 0 ? ROTATION_MUL : -ROTATION_MUL) : 0;
        this.#shape.rotation += rotationDelta;
      } else {
        this.#shape.x += moveDelta.x;
        this.#shape.y += moveDelta.y;
      }
      event.preventDefault();
      return;
    }

    // Handle resize
    if (handle.startsWith('resize')) {
      const rect = this.#shape;

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
          : { x: event.pageX, y: event.pageY };

      this.#handleResize(handle as ResizeHandle, mousePos, target, event instanceof PointerEvent ? event : undefined);
      event.preventDefault();
      return;
    }

    // Handle pointer rotation
    if (handle.startsWith('rotation') && event instanceof PointerEvent) {
      const parentRotateOrigin = this.#shape.toParentSpace({
        x: this.#shape.width * this.#shape.rotateOrigin.x,
        y: this.#shape.height * this.#shape.rotateOrigin.y,
      });
      const currentAngle = Vector.angleFromOrigin({ x: event.pageX, y: event.pageY }, parentRotateOrigin);
      // Apply rotation relative to start angle
      this.#shape.rotation = currentAngle - this.#startAngle;

      const degrees = (this.#shape.rotation * 180) / Math.PI;
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

  open(shape: FolkShapeAttribute) {
    if (this.isOpen) this.close();

    this.#shape = shape;
    this.#shape.ownerElement.addEventListener('transform', this.#update);
    this.#update();
    this.#updateCursors();
    this.showPopover();
  }

  close() {
    if (!this.isOpen) return;

    this.#shape?.ownerElement.removeEventListener('transform', this.#update);
    this.#shape = null;
    this.hidePopover();
  }

  #update = () => {
    if (this.#shape === null) return;

    this.style.top = `${toDOMPrecision(this.#shape.y)}px`;
    this.style.left = `${toDOMPrecision(this.#shape.x)}px`;
    this.style.width = `${toDOMPrecision(this.#shape.width)}px`;
    this.style.height = `${toDOMPrecision(this.#shape.height)}px`;
    this.style.rotate = `${toDOMPrecision(this.#shape.rotation)}rad`;
  };

  #updateCursors() {
    if (this.#shape === null) return;

    const degrees = (this.#shape.rotation * 180) / Math.PI;

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
    if (this.#shape === null) return;

    const localPointer = this.#shape.toLocalSpace(pointerPos);

    // FIX: this is a bandaid for sub-pixel jitter that happens in the opposite resize handle
    // It seems like there is sub-pixel imprecision happening in DOMRectTransform, but I haven't figured out where yet.
    // If the coordinates are rounded to 2 decimal places, no jitter happens.
    this.#shape[getCornerName(handle)] = { x: round(localPointer.x, 2), y: round(localPointer.y, 2) };

    let nextHandle: ResizeHandle = handle;

    const flipWidth = this.#shape.width < 0;
    const flipHeight = this.#shape.height < 0;

    if (flipWidth && flipHeight) {
      nextHandle = oppositeHandleMap[handle];
    } else if (flipWidth) {
      nextHandle = flipXHandleMap[handle];
    } else if (flipHeight) {
      nextHandle = flipYHandleMap[handle];
    }

    // When a flip happens the old handler should be at the position of the new handler and the new handler should be where the old handler was.
    if (flipHeight || flipWidth) {
      const handlePoint = this.#shape[getCornerName(handle)];
      this.#shape[getCornerName(handle)] = this.#shape[getCornerName(nextHandle)];
      this.#shape[getCornerName(nextHandle)] = handlePoint;
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

    this.#update();
  }
}

// https://github.com/ai/keyux
// https://github.com/nolanlawson/arrow-key-navigation
