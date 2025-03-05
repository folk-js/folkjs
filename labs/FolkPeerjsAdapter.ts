import {
  Message,
  NetworkAdapter,
  NetworkAdapterInterface,
  PeerId,
  PeerMetadata,
  RepoMessage,
} from '@automerge/automerge-repo';
import { PeerjsNetworkAdapter } from 'automerge-repo-network-peerjs';
import { DataConnection, Peer } from 'peerjs';
import { PeerSpace } from './PeerSpace';

/**
 * FolkPeerjsAdapter - Network adapter using PeerSpace for discovery and PeerJS for WebRTC connections
 *
 * This adapter:
 * 1. Uses PeerSpace to discover peers
 * 2. Automatically creates and manages PeerJS connections to all discovered peers
 * 3. Presents a single NetworkAdapter interface to Automerge, hiding the complexity of multiple connections
 */
export class FolkPeerjsAdapter extends NetworkAdapter {
  private peer: Peer;
  private peerSpace: PeerSpace;
  private connections: Map<string, PeerjsNetworkAdapter> = new Map();
  private isPeerReady = false;
  private connectionListeners: ((peerId: string, connected: boolean) => void)[] = [];
  private localPeerId: string;
  private roomId: string;
  private isReady = false;

  /**
   * Create a new FolkPeerjsAdapter
   * @param options - Configuration options
   */
  constructor(options: { roomId?: string }) {
    super();

    // Generate a random peer ID if not provided
    this.localPeerId = `peer-${Math.floor(Math.random() * 1_000_000)}`;

    // Use the provided room ID or generate a random one
    this.roomId = options.roomId || this.generateRoomId();

    console.log(`[FolkPeerjsAdapter] Initializing with room ID: ${this.roomId} and peer ID: ${this.localPeerId}`);

    // Initialize PeerJS
    this.peer = new Peer(this.localPeerId);

    // Initialize PeerSpace with the same IDs
    this.peerSpace = new PeerSpace(this.localPeerId, this.roomId);

    // Set up event handlers
    this.setupPeerEvents();
    this.setupPeerSpace();
  }

  /**
   * Set up PeerJS event handlers
   */
  private setupPeerEvents(): void {
    // Handle when PeerJS is ready
    this.peer.on('open', (id) => {
      console.log(`[FolkPeerjsAdapter] PeerJS ready with ID: ${id}`);
      this.isPeerReady = true;
      this.checkReady();
    });

    // Handle incoming connections
    this.peer.on('connection', (conn) => {
      console.log(`[FolkPeerjsAdapter] Incoming connection from: ${conn.peer}`);
      this.setupConnection(conn);
    });

    // Handle errors
    this.peer.on('error', (err) => {
      console.error(`[FolkPeerjsAdapter] PeerJS error:`, err);
    });
  }

  /**
   * Set up PeerSpace event handlers
   */
  private setupPeerSpace(): void {
    // Handle peers joining the space
    this.peerSpace.onPeerJoined((remotePeerId) => {
      console.log(`[FolkPeerjsAdapter] Peer joined: ${remotePeerId}`);

      // Connect to the new peer if we don't have a connection and our ID is "greater"
      // (to avoid both peers initiating connections to each other)
      if (!this.connections.has(remotePeerId) && this.localPeerId > remotePeerId) {
        this.connectToPeer(remotePeerId);
      }
    });

    // Handle peers leaving the space
    this.peerSpace.onPeerLeft((remotePeerId) => {
      console.log(`[FolkPeerjsAdapter] Peer left: ${remotePeerId}`);

      // Clean up the connection
      if (this.connections.has(remotePeerId)) {
        // The adapter will be removed during the disconnect event
        // Just notify listeners
        this.notifyConnectionStatus(remotePeerId, false);
      }
    });
  }

  /**
   * Connect to a peer and set up the connection
   */
  private connectToPeer(remotePeerId: string): void {
    if (!this.isPeerReady) {
      console.warn(`[FolkPeerjsAdapter] Cannot connect to peer ${remotePeerId}: PeerJS not ready`);
      return;
    }

    console.log(`[FolkPeerjsAdapter] Connecting to peer: ${remotePeerId}`);

    // Create a new PeerJS connection
    const conn = this.peer.connect(remotePeerId, { reliable: true });

    // Set up the connection
    this.setupConnection(conn);
  }

  /**
   * Set up a PeerJS connection
   */
  private setupConnection(conn: DataConnection): void {
    const remotePeerId = conn.peer;

    // Set up connection events
    conn.on('open', () => {
      console.log(`[FolkPeerjsAdapter] Connection established with: ${remotePeerId}`);

      // Create a PeerjsNetworkAdapter for this connection
      const adapter = new PeerjsNetworkAdapter(conn);

      // Add the adapter to our connections map
      this.connections.set(remotePeerId, adapter);

      // Set up event forwarding from the adapter
      adapter.on('message', (msg) => {
        // Forward the message to our listeners
        this.emit('message', msg as Message);
      });

      // Notify listeners of the new connection
      this.notifyConnectionStatus(remotePeerId, true);
    });

    conn.on('close', () => {
      console.log(`[FolkPeerjsAdapter] Connection closed: ${remotePeerId}`);

      // Remove the adapter from our connections map
      this.connections.delete(remotePeerId);

      // Notify listeners of the disconnection
      this.notifyConnectionStatus(remotePeerId, false);
    });

    conn.on('error', (err) => {
      console.error(`[FolkPeerjsAdapter] Connection error with ${remotePeerId}:`, err);

      // Remove the adapter from our connections map
      this.connections.delete(remotePeerId);

      // Notify listeners of the disconnection
      this.notifyConnectionStatus(remotePeerId, false);
    });
  }

  /**
   * Check if all components are ready and emit the ready event
   */
  private checkReady(): void {
    if (this.isPeerReady && !this.isReady) {
      this.isReady = true;

      // Connect the PeerSpace to start discovering peers
      this.peerSpace.connect();

      // Notify that we're ready
      this.emit('ready', { network: this });
    }
  }

  /**
   * Generate a random room ID
   */
  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  /**
   * Notify connection status listeners
   */
  private notifyConnectionStatus(peerId: string, connected: boolean): void {
    for (const listener of this.connectionListeners) {
      listener(peerId, connected);
    }
  }

  /**
   * Add a connection status listener
   */
  public addConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    this.connectionListeners.push(listener);
  }

  /**
   * Remove a connection status listener
   */
  public removeConnectionStatusListener(listener: (peerId: string, connected: boolean) => void): void {
    const index = this.connectionListeners.indexOf(listener);
    if (index !== -1) {
      this.connectionListeners.splice(index, 1);
    }
  }

  /**
   * Get all connected peers
   */
  public getConnectedPeers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Generate a shareable URL for this room
   */
  public generateShareableUrl(baseUrl: string = window.location.href): string {
    return this.peerSpace.generateShareableUrl(baseUrl);
  }

  /**
   * Check if the adapter is ready
   */
  public isAdapterReady(): boolean {
    return this.isReady;
  }

  /**
   * Wait until the adapter is ready
   */
  public async whenReady(): Promise<void> {
    if (this.isReady) return Promise.resolve();

    return new Promise((resolve) => {
      const listener = () => {
        resolve();
        this.off('ready', listener);
      };
      this.on('ready', listener);
    });
  }

  /**
   * Send a message to a peer
   */
  public send(message: RepoMessage): void {
    // If message has a target peer ID, send only to that peer
    if (message.targetId) {
      const targetPeerId = message.targetId as string;
      const adapter = this.connections.get(targetPeerId);

      if (adapter) {
        adapter.send(message as any);
      } else {
        console.warn(`[FolkPeerjsAdapter] Cannot send message to ${targetPeerId}: No connection`);
      }
    } else {
      // Otherwise, broadcast to all connected peers
      for (const [peerId, adapter] of this.connections.entries()) {
        adapter.send(message as any);
      }
    }
  }

  /**
   * Connect with a specific peer ID
   */
  public connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    console.log(`[FolkPeerjsAdapter] Connect called with peer ID: ${peerId}`);
    // Nothing more to do here as PeerSpace handles peer discovery
  }

  /**
   * Disconnect from all peers
   */
  public disconnect(): void {
    console.log(`[FolkPeerjsAdapter] Disconnecting`);

    // Disconnect PeerSpace
    this.peerSpace.disconnect();

    // Close all connections
    for (const [peerId, adapter] of this.connections.entries()) {
      // The connection will be removed in the onClose handler
      this.connections.delete(peerId);
    }

    // Close the PeerJS connection
    this.peer.destroy();

    // Reset state
    this.isReady = false;
    this.isPeerReady = false;
  }
}
