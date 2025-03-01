// QRTP - QR Transfer Protocol
// A silly simple data transfer protocol using QR codes

export type MessageLogCallback = (direction: string, type: string, message: string, data?: any) => void;
export type ChunkAcknowledgedCallback = () => void;

export interface QRTPResponse {
  type: 'chunk' | 'complete' | 'ack' | 'invalid' | 'unknown' | 'processed';
  message: string;
  data?: string;
  chunkIndex?: number;
  totalChunks?: number;
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
  private onChunkAcknowledged: ChunkAcknowledgedCallback | null = null;

  // Cache for hashes to avoid recalculating
  private hashCache: Map<string, string> = new Map();

  constructor() {
    // Initialize with default values
  }

  // Set message log callback
  setMessageLogCallback(callback: MessageLogCallback): void {
    this.messageLogCallback = callback;
  }

  // Set callback for when a chunk is acknowledged
  setChunkAcknowledgedCallback(callback: ChunkAcknowledgedCallback): void {
    this.onChunkAcknowledged = callback;
  }

  // Log a message
  logMessage(direction: string, type: string, message: string, data: any = null): void {
    if (this.messageLogCallback) {
      this.messageLogCallback(direction, type, message, data);
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
      return false;
    }

    this.dataToSend = data;
    this.chunkSize = chunkSize || this.chunkSize;
    this.chunkData();
    this.logMessage('outgoing', 'info', `Data set for sending: ${data.length} bytes, chunk size: ${this.chunkSize}`);
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

  // Generate hash for a chunk using Web Crypto API
  async generateChunkHashAsync(chunk: string, index: number): Promise<string> {
    const cacheKey = `${index}:${chunk}`;

    // Check if we have this hash cached
    if (this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!;
    }

    // Convert string to ArrayBuffer
    const encoder = new TextEncoder();
    const data = encoder.encode(`${index}:${chunk}`);

    // Generate hash using Web Crypto API
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert hash to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    // Take first 8 characters
    const shortHash = hashHex.substring(0, 8);

    // Cache the result
    this.hashCache.set(cacheKey, shortHash);

    return shortHash;
  }

  // Synchronous wrapper for hash generation (uses a simple hash for immediate results)
  generateChunkHash(chunk: string, index: number): string {
    const cacheKey = `${index}:${chunk}`;

    // Check if we have this hash cached
    if (this.hashCache.has(cacheKey)) {
      return this.hashCache.get(cacheKey)!;
    }

    // Simple hash function for immediate results
    // This is a fallback that will be replaced with the async result when available
    let hash = 0;
    const str = `${index}:${chunk}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    // Convert to 8-character hex string
    const tempHash = (hash >>> 0).toString(16).padStart(8, '0');

    // Start async hash calculation to update the cache
    this.generateChunkHashAsync(chunk, index).then((asyncHash) => {
      this.hashCache.set(cacheKey, asyncHash);
    });

    return tempHash;
  }

  // Get the current QR code data to display
  getCurrentQRCodeData(): string {
    // If we have no data to send
    if (this.dataChunks.length === 0) {
      const qrData = `${this.protocolPrefix}[]:${this.lastReceivedHash}:`;
      this.logMessage('outgoing', 'ack', `Sending acknowledgment only`, { hash: this.lastReceivedHash });
      return qrData;
    }

    // If we've sent all chunks
    if (this.currentChunkIndex >= this.dataChunks.length) {
      this.isTransmissionComplete = true;
      const qrData = `${this.protocolPrefix}[]:${this.lastReceivedHash}:`;
      this.logMessage('outgoing', 'ack', `All chunks sent, sending acknowledgment only`, {
        hash: this.lastReceivedHash,
      });
      return qrData;
    }

    // We have data to send
    const chunk = this.dataChunks[this.currentChunkIndex];
    const qrData = `${this.protocolPrefix}[${this.currentChunkIndex}/${this.totalChunks}]:${this.lastReceivedHash}:${chunk}`;

    this.logMessage('outgoing', 'data', `Sending chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`, {
      chunkIndex: this.currentChunkIndex,
      totalChunks: this.totalChunks,
      hash: this.lastReceivedHash,
      dataPreview: chunk.length > 20 ? chunk.substring(0, 20) + '...' : chunk,
    });

    return qrData;
  }

  // Process received QR code data
  processReceivedData(data: string): QRTPResponse {
    if (!data.startsWith(`${this.protocolPrefix}[`)) {
      this.logMessage('incoming', 'error', `Invalid QR code format: ${data}`);
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    // Parse the QRTP header
    const headerEndIndex = data.indexOf(']');
    if (headerEndIndex === -1) {
      this.logMessage('incoming', 'error', `Invalid QR code format: missing closing bracket`);
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    const header = data.substring(this.protocolPrefix.length + 1, headerEndIndex); // Extract what's inside QRTP[...]
    const remainingData = data.substring(headerEndIndex + 1);
    const parts = remainingData.split(':');

    if (parts.length < 2) {
      this.logMessage('incoming', 'error', `Invalid QR code format: insufficient parts`);
      return { type: 'invalid', message: 'Invalid QR code format' };
    }

    const receivedHash = parts[0];
    const payload = parts.slice(1).join(':'); // Rejoin in case payload contains colons

    // Process incoming data if any
    let incomingDataProcessed = false;
    if (header) {
      const chunkInfo = header.split('/');
      if (chunkInfo.length === 2) {
        const chunkIndex = parseInt(chunkInfo[0], 10);
        const totalChunks = parseInt(chunkInfo[1], 10);

        if (!isNaN(chunkIndex) && !isNaN(totalChunks) && payload) {
          incomingDataProcessed = true;

          // Store the received chunk
          this.receivedChunks.set(chunkIndex, payload);

          // Generate hash for acknowledgment
          this.lastReceivedHash = this.generateChunkHash(payload, chunkIndex);

          this.logMessage('incoming', 'data', `Received chunk ${chunkIndex + 1}/${totalChunks}`, {
            chunkIndex: chunkIndex,
            totalChunks: totalChunks,
            dataPreview: payload.length > 20 ? payload.substring(0, 20) + '...' : payload,
            generatedHash: this.lastReceivedHash,
          });

          // Check if we've received all chunks
          if (this.receivedChunks.size === totalChunks) {
            // Combine all chunks
            let combinedData = '';
            for (let i = 0; i < totalChunks; i++) {
              if (this.receivedChunks.has(i)) {
                combinedData += this.receivedChunks.get(i);
              }
            }

            this.logMessage('incoming', 'complete', `All ${totalChunks} chunks received, message complete`, {
              messageLength: combinedData.length,
            });

            return {
              type: 'complete',
              message: 'All chunks received',
              data: combinedData,
              totalChunks: totalChunks,
            };
          }

          // After processing incoming data, check if there's an acknowledgment
          if (receivedHash && this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length) {
            this.checkAcknowledgment(receivedHash);
          }

          return {
            type: 'chunk',
            message: `Received chunk ${chunkIndex + 1} of ${totalChunks}`,
            chunkIndex: chunkIndex,
            totalChunks: totalChunks,
          };
        }
      }
    }

    // Just an acknowledgment with no data
    if (header === '' && receivedHash) {
      this.logMessage('incoming', 'ack', `Received acknowledgment only`, { hash: receivedHash });

      // Check if this acknowledges our current chunk
      if (this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length) {
        this.checkAcknowledgment(receivedHash);
      }

      return { type: 'ack', message: 'Acknowledgment received' };
    }

    // If we got here and didn't process any incoming data, but there's a hash,
    // still check if it acknowledges our current chunk
    if (
      !incomingDataProcessed &&
      receivedHash &&
      this.dataChunks.length > 0 &&
      this.currentChunkIndex < this.dataChunks.length
    ) {
      this.checkAcknowledgment(receivedHash);
    }

    if (!incomingDataProcessed) {
      this.logMessage('incoming', 'unknown', `Unknown QR code format: ${data}`);
      return { type: 'unknown', message: 'Unknown QR code format' };
    }

    return { type: 'processed', message: 'QR code processed' };
  }

  // Helper method to check if a received hash acknowledges our current chunk
  private checkAcknowledgment(receivedHash: string): boolean {
    const currentChunk = this.dataChunks[this.currentChunkIndex];
    const expectedHash = this.generateChunkHash(currentChunk, this.currentChunkIndex);

    // Debug log to see what's happening with the hashes
    this.logMessage('debug', 'hash', `Hash comparison`, {
      received: receivedHash,
      expected: expectedHash,
      chunkIndex: this.currentChunkIndex,
    });

    if (receivedHash === expectedHash) {
      // Our chunk was acknowledged, move to the next one
      this.logMessage(
        'incoming',
        'ack',
        `Received acknowledgment for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`,
        {
          hash: receivedHash,
          chunkIndex: this.currentChunkIndex,
        },
      );

      this.currentChunkIndex++;

      if (this.currentChunkIndex >= this.dataChunks.length) {
        this.isTransmissionComplete = true;
        this.logMessage('outgoing', 'complete', `All chunks have been acknowledged`);
      }

      // Signal that the QR code should be updated
      if (this.onChunkAcknowledged) {
        this.onChunkAcknowledged();
      }

      return true;
    } else {
      this.logMessage('incoming', 'warning', `Received hash doesn't match expected hash`, {
        received: receivedHash,
        expected: expectedHash,
        chunkIndex: this.currentChunkIndex,
      });

      return false;
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
}
