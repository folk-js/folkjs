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

export interface QRTPPacket {
  index: number | null;
  total: number | null;
  hash: string | null;
  payload: string | null;
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

    return hashStr;
  }

  // Convert a packet object to a string for QR code
  private packetToString(packet: QRTPPacket): string {
    let header = '';
    if (packet.index !== null && packet.total !== null) {
      header = `${packet.index}/${packet.total}`;
    }

    return `${this.protocolPrefix}[${header}]:${packet.hash || ''}:${packet.payload || ''}`;
  }

  // Get the current packet to send
  private getCurrentPacket(): QRTPPacket {
    // If we have no data to send or all chunks sent, just send an acknowledgment
    if (this.dataChunks.length === 0 || this.currentChunkIndex >= this.dataChunks.length) {
      this.isTransmissionComplete = this.dataChunks.length > 0 && this.currentChunkIndex >= this.dataChunks.length;

      return {
        index: null,
        total: null,
        hash: this.lastReceivedHash,
        payload: null,
      };
    }

    // We have data to send
    return {
      index: this.currentChunkIndex,
      total: this.totalChunks,
      hash: this.lastReceivedHash,
      payload: this.dataChunks[this.currentChunkIndex],
    };
  }

  // Get the current QR code data to display
  getCurrentQRCodeData(): string {
    const packet = this.getCurrentPacket();
    const qrData = this.packetToString(packet);

    // Log appropriate message based on packet type
    if (packet.index === null) {
      if (this.isTransmissionComplete) {
        this.logMessage('outgoing', 'ack', `All chunks sent, sending acknowledgment only`, qrData);
      } else {
        this.logMessage('outgoing', 'ack', `Sending acknowledgment only`, qrData);
      }
    } else {
      this.logMessage('outgoing', 'data', `Sending chunk ${packet.index + 1}/${packet.total}`, qrData);
    }

    return qrData;
  }

  // Process received QR code data
  processReceivedData(data: string): QRTPResponse {
    // Log the raw data we're processing
    this.logMessage('incoming', 'raw', `Processing raw data`, data);

    // Parse the QR code data into a packet
    const packet = this.parseQRTPData(data);

    // If parsing failed, return invalid response
    if (!packet) {
      this.logMessage('incoming', 'error', `Invalid QR code format`, data);
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    return this.processPacket(packet);
  }

  // Process a parsed packet
  private processPacket(packet: QRTPPacket): QRTPResponse {
    // Log the parsed components
    this.logMessage(
      'incoming',
      'parse',
      `Parsed QR: index=${packet.index !== null ? packet.index : 'null'}, total=${packet.total !== null ? packet.total : 'null'}, hash=${packet.hash || 'none'}, payload=${packet.payload ? packet.payload.substring(0, 20) + (packet.payload.length > 20 ? '...' : '') : 'none'}`,
    );

    // First, check if this is an acknowledgment for our current chunk
    if (packet.hash && this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length) {
      const currentChunk = this.dataChunks[this.currentChunkIndex];
      const expectedHash = this.generateChunkHash(currentChunk);

      this.logMessage(
        'incoming',
        'ack-check',
        `Checking acknowledgment: received=${packet.hash}, expected=${expectedHash}, index=${this.currentChunkIndex}`,
      );

      if (packet.hash === expectedHash) {
        this.logMessage(
          'incoming',
          'ack',
          `✓ ACKNOWLEDGMENT MATCHED for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`,
          packet.hash,
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
          `✗ Acknowledgment did NOT match for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}. Expected: ${expectedHash}, Received: ${packet.hash}`,
        );
      }
    }

    // Process incoming data chunk if present
    if (packet.index !== null && packet.total !== null && packet.payload) {
      // Store the received chunk
      this.receivedChunks.set(packet.index, packet.payload);

      // Generate hash for acknowledgment - only hash the payload
      this.lastReceivedHash = this.generateChunkHash(packet.payload);

      this.logMessage(
        'incoming',
        'chunk',
        `Received chunk ${packet.index + 1}/${packet.total}, generated hash=${this.lastReceivedHash}`,
        packet.payload.substring(0, 20) + (packet.payload.length > 20 ? '...' : ''),
      );

      // Notify about the change
      this.notifyChange();

      // Check if we've received all chunks
      if (this.receivedChunks.size === packet.total) {
        // Combine all chunks
        let combinedData = '';
        for (let i = 0; i < packet.total; i++) {
          if (this.receivedChunks.has(i)) {
            combinedData += this.receivedChunks.get(i);
          }
        }

        this.logMessage(
          'incoming',
          'complete',
          `All ${packet.total} chunks received, message complete: ${combinedData.length} bytes`,
        );

        // Notify about completion
        this.notifyChange();

        return {
          type: 'complete',
          message: 'All chunks received',
          data: combinedData,
          totalChunks: packet.total,
        };
      }

      return {
        type: 'chunk',
        message: `Received chunk ${packet.index + 1} of ${packet.total}`,
        chunkIndex: packet.index,
        totalChunks: packet.total,
      };
    }

    // Just an acknowledgment with no data
    if (packet.index === null && packet.hash) {
      this.logMessage('incoming', 'ack-only', `Received acknowledgment only: ${packet.hash}`);
      this.notifyChange();
      return { type: 'ack', message: 'Acknowledgment received' };
    }

    this.logMessage('incoming', 'unknown', `Unknown QR code format`, packet);
    return { type: 'unknown', message: 'Unknown QR code format' };
  }

  // Helper method to parse QRTP data
  private parseQRTPData(data: string): QRTPPacket | null {
    try {
      // Quick validation - must start with QRTP[
      if (!data.startsWith(`${this.protocolPrefix}[`)) {
        return null;
      }

      // Find the second colon which separates header from payload
      const firstColonIndex = data.indexOf(':');
      if (firstColonIndex === -1) return null;

      const secondColonIndex = data.indexOf(':', firstColonIndex + 1);
      if (secondColonIndex === -1) return null;

      // Split into header and payload
      const headerPart = data.substring(0, secondColonIndex);
      const payload = data.substring(secondColonIndex + 1) || null;

      // Extract hash - everything between first and second colon
      const hash = headerPart.substring(firstColonIndex + 1) || null;

      // Extract index/total from the header
      let index: number | null = null;
      let total: number | null = null;

      // Find the bracket positions to extract the index/total part
      const openBracketIndex = headerPart.indexOf('[');
      const closeBracketIndex = headerPart.indexOf(']');

      if (openBracketIndex !== -1 && closeBracketIndex !== -1) {
        const indexTotalPart = headerPart.substring(openBracketIndex + 1, closeBracketIndex);

        if (indexTotalPart.includes('/')) {
          const [indexStr, totalStr] = indexTotalPart.split('/');
          index = parseInt(indexStr, 10);
          total = parseInt(totalStr, 10);

          if (isNaN(index) || isNaN(total)) {
            index = null;
            total = null;
          }
        }
      }

      console.log({ index, total, hash, payload });

      // Create and return the packet
      return {
        index,
        total,
        hash,
        payload,
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

  // Get the number of chunks received
  getReceivedChunksCount(): number {
    return this.receivedChunks.size;
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

  // Check if all chunks have been sent
  isAllChunksSent(): boolean {
    return this.isTransmissionComplete;
  }

  // Get sending progress percentage
  getSendingProgress(): number {
    if (this.totalChunks === 0) return 0;
    return (Math.min(this.currentChunkIndex, this.totalChunks) / this.totalChunks) * 100;
  }

  // Getters for internal state (useful for UI updates)
  getCurrentChunkIndex(): number {
    return this.currentChunkIndex;
  }

  getTotalChunks(): number {
    return this.totalChunks;
  }

  // Get data for a specific chunk
  getChunkData(index: number): string | null {
    if (index >= 0 && index < this.dataChunks.length) {
      return this.dataChunks[index];
    }
    return null;
  }

  // Check if a specific chunk has been received
  hasReceivedChunk(index: number): boolean {
    return this.receivedChunks.has(index);
  }
}
