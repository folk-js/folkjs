/**
 * FolkRTC - A minimal WebRTC utility for peer-to-peer connections
 *
 * Simple utility for establishing WebRTC data channel connections
 * without requiring a signaling server.
 */

// Types for the connection process
export interface RTCConnectionData {
  sdp: RTCSessionDescription;
  iceCandidates: RTCIceCandidate[];
}

/**
 * Ultra-compact format for RTCConnectionData
 * Format:
 * type|iceUfrag|icePwd|fingerprint|candidates
 *
 * Where:
 * - type: 'o' or 'a'
 * - fingerprint: with colons removed
 * - candidates: pipe-separated list of comma-separated values
 *   foundation,protocol,ip,port,type
 *   protocol is empty for UDP, "t" for TCP
 *   type is "h" for host, "s" for srflx, "r" for relay
 */

/**
 * Minimal WebRTC connection manager
 */
export class FolkRTC {
  static iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  #peerConnection: RTCPeerConnection | null = null;
  #dataChannel: RTCDataChannel | null = null;
  #iceCandidates: RTCIceCandidate[] = [];
  #role: 'initiator' | 'responder' | null = null;

  // Event handlers
  public onStatusChange: ((status: string) => void) | null = null;
  public onMessage: ((message: string) => void) | null = null;

  /**
   * Create a new FolkRTC instance
   */
  constructor() {
    // Use Google's public STUN server
    this.#initPeerConnection();
  }

  /**
   * Initialize the WebRTC connection
   */
  #initPeerConnection(): void {
    this.#peerConnection = new RTCPeerConnection({
      iceServers: FolkRTC.iceServers,
    });

    this.#iceCandidates = [];

    // Set up ICE candidate handling
    this.#peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.#iceCandidates.push(candidate);
      }
    };

    // Connection state changes
    this.#peerConnection.onconnectionstatechange = () => {
      if (!this.#peerConnection) return;

      const state = this.#peerConnection.connectionState;
      if (this.onStatusChange) {
        this.onStatusChange(state);
      }
    };
  }

  /**
   * Set up the data channel
   */
  #setupDataChannel(channel: RTCDataChannel): void {
    this.#dataChannel = channel;

    channel.onmessage = (event) => {
      if (this.onMessage) {
        this.onMessage(event.data);
      }
    };
  }

  /**
   * Wait for ICE candidates to be gathered (with timeout)
   */
  #waitForIceCandidates(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.#peerConnection || this.#peerConnection.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (!this.#peerConnection) return;
        if (this.#peerConnection.iceGatheringState === 'complete') {
          this.#peerConnection.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.#peerConnection.addEventListener('icegatheringstatechange', checkState);

      // Set a timeout in case gathering takes too long
      setTimeout(resolve, 5000);
    });
  }

  /**
   * Create an offer as the initiator
   * @returns The connection data with SDP and ICE candidates
   */
  public async createOffer(): Promise<string> {
    this.#role = 'initiator';

    try {
      // Create data channel
      this.#dataChannel = this.#peerConnection!.createDataChannel('chat');
      this.#setupDataChannel(this.#dataChannel);

      // Create offer
      const offer = await this.#peerConnection!.createOffer();

      // Set local description
      await this.#peerConnection!.setLocalDescription(offer);

      // Wait for ICE gathering to complete or timeout
      await this.#waitForIceCandidates();

      // Create the complete offer with ICE candidates
      const connectionData = {
        sdp: this.#peerConnection!.localDescription as RTCSessionDescription,
        iceCandidates: this.#iceCandidates,
      };

      // Encode the offer
      return this.encode(connectionData);
    } catch (error) {
      console.error('Error creating offer:', error);
      throw error;
    }
  }

  /**
   * Set the remote answer as the initiator
   * @param encodedAnswer The encoded answer string from the responder
   */
  public async setAnswer(encodedAnswer: string): Promise<void> {
    if (this.#role !== 'initiator') {
      throw new Error('This method should only be called by the initiator');
    }

    try {
      // Decode the answer
      const answerData = this.decode(encodedAnswer);

      // Set the remote description
      await this.#peerConnection!.setRemoteDescription(answerData.sdp);

      // Add ICE candidates from the answer
      for (const candidate of answerData.iceCandidates) {
        await this.#peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error setting remote answer:', error);
      throw error;
    }
  }

  /**
   * Create an answer as the responder
   * @param encodedOffer The encoded offer string from the initiator
   * @returns The encoded answer string
   */
  public async createAnswer(encodedOffer: string): Promise<string> {
    this.#role = 'responder';

    try {
      // Decode the offer
      const offerData = this.decode(encodedOffer);

      // Set up data channel handler (for responder)
      this.#peerConnection!.ondatachannel = (event) => {
        this.#setupDataChannel(event.channel);
      };

      // Set the remote description
      await this.#peerConnection!.setRemoteDescription(offerData.sdp);

      // Add ICE candidates from the offer
      for (const candidate of offerData.iceCandidates) {
        await this.#peerConnection!.addIceCandidate(new RTCIceCandidate(candidate));
      }

      // Create answer
      const answer = await this.#peerConnection!.createAnswer();

      // Set local description
      await this.#peerConnection!.setLocalDescription(answer);

      // Wait for ICE gathering to complete or timeout
      await this.#waitForIceCandidates();

      // Create the complete answer with ICE candidates
      const connectionData = {
        sdp: this.#peerConnection!.localDescription as RTCSessionDescription,
        iceCandidates: this.#iceCandidates,
      };

      // Encode the answer
      return this.encode(connectionData);
    } catch (error) {
      console.error('Error creating answer:', error);
      throw error;
    }
  }

  /**
   * Encode RTCConnectionData to an ultra-compact string format
   * @param data The connection data to encode
   * @returns A compact string representation
   */
  private encode(data: RTCConnectionData): string {
    // Extract essential information from SDP
    const sdpString = data.sdp.sdp;
    const lines = sdpString.split('\r\n');

    // Extract ICE credentials and fingerprint
    const iceUfrag = this.extractValue(lines, 'a=ice-ufrag:');
    const icePwd = this.extractValue(lines, 'a=ice-pwd:');

    // Get fingerprint and convert to base64 for smaller size
    const rawFingerprint = this.extractValue(lines, 'a=fingerprint:sha-256 ');
    // First remove colons, then convert from hex to bytes, then to base64
    const cleanFingerprint = rawFingerprint.replace(/:/g, '');
    const fingerprintBytes = new Uint8Array(cleanFingerprint.length / 2);
    for (let i = 0; i < cleanFingerprint.length; i += 2) {
      fingerprintBytes[i / 2] = parseInt(cleanFingerprint.substring(i, i + 2), 16);
    }
    const fingerprint = btoa(String.fromCharCode(...fingerprintBytes));

    // Select a diverse set of ICE candidates for better connectivity
    const selectedCandidates = this.selectDiverseCandidates(data.iceCandidates);

    // Process the selected candidates into ultra-compact strings
    const candidates = selectedCandidates
      .map((candidate) => {
        const candidateObj = candidate.toJSON ? candidate.toJSON() : candidate;
        const candidateStr = candidateObj.candidate || '';

        // Parse candidate string to extract components
        // Format: candidate:foundation component protocol priority ip port typ type [...]
        const parts = candidateStr.split(' ');
        if (parts.length < 8) return null;

        // Truncate foundation to first 4 characters for size reduction while keeping uniqueness
        const foundation = parts[0].split(':')[1].substring(0, 4);
        const protocol = parts[2].toLowerCase();
        const ip = parts[4];
        const port = parts[5];
        const type = parts[7];

        // Ultra-compact format:
        // - Omit protocol for UDP (default), use "t" for TCP
        // - Use single letters for candidate types: h=host, s=srflx, r=relay
        const protocolCode = protocol === 'udp' ? '' : 't';
        let typeCode;
        switch (type) {
          case 'host':
            typeCode = 'h';
            break;
          case 'srflx':
            typeCode = 's';
            break;
          case 'relay':
            typeCode = 'r';
            break;
          default:
            typeCode = type;
        }

        // Format: foundation,protocolCode,ip,port,typeCode
        return `${foundation},${protocolCode},${ip},${port},${typeCode}`;
      })
      .filter(Boolean);

    // Type code: 'o' for offer, 'a' for answer
    const type = data.sdp.type === 'offer' ? 'o' : 'a';

    // Create ultra-compact format with pipe delimiter
    // type|iceUfrag|icePwd|fingerprint|candidate1|candidate2|...
    const encodedStr = [type, iceUfrag, icePwd, fingerprint, ...candidates].join('|');

    // Log size information
    const originalSize = new TextEncoder().encode(JSON.stringify(data)).length;
    const compressedSize = encodedStr.length;
    const originalCandidateCount = data.iceCandidates.length;
    const selectedCandidateCount = selectedCandidates.length;

    console.log(`WebRTC ${data.sdp.type} Size:`, {
      original: `${originalSize} bytes`,
      compressed: `${compressedSize} bytes (${Math.round((compressedSize / originalSize) * 100)}%)`,
      candidates: `${selectedCandidateCount} of ${originalCandidateCount} candidates included`,
    });

    return encodedStr;
  }

  /**
   * Select a diverse set of ICE candidates to ensure connectivity across different network conditions
   * @param candidates All available ICE candidates
   * @returns A smaller set of diverse candidates
   */
  private selectDiverseCandidates(candidates: RTCIceCandidate[]): RTCIceCandidate[] {
    // Group candidates by type
    const hostCandidates: RTCIceCandidate[] = [];
    const srflxCandidates: RTCIceCandidate[] = [];
    const relayCandidates: RTCIceCandidate[] = [];

    // Categorize candidates
    for (const candidate of candidates) {
      const candidateStr = candidate.candidate;

      // Skip empty candidates
      if (!candidateStr) continue;

      // Categorize by type
      if (candidateStr.includes(' typ host')) {
        hostCandidates.push(candidate);
      } else if (candidateStr.includes(' typ srflx')) {
        srflxCandidates.push(candidate);
      } else if (candidateStr.includes(' typ relay')) {
        relayCandidates.push(candidate);
      }
    }

    // Select exactly 3 candidates (or fewer if not enough are available)
    const selectedCandidates: RTCIceCandidate[] = [];

    // Prefer UDP candidates for better performance
    const getPreferredCandidate = (candidateList: RTCIceCandidate[]): RTCIceCandidate | null => {
      if (candidateList.length === 0) return null;

      // Prefer UDP over TCP
      const udpCandidates = candidateList.filter((c) => c.candidate.includes(' udp '));
      return udpCandidates.length > 0 ? udpCandidates[0] : candidateList[0];
    };

    // 1. Add one host candidate (if available)
    const hostCandidate = getPreferredCandidate(hostCandidates);
    if (hostCandidate) {
      selectedCandidates.push(hostCandidate);
    }

    // 2. Add one server reflexive candidate (if available)
    const srflxCandidate = getPreferredCandidate(srflxCandidates);
    if (srflxCandidate) {
      selectedCandidates.push(srflxCandidate);
    }

    // 3. Add one relay candidate (if available)
    const relayCandidate = getPreferredCandidate(relayCandidates);
    if (relayCandidate) {
      selectedCandidates.push(relayCandidate);
    }

    // If we have fewer than 3 candidates, add more from the available pools
    if (selectedCandidates.length < 3) {
      // Try to add another host candidate
      if (hostCandidates.length > 1) {
        // Find a candidate that's different from the one we already added
        const additionalHost = hostCandidates.find((c) => c !== hostCandidate);
        if (additionalHost && selectedCandidates.length < 3) {
          selectedCandidates.push(additionalHost);
        }
      }

      // Try to add another srflx candidate
      if (selectedCandidates.length < 3 && srflxCandidates.length > 1) {
        const additionalSrflx = srflxCandidates.find((c) => c !== srflxCandidate);
        if (additionalSrflx) {
          selectedCandidates.push(additionalSrflx);
        }
      }
    }

    // If we still have no candidates at all, include at least one of any type
    if (selectedCandidates.length === 0 && candidates.length > 0) {
      selectedCandidates.push(candidates[0]);
    }

    return selectedCandidates;
  }

  /**
   * Helper to extract a value from SDP lines
   */
  private extractValue(sdpLines: string[], prefix: string): string {
    const line = sdpLines.find((line) => line.startsWith(prefix));
    return line ? line.substring(prefix.length) : '';
  }

  /**
   * Decode a string back to RTCConnectionData
   * @param encoded The encoded string to decode
   * @returns The decoded RTCConnectionData
   */
  private decode(encoded: string): RTCConnectionData {
    // Split by pipe delimiter
    const parts = encoded.split('|');

    // Extract header components
    const typeCode = parts[0];
    const iceUfrag = parts[1];
    const icePwd = parts[2];
    const fingerprintBase64 = parts[3];

    // Convert fingerprint from base64 back to hex with colons
    const binaryStr = atob(fingerprintBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    // Convert to hex with colons
    const formattedFingerprint = Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(':');

    // Convert type code back to full type
    const type = typeCode === 'o' ? 'offer' : 'answer';

    // Hardcoded sessionId - this value isn't critical for functionality
    const sessionId = '1';

    // Reconstruct SDP
    const sdpLines = [
      'v=0',
      `o=- ${sessionId} 1 IN IP4 0.0.0.0`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      `a=ice-ufrag:${iceUfrag}`,
      `a=ice-pwd:${icePwd}`,
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${formattedFingerprint}`,
      `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
    ];

    const sdp = {
      type: type as 'offer' | 'answer',
      sdp: sdpLines.join('\r\n') + '\r\n',
    } as RTCSessionDescription;

    // Reconstruct ICE candidates from remaining parts
    const iceCandidates = parts.slice(4).map((candidateStr) => {
      // Parse candidate string: foundation,protocolCode,ip,port,typeCode
      const [foundation, protocolCode, ip, port, typeCode] = candidateStr.split(',');

      // Convert protocol and type codes back to full values
      const protocol = protocolCode === 't' ? 'tcp' : 'udp';

      let type;
      switch (typeCode) {
        case 'h':
          type = 'host';
          break;
        case 's':
          type = 'srflx';
          break;
        case 'r':
          type = 'relay';
          break;
        default:
          type = typeCode;
      }

      // Calculate priority based on type and protocol
      const priority = this.calculatePriority(type, protocol);

      // Construct candidate string - component is always 1 for data channels
      const candidate = `candidate:${foundation} 1 ${protocol} ${priority} ${ip} ${port} typ ${type}`;

      return new RTCIceCandidate({
        candidate,
        sdpMid: '0',
        sdpMLineIndex: 0,
      });
    });

    return {
      sdp,
      iceCandidates,
    };
  }

  /**
   * Calculate ICE candidate priority based on type and protocol
   * @param type Candidate type (host, srflx, relay)
   * @param protocol Transport protocol (udp, tcp)
   * @returns A priority value following WebRTC standards
   */
  private calculatePriority(type: string, protocol: string): number {
    // Type preference (higher is better)
    let typePreference = 0;
    switch (type) {
      case 'host':
        typePreference = 126; // Highest priority
        break;
      case 'srflx':
        typePreference = 100; // Medium priority
        break;
      case 'relay':
        typePreference = 0; // Lowest priority
        break;
      default:
        typePreference = 0;
    }

    // Local preference (higher is better)
    // UDP is preferred over TCP for real-time communication
    const localPreference = protocol.toLowerCase() === 'udp' ? 65535 : 32767;

    // Component ID is always 1 for data channels
    const componentId = 1;

    // Calculate priority using standard formula
    // priority = (2^24) * type_preference + (2^8) * local_preference + (2^0) * (256 - component_id)
    return (typePreference << 24) + (localPreference << 8) + (256 - componentId);
  }

  /**
   * Send a message through the data channel
   */
  public sendMessage(message: string): boolean {
    if (!this.#dataChannel || this.#dataChannel.readyState !== 'open') {
      return false;
    }

    try {
      this.#dataChannel.send(message);
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Close the connection
   */
  public close(): void {
    if (this.#dataChannel) {
      this.#dataChannel.close();
      this.#dataChannel = null;
    }

    if (this.#peerConnection) {
      this.#peerConnection.close();
      this.#peerConnection = null;
    }

    this.#role = null;
    this.#iceCandidates = [];
  }

  /**
   * Check if the connection is active
   */
  public isConnected(): boolean {
    return !!this.#dataChannel && this.#dataChannel.readyState === 'open';
  }
}
