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
 * C format for RTCConnectionData
 *
 * Format: type|iceUfrag|icePwd|fingerprint|candidate1|candidate2|...
 *
 * Structure Breakdown:
 * ------------------
 * 1. type: Single character
 *    - 'o' = Offer
 *    - 'a' = Answer
 *
 * 2. iceUfrag: ICE username fragment from SDP
 *    - Extracted directly from "a=ice-ufrag:" line in SDP
 *
 * 3. icePwd: ICE password from SDP
 *    - Extracted directly from "a=ice-pwd:" line in SDP
 *
 * 4. fingerprint: Base64-encoded DTLS fingerprint
 *    - Original format in SDP: Colon-separated hex digits (a=fingerprint:sha-256 XX:XX:XX...)
 *    - Encoding process: Remove colons → Convert hex to binary → Encode as base64
 *    - Decoding process: Decode base64 → Convert to hex → Add colons between every 2 characters
 *
 * 5. candidates: Each ICE candidate encoded as comma-separated values
 *    Format: foundation,protocol,ip,port,type
 *
 *    - foundation: First 4 characters of candidate foundation (uniqueness identifier)
 *
 *    - protocol: Empty string for UDP (default), "t" for TCP
 *      UDP = "" (empty string)
 *      TCP = "t"
 *
 *    - ip: IP address in standard notation (unchanged)
 *
 *    - port: Port number (unchanged)
 *
 *    - type: Single character code for candidate type
 *      host = "h"
 *      srflx (server reflexive) = "s"
 *      relay = "r"
 *
 * Example:
 * o|abc123|xyz789|dGhpc2lzYW5leGFtcGxl|1234,,192.168.1.1,12345,h|5678,,8.8.8.8,45678,s
 */

/**
 * TypeScript interface representing the compact encoded format structure
 */
export interface CompactRTCFormat {
  type: 'o' | 'a'; // 'o' for offer, 'a' for answer
  iceUfrag: string; // ICE username fragment
  icePwd: string; // ICE password
  fingerprint: string; // Base64-encoded fingerprint
  candidates: Array<{
    // Array of compact encoded candidates
    foundation: string; // Truncated foundation (first 4 chars)
    protocol: '' | 't'; // Empty for UDP, 't' for TCP
    ip: string; // IP address
    port: string; // Port number
    type: 'h' | 's' | 'r' | string; // h=host, s=srflx, r=relay
  }>;
}

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

      console.log('createOffer', this.encode(connectionData));

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
    console.log('setAnswer', encodedAnswer);
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
      const encodedAnswer = this.encode(connectionData);
      console.log('createAnswer', encodedAnswer);
      console.log('from offer', encodedOffer);
      return encodedAnswer;
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
    // Step 1: Extract essential information from SDP
    const sdpString = data.sdp.sdp;
    const lines = sdpString.split('\r\n');

    // Step 2: Create an instance of our compact format
    const compactFormat: CompactRTCFormat = {
      // 'o' for offer, 'a' for answer
      type: data.sdp.type === 'offer' ? 'o' : 'a',

      // Extract ICE credentials directly from SDP
      iceUfrag: this.extractValue(lines, 'a=ice-ufrag:'),
      icePwd: this.extractValue(lines, 'a=ice-pwd:'),

      // Process the fingerprint (convert from colon-separated hex to base64)
      fingerprint: this.encodeFingerprint(this.extractValue(lines, 'a=fingerprint:sha-256 ')),

      // Will be populated with selected candidates
      candidates: [],
    };

    // Step 3: Select a diverse set of ICE candidates for better connectivity
    const selectedCandidates = this.selectDiverseCandidates(data.iceCandidates);

    // Step 4: Process the selected candidates into the compact format
    compactFormat.candidates = selectedCandidates
      .map((candidate) => {
        const candidateObj = candidate.toJSON ? candidate.toJSON() : candidate;
        const candidateStr = candidateObj.candidate || '';

        // Parse candidate string to extract components
        // Format: candidate:foundation component protocol priority ip port typ type [...]
        const parts = candidateStr.split(' ');
        if (parts.length < 8) return null;

        // Extract the required components
        const foundation = parts[0].split(':')[1].substring(0, 4); // Truncate to first 4 chars
        const protocol = parts[2].toLowerCase();
        const ip = parts[4];
        const port = parts[5];
        const type = parts[7];

        // Convert to our compact format
        return {
          foundation,
          // '' for UDP (default), 't' for TCP
          protocol: protocol === 'udp' ? '' : ('t' as '' | 't'),
          ip,
          port,
          // Convert to single character codes: h=host, s=srflx, r=relay
          type: this.getTypeCode(type),
        };
      })
      .filter(Boolean) as CompactRTCFormat['candidates'];

    // Step 5: Serialize to string with pipe delimiter
    // type|iceUfrag|icePwd|fingerprint|candidate1|candidate2|...
    const encodedStr = [
      compactFormat.type,
      compactFormat.iceUfrag,
      compactFormat.icePwd,
      compactFormat.fingerprint,
      ...compactFormat.candidates.map((c) => `${c.foundation},${c.protocol},${c.ip},${c.port},${c.type}`),
    ].join('|');

    // Log size information for debugging
    this.logEncodingStats(data, encodedStr, selectedCandidates.length);

    return encodedStr;
  }

  /**
   * Convert standard candidate type to compact code
   * @param type The standard candidate type string
   * @returns The compact single-character code
   */
  private getTypeCode(type: string): 'h' | 's' | 'r' | string {
    switch (type) {
      case 'host':
        return 'h';
      case 'srflx':
        return 's';
      case 'relay':
        return 'r';
      default:
        return type; // Fallback for any other types
    }
  }

  /**
   * Encode fingerprint from colon-separated hex to base64
   * @param rawFingerprint The colon-separated hex fingerprint
   * @returns Base64-encoded fingerprint
   */
  private encodeFingerprint(rawFingerprint: string): string {
    // Step 1: Remove colons
    const cleanFingerprint = rawFingerprint.replace(/:/g, '');

    // Step 2: Convert from hex to bytes
    const fingerprintBytes = new Uint8Array(cleanFingerprint.length / 2);
    for (let i = 0; i < cleanFingerprint.length; i += 2) {
      fingerprintBytes[i / 2] = parseInt(cleanFingerprint.substring(i, i + 2), 16);
    }

    // Step 3: Convert to base64
    return btoa(String.fromCharCode(...fingerprintBytes));
  }

  /**
   * Log encoding statistics for debugging
   */
  private logEncodingStats(data: RTCConnectionData, encodedStr: string, selectedCandidateCount: number): void {
    const originalSize = new TextEncoder().encode(JSON.stringify(data)).length;
    const compressedSize = encodedStr.length;
    const originalCandidateCount = data.iceCandidates.length;

    console.log(`WebRTC ${data.sdp.type} Size:`, {
      original: `${originalSize} bytes`,
      compressed: `${compressedSize} bytes (${Math.round((compressedSize / originalSize) * 100)}%)`,
      candidates: `${selectedCandidateCount} of ${originalCandidateCount} candidates included`,
    });
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
    // Step 1: Split by pipe delimiter and parse into our compact format
    const parts = encoded.split('|');

    const compactFormat: CompactRTCFormat = {
      type: parts[0] as 'o' | 'a',
      iceUfrag: parts[1],
      icePwd: parts[2],
      fingerprint: parts[3],
      candidates: [],
    };

    // Step 2: Parse the candidates (parts[4] and beyond)
    compactFormat.candidates = parts.slice(4).map((candidateStr) => {
      // Parse candidate string: foundation,protocolCode,ip,port,typeCode
      const [foundation, protocolCode, ip, port, typeCode] = candidateStr.split(',');

      return {
        foundation,
        protocol: protocolCode as '' | 't',
        ip,
        port,
        type: typeCode,
      };
    });

    // Step 3: Reconstruct SDP
    const sdp = this.reconstructSDP(compactFormat);

    // Step 4: Reconstruct ICE candidates
    const iceCandidates = this.reconstructICECandidates(compactFormat.candidates);

    return {
      sdp,
      iceCandidates,
    };
  }

  /**
   * Decode the fingerprint from base64 back to colon-separated hex
   * @param fingerprintBase64 The base64-encoded fingerprint
   * @returns The original colon-separated hex format
   */
  private decodeFingerprint(fingerprintBase64: string): string {
    // Step 1: Decode from base64 to binary
    const binaryStr = atob(fingerprintBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Step 2: Convert to hex with colons
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(':');
  }

  /**
   * Reconstruct SDP from compact format
   * @param compactFormat The compact format object
   * @returns The reconstructed RTCSessionDescription
   */
  private reconstructSDP(compactFormat: CompactRTCFormat): RTCSessionDescription {
    // Convert type code back to full type
    const type = compactFormat.type === 'o' ? 'offer' : 'answer';

    // Convert fingerprint from base64 back to hex with colons
    const formattedFingerprint = this.decodeFingerprint(compactFormat.fingerprint);

    // Hardcoded sessionId - this value isn't critical for functionality
    const sessionId = '1';

    // Reconstruct minimal but complete SDP
    const sdpLines = [
      'v=0',
      `o=- ${sessionId} 1 IN IP4 0.0.0.0`,
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      `a=ice-ufrag:${compactFormat.iceUfrag}`,
      `a=ice-pwd:${compactFormat.icePwd}`,
      'a=ice-options:trickle',
      `a=fingerprint:sha-256 ${formattedFingerprint}`,
      `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
    ];

    return {
      type: type as 'offer' | 'answer',
      sdp: sdpLines.join('\r\n') + '\r\n',
    } as RTCSessionDescription;
  }

  /**
   * Reconstruct ICE candidates from compact format
   * @param compactCandidates Array of compact candidates
   * @returns Array of RTCIceCandidate objects
   */
  private reconstructICECandidates(compactCandidates: CompactRTCFormat['candidates']): RTCIceCandidate[] {
    return compactCandidates.map(({ foundation, protocol, ip, port, type }) => {
      // Convert protocol and type codes back to full values
      const fullProtocol = protocol === 't' ? 'tcp' : 'udp';
      const fullType = this.getFullTypeFromCode(type);

      // Calculate priority based on type and protocol
      const priority = this.calculatePriority(fullType, fullProtocol);

      // Construct candidate string - component is always 1 for data channels
      const candidate = `candidate:${foundation} 1 ${fullProtocol} ${priority} ${ip} ${port} typ ${fullType}`;

      return new RTCIceCandidate({
        candidate,
        sdpMid: '0',
        sdpMLineIndex: 0,
      });
    });
  }

  /**
   * Convert compact type code back to full type name
   * @param typeCode The single-character type code
   * @returns The full type name
   */
  private getFullTypeFromCode(typeCode: string): string {
    switch (typeCode) {
      case 'h':
        return 'host';
      case 's':
        return 'srflx';
      case 'r':
        return 'relay';
      default:
        return typeCode; // Fallback for any unknown types
    }
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
