import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';

class NetworkIndicator extends ReactiveElement {
  static override tagName = 'network-indicator';

  static override styles = css`
    :host {
      all: unset;
      display: block;
      position: fixed;
      top: 5px;
      right: 5px;
      width: 5px;
      aspect-ratio: 1;
      border-radius: 50%;
      background: grey;
      pointer-events: none;
      transition: background 500ms ease-out;
    }

    :host([active]) {
      transition: background 50ms ease-out;
      background: #0add08;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();

    this.popover = 'manual';
    this.showPopover();
  }
}

NetworkIndicator.define();

const networkIndicator = document.createElement('network-indicator');
networkIndicator.id = 'folk-network-indicator';
document.documentElement.appendChild(networkIndicator);
