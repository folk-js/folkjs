// QRTP - QR Transfer Protocol
// A silly simple data transfer protocol using QR codes

import { header } from './utils/header';

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

// Define the packet structure that matches our header
export type QRTPPacket = {
  index: number;
  total: number;
  hash: string;
  payload?: string;
};

// Define typesafe header template using the header utility
const qrtpHeader = header('QRTP<index:num>/<total:num>:<hash:text>$');

export class QRTP {
  // Static configuration
  static readonly DEFAULT_CHUNK_SIZE: number = 100;

  // Data to be sent
  private dataToSend: string | null = null;
  private dataChunks: string[] = [];
  private currentChunkIndex: number = 0;
  private totalChunks: number = 0;

  // Data being received
  private receivedChunks: Map<number, string> = new Map();
  private lastReceivedHash: string = '';

  // Configuration
  private chunkSize: number = QRTP.DEFAULT_CHUNK_SIZE;

  // State
  private isTransmissionComplete: boolean = false;

  // Callbacks
  private messageLogCallback: MessageLogCallback | null = null;
  private onChangeCallback: OnChangeCallback | null = null;

  constructor(messageLogCallback?: MessageLogCallback, onChangeCallback?: OnChangeCallback) {
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
  generateChunkHash(chunk: string, index: number, total: number): string {
    // Include index and total in the hash calculation to prevent issues with repeat chunks
    const dataToHash = `${index}/${total}:${chunk}`;
    console.log(`🔐 Generating hash for: index=${index}, total=${total}, chunk length=${chunk.length}`);

    // Simple hash function that considers chunk data and metadata
    let hash = 0;

    for (let i = 0; i < dataToHash.length; i++) {
      const char = dataToHash.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0; // Force 32-bit integer with | 0
    }

    // Convert to 8-character hex string with consistent sign handling
    const hashUint = hash < 0 ? hash + 4294967296 : hash; // Convert negative to positive
    const hashStr = hashUint.toString(16).padStart(8, '0');

    console.log(`🔑 Generated hash: ${hashStr}`);
    return hashStr;
  }

  // Get the current QR code data to display
  getCurrentQRCodeData(): string {
    // Determine if this is a pure acknowledgment (no data payload) or includes a data chunk
    const hasDataToSend = this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length;
    this.isTransmissionComplete = this.dataChunks.length > 0 && this.currentChunkIndex >= this.dataChunks.length;

    console.log('📤 Generating QR code data:');
    console.log('  Has data to send?', hasDataToSend);
    console.log('  Transmission complete?', this.isTransmissionComplete);
    console.log('  Current chunk index:', this.currentChunkIndex);
    console.log('  Total chunks:', this.totalChunks);
    console.log('  ACK hash for previous chunk:', this.lastReceivedHash);

    // Create the packet with or without a payload
    let packet: QRTPPacket;

    if (hasDataToSend) {
      // Send a data chunk with acknowledgment hash
      const payload = this.dataChunks[this.currentChunkIndex];
      packet = {
        index: this.currentChunkIndex,
        total: this.totalChunks,
        hash: this.lastReceivedHash || '', // Always include ack hash, even if empty
        payload: payload,
      };

      console.log(
        `📤 Sending DATA chunk ${this.currentChunkIndex + 1}/${this.totalChunks} with ACK hash: ${this.lastReceivedHash}`,
      );
      console.log(`  Payload length: ${payload.length}`);

      this.logMessage(
        'outgoing',
        'data',
        `Sending chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`,
        `ACK: ${this.lastReceivedHash}`,
      );
    } else {
      // Send a pure acknowledgment with no data
      packet = {
        index: 0,
        total: this.totalChunks || 0, // Make sure total is always a valid number
        hash: this.lastReceivedHash || '',
      };

      console.log('📤 Sending PURE ACK with hash:', this.lastReceivedHash);

      if (this.isTransmissionComplete) {
        this.logMessage('outgoing', 'ack', `All chunks sent, sending pure acknowledgment`, this.lastReceivedHash);
      } else {
        this.logMessage('outgoing', 'ack', `Sending pure acknowledgment`, this.lastReceivedHash);
      }
    }

    // Encode the packet to QR code data
    return qrtpHeader.encode(packet);
  }

  // Process received QR code data
  processReceivedData(data: string): QRTPResponse {
    try {
      // Only attempt to parse if it's a QRTP packet
      if (!data.startsWith('QRTP')) {
        this.logMessage('incoming', 'error', `Invalid QR code format - not a QRTP packet`, data);
        return { type: 'invalid', message: 'Invalid QR code format' };
      }

      console.log('⬇️ Received data:', data.substring(0, 50) + (data.length > 50 ? '...' : ''));

      // Parse using our typesafe header
      const packet = qrtpHeader.decode(data);
      console.log('📦 Decoded packet:', JSON.stringify(packet, null, 2));

      // Determine if this is a pure ACK (no payload) or contains a data chunk
      const isPureAck = packet.index === 0 && !packet.payload;
      console.log(
        '🔍 Packet type:',
        isPureAck ? 'PURE ACK' : 'DATA+ACK',
        'index:',
        packet.index,
        'total:',
        packet.total,
      );
      console.log('  Includes ACK hash:', packet.hash);

      // Process acknowledgment hash if present, regardless of packet type
      let ackProcessed = false;
      if (packet.hash && this.dataChunks.length > 0 && this.currentChunkIndex < this.dataChunks.length) {
        const currentChunk = this.dataChunks[this.currentChunkIndex];
        const expectedHash = this.generateChunkHash(currentChunk, this.currentChunkIndex, this.totalChunks);

        console.log('🔐 ACK hash comparison:');
        console.log('  Received:', packet.hash);
        console.log('  Expected:', expectedHash);
        console.log('  Match?:', packet.hash === expectedHash);

        if (packet.hash === expectedHash) {
          this.logMessage(
            'incoming',
            'ack',
            `✓ ACKNOWLEDGMENT MATCHED for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}`,
            packet.hash,
          );

          // Increment the chunk index
          const oldIndex = this.currentChunkIndex;
          this.currentChunkIndex++;
          console.log(`⏩ Advanced chunk index: ${oldIndex} -> ${this.currentChunkIndex}`);
          ackProcessed = true;

          // Check if we've sent all chunks
          if (this.currentChunkIndex >= this.dataChunks.length) {
            this.isTransmissionComplete = true;
            console.log('🏁 All chunks acknowledged, transmission complete!');
            this.logMessage('outgoing', 'complete', `All chunks have been acknowledged`);
          }

          // Notify about the change
          this.notifyChange();
        } else {
          console.log('❌ Hash mismatch, acknowledgment NOT matched');
          this.logMessage(
            'incoming',
            'ack',
            `✗ Acknowledgment did NOT match for chunk ${this.currentChunkIndex + 1}/${this.totalChunks}. Expected: ${expectedHash}, Received: ${packet.hash}`,
          );
        }
      } else if (packet.hash) {
        console.log('ℹ️ Acknowledgment received but no chunks to acknowledge or all chunks sent');
        console.log('  Hash present:', !!packet.hash);
        console.log('  Data chunks length:', this.dataChunks.length);
        console.log('  Current index < total chunks:', this.currentChunkIndex < this.dataChunks.length);
      }

      // If this is a pure ACK with no data payload, we're done
      if (isPureAck) {
        this.logMessage('incoming', 'ack-only', `Received pure acknowledgment: ${packet.hash}`);
        this.notifyChange();
        return {
          type: 'ack',
          message: ackProcessed ? 'Acknowledgment received and matched' : 'Acknowledgment received',
        };
      }

      // Process data chunk if present
      if (packet.payload) {
        console.log(`📄 Processing data chunk at index ${packet.index}, content length: ${packet.payload.length}`);

        // Store the received chunk
        this.receivedChunks.set(packet.index, packet.payload);

        // Generate hash for acknowledging this chunk in our next message
        this.lastReceivedHash = this.generateChunkHash(packet.payload, packet.index, packet.total);
        console.log(`🔑 Generated hash for next ACK: ${this.lastReceivedHash}`);

        this.logMessage(
          'incoming',
          'chunk',
          `Received chunk ${packet.index + 1}/${packet.total}`,
          packet.payload.substring(0, 20) + (packet.payload.length > 20 ? '...' : ''),
        );

        // Notify about the change
        this.notifyChange();

        // Check if we've received all chunks
        console.log(`📊 Received ${this.receivedChunks.size}/${packet.total} chunks`);

        if (this.receivedChunks.size === packet.total) {
          console.log('🎉 All chunks received, assembling complete message');

          // Combine all chunks
          let combinedData = '';
          for (let i = 0; i < packet.total; i++) {
            if (this.receivedChunks.has(i)) {
              combinedData += this.receivedChunks.get(i);
            } else {
              console.log(`⚠️ Missing chunk at index ${i}`);
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

      console.log('⚠️ Data packet without payload');
      this.logMessage('incoming', 'unknown', `Data packet without payload`, packet);
      return { type: 'unknown', message: 'Data packet without payload' };
    } catch (error) {
      console.error('❌ Error processing QR code data:', error);
      this.logMessage('incoming', 'error', `Error processing QR code data: ${error}`, data);
      return { type: 'invalid', message: 'Invalid QR code format' };
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
