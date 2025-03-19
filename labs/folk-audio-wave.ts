/**
 * A wrapper class for ggwave audio communication functionality.
 * Provides a simpler interface for sending and receiving data over sound.
 */

import { ggwave_factory } from '@labs/utils/ggwave.js';

// Operating modes for GGWave
interface GGWaveOperatingModes {
  GGWAVE_OPERATING_MODE_RX: 2;
  GGWAVE_OPERATING_MODE_TX: 4;
  GGWAVE_OPERATING_MODE_RX_AND_TX: 6;
  GGWAVE_OPERATING_MODE_TX_ONLY_TONES: 8;
  GGWAVE_OPERATING_MODE_USE_DSS: 16;
}

// Protocol ID structure
interface GGWaveProtocolId {
  values: Record<number, number>;
}

// Parameters returned by getDefaultParameters
interface GGWaveParameters {
  sampleRateInp: number;
  sampleRateOut: number;
  // Add more parameters as we discover them
}

interface GGWave {
  // Constants and modes
  readonly ProtocolId: GGWaveProtocolId;
  readonly GGWAVE_OPERATING_MODE_RX: 2;
  readonly GGWAVE_OPERATING_MODE_TX: 4;
  readonly GGWAVE_OPERATING_MODE_RX_AND_TX: 6;
  readonly GGWAVE_OPERATING_MODE_TX_ONLY_TONES: 8;
  readonly GGWAVE_OPERATING_MODE_USE_DSS: 16;

  // Core functionality
  init(parameters: GGWaveParameters): any;
  encode(instance: any, text: string, protocol: number, volume: number): any;
  decode(instance: any, data: Int8Array): Uint8Array | null;
  getDefaultParameters(): GGWaveParameters;

  // Protocol control
  rxToggleProtocol(instance: any, protocol: number): void;
  txToggleProtocol(instance: any, protocol: number): void;
  rxProtocolSetFreqStart(instance: any, freq: number): void;
  txProtocolSetFreqStart(instance: any, freq: number): void;

  // Memory management
  free(instance: any): void;

  // Logging
  enableLog(): void;
  disableLog(): void;

  // WebAssembly related
  ready: Promise<any>;
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
}

export class FolkAudioWave {
  // Protocol constants
  static readonly GGWAVE_PROTOCOL_AUDIBLE_NORMAL = 0;
  static readonly GGWAVE_PROTOCOL_AUDIBLE_FAST = 1;
  static readonly GGWAVE_PROTOCOL_AUDIBLE_FASTEST = 2;
  static readonly GGWAVE_PROTOCOL_ULTRASOUND_NORMAL = 3;
  static readonly GGWAVE_PROTOCOL_ULTRASOUND_FAST = 4;
  static readonly GGWAVE_PROTOCOL_ULTRASOUND_FASTEST = 5;
  static readonly GGWAVE_PROTOCOL_DT_NORMAL = 6;
  static readonly GGWAVE_PROTOCOL_DT_FAST = 7;
  static readonly GGWAVE_PROTOCOL_DT_FASTEST = 8;

  #context: AudioContext | null = null;
  #ggwave: GGWave | null = null;
  #instance: any = null;
  #mediaStream: MediaStreamAudioSourceNode | null = null;
  #recorder: ScriptProcessorNode | null = null;
  #onDataReceived: ((data: string) => void) | null = null;
  #currentProtocol: any = null;
  // TODO: pull this out and use Audio APIs properly :)
  #visualizer: ((node: AudioNode | null, context: AudioContext) => void) | null = null;

  constructor() {
    this.#initGGWave();
  }

  /**
   * Set a callback to handle audio visualization
   * @param callback Function that receives the audio node and context for visualization
   */
  setVisualizer(callback: (node: AudioNode | null, context: AudioContext) => void): void {
    this.#visualizer = callback;
  }

  async #initGGWave() {
    this.#ggwave = await ggwave_factory();
    console.log({ ggwave: this.#ggwave });
    this.setProtocol(FolkAudioWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST);
  }

  #ensureContext() {
    if (!this.#context) {
      this.#context = new AudioContext({ sampleRate: 48000 });
      if (!this.#ggwave) throw new Error('GGWave not initialized');
      const parameters = this.#ggwave.getDefaultParameters();
      parameters.sampleRateInp = this.#context.sampleRate;
      parameters.sampleRateOut = this.#context.sampleRate;
      this.#instance = this.#ggwave.init(parameters);
    }
  }

  #convertTypedArray(src: any, type: any) {
    const buffer = new ArrayBuffer(src.byteLength);
    new src.constructor(buffer).set(src);
    return new type(buffer);
  }

  /**
   * Set the protocol to use for sending data
   * @param protocol A protocol constant from FolkAudioWave static fields
   * @example
   * wave.setProtocol(FolkAudioWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST)
   */
  setProtocol(protocol: number): void {
    if (!this.#ggwave) throw new Error('GGWave not initialized');
    if (!this.#ggwave.ProtocolId.values[protocol]) throw new Error('Invalid protocol');
    this.#currentProtocol = this.#ggwave.ProtocolId.values[protocol];
  }

  /**
   * Send data over audio
   * @param text The text to send
   * @param volume Volume level from 1-100
   * @returns Promise that resolves when the audio finishes playing
   */
  async send(text: string, volume = 10): Promise<void> {
    this.#ensureContext();
    if (!this.#context) throw new Error('Audio context not initialized');
    if (!this.#ggwave) throw new Error('GGWave not initialized');

    const waveform = this.#ggwave.encode(this.#instance, text, this.#currentProtocol, volume);
    const buf = this.#convertTypedArray(waveform, Float32Array);
    const buffer = this.#context.createBuffer(1, buf.length, this.#context.sampleRate);
    buffer.getChannelData(0).set(buf);

    const source = this.#context.createBufferSource();
    source.buffer = buffer;

    // Create a gain node to connect both to destination and visualizer
    const gainNode = this.#context.createGain();
    source.connect(gainNode);
    gainNode.connect(this.#context.destination);

    // Connect to visualizer if set
    if (this.#visualizer) {
      this.#visualizer(gainNode, this.#context);
    }

    return new Promise((resolve) => {
      source.onended = () => {
        resolve();
        // Disconnect from visualizer when done
        if (this.#visualizer) {
          this.#visualizer(null, this.#context!);
        }
      };
      source.start(0);
    });
  }

  /**
   * Start listening for incoming audio data
   * @param callback Function to call when data is received
   */
  async startListening(callback: (data: string) => void): Promise<void> {
    this.#ensureContext();
    if (!this.#context) throw new Error('Audio context not initialized');
    if (!this.#ggwave) throw new Error('GGWave not initialized');

    this.#onDataReceived = callback;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });

    this.#mediaStream = this.#context.createMediaStreamSource(stream);
    this.#recorder = this.#context.createScriptProcessor(1024, 1, 1);

    // Connect to visualizer if set
    if (this.#visualizer) {
      this.#visualizer(this.#mediaStream, this.#context);
    }

    this.#recorder.onaudioprocess = (e) => {
      if (!this.#ggwave) return;
      const source = e.inputBuffer;
      const res = this.#ggwave.decode(
        this.#instance,
        this.#convertTypedArray(new Float32Array(source.getChannelData(0)), Int8Array),
      );

      if (res && res.length > 0) {
        const text = new TextDecoder('utf-8').decode(res);
        this.#onDataReceived?.(text);
      }
    };

    this.#mediaStream.connect(this.#recorder);
    this.#recorder.connect(this.#context.destination);
  }

  /**
   * Stop listening for incoming audio data
   */
  stopListening(): void {
    if (this.#recorder && this.#context) {
      this.#recorder.disconnect(this.#context.destination);
      if (this.#mediaStream) {
        this.#mediaStream.disconnect(this.#recorder);
      }
      this.#recorder = null;
    }

    // Disconnect from visualizer
    if (this.#visualizer && this.#context) {
      this.#visualizer(null, this.#context);
    }

    this.#onDataReceived = null;
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopListening();
    if (this.#context) {
      this.#context.close();
      this.#context = null;
    }
    this.#instance = null;
    this.#visualizer = null;
  }
}
