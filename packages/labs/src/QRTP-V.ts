import type { EncodedBlock, LtEncoder } from 'luby-transform';
import { binaryToBlock, blockToBinary, createDecoder, createEncoder } from 'luby-transform';

// Default configuration
const DEFAULT_BLOCK_SIZE = 1000; // bits -> bytes (1000/8 = 125 bytes)
const DEFAULT_FRAME_RATE = 20; // fps

export interface QRTPVSenderOptions {
  blockSize?: number;
  frameRate?: number;
}

export interface QRTPVReceiverProgress {
  totalIndicesReceived: number;
  totalIndicesNeeded: number;
  originalBytes: number;
  progress: number;
  complete: boolean;
  data?: string;
}

/**
 * QRTPV Sender - Creates an async iterable stream of QR code data
 */
export class QRTPVSender {
  #fountain: Generator<EncodedBlock, void, unknown>;
  #frameRate: number;

  constructor(data: string, options: QRTPVSenderOptions = {}) {
    const blockSize = Math.floor((options.blockSize || DEFAULT_BLOCK_SIZE) / 8); // Convert bits to bytes
    this.#frameRate = options.frameRate || DEFAULT_FRAME_RATE;

    const dataBytes = new TextEncoder().encode(data);
    const encoder = createEncoder(dataBytes, blockSize);
    this.#fountain = encoder.fountain();
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<string> {
    while (true) {
      const { value: block } = this.#fountain.next();
      if (!block) break;

      const binaryData = blockToBinary(block);
      const base64Data = this.#uint8ArrayToBase64(binaryData);

      // Wait for next frame
      await this.#wait(1000 / this.#frameRate);

      yield base64Data;
    }
  }

  #uint8ArrayToBase64(uint8Array: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  #wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * QRTPV Receiver - Accumulates blocks and tracks progress
 */
export class QRTPVReceiver {
  #decoder: any;
  #receivedIndices: Set<number> = new Set();
  #totalBlocks: number = 0;
  #originalBytes: number = 0;
  #isCompleted: boolean = false;
  #currentMessageChecksum: number | null = null;
  #decodedData: string | null = null;

  constructor() {
    this.#decoder = createDecoder();
  }

  /**
   * Add a QR code block and return current progress
   */
  async addBlock(qrData: string): Promise<QRTPVReceiverProgress> {
    try {
      const binaryData = this.#base64ToUint8Array(qrData);
      const block = binaryToBlock(binaryData);

      // Check if this is a new message
      if (this.#currentMessageChecksum !== null && this.#currentMessageChecksum !== block.checksum) {
        this.reset();
      }

      // If already completed this message, return current state
      if (this.#isCompleted && this.#currentMessageChecksum === block.checksum) {
        return this.getProgress();
      }

      // Update state
      this.#currentMessageChecksum = block.checksum;
      this.#totalBlocks = block.k;
      this.#originalBytes = block.bytes;

      // Track which indices we've received for progress display
      const newIndices: number[] = [];
      for (const index of block.indices) {
        if (!this.#receivedIndices.has(index)) {
          this.#receivedIndices.add(index);
          newIndices.push(index);
        }
      }

      // Always try to decode (let the Luby decoder handle duplicates internally)
      if (!this.#isCompleted) {
        const isComplete = this.#decoder.addBlock(block);

        if (isComplete) {
          this.#isCompleted = true;
          const decodedData = this.#decoder.getDecoded();
          this.#decodedData = new TextDecoder().decode(decodedData);
        }
      }

      return this.getProgress();
    } catch (error) {
      throw new Error(`Failed to parse QR code: ${error}`);
    }
  }

  /**
   * Reset receiver for new message
   */
  reset(): void {
    this.#decoder = createDecoder();
    this.#receivedIndices.clear();
    this.#totalBlocks = 0;
    this.#originalBytes = 0;
    this.#isCompleted = false;
    this.#currentMessageChecksum = null;
    this.#decodedData = null;
  }

  /**
   * Get current progress state
   */
  getProgress(): QRTPVReceiverProgress {
    const progress = this.#totalBlocks > 0 ? this.#receivedIndices.size / this.#totalBlocks : 0;

    return {
      totalIndicesReceived: this.#receivedIndices.size,
      totalIndicesNeeded: this.#totalBlocks,
      originalBytes: this.#originalBytes,
      progress,
      complete: this.#isCompleted,
      data: this.#decodedData || undefined,
    };
  }

  #base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const uint8Array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      uint8Array[i] = binary.charCodeAt(i);
    }
    return uint8Array;
  }
}
