import Gun, { type IGunInstance } from 'gun';

/**
 * PeerSpace - A minimal peer presence tracking system
 *
 * Maintains a list of peers in a shared space with timestamps.
 * Peers send regular heartbeats to maintain their presence.
 * Stale peers are automatically removed.
 */
export class PeerSet {
  #gun: IGunInstance;
  #peerId: string;
  #setId: string;
  #gunServer: string = 'https://gun-manhattan.herokuapp.com/gun';
  #heartbeatInterval = 10000; // 10 seconds
  #timeoutInterval = 30000; // 30 seconds
  #onPeerHeartbeatCallbacks: ((peerId: string, timestamp: number) => void)[] = [];
  #onPeerTimeoutCallbacks: ((peerId: string) => void)[] = [];
  #isConnected = false;

  /**
   * Create a new PeerSpace
   * @param peerId - Unique identifier for this peer
   * @param setId - Identifier for the shared space
   */
  constructor(peerId: string, setId: string) {
    this.#peerId = peerId;
    this.#setId = setId;

    this.#gun = new Gun([this.#gunServer]);
  }

  /**
   * Connect to the peer set
   */
  connect(): void {
    if (this.#isConnected) return;

    console.log(`[PeerSet] Connecting to set: ${this.#setId} as peer: ${this.#peerId}`);

    // Get space data - directly use the root node
    const set = this.#getPeerSetRef();

    // Set up listener for peers - directly on the root node
    set.map().on((data: any, key: string) => {
      // Skip our own peer or invalid data
      if (!data || key === this.#peerId) return;

      const timestamp = data.timestamp;
      const remotePeerId = data.peerId;

      if (remotePeerId && timestamp && Date.now() - timestamp < this.#timeoutInterval * 2) {
        this.#onPeerHeartbeatCallbacks.forEach((cb) => cb(remotePeerId, timestamp));
      }
    });

    this.#isConnected = true;

    // Send an immediate heartbeat to announce our presence
    this.#sendHeartbeat();

    // Start sending heartbeats periodically
    setInterval(() => this.#sendHeartbeat(), this.#heartbeatInterval);

    // Start checking for timeouts periodically
    setInterval(() => this.#detectTimeouts(), this.#timeoutInterval);
  }

  /**
   * Disconnect from the space and stop tracking peers
   */
  disconnect(): void {
    if (!this.#isConnected) return;

    console.log(`[PeerSpace] Disconnecting from space: ${this.#setId}`);

    // Clear intervals
    clearInterval(this.#heartbeatInterval);
    clearInterval(this.#timeoutInterval);

    // Remove our peer entry directly from the root node
    this.#getPeerSetRef().get(this.#peerId).put(null);

    // Clear local state
    this.#onPeerHeartbeatCallbacks.length = 0;
    this.#onPeerTimeoutCallbacks.length = 0;
    this.#isConnected = false;
  }

  /**
   * Get a reference to the peer set node
   */
  #getPeerSetRef(): any {
    return `peerset-${this.#setId}`;
  }

  /**
   * Send a heartbeat to maintain our presence in the space
   */
  #sendHeartbeat(): void {
    if (!this.#isConnected) return;

    const timestamp = Date.now();
    // Store peer data directly on the root node
    this.#getPeerSetRef().get(this.#peerId).put({
      peerId: this.#peerId,
      timestamp: timestamp,
    });
  }

  /**
   * Detect peer timeouts by checking timestamps in Gun and clean up stale entries
   */
  #detectTimeouts(): void {
    if (!this.#isConnected) return;

    const now = Date.now();
    const set = this.#getPeerSetRef();

    set.map().once((data: any, key: string) => {
      if (!data || key === this.#peerId) return;

      const timestamp = data.timestamp;
      const remotePeerId = data.peerId;

      if (remotePeerId && timestamp && now - timestamp > this.#timeoutInterval) {
        console.log(`[PeerSet] Peer timeout: ${remotePeerId}, removing from database`);

        // Remove the peer data directly from the root node
        set.get(remotePeerId).put(null);

        // Notify listeners
        this.#onPeerTimeoutCallbacks.forEach((cb) => cb(remotePeerId));
      }
    });
  }

  /**
   * Register a callback for peer heartbeats
   */
  onPeerHeartbeat(callback: (peerId: string, timestamp: number) => void): void {
    this.#onPeerHeartbeatCallbacks.push(callback);
  }

  /**
   * Register a callback for peer timeouts
   */
  onPeerTimeout(callback: (peerId: string) => void): void {
    this.#onPeerTimeoutCallbacks.push(callback);
  }
}
