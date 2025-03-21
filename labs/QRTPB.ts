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
  #chunks: string[] = []; // Data chunks to send/receive
  #currentIndex: number = 0; // Current chunk index being displayed
  #receivedIndices: Set<number> = new Set(); // Indices that have been received
  #acknowledgedIndices: Set<number> = new Set(); // Indices already acknowledged via audio
  #pendingAckIndices: Set<number> = new Set(); // Indices waiting to be acknowledged
  #ackDebounceTimer: any = null; // Timer for debouncing audio acknowledgments
  #debounceTime: number = 1000; // Wait this many ms to accumulate indices before sending
  #header = header('QRTPB<index:num>/<total:num>');
  #ackHeader = header('QB<indices:nums>');
  #cycleTimer: NodeJS.Timer | null = null;
  #audioWave: FolkAudioWave | null = null;
  #role: 'sender' | 'receiver' | null = null;
  #cycleInterval: number = 1000; // Cycle every 1 second by default
  #isAudioInitialized: boolean = false;
  #isAudioSending: boolean = false;
  #audioQueue: number[][] = []; // Queue of indices to send
  #audioVolume: number = 80; // Increased volume (1-100)

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
  async configureSender(data: string, chunkSize = 100, cycleInterval = 1000): Promise<void> {
    this.#role = 'sender';
    this.#chunks = [];
    this.#currentIndex = 0;
    this.#receivedIndices = new Set();
    this.#acknowledgedIndices = new Set();
    this.#pendingAckIndices = new Set();
    this.#cycleInterval = cycleInterval;

    // Break data into chunks
    for (let i = 0; i < data.length; i += chunkSize) {
      this.#chunks.push(data.substring(i, i + chunkSize));
    }

    this.emit('init', {
      total: this.#chunks.length,
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
    this.#chunks = [];
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

    // Store the received chunk if it's valid
    if (packet.payload && packet.index >= 0 && packet.index < packet.total) {
      const isNewChunk = !this.#receivedIndices.has(packet.index);
      const needsReacknowledge = this.#acknowledgedIndices.has(packet.index);

      // If we've already seen this chunk and acknowledged it, but we're seeing it again,
      // the sender didn't receive our ack, so we need to resend it
      if (needsReacknowledge) {
        this.#queueAcknowledgment(packet.index);
      }
      // If this is a new chunk we haven't seen before
      else if (isNewChunk) {
        // Ensure array is sized correctly
        while (this.#chunks.length < packet.total) {
          this.#chunks.push('');
        }

        this.#chunks[packet.index] = packet.payload;
        this.#receivedIndices.add(packet.index);

        // Notify about the new chunk
        this.emit('chunk', {
          index: packet.index,
          total: packet.total,
          payload: packet.payload,
        });

        // Queue this index for acknowledgment
        this.#queueAcknowledgment(packet.index);

        // Check if we received all chunks
        if (this.#receivedIndices.size === packet.total) {
          const message = this.#chunks.join('');
          this.emit('complete', { message });

          // Make sure we send one final acknowledgment with all indices
          this.#sendAudioAck();
        }
      }
    }
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
    return this.#chunks.join('');
  }

  /**
   * Check if all chunks have been received
   */
  isComplete(totalChunks: number): boolean {
    return this.#receivedIndices.size === totalChunks;
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
    if (this.#chunks.length === 0) return;

    // Find the next chunk that hasn't been acknowledged
    let nextIndex = (this.#currentIndex + 1) % this.#chunks.length;
    const startIndex = nextIndex;

    // If we've looped through all indices, start from the beginning
    do {
      if (!this.#receivedIndices.has(nextIndex)) {
        this.#currentIndex = nextIndex;
        return;
      }
      nextIndex = (nextIndex + 1) % this.#chunks.length;
    } while (nextIndex !== startIndex);

    // If all chunks have been acknowledged
    if (this.#receivedIndices.size === this.#chunks.length) {
      this.emit('allAcknowledged');
      if (this.#cycleTimer) {
        clearInterval(this.#cycleTimer);
        this.#cycleTimer = null;
      }
    }
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

    // Queue the acknowledgments
    this.#enqueueAudioMessage(indices);

    // Process queue if not already sending
    if (!this.#isAudioSending) {
      this.#processAudioQueue();
    }
  }

  /**
   * Add indices to the audio queue
   */
  #enqueueAudioMessage(indices: number[]): void {
    if (indices.length === 0) return;

    // Add these indices to the queue
    this.#audioQueue.push(indices);
  }

  /**
   * Process queued audio messages one by one
   */
  async #processAudioQueue(): Promise<void> {
    if (this.#audioQueue.length === 0 || this.#isAudioSending) return;

    this.#isAudioSending = true;

    try {
      const indices = this.#audioQueue.shift();
      if (indices && indices.length > 0 && this.#audioWave) {
        const ackMessage = this.#ackHeader.encode({ indices });

        this.emit('audioSending', { indices });
        await this.#audioWave.send(ackMessage, this.#audioVolume);
        this.emit('audioSent', { indices });
      }
    } catch (error) {
      console.error('Failed to send audio acknowledgment:', error);
    } finally {
      this.#isAudioSending = false;

      // Process next message if queue isn't empty
      if (this.#audioQueue.length > 0) {
        // Add a small delay between messages
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
      for (const index of packet.indices) {
        if (!this.#receivedIndices.has(index) && index >= 0 && index < this.#chunks.length) {
          this.#receivedIndices.add(index);
          hasNewAcks = true;
        }
      }

      if (hasNewAcks) {
        this.emit('ack', {
          acknowledged: Array.from(this.#receivedIndices),
          remaining: this.#chunks.length - this.#receivedIndices.size,
        });

        // If all chunks acknowledged, emit event
        if (this.#receivedIndices.size === this.#chunks.length) {
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
    if (this.#role !== 'sender' || this.#chunks.length === 0) return;

    const payload = this.#chunks[this.#currentIndex];
    const data = this.#header.encode({
      index: this.#currentIndex,
      total: this.#chunks.length,
      payload,
    });

    this.emit('qrUpdate', {
      data,
      index: this.#currentIndex,
      total: this.#chunks.length,
      acknowledged: Array.from(this.#receivedIndices),
    });
  }
}
