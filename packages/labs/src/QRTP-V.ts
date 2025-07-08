import type { EncodedBlock, LtDecoder } from 'luby-transform';
import { binaryToBlock, blockToBinary, createDecoder, createEncoder } from 'luby-transform';

export interface QRTPVSenderOptions {
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
 * QRTPV Sender - Creates an async iterable stream of QR code data
 */
export class QRTPVSender {
  #fountain: Generator<EncodedBlock, void, unknown>;
  #frameRate: number;

  constructor(data: string, options: QRTPVSenderOptions = {}) {
    const blockSize = options.blockSize || 500;
    this.#frameRate = options.frameRate || 20;

    const dataBytes = new TextEncoder().encode(data);
    const encoder = createEncoder(dataBytes, blockSize);
    this.#fountain = encoder.fountain();
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<string> {
    while (true) {
      const { value: block } = this.#fountain.next();
      if (!block) break;

      const binaryData = blockToBinary(block);
      yield btoa(String.fromCharCode(...binaryData));

      await new Promise((resolve) => setTimeout(resolve, 1000 / this.#frameRate));
    }
  }
}

/**
 * QRTPV Receiver - Accumulates blocks and tracks progress
 */
export class QRTPVReceiver {
  #decoder: LtDecoder;
  #receivedIndices: Set<number> = new Set();
  #checksum: number | null = null;

  constructor() {
    this.#decoder = createDecoder();
  }

  addBlock(qrData: string): QRTPVProgress {
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

  reset(): void {
    this.#decoder = createDecoder();
    this.#receivedIndices.clear();
    this.#checksum = null;
  }
}
