/**
 * FolkRTC - A minimal WebRTC utility for peer-to-peer connections
 *
 * Simple utility for establishing WebRTC data channel connections
 * without requiring a signaling server.
 */

// Types for the connection process
export interface RTCConnectionData {
  sdp: RTCSessionDescription;
  iceCandidates: RTCIceCandidate[];
}

/**
 * Minimal WebRTC connection manager
 */
export class FolkRTC {
  static iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  #peerConnection: RTCPeerConnection | null = null;
  #dataChannel: RTCDataChannel | null = null;
  #iceCandidates: RTCIceCandidate[] = [];
  #role: 'initiator' | 'responder' | null = null;

  // Event handlers
  public onStatusChange: ((status: string) => void) | null = null;
  public onMessage: ((message: string) => void) | null = null;

  /**
   * Create a new FolkRTC instance
   */
  constructor() {
    // Use Google's public STUN server
    this.#initPeerConnection();
  }

  /**
   * Initialize the WebRTC connection
   */
  #initPeerConnection(): void {
    this.#peerConnection = new RTCPeerConnection({
      iceServers: FolkRTC.iceServers,
    });

    this.#iceCandidates = [];

    // Set up ICE candidate handling
    this.#peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.#iceCandidates.push(candidate);
      }
    };

    // Connection state changes
    this.#peerConnection.onconnectionstatechange = () => {
      if (!this.#peerConnection) return;

      const state = this.#peerConnection.connectionState;
      if (this.onStatusChange) {
        this.onStatusChange(state);
      }
    };
  }

  /**
   * Set up the data channel
   */
  #setupDataChannel(channel: RTCDataChannel): void {
    this.#dataChannel = channel;

    channel.onmessage = (event) => {
      if (this.onMessage) {
        this.onMessage(event.data);
      }
    };
  }

  /**
   * Wait for ICE candidates to be gathered (with timeout)
   */
  #waitForIceCandidates(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#peerConnection || this.#peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (!this.#peerConnection) return;
        if (this.#peerConnection.iceGatheringState === 'complete') {
          this.#peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.#peerConnection.addEventListener('icegatheringstatechange', checkState);

      // Set a timeout in case gathering takes too long
      setTimeout(resolve, 2000);
    });
  }

  /**
   * Create an offer as the initiator
   */
  public async createOffer(): Promise<RTCConnectionData> {
    this.#role = 'initiator';

    try {
      // Create data channel
      this.#dataChannel = this.#peerConnection!.createDataChannel('chat');
      this.#setupDataChannel(this.#dataChannel);

      // Create offer
      const offer = await this.#peerConnection!.createOffer();

      // Set local description
      await this.#peerConnection!.setLocalDescription(offer);

      // Wait for ICE gathering to complete or timeout
      await this.#waitForIceCandidates();

      // Create the complete offer with ICE candidates
      return {
        sdp: this.#peerConnection!.localDescription as RTCSessionDescription,
        iceCandidates: this.#iceCandidates,
      };
    } catch (error) {
      console.error('Error creating offer:', error);
      throw error;
    }
  }

  /**
   * Set the remote answer as the initiator
   */
  public async setAnswer(answerData: RTCConnectionData): Promise<void> {
    if (this.#role !== 'initiator') {
      throw new Error('This method should only be called by the initiator');
    }

    try {
      // Set the remote description
      await this.#peerConnection!.setRemoteDescription(answerData.sdp);

      // Add ICE candidates from the answer
      for (const candidate of answerData.iceCandidates) {
        await this.#peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error setting remote answer:', error);
      throw error;
    }
  }

  /**
   * Create an answer as the responder
   */
  public async createAnswer(offerData: RTCConnectionData): Promise<RTCConnectionData> {
    this.#role = 'responder';

    try {
      // Set up data channel handler (for responder)
      this.#peerConnection!.ondatachannel = (event) => {
        this.#setupDataChannel(event.channel);
      };

      // Set the remote description
      await this.#peerConnection!.setRemoteDescription(offerData.sdp);

      // Add ICE candidates from the offer
      for (const candidate of offerData.iceCandidates) {
        await this.#peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Create answer
      const answer = await this.#peerConnection!.createAnswer();

      // Set local description
      await this.#peerConnection!.setLocalDescription(answer);

      // Wait for ICE gathering to complete or timeout
      await this.#waitForIceCandidates();

      // Create the complete answer with ICE candidates
      return {
        sdp: this.#peerConnection!.localDescription as RTCSessionDescription,
        iceCandidates: this.#iceCandidates,
      };
    } catch (error) {
      console.error('Error creating answer:', error);
      throw error;
    }
  }

  /**
   * Send a message through the data channel
   */
  public sendMessage(message: string): boolean {
    if (!this.#dataChannel || this.#dataChannel.readyState !== 'open') {
      return false;
    }

    try {
      this.#dataChannel.send(message);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Close the connection
   */
  public close(): void {
    if (this.#dataChannel) {
      this.#dataChannel.close();
      this.#dataChannel = null;
    }

    if (this.#peerConnection) {
      this.#peerConnection.close();
      this.#peerConnection = null;
    }

    this.#role = null;
    this.#iceCandidates = [];
  }

  /**
   * Check if the connection is active
   */
  public isConnected(): boolean {
    return !!this.#dataChannel && this.#dataChannel.readyState === 'open';
  }
}
