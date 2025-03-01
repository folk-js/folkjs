// QRTP - QR Transfer Protocol
// A silly simple data transfer protocol using QR codes

export type MessageLogCallback = (direction: string, type: string, message: string, data?: any) => void;
export type OnChangeCallback = (state: QRTPState) => void;

export interface QRTPResponse {
  type: 'chunk' | 'complete' | 'ack' | 'invalid' | 'unknown' | 'processed';
  message: string;
  data?: string;
  chunkIndex?: number;
  totalChunks?: number;
}

export interface QRTPState {
  currentChunkIndex: number;
  totalChunks: number;
  receivedChunksCount: number;
  isTransmissionComplete: boolean;
}

export class QRTP {
  // Data to be sent
  private dataToSend: string | null = null;
  private dataChunks: string[] = [];
  private currentChunkIndex: number = 0;
  private totalChunks: number = 0;

  // Data being received
  private receivedChunks: Map<number, string> = new Map();
  private lastReceivedHash: string = '';

  // Configuration
  private chunkSize: number = 100;
  private protocolPrefix: string = 'QRTP';

  // State
  private isTransmissionComplete: boolean = false;

  // Callbacks
  private messageLogCallback: MessageLogCallback | null = null;
  private onChangeCallback: OnChangeCallback | null = null;

  constructor(messageLogCallback?: MessageLogCallback, onChangeCallback?: OnChangeCallback) {
    // Initialize callbacks if provided
    this.messageLogCallback = messageLogCallback || null;
    this.onChangeCallback = onChangeCallback || null;
  }

  // Notify about state changes
  private notifyChange(): void {
    if (this.onChangeCallback) {
      const state: QRTPState = {
        currentChunkIndex: this.currentChunkIndex,
        totalChunks: this.totalChunks,
        receivedChunksCount: this.receivedChunks.size,
        isTransmissionComplete: this.isTransmissionComplete,
      };

      this.onChangeCallback(state);
    }
  }

  // Log a message
  logMessage(direction: string, type: string, message: string, data: any = null): void {
    if (this.messageLogCallback) {
      if (typeof data === 'object') {
        // Convert object to raw string for logging
        const rawData = JSON.stringify(data);
        this.messageLogCallback(direction, type, message, rawData);
      } else {
        this.messageLogCallback(direction, type, message, data);
      }
    }
  }

  // Set data to be sent and chunk it
  setData(data: string, chunkSize?: number): boolean {
    if (!data || data.trim() === '') {
      this.dataToSend = null;
      this.dataChunks = [];
      this.currentChunkIndex = 0;
      this.totalChunks = 0;
      this.isTransmissionComplete = false;
      this.notifyChange();
      return false;
    }

    this.dataToSend = data;
    this.chunkSize = chunkSize || this.chunkSize;
    this.chunkData();
    this.logMessage('outgoing', 'info', `Data set for sending: ${data.length} bytes, chunk size: ${this.chunkSize}`);
    this.notifyChange();
    return true;
  }

  // Chunk the data into smaller pieces
  private chunkData(): void {
    this.dataChunks = [];
    this.currentChunkIndex = 0;
    this.isTransmissionComplete = false;

    if (!this.dataToSend) return;

    // Split text into chunks
    for (let i = 0; i < this.dataToSend.length; i += this.chunkSize) {
      const chunk = this.dataToSend.substring(i, i + this.chunkSize);
      this.dataChunks.push(chunk);
    }

    this.totalChunks = this.dataChunks.length;
    this.logMessage('outgoing', 'info', `Data chunked into ${this.totalChunks} pieces`);
  }

  // Generate hash for a chunk
  generateChunkHash(chunk: string): string {
    console.log('hashing:', chunk);
    // Simple hash function that only considers the chunk data
    let hash = 0;
    const str = chunk; // Only hash the chunk data, not the index

    // Log what we're hashing for debugging
    this.logMessage(
      'debug',
      'hash',
      `Generating hash for chunk: ${chunk.substring(0, 20)}${chunk.length > 20 ? '...' : ''}`,
    );

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0; // Force 32-bit integer with | 0
    }

    // Convert to 8-character hex string with consistent sign handling
    const hashUint = hash < 0 ? hash + 4294967296 : hash; // Convert negative to positive
    const hashStr = hashUint.toString(16).padStart(8, '0');

    this.logMessage('debug', 'hash', `Generated hash: ${hashStr}`);
    return hashStr;
  }

  // Get the current QR code data to display
  getCurrentQRCodeData(): string {
    // If we have no data to send
    if (this.dataChunks.length === 0) {
      const qrData = `${this.protocolPrefix}[]:${this.lastReceivedHash}:`;
      this.logMessage('outgoing', 'ack', `Sending acknowledgment only`, qrData);
      return qrData;
    }

    // If we've sent all chunks
    if (this.currentChunkIndex >= this.dataChunks.length) {
      this.isTransmissionComplete = true;
      const qrData = `${this.protocolPrefix}[]:${this.lastReceivedHash}:`;
      this.logMessage('outgoing', 'ack', `All chunks sent, sending acknowledgment only`, qrData);
      return qrData;
    }

    // We have data to send
    const chunk = this.dataChunks[this.currentChunkIndex];
    const qrData = `${this.protocolPrefix}[${this.currentChunkIndex}/${this.totalChunks}]:${this.lastReceivedHash}:${chunk}`;

    this.logMessage('outgoing', 'data', `Sending chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`, qrData);

    return qrData;
  }

  // Process received QR code data
  processReceivedData(data: string): QRTPResponse {
    // Log the raw data we're processing
    this.logMessage('incoming', 'raw', `Processing raw data`, data);

    // Early return for non-QRTP data
    if (!data.startsWith(`${this.protocolPrefix}[`)) {
      this.logMessage('incoming', 'error', `Invalid QR code format`, data);
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    // Parse all parts of the QR code data
    const parts = this.parseQRTPData(data);
    if (!parts) {
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    const { index, total, hash, payload } = parts;

    // Log the parsed components
    this.logMessage(
      'incoming',
      'parse',
      `Parsed QR: index=${index !== null ? index : 'null'}, total=${total !== null ? total : 'null'}, hash=${hash || 'none'}, payload=${payload ? payload.substring(0, 20) + (payload.length > 20 ? '...' : '') : 'none'}`,
    );

    // First, check if this is an acknowledgment for our current chunk
    if (hash && this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length) {
      const currentChunk = this.dataChunks[this.currentChunkIndex];
      const expectedHash = this.generateChunkHash(currentChunk);

      this.logMessage(
        'incoming',
        'ack-check',
        `Checking acknowledgment: received=${hash}, expected=${expectedHash}, index=${this.currentChunkIndex}`,
      );

      if (hash === expectedHash) {
        this.logMessage(
          'incoming',
          'ack',
          `✓ ACKNOWLEDGMENT MATCHED for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`,
          hash,
        );

        // Increment the chunk index
        this.currentChunkIndex++;

        // Check if we've sent all chunks
        if (this.currentChunkIndex >= this.dataChunks.length) {
          this.isTransmissionComplete = true;
          this.logMessage('outgoing', 'complete', `All chunks have been acknowledged`);
        }

        // Notify about the change
        this.notifyChange();

        return { type: 'ack', message: 'Acknowledgment received and matched' };
      } else {
        this.logMessage(
          'incoming',
          'ack',
          `✗ Acknowledgment did NOT match for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}. Expected: ${expectedHash}, Received: ${hash}`,
        );
      }
    }

    // Process incoming data chunk if present
    if (index !== null && total !== null && payload) {
      // Store the received chunk
      this.receivedChunks.set(index, payload);

      // Generate hash for acknowledgment - only hash the payload
      this.lastReceivedHash = this.generateChunkHash(payload);

      this.logMessage(
        'incoming',
        'chunk',
        `Received chunk ${index + 1}/${total}, generated hash=${this.lastReceivedHash}`,
        payload.substring(0, 20) + (payload.length > 20 ? '...' : ''),
      );

      // Notify about the change
      this.notifyChange();

      // Check if we've received all chunks
      if (this.receivedChunks.size === total) {
        // Combine all chunks
        let combinedData = '';
        for (let i = 0; i < total; i++) {
          if (this.receivedChunks.has(i)) {
            combinedData += this.receivedChunks.get(i);
          }
        }

        this.logMessage(
          'incoming',
          'complete',
          `All ${total} chunks received, message complete: ${combinedData.length} bytes`,
        );

        // Notify about completion
        this.notifyChange();

        return {
          type: 'complete',
          message: 'All chunks received',
          data: combinedData,
          totalChunks: total,
        };
      }

      return {
        type: 'chunk',
        message: `Received chunk ${index + 1} of ${total}`,
        chunkIndex: index,
        totalChunks: total,
      };
    }

    // Just an acknowledgment with no data
    if (index === null && hash) {
      this.logMessage('incoming', 'ack-only', `Received acknowledgment only: ${hash}`);
      this.notifyChange();
      return { type: 'ack', message: 'Acknowledgment received' };
    }

    this.logMessage('incoming', 'unknown', `Unknown QR code format`, data);
    return { type: 'unknown', message: 'Unknown QR code format' };
  }

  // Helper method to parse QRTP data
  private parseQRTPData(
    data: string,
  ): { index: number | null; total: number | null; hash: string | null; payload: string | null } | null {
    try {
      // Parse the QRTP header
      const headerEndIndex = data.indexOf(']');
      if (headerEndIndex === -1) {
        this.logMessage('incoming', 'error', `Invalid QR code format: missing closing bracket`, data);
        return null;
      }

      const header = data.substring(this.protocolPrefix.length + 1, headerEndIndex); // Extract what's inside QRTP[...]
      const remainingData = data.substring(headerEndIndex + 1);

      // Find the position of the first colon
      const firstColonIndex = remainingData.indexOf(':');
      if (firstColonIndex === -1) {
        this.logMessage('incoming', 'error', `Invalid QR code format: missing first colon separator`, data);
        return null;
      }

      const hash = remainingData.substring(0, firstColonIndex);
      const payload = remainingData.substring(firstColonIndex + 1); // Everything after the first colon is payload

      // Parse the header to get index and total
      let index: number | null = null;
      let total: number | null = null;

      if (header) {
        const chunkInfo = header.split('/');
        if (chunkInfo.length === 2) {
          index = parseInt(chunkInfo[0], 10);
          total = parseInt(chunkInfo[1], 10);

          if (isNaN(index) || isNaN(total)) {
            index = null;
            total = null;
          }
        }
      }

      console.log({ index, total, hash, payload });

      return {
        index,
        total,
        hash: hash || null,
        payload: payload || null,
      };
    } catch (error) {
      this.logMessage('incoming', 'error', `Error parsing QRTP data: ${error}`, data);
      return null;
    }
  }

  // Reset the protocol state
  reset(): void {
    this.dataToSend = null;
    this.dataChunks = [];
    this.currentChunkIndex = 0;
    this.totalChunks = 0;
    this.receivedChunks = new Map();
    this.lastReceivedHash = '';
    this.isTransmissionComplete = false;
    this.logMessage('system', 'reset', `Protocol state reset`);
    this.notifyChange();
  }

  // Get the total number of chunks expected to receive
  getTotalChunksToReceive(): number {
    // Find the maximum total from all received chunks
    let maxTotal = 0;
    this.receivedChunks.forEach((_, index) => {
      maxTotal = Math.max(maxTotal, index + 1);
    });
    return maxTotal;
  }

  getTotalChunks(): number {
    return this.totalChunks;
  }
}
