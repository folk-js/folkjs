// QRTP - QR Transfer Protocol
// A simple data transfer protocol using QR codes

import { hash } from './utils/hash';
import { header } from './utils/header';

// Event types for external handlers
export type ChunkReceivedEvent = {
  index: number;
  total: number;
  payload: string;
};

export type AckReceivedEvent = {
  index: number;
  hash: string;
  matched: boolean;
};

export type TransmissionCompleteEvent = {
  data: string;
  totalChunks: number;
};

// Event callbacks
export type OnChunkReceivedCallback = (event: ChunkReceivedEvent) => void;
export type OnAckReceivedCallback = (event: AckReceivedEvent) => void;
export type OnTransmissionCompleteCallback = (event: TransmissionCompleteEvent) => void;

// Define typesafe header template using the header utility
const qrtpHeader = header('QRTP<index:num>/<total:num>:<hash:text>$');

export class QRTP {
  // Static configuration
  static readonly DEFAULT_CHUNK_SIZE: number = 100;

  // Private protocol state
  private _chunks: string[] = [];
  private _currentIndex = 0;
  private _receivedChunks = new Map<number, string>();
  private _lastReceivedHash = '';
  private _chunkSize = QRTP.DEFAULT_CHUNK_SIZE;

  // Event callbacks
  private _onChunkReceived: OnChunkReceivedCallback | null = null;
  private _onAckReceived: OnAckReceivedCallback | null = null;
  private _onTransmissionComplete: OnTransmissionCompleteCallback | null = null;

  // Public read-only properties
  get chunkSize(): number {
    return this._chunkSize;
  }
  get totalChunks(): number {
    return this._chunks.length;
  }
  get currentIndex(): number {
    return this._currentIndex;
  }
  get receivedChunksCount(): number {
    return this._receivedChunks.size;
  }
  get sendingProgress(): number {
    return this.totalChunks > 0 ? (this._currentIndex / this.totalChunks) * 100 : 0;
  }
  get receivingProgress(): number {
    const total = this.getMaxReceivedTotal();
    return total > 0 ? (this._receivedChunks.size / total) * 100 : 0;
  }
  get isComplete(): boolean {
    return this.totalChunks > 0 && this._currentIndex >= this.totalChunks;
  }

  constructor(options?: {
    onChunkReceived?: OnChunkReceivedCallback;
    onAckReceived?: OnAckReceivedCallback;
    onTransmissionComplete?: OnTransmissionCompleteCallback;
    chunkSize?: number;
  }) {
    if (options) {
      this._onChunkReceived = options.onChunkReceived || null;
      this._onAckReceived = options.onAckReceived || null;
      this._onTransmissionComplete = options.onTransmissionComplete || null;
      this._chunkSize = options.chunkSize || this._chunkSize;
    }
  }

  // Set data to be sent and chunk it
  setData(data: string, chunkSize?: number): void {
    // Reset state
    this._chunks = [];
    this._currentIndex = 0;

    // Update chunk size if provided
    if (chunkSize) this._chunkSize = chunkSize;

    // Skip if no data
    if (!data || data.trim() === '') return;

    // Split data into chunks
    for (let i = 0; i < data.length; i += this._chunkSize) {
      this._chunks.push(data.substring(i, i + this._chunkSize));
    }
  }

  // Get current QR code data to display
  getQRCode(): string {
    const hasChunks = this.totalChunks > 0 && this._currentIndex < this.totalChunks;
    const payload = hasChunks ? this._chunks[this._currentIndex] : '';

    return qrtpHeader.encode({
      index: hasChunks ? this._currentIndex : 0,
      total: this.totalChunks,
      hash: this._lastReceivedHash,
      payload,
    });
  }

  // Process received QR code data
  processQR(data: string): void {
    try {
      // Validate data format
      if (!data.startsWith('QRTP')) return;

      const packet = qrtpHeader.decode(data);

      // Handle acknowledgment
      if (packet.hash && this.totalChunks > 0 && this._currentIndex < this.totalChunks) {
        const expectedHash = hash(`${this._currentIndex}/${this.totalChunks}`, this._chunks[this._currentIndex]);
        const matched = packet.hash === expectedHash;

        if (matched) {
          this._currentIndex++;
        }

        // Trigger acknowledgment event
        if (this._onAckReceived) {
          this._onAckReceived({
            index: this._currentIndex - (matched ? 1 : 0),
            hash: packet.hash,
            matched,
          });
        }
      }

      // If no payload, it's just an acknowledgment
      if (!packet.payload) return;

      // Store received chunk
      this._receivedChunks.set(packet.index, packet.payload);
      this._lastReceivedHash = hash(`${packet.index}/${packet.total}`, packet.payload);

      // Trigger chunk received event
      if (this._onChunkReceived) {
        this._onChunkReceived({
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });
      }

      // Check if transmission is complete
      if (this._receivedChunks.size === packet.total) {
        // Combine chunks into complete data
        const data = Array.from({ length: packet.total })
          .map((_, i) => this._receivedChunks.get(i) || '')
          .join('');

        // Trigger transmission complete event
        if (this._onTransmissionComplete) {
          this._onTransmissionComplete({
            data,
            totalChunks: packet.total,
          });
        }
      }
    } catch (error) {
      // Silently ignore errors
    }
  }

  // Reset protocol state
  reset(): void {
    this._chunks = [];
    this._currentIndex = 0;
    this._receivedChunks = new Map();
    this._lastReceivedHash = '';
  }

  // Get specific chunk if needed
  getChunk(index: number): string | null {
    if (index >= 0 && index < this._chunks.length) {
      return this._chunks[index];
    }
    return null;
  }

  // Check if specific chunk was received
  hasChunk(index: number): boolean {
    return this._receivedChunks.has(index);
  }

  // Private helper methods
  private getMaxReceivedTotal(): number {
    let maxTotal = 0;
    this._receivedChunks.forEach((_, index) => {
      maxTotal = Math.max(maxTotal, index + 1);
    });
    return maxTotal;
  }
}
