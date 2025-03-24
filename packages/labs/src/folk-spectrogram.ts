import { FolkElement } from '@folkjs/lib';
import { css, property } from '@folkjs/lib/reactive-element';

declare global {
  interface HTMLElementTagNameMap {
    'folk-spectrogram': FolkSpectrogram;
  }
}

/**
 * Frequency scaling types for the spectrogram
 */
export type FrequencyScaling = 'linear' | 'log';

/**
 * Color scheme options for the spectrogram
 */
export type ColorScheme = 'dark' | 'light';

/**
 * FolkSpectrogram - A custom element for visualizing audio frequency data
 *
 * This component creates a real-time scrolling spectrogram visualization
 * that can be connected to any Web Audio API source or analyzer node.
 */
export class FolkSpectrogram extends FolkElement {
  static override tagName = 'folk-spectrogram';

  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    canvas {
      width: 100%;
      height: 100%;
      display: block;
      background-color: #000;
      border-radius: 4px;
    }
  `;

  // Configuration properties
  @property({ type: Number, attribute: 'fft-size' }) fftSize = 8192;
  @property({ type: Number, attribute: 'min-decibels' }) minDecibels = -100;
  @property({ type: Number, attribute: 'max-decibels' }) maxDecibels = -10;
  @property({ type: Number, attribute: 'smoothing' }) smoothingTimeConstant = 0.1;
  @property({ attribute: 'scaling' }) scaling: FrequencyScaling = 'log';
  @property({ attribute: 'color-scheme' }) colorScheme: ColorScheme = 'dark';
  @property({ type: Number, attribute: 'min-frequency' }) minFrequency = 40;
  @property({ type: Number, attribute: 'max-frequency' }) maxFrequency = 7000;
  @property({ type: Number, attribute: 'gain' }) gain = 2;

  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D;
  #analyser: AnalyserNode | null = null;
  #animationId: number | null = null;
  #connected: boolean = false;
  #resizeObserver: ResizeObserver;
  #audioSource: AudioNode | null = null;
  #audioContext: AudioContext | null = null;
  #frequencyBinMap: number[] = []; // Maps canvas y-positions to frequency bins

  constructor() {
    super();

    // Create canvas element
    this.#canvas = document.createElement('canvas');

    // Initialize canvas context with a temporary context
    // This will be properly set in createRenderRoot
    const tempContext = this.#canvas.getContext('2d');
    if (!tempContext) {
      throw new Error('Could not get canvas context');
    }
    this.#ctx = tempContext;

    // Add resize observer
    this.#resizeObserver = new ResizeObserver(this.#resizeCanvas);
    this.#resizeObserver.observe(this);
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    // Get canvas context
    const context = this.#canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    this.#ctx = context;

    // Add canvas to shadow DOM
    root.appendChild(this.#canvas);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizeCanvas();
    window.addEventListener('resize', this.#resizeCanvas);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();
    this.disconnect();
    window.removeEventListener('resize', this.#resizeCanvas);
    this.#resizeObserver.disconnect();
  }

  override updated(changedProperties: Map<string, unknown>): void {
    if (
      changedProperties.has('fftSize') ||
      changedProperties.has('minDecibels') ||
      changedProperties.has('maxDecibels') ||
      changedProperties.has('smoothingTimeConstant')
    ) {
      this.#updateAnalyserSettings();
    }

    if (
      changedProperties.has('scaling') ||
      changedProperties.has('minFrequency') ||
      changedProperties.has('maxFrequency') ||
      changedProperties.has('logFactor')
    ) {
      this.#updateFrequencyMapping();
    }
  }

  /**
   * Update the frequency bin mapping based on current settings
   */
  #updateFrequencyMapping = (): void => {
    if (!this.#canvas || !this.#audioContext) return;

    const height = this.#canvas.height;
    const nyquist = this.#audioContext.sampleRate / 2;
    const fftSize = this.#analyser?.frequencyBinCount || 1024;
    const minFreq = Math.max(20, this.minFrequency);
    const maxFreq = Math.min(nyquist, this.maxFrequency);

    // Create a mapping from canvas y-position to frequency bin
    this.#frequencyBinMap = new Array(height);

    for (let y = 0; y < height; y++) {
      // Normalize y position (0 at bottom, 1 at top)
      const normalizedY = 1 - y / height;

      let freq: number;

      if (this.scaling === 'linear') {
        // Linear mapping
        freq = minFreq + normalizedY * (maxFreq - minFreq);
      } else {
        // Logarithmic mapping - using proper logarithmic formula
        // This gives more natural distribution of frequencies
        const logMin = Math.log(minFreq);
        const logMax = Math.log(maxFreq);
        freq = Math.exp(logMin + normalizedY * (logMax - logMin));
      }

      // Convert frequency to bin index with proper scaling
      // This maps the frequency to the correct FFT bin
      const binIndex = Math.round((freq / nyquist) * (fftSize - 1));
      this.#frequencyBinMap[y] = Math.min(Math.max(0, binIndex), fftSize - 1);
    }
  };

  /**
   * Update analyzer settings based on current configuration
   */
  #updateAnalyserSettings = (): void => {
    if (this.#analyser) {
      this.#analyser.fftSize = this.fftSize;
      this.#analyser.minDecibels = this.minDecibels;
      this.#analyser.maxDecibels = this.maxDecibels;
      this.#analyser.smoothingTimeConstant = this.smoothingTimeConstant;
    }
  };

  /**
   * Connect to an audio source
   * @param source - Audio source node
   * @param audioContext - Audio context
   */
  connect(source: AudioNode, audioContext: AudioContext): void {
    // Disconnect any existing connections
    this.disconnect();

    this.#audioSource = source;
    this.#audioContext = audioContext;

    // Create analyzer
    this.#analyser = audioContext.createAnalyser();
    this.#updateAnalyserSettings();

    // Update frequency mapping
    this.#updateFrequencyMapping();

    // Connect source to analyzer
    source.connect(this.#analyser);
    this.#connected = true;
  }

  /**
   * Disconnect from audio source
   */
  disconnect(): void {
    if (this.#audioSource && this.#analyser) {
      try {
        this.#audioSource.disconnect(this.#analyser);
      } catch (e) {
        // Ignore disconnection errors
        console.warn('Error disconnecting audio source:', e);
      }
      this.#audioSource = null;
      this.#audioContext = null;
    }

    this.#connected = false;
    this.stop();
  }

  /**
   * Start visualization
   */
  start(): void {
    if (!this.#connected || !this.#analyser) {
      console.warn('Spectrogram not connected to an audio source');
      return;
    }

    // Stop any existing animation
    this.stop();

    // Clear canvas
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Start animation
    this.#animationId = requestAnimationFrame(this.#draw);
  }

  /**
   * Stop visualization
   */
  stop(): void {
    if (this.#animationId) {
      cancelAnimationFrame(this.#animationId);
      this.#animationId = null;
    }
  }

  /**
   * Apply frequency scaling to the data array
   */
  #applyFrequencyScaling = (dataArray: Uint8Array): number[] => {
    const fftSize = this.#analyser!.frequencyBinCount;
    const height = this.#canvas.height;
    const scaledData: number[] = new Array(height).fill(0);

    // Apply gain to make visualization more visible
    const gainedData = new Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      gainedData[i] = Math.min(255, dataArray[i] * this.gain);
    }

    for (let y = 0; y < height; y++) {
      const bin = this.#frequencyBinMap[y];
      scaledData[y] = gainedData[bin];
    }

    return scaledData;
  };

  /**
   * Get color based on intensity and selected color scheme
   * @param intensity - Value between 0-255
   * @returns CSS color string
   */
  getColor(intensity: number): string {
    // Normalize intensity to 0-1
    const normalizedIntensity = Math.min(1, Math.max(0, intensity / 255));

    switch (this.colorScheme) {
      case 'dark':
        // Magma-like color scheme (black to purple to orange to yellow)
        if (normalizedIntensity < 0.25) {
          // Black to purple
          const r = Math.floor((normalizedIntensity / 0.25) * 80);
          const g = Math.floor((normalizedIntensity / 0.25) * 0);
          const b = Math.floor((normalizedIntensity / 0.25) * 100);
          return `rgb(${r}, ${g}, ${b})`;
        } else if (normalizedIntensity < 0.5) {
          // Purple to magenta
          const r = Math.floor(80 + ((normalizedIntensity - 0.25) / 0.25) * 120);
          const g = Math.floor(0 + ((normalizedIntensity - 0.25) / 0.25) * 30);
          const b = Math.floor(100 + ((normalizedIntensity - 0.25) / 0.25) * 50);
          return `rgb(${r}, ${g}, ${b})`;
        } else if (normalizedIntensity < 0.75) {
          // Magenta to orange
          const r = Math.floor(200 + ((normalizedIntensity - 0.5) / 0.25) * 50);
          const g = Math.floor(30 + ((normalizedIntensity - 0.5) / 0.25) * 130);
          const b = Math.floor(150 - ((normalizedIntensity - 0.5) / 0.25) * 100);
          return `rgb(${r}, ${g}, ${b})`;
        } else {
          // Orange to yellow
          const r = Math.floor(250 + ((normalizedIntensity - 0.75) / 0.25) * 5);
          const g = Math.floor(160 + ((normalizedIntensity - 0.75) / 0.25) * 95);
          const b = Math.floor(50 + ((normalizedIntensity - 0.75) / 0.25) * 20);
          return `rgb(${r}, ${g}, ${b})`;
        }

      case 'light':
        // Light-friendly color scheme (white to blue to purple)
        if (normalizedIntensity < 0.33) {
          // Very light blue to light blue
          const r = Math.floor(240 - (normalizedIntensity / 0.33) * 60);
          const g = Math.floor(250 - (normalizedIntensity / 0.33) * 50);
          const b = Math.floor(255);
          return `rgb(${r}, ${g}, ${b})`;
        } else if (normalizedIntensity < 0.66) {
          // Light blue to medium blue
          const r = Math.floor(180 - ((normalizedIntensity - 0.33) / 0.33) * 120);
          const g = Math.floor(200 - ((normalizedIntensity - 0.33) / 0.33) * 150);
          const b = Math.floor(255 - ((normalizedIntensity - 0.33) / 0.33) * 55);
          return `rgb(${r}, ${g}, ${b})`;
        } else {
          // Medium blue to dark purple
          const r = Math.floor(60 + ((normalizedIntensity - 0.66) / 0.34) * 40);
          const g = Math.floor(50 - ((normalizedIntensity - 0.66) / 0.34) * 50);
          const b = Math.floor(200 - ((normalizedIntensity - 0.66) / 0.34) * 100);
          return `rgb(${r}, ${g}, ${b})`;
        }

      default:
        return `rgb(0, 0, 0)`;
    }
  }

  /**
   * Draw spectrogram frame
   */
  #draw = (): void => {
    if (!this.#analyser || !this.#connected) return;

    // Get frequency data
    const fftSize = this.#analyser.frequencyBinCount;
    const dataArray = new Uint8Array(fftSize);
    this.#analyser.getByteFrequencyData(dataArray);

    // Shift existing spectrogram to the left
    const imageData = this.#ctx.getImageData(1, 0, this.#canvas.width - 1, this.#canvas.height);
    this.#ctx.putImageData(imageData, 0, 0);

    // Clear the right edge where we'll draw new data
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(this.#canvas.width - 1, 0, 1, this.#canvas.height);

    // Apply frequency scaling to the data
    const scaledData = this.#applyFrequencyScaling(dataArray);

    // Draw the new column of frequency data
    for (let y = 0; y < this.#canvas.height; y++) {
      const value = scaledData[y];

      // Get color based on intensity and color scheme
      this.#ctx.fillStyle = this.getColor(value);

      // Draw a pixel at the current position
      this.#ctx.fillRect(this.#canvas.width - 1, y, 1, 1);
    }

    // Continue animation
    this.#animationId = requestAnimationFrame(this.#draw);
  };

  /**
   * Resize canvas to match container dimensions
   */
  #resizeCanvas = (): void => {
    if (!this.#canvas) return;

    const rect = this.getBoundingClientRect();
    this.#canvas.width = rect.width;
    this.#canvas.height = rect.height;

    // Update frequency mapping after resize
    this.#updateFrequencyMapping();

    // Redraw canvas after resize
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
  };
}
