// QRTPB - QR Transfer Protocol with Backchannel (simplified version)
// A protocol that uses QR codes for data transfer with character-range based chunking

export type QRTPBMode = 'send' | 'receive';

// Simplified callback types - these are the minimal required
export type QRCallback = (qrData: string) => void; // Essential for displaying QR codes
export type StateCallback = (state: any) => void; // Generic state updates

export interface QRTPBChunk {
  startIndex: number;
  endIndex: number;
  data: string;
}

interface SenderState {
  dataToSend: string | null;
  chunks: QRTPBChunk[];
  currentChunkIndex: number;
  acknowledgedSpans: Array<[number, number]>; // Ranges already received by receiver
  isDone: boolean;
}

interface ReceiverState {
  receivedSpans: Array<[number, number]>;
  maxSeenIndex: number;
  receivedText: string;
  isDone: boolean;
}

export class QRTPB {
  // Static configuration
  static readonly DEFAULT_CHUNK_SIZE: number = 1500;
  static readonly QR_CYCLE_INTERVAL: number = 200; // ms between QR code updates

  // Sender protocol constants
  static readonly SENDER_PROTOCOL_PREFIX: string = 'QRTPB'; // Protocol prefix for sender QR codes
  static readonly SENDER_DONE_SIGNAL: string = 'D'; // Sender completion signal
  static readonly SENDER_IDLE_SIGNAL: string = 'idle'; // Sender idle state signal

  // Backchannel protocol constants
  static readonly BACK_RANGES_PREFIX: string = 'R'; // Prefix for backchannel ranges message
  static readonly BACK_DONE_SIGNAL: string = 'D'; // Backchannel completion signal

  // Current mode
  private mode: QRTPBMode = 'send';

  // Sender state
  private sender: SenderState = {
    dataToSend: null,
    chunks: [],
    currentChunkIndex: 0,
    acknowledgedSpans: [],
    isDone: false,
  };

  // Receiver state
  private receiver: ReceiverState = {
    receivedSpans: [],
    maxSeenIndex: 0,
    receivedText: '',
    isDone: false,
  };

  // Cycling
  private qrCycleInterval: any = null;

  // Configuration
  private chunkSize: number = QRTPB.DEFAULT_CHUNK_SIZE;

  // Simplified callbacks
  private qrCallback: QRCallback | null = null;
  private stateCallback: StateCallback | null = null;

  constructor(qrCallback?: QRCallback, stateCallback?: StateCallback) {
    this.qrCallback = qrCallback || null;
    this.stateCallback = stateCallback || null;
  }

  // Set callbacks
  setQRCallback(callback: QRCallback): void {
    this.qrCallback = callback;
  }

  setStateCallback(callback: StateCallback): void {
    this.stateCallback = callback;
  }

  // Switch between send and receive modes
  setMode(mode: QRTPBMode): void {
    if (this.mode === mode) return;

    this.reset();
    this.mode = mode;
    console.log(`Switched to ${mode} mode`);

    // Notify about state changes
    this.notifyState();

    // Always update QR code when in send mode
    if (this.mode === 'send') {
      this.updateQRCode();
    }
  }

  // Get current mode
  getMode(): QRTPBMode {
    return this.mode;
  }

  // Update QR code display
  private updateQRCode(): void {
    if (this.qrCallback && this.mode === 'send') {
      const qrData = this.getSenderQRCodeData();
      this.qrCallback(qrData);
    }
  }

  // Notify about state changes
  private notifyState(): void {
    if (!this.stateCallback) return;

    if (this.mode === 'send') {
      this.stateCallback({
        mode: this.mode,
        dataToSend: this.sender.dataToSend,
        totalLength: this.sender.dataToSend?.length || 0,
        chunks: this.sender.chunks.length,
        acknowledgedSpans: [...this.sender.acknowledgedSpans],
        isDone: this.sender.isDone,
      });
    } else {
      this.stateCallback({
        mode: this.mode,
        receivedSpans: [...this.receiver.receivedSpans],
        maxSeenIndex: this.receiver.maxSeenIndex,
        receivedText: this.receiver.receivedText,
        isDone: this.receiver.isDone,
        progress: this.calculateProgress(),
      });
    }
  }

  // Calculate progress percentage for receiver mode
  private calculateProgress(): number {
    if (this.receiver.maxSeenIndex === 0) return 0;

    const totalReceived = this.receiver.receivedSpans.reduce((acc, [start, end]) => acc + (end - start + 1), 0);

    return Math.min(100, Math.round((totalReceived / (this.receiver.maxSeenIndex + 1)) * 100));
  }

  // Set data to be sent and chunk it
  setData(data: string, chunkSize?: number): boolean {
    if (this.mode !== 'send') {
      console.log('Cannot set data in receive mode');
      return false;
    }

    if (!data || data.trim() === '') {
      this.reset();
      return false;
    }

    this.sender.dataToSend = data;
    this.chunkSize = chunkSize || this.chunkSize;
    this.chunkData();
    console.log(`Data set for sending: ${data.length} bytes, chunk size: ${this.chunkSize}`);
    this.startQRCycle();

    // Notify about state changes
    this.notifyState();
    this.updateQRCode();

    return true;
  }

  // Chunk the data into smaller pieces with character ranges
  private chunkData(): void {
    this.sender.chunks = [];
    this.sender.currentChunkIndex = 0;

    if (!this.sender.dataToSend) return;

    // Split text into chunks with character ranges
    for (let i = 0; i < this.sender.dataToSend.length; i += this.chunkSize) {
      const chunk = this.sender.dataToSend.substring(i, Math.min(i + this.chunkSize, this.sender.dataToSend.length));
      this.sender.chunks.push({
        startIndex: i,
        endIndex: Math.min(i + chunk.length - 1, this.sender.dataToSend.length - 1),
        data: chunk,
      });
    }

    console.log(`Data chunked into ${this.sender.chunks.length} pieces`);
  }

  // Get the current QR code data to display
  getSenderQRCodeData(): string {
    if (!this.sender.dataToSend || this.sender.chunks.length === 0) {
      return `${QRTPB.SENDER_PROTOCOL_PREFIX}:${QRTPB.SENDER_IDLE_SIGNAL}`;
    }

    // Show DONE if we're done
    if (this.sender.isDone || (this.isAllChunksExcluded() && this.sender.dataToSend)) {
      return `${QRTPB.SENDER_PROTOCOL_PREFIX}:${QRTPB.SENDER_DONE_SIGNAL}`;
    }

    // Filter out chunks that are fully contained in excluded ranges
    const availableChunks = this.sender.chunks.filter((chunk) => {
      return !this.sender.acknowledgedSpans.some((range) => chunk.startIndex >= range[0] && chunk.endIndex <= range[1]);
    });

    if (availableChunks.length === 0) {
      // All chunks are excluded, cycle through them anyway in case of lost messages
      this.sender.currentChunkIndex = (this.sender.currentChunkIndex + 1) % this.sender.chunks.length;
      const chunk = this.sender.chunks[this.sender.currentChunkIndex];
      return `${QRTPB.SENDER_PROTOCOL_PREFIX}:${chunk.startIndex}-${chunk.endIndex}/${this.sender.dataToSend.length}:${chunk.data}`;
    }

    // Use modulo on available chunks length
    const index = this.sender.currentChunkIndex % availableChunks.length;
    const chunk = availableChunks[index];

    const qrData = `${QRTPB.SENDER_PROTOCOL_PREFIX}:${chunk.startIndex}-${chunk.endIndex}/${this.sender.dataToSend.length}:${chunk.data}`;

    // Move to next chunk for next cycle
    this.sender.currentChunkIndex = (this.sender.currentChunkIndex + 1) % availableChunks.length;

    return qrData;
  }

  // Alias for backward compatibility
  getCurrentQRCodeData(): string {
    return this.getSenderQRCodeData();
  }

  // Check if all chunks are excluded (received by receiver)
  private isAllChunksExcluded(): boolean {
    if (!this.sender.dataToSend || this.sender.chunks.length === 0) return false;
    return this.sender.chunks.every((chunk) =>
      this.sender.acknowledgedSpans.some((range) => chunk.startIndex >= range[0] && chunk.endIndex <= range[1]),
    );
  }

  // Process received QR code data
  processSenderQRData(data: string): void {
    if (!data.startsWith(QRTPB.SENDER_PROTOCOL_PREFIX)) {
      console.log('Not a QRTPB message');
      return;
    }

    const parts = data.split(':');
    if (parts.length !== 2 && parts.length !== 3) {
      console.log('Invalid QRTPB message format');
      return;
    }

    // Check for DONE signal
    if (parts[1] === QRTPB.SENDER_DONE_SIGNAL) {
      console.log('Received DONE signal from sender');
      this.receiver.isDone = true;
      this.notifyState();
      return;
    }

    const rangeStr = parts[1];
    const payload = parts[2];

    if (rangeStr === QRTPB.SENDER_IDLE_SIGNAL) return;

    const [range, totalChars] = rangeStr.split('/');
    const [startStr, endStr] = range.split('-');
    const startIndex = parseInt(startStr);
    const endIndex = parseInt(endStr);
    const totalLength = parseInt(totalChars);

    if (isNaN(startIndex) || isNaN(endIndex) || isNaN(totalLength)) {
      console.log('Invalid range format');
      return;
    }

    this.processIncomingChunk(startIndex, endIndex, payload, totalLength);
  }

  // Alias for backward compatibility
  processReceivedQRData(data: string): void {
    this.processSenderQRData(data);
  }

  // Process a received chunk (Sender -> Receiver)
  private processIncomingChunk(startIndex: number, endIndex: number, data: string, totalLength: number): void {
    // Update max seen index to be the total length if we have it
    this.receiver.maxSeenIndex = Math.max(this.receiver.maxSeenIndex, totalLength - 1);

    // Add the range to our received ranges
    this.addRange(startIndex, endIndex);

    // Update the received text
    if (this.receiver.receivedText.length < endIndex + 1) {
      this.receiver.receivedText = this.receiver.receivedText.padEnd(endIndex + 1, ' ');
    }
    this.receiver.receivedText =
      this.receiver.receivedText.substring(0, startIndex) + data + this.receiver.receivedText.substring(endIndex + 1);

    console.log(`Received chunk ${startIndex}-${endIndex}/${totalLength}`);

    // Notify about state changes
    this.notifyState();
  }

  // Add a range to our received ranges, merging overlapping ranges
  private addRange(start: number, end: number): void {
    this.receiver.receivedSpans = this.mergeSpans(this.receiver.receivedSpans, [[start, end]]);
  }

  // Merge spans utility function - can be used for both sender and receiver
  private mergeSpans(
    currentSpans: Array<[number, number]>,
    newSpans: Array<[number, number]>,
  ): Array<[number, number]> {
    // Combine both arrays
    const allSpans = [...currentSpans, ...newSpans];

    if (allSpans.length <= 1) return allSpans;

    // Sort all spans by start index
    allSpans.sort((a, b) => a[0] - b[0]);

    // Merge overlapping or adjacent spans
    const mergedSpans: Array<[number, number]> = [allSpans[0]];

    for (let i = 1; i < allSpans.length; i++) {
      const current = mergedSpans[mergedSpans.length - 1];
      const next = allSpans[i];

      // Check if spans overlap or are adjacent
      const overlaps = Math.max(current[0], next[0]) <= Math.min(current[1], next[1]);
      const adjacent = Math.abs(current[1] - next[0]) === 1 || Math.abs(current[0] - next[1]) === 1;

      if (overlaps || adjacent) {
        // Merge spans by updating the end index of the current span
        current[1] = Math.max(current[1], next[1]);
      } else {
        // Add new non-overlapping span
        mergedSpans.push(next);
      }
    }

    return mergedSpans;
  }

  // Check if transmission is complete (no gaps in ranges from 0 to maxSeenIndex)
  private isTransmissionComplete(): boolean {
    if (this.receiver.receivedSpans.length === 0) return false;

    // Check if first range starts at 0
    if (this.receiver.receivedSpans[0][0] !== 0) return false;

    // Check for gaps between ranges
    for (let i = 1; i < this.receiver.receivedSpans.length; i++) {
      if (this.receiver.receivedSpans[i][0] > this.receiver.receivedSpans[i - 1][1] + 1) {
        return false;
      }
    }

    // Check if last range ends at maxSeenIndex
    return this.receiver.receivedSpans[this.receiver.receivedSpans.length - 1][1] === this.receiver.maxSeenIndex;
  }

  // Start cycling through QR codes
  private startQRCycle(): void {
    if (this.qrCycleInterval) clearInterval(this.qrCycleInterval);
    this.qrCycleInterval = setInterval(() => {
      // Update QR code and state
      if (this.mode === 'send') {
        this.updateQRCode();
        this.notifyState();
      }
    }, QRTPB.QR_CYCLE_INTERVAL);
  }

  // Reset the protocol state
  reset(): void {
    this.sender = {
      dataToSend: null,
      chunks: [],
      currentChunkIndex: 0,
      acknowledgedSpans: [],
      isDone: false,
    };

    this.receiver = {
      receivedSpans: [],
      maxSeenIndex: 0,
      receivedText: '',
      isDone: false,
    };

    if (this.qrCycleInterval) {
      clearInterval(this.qrCycleInterval);
      this.qrCycleInterval = null;
    }

    console.log('Protocol state reset');

    // Notify about state changes
    this.notifyState();
    if (this.mode === 'send') {
      this.updateQRCode();
    }
  }

  // Clean up resources
  dispose(): void {
    this.reset();
  }

  // Get backchannel message for sender
  getBackchannelMessage(): string | null {
    // Don't send any messages if we've seen DONE from sender
    if (this.receiver.isDone) {
      return null;
    }

    // If receiver has all chunks, send DONE signal
    if (this.isTransmissionComplete()) {
      console.log('Sending DONE signal to sender');
      return QRTPB.BACK_DONE_SIGNAL;
    }

    if (this.receiver.receivedSpans.length === 0) return null;

    // Format ranges as R:start,end;start,end
    const message =
      QRTPB.BACK_RANGES_PREFIX + this.receiver.receivedSpans.map(([start, end]) => `${start},${end}`).join(';');

    return message;
  }

  // Process backchannel message from receiver
  processBackchannelMessage(message: string): void {
    console.log('Processing backchannel message:', message);
    try {
      // Check for DONE signal
      if (message === QRTPB.BACK_DONE_SIGNAL) {
        console.log('Received DONE signal from receiver');
        this.sender.isDone = true;
        this.notifyState();
        this.updateQRCode(); // Update QR code to show DONE
        return;
      }

      // Format: "R:" followed by ranges in format "start,end;start,end"
      if (!message.startsWith(QRTPB.BACK_RANGES_PREFIX)) {
        console.log(`Invalid message format: ${message}`);
        return;
      }

      const data = message.substring(QRTPB.BACK_RANGES_PREFIX.length);
      const rangeParts = data.split(';');

      // Parse all ranges from the message
      const newRanges: Array<[number, number]> = [];
      for (const rangePart of rangeParts) {
        try {
          const [startStr, endStr] = rangePart.split(',');
          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);

          if (!isNaN(start) && !isNaN(end) && start <= end) {
            newRanges.push([start, end]);
          }
        } catch (e) {
          console.log(`Invalid range format: ${rangePart}`);
        }
      }

      if (newRanges.length === 0) {
        console.log('No valid ranges found');
        return;
      }

      // Replace the excluded ranges with the new ranges and merge them
      this.sender.acknowledgedSpans = this.mergeSpans([], newRanges);

      // Calculate how many chunks are now excluded
      const excludedCount = this.sender.chunks.filter((chunk) =>
        this.sender.acknowledgedSpans.some((range) => chunk.startIndex >= range[0] && chunk.endIndex <= range[1]),
      ).length;
      console.log(`${excludedCount} of ${this.sender.chunks.length} chunks are now excluded`);

      // Notify about state changes
      this.notifyState();
      this.updateQRCode();
    } catch (e) {
      console.log(`Failed to process backchannel message: ${e}`);
    }
  }
}
