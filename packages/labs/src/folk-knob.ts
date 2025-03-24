import { FolkElement, Vector } from '@folkjs/lib';
import { css, property } from '@folkjs/lib/reactive-element';

// Ported from https://github.com/ivanreese/knob

class AngularPoint {
  x;
  y;
  angle;

  constructor(x = 0, y = 0, angle = 0) {
    this.x = x;
    this.y = y;
    this.angle = angle;
  }
}

export class FolkKnob extends FolkElement {
  static override tagName = 'folk-knob';

  static override styles = css`
    :host {
      display: block;
    }

    div {
      background-color:;
      border-radius: 50%;
      padding: 1rem;
    }
  `;

  /** Unconstrained angle the knob is turned, from -Infinity to Infinity. */
  @property({ type: Number, reflect: true }) value = 0;

  /** Normalized angle the knob is turned, from 0 to 359 degrees. */
  get normalizedValue() {
    return this.value % 360;
  }

  #div = document.createElement('div');
  #time = 0;
  #recent = [];
  #center = new AngularPoint();
  #usage = new AngularPoint();
  #activeCenter = new AngularPoint();
  #last = new AngularPoint();

  constructor() {
    super();

    this.addEventListener('pointerdown', this);
  }

  override createRenderRoot() {
    const root = super.createRenderRoot();

    root.appendChild(this.#div);

    return root;
  }

  handleEvent(event: PointerEvent) {
    switch (event.type) {
      case 'pointerdown': {
        const rect = this.getBoundingClientRect();
        this.#center = new AngularPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        this.#time = 0;
        this.#recent = [];
        this.#activeCenter = this.#center;
        this.#last = new AngularPoint(event.pageX, event.pageY);
        this.#last.angle = Vector.angleTo(this.#activeCenter, this.#last);

        this.addEventListener('pointermove', this);
        this.addEventListener('lostpointercapture', this);
        this.setPointerCapture(event.pointerId);
        break;
      }
      case 'pointermove': {
        const newPoint = new AngularPoint(event.pageX, event.pageY);
        newPoint.angle = Vector.angleTo(this.#activeCenter, newPoint);

        // update
        console.log('update');
        break;
      }
      case 'lostpointercapture': {
        this.removeEventListener('pointermove', this);
        this.removeEventListener('lostpointercapture', this);
        break;
      }
    }
  }
}
