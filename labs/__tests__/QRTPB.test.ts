import { beforeEach, describe, expect, test } from 'bun:test';
import { QRTPB } from '../QRTPB';

describe('QRTPB', () => {
  let sender: QRTPB;
  let receiver: QRTPB;

  beforeEach(() => {
    sender = new QRTPB();
    receiver = new QRTPB();
    sender.setMode('send');
    receiver.setMode('receive');
  });

  describe('backchannel messaging', () => {
    test('basic range handling', () => {
      // Set up some data to send
      sender.setData('test data');

      // Process a valid range message
      sender.processBackchannelMessage('R001002'); // Range 1-2
      expect(sender['excludedRanges']).toEqual([[1, 2]]);

      // Process multiple ranges
      sender.processBackchannelMessage('R001002003004'); // Ranges 1-2 and 3-4
      expect(sender['excludedRanges']).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    test('invalid message handling', () => {
      sender.setData('test data');

      // Invalid format
      sender.processBackchannelMessage('invalid');
      expect(sender['excludedRanges']).toEqual([]);

      // Invalid length
      sender.processBackchannelMessage('R001');
      expect(sender['excludedRanges']).toEqual([]);

      // Invalid characters
      sender.processBackchannelMessage('RAAAAAA');
      expect(sender['excludedRanges']).toEqual([]);

      // Invalid range (end < start)
      sender.processBackchannelMessage('R002001');
      expect(sender['excludedRanges']).toEqual([]);
    });

    test('DONE signal handling', () => {
      sender.setData('test data');

      // Process DONE signal
      sender.processBackchannelMessage('D');
      expect(sender['senderDone']).toBe(true);
    });

    test('message generation', () => {
      // Set up receiver with some ranges
      receiver['maxSeenIndex'] = 9;
      receiver['receivedRanges'] = [
        [1, 2],
        [4, 6],
      ];

      // Should get ranges encoded in base36
      expect(receiver.getBackchannelMessage()).toBe('R001002004006');

      // When complete, should send DONE
      receiver['receivedRanges'] = [[0, 9]];
      expect(receiver.getBackchannelMessage()).toBe('D');

      // After receiving DONE from sender, should send nothing
      receiver['receiverDone'] = true;
      expect(receiver.getBackchannelMessage()).toBe(null);
    });

    test('range merging', () => {
      sender.setData('test data');

      // Send overlapping ranges
      sender.processBackchannelMessage('R001003002004');
      expect(sender['excludedRanges']).toEqual([[1, 4]]);

      // Send adjacent ranges
      sender.processBackchannelMessage('R005006007008');
      expect(sender['excludedRanges']).toEqual([
        [1, 4],
        [5, 8],
      ]);

      // Send range that bridges two existing ranges
      sender.processBackchannelMessage('R003007');
      expect(sender['excludedRanges']).toEqual([[1, 8]]);
    });
  });

  describe('QR code data handling', () => {
    test('basic QR data format', () => {
      sender.setData('Hello');
      const qrData = sender.getCurrentQRCodeData();
      expect(qrData).toMatch(/^QRTPB:\d+-\d+\/5:Hello$/);
    });

    test('idle state', () => {
      expect(sender.getCurrentQRCodeData()).toBe('QRTPB:idle');
    });

    test('DONE state', () => {
      sender.setData('test');
      sender['senderDone'] = true;
      expect(sender.getCurrentQRCodeData()).toBe('QRTPB:D');
    });
  });

  describe('mode switching', () => {
    test('mode switching resets state', () => {
      sender.setData('test');
      sender.setMode('receive');
      expect(sender['dataToSend']).toBeNull();
      expect(sender['chunks']).toEqual([]);
    });
  });

  describe('chunk processing', () => {
    test('processes valid chunks', () => {
      receiver.processReceivedQRData('QRTPB:0-4/9:Hello');
      expect(receiver['receivedText']).toBe('Hello');
      expect(receiver['maxSeenIndex']).toBe(8);
      expect(receiver['receivedRanges']).toEqual([[0, 4]]);
    });

    test('handles invalid chunks', () => {
      receiver.processReceivedQRData('invalid');
      expect(receiver['receivedRanges']).toEqual([]);

      receiver.processReceivedQRData('QRTPB:invalid');
      expect(receiver['receivedRanges']).toEqual([]);
    });
  });

  describe('range handling', () => {
    let qrtpb: QRTPB;

    beforeEach(() => {
      qrtpb = new QRTPB();
      qrtpb.setMode('receive');
    });

    test('merge adjacent ranges', () => {
      qrtpb['addRange'](0, 100);
      qrtpb['addRange'](101, 200);
      expect(qrtpb['receivedRanges']).toEqual([[0, 200]]);
    });

    test('merge overlapping ranges', () => {
      qrtpb['addRange'](0, 100);
      qrtpb['addRange'](50, 150);
      expect(qrtpb['receivedRanges']).toEqual([[0, 150]]);
    });

    test('merge multiple ranges', () => {
      qrtpb['addRange'](0, 100);
      qrtpb['addRange'](200, 300);
      qrtpb['addRange'](50, 250);
      expect(qrtpb['receivedRanges']).toEqual([[0, 300]]);
    });

    test('transmission completion check', () => {
      expect(qrtpb['isTransmissionComplete']()).toBe(false);

      qrtpb['maxSeenIndex'] = 299;
      qrtpb['addRange'](0, 299);
      expect(qrtpb['isTransmissionComplete']()).toBe(true);

      // Test with gap
      qrtpb['receivedRanges'] = [
        [0, 100],
        [200, 299],
      ];
      expect(qrtpb['isTransmissionComplete']()).toBe(false);
    });
  });
});
