import EventEmitter from 'eventemitter3';
import { GGWave } from './ggwave';
import { codec } from './utils/codecString';

interface QRTPBOptions {
  audioVisualizer?: (node: AudioNode | null, context: AudioContext) => void;
  audioVolume?: number;
  frameRate?: number;
  ackInterval?: number;
}

/**
 * QRTP-B - QR Transfer Protocol with Audio Backchannel
 *
 * Clean API:
 * - new QRTPB(options) - unified constructor
 * - send(data, chunkSize) - returns async iterator for QR codes
 * - receive(qrDataStream) - returns async iterator for received chunks
 * - dispose() - cleanup
 */
export class QRTPB extends EventEmitter {
  #chunksMap: Map<number, string> = new Map();
  #receivedIndices: Set<number> = new Set();
  #unacknowledgedIndices: Set<number> = new Set();
  #acknowledgedIndices: Set<number> = new Set();
  #header = codec('QRTPB<index:num>/<total:num>');
  #ackHeader = codec('QB<ranges:numPairs>');
  #ggwave: GGWave | null = new GGWave();
  #audioAckTimer: ReturnType<typeof setInterval> | null = null;
  #role: 'sender' | 'receiver' | null = null;
  #audioAckInterval: number;
  #isAudioInitialized: boolean = false;
  #audioVolume: number;
  #totalChunks: number = 0;
  #frameRate: number;
  #message: string = '';
  #checksum: string = '';

  constructor(options: QRTPBOptions = {}) {
    super();
    this.#audioVolume = options.audioVolume ?? 80;
    this.#frameRate = options.frameRate ?? 15;
    this.#audioAckInterval = options.ackInterval ?? 2000;

    if (options.audioVisualizer) {
      this.#ggwave?.setVisualizer(options.audioVisualizer);
    }
  }

  #processQRCode(data: string) {
    if (this.#role !== 'receiver') return null;

    const packet = this.#header.decode(data);
    if (!packet) return null;

    if (packet.total > this.#totalChunks) {
      this.#totalChunks = packet.total;
    }

    if (packet.payload && packet.index >= 0 && packet.index < packet.total) {
      const isNewChunk = !this.#receivedIndices.has(packet.index);

      if (isNewChunk) {
        this.#chunksMap.set(packet.index, packet.payload);
        this.#receivedIndices.add(packet.index);
        this.#unacknowledgedIndices.add(packet.index);

        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
          receivedCount: this.#receivedIndices.size,
          receivedIndices: Array.from(this.#receivedIndices),
          unacknowledgedIndices: Array.from(this.#unacknowledgedIndices),
        });

        const isComplete = this.#receivedIndices.size === packet.total;
        if (isComplete) {
          this.#updateCompleteMessage();
        }

        return {
          index: packet.index,
          payload: packet.payload,
          total: packet.total,
          isComplete,
          message: isComplete ? this.#message : undefined,
        };
      }
    }

    return null;
  }

  /**
   * Compute a simple synchronous checksum
   */
  #computeChecksum(data: string): string {
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0').slice(-8);
  }

  /**
   * Send data as QR codes with audio backchannel
   * Returns async iterator of QR code data
   */
  async *send(data: string, chunkSize = 500): AsyncIterableIterator<{ data: string; index: number; total: number }> {
    this.#role = 'sender';
    this.#chunksMap = new Map();
    this.#acknowledgedIndices = new Set();
    this.#message = data;
    this.#checksum = this.#computeChecksum(data);

    // Break data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this.#chunksMap.set(Math.floor(i / chunkSize), data.substring(i, i + chunkSize));
    }

    this.#totalChunks = this.#chunksMap.size;

    this.emit('init', {
      total: this.#totalChunks,
      size: chunkSize,
      dataLength: data.length,
      checksum: this.#checksum,
    });

    // Initialize audio for acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#ggwave!.ready();
      this.#ggwave!.startListening(this.#handleAudioReceived.bind(this));
      this.#isAudioInitialized = true;
    }

    // Stream QR codes
    let currentIndex = 0;
    while (this.#acknowledgedIndices.size < this.#totalChunks) {
      let nextIndex = currentIndex;
      let attempts = 0;

      while (this.#acknowledgedIndices.has(nextIndex) && attempts < this.#totalChunks) {
        nextIndex = (nextIndex + 1) % this.#totalChunks;
        attempts++;
      }

      if (attempts >= this.#totalChunks) break;

      const payload = this.#chunksMap.get(nextIndex) || '';
      const qrData = this.#header.encode({
        index: nextIndex,
        total: this.#totalChunks,
        payload,
      });

      yield { data: qrData, index: nextIndex, total: this.#totalChunks };

      currentIndex = (nextIndex + 1) % this.#totalChunks;
      await new Promise((resolve) => setTimeout(resolve, 1000 / this.#frameRate));
    }
  }

  /**
   * Receive data from QR codes with audio backchannel
   * Pass in an async iterable of QR code strings (e.g., from camera)
   * Returns async iterator of received message chunks
   */
  async *receive(qrDataStream: AsyncIterable<string>): AsyncIterableIterator<{
    index: number;
    payload: string;
    total: number;
    isComplete: boolean;
    message?: string;
  }> {
    this.#role = 'receiver';
    this.#chunksMap = new Map();
    this.#totalChunks = 0;
    this.#receivedIndices = new Set();
    this.#unacknowledgedIndices = new Set();
    this.#message = '';
    this.#checksum = '';

    // Initialize audio for acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#ggwave!.ready();
      this.#ggwave!.setProtocol(GGWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);
      this.#isAudioInitialized = true;
    }

    this.#startPeriodicAcks();

    // Process incoming QR codes
    for await (const qrData of qrDataStream) {
      const result = this.#processQRCode(qrData);
      if (result) {
        yield result;
      }
    }
  }

  /**
   * Update the complete message when all chunks are received
   */
  #updateCompleteMessage(): void {
    const orderedChunks: string[] = [];
    let hasAllChunks = true;

    for (let i = 0; i < this.#totalChunks; i++) {
      const chunk = this.#chunksMap.get(i);
      if (chunk) {
        orderedChunks.push(chunk);
      } else {
        hasAllChunks = false;
        break;
      }
    }

    if (hasAllChunks) {
      this.#message = orderedChunks.join('');
      this.#checksum = this.#computeChecksum(this.#message);

      this.emit('complete', {
        message: this.#message,
        receivedIndices: Array.from(this.#receivedIndices),
        totalChunks: this.#totalChunks,
        checksum: this.#checksum,
      });
    }
  }

  /**
   * Start periodic audio acknowledgments - simple flush system
   */
  #startPeriodicAcks(): void {
    if (this.#audioAckTimer) {
      clearInterval(this.#audioAckTimer);
    }

    this.#audioAckTimer = setInterval(() => {
      if (this.#role === 'receiver' && this.#unacknowledgedIndices.size > 0) {
        this.#sendAudioAck();
      }
    }, this.#audioAckInterval);
  }

  /**
   * Convert indices to optimized ranges using full received context
   * Supports wrapped ranges that span across the end/beginning boundary
   */
  #optimizeRanges(indicesToAck: number[]): [number, number][] {
    if (indicesToAck.length === 0) return [];

    const sortedIndices = [...indicesToAck].sort((a, b) => a - b);
    const optimizedRanges: [number, number][] = [];
    let i = 0;

    while (i < sortedIndices.length) {
      const currentIndex = sortedIndices[i];

      // Expand left using full received set
      let rangeStart = currentIndex;
      while (rangeStart - 1 >= 0 && this.#receivedIndices.has(rangeStart - 1)) {
        rangeStart--;
      }

      // Expand right using full received set
      let rangeEnd = currentIndex;
      while (rangeEnd + 1 <= this.#totalChunks - 1 && this.#receivedIndices.has(rangeEnd + 1)) {
        rangeEnd++;
      }

      optimizedRanges.push([rangeStart, rangeEnd]);

      // Skip past all indices we've included in this range
      while (i < sortedIndices.length && sortedIndices[i] <= rangeEnd) {
        i++;
      }
    }

    // Check if we can merge the first and last ranges into a wrapped range
    if (optimizedRanges.length >= 2) {
      const firstRange = optimizedRanges[0];
      const lastRange = optimizedRanges[optimizedRanges.length - 1];

      // Can wrap if last range ends at the boundary and first range starts at 0
      if (lastRange[1] === this.#totalChunks - 1 && firstRange[0] === 0) {
        // Create wrapped range: [lastRangeStart, firstRangeEnd]
        const wrappedRange: [number, number] = [lastRange[0], firstRange[1]];

        // Replace first and last ranges with the wrapped range
        return [wrappedRange, ...optimizedRanges.slice(1, -1)];
      }
    }

    return optimizedRanges;
  }

  /**
   * Send acknowledgment via audio - simplified flush system
   */
  async #sendAudioAck(): Promise<void> {
    if (!this.#ggwave || this.#role !== 'receiver' || this.#unacknowledgedIndices.size === 0) {
      return;
    }

    try {
      // Get all unacknowledged indices
      const indicesToAck = Array.from(this.#unacknowledgedIndices);

      // Convert to optimized ranges using full received context
      const ranges = this.#optimizeRanges(indicesToAck);

      if (ranges.length > 0) {
        const ackMessage = this.#ackHeader.encode({ ranges });
        await this.#ggwave.send(ackMessage, this.#audioVolume);
      }

      // Clear the unacknowledged set - we've sent everything
      this.#unacknowledgedIndices.clear();
    } catch (error) {
      console.error('Failed to send audio acknowledgment:', error);
    }
  }

  /**
   * Handle received audio message containing acknowledgments
   */
  #handleAudioReceived(message: string): void {
    if (this.#role !== 'sender') return;

    const packet = this.#ackHeader.decode(message);
    if (!packet) return;

    try {
      let hasNewAcks = false;

      // Convert ranges to individual indices
      const indices = this.#rangesToIndices(packet.ranges);

      for (const index of indices) {
        if (!this.#acknowledgedIndices.has(index) && index >= 0 && index < this.#totalChunks) {
          this.#acknowledgedIndices.add(index);
          hasNewAcks = true;
        }
      }

      if (hasNewAcks) {
        this.emit('ack', {
          acknowledged: Array.from(this.#acknowledgedIndices),
          remaining: this.#totalChunks - this.#acknowledgedIndices.size,
        });
      }
    } catch (error) {
      console.error('Failed to parse audio acknowledgment:', error);
    }
  }

  /**
   * Convert ranges to individual indices
   * Handles both normal ranges [start, end] and wrapped ranges where start > end
   */
  #rangesToIndices(ranges: [number, number][]): number[] {
    const indices: number[] = [];
    for (const [start, end] of ranges) {
      if (start <= end) {
        // Normal range
        for (let i = start; i <= end; i++) {
          indices.push(i);
        }
      } else {
        // Wrapped range: from start to end of chunks, then from 0 to end
        for (let i = start; i < this.#totalChunks; i++) {
          indices.push(i);
        }
        for (let i = 0; i <= end; i++) {
          indices.push(i);
        }
      }
    }
    return indices;
  }

  /**
   * Stop all activity and clean up resources
   */
  dispose(): void {
    if (this.#audioAckTimer) {
      clearInterval(this.#audioAckTimer);
      this.#audioAckTimer = null;
    }

    if (this.#ggwave) {
      this.#ggwave.stopListening();
      this.#ggwave.dispose();
      this.#ggwave = null;
    }

    this.#isAudioInitialized = false;
    this.removeAllListeners();
  }

  /**
   * Get the complete message (only available after all chunks received)
   */
  get message(): string {
    return this.#message;
  }

  /**
   * Get the checksum of the complete message
   */
  get checksum(): string {
    return this.#checksum;
  }

  /**
   * Check if all chunks have been received
   */
  get isComplete(): boolean {
    return this.#receivedIndices.size === this.#totalChunks && this.#totalChunks > 0;
  }
}
