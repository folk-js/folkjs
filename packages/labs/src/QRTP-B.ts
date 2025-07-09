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
 */
export class QRTPB {
  #chunksMap: Map<number, string> = new Map();
  #receivedIndices: Set<number> = new Set();
  #unacknowledgedIndices: Set<number> = new Set();
  #acknowledgedIndices: Set<number> = new Set();
  #header = codec('QRTPB<index:num>/<total:num>');
  #ackHeader = codec('QB<ranges:numPairs>');
  #ggwave: GGWave | null = new GGWave();
  #audioAckTimer: ReturnType<typeof setInterval> | null = null;

  #audioAckInterval: number;
  #isAudioInitialized: boolean = false;
  #audioVolume: number;
  #totalChunks: number = 0;
  #frameRate: number;
  #message: string | null = null;
  #checksum: string = '';

  constructor(options: QRTPBOptions = {}) {
    this.#audioVolume = options.audioVolume ?? 80;
    this.#frameRate = options.frameRate ?? 15;
    this.#audioAckInterval = options.ackInterval ?? 2000;

    if (options.audioVisualizer) {
      this.#ggwave?.setVisualizer(options.audioVisualizer);
    }
  }

  #processQRCode(data: string) {
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

        const isComplete = this.#receivedIndices.size === packet.total;
        if (isComplete) {
          this.#updateCompleteMessage();
        }

        return {
          index: packet.index,
          payload: packet.payload,
          total: packet.total,
          isComplete,
          message: this.#message,
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
  async *send(
    data: string,
    chunkSize = 500,
  ): AsyncIterableIterator<{
    qr: string;
    index: number;
    total: number;
    acknowledged: number[];
    isComplete: boolean;
  }> {
    this.#chunksMap = new Map();
    this.#acknowledgedIndices = new Set();
    this.#message = data;
    this.#checksum = this.#computeChecksum(data);

    // Break data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this.#chunksMap.set(Math.floor(i / chunkSize), data.substring(i, i + chunkSize));
    }

    this.#totalChunks = this.#chunksMap.size;

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

      yield {
        qr: qrData,
        index: nextIndex,
        total: this.#totalChunks,
        acknowledged: Array.from(this.#acknowledgedIndices),
        isComplete: this.#acknowledgedIndices.size >= this.#totalChunks,
      };

      currentIndex = (nextIndex + 1) % this.#totalChunks;
      await new Promise((resolve) => setTimeout(resolve, 1000 / this.#frameRate));
    }
  }

  /**
   * Receive data from QR codes with audio backchannel
   * Returns progress updates including chunks, completion status, and final message
   */
  async *receive(qrDataStream: AsyncIterable<string>): AsyncIterableIterator<{
    chunk?: { index: number; payload: string };
    // Overall progress
    received: number;
    total: number;
    receivedIndices: number[];
    // Completion
    isComplete: boolean;
    message?: string;
    checksum?: string;
  }> {
    this.#chunksMap = new Map();
    this.#totalChunks = 0;
    this.#receivedIndices = new Set();
    this.#unacknowledgedIndices = new Set();
    this.#message = null;
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
      if (!result) {
        continue;
      }
      yield {
        chunk: {
          index: result.index,
          payload: result.payload,
        },
        received: this.#receivedIndices.size,
        total: this.#totalChunks,
        receivedIndices: Array.from(this.#receivedIndices),
        isComplete: result.isComplete,
        message: result.message || undefined,
        checksum: this.#checksum || undefined,
      };
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
    }
  }

  #startPeriodicAcks(): void {
    if (this.#audioAckTimer) {
      clearInterval(this.#audioAckTimer);
    }

    this.#audioAckTimer = setInterval(() => {
      if (this.#unacknowledgedIndices.size > 0) {
        this.#sendAudioAck();
      }
    }, this.#audioAckInterval);
  }

  /**
   * Flood-fill from seeds over received indices, then convert to ranges
   */
  #floodFillRanges(indicesToAck: number[]): [number, number][] {
    if (indicesToAck.length === 0) return [];

    // Step 1: Flood-fill ALL seeds to get complete set of indices to acknowledge
    const toAck = new Set<number>();
    const visited = new Set<number>();

    for (const seed of indicesToAck) {
      if (!this.#receivedIndices.has(seed) || visited.has(seed)) continue;

      // Flood-fill this connected component
      let start = seed;
      let end = seed;

      // Expand left
      while (start - 1 >= 0 && this.#receivedIndices.has(start - 1)) {
        start--;
      }

      // Expand right
      while (end + 1 < this.#totalChunks && this.#receivedIndices.has(end + 1)) {
        end++;
      }

      // Add entire connected component to both visited and toAck
      for (let i = start; i <= end; i++) {
        visited.add(i);
        toAck.add(i);
      }
    }

    if (toAck.size === 0) return [];

    // Step 2: Convert the flood-filled indices to ranges
    const sortedIndices = Array.from(toAck).sort((a, b) => a - b);
    const ranges: [number, number][] = [];

    let start = sortedIndices[0];
    let end = sortedIndices[0];

    for (let i = 1; i < sortedIndices.length; i++) {
      if (sortedIndices[i] === end + 1) {
        end = sortedIndices[i]; // Extend current range
      } else {
        ranges.push([start, end]); // Save current range
        start = end = sortedIndices[i]; // Start new range
      }
    }
    ranges.push([start, end]); // Save final range

    // Step 3: Handle circular wraparound
    if (ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === this.#totalChunks - 1) {
      const last = ranges.pop()!;
      const first = ranges.shift()!;
      ranges.unshift([last[0], first[1]]); // Wrapped range
    }

    return ranges;
  }

  async #sendAudioAck(): Promise<void> {
    if (!this.#ggwave || this.#unacknowledgedIndices.size === 0) {
      return;
    }

    // Get all unacknowledged indices
    const indicesToAck = Array.from(this.#unacknowledgedIndices);

    // Convert to optimized ranges using full received context
    const ranges = this.#floodFillRanges(indicesToAck);

    if (ranges.length === 0) {
      return;
    }

    const ackMessage = this.#ackHeader.encode({ ranges });
    // Clear the unacknowledged set which we're about to send
    this.#unacknowledgedIndices.clear();
    try {
      await this.#ggwave.send(ackMessage, this.#audioVolume);
    } catch (error) {
      console.error('Failed to send audio acknowledgment:', error);
    }
  }

  /**
   * Handle received audio message containing acknowledgments
   */
  #handleAudioReceived(message: string): void {
    const packet = this.#ackHeader.decode(message);
    if (!packet) return;

    // Convert ranges to individual indices
    const indices = this.#rangesToIndices(packet.ranges);

    for (const index of indices) {
      if (!this.#acknowledgedIndices.has(index) && index >= 0 && index < this.#totalChunks) {
        this.#acknowledgedIndices.add(index);
      }
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
  }

  get message(): string | null {
    return this.#message;
  }

  get checksum(): string {
    return this.#checksum;
  }

  get isComplete(): boolean {
    return this.#receivedIndices.size === this.#totalChunks && this.#totalChunks > 0;
  }
}
