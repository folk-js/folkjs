import { ReactiveElement, css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';

// Adopted from Bailey Townsend: https://tangled.org/strings/did:plc:rnpkyqnmsw4ipey6eotbdnnf/3mfpww4dysk22
export class StreamPlaceStream extends ReactiveElement {
  static override tagName = 'sp-stream';

  static override styles = css`
    :host {
      display: block;
    }

    video {
      height: 100%;
      width: 100%;
    }
  `;

  @property({ type: String }) handle = '';

  #video = document.createElement('video');
  #peerConnection: RTCPeerConnection | null = null;

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#video.autoplay = true;
    this.#video.playsInline = true;
    this.#video.muted = true;

    root.appendChild(this.#video);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('handle')) {
      this.#connectRTC();
    }
  }

  override disconnectedCallback(): void {
    this.#disconnectRTC();
  }

  async #connectRTC() {
    this.#disconnectRTC();

    if (this.handle === '') return;

    const whepUrl = `https://stream.place/api/playback/${encodeURIComponent(this.handle)}/webrtc?rendition=source`;

    try {
      this.#peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        bundlePolicy: 'max-bundle',
      });

      this.#peerConnection.addTransceiver('video', { direction: 'recvonly' });
      this.#peerConnection.addTransceiver('audio', { direction: 'recvonly' });

      this.#peerConnection.ontrack = (event) => {
        console.log(`Track received: ${event.track.kind}`, 'success');
        if (event.streams && event.streams[0]) {
          this.#video.srcObject = event.streams[0];
        } else {
          if (!this.#video.srcObject) {
            this.#video.srcObject = new MediaStream();
          }
          (this.#video.srcObject as MediaStream).addTrack(event.track);
        }
        this.#video.play().catch(() => {});
      };

      this.#peerConnection.oniceconnectionstatechange = () => {
        if (this.#peerConnection === null) return;

        console.log(`ICE: ${this.#peerConnection.iceConnectionState}`);
        if (
          this.#peerConnection.iceConnectionState === 'connected' ||
          this.#peerConnection.iceConnectionState === 'completed'
        ) {
        } else if (
          this.#peerConnection.iceConnectionState === 'failed' ||
          this.#peerConnection.iceConnectionState === 'disconnected'
        ) {
          console.log('Connection lost', 'error');
        }
      };

      this.#peerConnection.onconnectionstatechange = () => {
        if (this.#peerConnection === null) return;

        console.log(`Connection: ${this.#peerConnection.connectionState}`);
        if (this.#peerConnection.connectionState === 'failed') {
          console.log('PeerConnection failed', 'error');
        }
      };

      const offer = await this.#peerConnection.createOffer();
      await this.#peerConnection.setLocalDescription(offer);
      await this.#waitForIceGathering(2000);

      console.log('Sending SDP offer\u2026');

      const resp = await fetch(whepUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: this.#peerConnection.localDescription!.sdp,
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`WHEP ${resp.status}: ${errText}`);
      }

      const answerSdp = await resp.text();
      console.log('Received SDP answer', 'success');

      await this.#peerConnection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });
      console.log('Remote description set, waiting for media\u2026');
    } catch (error) {
      // TODO display error
      console.error(error);
    }
  }

  #waitForIceGathering(timeout = 2000) {
    return new Promise<void>((resolve, reject) => {
      if (this.#peerConnection === null) {
        reject();
        return;
      }

      if (this.#peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        console.log('ICE gathering timed out, proceeding with candidates');
        resolve();
      }, timeout);

      this.#peerConnection.onicegatheringstatechange = () => {
        if (this.#peerConnection === null) return;

        if (this.#peerConnection.iceGatheringState === 'complete') {
          clearTimeout(timer);
          console.log('ICE gathering complete');
          resolve();
        }
      };
    });
  }

  #disconnectRTC() {
    this.#peerConnection?.close();
    this.#peerConnection = null;
    this.#video.srcObject = null;
  }
}
