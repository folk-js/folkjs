import { beforeEach, describe, expect, test } from 'bun:test';
import { QRTP } from '../QRTP';

describe('QRTP Protocol', () => {
  let senderQRTP: QRTP;
  let receiverQRTP: QRTP;

  beforeEach(() => {
    senderQRTP = new QRTP();
    receiverQRTP = new QRTP();
  });

  test('should initialize with empty state', () => {
    expect(senderQRTP.chunks).toEqual([]);
    expect(senderQRTP.sendState).toEqual({ index: 0, total: 0 });
  });

  test('should properly segment message', () => {
    const message = 'This is a test message that will be broken into chunks';
    senderQRTP.setMessage(message, 10);

    expect(senderQRTP.sendState.total).toBe(Math.ceil(message.length / 10));
  });

  test('simulates a complete message transfer with acknowledgments', () => {
    // Setup listener for completed transfer
    let completeData: any = null;
    receiverQRTP.on('complete', (data) => {
      completeData = data;
    });

    // Setup listener for chunk reception
    let chunkCount = 0;
    receiverQRTP.on('chunk', () => {
      chunkCount++;
    });

    // Setup listener for acknowledgments
    let ackData: any[] = [];
    senderQRTP.on('ack', (data) => {
      ackData.push(data);
    });

    // Send a message from sender to receiver
    const testMessage = 'Hello, world!';
    senderQRTP.setMessage(testMessage, 5);

    // Expect 3 chunks: "Hello", ", wor", "ld!"
    expect(senderQRTP.sendState.total).toBe(3);

    // Step 1: Receiver scans the first QR code from sender
    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Verify first chunk was received
    expect(chunkCount).toBe(1);
    expect(receiverQRTP.chunks).toEqual(['Hello']);
    expect(completeData).toBe(null);

    // Step 2: Sender scans QR code from receiver (which contains ack of first chunk)
    senderQRTP.parseCode(receiverQRTP.currentCode());

    // Verify sender received acknowledgment and moved to next chunk
    expect(ackData.length).toBeGreaterThan(0);
    expect(senderQRTP.sendState.index).toBe(1);

    // Step 3: Receiver scans the second QR code from sender
    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Verify second chunk was received
    expect(chunkCount).toBe(2);
    expect(receiverQRTP.chunks).toEqual(['Hello', ', wor']);
    expect(completeData).toBe(null);

    // Step 4: Sender scans QR code from receiver (which contains ack of second chunk)
    senderQRTP.parseCode(receiverQRTP.currentCode());

    // Verify sender received acknowledgment and moved to next chunk
    expect(ackData.length).toBeGreaterThan(1);
    expect(senderQRTP.sendState.index).toBe(2);

    // Step 5: Receiver scans the third QR code from sender
    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Verify third chunk was received and message is complete
    expect(chunkCount).toBe(3);
    expect(receiverQRTP.chunks).toEqual(['Hello', ', wor', 'ld!']);
    expect(completeData).not.toBe(null);
    expect(completeData.data).toBe(testMessage);
    expect(completeData.total).toBe(3);

    // Step 6: Sender scans QR code from receiver (which contains ack of third chunk)
    senderQRTP.parseCode(receiverQRTP.currentCode());

    // Verify sender received acknowledgment and has completed sending
    expect(ackData.length).toBeGreaterThan(2);
    expect(senderQRTP.sendState.index).toBe(3);
    expect(senderQRTP.sendState.index).toBe(senderQRTP.sendState.total);
  });

  test('does not advance when acknowledgment does not match', () => {
    // Setup sender with a message
    senderQRTP.setMessage('Test message', 6);

    // Capture initial state
    const initialIndex = senderQRTP.sendState.index;

    // Create an invalid QR code with wrong ack
    const invalidAckCode = `QRTP3:invalid-hash$Test m`;

    // Sender processes the invalid ack
    senderQRTP.parseCode(invalidAckCode);

    // Verify sender did not advance
    expect(senderQRTP.sendState.index).toBe(initialIndex);
  });

  test('one-way transfer works when receiver is not sending data', () => {
    // Setup listener for completed transfer
    let completeData: any = null;
    receiverQRTP.on('complete', (data) => {
      completeData = data;
    });

    // Send a message from sender to receiver
    senderQRTP.setMessage('One-way message', 6);

    // Receiver scans first QR code
    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Sender scans receiver's ack (receiver not sending any data)
    senderQRTP.parseCode(receiverQRTP.currentCode());

    // Verify sender advanced to next chunk
    expect(senderQRTP.sendState.index).toBe(1);

    // Complete the process for remaining chunks
    receiverQRTP.parseCode(senderQRTP.currentCode());
    senderQRTP.parseCode(receiverQRTP.currentCode());

    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Verify complete message was received
    expect(receiverQRTP.chunks.join('')).toBe('One-way message');
    expect(completeData).not.toBe(null);
  });

  test('resets protocol state correctly', () => {
    // Setup with some data
    senderQRTP.setMessage('Test data');
    receiverQRTP.parseCode(senderQRTP.currentCode());

    // Reset both instances
    senderQRTP.reset();
    receiverQRTP.reset();

    // Verify state was reset
    expect(senderQRTP.sendState).toEqual({ index: 0, total: 0 });
    expect(senderQRTP.chunks).toEqual([]);
    expect(receiverQRTP.chunks).toEqual([]);
  });

  test('bidirectional message exchange between two devices', () => {
    // Test with more realistic messages
    const aliceMessage = 'Hello Bob! This is a longer message from Alice that needs to be sent in multiple chunks.';
    const bobMessage = "Hi Alice, I'm also sending you a response that will be chunked and transferred back.";

    // Use a reasonable chunk size
    const chunkSize = 15;

    // Setup Alice's device
    const alice = new QRTP();
    alice.setMessage(aliceMessage, chunkSize);

    // Setup Bob's device
    const bob = new QRTP();
    bob.setMessage(bobMessage, chunkSize);

    // Track completion
    let aliceReceivedComplete = false;
    let bobReceivedComplete = false;

    alice.on('complete', () => {
      aliceReceivedComplete = true;
    });
    bob.on('complete', () => {
      bobReceivedComplete = true;
    });

    // Simulate multiple rounds of QR code exchange, as would happen with real devices
    const MAX_ROUNDS = 30; // Should be plenty to complete the transfer
    let deadlockDetected = false;

    console.log('\nBidirectional exchange test:');

    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (aliceReceivedComplete && bobReceivedComplete) {
        console.log(`Both transfers completed successfully after ${round} rounds`);
        break;
      }

      // Generate QR codes for both devices
      const aliceCode = alice.currentCode();
      const bobCode = bob.currentCode();

      // Both scan each other's codes
      alice.parseCode(bobCode);
      bob.parseCode(aliceCode);

      // Detect if we're stuck (no progress for several rounds)
      if (round > 15 && alice.sendState.index < alice.sendState.total && bob.sendState.index < bob.sendState.total) {
        deadlockDetected = true;
        console.log('WARNING: Possible protocol deadlock detected!');
        break;
      }

      // Last round - report status
      if (round === MAX_ROUNDS - 1) {
        console.log(`Reached maximum rounds (${MAX_ROUNDS}) without completing transfer`);
      }
    }

    // Check for protocol failure
    expect(deadlockDetected).toBe(false);

    // Verify message transfer was successful in both directions
    expect(alice.chunks.join('')).toBe(bobMessage);
    expect(bob.chunks.join('')).toBe(aliceMessage);

    // Both sides should have received a complete signal
    expect(aliceReceivedComplete).toBe(true);
    expect(bobReceivedComplete).toBe(true);

    // Both sides should have completed sending their messages
    expect(alice.sendState.index).toBe(alice.sendState.total);
    expect(bob.sendState.index).toBe(bob.sendState.total);
  });
});
