import { Point } from '@lib';

export interface FolkSpace extends HTMLElement {
  transformPoint(point: Point): Point;

  elementsFromPoint(point: Point): Element[];

  elementsFromRect(rect: DOMRectReadOnly): Element[];
}

declare global {
  interface HTMLElementEventMap {
    'register-space': RegisterSpaceEvent;
    'unregister-space': UnregisterSpaceEvent;
  }
}

export class RegisterSpaceEvent extends Event {
  constructor() {
    super('register-space', { bubbles: true });
  }

  // #spaces: FolkSpace[] = [];

  // get spaces(): ReadonlyArray<FolkSpace> {
  //   return this.#spaces;
  // }

  // addSpace(space: FolkSpace) {
  //   this.#spaces.push(space);
  // }
}

export class UnregisterSpaceEvent extends Event {
  constructor() {
    super('unregister-space', { bubbles: true });
  }
}
