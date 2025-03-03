/**
 * SimpleFolkGunDB - A lightweight messaging system using GunDB
 *
 * This class provides a simple interface for message passing using GunDB,
 * with built-in deduplication and minimal overhead.
 */

// Define callback type for message events
export type MessageCallback = (data: any, sender: string) => void;

export class FolkGunDB {
  private gun: any;
  private room: any;
  private clientId: string;
  private seenMessages: Set<string> = new Set();
  private messageListeners: MessageCallback[] = [];
  private relayUrl: string;
  private debug: boolean;

  /**
   * Create a new FolkGunDB instance
   * @param roomId - The room ID to join or create
   * @param clientId - Optional client ID (automatically generated if not provided)
   * @param relayUrl - Optional relay URL (defaults to gun-manhattan.herokuapp.com)
   * @param debug - Enable debug logging
   */
  constructor(
    public readonly roomId: string,
    clientId?: string,
    relayUrl: string = 'https://gun-manhattan.herokuapp.com/gun',
    debug: boolean = false,
  ) {
    this.clientId = clientId || this.generateClientId();
    this.relayUrl = relayUrl;
    this.debug = debug;
    this.log('Created FolkGunDB instance with client ID:', this.clientId);
  }

  /**
   * Initialize the connection to GunDB and join the room
   * @returns Promise that resolves when connected
   */
  public async connect(): Promise<void> {
    return new Promise((resolve) => {
      // Dynamically access Gun (it's a browser library loaded from CDN)
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
        this.room = this.gun.get(`folkcanvas/room/${this.roomId}`);
        this.log('Joined room:', this.roomId);

        // Set up message handler
        this.setupMessageHandler();

        // Resolve when connected
        setTimeout(resolve, 100); // Short delay to allow Gun to initialize
      } else {
        throw new Error('FolkGunDB requires a browser environment');
      }
    });
  }

  /**
   * Get the client ID for this instance
   * @returns The client ID
   */
  public getClientId(): string {
    return this.clientId;
  }

  /**
   * Get a share link for this room
   * @returns A URL that can be shared to join this room
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
   * Send a message to the room
   * @param data - The data to send
   */
  public send(data: any): void {
    if (!this.room) {
      throw new Error('Not connected to a room. Call connect() first.');
    }

    this.log('Sending message:', data);

    // Create a unique message ID
    const messageId = this.generateMessageId();

    // Store the message in the room
    this.room.get('messages').get(messageId).put({
      data: data,
      sender: this.clientId,
      timestamp: Date.now(),
    });
  }

  /**
   * Add a listener for incoming messages
   * @param callback - The callback to call when a message is received
   */
  public onMessage(callback: MessageCallback): void {
    this.messageListeners.push(callback);
    this.log('Added message listener');
  }

  /**
   * Disconnect from the room
   */
  public disconnect(): void {
    if (this.room) {
      this.log('Disconnecting from room:', this.roomId);

      // Clear all listeners
      this.messageListeners = [];
      this.seenMessages.clear();

      // Note: Gun doesn't have a true disconnect method,
      // but we can stop listening to updates
      this.room = null;
    }
  }

  // Private methods

  /**
   * Internal logging function
   * @param args - Arguments to log
   */
  private log(...args: any[]): void {
    if (this.debug) {
      console.log(`[FolkGunDB:${this.clientId.substring(0, 6)}]`, ...args);
    }
  }

  /**
   * Generate a unique client ID
   * @returns A unique client ID
   */
  private generateClientId(): string {
    return 'client_' + Math.random().toString(36).substring(2, 10);
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

        // Skip if not a valid message
        if (!data.sender || !data.timestamp || data.data === undefined) {
          this.log('Skipping invalid message');
          return;
        }

        // Skip our own messages
        if (data.sender === this.clientId) {
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

        // Notify all listeners
        this.messageListeners.forEach((callback) => {
          try {
            callback(data.data, data.sender);
          } catch (err) {
            console.error('Error in message listener:', err);
          }
        });
      });
  }
}
