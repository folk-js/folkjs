import EventEmitter from 'eventemitter3';
import type { EncodedBlock } from 'luby-transform';
import { binaryToBlock, blockToBinary, createDecoder, createEncoder } from 'luby-transform';

/** QRTPV - A tiny QR-Video Transfer Protocol using Luby Transform
 * Each device shows QR codes containing luby transform encoded blocks
 * No backchannel - just continuous fountain of encoded blocks
 */
export class QRTPV extends EventEmitter {
  #encoder: any = null;
  #decoder: any = null;
  #originalData: string = '';
  #blockSize: number = 100;
  #currentBlockIndex: number = 0;
  #encodedBlocks: EncodedBlock[] = [];
  #isTransmitting: boolean = false;
  #transmitInterval: number | null = null;
  #frameRate: number = 2; // QR codes per second
  #receivedIndices: Set<number> = new Set();
  #totalBlocks: number = 0;
  #originalBytes: number = 0;
  #isCompleted: boolean = false;
  #currentMessageChecksum: number | null = null;

  constructor(blockSize: number = 100, frameRate: number = 2) {
    super();
    this.#blockSize = blockSize;
    this.#frameRate = frameRate;
    this.#decoder = createDecoder();
  }

  /**
   * Set data to be sent using luby transform encoding
   * @param data The string data to send
   */
  setMessage(data: string | null): void {
    this.stopTransmission();

    if (!data) {
      this.#originalData = '';
      this.#encoder = null;
      this.#encodedBlocks = [];
      this.emit('qrUpdate', { data: '' });
      return;
    }

    this.#originalData = data;
    const dataBytes = new TextEncoder().encode(data);
    this.#encoder = createEncoder(dataBytes, this.#blockSize);
    this.#encodedBlocks = [];
    this.#currentBlockIndex = 0;

    // Pre-generate some blocks for smooth transmission
    this.#generateBlocks(10);

    this.emit('init', {
      dataLength: data.length,
      blockSize: this.#blockSize,
      totalBlocks: Math.ceil(dataBytes.length / this.#blockSize),
    });

    // Start continuous transmission
    this.startTransmission();
  }

  /**
   * Start continuous QR code transmission
   */
  startTransmission(): void {
    if (this.#isTransmitting || !this.#encoder) return;

    this.#isTransmitting = true;
    this.#transmitInterval = window.setInterval(() => {
      this.#transmitNextBlock();
    }, 1000 / this.#frameRate);
  }

  /**
   * Stop QR code transmission
   */
  stopTransmission(): void {
    this.#isTransmitting = false;
    if (this.#transmitInterval) {
      clearInterval(this.#transmitInterval);
      this.#transmitInterval = null;
    }
  }

  /**
   * Process incoming QR code data
   */
  parseCode(data: string): boolean {
    try {
      // Try to parse as base64 encoded luby block
      const binaryData = this.#base64ToUint8Array(data);
      const block = binaryToBlock(binaryData);

      // Check if this is a new message (different checksum)
      if (this.#currentMessageChecksum !== null && this.#currentMessageChecksum !== block.checksum) {
        // New message detected, reset receiver state
        this.resetReceiver();
      }

      // If we've already completed this message, ignore further blocks
      if (this.#isCompleted && this.#currentMessageChecksum === block.checksum) {
        return true; // Already completed, don't process
      }

      // Update receiver state with block metadata
      this.#currentMessageChecksum = block.checksum;
      this.#totalBlocks = block.k;
      this.#originalBytes = block.bytes;

      // Track which indices we've received
      const newIndices: number[] = [];
      for (const index of block.indices) {
        if (!this.#receivedIndices.has(index)) {
          this.#receivedIndices.add(index);
          newIndices.push(index);
        }
      }

      const isComplete = this.#decoder.addBlock(block);

      // Only emit blockReceived if we have new indices
      if (newIndices.length > 0) {
        this.emit('blockReceived', {
          block: block,
          newIndices: newIndices,
          totalIndicesReceived: this.#receivedIndices.size,
          totalIndicesNeeded: this.#totalBlocks,
          originalBytes: this.#originalBytes,
          progress: this.#receivedIndices.size / this.#totalBlocks,
        });
      }

      if (isComplete && !this.#isCompleted) {
        this.#isCompleted = true;
        const decodedData = this.#decoder.getDecoded();
        const decodedText = new TextDecoder().decode(decodedData);

        this.emit('complete', {
          payload: decodedText,
          originalLength: decodedText.length,
          blocksReceived: this.#receivedIndices.size,
          totalBlocks: this.#totalBlocks,
        });
      }

      return isComplete;
    } catch (error) {
      this.emit('error', { message: 'Failed to parse QR code', error });
      return false;
    }
  }

  /**
   * Get current transmission status
   */
  getStatus() {
    return {
      isTransmitting: this.#isTransmitting,
      hasData: !!this.#encoder,
      originalDataLength: this.#originalData.length,
      currentBlockIndex: this.#currentBlockIndex,
      frameRate: this.#frameRate,
      // Receiver status
      receivedIndices: Array.from(this.#receivedIndices).sort((a, b) => a - b),
      totalBlocks: this.#totalBlocks,
      originalBytes: this.#originalBytes,
      progress: this.#totalBlocks > 0 ? this.#receivedIndices.size / this.#totalBlocks : 0,
      isCompleted: this.#isCompleted,
    };
  }

  /**
   * Update frame rate for QR transmission
   */
  setFrameRate(frameRate: number): void {
    this.#frameRate = frameRate;
    if (this.#isTransmitting) {
      this.stopTransmission();
      this.startTransmission();
    }
  }

  /**
   * Reset receiver state for new message
   */
  resetReceiver(): void {
    this.#decoder = createDecoder();
    this.#receivedIndices.clear();
    this.#totalBlocks = 0;
    this.#originalBytes = 0;
    this.#isCompleted = false;
    this.#currentMessageChecksum = null;
  }

  #generateBlocks(count: number): void {
    if (!this.#encoder) return;

    const fountain = this.#encoder.fountain();
    for (let i = 0; i < count; i++) {
      const block = fountain.next().value;
      if (block) {
        this.#encodedBlocks.push(block);
      }
    }
  }

  #transmitNextBlock(): void {
    if (!this.#encoder) return;

    // Generate more blocks if we're running low
    if (this.#currentBlockIndex >= this.#encodedBlocks.length - 2) {
      this.#generateBlocks(10);
    }

    if (this.#currentBlockIndex < this.#encodedBlocks.length) {
      const block = this.#encodedBlocks[this.#currentBlockIndex];
      const binaryData = blockToBinary(block);
      const base64Data = this.#uint8ArrayToBase64(binaryData);

      this.emit('qrUpdate', {
        data: base64Data,
        block: {
          transmitIndex: this.#currentBlockIndex,
          indices: block.indices,
          totalOriginalBlocks: block.k,
          originalBytes: block.bytes,
        },
      });

      this.#currentBlockIndex++;
    }
  }

  #uint8ArrayToBase64(uint8Array: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
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
