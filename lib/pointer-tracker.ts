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
const Buttons = {
  None: 0,
  LeftMouseOrTouchOrPenDown: 1,
};

export class Pointer {
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

export interface PointerTrackerOptions {
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

  #element: HTMLElement;
  #startCallback: StartCallback;
  #moveCallback: MoveCallback;
  #endCallback: EndCallback;
  #rawUpdates: boolean;

  /**
   * Firefox has a bug where touch-based pointer events have a `buttons` of 0, when this shouldn't
   * happen. https://bugzilla.mozilla.org/show_bug.cgi?id=1729440
   *
   * Usually we treat `buttons === 0` as no-longer-pressed. This set allows us to exclude these
   * buggy Firefox events.
   */
  #excludeFromButtonsCheck = new Set<number>();

  /**
   * Track pointers across a particular element
   *
   * @param element Element to monitor.
   * @param options
   */
  constructor(
    element: HTMLElement,
    {
      start = () => true,
      move = noop,
      end = noop,
      rawUpdates = false,
      avoidPointerEvents = false,
    }: PointerTrackerOptions = {},
  ) {
    this.#element = element;
    this.#startCallback = start;
    this.#moveCallback = move;
    this.#endCallback = end;
    this.#rawUpdates = rawUpdates && 'onpointerrawupdate' in window;

    // Add listeners
    if (self.PointerEvent && !avoidPointerEvents) {
      this.#element.addEventListener('pointerdown', this.#pointerStart);
    } else {
      this.#element.addEventListener('mousedown', this.#pointerStart);
      this.#element.addEventListener('touchstart', this.#touchStart);
      this.#element.addEventListener('touchmove', this.#move);
      this.#element.addEventListener('touchend', this.#touchEnd);
      this.#element.addEventListener('touchcancel', this.#touchEnd);
    }
  }

  /**
   * Remove all listeners.
   */
  stop() {
    this.#element.removeEventListener('pointerdown', this.#pointerStart);
    this.#element.removeEventListener('mousedown', this.#pointerStart);
    this.#element.removeEventListener('touchstart', this.#touchStart);
    this.#element.removeEventListener('touchmove', this.#move);
    this.#element.removeEventListener('touchend', this.#touchEnd);
    this.#element.removeEventListener('touchcancel', this.#touchEnd);
    this.#element.removeEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
    this.#element.removeEventListener('pointerup', this.#pointerEnd);
    this.#element.removeEventListener('pointercancel', this.#pointerEnd);
    window.removeEventListener('mousemove', this.#move);
    window.removeEventListener('mouseup', this.#pointerEnd);
  }

  /**
   * Call the start callback for this pointer, and track it if the user wants.
   *
   * @param pointer Pointer
   * @param event Related event
   * @returns Whether the pointer is being tracked.
   */
  #triggerPointerStart(pointer: Pointer, event: InputEvent): boolean {
    if (!this.#startCallback(pointer, event)) return false;
    this.currentPointers.push(pointer);
    this.startPointers.push(pointer);
    return true;
  }

  /**
   * Listener for mouse/pointer starts.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  #pointerStart = (event: PointerEvent | MouseEvent) => {
    if (isPointerEvent(event) && event.buttons === 0) {
      // This is the buggy Firefox case. See _excludeFromButtonsCheck.
      this.#excludeFromButtonsCheck.add(event.pointerId);
    } else if (!(event.buttons & Buttons.LeftMouseOrTouchOrPenDown)) {
      return;
    }
    const pointer = new Pointer(event);
    // If we're already tracking this pointer, ignore this event.
    // This happens with mouse events when multiple buttons are pressed.
    if (this.currentPointers.some((p) => p.id === pointer.id)) return;

    if (!this.#triggerPointerStart(pointer, event)) return;

    // Add listeners for additional events.
    // The listeners may already exist, but no harm in adding them again.
    if (isPointerEvent(event)) {
      const capturingElement =
        event.target && 'setPointerCapture' in event.target ? (event.target as Element) : this.#element;

      capturingElement.setPointerCapture(event.pointerId);
      this.#element.addEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
      this.#element.addEventListener('pointerup', this.#pointerEnd);
      this.#element.addEventListener('pointercancel', this.#pointerEnd);
    } else {
      // MouseEvent
      window.addEventListener('mousemove', this.#move);
      window.addEventListener('mouseup', this.#pointerEnd);
    }
  };

  /**
   * Listener for touchstart.
   * Only used if the browser doesn't support pointer events.
   */
  #touchStart = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      this.#triggerPointerStart(new Pointer(touch), event);
    }
  };

  /**
   * Listener for pointer/mouse/touch move events.
   */
  #move = (event: PointerEvent | MouseEvent | TouchEvent) => {
    if (
      !isTouchEvent(event) &&
      (!isPointerEvent(event) || !this.#excludeFromButtonsCheck.has(event.pointerId)) &&
      event.buttons === Buttons.None
    ) {
      // This happens in a number of buggy cases where the browser failed to deliver a pointerup
      // or pointercancel. If we see the pointer moving without any buttons down, synthesize an end.
      // https://github.com/w3c/pointerevents/issues/407
      // https://github.com/w3c/pointerevents/issues/408
      this.#pointerEnd(event);
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

    this.#moveCallback(previousPointers, trackedChangedPointers, event);
  };

  /**
   * Call the end callback for this pointer.
   *
   * @param pointer Pointer
   * @param event Related event
   */
  #triggerPointerEnd = (pointer: Pointer, event: InputEvent): boolean => {
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
    this.#excludeFromButtonsCheck.delete(pointer.id);

    // The event.type might be a 'move' event due to workarounds for weird mouse behaviour.
    // See _move for details.
    const cancelled = !(event.type === 'mouseup' || event.type === 'touchend' || event.type === 'pointerup');

    this.#endCallback(pointer, event, cancelled);
    return true;
  };

  /**
   * Listener for mouse/pointer ends.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  #pointerEnd = (event: PointerEvent | MouseEvent) => {
    if (!this.#triggerPointerEnd(new Pointer(event), event)) return;

    if (isPointerEvent(event)) {
      if (this.currentPointers.length) return;
      this.#element.removeEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
      this.#element.removeEventListener('pointerup', this.#pointerEnd);
      this.#element.removeEventListener('pointercancel', this.#pointerEnd);
    } else {
      // MouseEvent
      window.removeEventListener('mousemove', this.#move);
      window.removeEventListener('mouseup', this.#pointerEnd);
    }
  };

  /**
   * Listener for touchend.
   * Only used if the browser doesn't support pointer events.
   */
  #touchEnd = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      this.#triggerPointerEnd(new Pointer(touch), event);
    }
  };
}
