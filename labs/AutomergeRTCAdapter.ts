import { Message, NetworkAdapter, PeerId, PeerMetadata } from '@automerge/automerge-repo';
import mqtt from 'mqtt';
import { FolkRTC } from './FolkRTC';

/**
 * AutomergeRTCAdapter extends NetworkAdapter for Automerge
 * using WebRTC for peer-to-peer data transfer with MQTT signaling
 */
export class AutomergeRTCAdapter extends NetworkAdapter {
  private connections: Map<string, FolkRTC> = new Map();
  private mqttClient: mqtt.MqttClient | null = null;
  private mqttTopic: string | null = null;
  private connectionStatusListeners: Array<(peerId: string, connected: boolean) => void> = [];
  private peerIdStr: string;
  private _isReady = false;
  private connectedPeers: Set<string> = new Set();
  // Hardcoded MQTT broker URLs
  private brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
  private currentBrokerIndex = 0;

  /**
   * Create a new AutomergeRTCAdapter
   * @param options - Optional MQTT options (roomId)
   */
  constructor(options?: { roomId?: string }) {
    super();
    this.peerIdStr = `peer-${Math.floor(Math.random() * 1000000)}`;

    // Set up MQTT signaling with the first broker URL
    this.setupMQTTSignaling({
      url: this.brokerUrl,
      roomId: options?.roomId,
    });
  }

  /**
   * Initialize MQTT signaling for WebRTC connection establishment
   */
  private setupMQTTSignaling(options: { url: string; roomId?: string }): void {
    try {
      // Generate a random room ID if not provided
      const roomId = options.roomId || this.generateRoomId();
      this.mqttTopic = `folkcanvas/automerge/${roomId}`;

      console.log(`Connecting to MQTT broker: ${options.url} with topic ${this.mqttTopic}`);

      // Connect to the MQTT broker
      this.mqttClient = mqtt.connect(options.url, {
        keepalive: 60,
        clientId: `automerge-rtc-${this.peerIdStr}-${Math.random().toString(36).substring(2, 10)}`,
        clean: true,
        connectTimeout: 5000, // 5 seconds timeout
        reconnectPeriod: 2000, // Reconnect every 2 seconds
      });

      // Set connection timeout
      const connectionTimeout = setTimeout(() => {
        console.warn(`Connection to MQTT broker ${options.url} timed out.`);
      }, 7000);

      // Set up MQTT event handlers
      this.mqttClient.on('connect', () => {
        clearTimeout(connectionTimeout);
        console.log(`Connected to MQTT broker: ${options.url}`);

        // Subscribe to WebRTC signaling topics
        this.mqttClient?.subscribe(`${this.mqttTopic}/offer`, { qos: 0 });
        this.mqttClient?.subscribe(`${this.mqttTopic}/answer`, { qos: 0 });
        this.mqttClient?.subscribe(`${this.mqttTopic}/peer-discovery`, { qos: 0 });

        // Announce ourselves to other peers
        this.announcePeer();

        // Mark the adapter as ready
        this._isReady = true;
        this.emit('ready', { network: this });
      });

      this.mqttClient.on('message', (topic: string, message: Buffer) => {
        try {
          const data = JSON.parse(message.toString());

          // Skip messages from ourselves
          if (data.from === this.peerIdStr) return;

          if (topic === `${this.mqttTopic}/offer` && data.to === this.peerIdStr) {
            // Process incoming connection offer
            this.processIncomingOffer(data.from, data.offer);
          } else if (topic === `${this.mqttTopic}/answer` && data.to === this.peerIdStr) {
            // Process incoming connection answer
            this.processIncomingAnswer(data.from, data.answer);
          } else if (topic === `${this.mqttTopic}/peer-discovery`) {
            // Try to connect to new peers
            this.handlePeerDiscovery(data.peerId);
          }
        } catch (error) {
          console.error('Error processing MQTT message:', error);
        }
      });

      this.mqttClient.on('error', (error: any) => {
        console.error('MQTT connection error:', error);
        clearTimeout(connectionTimeout);
      });

      this.mqttClient.on('close', () => {
        console.log('MQTT connection closed');
      });

      this.mqttClient.on('offline', () => {
        console.log('MQTT client is offline');
      });
    } catch (error) {
      console.error('Error setting up MQTT signaling:', error);
    }
  }

  /**
   * Announce this peer to others via MQTT
   */
  private announcePeer(): void {
    console.log(`Announcing peer ${this.peerIdStr}`);
    if (!this.mqttClient || !this.mqttTopic) return;

    this.mqttClient.publish(
      `${this.mqttTopic}/peer-discovery`,
      JSON.stringify({
        peerId: this.peerIdStr,
        timestamp: Date.now(),
      }),
      { qos: 0, retain: false },
    );
  }

  /**
   * Handle peer discovery - initiate connection to new peers
   */
  private handlePeerDiscovery(remotePeerId: string): void {
    // Only initiate connection if we're not already connected and our peerId is "greater" to avoid duplicate connections
    if (!this.connections.has(remotePeerId) && this.peerIdStr > remotePeerId) {
      this.initiateConnection(remotePeerId);
    }
  }

  /**
   * Process an incoming WebRTC offer from a peer
   */
  private async processIncomingOffer(remotePeerId: string, offer: string): Promise<void> {
    console.log(`Processing incoming offer from peer ${remotePeerId}`);
    if (this.connections.has(remotePeerId)) {
      console.log(`Already connected to peer ${remotePeerId}, ignoring offer`);
      return;
    }

    try {
      // Create new WebRTC connection
      const rtcConnection = new FolkRTC();
      this.setupRTCEventHandlers(rtcConnection, remotePeerId);

      // Create answer for the offer
      const answer = await rtcConnection.createAnswer(offer);

      // Store the connection
      this.connections.set(remotePeerId, rtcConnection);

      // Send the answer back via MQTT
      if (this.mqttClient && this.mqttTopic) {
        this.mqttClient.publish(
          `${this.mqttTopic}/answer`,
          JSON.stringify({
            from: this.peerIdStr,
            to: remotePeerId,
            answer,
          }),
          { qos: 0, retain: false },
        );
      }
    } catch (error) {
      console.error(`Error processing offer from peer ${remotePeerId}:`, error);
    }
  }

  /**
   * Process an incoming WebRTC answer from a peer
   */
  private async processIncomingAnswer(remotePeerId: string, answer: string): Promise<void> {
    console.log(`Processing incoming answer from peer ${remotePeerId}`);
    const rtcConnection = this.connections.get(remotePeerId);
    if (!rtcConnection) {
      console.error(`No pending connection for peer ${remotePeerId}`);
      return;
    }

    try {
      // Set the remote answer to complete the connection
      await rtcConnection.setAnswer(answer);
    } catch (error) {
      console.error(`Error processing answer from peer ${remotePeerId}:`, error);
    }
  }

  /**
   * Set up event handlers for a WebRTC connection
   */
  private setupRTCEventHandlers(rtcConnection: FolkRTC, remotePeerId: string): void {
    rtcConnection.onStatusChange = (status: string) => {
      if (status === 'connected') {
        console.log(`Connected to peer: ${remotePeerId}`);
        this.connectedPeers.add(remotePeerId);
        this.notifyConnectionStatusListeners(remotePeerId, true);
      } else if (status === 'disconnected' || status === 'failed' || status === 'closed') {
        console.log(`Disconnected from peer: ${remotePeerId}`);
        this.connections.delete(remotePeerId);
        this.connectedPeers.delete(remotePeerId);
        this.notifyConnectionStatusListeners(remotePeerId, false);
      }
    };

    rtcConnection.onMessage = (message: string) => {
      try {
        // Convert the message to a Uint8Array for Automerge
        const binaryData = this.stringToUint8Array(message);

        // Create a message for Automerge
        const msg: Message = {
          type: 'sync',
          senderId: this.peerId as PeerId,
          targetId: remotePeerId as PeerId,
          data: binaryData,
        };

        // Emit message event
        this.emit('message', msg);
      } catch (error) {
        console.error('Error processing sync message:', error);
      }
    };
  }

  /**
   * Initiate a WebRTC connection to a remote peer
   */
  public async initiateConnection(remotePeerId: string): Promise<void> {
    if (this.connections.has(remotePeerId)) {
      console.log(`Already connected or connecting to peer ${remotePeerId}`);
      return;
    }

    // Create new WebRTC connection
    const rtcConnection = new FolkRTC();
    this.setupRTCEventHandlers(rtcConnection, remotePeerId);

    try {
      // Create an offer for the connection
      const offer = await rtcConnection.createOffer();

      // Store the connection
      this.connections.set(remotePeerId, rtcConnection);

      // Send the offer via MQTT
      if (this.mqttClient && this.mqttTopic) {
        this.mqttClient.publish(
          `${this.mqttTopic}/offer`,
          JSON.stringify({
            from: this.peerIdStr,
            to: remotePeerId,
            offer,
          }),
          { qos: 0, retain: false },
        );
      }
    } catch (error) {
      console.error(`Error initiating connection to peer ${remotePeerId}:`, error);
    }
  }

  /**
   * Generate a random room ID for MQTT topics
   */
  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Convert a string to a Uint8Array (for Automerge messages)
   */
  private stringToUint8Array(str: string): Uint8Array {
    return new TextEncoder().encode(str);
  }

  /**
   * Convert a Uint8Array to a string (for WebRTC messages)
   */
  private uint8ArrayToString(array: Uint8Array): string {
    return new TextDecoder().decode(array);
  }

  /**
   * Generate a shareable URL with the room ID.
   */
  public generateShareableUrl(baseUrl: string = window.location.href): string {
    if (!this.mqttClient || !this.mqttTopic) {
      throw new Error('MQTT signaling is not set up');
    }

    // Extract room ID from the MQTT topic
    const roomId = this.mqttTopic.split('/').pop();

    // Create URL parameters
    const url = new URL(baseUrl);
    url.searchParams.set('doc', roomId as string);

    return url.toString();
  }

  /**
   * Add a listener for connection status changes
   */
  public addConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    this.connectionStatusListeners.push(listener);
  }

  /**
   * Remove a connection status listener
   */
  public removeConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    const index = this.connectionStatusListeners.indexOf(listener);
    if (index !== -1) {
      this.connectionStatusListeners.splice(index, 1);
    }
  }

  /**
   * Notify all connection status listeners
   */
  private notifyConnectionStatusListeners(peerId: string, connected: boolean): void {
    for (const listener of this.connectionStatusListeners) {
      listener(peerId, connected);
    }
  }

  /**
   * Get all connected peer IDs
   */
  public getConnectedPeers(): string[] {
    return Array.from(this.connectedPeers);
  }

  // NetworkAdapter abstract methods implementation

  /**
   * Check if the adapter is ready
   */
  public isReady(): boolean {
    return this._isReady;
  }

  /**
   * Wait for the adapter to be ready
   */
  public async whenReady(): Promise<void> {
    if (this._isReady) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.once('ready', () => resolve());
    });
  }

  /**
   * Send a message to a specific peer
   */
  public send(message: Message): void {
    // In WebRTC connections, we need the targetId to identify which connection to use
    const remotePeerId = String(message.targetId);
    const connection = this.connections.get(remotePeerId);

    if (connection && message.data) {
      // Convert the Uint8Array to a string for sending via WebRTC
      const messageStr = this.uint8ArrayToString(message.data);
      connection.sendMessage(messageStr);
    }
  }

  /**
   * Start the connection process
   */
  public connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    // Store the peerId for later use
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;

    // If we're using MQTT, we can announce ourselves
    if (this.mqttClient && this.mqttTopic) {
      this.announcePeer();
    }
  }

  /**
   * Disconnect from all peers
   */
  public disconnect(): void {
    // Disconnect from all peers
    for (const connection of this.connections.values()) {
      connection.close();
    }
    this.connections.clear();
    this.connectedPeers.clear();

    // Disconnect from MQTT if connected
    if (this.mqttClient) {
      try {
        this.mqttClient.end(true);
        this.mqttClient = null;
        this.mqttTopic = null;
      } catch (e) {
        console.error('Error disconnecting from MQTT:', e);
      }
    }
  }
}
