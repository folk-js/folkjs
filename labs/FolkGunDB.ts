/**
 * FolkGunDB - A lightweight messaging system using GunDB for WebRTC signaling
 *
 * This class provides a simple interface for peer-to-peer messaging using GunDB,
 * with built-in deduplication and support for direct messages and broadcasts.
 */

// Define event types
export type MessageCallback = (data: any, sender: string) => void;
export type PeerCallback = (peerId: string, joined: boolean) => void;

export class FolkGunDB {
  private gun: any;
  private room: any;
  private peerId: string;
  private seenMessages: Set<string> = new Set();
  private directMessageListeners: Map<string, MessageCallback[]> = new Map();
  private broadcastListeners: MessageCallback[] = [];
  private peerListeners: PeerCallback[] = [];
  private relayUrl: string;
  private debug: boolean;

  /**
   * Create a new FolkGunDB instance
   * @param roomId - The room ID to join or create
   * @param relayUrl - Optional relay URL (defaults to gun-manhattan.herokuapp.com)
   * @param debug - Enable debug logging
   */
  constructor(
    public readonly roomId: string,
    relayUrl: string = 'https://gun-manhattan.herokuapp.com/gun',
    debug: boolean = false,
  ) {
    this.peerId = this.generatePeerId();
    this.relayUrl = relayUrl;
    this.debug = debug;
    this.log('Created FolkGunDB instance with peer ID:', this.peerId);
  }

  /**
   * Initialize the connection to GunDB and join the room
   * @returns Promise that resolves when connected
   */
  public async connect(): Promise<void> {
    return new Promise((resolve) => {
      // Dynamically import Gun (it's a browser library)
      if (typeof window !== 'undefined') {
        // @ts-ignore - Gun is loaded from CDN in the HTML
        const Gun = (window as any).Gun;
        if (!Gun) {
          throw new Error('Gun library not found. Make sure to include it in your HTML.');
        }

        this.log('Connecting to GunDB relay:', this.relayUrl);

        // Initialize Gun with the relay
        this.gun = new Gun([this.relayUrl]);

        // Get reference to the room
        this.room = this.gun.get(`folkcanvas/gundb/${this.roomId}`);
        this.log('Joined room:', this.roomId);

        // Add ourselves to the peers list
        const peer = this.room.get('peers').get(this.peerId);
        peer.put({
          joined: Date.now(),
          id: this.peerId,
        });

        // Set up message handler
        this.setupMessageHandler();

        // Set up peer tracking
        this.setupPeerTracking();

        // Resolve when connected
        setTimeout(resolve, 100); // Short delay to allow Gun to initialize
      } else {
        throw new Error('FolkGunDB requires a browser environment');
      }
    });
  }

  /**
   * Get the peer ID for this instance
   * @returns The peer ID
   */
  public getPeerId(): string {
    return this.peerId;
  }

  /**
   * Generate a share link for this room
   * @returns The share link
   */
  public getShareLink(): string {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.hash = `#r=${this.roomId}`;
      return url.toString();
    }
    return `#r=${this.roomId}`;
  }

  /**
   * Send a direct message to a specific peer
   * @param recipientId - The peer ID to send to
   * @param data - The data to send
   */
  public send(recipientId: string, data: any): void {
    if (!this.room) {
      throw new Error('Not connected to a room. Call connect() first.');
    }

    this.log('Sending direct message to', recipientId, ':', data);

    // Create a unique message ID
    const messageId = this.generateMessageId();

    // Store the message directly
    const message = this.room.get('messages').get(messageId);
    message.put({
      content: data,
      sender: this.peerId,
      recipient: recipientId,
      timestamp: Date.now(),
      type: 'direct',
    });
  }

  /**
   * Broadcast a message to all peers in the room
   * @param data - The data to broadcast
   */
  public broadcast(data: any): void {
    if (!this.room) {
      throw new Error('Not connected to a room. Call connect() first.');
    }

    this.log('Broadcasting message:', data);

    // Create a unique message ID
    const messageId = this.generateMessageId();

    // Store the message directly - IMPORTANT: Don't nest objects!
    const message = this.room.get('messages').get(messageId);
    message.put({
      content: data,
      sender: this.peerId,
      timestamp: Date.now(),
      type: 'broadcast',
    });
  }

  /**
   * Add a listener for direct messages
   * @param callback - The callback to call when a message is received
   */
  public onMessage(callback: MessageCallback): void {
    this.directMessageListeners.set('default', [...(this.directMessageListeners.get('default') || []), callback]);
    this.log('Added default direct message listener');
  }

  /**
   * Add a listener for a specific message type
   * @param type - The message type to listen for
   * @param callback - The callback to call when a message is received
   */
  public onMessageType(type: string, callback: MessageCallback): void {
    this.directMessageListeners.set(type, [...(this.directMessageListeners.get(type) || []), callback]);
    this.log('Added direct message listener for type:', type);
  }

  /**
   * Add a listener for broadcast messages
   * @param callback - The callback to call when a broadcast is received
   */
  public onBroadcast(callback: MessageCallback): void {
    this.broadcastListeners.push(callback);
    this.log('Added broadcast listener');
  }

  /**
   * Add a listener for peer join/leave events
   * @param callback - The callback to call when a peer joins or leaves
   */
  public onPeer(callback: PeerCallback): void {
    this.peerListeners.push(callback);
    this.log('Added peer event listener');
  }

  /**
   * Disconnect from the room
   */
  public disconnect(): void {
    if (this.room) {
      this.log('Disconnecting from room:', this.roomId);

      // Update our peer status to left
      const peer = this.room.get('peers').get(this.peerId);
      peer.put({
        left: Date.now(),
        id: this.peerId,
      });

      // Clear all listeners
      this.directMessageListeners.clear();
      this.broadcastListeners = [];
      this.peerListeners = [];
      this.seenMessages.clear();

      // Note: Gun doesn't have a true disconnect method,
      // but we can stop listening to updates
      this.room = null;
    }
  }

  /**
   * Get all active peers in the room
   * @returns Promise that resolves with an array of peer IDs
   */
  public async getPeers(): Promise<string[]> {
    return new Promise((resolve) => {
      const peers: string[] = [];

      if (!this.room) {
        resolve(peers);
        return;
      }

      // Use once to get a snapshot of peers
      this.room
        .get('peers')
        .map()
        .once((data: any, key: string) => {
          if (data && data.id && !data.left) {
            peers.push(data.id);
          }
        });

      // Give it a moment to collect peers
      setTimeout(() => {
        this.log('Found peers:', peers);
        resolve(peers);
      }, 100);
    });
  }

  // Private methods

  /**
   * Internal logging function
   * @param args - Arguments to log
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log(`[FolkGunDB:${this.peerId.substring(0, 6)}]`, ...args);
    }
  }

  /**
   * Generate a unique peer ID
   * @returns A unique peer ID
   */
  private generatePeerId(): string {
    return 'peer_' + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Generate a unique message ID
   * @returns A unique message ID
   */
  private generateMessageId(): string {
    return 'msg_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }

  /**
   * Set up handler for incoming messages
   */
  private setupMessageHandler(): void {
    this.room
      .get('messages')
      .map()
      .on((data: any, key: string) => {
        // Skip if no data
        if (!data) return;

        this.log('Raw message received:', key, data);

        // Skip if not a valid message or no sender info
        if (!data.sender || !data.timestamp) {
          this.log('Skipping invalid message');
          return;
        }

        // Skip our own messages
        if (data.sender === this.peerId) {
          this.log('Skipping own message');
          return;
        }

        // Use the key as the message ID for deduplication
        if (this.seenMessages.has(key)) {
          this.log('Skipping already seen message:', key);
          return;
        }

        // Mark as seen
        this.seenMessages.add(key);

        // Handle message based on type
        if (data.type === 'direct' && data.recipient === this.peerId) {
          // Handle direct message
          this.log('Handling direct message from:', data.sender, 'content:', data.content);
          const messageType = data.type || 'default';
          const listeners = this.directMessageListeners.get(messageType) || [];
          const defaultListeners = this.directMessageListeners.get('default') || [];

          // Call type-specific listeners
          [...listeners, ...defaultListeners].forEach((callback) => {
            try {
              callback(data.content, data.sender);
            } catch (err) {
              console.error('Error in direct message listener:', err);
            }
          });
        } else if (data.type === 'broadcast') {
          // Handle broadcast
          this.log('Handling broadcast message from:', data.sender, 'content:', data.content);
          this.broadcastListeners.forEach((callback) => {
            try {
              callback(data.content, data.sender);
            } catch (err) {
              console.error('Error in broadcast listener:', err);
            }
          });
        }
      });
  }

  /**
   * Set up tracking for peers joining and leaving
   */
  private setupPeerTracking(): void {
    // Keep track of known peers to avoid duplicate notifications
    const knownPeers = new Map<string, boolean>(); // peerId -> isJoined

    this.room
      .get('peers')
      .map()
      .on((data: any, key: string) => {
        // Skip if no data or not a valid peer
        if (!data) return;

        this.log('Peer data received:', key, data);

        // Skip if not a valid peer
        if (!data.id) {
          return;
        }

        // Skip ourselves
        if (data.id === this.peerId) {
          this.log('Skipping own peer event');
          return;
        }

        // Determine if joining or leaving
        const isCurrentlyJoined = Boolean(data.joined && !data.left);
        const wasKnownBefore = knownPeers.has(data.id);
        const stateChanged = !wasKnownBefore || knownPeers.get(data.id) !== isCurrentlyJoined;

        // Update known state
        knownPeers.set(data.id, isCurrentlyJoined);

        // Notify if state changed
        if (stateChanged) {
          this.log('Peer state changed:', data.id, isCurrentlyJoined ? 'joined' : 'left');

          // Notify listeners
          this.peerListeners.forEach((callback) => {
            try {
              callback(data.id, isCurrentlyJoined);
            } catch (err) {
              console.error('Error in peer listener:', err);
            }
          });
        }
      });
  }
}
