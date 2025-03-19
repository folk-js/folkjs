/**
 * A wrapper class for ggwave audio communication functionality.
 * Provides a simpler interface for sending and receiving data over sound.
 */

import { ggwave_factory } from '@labs/utils/ggwave.js';

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
  #ggwave: any = null;
  #instance: any = null;
  #mediaStream: MediaStreamAudioSourceNode | null = null;
  #recorder: ScriptProcessorNode | null = null;
  #onDataReceived: ((data: string) => void) | null = null;
  #currentProtocol = FolkAudioWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST;

  constructor() {
    this.#initGGWave();
  }

  async #initGGWave() {
    this.#ggwave = await ggwave_factory();
  }

  #ensureContext() {
    if (!this.#context) {
      this.#context = new AudioContext({ sampleRate: 48000 });
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
    this.#currentProtocol = protocol;
  }

  /**
   * Get available protocols
   * @returns Object containing all available protocol IDs
   * @deprecated Use static protocol constants instead (e.g. FolkAudioWave.GGWAVE_PROTOCOL_AUDIBLE_FASTEST)
   */
  getProtocols(): any {
    if (!this.#ggwave) throw new Error('GGWave not initialized');
    return this.#ggwave.ProtocolId;
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
    console.log({ protocol: this.#currentProtocol });

    const waveform = this.#ggwave.encode(this.#instance, text, this.#currentProtocol, volume);
    const buf = this.#convertTypedArray(waveform, Float32Array);
    const buffer = this.#context.createBuffer(1, buf.length, this.#context.sampleRate);
    buffer.getChannelData(0).set(buf);

    const source = this.#context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.#context.destination);

    return new Promise((resolve) => {
      source.onended = () => resolve();
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

    this.#recorder.onaudioprocess = (e) => {
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
  }
}
