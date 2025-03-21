import EventEmitter from 'eventemitter3';
import { GGWave } from './ggwave';
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
 * - Uses audio to send back list of received indices on a regular interval
 */
export class QRTPB extends EventEmitter {
  #chunksMap: Map<number, string> = new Map(); // Data chunks map (index -> chunk)
  #currentIndex: number = 0; // Current chunk index being displayed
  #receivedIndices: Set<number> = new Set(); // Indices that have been received
  #acknowledgedIndices: Set<number> = new Set(); // Indices already acknowledged via audio
  #header = header('QRTPB<index:num>/<total:num>');
  #ackHeader = header('QB<ranges:numPairs>');
  #cycleTimer: NodeJS.Timer | null = null;
  #audioWave: GGWave | null = null;
  #audioAckTimer: NodeJS.Timer | null = null; // Timer for periodic audio acknowledgments
  #role: 'sender' | 'receiver' | null = null;
  #cycleInterval: number = 600; // Cycle every 0.6 seconds by default
  #audioAckInterval: number = 2000; // Send audio acks every 2 seconds
  #isAudioInitialized: boolean = false;
  #isAudioSending: boolean = false;
  #audioQueue: [number, number][][] = []; // Queue of ranges to send (each item is an array of [start, end] pairs)
  #audioVolume: number = 80; // Volume (1-100)
  #totalChunks: number = 0; // Total number of chunks

  constructor() {
    super();
    this.#audioWave = new GGWave();
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
  async configureSender(data: string, chunkSize = 800, cycleInterval = 400): Promise<void> {
    this.#role = 'sender';
    this.#chunksMap = new Map();
    this.#currentIndex = 0;
    this.#receivedIndices = new Set();
    this.#acknowledgedIndices = new Set();
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

    // Initialize audio for sending acknowledgments
    if (!this.#isAudioInitialized) {
      await this.#audioWave!.ready();
      this.#audioWave!.setProtocol(GGWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);

      // Play a silent or very quiet tone to "warm up" the audio system
      await this.warmUpAudio();

      this.#isAudioInitialized = true;
    }

    // Start periodic audio acknowledgments
    this.#startPeriodicAcks();
  }

  // Add a new method to warm up the audio system
  async warmUpAudio(): Promise<void> {
    if (!this.#audioWave) return;

    try {
      // Play a very quiet tone - almost silent but enough to initialize audio
      await this.#audioWave.send('warmup', 5); // Very low volume (5%)
      console.log('Audio system warmed up');
    } catch (error) {
      console.warn('Failed to warm up audio:', error);
    }
  }

  /**
   * Start periodic audio acknowledgments
   */
  #startPeriodicAcks(): void {
    // Clear existing timer if any
    if (this.#audioAckTimer) {
      clearInterval(this.#audioAckTimer);
    }

    // Set new timer to send acknowledgments regularly
    this.#audioAckTimer = setInterval(() => {
      // Only send if we have received indices and we're in receiver mode
      if (this.#role === 'receiver' && this.#receivedIndices.size > 0) {
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

    // Store the received chunk if it's valid
    if (packet.payload && packet.index >= 0 && packet.index < packet.total) {
      const isNewChunk = !this.#receivedIndices.has(packet.index);

      // If this is a new chunk we haven't seen before
      if (isNewChunk) {
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

        // Check if we received all chunks
        if (this.#receivedIndices.size === packet.total) {
          console.log(`All ${packet.total} chunks received!`);
          const message = this.#getOrderedMessage();
          this.emit('complete', {
            message,
            receivedIndices: Array.from(this.#receivedIndices),
            totalChunks: this.#totalChunks,
          });

          // Force immediate acknowledgment of all indices when complete
          this.#sendCompleteAck();
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
   * Stop all activity and clean up resources
   */
  dispose(): void {
    if (this.#cycleTimer) {
      clearInterval(this.#cycleTimer);
      this.#cycleTimer = null;
    }

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
  async #sendAudioAck(): Promise<void> {
    if (!this.#audioWave || this.#role !== 'receiver') return;

    // Get all received indices - always send all of them
    // This ensures we keep sending acknowledgments even after all chunks are received
    const allReceivedIndices = Array.from(this.#receivedIndices).sort((a, b) => a - b);

    // Skip if nothing to acknowledge
    if (allReceivedIndices.length === 0) return;

    // Check if we've received all chunks
    const allChunksReceived = this.#totalChunks > 0 && allReceivedIndices.length === this.#totalChunks;

    // If all chunks received, always send all indices (not just unacknowledged ones)
    // This ensures the sender keeps getting acknowledgments until it stops showing QR codes
    if (allChunksReceived) {
      // Mark as acknowledged so we don't send duplicate ranges
      allReceivedIndices.forEach((index) => this.#acknowledgedIndices.add(index));

      // Convert to ranges and send
      const ranges = this.#indicesToRanges(allReceivedIndices);

      // Split ranges into manageable batches
      const MAX_RANGES_PER_BATCH = 5;
      for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_BATCH) {
        const batch = ranges.slice(i, i + MAX_RANGES_PER_BATCH);
        if (batch.length > 0) {
          this.#enqueueAudioMessage(batch);
        }
      }
    } else {
      // Normal case - only send unacknowledged indices
      // Find indices that haven't been acknowledged yet
      const unacknowledgedIndices = allReceivedIndices
        .filter((index) => !this.#acknowledgedIndices.has(index))
        .sort((a, b) => a - b);

      // Skip if nothing to acknowledge
      if (unacknowledgedIndices.length === 0) return;

      // Mark these indices as acknowledged
      unacknowledgedIndices.forEach((index) => this.#acknowledgedIndices.add(index));

      // Convert indices to ranges
      const ranges = this.#indicesToRanges(unacknowledgedIndices);

      // Split ranges into manageable batches
      const MAX_RANGES_PER_BATCH = 5;
      for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_BATCH) {
        const batch = ranges.slice(i, i + MAX_RANGES_PER_BATCH);
        if (batch.length > 0) {
          this.#enqueueAudioMessage(batch);
        }
      }
    }

    // Process queue if not already sending
    if (!this.#isAudioSending) {
      setTimeout(() => this.#processAudioQueue(), 20);
    }
  }

  /**
   * Add ranges to the audio queue
   */
  #enqueueAudioMessage(ranges: [number, number][]): void {
    if (ranges.length === 0) return;

    // Add these ranges to the queue
    this.#audioQueue.push(ranges);

    // If queue is getting too large, merge batches
    if (this.#audioQueue.length > 3) {
      console.warn(`Audio queue is getting large. Merging batches.`);

      // Convert all queued ranges to indices
      const allIndices = new Set<number>();
      this.#audioQueue.forEach((batch) => {
        this.#rangesToIndices(batch).forEach((index) => allIndices.add(index));
      });

      // Clear the queue
      this.#audioQueue = [];

      // Convert indices back to ranges
      const mergedIndices = Array.from(allIndices).sort((a, b) => a - b);
      const mergedRanges = this.#indicesToRanges(mergedIndices);

      // Add back to queue in batches
      const MAX_RANGES_PER_BATCH = 5;
      for (let i = 0; i < mergedRanges.length; i += MAX_RANGES_PER_BATCH) {
        const batch = mergedRanges.slice(i, i + MAX_RANGES_PER_BATCH);
        this.#audioQueue.push(batch);
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

        // Add a short delay after each audio message to ensure clean playback
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error('Failed to send audio acknowledgment:', error);
    } finally {
      this.#isAudioSending = false;

      // Process next message if queue isn't empty
      if (this.#audioQueue.length > 0) {
        setTimeout(() => this.#processAudioQueue(), 50);
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

  // Add a new method to send a complete acknowledgment
  async #sendCompleteAck(): Promise<void> {
    if (!this.#audioWave || this.#role !== 'receiver') return;

    // Send ALL indices as a final complete acknowledgment
    const allIndices = Array.from(this.#receivedIndices).sort((a, b) => a - b);

    // Skip if nothing to acknowledge
    if (allIndices.length === 0) return;

    // Mark all as acknowledged but we'll still send them one more time
    allIndices.forEach((index) => this.#acknowledgedIndices.add(index));

    // Convert to ranges and send immediately (bypass queue)
    const ranges = this.#indicesToRanges(allIndices);

    // Split into manageable batches if needed
    const MAX_RANGES_PER_BATCH = 5;
    const batches = [];

    for (let i = 0; i < ranges.length; i += MAX_RANGES_PER_BATCH) {
      batches.push(ranges.slice(i, i + MAX_RANGES_PER_BATCH));
    }

    // Log the completion acknowledgment
    console.log(`Sending complete acknowledgment with ${allIndices.length} indices in ${batches.length} batches`);

    // Send each batch with a small delay between them
    for (const batch of batches) {
      if (batch.length > 0) {
        try {
          this.#isAudioSending = true;
          const ackMessage = this.#ackHeader.encode({ ranges: batch });
          const indices = this.#rangesToIndices(batch);

          this.emit('audioSending', { ranges: batch, totalIndices: indices.length, indices });
          await this.#audioWave.send(ackMessage, this.#audioVolume);
          this.emit('audioSent', { ranges: batch, totalIndices: indices.length, indices });

          // Small delay between batches
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.error('Failed to send completion acknowledgment:', error);
        } finally {
          this.#isAudioSending = false;
        }
      }
    }

    // Schedule one more acknowledgment after a delay to ensure the sender gets it
    this.#increaseAckFrequency();
  }

  // Add a method to increase acknowledgment frequency after completion
  #increaseAckFrequency(): void {
    // Clear existing timer
    if (this.#audioAckTimer) {
      clearInterval(this.#audioAckTimer);
    }

    // Instead of a continuous interval, just schedule one more acknowledgment
    // after a short delay to ensure the sender gets the completion message
    setTimeout(() => {
      if (this.#role === 'receiver' && this.#receivedIndices.size > 0) {
        // Send ALL received indices one more time
        this.#sendAudioAck();
      }
    }, 1000); // 1 second delay for the final acknowledgment
  }
}
