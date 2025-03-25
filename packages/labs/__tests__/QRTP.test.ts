import { expect } from 'expect';
import { beforeEach, describe, test } from 'node:test';
import { QRTP } from '../src/QRTP.ts';

describe('QRTP Protocol', () => {
  let senderQRTP: QRTP;
  let receiverQRTP: QRTP;
  let senderCode: string = '';
  let receiverCode: string = '';

  beforeEach(() => {
    senderQRTP = new QRTP();
    receiverQRTP = new QRTP();

    // Track current QR codes via events
    senderQRTP.on('qrUpdate', ({ data }) => (senderCode = data));
    receiverQRTP.on('qrUpdate', ({ data }) => (receiverCode = data));
  });

  test('should properly segment message', () => {
    const message = 'This is a test message that will be broken into chunks';
    let initData: any;

    senderQRTP.on('init', (data) => {
      initData = data;
    });

    senderQRTP.setMessage(message, 10);
    expect(initData.total).toBe(Math.ceil(message.length / 10));
  });

  test('simulates a complete message transfer with acknowledgments', () => {
    // Setup listeners
    let completeReceived = false;
    let receivedChunks: string[] = [];
    let ackCount = 0;

    receiverQRTP.on('complete', () => {
      completeReceived = true;
    });

    receiverQRTP.on('chunk', (event) => {
      receivedChunks[event.index] = event.payload;
    });

    senderQRTP.on('ack', (event) => {
      ackCount++;
    });

    // Send a message from sender to receiver
    const testMessage = 'Hello, world!';
    senderQRTP.setMessage(testMessage, 5);

    // Step 1: Receiver scans the first QR code from sender
    receiverQRTP.parseCode(senderCode);
    expect(receivedChunks[0]).toBe('Hello');
    expect(completeReceived).toBe(false);

    // Step 2: Sender scans QR code from receiver (which contains ack)
    senderQRTP.parseCode(receiverCode);
    expect(ackCount).toBe(1);

    // Step 3: Receiver scans the second QR code
    receiverQRTP.parseCode(senderCode);
    expect(receivedChunks[1]).toBe(', wor');
    expect(completeReceived).toBe(false);

    // Step 4: Sender scans second ack
    senderQRTP.parseCode(receiverCode);
    expect(ackCount).toBe(2);

    // Step 5: Receiver scans the final chunk
    receiverQRTP.parseCode(senderCode);
    expect(receivedChunks[2]).toBe('ld!');
    expect(completeReceived).toBe(true);

    // Step 6: Sender scans final ack
    senderQRTP.parseCode(receiverCode);
    expect(ackCount).toBe(3);
  });

  test('does not advance when acknowledgment does not match', () => {
    let ackCount = 0;
    senderQRTP.on('ack', () => ackCount++);

    // Setup sender with a message
    senderQRTP.setMessage('Test message', 6);

    // Create an invalid QR code with wrong ack
    const invalidAckCode = `QRTP3:invalid-hash$Test m`;

    // Sender processes the invalid ack
    senderQRTP.parseCode(invalidAckCode);

    // Verify no ack event was emitted
    expect(ackCount).toBe(0);
  });

  test('one-way transfer works when receiver is not sending data', () => {
    let completeReceived = false;
    let receivedChunks: string[] = [];
    let ackCount = 0;

    receiverQRTP.on('complete', () => {
      completeReceived = true;
    });

    receiverQRTP.on('chunk', (event) => {
      receivedChunks[event.index] = event.payload;
    });

    senderQRTP.on('ack', () => ackCount++);

    // Send a message from sender to receiver
    senderQRTP.setMessage('One-way message', 6);

    // Complete the transfer
    receiverQRTP.parseCode(senderCode);
    senderQRTP.parseCode(receiverCode);
    receiverQRTP.parseCode(senderCode);
    senderQRTP.parseCode(receiverCode);
    receiverQRTP.parseCode(senderCode);

    // Verify complete message was received
    expect(completeReceived).toBe(true);
    expect(receivedChunks.join('')).toBe('One-way message');
    expect(ackCount).toBe(2);
  });

  test('resets protocol state correctly', () => {
    let initCount = 0;
    let chunkCount = 0;

    senderQRTP.on('init', () => initCount++);
    receiverQRTP.on('chunk', () => chunkCount++);

    // Setup with some data
    senderQRTP.setMessage('Test data');
    receiverQRTP.parseCode(senderCode);
    expect(chunkCount).toBe(1);

    // Reset both instances
    senderQRTP.setMessage(null);
    receiverQRTP.setMessage(null);

    // Send new message after reset
    senderQRTP.setMessage('New data');
    expect(initCount).toBe(2); // Should get another init event

    receiverQRTP.parseCode(senderCode);
    expect(chunkCount).toBe(2); // Should get new chunks
  });

  test('bidirectional message exchange between two devices', () => {
    const aliceMessage = 'Hello Bob!';
    const bobMessage = 'Hi Alice!';
    const chunkSize = 5;

    // Setup devices
    const alice = new QRTP();
    const bob = new QRTP();
    let aliceCode = '';
    let bobCode = '';

    alice.on('qrUpdate', ({ data }) => (aliceCode = data));
    bob.on('qrUpdate', ({ data }) => (bobCode = data));

    // Track received messages
    let aliceReceivedComplete = false;
    let bobReceivedComplete = false;
    let aliceChunks: string[] = [];
    let bobChunks: string[] = [];

    alice.on('complete', () => {
      aliceReceivedComplete = true;
    });
    bob.on('complete', () => {
      bobReceivedComplete = true;
    });

    alice.on('chunk', (event) => {
      aliceChunks[event.index] = event.payload;
    });
    bob.on('chunk', (event) => {
      bobChunks[event.index] = event.payload;
    });

    // Start the exchange
    alice.setMessage(aliceMessage, chunkSize);
    bob.setMessage(bobMessage, chunkSize);

    // Simulate exchange rounds
    for (let round = 0; round < 10; round++) {
      if (aliceReceivedComplete && bobReceivedComplete) break;

      alice.parseCode(bobCode);
      bob.parseCode(aliceCode);
    }

    // Verify results
    expect(aliceReceivedComplete).toBe(true);
    expect(bobReceivedComplete).toBe(true);
    expect(aliceChunks.join('')).toBe(bobMessage);
    expect(bobChunks.join('')).toBe(aliceMessage);
  });
});
