const Buttons = {
  None: 0,
  LeftMouseOrTouchOrPenDown: 1,
};

const noop = () => {};

type StartCallback = (pointer: PointerEvent) => boolean;
type MoveCallback = (previousPointers: PointerEvent[], changedPointers: PointerEvent[], event: PointerEvent) => void;
type EndCallback = (pointer: PointerEvent, cancelled: boolean) => void;

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
  readonly startPointers: PointerEvent[] = [];
  /**
   * Latest state of the tracked pointers. Contains the same number of pointers, and in the same
   * order as this.startPointers.
   */
  readonly currentPointers: PointerEvent[] = [];

  #element: HTMLElement;
  #startCallback: StartCallback;
  #moveCallback: MoveCallback;
  #endCallback: EndCallback;
  #rawUpdates = 'onpointerrawupdate' in window;

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
  constructor(element: HTMLElement, { start = () => true, move = noop, end = noop }: PointerTrackerOptions = {}) {
    this.#element = element;
    this.#startCallback = start;
    this.#moveCallback = move;
    this.#endCallback = end;

    // Add listeners
    this.#element.addEventListener('pointerdown', this.#pointerStart);
  }

  /**
   * Remove all listeners.
   */
  stop() {
    this.#element.removeEventListener('pointerdown', this.#pointerStart);
    this.#element.removeEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
    this.#element.removeEventListener('pointerup', this.#pointerEnd);
    this.#element.removeEventListener('pointercancel', this.#pointerEnd);
  }

  /**
   * Call the start callback for this pointer, and track it if the user wants.
   *
   * @param pointer Pointer
   * @param event Related event
   * @returns Whether the pointer is being tracked.
   */
  #triggerPointerStart(pointer: PointerEvent): boolean {
    if (!this.#startCallback(pointer)) return false;
    this.currentPointers.push(pointer);
    this.startPointers.push(pointer);
    return true;
  }

  /**
   * Listener for mouse/pointer starts.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  #pointerStart = (event: PointerEvent) => {
    if (event.buttons === 0) {
      // This is the buggy Firefox case. See _excludeFromButtonsCheck.
      this.#excludeFromButtonsCheck.add(event.pointerId);
    } else if (!(event.buttons & Buttons.LeftMouseOrTouchOrPenDown)) {
      return;
    }
    // If we're already tracking this pointer, ignore this event.
    // This happens with mouse events when multiple buttons are pressed.
    if (this.currentPointers.some((p) => p.pointerId === event.pointerId)) return;

    if (!this.#triggerPointerStart(event)) return;

    // Add listeners for additional events.
    // The listeners may already exist, but no harm in adding them again.

    const capturingElement =
      event.target && 'setPointerCapture' in event.target ? (event.target as Element) : this.#element;

    capturingElement.setPointerCapture(event.pointerId);
    this.#element.addEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
    this.#element.addEventListener('pointerup', this.#pointerEnd);
    this.#element.addEventListener('pointercancel', this.#pointerEnd);
  };

  /**
   * Listener for pointer/mouse/touch move events.
   */
  #move = (event: PointerEvent) => {
    if (!this.#excludeFromButtonsCheck.has(event.pointerId) && event.buttons === Buttons.None) {
      // This happens in a number of buggy cases where the browser failed to deliver a pointerup
      // or pointercancel. If we see the pointer moving without any buttons down, synthesize an end.
      // https://github.com/w3c/pointerevents/issues/407
      // https://github.com/w3c/pointerevents/issues/408
      this.#pointerEnd(event);
      return;
    }
    const previousPointers = this.currentPointers.slice();
    const changedPointers = [event];
    const trackedChangedPointers = [];

    for (const pointer of changedPointers) {
      const index = this.currentPointers.findIndex((p) => p.pointerId === pointer.pointerId);
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
  #triggerPointerEnd = (pointer: PointerEvent): boolean => {
    const index = this.currentPointers.findIndex((p) => p.pointerId === pointer.pointerId);
    // Not a pointer we're interested in?
    if (index === -1) return false;

    this.currentPointers.splice(index, 1);
    this.startPointers.splice(index, 1);
    this.#excludeFromButtonsCheck.delete(pointer.pointerId);

    // The event.type might be a 'move' event due to workarounds for weird mouse behaviour.
    // See _move for details.
    const cancelled = pointer.type !== 'pointerup';

    this.#endCallback(pointer, cancelled);
    return true;
  };

  /**
   * Listener for mouse/pointer ends.
   *
   * @param event This will only be a MouseEvent if the browser doesn't support pointer events.
   */
  #pointerEnd = (event: PointerEvent) => {
    if (!this.#triggerPointerEnd(event)) return;

    if (this.currentPointers.length) return;
    this.#element.removeEventListener(this.#rawUpdates ? 'pointerrawupdate' : 'pointermove', this.#move as any);
    this.#element.removeEventListener('pointerup', this.#pointerEnd);
    this.#element.removeEventListener('pointercancel', this.#pointerEnd);
  };
}
