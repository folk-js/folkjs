import Gun, { type IGunInstance } from 'gun';

/**
 * PeerSpace - A minimal peer presence tracking system
 *
 * Maintains a list of peers in a shared space with timestamps.
 * Peers send regular heartbeats to maintain their presence.
 * Stale peers are automatically removed.
 */
export class PeerSet {
  private gun: IGunInstance;
  private peerId: string;
  private setId: string;
  private gunServer: string = 'https://gun-manhattan.herokuapp.com/gun';
  private heartbeatInterval = 10000; // 10 seconds
  private timeoutInterval = 30000; // 30 seconds
  private onPeerHeartbeatCallbacks: ((peerId: string, timestamp: number) => void)[] = [];
  private onPeerTimeoutCallbacks: ((peerId: string) => void)[] = [];
  private isConnected = false;

  /**
   * Create a new PeerSpace
   * @param peerId - Unique identifier for this peer
   * @param setId - Identifier for the shared space
   */
  constructor(peerId: string, setId: string) {
    this.peerId = peerId;
    this.setId = setId;

    // Initialize Gun with the provided server or default
    this.gun = new Gun([this.gunServer]);
  }

  /**
   * Connect to the peer set
   */
  connect(): void {
    if (this.isConnected) return;

    console.log(`[PeerSet] Connecting to set: ${this.setId} as peer: ${this.peerId}`);

    // Get space data
    const set = this.gun.get(`peer-set-${this.setId}`);

    // Set up listener for peers
    set
      .get('peers')
      .map()
      .on((data: any, key: string) => {
        if (!data || key === this.peerId) return;

        const timestamp = data.timestamp;
        const remotePeerId = data.peerId;

        if (remotePeerId && timestamp) {
          this.onPeerHeartbeatCallbacks.forEach((cb) => cb(remotePeerId, timestamp));
        }
      });

    this.isConnected = true;

    // Send an immediate heartbeat to announce our presence
    this.sendHeartbeat();

    // Start sending heartbeats periodically
    setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);

    // Start checking for timeouts periodically
    setInterval(() => this.detectTimeouts(), this.timeoutInterval);
  }

  /**
   * Disconnect from the space and stop tracking peers
   */
  disconnect(): void {
    if (!this.isConnected) return;

    console.log(`[PeerSpace] Disconnecting from space: ${this.setId}`);

    // Clear intervals
    clearInterval(this.heartbeatInterval);
    clearInterval(this.timeoutInterval);

    // Remove our peer entry
    const set = this.gun.get(`peer-set-${this.setId}`);
    set.get('peers').get(this.peerId).put(null);

    // Clear local state
    this.onPeerHeartbeatCallbacks.length = 0;
    this.onPeerTimeoutCallbacks.length = 0;
    this.isConnected = false;
  }

  /**
   * Send a heartbeat to maintain our presence in the space
   */
  private sendHeartbeat(): void {
    if (!this.isConnected) return;

    const timestamp = Date.now();
    const set = this.gun.get(`peer-set-${this.setId}`);

    set.get('peers').get(this.peerId).put({
      peerId: this.peerId,
      timestamp: timestamp,
    });
  }

  /**
   * Detect peer timeouts by checking timestamps in Gun and clean up stale entries
   */
  private detectTimeouts(): void {
    if (!this.isConnected) return;

    const now = Date.now();
    const set = this.gun.get(`peer-set-${this.setId}`);

    set
      .get('peers')
      .map()
      .once((data: any, key: string) => {
        if (!data || key === this.peerId) return;

        const timestamp = data.timestamp;
        const remotePeerId = data.peerId;

        if (remotePeerId && timestamp && now - timestamp > this.timeoutInterval) {
          console.log(`[PeerSet] Peer timeout: ${remotePeerId}, removing from database`);

          // Remove the peer data from Gun
          set.get('peers').get(remotePeerId).put(null);

          // Notify listeners
          this.onPeerTimeoutCallbacks.forEach((cb) => cb(remotePeerId));
        }
      });
  }

  /**
   * Register a callback for peer heartbeats
   */
  onPeerHeartbeat(callback: (peerId: string, timestamp: number) => void): void {
    this.onPeerHeartbeatCallbacks.push(callback);
  }

  /**
   * Register a callback for peer timeouts
   */
  onPeerTimeout(callback: (peerId: string) => void): void {
    this.onPeerTimeoutCallbacks.push(callback);
  }
}
