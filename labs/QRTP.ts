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
  #header = header('QRTP<index:num>/<total:num>:<ack:text>');

  get isSending(): boolean {
    return this.#sendingData.length > 0 && this.#sendingIndex < this.#sendingData.length;
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
    if (!packet) return;

    // Handle their outgoing message (our receiving)
    if (packet.payload) {
      // Store the chunk if it's new
      if (packet.index >= this.#receivedData.length) {
        this.#receivedData.push(packet.payload);

        // Calculate acknowledgment hash for the chunk we just received
        this.#receivedAck = hash(packet.index, packet.total, packet.payload);

        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });

        if (this.#receivedData.length === packet.total) {
          this.emit('complete');
        }
      }
    }

    // Handle their acknowledgment of our message
    if (packet.ack && this.isSending) {
      const expectedAck = hash(this.#sendingIndex, this.#sendingData.length, this.#sendingData[this.#sendingIndex]);

      if (packet.ack === expectedAck) {
        this.#sendingIndex++;
        this.emit('ack', {
          index: this.#sendingIndex,
          total: this.#sendingData.length,
        });
      }
    }

    // Always update QR code after processing
    this.#emitCodeUpdate();
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
