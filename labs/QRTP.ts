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

  // Protocol state
  private chunkSize = QRTP.DEFAULT_CHUNK_SIZE;
  private chunks: string[] = [];
  private currentIndex = 0;
  private receivedChunks = new Map<number, string>();
  private lastReceivedHash = '';

  // Event callbacks
  private onChunkReceived: OnChunkReceivedCallback | null = null;
  private onAckReceived: OnAckReceivedCallback | null = null;
  private onTransmissionComplete: OnTransmissionCompleteCallback | null = null;

  constructor(options?: {
    onChunkReceived?: OnChunkReceivedCallback;
    onAckReceived?: OnAckReceivedCallback;
    onTransmissionComplete?: OnTransmissionCompleteCallback;
    chunkSize?: number;
  }) {
    if (options) {
      this.onChunkReceived = options.onChunkReceived || null;
      this.onAckReceived = options.onAckReceived || null;
      this.onTransmissionComplete = options.onTransmissionComplete || null;
      this.chunkSize = options.chunkSize || this.chunkSize;
    }
  }

  // Set data to be sent and chunk it
  setData(data: string, chunkSize?: number): void {
    // Reset state
    this.chunks = [];
    this.currentIndex = 0;

    // Update chunk size if provided
    if (chunkSize) this.chunkSize = chunkSize;

    // Skip if no data
    if (!data || data.trim() === '') return;

    // Split data into chunks
    for (let i = 0; i < data.length; i += this.chunkSize) {
      this.chunks.push(data.substring(i, i + this.chunkSize));
    }
  }

  // Get current QR code data to display
  getCurrentQRCodeData(): string {
    const hasChunks = this.chunks.length > 0 && this.currentIndex < this.chunks.length;
    const payload = hasChunks ? this.chunks[this.currentIndex] : '';

    return qrtpHeader.encode({
      index: hasChunks ? this.currentIndex : 0,
      total: this.chunks.length,
      hash: this.lastReceivedHash,
      payload,
    });
  }

  // Process received QR code data
  processReceivedData(data: string): void {
    try {
      // Validate data format
      if (!data.startsWith('QRTP')) return;

      const packet = qrtpHeader.decode(data);

      // Handle acknowledgment
      if (packet.hash && this.chunks.length > 0 && this.currentIndex < this.chunks.length) {
        const expectedHash = hash(`${this.currentIndex}/${this.chunks.length}`, this.chunks[this.currentIndex]);
        const matched = packet.hash === expectedHash;

        if (matched) {
          this.currentIndex++;
        }

        // Trigger acknowledgment event
        if (this.onAckReceived) {
          this.onAckReceived({
            index: this.currentIndex - (matched ? 1 : 0),
            hash: packet.hash,
            matched,
          });
        }
      }

      // If no payload, it's just an acknowledgment
      if (!packet.payload) return;

      // Store received chunk
      this.receivedChunks.set(packet.index, packet.payload);
      this.lastReceivedHash = hash(`${packet.index}/${packet.total}`, packet.payload);

      // Trigger chunk received event
      if (this.onChunkReceived) {
        this.onChunkReceived({
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });
      }

      // Check if transmission is complete
      if (this.receivedChunks.size === packet.total) {
        // Combine chunks into complete data
        const data = Array.from({ length: packet.total })
          .map((_, i) => this.receivedChunks.get(i) || '')
          .join('');

        // Trigger transmission complete event
        if (this.onTransmissionComplete) {
          this.onTransmissionComplete({
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
    this.chunks = [];
    this.currentIndex = 0;
    this.receivedChunks = new Map();
    this.lastReceivedHash = '';
  }

  // Basic getters for UI integration
  isSendingComplete(): boolean {
    return this.chunks.length > 0 && this.currentIndex >= this.chunks.length;
  }

  getSendingProgress(): number {
    return this.chunks.length ? (this.currentIndex / this.chunks.length) * 100 : 0;
  }

  getReceivingProgress(): number {
    const total = this.getMaxReceivedTotal();
    return total ? (this.receivedChunks.size / total) * 100 : 0;
  }

  private getMaxReceivedTotal(): number {
    let maxTotal = 0;
    this.receivedChunks.forEach((_, index) => {
      maxTotal = Math.max(maxTotal, index + 1);
    });
    return maxTotal;
  }

  // Provide public access to protocol state
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getTotalChunks(): number {
    return this.chunks.length;
  }

  getChunkData(index: number): string | null {
    if (index >= 0 && index < this.chunks.length) {
      return this.chunks[index];
    }
    return null;
  }

  hasReceivedChunk(index: number): boolean {
    return this.receivedChunks.has(index);
  }
}
