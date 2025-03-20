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
  #receivedHash: string = ''; // Last computed hash for ack
  #header = header('QRTP<index:num>/<total:num>:<hash:text>$');

  get chunks(): string[] {
    return [...this.#receivedData];
  }

  get sendState(): { index: number; total: number } {
    return {
      index: this.#sendingIndex,
      total: this.#sendingData.length,
    };
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
   * Process QR code when it is detected (e.g. via JSQR library)
   */
  parseCode(data: string): void {
    if (!data?.startsWith('QRTP')) return;

    const packet = this.#header.decode(data);

    if (!packet) {
      console.error('Invalid QRTP packet');
      return;
    }

    if (packet.payload) {
      // Initialize or resize receive array if needed
      if (this.#receivedData.length !== packet.total) {
        this.#receivedData = new Array(packet.total).fill('');
      }

      // Store the chunk
      this.#receivedData[packet.index] = packet.payload;

      // Calculate hash for acknowledgment - CRITICAL for ACK
      this.#receivedHash = hash(packet.index, packet.total, packet.payload);

      // Emit chunk received
      this.emit('chunk', {
        index: packet.index,
        total: packet.total,
        payload: packet.payload,
      });

      // Check if transmission is complete
      const receivedCount = this.#receivedData.filter((chunk) => chunk !== '').length;
      if (receivedCount === packet.total) {
        this.emit('complete', {
          data: this.#receivedData.join(''),
          total: packet.total,
        });
      }

      // Emit QR code update after receiving a chunk
      this.#emitCodeUpdate();
    }

    if (packet.hash) {
      let matched = false;

      // Only try to match if we have chunks to send
      if (this.#sendingData.length > 0 && this.#sendingIndex < this.#sendingData.length) {
        const outgoingPayload = this.#sendingData[this.#sendingIndex];
        const ourHash = hash(this.#sendingIndex, this.#sendingData.length, outgoingPayload);
        matched = packet.hash === ourHash;

        if (matched) {
          this.#sendingIndex++;
          this.#emitCodeUpdate();
        }
      }

      this.emit('ack', {
        index: this.#sendingIndex - (matched ? 1 : 0),
        matched,
        total: this.#sendingData.length,
      });
    }
  }

  /**
   * Get current QR code to display
   */
  currentCode(): string {
    const hasData = this.#sendingData.length > 0 && this.#sendingIndex < this.#sendingData.length;

    return this.#header.encode({
      index: hasData ? this.#sendingIndex : 0,
      total: this.#sendingData.length,
      hash: this.#receivedHash,
      payload: hasData ? this.#sendingData[this.#sendingIndex] : '',
    });
  }

  /**
   * Reset the protocol state
   */
  reset(): void {
    this.#sendingData = [];
    this.#sendingIndex = 0;
    this.#receivedData = [];
    this.#receivedHash = '';

    this.#emitCodeUpdate();
  }

  #emitCodeUpdate(): void {
    this.emit('qrUpdate', { data: this.currentCode() });
  }
}
