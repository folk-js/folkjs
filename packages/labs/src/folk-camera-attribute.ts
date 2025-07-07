import { CustomAttribute } from '@folkjs/dom/CustomAttribute';

export class FolkCameraAttribute extends CustomAttribute {
  static override attributeName = 'folk-camera';

  #isConnected = true;
  // keep track of whether we turned on autoplay
  #autoplay = false;

  override async connectedCallback() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });

    if (!(this.ownerElement instanceof HTMLVideoElement)) {
      console.warn('[folk-camera] attribute only works with <video> elements.');
      return;
    }

    if (this.#isConnected) {
      this.ownerElement.srcObject = stream;

      this.#autoplay = this.ownerElement.autoplay;

      if (!this.#autoplay) {
        this.ownerElement.autoplay = true;
      }
    }
  }

  override disconnectedCallback() {
    if (!(this.ownerElement instanceof HTMLVideoElement)) return;

    this.#isConnected = false;

    this.ownerElement.srcObject = null;

    if (!this.#autoplay) {
      this.ownerElement.autoplay = false;
    }
  }
}
