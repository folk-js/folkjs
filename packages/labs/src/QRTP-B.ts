import EventEmitter from 'eventemitter3';
import { GGWave } from './ggwave';
import { codec } from './utils/codecString';

/**
 * QRTP-B - QR Transfer Protocol with Audio Backchannel
 *
 * Device A (Sender):
 * - Uses async generator to yield QR codes with chunk index + payload
 * - Listens for audio signals from receiver to know which chunks to skip
 *
 * Device B (Receiver):
 * - Uses async generator to yield received chunks as they come in
 * - Periodically sends acknowledgments via audio for all unacknowledged chunks
 */
export class QRTPB extends EventEmitter {
  #chunksMap: Map<number, string> = new Map(); // Data chunks map (index -> chunk)
  #receivedIndices: Set<number> = new Set(); // Indices that have been received
  #unacknowledgedIndices: Set<number> = new Set(); // Indices not yet acknowledged via audio
  #acknowledgedIndices: Set<number> = new Set(); // Indices acknowledged by receiver
  #header = codec('QRTPB<index:num>/<total:num>');
  #ackHeader = codec('QB<ranges:numPairs>');
  #ggwave: GGWave | null = new GGWave();
  #audioAckTimer: ReturnType<typeof setInterval> | null = null;
  #role: 'sender' | 'receiver' | null = null;
  #audioAckInterval: number = 2000; // Send audio acks every 2 seconds
  #isAudioInitialized: boolean = false;
  #audioVolume: number = 80; // Volume (1-100)
  #totalChunks: number = 0; // Total number of chunks
  #frameRate: number = 15; // 15fps for QR codes
  #message: string = ''; // Complete message (set when all chunks received)
  #checksum: string = ''; // Checksum of complete message

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
   * Set a visualizer function for the audio channel
   */
  setAudioVisualizer(visualizerFn: (node: AudioNode | null, context: AudioContext) => void): void {
    if (this.#ggwave) {
      this.#ggwave.setVisualizer(visualizerFn);
    }
  }

  /**
   * Send data as an async iterable stream of QR code data
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

    // Initialize audio for listening to acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#ggwave!.ready();
      this.#ggwave!.startListening(this.#handleAudioReceived.bind(this));
      this.#isAudioInitialized = true;
    }

    // Continuously cycle through chunks, prioritizing unacknowledged ones
    let currentIndex = 0;
    while (this.#acknowledgedIndices.size < this.#totalChunks) {
      // Find next unacknowledged chunk
      let nextIndex = currentIndex;
      let attempts = 0;

      while (this.#acknowledgedIndices.has(nextIndex) && attempts < this.#totalChunks) {
        nextIndex = (nextIndex + 1) % this.#totalChunks;
        attempts++;
      }

      // If all chunks are acknowledged, we're done
      if (attempts >= this.#totalChunks) {
        break;
      }

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
   * Configure as a receiver
   */
  async configureReceiver(): Promise<void> {
    this.#role = 'receiver';
    this.#chunksMap = new Map();
    this.#totalChunks = 0;
    this.#receivedIndices = new Set();
    this.#unacknowledgedIndices = new Set();
    this.#message = '';
    this.#checksum = '';

    // Initialize audio for sending acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#ggwave!.ready();
      this.#ggwave!.setProtocol(GGWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);
      this.#isAudioInitialized = true;
    }

    // Start periodic audio acknowledgments
    this.#startPeriodicAcks();
  }

  /**
   * Process incoming QR code when detected
   */
  parseCode(data: string): void {
    if (this.#role !== 'receiver') return;

    const packet = this.#header.decode(data);
    if (!packet) return;

    // Update total chunks if needed
    if (packet.total > this.#totalChunks) {
      this.#totalChunks = packet.total;
    }

    // Store the received chunk if it's valid and new
    if (packet.payload && packet.index >= 0 && packet.index < packet.total) {
      const isNewChunk = !this.#receivedIndices.has(packet.index);

      if (isNewChunk) {
        this.#chunksMap.set(packet.index, packet.payload);
        this.#receivedIndices.add(packet.index);
        this.#unacknowledgedIndices.add(packet.index); // Mark for acknowledgment

        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
          receivedCount: this.#receivedIndices.size,
          receivedIndices: Array.from(this.#receivedIndices),
          unacknowledgedIndices: Array.from(this.#unacknowledgedIndices),
        });

        // Check if we received all chunks
        if (this.#receivedIndices.size === packet.total) {
          this.#updateCompleteMessage();
        }
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
