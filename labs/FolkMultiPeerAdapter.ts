import { Message, NetworkAdapter, PeerId, PeerMetadata, RepoMessage, cbor } from '@automerge/automerge-repo';
import { EventEmitter } from 'eventemitter3';
import { DataConnection, Peer } from 'peerjs';
import { PeerSet } from './PeerSet';

// Type definitions
type IODirection = 'incoming' | 'outgoing';
type NetworkMessage = ArriveMessage | WelcomeMessage | Message;
type NetworkMessageAlert = {
  direction: IODirection;
  message: NetworkMessage;
  bytes: number;
};

interface PeerConnectionInfo {
  conn: DataConnection;
  metadata?: PeerMetadata;
  ready: boolean;
}

/**
 * Notify the network that we have arrived so everyone knows our peer ID
 */
type ArriveMessage = {
  type: 'arrive';
  /** The peer ID of the sender of this message */
  senderId: PeerId;
  /** Arrive messages don't have a targetId */
  targetId?: never;
  /** The peer metadata of the sender of this message */
  peerMetadata: PeerMetadata;
};

/**
 * Respond to an arriving peer with our peer ID
 */
type WelcomeMessage = {
  type: 'welcome';
  /** The peer ID of the recipient sender this message */
  senderId: PeerId;
  /** The peer ID of the recipient of this message */
  targetId: PeerId;
  /** The peer metadata of the sender of this message */
  peerMetadata: PeerMetadata;
};

type EventTypes = { data: NetworkMessageAlert };

/**
 * An Automerge repo network-adapter for WebRTC (P2P) that supports multiple connections
 * and peer discovery via PeerSet.
 */
export class FolkMultiPeerAdapter extends NetworkAdapter {
  peerId?: PeerId;
  peerMetadata?: PeerMetadata;

  #peer: Peer;
  #peerSet: PeerSet;
  #connections: Map<string, PeerConnectionInfo> = new Map();
  #events = new EventEmitter<EventTypes>();
  #connectionListeners: ((peerId: string, connected: boolean) => void)[] = [];
  #ready = false;
  #readyResolver?: () => void;
  #readyPromise: Promise<void> = new Promise<void>((resolve) => (this.#readyResolver = resolve));
  #roomId: string;
  #peerLastSeen: Map<string, number> = new Map();

  /**
   * Create a new FolkMultiPeerAdapter
   * @param options - Configuration options
   */
  constructor(options: { peerId: string; roomId: string; peerMetadata?: PeerMetadata }) {
    super();

    this.peerId = options.peerId as any;
    this.peerMetadata = options.peerMetadata || {};

    this.#roomId = options.roomId;

    console.log(`[FolkMultiPeerAdapter] Initializing with room ID: ${this.#roomId} and peer ID: ${this.peerId}`);

    // Initialize PeerJS
    this.#peer = new Peer(options.peerId);

    // Initialize PeerSet with the same IDs
    this.#peerSet = new PeerSet(options.peerId, this.#roomId);

    // Set up event handlers
    this.#setupPeerEvents();
    this.#setupPeerSetEvents();
  }

  /**
   * Set up PeerJS event handlers
   */
  #setupPeerEvents(): void {
    // Handle when PeerJS is ready
    this.#peer.on('open', (id) => {
      console.log(`[FolkMultiPeerAdapter] PeerJS ready with ID: ${id}`);
      this.#markReady();

      // Connect PeerSet after PeerJS is ready
      this.#peerSet.connect();
    });

    // Handle incoming connections
    this.#peer.on('connection', (conn) => {
      console.log(`[FolkMultiPeerAdapter] Incoming connection from: ${conn.peer}`);
      this.#setupConnection(conn);
    });

    // Handle errors
    this.#peer.on('error', (err) => {
      if (err.message.includes('Could not connect to peer')) {
        console.warn(`[FolkMultiPeerAdapter] ${err.message}`);
      } else {
        console.error(`[FolkMultiPeerAdapter] PeerJS error:`, err);
      }
    });
  }

  /**
   * Set up PeerSet event handlers
   */
  #setupPeerSetEvents(): void {
    // Handle peer heartbeats from the space
    this.#peerSet.onPeerHeartbeat((remotePeerId, timestamp) => {
      console.log(`[FolkMultiPeerAdapter] Peer heartbeat: ${remotePeerId}`);

      const isNewPeer = !this.#peerLastSeen.has(remotePeerId);
      this.#peerLastSeen.set(remotePeerId, timestamp);

      // Connect to the peer if it's new and we don't have a connection
      if (isNewPeer && !this.#connections.has(remotePeerId)) {
        console.log(`[FolkMultiPeerAdapter] New peer detected: ${remotePeerId}`);
        this.#connectToPeer(remotePeerId);
      }
    });

    // Handle peer timeouts from the space
    this.#peerSet.onPeerTimeout((remotePeerId) => {
      console.log(`[FolkMultiPeerAdapter] Peer timeout: ${remotePeerId}`);

      // Remove from our last seen tracking
      this.#peerLastSeen.delete(remotePeerId);

      // Clean up the connection if it exists
      if (this.#connections.has(remotePeerId)) {
        this.#disconnectPeer(remotePeerId);
      }
    });
  }

  /**
   * Connect to a peer and set up the connection
   */
  #connectToPeer(remotePeerId: string): void {
    if (!this.#peer) {
      console.warn(`[FolkMultiPeerAdapter] Cannot connect to peer ${remotePeerId}: PeerJS not ready`);
      return;
    }

    // If we already have a connection to this peer, do nothing
    if (this.#connections.has(remotePeerId)) {
      return;
    }

    console.log(`[FolkMultiPeerAdapter] Connecting to peer: ${remotePeerId}`);

    // Create a new PeerJS connection
    const conn = this.#peer.connect(remotePeerId, { reliable: true });

    // Set up the connection
    this.#setupConnection(conn);
  }

  /**
   * Set up a PeerJS connection
   */
  #setupConnection(conn: DataConnection): void {
    const remotePeerId = conn.peer;

    // Add to connections map (not ready yet)
    this.#connections.set(remotePeerId, {
      conn,
      ready: false,
    });

    // Set up connection events
    conn.on('open', () => {
      console.log(`[FolkMultiPeerAdapter] Connection established with: ${remotePeerId}`);

      // Mark connection as ready
      const connInfo = this.#connections.get(remotePeerId);
      if (connInfo) {
        connInfo.ready = true;
        this.#connections.set(remotePeerId, connInfo);
      }

      // Send arrive message
      this.#transmitToPeer(remotePeerId, {
        type: 'arrive',
        senderId: this.peerId as PeerId,
        peerMetadata: this.peerMetadata || {},
      });

      // Notify listeners of the new connection
      this.#notifyConnectionStatus(remotePeerId, true);
    });

    conn.on('data', (data) => {
      try {
        // Handle raw data
        this.#receiveMessage(remotePeerId, data);
      } catch (error) {
        console.error(`[FolkMultiPeerAdapter] Error processing incoming data:`, error);
      }
    });

    conn.on('close', () => {
      this.#handleDisconnection(remotePeerId);
    });

    conn.on('error', (err) => {
      console.error(`[FolkMultiPeerAdapter] Connection error with ${remotePeerId}:`, err);
      this.#handleDisconnection(remotePeerId);
    });
  }

  /**
   * Process received message with proper decoding
   */
  #receiveMessage(remotePeerId: string, rawData: any): void {
    let msg: NetworkMessage;

    try {
      // Special handling for binary data that might be CBOR encoded
      if (rawData instanceof Uint8Array || rawData instanceof ArrayBuffer || ArrayBuffer.isView(rawData)) {
        // Convert to Uint8Array if needed
        const messageBytes = this.#toUint8Array(rawData);
        // Decode using CBOR - this is crucial for Automerge's binary messages
        msg = cbor.decode(messageBytes) as NetworkMessage;
        console.log(`[FolkMultiPeerAdapter] Decoded CBOR binary message from ${remotePeerId}`, {
          type: msg.type,
          size: messageBytes.byteLength,
        });
      } else {
        // Handle regular JSON messages (protocol messages like 'arrive' and 'welcome')
        msg = rawData as NetworkMessage;
        console.log(`[FolkMultiPeerAdapter] Received JSON message from ${remotePeerId}:`, msg);
      }

      // Handle protocol messages
      if (msg.type === 'arrive') {
        const { peerMetadata } = msg as ArriveMessage;
        const targetId = msg.senderId;

        // Store peer metadata
        const connInfo = this.#connections.get(remotePeerId);
        if (connInfo) {
          connInfo.metadata = peerMetadata;
          this.#connections.set(remotePeerId, connInfo);
        }

        // Send welcome message
        this.#transmitToPeer(remotePeerId, {
          type: 'welcome',
          senderId: this.peerId as PeerId,
          targetId,
          peerMetadata: this.peerMetadata || {},
        });

        // Announce connection to Automerge
        this.emit('peer-candidate', { peerId: targetId, peerMetadata });
        return;
      }

      if (msg.type === 'welcome') {
        const { peerMetadata } = msg as WelcomeMessage;

        // Store peer metadata
        const connInfo = this.#connections.get(remotePeerId);
        if (connInfo) {
          connInfo.metadata = peerMetadata;
          this.#connections.set(remotePeerId, connInfo);
        }

        // Announce connection to Automerge
        this.emit('peer-candidate', { peerId: msg.senderId, peerMetadata });
        return;
      }

      // Handle data messages
      let payload = msg as Message;

      // Ensure binary data is properly handled
      if ('data' in msg && msg.data) {
        // Binary data should already be decoded from CBOR at this point
        // Just ensure it's a Uint8Array
        payload = {
          ...payload,
          data: this.#toUint8Array(msg.data),
        };
      }

      // Log the message before passing to Automerge
      console.log(`[FolkMultiPeerAdapter] Forwarding message to Automerge:`, {
        type: payload.type,
        dataLength: payload.data ? payload.data.byteLength : 0,
        senderId: payload.senderId,
        targetId: payload.targetId,
      });

      // Forward message to Automerge
      this.emit('message', payload);

      // Alert for monitoring
      this.#alert('incoming', msg);
    } catch (error) {
      console.error(`[FolkMultiPeerAdapter] Error processing message:`, error, rawData);
    }
  }

  /**
   * Handle peer disconnection
   */
  #handleDisconnection(remotePeerId: string): void {
    console.log(`[FolkMultiPeerAdapter] Connection closed with: ${remotePeerId}`);

    // Remove from connections map
    this.#connections.delete(remotePeerId);

    // Emit peer disconnected event
    this.emit('peer-disconnected', { peerId: remotePeerId as unknown as PeerId });

    // Notify listeners
    this.#notifyConnectionStatus(remotePeerId, false);
  }

  /**
   * Disconnect from a specific peer
   */
  #disconnectPeer(remotePeerId: string): void {
    const connectionInfo = this.#connections.get(remotePeerId);
    if (connectionInfo) {
      console.log(`[FolkMultiPeerAdapter] Disconnecting from peer: ${remotePeerId}`);
      connectionInfo.conn.close();
      this.#handleDisconnection(remotePeerId);
    }
  }

  /**
   * Mark adapter as ready
   */
  #markReady(): void {
    if (this.#ready) return;
    this.#ready = true;
    this.#readyResolver?.();

    // Emit ready event
    this.emit('ready', { network: this });
  }

  /**
   * Convert input to Uint8Array
   */
  #toUint8Array(input: any): Uint8Array {
    if (input instanceof Uint8Array) {
      return input;
    } else if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    } else if (Array.isArray(input)) {
      return new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
    } else if (
      input &&
      typeof input === 'object' &&
      'type' in input &&
      input.type === 'Buffer' &&
      Array.isArray(input.data)
    ) {
      return new Uint8Array(input.data);
    } else {
      console.warn(`[FolkMultiPeerAdapter] Converting unknown type to Uint8Array:`, typeof input);
      try {
        return new Uint8Array(input);
      } catch (error) {
        console.error(`[FolkMultiPeerAdapter] Failed to convert to Uint8Array:`, error);
        // Return empty array as fallback
        return new Uint8Array();
      }
    }
  }

  /**
   * Send a message to a specific peer
   */
  #transmitToPeer(peerId: string, message: NetworkMessage): void {
    const connectionInfo = this.#connections.get(peerId);
    if (!connectionInfo || !connectionInfo.ready) {
      console.warn(`[FolkMultiPeerAdapter] Cannot send to ${peerId}: Connection not ready`);
      return;
    }

    try {
      // Protocol messages ('arrive', 'welcome') are sent as plain JSON
      if (message.type === 'arrive' || message.type === 'welcome') {
        connectionInfo.conn.send(message);
      }
      // CRDT sync messages with binary data need CBOR encoding
      else if ('data' in message && message.data) {
        // Encode using CBOR
        const encoded = cbor.encode(message);
        console.log(`[FolkMultiPeerAdapter] Sending encoded message to ${peerId}:`, {
          type: message.type,
          encodedSize: encoded.byteLength,
        });
        connectionInfo.conn.send(encoded);
      }
      // Other messages sent as plain JSON
      else {
        connectionInfo.conn.send(message);
      }

      // Alert for monitoring
      this.#alert('outgoing', message);
    } catch (error) {
      console.error(`[FolkMultiPeerAdapter] Error sending message to ${peerId}:`, error);
    }
  }

  /**
   * Send a message to all peers
   */
  #broadcastMessage(message: NetworkMessage): void {
    for (const [peerId, connectionInfo] of this.#connections.entries()) {
      if (connectionInfo.ready) {
        this.#transmitToPeer(peerId, message);
      }
    }
  }

  /**
   * Alert for monitoring
   */
  #alert(direction: IODirection, message: NetworkMessage): void {
    const bytes =
      'data' in message && message.data ? (message.data instanceof Uint8Array ? message.data.byteLength : 0) : 0;

    const payload: NetworkMessageAlert = { direction, message, bytes };
    this.#events.emit('data', payload);
  }

  /**
   * Notify connection status listeners
   */
  #notifyConnectionStatus(peerId: string, connected: boolean): void {
    for (const listener of this.#connectionListeners) {
      listener(peerId, connected);
    }
  }

  /**
   * PUBLIC API METHODS BELOW
   */

  /**
   * Check if the adapter is ready
   */
  isReady(): boolean {
    return this.#ready;
  }

  /**
   * Wait until the adapter is ready
   */
  async whenReady(): Promise<void> {
    return this.#readyPromise;
  }

  /**
   * Connect to a peer (part of NetworkAdapter interface)
   * Note: In this implementation, we use PeerSet for discovery,
   * so this is mainly for compatibility with Automerge
   */
  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerMetadata = peerMetadata || this.peerMetadata;

    // If we already have a connection to this peer, do nothing
    if (this.#connections.has(peerId as string)) {
      return;
    }

    // Otherwise try to connect via PeerJS directly
    this.#connectToPeer(peerId as string);
  }

  /**
   * Disconnect from all peers
   */
  disconnect(): void {
    console.log(`[FolkMultiPeerAdapter] Disconnecting from all peers`);

    // Disconnect PeerSet
    this.#peerSet.disconnect();

    // Close all connections
    for (const [peerId, connectionInfo] of this.#connections.entries()) {
      connectionInfo.conn.close();
      this.emit('peer-disconnected', { peerId: peerId as unknown as PeerId });
    }

    // Clear connections map
    this.#connections.clear();

    // Clear peer timestamps map
    this.#peerLastSeen.clear();

    // Close PeerJS
    this.#peer.destroy();

    // Reset state
    this.#ready = false;
  }

  /**
   * Send a message to a specific peer or broadcast to all peers
   */
  send(message: RepoMessage): void {
    // If message has a target peer ID, send only to that peer
    if (message.targetId) {
      const targetPeerId = message.targetId as string;
      if (this.#connections.has(targetPeerId)) {
        this.#transmitToPeer(targetPeerId, message as any);
      } else {
        console.warn(`[FolkMultiPeerAdapter] Cannot send message to ${targetPeerId}: No connection`);
      }
    } else {
      // Otherwise, broadcast to all connected peers
      this.#broadcastMessage(message as any);
    }
  }

  /**
   * Add a connection status listener
   */
  addConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    this.#connectionListeners.push(listener);
  }

  /**
   * Remove a connection status listener
   */
  removeConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    const index = this.#connectionListeners.indexOf(listener);
    if (index !== -1) {
      this.#connectionListeners.splice(index, 1);
    }
  }

  /**
   * Get all connected peers
   */
  getConnectedPeers(): string[] {
    return Array.from(this.#connections.keys());
  }

  /**
   * Get all known peers (connected or not)
   */
  getKnownPeers(): string[] {
    return Array.from(this.#peerLastSeen.keys());
  }
}
