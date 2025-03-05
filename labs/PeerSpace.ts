import Gun, { type IGunInstance } from 'gun';

/**
 * PeerSpace - A minimal peer presence tracking system
 *
 * Maintains a list of peers in a shared space with timestamps.
 * Peers send regular heartbeats to maintain their presence.
 * Stale peers are automatically removed.
 */
export class PeerSpace {
  private gun: IGunInstance;
  private peerId: string;
  private spaceId: string;
  private gunServer: string = 'https://gun-manhattan.herokuapp.com/gun';
  private heartbeatInterval = 60000; // 1 minute
  private cleanupInterval = 180000; // 3 minutes
  private onPeerJoinedCallbacks: ((peerId: string) => void)[] = [];
  private onPeerLeftCallbacks: ((peerId: string) => void)[] = [];
  private peers: Map<string, number> = new Map(); // peerId -> timestamp
  private isConnected = false;

  /**
   * Create a new PeerSpace
   * @param peerId - Unique identifier for this peer
   * @param spaceId - Identifier for the shared space
   */
  constructor(peerId: string, spaceId: string) {
    this.peerId = peerId;
    this.spaceId = spaceId;

    // Initialize Gun with the provided server or default
    this.gun = new Gun([this.gunServer]);

    // Start heartbeat and cleanup intervals
    this.heartbeatInterval = window.setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
    this.cleanupInterval = window.setInterval(() => this.cleanupStalePeers(this.cleanupInterval), this.cleanupInterval);
  }

  /**
   * Connect to the space and start tracking peers
   */
  connect(): void {
    if (this.isConnected) return;

    console.log(`[PeerSpace] Connecting to space: ${this.spaceId} as peer: ${this.peerId}`);

    // Get space data
    const space = this.gun.get('peer-spaces').get(this.spaceId);

    // Set up listener for peers
    space
      .get('peers')
      .map()
      .on((data: any, key: string) => {
        if (!data || key === this.peerId) return;

        const timestamp = data.timestamp;
        const remotePeerId = data.peerId;

        if (remotePeerId && timestamp) {
          const isNewPeer = !this.peers.has(remotePeerId);
          this.peers.set(remotePeerId, timestamp);

          if (isNewPeer) {
            console.log(`[PeerSpace] Peer joined: ${remotePeerId}`);
            this.onPeerJoinedCallbacks.forEach((cb) => cb(remotePeerId));
          }
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

    console.log(`[PeerSpace] Disconnecting from space: ${this.spaceId}`);

    // Clear intervals
    clearInterval(this.heartbeatInterval);
    clearInterval(this.cleanupInterval);

    // Remove our peer entry
    const space = this.gun.get('peer-spaces').get(this.spaceId);
    space.get('peers').get(this.peerId).put(null);

    // Clear local state
    this.peers.clear();
    this.isConnected = false;
  }

  /**
   * Send a heartbeat to maintain our presence in the space
   */
  private sendHeartbeat(): void {
    if (!this.isConnected) return;

    const timestamp = Date.now();
    const space = this.gun.get('peer-spaces').get(this.spaceId);

    space.get('peers').get(this.peerId).put({
      peerId: this.peerId,
      timestamp: timestamp,
    });
  }

  /**
   * Clean up stale peers
   */
  private cleanupStalePeers(timeoutMs: number): void {
    const now = Date.now();

    // Check each peer
    for (const [peerId, timestamp] of this.peers.entries()) {
      if (now - timestamp > timeoutMs) {
        console.log(`[PeerSpace] Peer timed out: ${peerId}`);
        this.peers.delete(peerId);
        this.onPeerLeftCallbacks.forEach((cb) => cb(peerId));
      }
    }
  }

  /**
   * Get all known peers
   */
  getPeers(): string[] {
    return Array.from(this.peers.keys());
  }

  /**
   * Register a callback for when a peer joins
   */
  onPeerJoined(callback: (peerId: string) => void): void {
    this.onPeerJoinedCallbacks.push(callback);
  }

  /**
   * Register a callback for when a peer leaves
   */
  onPeerLeft(callback: (peerId: string) => void): void {
    this.onPeerLeftCallbacks.push(callback);
  }

  /**
   * Generate a shareable URL for this space
   */
  generateShareableUrl(baseUrl: string = window.location.href): string {
    const url = new URL(baseUrl);
    url.searchParams.set('space', this.spaceId);
    return url.toString();
  }
}
