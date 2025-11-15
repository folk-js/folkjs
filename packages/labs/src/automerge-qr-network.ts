import type { Message as AutomergeMessage, PeerId } from '@automerge/vanillajs';
import { NetworkAdapter } from '@automerge/vanillajs';
import { QRTPC } from './QRTP-C';

/**
 * Network adapter that syncs Automerge documents over QR codes using QRTPC
 */
export class AutomergeQRNetwork extends NetworkAdapter {
  #sender: QRTPC;
  #receiver: QRTPC;
  #senderIterator: AsyncIterableIterator<string> | null = null;
  #isReady = false;
  #whenReadyResolve?: () => void;
  #whenReadyPromise: Promise<void>;

  // QR Update Callback
  #onQRUpdateCallback?: (qrData: string) => void;

  constructor() {
    super();
    this.#sender = new QRTPC();
    this.#receiver = new QRTPC();

    // Setup whenReady promise
    this.#whenReadyPromise = new Promise<void>((resolve) => {
      this.#whenReadyResolve = resolve;
    });
  }

  isReady(): boolean {
    return this.#isReady;
  }

  whenReady(): Promise<void> {
    return this.#whenReadyPromise;
  }

  /**
   * Set callback for QR code updates (for rendering)
   */
  onQRUpdate(callback: (qrData: string) => void) {
    this.#onQRUpdateCallback = callback;
  }

  /**
   * Process incoming QR code data from camera
   */
  receiveQRCode(qrData: string): boolean {
    try {
      const progress = this.#receiver.receive(qrData);

      if (progress.complete && progress.data) {
        // Parse the received message
        const message = JSON.parse(progress.data) as AutomergeMessage;

        // Emit message event for Automerge
        this.emit('message', message);

        // Reset receiver for next message
        this.#receiver.reset();

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error receiving QR code:', error);
      return false;
    }
  }

  // NetworkAdapter interface implementation
  connect(peerId: PeerId, peerMetadata?: Record<string, any>) {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
    this.#isReady = true;

    // Resolve whenReady promise
    if (this.#whenReadyResolve) {
      this.#whenReadyResolve();
    }

    // Simulate discovering a peer (in QR sync, we assume both devices are "connected")
    // Use a fixed peer ID for the "other" device
    const otherPeerId = 'qr-peer' as PeerId;
    this.emit('peer-candidate', { peerId: otherPeerId, peerMetadata: {} });
  }

  disconnect() {
    this.#isReady = false;
    this.#senderIterator = null;
  }

  send(message: AutomergeMessage) {
    if (!this.#isReady) return;

    // Serialize the message
    const messageJson = JSON.stringify(message);

    // Start sending through QRTPC
    this.#startSending(messageJson);
  }

  async #startSending(data: string) {
    // Stop previous sending
    this.#senderIterator = null;

    // Start new sending iterator
    this.#senderIterator = this.#sender.send(data, {
      blockSize: 400,
      frameRate: 20,
    });

    // Start the sending loop
    this.#sendNextBlock();
  }

  async #sendNextBlock() {
    if (!this.#senderIterator) return;

    try {
      const result = await this.#senderIterator.next();
      if (!result.done && result.value) {
        // Notify callback with new QR data
        if (this.#onQRUpdateCallback) {
          this.#onQRUpdateCallback(result.value);
        }

        // Schedule next block
        setTimeout(() => this.#sendNextBlock(), 0);
      }
    } catch (error) {
      console.error('Sending error:', error);
    }
  }
}
