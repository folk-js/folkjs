// QRTP - QR Transfer Protocol (Minimalist Edition)
import EventEmitter from 'eventemitter3';
import { hash } from './utils/hash';
import { header } from './utils/header';

const qrtpHeader = header('QRTP<index:num>/<total:num>:<hash:text>$');

// Event types
export type ChunkEvent = {
  index: number;
  total: number;
  payload: string;
};

export type AckEvent = {
  index: number;
  matched: boolean;
};

export type CompleteEvent = {
  data: string;
  total: number;
};

export class QRTP extends EventEmitter {
  // Static configuration
  static readonly DEFAULT_CHUNK_SIZE = 100;

  // Private state
  private _chunks: string[] = [];
  private _index = 0;
  private _received: string[] = [];
  private _receivedCount = 0;
  private _lastHash = '';

  // Progress information
  get progress() {
    const txTotal = this._chunks.length;
    const rxTotal = this._received.length;

    return {
      tx: txTotal ? Math.min(100, (this._index / txTotal) * 100) : 0,
      rx: rxTotal ? Math.min(100, (this._receivedCount / rxTotal) * 100) : 0,
    };
  }

  get stats() {
    return {
      chunks: this._chunks.length,
      index: this._index,
      received: this._receivedCount,
    };
  }

  // Send data
  setData(data: string, chunkSize = QRTP.DEFAULT_CHUNK_SIZE): void {
    this._chunks = [];
    this._index = 0;

    if (!data?.trim()) return;

    // Split into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this._chunks.push(data.substring(i, i + chunkSize));
    }
  }

  // Get QR code
  getQR(): string {
    const hasData = this._chunks.length > 0 && this._index < this._chunks.length;

    return qrtpHeader.encode({
      index: hasData ? this._index : 0,
      total: this._chunks.length,
      hash: this._lastHash,
      payload: hasData ? this._chunks[this._index] : '',
    });
  }

  // Process received QR code
  processQR(data: string): void {
    if (!data?.startsWith('QRTP')) return;

    try {
      const packet = qrtpHeader.decode(data);

      // Handle acknowledgment
      if (packet.hash && this._chunks.length > 0 && this._index < this._chunks.length) {
        const expectedHash = hash(`${this._index}/${this._chunks.length}`, this._chunks[this._index]);
        const matched = packet.hash === expectedHash;

        if (matched) this._index++;

        // Emit acknowledgment event
        this.emit('ack', {
          index: this._index - (matched ? 1 : 0),
          matched,
        });
      }

      // Process payload (if any)
      if (packet.payload) {
        // Store chunk
        if (!this._received[packet.total]) {
          // Initialize array if needed
          this._received = new Array(packet.total).fill('');
        }

        // Only count new chunks
        if (!this._received[packet.index]) {
          this._receivedCount++;
        }

        this._received[packet.index] = packet.payload;
        this._lastHash = hash(`${packet.index}/${packet.total}`, packet.payload);

        // Emit chunk received event
        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });

        // Check if complete
        if (this._receivedCount === packet.total) {
          const data = this._received.join('');

          // Emit transmission complete event
          this.emit('complete', {
            data,
            total: packet.total,
          });
        }
      }
    } catch (error) {
      // Silently ignore errors
    }
  }

  // Reset state
  reset(): void {
    this._chunks = [];
    this._index = 0;
    this._received = [];
    this._receivedCount = 0;
    this._lastHash = '';
  }
}
