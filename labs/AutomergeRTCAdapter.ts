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

      console.log(`[MQTT] Setting up signaling with topic ${this.mqttTopic}`);
      console.log(`[MQTT] Room ID: ${roomId}`);

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
        console.warn(`[MQTT] Connection to broker ${options.url} timed out.`);
      }, 7000);

      // Handle connection
      this.mqttClient.on('connect', () => {
        console.log(`[MQTT] Connected to broker: ${options.url}`);
        clearTimeout(connectionTimeout);
        this._isReady = true;

        // Subscribe to the topic for this room
        if (this.mqttClient && this.mqttTopic) {
          console.log(`[MQTT] Subscribing to topics: ${this.mqttTopic}/#`);
          this.mqttClient.subscribe(`${this.mqttTopic}/#`, (err) => {
            if (err) {
              console.error(`[MQTT] Subscription error:`, err);
            } else {
              console.log(`[MQTT] Successfully subscribed to ${this.mqttTopic}/#`);
              // Announce this peer to the room
              this.announcePeer();
            }
          });
        }
      });

      this.mqttClient.on('message', (topic, message) => {
        try {
          // Parse the message
          const payload = JSON.parse(message.toString());

          console.log(`[MQTT] Received message on topic: ${topic}`);

          // Handle different message types based on the topic
          if (topic.endsWith('/announce')) {
            // Handle peer announcement
            console.log(`[MQTT] Peer announcement from: ${payload.peerId}`);
            if (payload.peerId !== this.peerIdStr) {
              this.handlePeerDiscovery(payload.peerId);
            }
          } else if (topic.endsWith('/offer') && payload.to === this.peerIdStr) {
            // Handle WebRTC offer
            console.log(`[MQTT] Received offer from: ${payload.from}`);
            this.processIncomingOffer(payload.from, payload.offer);
          } else if (topic.endsWith('/answer') && payload.to === this.peerIdStr) {
            // Handle WebRTC answer
            console.log(`[MQTT] Received answer from: ${payload.from}`);
            this.processIncomingAnswer(payload.from, payload.answer);
          }
        } catch (error) {
          console.error(`[MQTT] Error processing message:`, error);
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
   * Announce this peer to the room via MQTT
   */
  private announcePeer(): void {
    if (!this.mqttClient || !this.mqttTopic) {
      console.warn('[MQTT] Cannot announce peer: MQTT not connected');
      return;
    }

    console.log(`[MQTT] Announcing peer ${this.peerIdStr} to topic ${this.mqttTopic}/announce`);

    // Publish an announcement message
    this.mqttClient.publish(
      `${this.mqttTopic}/announce`,
      JSON.stringify({
        peerId: this.peerIdStr,
        timestamp: Date.now(),
      }),
      { qos: 0, retain: false },
    );
  }

  /**
   * Handle peer discovery via MQTT announcement
   */
  private handlePeerDiscovery(remotePeerId: string): void {
    // Skip if it's our own peer ID
    if (remotePeerId === this.peerIdStr) {
      return;
    }

    console.log(`[MQTT] Discovered peer: ${remotePeerId}`);

    // Initiate a connection to the remote peer
    this.initiateConnection(remotePeerId);
  }

  /**
   * Process an incoming WebRTC offer
   */
  private async processIncomingOffer(remotePeerId: string, offer: string): Promise<void> {
    console.log(`[RTC] Processing offer from peer: ${remotePeerId}`);

    // Skip if we already have a connection to this peer
    if (this.connections.has(remotePeerId)) {
      console.log(`[RTC] Already connected to peer: ${remotePeerId}, ignoring offer`);
      return;
    }

    try {
      // Create a new WebRTC connection
      const rtcConnection = new FolkRTC();

      // Set up event handlers for the connection
      this.setupRTCEventHandlers(rtcConnection, remotePeerId);

      // Process the offer and create an answer
      const answer = await rtcConnection.createAnswer(offer);
      console.log(`[RTC] Created answer for peer: ${remotePeerId}`);

      // Store the connection
      this.connections.set(remotePeerId, rtcConnection);

      // Send the answer via MQTT
      if (this.mqttClient && this.mqttTopic) {
        console.log(`[MQTT] Sending answer to peer: ${remotePeerId}`);
        this.mqttClient.publish(
          `${this.mqttTopic}/answer`,
          JSON.stringify({
            from: this.peerIdStr,
            to: remotePeerId,
            answer,
          }),
          { qos: 0, retain: false },
        );
      } else {
        console.error(`[MQTT] Cannot send answer: MQTT not connected`);
      }
    } catch (error) {
      console.error(`[RTC] Error processing offer from peer ${remotePeerId}:`, error);
    }
  }

  /**
   * Process an incoming WebRTC answer
   */
  private async processIncomingAnswer(remotePeerId: string, answer: string): Promise<void> {
    console.log(`[RTC] Processing answer from peer: ${remotePeerId}`);

    // Get the connection for this peer
    const rtcConnection = this.connections.get(remotePeerId);
    if (!rtcConnection) {
      console.error(`[RTC] No connection found for peer: ${remotePeerId}`);
      return;
    }

    try {
      // Process the answer
      await rtcConnection.setAnswer(answer);
      console.log(`[RTC] Successfully processed answer from peer: ${remotePeerId}`);
    } catch (error) {
      console.error(`[RTC] Error processing answer from peer ${remotePeerId}:`, error);
    }
  }

  /**
   * Set up event handlers for a WebRTC connection
   */
  private setupRTCEventHandlers(rtcConnection: FolkRTC, remotePeerId: string): void {
    rtcConnection.onStatusChange = (status: string) => {
      console.log(`[RTC] Connection state changed for peer ${remotePeerId}: ${status}`);

      if (status === 'connected') {
        console.log(`[RTC] Connected to peer: ${remotePeerId}`);
        this.connectedPeers.add(remotePeerId);
        this.notifyConnectionStatusListeners(remotePeerId, true);
      } else if (status === 'disconnected' || status === 'failed' || status === 'closed') {
        console.log(`[RTC] Disconnected from peer: ${remotePeerId}`);
        this.connectedPeers.delete(remotePeerId);
        this.connections.delete(remotePeerId);
        this.notifyConnectionStatusListeners(remotePeerId, false);
      }
    };

    rtcConnection.onMessage = (message: string) => {
      console.log(`[RTC] Received message from peer: ${remotePeerId} (${message.length} bytes)`);

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
        console.error(`[RTC] Error processing message from peer ${remotePeerId}:`, error);
      }
    };
  }

  /**
   * Initiate a WebRTC connection to a remote peer
   */
  public async initiateConnection(remotePeerId: string): Promise<void> {
    console.log(`[RTC] Initiating connection to peer: ${remotePeerId}`);

    // Skip if we already have a connection to this peer
    if (this.connections.has(remotePeerId)) {
      console.log(`[RTC] Already connected to peer: ${remotePeerId}`);
      return;
    }

    // Create a new WebRTC connection
    const rtcConnection = new FolkRTC();

    // Set up event handlers for the connection
    this.setupRTCEventHandlers(rtcConnection, remotePeerId);

    try {
      // Create an offer for the connection
      const offer = await rtcConnection.createOffer();
      console.log(`[RTC] Created offer for peer: ${remotePeerId}`);

      // Store the connection
      this.connections.set(remotePeerId, rtcConnection);

      // Send the offer via MQTT
      if (this.mqttClient && this.mqttTopic) {
        console.log(`[MQTT] Sending offer to peer: ${remotePeerId}`);
        this.mqttClient.publish(
          `${this.mqttTopic}/offer`,
          JSON.stringify({
            from: this.peerIdStr,
            to: remotePeerId,
            offer,
          }),
          { qos: 0, retain: false },
        );
      } else {
        console.error(`[MQTT] Cannot send offer: MQTT not connected`);
      }
    } catch (error) {
      console.error(`[RTC] Error initiating connection to peer ${remotePeerId}:`, error);
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
