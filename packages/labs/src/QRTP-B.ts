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
 * - Scans QR codes from sender
 * - Periodically sends acknowledgments via audio for all unacknowledged chunks
 */
export class QRTPB extends EventEmitter {
  #chunksMap: Map<number, string> = new Map(); // Data chunks map (index -> chunk)
  #receivedIndices: Set<number> = new Set(); // Indices that have been received
  #unacknowledgedIndices: Set<number> = new Set(); // Indices not yet acknowledged via audio
  #acknowledgedIndices: Set<number> = new Set(); // Indices acknowledged by receiver
  #header = codec('QRTPB<index:num>/<total:num>');
  #ackHeader = codec('QB<ranges:numPairs>');
  #audioWave: GGWave | null = null;
  #audioAckTimer: ReturnType<typeof setInterval> | null = null;
  #role: 'sender' | 'receiver' | null = null;
  #audioAckInterval: number = 2000; // Send audio acks every 2 seconds
  #isAudioInitialized: boolean = false;
  #audioVolume: number = 80; // Volume (1-100)
  #totalChunks: number = 0; // Total number of chunks
  #frameRate: number = 15; // 15fps for QR codes
  #originalData: string = ''; // Store original data for checksum

  constructor() {
    super();
    this.#audioWave = new GGWave();
  }

  /**
   * Compute a short checksum of the given data
   */
  async #computeChecksum(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);

    // Take first 4 bytes and convert to hex
    const shortHash = Array.from(hashArray.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return shortHash;
  }

  /**
   * Set a visualizer function for the audio channel
   */
  setAudioVisualizer(visualizerFn: (node: AudioNode | null, context: AudioContext) => void): void {
    if (this.#audioWave) {
      this.#audioWave.setVisualizer(visualizerFn);
    }
  }

  /**
   * Send data as an async iterable stream of QR code strings
   */
  async *send(data: string, chunkSize = 500): AsyncIterableIterator<string> {
    this.#role = 'sender';
    this.#chunksMap = new Map();
    this.#acknowledgedIndices = new Set();
    this.#originalData = data;

    // Break data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this.#chunksMap.set(Math.floor(i / chunkSize), data.substring(i, i + chunkSize));
    }

    this.#totalChunks = this.#chunksMap.size;

    // Compute checksum
    const checksum = await this.#computeChecksum(data);

    this.emit('init', {
      total: this.#totalChunks,
      size: chunkSize,
      dataLength: data.length,
      checksum,
    });

    // Initialize audio for listening to acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#audioWave!.ready();
      this.#audioWave!.startListening(this.#handleAudioReceived.bind(this));
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
        this.emit('allAcknowledged');
        break;
      }

      const payload = this.#chunksMap.get(nextIndex) || '';
      const qrData = this.#header.encode({
        index: nextIndex,
        total: this.#totalChunks,
        payload,
      });

      this.emit('qrUpdate', {
        data: qrData,
        index: nextIndex,
        total: this.#totalChunks,
        acknowledged: Array.from(this.#acknowledgedIndices),
      });

      yield qrData;

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

    // Initialize audio for sending acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#audioWave!.ready();
      this.#audioWave!.setProtocol(GGWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);
      await this.#warmUpAudio();
      this.#isAudioInitialized = true;
    }

    // Start periodic audio acknowledgments
    this.#startPeriodicAcks();
  }

  /**
   * Warm up the audio system
   */
  async #warmUpAudio(): Promise<void> {
    if (!this.#audioWave) return;

    try {
      await this.#audioWave.send('warmup', 5); // Very low volume (5%)
    } catch (error) {
      console.warn('Failed to warm up audio:', error);
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
        });

        // Check if we received all chunks
        if (this.#receivedIndices.size === packet.total) {
          const message = this.#getOrderedMessage();
          this.#emitComplete(message);
        }
      }
    }
  }

  /**
   * Emit complete event with checksum
   */
  async #emitComplete(message: string): Promise<void> {
    const checksum = await this.#computeChecksum(message);

    this.emit('complete', {
      message,
      receivedIndices: Array.from(this.#receivedIndices),
      totalChunks: this.#totalChunks,
      checksum,
    });
  }

  /**
   * Get the complete message from the ordered chunks
   */
  #getOrderedMessage(): string {
    const orderedChunks: string[] = [];
    const missingChunks: number[] = [];

    for (let i = 0; i < this.#totalChunks; i++) {
      const chunk = this.#chunksMap.get(i);
      if (chunk) {
        orderedChunks.push(chunk);
      } else {
        missingChunks.push(i);
        orderedChunks.push('');
      }
    }

    if (missingChunks.length > 0) {
      console.warn(`Missing chunks: ${missingChunks.join(', ')}`);
    }

    return orderedChunks.join('');
  }

  /**
   * Convert indices to optimized ranges using full received context
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

    return optimizedRanges;
  }

  /**
   * Send acknowledgment via audio - simplified flush system
   */
  async #sendAudioAck(): Promise<void> {
    if (!this.#audioWave || this.#role !== 'receiver' || this.#unacknowledgedIndices.size === 0) {
      return;
    }

    try {
      // Get all unacknowledged indices
      const indicesToAck = Array.from(this.#unacknowledgedIndices);

      // Convert to optimized ranges using full received context
      const ranges = this.#optimizeRanges(indicesToAck);

      if (ranges.length > 0) {
        const ackMessage = this.#ackHeader.encode({ ranges });
        await this.#audioWave.send(ackMessage, this.#audioVolume);
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
   */
  #rangesToIndices(ranges: [number, number][]): number[] {
    const indices: number[] = [];
    for (const [start, end] of ranges) {
      for (let i = start; i <= end; i++) {
        indices.push(i);
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

    if (this.#audioWave) {
      this.#audioWave.stopListening();
      this.#audioWave.dispose();
      this.#audioWave = null;
    }

    this.#isAudioInitialized = false;
    this.removeAllListeners();
  }

  /**
   * Get the message that has been received so far
   */
  getReceivedMessage(): string {
    return this.#getOrderedMessage();
  }

  /**
   * Get checksum of the received message
   */
  async getReceivedChecksum(): Promise<string> {
    const message = this.#getOrderedMessage();
    return await this.#computeChecksum(message);
  }

  /**
   * Check if all chunks have been received
   */
  isComplete(): boolean {
    return this.#receivedIndices.size === this.#totalChunks && this.#totalChunks > 0;
  }
}
