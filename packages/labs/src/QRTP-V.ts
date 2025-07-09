import type { EncodedBlock, LtDecoder } from 'luby-transform';
import { binaryToBlock, blockToBinary, createDecoder, createEncoder } from 'luby-transform';

export interface QRTPVOptions {
  blockSize?: number; // in bytes
  frameRate?: number; // fps
}

export interface QRTPVProgress {
  received: number;
  needed: number;
  complete: boolean;
  data?: string;
}

/**
 * QRTPV - Unified class for sending and receiving data over QR codes using Luby Transform
 */
export class QRTPV {
  // Receiver state
  #decoder: LtDecoder = createDecoder();
  #receivedIndices: Set<number> = new Set();
  #checksum: number | null = null;

  /**
   * Send data as an async iterable stream of QR code strings
   */
  async *send(data: string, options: QRTPVOptions = {}): AsyncIterableIterator<string> {
    const blockSize = options.blockSize || 500;
    const frameRate = options.frameRate || 20;

    const dataBytes = new TextEncoder().encode(data);
    const encoder = createEncoder(dataBytes, blockSize);
    const fountain = encoder.fountain();

    while (true) {
      const { value: block } = fountain.next();
      if (!block) break;

      const binaryData = blockToBinary(block);
      yield btoa(String.fromCharCode(...binaryData));

      await new Promise((resolve) => setTimeout(resolve, 1000 / frameRate));
    }
  }

  /**
   * Receive QR code data and return progress
   */
  receive(qrData: string): QRTPVProgress {
    const binary = atob(qrData);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      data[i] = binary.charCodeAt(i);
    }

    const block = binaryToBlock(data);

    // Reset on new message
    if (this.#checksum !== null && this.#checksum !== block.checksum) {
      this.reset();
    }
    this.#checksum = block.checksum;

    // Track indices
    for (const index of block.indices) {
      this.#receivedIndices.add(index);
    }

    // Decode
    const complete = this.#decoder.addBlock(block);

    return {
      received: this.#receivedIndices.size,
      needed: block.k,
      complete,
      data: complete ? new TextDecoder().decode(this.#decoder.getDecoded()) : undefined,
    };
  }

  /**
   * Reset receiver state for new message
   */
  reset(): void {
    this.#decoder = createDecoder();
    this.#receivedIndices.clear();
    this.#checksum = null;
  }
}
