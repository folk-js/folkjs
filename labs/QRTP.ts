// QRTP - QR Transfer Protocol
// A silly simple data transfer protocol using QR codes

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

export interface QRTPState {
  currentChunkIndex: number;
  totalChunks: number;
  receivedChunksCount: number;
  isTransmissionComplete: boolean;
}

// Define the packet structure that matches our header
export type QRTPPacket = {
  index: number;
  total: number;
  hash: string;
  payload?: string;
};

// Define typesafe header template using the header utility
const qrtpHeader = header('QRTP<index:num>/<total:num>:<hash:text>$');

export class QRTP {
  // Static configuration
  static readonly DEFAULT_CHUNK_SIZE: number = 100;

  // Data to be sent
  private dataToSend: string | null = null;
  private dataChunks: string[] = [];
  private currentChunkIndex: number = 0;
  private totalChunks: number = 0;

  // Data being received
  private receivedChunks: Map<number, string> = new Map();
  private lastReceivedHash: string = '';

  // Configuration
  private chunkSize: number = QRTP.DEFAULT_CHUNK_SIZE;

  // State
  private isTransmissionComplete: boolean = false;

  // Event callbacks
  private onChunkReceivedCallback: OnChunkReceivedCallback | null = null;
  private onAckReceivedCallback: OnAckReceivedCallback | null = null;
  private onTransmissionCompleteCallback: OnTransmissionCompleteCallback | null = null;

  constructor(options?: {
    onChunkReceived?: OnChunkReceivedCallback;
    onAckReceived?: OnAckReceivedCallback;
    onTransmissionComplete?: OnTransmissionCompleteCallback;
  }) {
    if (options) {
      this.onChunkReceivedCallback = options.onChunkReceived || null;
      this.onAckReceivedCallback = options.onAckReceived || null;
      this.onTransmissionCompleteCallback = options.onTransmissionComplete || null;
    }
  }

  // Set data to be sent and chunk it
  setData(data: string, chunkSize?: number): boolean {
    if (!data || data.trim() === '') {
      this.dataToSend = null;
      this.dataChunks = [];
      this.currentChunkIndex = 0;
      this.totalChunks = 0;
      this.isTransmissionComplete = false;
      return false;
    }

    this.dataToSend = data;
    this.chunkSize = chunkSize || this.chunkSize;
    this.chunkData();
    return true;
  }

  // Chunk the data into smaller pieces
  private chunkData(): void {
    this.dataChunks = [];
    this.currentChunkIndex = 0;
    this.isTransmissionComplete = false;

    if (!this.dataToSend) return;

    // Split text into chunks
    for (let i = 0; i < this.dataToSend.length; i += this.chunkSize) {
      const chunk = this.dataToSend.substring(i, i + this.chunkSize);
      this.dataChunks.push(chunk);
    }

    this.totalChunks = this.dataChunks.length;
  }

  // Generate hash for a chunk
  generateChunkHash(chunk: string, index: number, total: number): string {
    // Include index and total in the hash calculation to prevent issues with repeat chunks
    const dataToHash = `${index}/${total}:${chunk}`;

    // Simple hash function that considers chunk data and metadata
    let hash = 0;

    for (let i = 0; i < dataToHash.length; i++) {
      const char = dataToHash.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0; // Force 32-bit integer with | 0
    }

    // Convert to 8-character hex string with consistent sign handling
    const hashUint = hash < 0 ? hash + 4294967296 : hash; // Convert negative to positive
    const hashStr = hashUint.toString(16).padStart(8, '0');

    return hashStr;
  }

  // Get the current QR code data to display
  getCurrentQRCodeData(): string {
    // Create packet based on whether we have data to send
    const hasDataToSend = this.hasChunkToSend();
    const payload = hasDataToSend ? this.dataChunks[this.currentChunkIndex] : '';
    this.#checkComplete();

    return qrtpHeader.encode({
      index: hasDataToSend ? this.currentChunkIndex : 0,
      total: this.totalChunks || 0,
      hash: this.lastReceivedHash || '',
      payload,
    });
  }

  // Process received QR code data
  processReceivedData(data: string): void {
    try {
      // Basic validation and parsing
      if (!data.startsWith('QRTP')) return;

      const packet = qrtpHeader.decode(data);

      // EVENT 1: Process acknowledgment (if hash matches our current chunk)
      if (packet.hash && this.hasChunkToSend()) {
        const expectedHash = this.generateChunkHash(
          this.dataChunks[this.currentChunkIndex],
          this.currentChunkIndex,
          this.totalChunks,
        );

        const matched = packet.hash === expectedHash;

        if (matched) {
          // Advance to next chunk
          this.currentChunkIndex++;
          this.#checkComplete();
        }

        // Trigger ack received event
        if (this.onAckReceivedCallback) {
          this.onAckReceivedCallback({
            index: this.currentChunkIndex - (matched ? 1 : 0),
            hash: packet.hash,
            matched,
          });
        }
      }

      // If no payload, it's just an acknowledgment
      if (!packet.payload) return;

      // EVENT 2: Process incoming chunk
      this.receivedChunks.set(packet.index, packet.payload);
      this.lastReceivedHash = this.generateChunkHash(packet.payload, packet.index, packet.total);

      // Trigger chunk received event
      if (this.onChunkReceivedCallback) {
        this.onChunkReceivedCallback({
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });
      }

      // EVENT 3: Check if transmission is complete
      if (this.receivedChunks.size === packet.total) {
        const combinedData = Array.from({ length: packet.total })
          .map((_, i) => this.receivedChunks.get(i) || '')
          .join('');

        // Trigger transmission complete event
        if (this.onTransmissionCompleteCallback) {
          this.onTransmissionCompleteCallback({
            data: combinedData,
            totalChunks: packet.total,
          });
        }
      }
    } catch (error) {
      // Silently ignore errors - external handlers should implement their own error handling
    }
  }

  // Helper to check if we have chunks to send
  private hasChunkToSend(): boolean {
    return this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length;
  }

  // Reset the protocol state
  reset(): void {
    this.dataToSend = null;
    this.dataChunks = [];
    this.currentChunkIndex = 0;
    this.totalChunks = 0;
    this.receivedChunks = new Map();
    this.lastReceivedHash = '';
    this.isTransmissionComplete = false;
  }

  #checkComplete(): void {
    this.isTransmissionComplete = this.dataChunks.length > 0 && this.currentChunkIndex >= this.dataChunks.length;
  }

  // Get the number of chunks received
  getReceivedChunksCount(): number {
    return this.receivedChunks.size;
  }

  // Get the total number of chunks expected to receive
  getTotalChunksToReceive(): number {
    // Find the maximum total from all received chunks
    let maxTotal = 0;
    this.receivedChunks.forEach((_, index) => {
      maxTotal = Math.max(maxTotal, index + 1);
    });
    return maxTotal;
  }

  // Check if all chunks have been sent
  isAllChunksSent(): boolean {
    return this.isTransmissionComplete;
  }

  // Get sending progress percentage
  getSendingProgress(): number {
    if (this.totalChunks === 0) return 0;
    return (Math.min(this.currentChunkIndex, this.totalChunks) / this.totalChunks) * 100;
  }

  // Getters for internal state (useful for UI updates)
  getCurrentChunkIndex(): number {
    return this.currentChunkIndex;
  }

  getTotalChunks(): number {
    return this.totalChunks;
  }

  // Get data for a specific chunk
  getChunkData(index: number): string | null {
    if (index >= 0 && index < this.dataChunks.length) {
      return this.dataChunks[index];
    }
    return null;
  }

  // Check if a specific chunk has been received
  hasReceivedChunk(index: number): boolean {
    return this.receivedChunks.has(index);
  }
}
