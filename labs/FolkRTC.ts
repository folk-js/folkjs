/**
 * FolkRTC - A simple WebRTC utility for peer-to-peer connections
 *
 * This utility provides an easy way to establish WebRTC connections
 * for data channels between two peers without requiring a signaling server.
 * It handles the offer/answer exchange process and ICE candidate gathering.
 */

// Types for the connection process
export interface RTCConnectionData {
  sdp: RTCSessionDescription;
  iceCandidates: RTCIceCandidate[];
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export interface ConnectionEvents {
  onStateChange?: (state: ConnectionState, message: string) => void;
  onMessage?: (message: string) => void;
  onError?: (error: Error) => void;
}

/**
 * FolkRTC class for handling WebRTC connections
 */
export class FolkRTC {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private iceCandidates: RTCIceCandidate[] = [];
  private events: ConnectionEvents = {};
  private role: 'initiator' | 'responder' | null = null;

  /**
   * Create a new FolkRTC instance
   * @param events Optional event handlers
   */
  constructor(events?: ConnectionEvents) {
    if (events) {
      this.events = events;
    }
  }

  /**
   * Initialize the WebRTC connection with Google's public STUN server
   * @private
   */
  private initPeerConnection(): void {
    // WebRTC configuration with Google's public STUN server
    const rtcConfig: RTCConfiguration = {
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302',
        },
      ],
    };

    // Create a new RTCPeerConnection
    this.peerConnection = new RTCPeerConnection(rtcConfig);
    this.iceCandidates = [];

    // Set up ICE candidate handling
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('New ICE candidate:', event.candidate);
        this.iceCandidates.push(event.candidate);
      } else {
        console.log('All ICE candidates gathered');
      }
    };

    // Connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      if (!this.peerConnection) return;

      console.log('Connection state:', this.peerConnection.connectionState);

      if (this.peerConnection.connectionState === 'connected') {
        this.updateState('connected', 'Connected!');
      } else if (
        this.peerConnection.connectionState === 'disconnected' ||
        this.peerConnection.connectionState === 'failed' ||
        this.peerConnection.connectionState === 'closed'
      ) {
        this.updateState('disconnected', 'Disconnected');
      }
    };

    // ICE connection state changes
    this.peerConnection.oniceconnectionstatechange = () => {
      if (!this.peerConnection) return;
      console.log('ICE connection state:', this.peerConnection.iceConnectionState);
    };
  }

  /**
   * Update the connection state and trigger the onStateChange event
   * @param state The new connection state
   * @param message A message describing the state change
   * @private
   */
  private updateState(state: ConnectionState, message: string): void {
    if (this.events.onStateChange) {
      this.events.onStateChange(state, message);
    }
  }

  /**
   * Wait for ICE candidates to be gathered (with timeout)
   * @param timeout Timeout in milliseconds (default: 2000)
   * @private
   */
  private waitForIceCandidates(timeout: number = 2000): Promise<void> {
    return new Promise((resolve) => {
      if (!this.peerConnection || this.peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (!this.peerConnection) return;
        if (this.peerConnection.iceGatheringState === 'complete') {
          this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.peerConnection.addEventListener('icegatheringstatechange', checkState);

      // Set a timeout in case gathering takes too long
      setTimeout(resolve, timeout);
    });
  }

  /**
   * Set up the data channel event handlers
   * @param channel The data channel to set up
   * @private
   */
  private setupDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      console.log('Data channel is open');
      this.updateState('connected', 'Data channel open');
    };

    channel.onclose = () => {
      console.log('Data channel is closed');
      this.updateState('disconnected', 'Data channel closed');
    };

    channel.onmessage = (event) => {
      console.log('Message received:', event.data);
      if (this.events.onMessage) {
        this.events.onMessage(event.data);
      }
    };
  }

  /**
   * Create an offer as the initiator
   * @returns Promise that resolves to the connection data (offer)
   */
  public async createOffer(): Promise<RTCConnectionData> {
    this.role = 'initiator';
    this.updateState('connecting', 'Creating offer...');

    try {
      // Initialize WebRTC connection
      this.initPeerConnection();

      if (!this.peerConnection) {
        throw new Error('PeerConnection not initialized');
      }

      // Create data channel
      this.dataChannel = this.peerConnection.createDataChannel('chat');
      this.setupDataChannel(this.dataChannel);

      // Create offer
      const offer = await this.peerConnection.createOffer();

      // Set local description
      await this.peerConnection.setLocalDescription(offer);

      // Wait for ICE gathering to complete or timeout
      await this.waitForIceCandidates();

      // Create the complete offer with ICE candidates
      const completeOffer: RTCConnectionData = {
        sdp: this.peerConnection.localDescription as RTCSessionDescription,
        iceCandidates: this.iceCandidates,
      };

      this.updateState('connecting', 'Offer created. Waiting for answer...');
      return completeOffer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Error creating offer:', err);
      this.updateState('disconnected', 'Error creating offer');
      if (this.events.onError) {
        this.events.onError(err);
      }
      throw err;
    }
  }

  /**
   * Set the remote answer as the initiator
   * @param answerData The answer data from the responder
   */
  public async setAnswer(answerData: RTCConnectionData): Promise<void> {
    if (this.role !== 'initiator') {
      throw new Error('This method should only be called by the initiator');
    }

    this.updateState('connecting', 'Setting remote answer...');

    try {
      if (!this.peerConnection) {
        throw new Error('PeerConnection not initialized');
      }

      // Set the remote description
      await this.peerConnection.setRemoteDescription(answerData.sdp);

      // Add ICE candidates from the answer
      for (const candidate of answerData.iceCandidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }

      this.updateState('connecting', 'Answer set. Establishing connection...');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Error setting remote answer:', err);
      this.updateState('disconnected', 'Error setting remote answer');
      if (this.events.onError) {
        this.events.onError(err);
      }
      throw err;
    }
  }

  /**
   * Create an answer as the responder
   * @param offerData The offer data from the initiator
   * @returns Promise that resolves to the connection data (answer)
   */
  public async createAnswer(offerData: RTCConnectionData): Promise<RTCConnectionData> {
    this.role = 'responder';
    this.updateState('connecting', 'Creating answer...');

    try {
      // Initialize WebRTC connection
      this.initPeerConnection();

      if (!this.peerConnection) {
        throw new Error('PeerConnection not initialized');
      }

      // Set up data channel handler (for responder)
      this.peerConnection.ondatachannel = (event) => {
        console.log('Data channel received');
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel);
      };

      // Set the remote description
      await this.peerConnection.setRemoteDescription(offerData.sdp);

      // Add ICE candidates from the offer
      for (const candidate of offerData.iceCandidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Create answer
      const answer = await this.peerConnection.createAnswer();

      // Set local description
      await this.peerConnection.setLocalDescription(answer);

      // Wait for ICE gathering to complete or timeout
      await this.waitForIceCandidates();

      // Create the complete answer with ICE candidates
      const completeAnswer: RTCConnectionData = {
        sdp: this.peerConnection.localDescription as RTCSessionDescription,
        iceCandidates: this.iceCandidates,
      };

      this.updateState('connecting', 'Answer created. Waiting for connection...');
      return completeAnswer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error('Error creating answer:', err);
      this.updateState('disconnected', 'Error creating answer');
      if (this.events.onError) {
        this.events.onError(err);
      }
      throw err;
    }
  }

  /**
   * Send a message through the data channel
   * @param message The message to send
   * @returns True if the message was sent, false otherwise
   */
  public sendMessage(message: string): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.error('Cannot send message: Data channel not open');
      return false;
    }

    try {
      this.dataChannel.send(message);
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
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.role = null;
    this.iceCandidates = [];
    this.updateState('disconnected', 'Connection closed');
  }

  /**
   * Check if the connection is active
   * @returns True if the data channel is open, false otherwise
   */
  public isConnected(): boolean {
    return !!this.dataChannel && this.dataChannel.readyState === 'open';
  }

  /**
   * Get the current role (initiator or responder)
   * @returns The current role or null if not set
   */
  public getRole(): 'initiator' | 'responder' | null {
    return this.role;
  }
}

export default FolkRTC;
