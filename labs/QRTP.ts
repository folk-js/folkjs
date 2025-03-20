import EventEmitter from 'eventemitter3';
import { hash } from './utils/hash';
import { header } from './utils/header';

/**
 * QRTP - QR Transfer Protocol with simple hash chaining
 */
export class QRTP extends EventEmitter {
  #sendingData: string[] = []; // Data chunks to send
  #sendingIndex: number = 0; // Current send position
  #receivedData: string[] = []; // Received data chunks
  #receivedAck: string = ''; // Last computed hash for ack
  #receivedExpectedChunks: number = 0; // Total expected chunks
  #header = header('QRTP<index:num>/<total:num>:<ack:text>$');

  get chunks(): string[] {
    return [...this.#receivedData];
  }

  get sendState(): { index: number; total: number } {
    return {
      index: this.#sendingIndex,
      total: this.#sendingData.length,
    };
  }

  get isSending(): boolean {
    return this.#sendingData.length > 0 && this.#sendingIndex < this.#sendingData.length;
  }

  get isReceiving(): boolean {
    return this.#receivedData.length < this.#receivedExpectedChunks;
  }

  /**
   * Set data to be sent, breaking it into chunks
   * @param data The string data to send
   * @param chunkSize Size of each chunk in characters (default: 100)
   */
  setMessage(data: string, chunkSize = 100): void {
    this.#sendingData = [];
    this.#sendingIndex = 0;

    for (let i = 0; i < data.length; i += chunkSize) {
      this.#sendingData.push(data.substring(i, i + chunkSize));
    }

    this.emit('init', {
      total: this.#sendingData.length,
      size: chunkSize,
      dataLength: data.length,
    });

    // Emit QR code update after initialization
    this.#emitCodeUpdate();
  }

  /**
   * Process incoming QR code when it is detected (e.g. via JSQR library)
   */
  parseCode(data: string): void {
    if (!data?.startsWith('QRTP')) return;

    const packet = this.#header.decode(data);

    if (!packet) {
      console.error('Invalid QRTP packet');
      return;
    }

    // TODO: only do this at the start of the transfer
    this.#receivedExpectedChunks = packet.total;

    if (packet.payload) {
      const chunkIndex = packet.index;

      if (chunkIndex >= this.#receivedData.length) {
        this.#receivedData.push(packet.payload);
      }

      // Update our received hash - this is the hash of the message we just received
      // We will send this hash in our next QR code to acknowledge receipt
      this.#receivedAck = hash(chunkIndex, packet.total, packet.payload);

      // Emit chunk received
      this.emit('chunk', {
        index: chunkIndex,
        total: packet.total,
        payload: packet.payload,
      });

      // Check if transmission is complete
      if (!this.isReceiving) {
        this.emit('complete', {
          data: this.#receivedData.join(''),
          total: packet.total,
        });
      }

      // Emit QR code update after receiving a chunk
      this.#emitCodeUpdate();
    }

    if (packet.ack && this.isSending) {
      // Calculate what the hash of our current outgoing message would be
      const outgoingPayload = this.#sendingData[this.#sendingIndex];
      const expectedAck = hash(this.#sendingIndex, this.#sendingData.length, outgoingPayload);

      // If the received ack matches the hash of our current message,
      // the other device has successfully received it
      if (packet.ack === expectedAck) {
        // The other device has acknowledged our current message, move to next
        this.#sendingIndex++;
        this.#emitCodeUpdate();
        this.emit('ack', {
          index: this.#sendingIndex,
          total: this.#sendingData.length,
        });
      }
    }
  }

  /** Get outgoing QR code to display */
  currentCode(): string {
    const payload = this.isSending ? this.#sendingData[this.#sendingIndex] : '';

    const code = this.#header.encode({
      index: this.#sendingIndex,
      total: this.#sendingData.length,
      ack: this.#receivedAck,
      payload,
    });

    return code;
  }

  reset(): void {
    this.#sendingData = [];
    this.#sendingIndex = 0;
    this.#receivedData = [];
    this.#receivedAck = '';
    this.#emitCodeUpdate();
  }

  #emitCodeUpdate(): void {
    this.emit('qrUpdate', { data: this.currentCode() });
  }
}
