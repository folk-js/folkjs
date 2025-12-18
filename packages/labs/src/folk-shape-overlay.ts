import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import { html } from '@folkjs/dom/tags';
import * as S from '@folkjs/geometry/Shape2D';
import type { Vector2 } from '@folkjs/geometry/Vector2';
import * as V from '@folkjs/geometry/Vector2';
import { round, toDOMPrecision } from '@folkjs/geometry/utilities';
import type { FolkSpaceAttribute } from './folk-space-attribute';
import type { Shape2DObject } from './shape-events';
import { getResizeCursorUrl, getRotateCursorUrl } from './utils/cursors';

type ResizeHandle = 'resize-top-left' | 'resize-top-right' | 'resize-bottom-right' | 'resize-bottom-left';

type RotateHandle = 'rotation-top-left' | 'rotation-top-right' | 'rotation-bottom-right' | 'rotation-bottom-left';

type MoveHandle = 'move-top' | 'move-right' | 'move-bottom' | 'move-left' | 'move';

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

export class FolkShapeOverlay extends ReactiveElement {
  static override tagName = 'folk-shape-overlay';

  static override styles = css`
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
  #ownerElement: HTMLElement | null = null;
  #shape: Shape2DObject | null = null;
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

    const { frag, ...handles } = html(
      `
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
    `,
      'part',
    );

    root.appendChild(frag);
    this.#handles = handles;

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('keydown', this.#handleTabbing, { capture: true });
  }

  override disconnectedCallback(): void {
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
            const el = document.querySelector('[folk-shape]');

            if (el?.folkShape === undefined) return;

            this.open(el.folkShape, el as HTMLElement);
          }

          this.focus();
        } else {
          setTimeout(() => this.#ownerElement?.focus(), 0);
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
    if (this.#shape === null || this.#ownerElement === null) return;

    // prevent IOS Safari from scrolling when a shape is interacted with.
    if (event.type === 'touchmove') {
      event.preventDefault();
      return;
    }

    if (event instanceof FocusEvent) {
      if (event.relatedTarget !== this.#ownerElement) {
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

    // TODO: figure out how this can work with the shape selection
    // if (event.type === 'dblclick') {
    //   if (handle.startsWith('resize')) {
    //     this.#shape.autoHeight = true;
    //     this.#shape.autoWidth = true;
    //   } else if (handle.startsWith('rotation')) {
    //     this.#shape.rotation = 0;
    //   } else if (handle.startsWith('move')) {
    //     this.#shape.autoPosition = true;
    //   }
    //   return;
    // }

    // Handle pointer capture setup/cleanup
    if (event instanceof PointerEvent) {
      event.stopPropagation();
      if (event.type === 'pointerdown') {
        // Setup rotation initial state if needed
        if (handle.startsWith('rotation')) {
          // Polymorphic
          const rotationOrigin = S.center(this.#shape);
          // Calculate initial angle including current rotation
          const mousePos = this.#shape.transformStack.mapPointToLocal({ x: event.pageX, y: event.pageY });
          this.#startAngle = V.angleFromOrigin(mousePos, rotationOrigin) - this.#shape.rotation;
        }

        // Safari has a rendering bug unless we create a new stacking context
        // only apply it while the shape is being moved
        this.#ownerElement.style.transform = 'translateZ(0)';

        // Setup pointer capture
        target.addEventListener('pointermove', this);
        target.addEventListener('lostpointercapture', this);
        target.setPointerCapture(event.pointerId);
        this.#internals.states.add(handle);
        this.focus();
        return;
      }

      if (event.type === 'lostpointercapture') {
        this.#ownerElement.style.transform = '';
        this.#internals.states.delete(handle);
        target.removeEventListener('pointermove', this);
        target.removeEventListener('lostpointercapture', this);
        this.#updateCursors();
        return;
      }
    }

    // Calculate movement delta from either keyboard or pointer
    let moveDelta: Vector2 | null = null;
    if (event instanceof KeyboardEvent) {
      const MOVEMENT_MUL = event.shiftKey ? 20 : 2;
      const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!arrowKeys.includes(event.key)) return;

      moveDelta = this.#shape.transformStack.mapVectorToLocal({
        x: (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * MOVEMENT_MUL,
        y: (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0) * MOVEMENT_MUL,
      });
    } else if (event.type === 'pointermove') {
      if (!target) return;
      const zoom = window.visualViewport?.scale ?? 1;
      moveDelta = this.#shape.transformStack.mapVectorToLocal({
        x: event.movementX / zoom,
        y: event.movementY / zoom,
      });
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

      const mousePos =
        event instanceof KeyboardEvent
          ? { x: corner.x + moveDelta.x, y: corner.y + moveDelta.y }
          : this.#shape.transformStack.mapPointToLocal({ x: event.pageX, y: event.pageY });

      this.#handleResize(handle as ResizeHandle, mousePos, target, event instanceof PointerEvent ? event : undefined);
      event.preventDefault();
      return;
    }

    // Handle pointer rotation
    if (handle.startsWith('rotation') && event instanceof PointerEvent) {
      // polymorphic
      const rotationOrigin = S.center(this.#shape);
      const point = this.#shape.transformStack.mapPointToLocal({ x: event.pageX, y: event.pageY });
      const currentAngle = V.angleFromOrigin(point, rotationOrigin);
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

  open(shape: Shape2DObject, element: HTMLElement) {
    if (this.isOpen) this.close();

    this.#shape = shape;
    this.#ownerElement = element;
    this.#ownerElement.addEventListener('transform', this.#update);
    this.#shape.transformStack.transforms.forEach((transform) => {
      (transform as FolkSpaceAttribute).ownerElement.addEventListener('space-transform', this.#update);
    });
    this.#update();
    this.#updateCursors();
    this.showPopover();
  }

  close() {
    if (!this.isOpen || !this.#shape || !this.#ownerElement) return;

    this.#ownerElement.removeEventListener('transform', this.#update);
    this.#shape.transformStack.transforms.forEach((transform) => {
      (transform as FolkSpaceAttribute).ownerElement.removeEventListener('space-transform', this.#update);
    });
    this.#shape = null;
    this.#ownerElement = null;
    this.hidePopover();
  }

  #update = () => {
    if (this.#shape === null) return;

    const { x, y, width, height } = this.#shape;
    let min = this.#shape.transformStack.mapPointToParent({ x: x, y: y });
    let max = this.#shape.transformStack.mapPointToParent({ x: x + width, y: y + height });

    this.style.left = `${toDOMPrecision(min.x)}px`;
    this.style.top = `${toDOMPrecision(min.y)}px`;
    this.style.width = `${toDOMPrecision(max.x - min.x)}px`;
    this.style.height = `${toDOMPrecision(max.y - min.y)}px`;
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

  #handleResize(handle: ResizeHandle, pointerPos: Vector2, target: HTMLElement, event?: PointerEvent) {
    if (this.#shape === null) return;

    // FIX: this is a bandaid for sub-pixel jitter that happens in the opposite resize handle
    // It seems like there is sub-pixel imprecision happening in Shape2D, but I haven't figured out where yet.
    // If the coordinates are rounded to 2 decimal places, no jitter happens.
    this.#shape[getCornerName(handle)] = { x: round(pointerPos.x, 2), y: round(pointerPos.y, 2) };

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
