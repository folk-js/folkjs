import EventEmitter from 'eventemitter3';
import { hash } from './utils/hash';
import { header } from './utils/header';

/** QRTP - Tiny QR Transfer Protocol with simple hash chaining */
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
  setMessage(data: string | null, chunkSize = 100): void {
    this.#sendingData = [];
    this.#sendingIndex = 0;
    this.#receivedData = [];
    this.#receivedAck = '';
    if (data) {
      for (let i = 0; i < data.length; i += chunkSize) {
        this.#sendingData.push(data.substring(i, i + chunkSize));
      }

      this.emit('init', {
        total: this.#sendingData.length,
        size: chunkSize,
        dataLength: data.length,
      });
    }

    this.#emitCodeUpdate();
  }

  /** Process incoming QR code when it is detected (e.g. via JSQR library) */
  parseCode(data: string): void {
    const packet = this.#header.decode(data);
    if (!packet) return;

    // Handle received chunk if it's new
    if (packet.payload && packet.index >= this.#receivedData.length) {
      this.#receivedData.push(packet.payload);
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

    // Handle acknowledgment of our outgoing message if we are sending
    if (packet.ack && this.isSending) {
      const expectedAck = hash(this.#sendingIndex, this.#sendingData.length, this.#sendingData[this.#sendingIndex]);
      if (packet.ack === expectedAck) {
        this.#sendingIndex++;
        this.emit('ack', { index: this.#sendingIndex, total: this.#sendingData.length });
      }
    }

    this.#emitCodeUpdate();
  }

  #emitCodeUpdate(): void {
    const payload = this.isSending ? this.#sendingData[this.#sendingIndex] : '';

    const code = this.#header.encode({
      index: this.#sendingIndex,
      total: this.#sendingData.length,
      ack: this.#receivedAck,
      payload,
    });

    this.emit('qrUpdate', { data: code });
  }
}
