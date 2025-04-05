import { FolkElement } from '@folkjs/canvas';
import { css, property } from '@folkjs/canvas/reactive-element';
import * as V from '@folkjs/geometry/Vector2';
import { PI, RADIAN, TAU, toDOMPrecision } from '@folkjs/geometry/utilities';

const wrapAngle = (angle: number) => ((((angle + PI) % TAU) + TAU) % TAU) - PI;
const angle = (a: V.Vector2, b: V.Vector2) => V.angle(V.subtract(b, a));
const newPoint = (x = 0, y = 0, a = 0) => ({ x, y, a });

// Ported from https://github.com/ivanreese/knob/tree/main
export class FolkKnob extends FolkElement {
  static override tagName = 'folk-knob';

  static formAssociated = true;

  static override styles = css`
    :host {
      box-sizing: border-box;
      aspect-ratio: 1;
      background-color: #efefef;
      border: solid 1px black;
      border-radius: 50%;
      display: inline-block;
      inline-size: 27px;
      overflow-clip-margin: 0px !important;
      overflow: clip !important;
      position: relative;
      rotate: var(--folk-rotation, 0deg);
    }

    div {
      position: absolute;
      top: 30%;
      left: 50%;
      width: 12.5%;
      height: 35%;
      background: ButtonText;
      border-radius: 7px;
      translate: -50% -50%;
    }
  `;

  #internals = this.attachInternals();

  /** Unconstrained angle the knob is turned, from -Infinity to Infinity. */
  @property({ type: Number, reflect: true }) value = 0;

  /** Normalized angle the knob is turned, from 0 to 359 degrees. */
  get normalizedValue() {
    return this.value % 360;
  }

  get form() {
    return this.#internals.form;
  }

  get name() {
    return this.getAttribute('name') || '';
  }

  set name(value: string) {
    this.setAttribute('name', value);
  }

  get type() {
    return this.localName;
  }

  get validity() {
    return this.#internals.validity;
  }

  get validationMessage() {
    return this.#internals.validationMessage;
  }

  get willValidate() {
    return this.#internals.willValidate;
  }

  #div = document.createElement('div');

  last = newPoint();
  usage = newPoint();
  current = newPoint();
  recent = [newPoint()];

  center = V.fromValues();
  recentSize = V.fromValues();
  activeCenter = V.fromValues();

  time = 0;
  squareness = 0;
  computedValue = 0;

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.addEventListener('pointerdown', this);

    root.appendChild(this.#div);

    return root;
  }

  protected override willUpdate(): void {
    this.#internals.setFormValue(this.value.toString());
    this.style.setProperty('--folk-rotation', this.value + 'deg');
  }

  handleEvent(event: PointerEvent) {
    switch (event.type) {
      case 'pointerdown': {
        this.time = 0;
        this.recent = [];
        this.usage = newPoint();
        this.center = V.fromValues(window.innerWidth / 2, window.innerHeight / 2);
        this.activeCenter = this.center;
        this.last = newPoint(event.pageX, event.pageY);
        this.last.a = angle(this.activeCenter, this.last);
        this.addEventListener('pointermove', this);
        this.addEventListener('lostpointercapture', this);
        this.setPointerCapture(event.pointerId);
        break;
      }
      case 'pointermove': {
        const p = newPoint(event.pageX, event.pageY);
        p.a = angle(this.activeCenter, p);

        if (V.distance(p, this.last) <= 0) return;

        this.current = p;
        this.recent.unshift(this.current);
        // we want roughly 2 full loops around the mouse
        const radius = V.distance(this.activeCenter, this.current);
        const desiredLength = TAU * radius * 2;

        while (V.pathLength(this.recent) > desiredLength && this.recent.length > 2) {
          this.recent.pop();
        }

        const { min, max } = V.bounds.apply(null, this.recent);

        this.recentSize = V.subtract(max, min);

        const recentCenter = V.center(min, max);

        this.time++;
        this.activeCenter = V.lerp(this.center, recentCenter, this.time / 100);
        this.computedValue += this.#computedValueIncrement();
        this.squareness = 1 - Math.abs(Math.log(this.recentSize.x / this.recentSize.y));
        this.last = this.current;
        this.value = toDOMPrecision(this.computedValue * TAU * RADIAN);
        break;
      }
      case 'lostpointercapture': {
        this.removeEventListener('pointermove', this);
        this.removeEventListener('lostpointercapture', this);
        break;
      }
    }
  }

  #computedValueIncrement() {
    // If usage.x and usage.y are both 0, then useAngularInput will be unfairly biased toward true.
    // This can happen even when dragging straight if you get 1 usage.a right off the bat.
    // So, cardinal bias gives us some "free" initial x/y usage.
    const cardinalBias = 10;
    const preferAngularInput = this.usage.a > (cardinalBias + this.usage.x + this.usage.y) * 2;
    const useAngularInput = this.squareness > 0 || preferAngularInput;

    if (useAngularInput) {
      this.usage.a++;
      return wrapAngle(this.current.a - this.last.a) / TAU;
    } else if (this.recentSize.x > this.recentSize.y) {
      this.usage.x++;
      return (this.current.x - this.last.x) / (TAU * 20);
    } else {
      this.usage.y++;
      return -(this.current.y - this.last.y) / (TAU * 20);
    }
  }

  checkValidity() {
    return this.#internals.checkValidity();
  }

  reportValidity() {
    return this.#internals.reportValidity();
  }
}
