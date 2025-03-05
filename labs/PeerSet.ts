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
  private heartbeatInterval = 15000; // 15 seconds
  private cleanupInterval = 60000; // 1 minute
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

    // Start heartbeat and cleanup intervals
    this.heartbeatInterval = window.setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
    this.cleanupInterval = window.setInterval(() => this.detectTimeouts(this.cleanupInterval), this.cleanupInterval);
  }

  /**
   * Connect to the space and start tracking peers
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

    // Send initial heartbeat
    this.sendHeartbeat();
    this.isConnected = true;
  }

  /**
   * Disconnect from the space and stop tracking peers
   */
  disconnect(): void {
    if (!this.isConnected) return;

    console.log(`[PeerSpace] Disconnecting from space: ${this.setId}`);

    // Clear intervals
    clearInterval(this.heartbeatInterval);
    clearInterval(this.cleanupInterval);

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
  private detectTimeouts(timeoutMs: number): void {
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

        if (remotePeerId && timestamp && now - timestamp > timeoutMs) {
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
