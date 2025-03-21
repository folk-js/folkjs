import EventEmitter from 'eventemitter3';
import { FolkAudioWave } from './folk-audio-wave';
import { hash } from './utils/hash';
import { header } from './utils/header';

/**
 * QRTP-B - QR Transfer Protocol with Audio Backchannel
 *
 * Device A (Sender):
 * - Shows QR codes with chunk index + payload
 * - Cycles through chunks automatically every N milliseconds
 * - Listens for audio signals from receiver to know which chunks to skip
 *
 * Device B (Receiver):
 * - Scans QR codes from sender
 * - Uses audio to send back list of received indices
 */
export class QRTPB extends EventEmitter {
  #chunksMap: Map<number, string> = new Map(); // Data chunks map (index -> chunk)
  #currentIndex: number = 0; // Current chunk index being displayed
  #receivedIndices: Set<number> = new Set(); // Indices that have been received
  #acknowledgedIndices: Set<number> = new Set(); // Indices already acknowledged via audio
  #pendingAckIndices: Set<number> = new Set(); // Indices waiting to be acknowledged
  #ackDebounceTimer: any = null; // Timer for debouncing audio acknowledgments
  #debounceTime: number = 800; // Wait this many ms to accumulate indices before sending
  #header = header('QRTPB<index:num>/<total:num>');
  #ackHeader = header('QB<ranges:numPairs>');
  #cycleTimer: NodeJS.Timer | null = null;
  #audioWave: FolkAudioWave | null = null;
  #role: 'sender' | 'receiver' | null = null;
  #cycleInterval: number = 600; // Cycle every 1 second by default
  #isAudioInitialized: boolean = false;
  #isAudioSending: boolean = false;
  #audioQueue: [number, number][][] = []; // Queue of ranges to send (each item is an array of [start, end] pairs)
  #audioVolume: number = 80; // Increased volume (1-100)
  #totalChunks: number = 0; // Total number of chunks

  // Safe requestAnimationFrame that works in both browser and Node.js
  #safeRAF = (callback: () => void): void => {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(callback);
    } else {
      setTimeout(callback, 16); // ~60fps equivalent
    }
  };

  constructor() {
    super();
    this.#audioWave = new FolkAudioWave();
  }

  /**
   * Set a visualizer function for the audio channel
   * @param visualizerFn Function that receives audio node and context
   */
  setAudioVisualizer(visualizerFn: (node: AudioNode | null, context: AudioContext) => void): void {
    if (this.#audioWave) {
      this.#audioWave.setVisualizer(visualizerFn);
    }
  }

  /**
   * Configure as a sender
   * @param data Full data message to be sent
   * @param chunkSize Size of each chunk in characters
   * @param cycleInterval Milliseconds between QR code changes
   */
  async configureSender(data: string, chunkSize = 250, cycleInterval = 600): Promise<void> {
    this.#role = 'sender';
    this.#chunksMap = new Map();
    this.#currentIndex = 0;
    this.#receivedIndices = new Set();
    this.#acknowledgedIndices = new Set();
    this.#pendingAckIndices = new Set();
    this.#cycleInterval = cycleInterval;

    // Break data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this.#chunksMap.set(Math.floor(i / chunkSize), data.substring(i, i + chunkSize));
    }

    this.#totalChunks = this.#chunksMap.size;

    this.emit('init', {
      total: this.#totalChunks,
      size: chunkSize,
      dataLength: data.length,
    });

    // Initialize audio for listening to acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#audioWave!.ready();
      this.#audioWave!.startListening(this.#handleAudioReceived.bind(this));
      this.#isAudioInitialized = true;
    }

    this.#startCycling();
    this.#emitCodeUpdate();
  }

  /**
   * Configure as a receiver
   */
  async configureReceiver(): Promise<void> {
    this.#role = 'receiver';
    this.#chunksMap = new Map();
    this.#totalChunks = 0;
    this.#receivedIndices = new Set();
    this.#acknowledgedIndices = new Set();
    this.#pendingAckIndices = new Set();

    // Initialize audio for sending acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#audioWave!.ready();
      this.#audioWave!.setProtocol(FolkAudioWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);
      this.#isAudioInitialized = true;
    }
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

    // Store the received chunk if it's valid
    if (packet.payload && packet.index >= 0 && packet.index < packet.total) {
      const isNewChunk = !this.#receivedIndices.has(packet.index);
      const needsReacknowledge = this.#acknowledgedIndices.has(packet.index);

      // If we've already seen this chunk and acknowledged it, but we're seeing it again,
      // the sender didn't receive our ack, so we need to resend it
      if (needsReacknowledge) {
        console.log(`Re-acknowledging chunk ${packet.index}/${packet.total}`);
        this.#queueAcknowledgment(packet.index);
      }
      // If this is a new chunk we haven't seen before
      else if (isNewChunk) {
        // Store the chunk in our map
        this.#chunksMap.set(packet.index, packet.payload);
        this.#receivedIndices.add(packet.index);

        // Log the current state for debugging
        console.log(`Received chunk ${packet.index}/${packet.total}, total received: ${this.#receivedIndices.size}`);

        // Notify about the new chunk
        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
          receivedCount: this.#receivedIndices.size,
          receivedIndices: Array.from(this.#receivedIndices),
        });

        // Queue this index for acknowledgment
        this.#queueAcknowledgment(packet.index);

        // Check if we received all chunks
        if (this.#receivedIndices.size === packet.total) {
          console.log(`All ${packet.total} chunks received! Sending final acknowledgment.`);
          const message = this.#getOrderedMessage();
          this.emit('complete', {
            message,
            receivedIndices: Array.from(this.#receivedIndices),
            totalChunks: this.#totalChunks,
          });

          // Make sure we send one final acknowledgment with all indices
          this.#sendAudioAck(Array.from(this.#receivedIndices));
        }
      }
    }
  }

  /**
   * Get the complete message from the ordered chunks
   */
  #getOrderedMessage(): string {
    // Convert chunks map to ordered array and join
    const orderedChunks: string[] = [];
    const missingChunks: number[] = [];

    for (let i = 0; i < this.#totalChunks; i++) {
      const chunk = this.#chunksMap.get(i);
      if (chunk) {
        orderedChunks.push(chunk);
      } else {
        missingChunks.push(i);
        console.warn(`Missing chunk at index ${i}`);
        orderedChunks.push(''); // Push empty string for missing chunks
      }
    }

    if (missingChunks.length > 0) {
      console.warn(`Missing chunks: ${missingChunks.join(', ')}`);
    }

    return orderedChunks.join('');
  }

  /**
   * Queue an index to be acknowledged and schedule a debounced send
   */
  #queueAcknowledgment(index: number): void {
    // Add to pending set
    this.#pendingAckIndices.add(index);

    // Clear existing timer if any
    if (this.#ackDebounceTimer) {
      clearTimeout(this.#ackDebounceTimer);
    }

    // Set new timer to send acknowledgments after a short delay
    // This allows multiple indices received in quick succession to be batched
    this.#ackDebounceTimer = setTimeout(() => {
      this.#sendAudioAck();
      this.#ackDebounceTimer = null;
    }, this.#debounceTime);
  }

  /**
   * Stop all activity and clean up resources
   */
  dispose(): void {
    if (this.#cycleTimer) {
      clearInterval(this.#cycleTimer);
      this.#cycleTimer = null;
    }

    if (this.#ackDebounceTimer) {
      clearTimeout(this.#ackDebounceTimer);
      this.#ackDebounceTimer = null;
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
   * Check if all chunks have been received
   */
  isComplete(): boolean {
    return this.#receivedIndices.size === this.#totalChunks && this.#totalChunks > 0;
  }

  /**
   * Start cycling through chunks automatically
   */
  #startCycling(): void {
    if (this.#cycleTimer) {
      clearInterval(this.#cycleTimer);
    }

    this.#cycleTimer = setInterval(() => {
      this.#advanceToNextChunk();
      this.#emitCodeUpdate();
    }, this.#cycleInterval);
  }

  /**
   * Advance to the next chunk that hasn't been acknowledged
   */
  #advanceToNextChunk(): void {
    if (this.#chunksMap.size === 0) return;

    // Find the next chunk that hasn't been acknowledged
    let nextIndex = (this.#currentIndex + 1) % this.#totalChunks;
    const startIndex = nextIndex;

    // If we've looped through all indices, start from the beginning
    do {
      if (!this.#receivedIndices.has(nextIndex)) {
        this.#currentIndex = nextIndex;
        return;
      }
      nextIndex = (nextIndex + 1) % this.#totalChunks;
    } while (nextIndex !== startIndex);

    // If all chunks have been acknowledged
    if (this.#receivedIndices.size === this.#totalChunks) {
      this.emit('allAcknowledged');
      if (this.#cycleTimer) {
        clearInterval(this.#cycleTimer);
        this.#cycleTimer = null;
      }
    }
  }

  /**
   * Convert array of indices to ranges for more efficient transmission
   * e.g. [1,2,3,4,5,9,10,11,15] becomes [[1,5],[9,11],[15,15]]
   */
  #indicesToRanges(indices: number[]): [number, number][] {
    if (indices.length === 0) return [];

    // Sort the indices first
    const sortedIndices = [...indices].sort((a, b) => a - b);

    const ranges: [number, number][] = [];
    let rangeStart = sortedIndices[0];
    let rangeLast = sortedIndices[0];

    for (let i = 1; i < sortedIndices.length; i++) {
      const current = sortedIndices[i];
      // If current index is consecutive, extend the range
      if (current === rangeLast + 1) {
        rangeLast = current;
      } else {
        // Otherwise close the current range and start a new one
        ranges.push([rangeStart, rangeLast]);
        rangeStart = current;
        rangeLast = current;
      }
    }

    // Add the last range
    ranges.push([rangeStart, rangeLast]);

    return ranges;
  }

  /**
   * Convert ranges back to individual indices
   * e.g. [[1,5],[9,11],[15,15]] becomes [1,2,3,4,5,9,10,11,15]
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
   * Send list of received indices via audio
   */
  async #sendAudioAck(indicesToAcknowledge?: number[]): Promise<void> {
    if (!this.#audioWave) return;

    let indices: number[];

    if (indicesToAcknowledge) {
      // Use specified indices to acknowledge
      indices = indicesToAcknowledge;
    } else {
      // Use pending indices if available, otherwise find unacknowledged indices
      if (this.#pendingAckIndices.size > 0) {
        indices = Array.from(this.#pendingAckIndices).sort((a, b) => a - b);
        this.#pendingAckIndices.clear();
      } else {
        // Find indices that haven't been acknowledged yet
        indices = Array.from(this.#receivedIndices)
          .filter((index) => !this.#acknowledgedIndices.has(index))
          .sort((a, b) => a - b);
      }
    }

    // Skip if nothing to acknowledge
    if (indices.length === 0) return;

    // Mark these indices as acknowledged
    indices.forEach((index) => this.#acknowledgedIndices.add(index));

    // Convert indices to ranges and queue them
    const ranges = this.#indicesToRanges(indices);
    this.#enqueueAudioMessage(ranges);

    // Process queue if not already sending
    // Use requestAnimationFrame to ensure better timing
    if (!this.#isAudioSending) {
      this.#safeRAF(() => this.#processAudioQueue());
    }
  }

  /**
   * Add ranges to the audio queue
   */
  #enqueueAudioMessage(ranges: [number, number][]): void {
    if (ranges.length === 0) return;

    // Check if queue already has too many items (prevent queue explosion)
    if (this.#audioQueue.length > 5) {
      console.warn(
        `Audio queue is getting too large (${this.#audioQueue.length} items). Merging batches to prevent backlog.`,
      );

      // Convert all queued ranges and new ranges to indices
      const allQueuedIndices = new Set<number>();

      // Add all existing queued ranges
      this.#audioQueue.forEach((batch) => {
        this.#rangesToIndices(batch).forEach((index) => allQueuedIndices.add(index));
      });

      // Add new ranges
      this.#rangesToIndices(ranges).forEach((index) => allQueuedIndices.add(index));

      // Clear the queue
      this.#audioQueue = [];

      // Convert to array, sort, and convert back to ranges
      const mergedIndices = Array.from(allQueuedIndices).sort((a, b) => a - b);
      const mergedRanges = this.#indicesToRanges(mergedIndices);

      // Split into smaller batches if needed (max 5 ranges per batch for reliability)
      const MAX_RANGES_PER_BATCH = 5;
      for (let i = 0; i < mergedRanges.length; i += MAX_RANGES_PER_BATCH) {
        const batch = mergedRanges.slice(i, i + MAX_RANGES_PER_BATCH);
        this.#audioQueue.push(batch);
      }
    } else {
      // Normal case: just add these ranges to the queue
      // But ensure no batch is larger than 5 ranges
      const MAX_RANGES_PER_BATCH = 5;
      if (ranges.length > MAX_RANGES_PER_BATCH) {
        // Split into smaller batches
        for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_BATCH) {
          const batch = ranges.slice(i, i + MAX_RANGES_PER_BATCH);
          this.#audioQueue.push(batch);
        }
      } else {
        this.#audioQueue.push(ranges);
      }
    }
  }

  /**
   * Process queued audio messages one by one
   */
  async #processAudioQueue(): Promise<void> {
    if (this.#audioQueue.length === 0) return;
    if (this.#isAudioSending) return;

    this.#isAudioSending = true;
    let processingError = false;

    try {
      const ranges = this.#audioQueue.shift();
      if (ranges && ranges.length > 0 && this.#audioWave) {
        const ackMessage = this.#ackHeader.encode({ ranges });

        // Calculate the total indices being acknowledged in this message
        const totalIndices = ranges.reduce((sum, [start, end]) => sum + (end - start + 1), 0);

        // Convert ranges back to indices for backward compatibility
        const indices = this.#rangesToIndices(ranges);

        this.emit('audioSending', { ranges, totalIndices, indices });
        await this.#audioWave.send(ackMessage, this.#audioVolume);
        this.emit('audioSent', { ranges, totalIndices, indices });
      }
    } catch (error) {
      processingError = true;
      console.error('Failed to send audio acknowledgment:', error);
    } finally {
      this.#isAudioSending = false;

      // Always process next message if queue isn't empty, even after an error
      if (this.#audioQueue.length > 0) {
        // Use requestAnimationFrame for better timing than setTimeout
        // This helps ensure we don't lose processing time due to browser throttling
        this.#safeRAF(() => this.#processAudioQueue());
      } else if (processingError) {
        // If we had an error and the queue is now empty,
        // ensure any pending acknowledgments are not lost
        if (this.#pendingAckIndices.size > 0) {
          setTimeout(() => this.#sendAudioAck(), 100);
        }
      }
    }
  }

  /**
   * Handle received audio message containing acknowledgments
   */
  #handleAudioReceived(message: string): void {
    const packet = this.#ackHeader.decode(message);
    if (!packet) return;

    try {
      let hasNewAcks = false;

      // Convert ranges to individual indices
      const indices = this.#rangesToIndices(packet.ranges);

      for (const index of indices) {
        if (!this.#receivedIndices.has(index) && index >= 0 && index < this.#totalChunks) {
          this.#receivedIndices.add(index);
          hasNewAcks = true;
        }
      }

      if (hasNewAcks) {
        this.emit('ack', {
          acknowledged: Array.from(this.#receivedIndices),
          remaining: this.#totalChunks - this.#receivedIndices.size,
        });

        // If all chunks acknowledged, emit event
        if (this.#receivedIndices.size === this.#totalChunks) {
          this.emit('allAcknowledged');
          if (this.#cycleTimer) {
            clearInterval(this.#cycleTimer);
            this.#cycleTimer = null;
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse audio acknowledgment:', error);
    }
  }

  /**
   * Update QR code content and emit event
   */
  #emitCodeUpdate(): void {
    if (this.#role !== 'sender' || this.#chunksMap.size === 0) return;

    const payload = this.#chunksMap.get(this.#currentIndex) || '';
    const data = this.#header.encode({
      index: this.#currentIndex,
      total: this.#totalChunks,
      payload,
    });

    this.emit('qrUpdate', {
      data,
      index: this.#currentIndex,
      total: this.#totalChunks,
      acknowledged: Array.from(this.#receivedIndices),
    });
  }
}
