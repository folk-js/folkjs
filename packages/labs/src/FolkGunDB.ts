export type MessageCallback = (data: any, sender: string) => void;

export class FolkGunDB {
  private gun: any;
  private room: any;
  private messages: any;
  private clientId: string;
  private messageListeners: MessageCallback[] = [];
  private processedMessages: Set<string> = new Set(); // Track processed message IDs
  private relayUrl: string;
  private debug: boolean;
  private readonly roomId: string;

  /**
   * Create a new FolkGunDB instance
   * @param roomId - The room ID to join or create
   * @param clientId - Optional client ID (automatically generated if not provided)
   * @param relayUrl - Optional relay URL (defaults to gun-manhattan.herokuapp.com)
   * @param debug - Enable debug logging
   */
  constructor(
    roomId: string,
    clientId?: string,
    relayUrl: string = 'https://gun-manhattan.herokuapp.com/gun',
    debug: boolean = false,
  ) {
    this.roomId = roomId;
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

        // Get reference to the room and messages
        this.room = this.gun.get(`folkcanvas/room/${this.roomId}`);
        this.messages = this.room.get('messages');
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
    if (!this.messages) {
      throw new Error('Not connected to a room. Call connect() first.');
    }

    this.log('Sending message:', data);

    // Use GunDB's set() to automatically generate a unique ID
    this.messages.set({
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
      this.processedMessages.clear();

      // Note: Gun doesn't have a true disconnect method,
      // but we can stop listening to updates
      this.room = null;
      this.messages = null;
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
   * Set up handler for incoming messages
   */
  private setupMessageHandler(): void {
    // First, get all existing messages as a baseline
    this.messages.map().once((data: any, key: string) => {
      if (data && data.sender && data.timestamp) {
        // Mark existing messages as processed (without firing callbacks)
        this.processedMessages.add(key);
        this.log('Indexed existing message:', key);
      }
    });

    // Then listen for new messages
    this.messages.map().on((data: any, key: string) => {
      // Skip if no data or not a valid message
      if (!data || !data.sender || !data.timestamp || data.data === undefined) {
        return;
      }

      // Skip our own messages
      if (data.sender === this.clientId) {
        return;
      }

      // Skip if we've already processed this message
      if (this.processedMessages.has(key)) {
        return;
      }

      // Mark as processed
      this.processedMessages.add(key);

      this.log('New message received:', key, data);

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
