import { FolkElement, Matrix, Vector } from '@lib';
import { css, PropertyValues } from '@lit/reactive-element';
import { property } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'folk-pinch': FolkPinch;
  }
}

export class FolkPinch extends FolkElement {
  static tagName = 'folk-pinch';

  static styles = css`
    :host {
      display: block;
      overflow: hidden;
      touch-action: none;
    }

    :host([grid]) {
      --circle-width: 1px;
      --circle: circle at var(--circle-width) var(--circle-width);
      /* Map color transparency to --folk-scale for each level of the grid */
      --bg-color-1: rgba(0, 0, 0, 1);
      --bg-color-2: rgba(0, 0, 0, clamp(0, var(--folk-scale), 1));
      --bg-color-3: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 0.1), 1));
      --bg-color-4: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 1), 1));
      --bg-color-5: rgba(0, 0, 0, clamp(0, calc(0.5 * var(--folk-scale) - 2), 1));

      /* Draw points for each level of grid as set of a background image. First background is on top.*/
      background-image: radial-gradient(var(--circle), var(--bg-color-1) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-2) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-3) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-4) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-5) var(--circle-width), transparent 0);

      /* Each level of the grid should be a factor of --size. */
      --bg-size: calc(var(--size, 100px) / pow(2, 6) * var(--folk-scale));

      /* Divide each part of grid into 4 sections. */
      --bg-size-1: calc(var(--bg-size) * pow(var(--sections, 4), 5));
      --bg-size-2: calc(var(--bg-size) * pow(var(--sections, 4), 4));
      --bg-size-3: calc(var(--bg-size) * pow(var(--sections, 4), 3));
      --bg-size-4: calc(var(--bg-size) * pow(var(--sections, 4), 2));
      --bg-size-5: calc(var(--bg-size) * var(--sections, 4));

      background-size:
        var(--bg-size-1) var(--bg-size-1),
        var(--bg-size-2) var(--bg-size-2),
        var(--bg-size-3) var(--bg-size-3),
        var(--bg-size-4) var(--bg-size-4),
        var(--bg-size-5) var(--bg-size-5);

      /* Pan each background position to each point in the underlay. */
      background-position: var(--folk-x) var(--folk-y);
    }

    div {
      position: absolute;
      inset: 0;
      scale: var(--folk-scale);
      translate: var(--folk-x) var(--folk-y);
      transform-origin: 0 0;
    }
  `;

  @property({ type: Number, reflect: true }) x: number = 0;

  @property({ type: Number, reflect: true }) y: number = 0;

  @property({ type: Number, reflect: true }) scale: number = 1;

  @property({ type: Number, reflect: true }) minScale: number = 0.05;

  @property({ type: Number, reflect: true }) maxScale: number = 8;

  #container = document.createElement('div');

  // clean up?
  #pointerTracker = new PointerTracker(this, {
    start: (_, event) => {
      // We only want to track 2 pointers at most
      if (this.#pointerTracker.currentPointers.length === 2) return false;

      // is this needed, when it happens it prevents the blur of other elements
      // event.preventDefault();
      return true;
    },
    move: (previousPointers) => {
      this.#onPointerMove(previousPointers, this.#pointerTracker.currentPointers);
    },
  });

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#container.appendChild(document.createElement('slot'));

    root.append(this.#container);

    this.addEventListener('wheel', this.#onWheel);

    return root;
  }

  override willUpdate(): void {
    if (this.scale < this.minScale) {
      this.scale = this.minScale;
    } else if (this.scale > this.maxScale) {
      console.log(this.scale);
      this.scale = this.maxScale;
    }
  }

  override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('x')) {
      this.style.setProperty('--folk-x', `${this.x}px`);
    }

    if (changedProperties.has('y')) {
      this.style.setProperty('--folk-y', `${this.y}px`);
    }

    if (changedProperties.has('scale')) {
      this.style.setProperty('--folk-scale', this.scale.toString());
    }

    // emit transform event
  }

  #onWheel = (event: WheelEvent) => {
    event.preventDefault();

    const currentRect = this.#container.getBoundingClientRect();

    let { deltaY } = event;

    const { ctrlKey, deltaMode } = event;

    if (deltaMode === 1) {
      // 1 is "lines", 0 is "pixels"
      // Firefox uses "lines" for some types of mouse
      deltaY *= 15;
    }

    // ctrlKey is true when pinch-zooming on a trackpad.
    const divisor = ctrlKey ? 100 : 300;
    const scaleDiff = 1 - deltaY / divisor;

    this.#applyChange(0, 0, scaleDiff, event.clientX - currentRect.left, event.clientY - currentRect.top);
  };

  #onPointerMove = (previousPointers: Pointer[], currentPointers: Pointer[]) => {
    // Combine next points with previous points
    const currentRect = this.#container.getBoundingClientRect();

    const previousPoints = previousPointers.slice(0, 2).map((pointer) => ({ x: pointer.clientX, y: pointer.clientY }));

    const currentPoints = currentPointers.slice(0, 2).map((pointer) => ({ x: pointer.clientX, y: pointer.clientY }));

    // For calculating panning movement
    const prevMidpoint = Vector.center(previousPoints);
    const newMidpoint = Vector.center(currentPoints);

    // Midpoint within the element
    const originX = prevMidpoint.x - currentRect.left;
    const originY = prevMidpoint.y - currentRect.top;

    // Calculate the desired change in scale
    const prevDistance = previousPoints.length === 1 ? 0 : Vector.distance(previousPoints[0], previousPoints[1]);
    const newDistance = currentPoints.length === 1 ? 0 : Vector.distance(currentPoints[0], currentPoints[1]);
    const scaleDiff = prevDistance ? newDistance / prevDistance : 1;

    this.#applyChange(newMidpoint.x - prevMidpoint.x, newMidpoint.y - prevMidpoint.y, scaleDiff, originX, originY);
  };

  #applyChange(panX = 0, panY = 0, scaleDiff = 1, originX = 0, originY = 0) {
    const matrix = new Matrix()
      .translate(panX, panY) // Translate according to panning.
      .translate(originX, originY) // Scale about the origin.
      .translate(this.x, this.y) // Apply current translate
      .scale(scaleDiff, scaleDiff)
      .translate(-originX, -originY)
      .scale(this.scale, this.scale); // Apply current scale.

    // TODO: logic to clamp the scale needs to get polished, it's a little jittery
    if (matrix.a < this.minScale || matrix.a > this.maxScale) return;

    this.scale = matrix.a;
    this.x = matrix.e;
    this.y = matrix.f;
  }
}

// TODO: rewrite this as GestureTracker

/**
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const enum Buttons {
  None,
  LeftMouseOrTouchOrPenDown,
}

class Pointer {
  /** x offset from the top of the document */
  pageX: number;
  /** y offset from the top of the document */
  pageY: number;
  /** x offset from the top of the viewport */
  clientX: number;
  /** y offset from the top of the viewport */
  clientY: number;
  /** Unique ID for this pointer */
  id: number = -1;
  /** The platform object used to create this Pointer */
  nativePointer: Touch | PointerEvent | MouseEvent;

  constructor(nativePointer: Touch | PointerEvent | MouseEvent) {
    this.nativePointer = nativePointer;
    this.pageX = nativePointer.pageX;
    this.pageY = nativePointer.pageY;
    this.clientX = nativePointer.clientX;
    this.clientY = nativePointer.clientY;

    if (self.Touch && nativePointer instanceof Touch) {
      this.id = nativePointer.identifier;
    } else if (isPointerEvent(nativePointer)) {
      // is PointerEvent
      this.id = nativePointer.pointerId;
    }
  }

  /**
   * Returns an expanded set of Pointers for high-resolution inputs.
   */
  getCoalesced(): Pointer[] {
    if ('getCoalescedEvents' in this.nativePointer) {
      const events = this.nativePointer.getCoalescedEvents().map((p) => new Pointer(p));
      // Firefox sometimes returns an empty list here. I'm not sure it's doing the right thing.
      // https://github.com/w3c/pointerevents/issues/409
      if (events.length > 0) return events;
      // Otherwise, Firefox falls through…
    }
    return [this];
  }
}

const isPointerEvent = (event: any): event is PointerEvent => 'pointerId' in event;

const isTouchEvent = (event: any): event is TouchEvent => 'changedTouches' in event;

const noop = () => {};

export type InputEvent = TouchEvent | PointerEvent | MouseEvent;
type StartCallback = (pointer: Pointer, event: InputEvent) => boolean;
type MoveCallback = (previousPointers: Pointer[], changedPointers: Pointer[], event: InputEvent) => void;
type EndCallback = (pointer: Pointer, event: InputEvent, cancelled: boolean) => void;

interface PointerTrackerOptions {
  /**
   * Called when a pointer is pressed/touched within the element.
   *
   * @param pointer The new pointer. This pointer isn't included in this.currentPointers or
   * this.startPointers yet.
   * @param event The event related to this pointer.
   *
   * @returns Whether you want to track this pointer as it moves.
   */
  start?: StartCallback;
  /**
   * Called when pointers have moved.
   *
   * @param previousPointers The state of the pointers before this event. This contains the same
   * number of pointers, in the same order, as this.currentPointers and this.startPointers.
   * @param changedPointers The pointers that have changed since the last move callback.
   * @param event The event related to the pointer changes.
   */
  move?: MoveCallback;
  /**
   * Called when a pointer is released.
   *
   * @param pointer The final state of the pointer that ended. This pointer is now absent from
   * this.currentPointers and this.startPointers.
   * @param event The event related to this pointer.
   * @param cancelled Was the action cancelled? Actions are cancelled when the OS takes over pointer
   * events, for actions such as scrolling.
   */
  end?: EndCallback;
  /**
   * Avoid pointer events in favour of touch and mouse events?
   *
   * Even if the browser supports pointer events, you may want to force the browser to use
   * mouse/touch fallbacks, to work around bugs such as
   * https://bugs.webkit.org/show_bug.cgi?id=220196.
   */
  avoidPointerEvents?: boolean;
  /**
   * Use raw pointer updates? Pointer events are usually synchronised to requestAnimationFrame.
   * However, if you're targeting a desynchronised canvas, then faster 'raw' updates are better.
   *
   * This feature only applies to pointer events.
   */
  rawUpdates?: boolean;
}

/**
 * Track pointers across a particular element
 */
export default class PointerTracker {
  /**
   * State of the tracked pointers when they were pressed/touched.
   */
  readonly startPointers: Pointer[] = [];
  /**
   * Latest state of the tracked pointers. Contains the same number of pointers, and in the same
   * order as this.startPointers.
   */
  readonly currentPointers: Pointer[] = [];

  private _startCallback: StartCallback;
  private _moveCallback: MoveCallback;
  private _endCallback: EndCallback;
  private _rawUpdates: boolean;

  /**
   * Firefox has a bug where touch-based pointer events have a `buttons` of 0, when this shouldn't
   * happen. https://bugzilla.mozilla.org/show_bug.cgi?id=1729440
   *
   * Usually we treat `buttons === 0` as no-longer-pressed. This set allows us to exclude these
   * buggy Firefox events.
   */
  private _excludeFromButtonsCheck = new Set<number>();

  /**
   * Track pointers across a particular element
   *
   * @param element Element to monitor.
   * @param options
   */
  constructor(
    private _element: HTMLElement,
    {
      start = () => true,
      move = noop,
      end = noop,
      rawUpdates = false,
      avoidPointerEvents = false,
    }: PointerTrackerOptions = {},
  ) {
    this._startCallback = start;
    this._moveCallback = move;
    this._endCallback = end;
    this._rawUpdates = rawUpdates && 'onpointerrawupdate' in window;

    // Add listeners
    if (self.PointerEvent && !avoidPointerEvents) {
      this._element.addEventListener('pointerdown', this._pointerStart);
    } else {
      this._element.addEventListener('mousedown', this._pointerStart);
      this._element.addEventListener('touchstart', this._touchStart);
      this._element.addEventListener('touchmove', this._move);
      this._element.addEventListener('touchend', this._touchEnd);
      this._element.addEventListener('touchcancel', this._touchEnd);
    }
  }

  /**
   * Remove all listeners.
   */
  stop() {
    this._element.removeEventListener('pointerdown', this._pointerStart);
    this._element.removeEventListener('mousedown', this._pointerStart);
    this._element.removeEventListener('touchstart', this._touchStart);
    this._element.removeEventListener('touchmove', this._move);
    this._element.removeEventListener('touchend', this._touchEnd);
    this._element.removeEventListener('touchcancel', this._touchEnd);
    this._element.removeEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move as any);
    this._element.removeEventListener('pointerup', this._pointerEnd);
    this._element.removeEventListener('pointercancel', this._pointerEnd);
    window.removeEventListener('mousemove', this._move);
    window.removeEventListener('mouseup', this._pointerEnd);
  }

  /**
   * Call the start callback for this pointer, and track it if the user wants.
   *
   * @param pointer Pointer
   * @param event Related event
   * @returns Whether the pointer is being tracked.
   */
  private _triggerPointerStart(pointer: Pointer, event: InputEvent): boolean {
    if (!this._startCallback(pointer, event)) return false;
    this.currentPointers.push(pointer);
    this.startPointers.push(pointer);
    return true;
  }

  /**
   * Listener for mouse/pointer starts.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  private _pointerStart = (event: PointerEvent | MouseEvent) => {
    if (isPointerEvent(event) && event.buttons === 0) {
      // This is the buggy Firefox case. See _excludeFromButtonsCheck.
      this._excludeFromButtonsCheck.add(event.pointerId);
    } else if (!(event.buttons & Buttons.LeftMouseOrTouchOrPenDown)) {
      return;
    }
    const pointer = new Pointer(event);
    // If we're already tracking this pointer, ignore this event.
    // This happens with mouse events when multiple buttons are pressed.
    if (this.currentPointers.some((p) => p.id === pointer.id)) return;

    if (!this._triggerPointerStart(pointer, event)) return;

    // Add listeners for additional events.
    // The listeners may already exist, but no harm in adding them again.
    if (isPointerEvent(event)) {
      const capturingElement =
        event.target && 'setPointerCapture' in event.target ? (event.target as Element) : this._element;

      capturingElement.setPointerCapture(event.pointerId);
      this._element.addEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move as any);
      this._element.addEventListener('pointerup', this._pointerEnd);
      this._element.addEventListener('pointercancel', this._pointerEnd);
    } else {
      // MouseEvent
      window.addEventListener('mousemove', this._move);
      window.addEventListener('mouseup', this._pointerEnd);
    }
  };

  /**
   * Listener for touchstart.
   * Only used if the browser doesn't support pointer events.
   */
  private _touchStart = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      this._triggerPointerStart(new Pointer(touch), event);
    }
  };

  /**
   * Listener for pointer/mouse/touch move events.
   */
  private _move = (event: PointerEvent | MouseEvent | TouchEvent) => {
    if (
      !isTouchEvent(event) &&
      (!isPointerEvent(event) || !this._excludeFromButtonsCheck.has(event.pointerId)) &&
      event.buttons === Buttons.None
    ) {
      // This happens in a number of buggy cases where the browser failed to deliver a pointerup
      // or pointercancel. If we see the pointer moving without any buttons down, synthesize an end.
      // https://github.com/w3c/pointerevents/issues/407
      // https://github.com/w3c/pointerevents/issues/408
      this._pointerEnd(event);
      return;
    }
    const previousPointers = this.currentPointers.slice();
    const changedPointers = isTouchEvent(event)
      ? Array.from(event.changedTouches).map((t) => new Pointer(t))
      : [new Pointer(event)];
    const trackedChangedPointers = [];

    for (const pointer of changedPointers) {
      const index = this.currentPointers.findIndex((p) => p.id === pointer.id);
      if (index === -1) continue; // Not a pointer we're tracking
      trackedChangedPointers.push(pointer);
      this.currentPointers[index] = pointer;
    }

    if (trackedChangedPointers.length === 0) return;

    this._moveCallback(previousPointers, trackedChangedPointers, event);
  };

  /**
   * Call the end callback for this pointer.
   *
   * @param pointer Pointer
   * @param event Related event
   */
  private _triggerPointerEnd = (pointer: Pointer, event: InputEvent): boolean => {
    // Main button still down?
    // With mouse events, you get a mouseup per mouse button, so the left button might still be down.
    if (!isTouchEvent(event) && event.buttons & Buttons.LeftMouseOrTouchOrPenDown) {
      return false;
    }
    const index = this.currentPointers.findIndex((p) => p.id === pointer.id);
    // Not a pointer we're interested in?
    if (index === -1) return false;

    this.currentPointers.splice(index, 1);
    this.startPointers.splice(index, 1);
    this._excludeFromButtonsCheck.delete(pointer.id);

    // The event.type might be a 'move' event due to workarounds for weird mouse behaviour.
    // See _move for details.
    const cancelled = !(event.type === 'mouseup' || event.type === 'touchend' || event.type === 'pointerup');

    this._endCallback(pointer, event, cancelled);
    return true;
  };

  /**
   * Listener for mouse/pointer ends.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  private _pointerEnd = (event: PointerEvent | MouseEvent) => {
    if (!this._triggerPointerEnd(new Pointer(event), event)) return;

    if (isPointerEvent(event)) {
      if (this.currentPointers.length) return;
      this._element.removeEventListener(this._rawUpdates ? 'pointerrawupdate' : 'pointermove', this._move as any);
      this._element.removeEventListener('pointerup', this._pointerEnd);
      this._element.removeEventListener('pointercancel', this._pointerEnd);
    } else {
      // MouseEvent
      window.removeEventListener('mousemove', this._move);
      window.removeEventListener('mouseup', this._pointerEnd);
    }
  };

  /**
   * Listener for touchend.
   * Only used if the browser doesn't support pointer events.
   */
  private _touchEnd = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      this._triggerPointerEnd(new Pointer(touch), event);
    }
  };
}
