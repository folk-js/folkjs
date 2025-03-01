import { FolkElement } from '@lib';
import { css } from '@lit/reactive-element';
import { property } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'folk-spectrogram': FolkSpectrogram;
  }
}

/**
 * FolkSpectrogram - A custom element for visualizing audio frequency data
 *
 * This component creates a real-time scrolling spectrogram visualization
 * that can be connected to any Web Audio API source or analyzer node.
 */
export class FolkSpectrogram extends FolkElement {
  static tagName = 'folk-spectrogram';

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
  @property({ type: Number, attribute: 'fft-size' }) fftSize = 2048;
  @property({ type: Number, attribute: 'min-decibels' }) minDecibels = -90;
  @property({ type: Number, attribute: 'max-decibels' }) maxDecibels = -10;
  @property({ type: Number, attribute: 'smoothing' }) smoothingTimeConstant = 0.3;

  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D;
  #analyser: AnalyserNode | null = null;
  #animationId: number | null = null;
  #connected: boolean = false;
  #resizeObserver: ResizeObserver;
  #audioSource: AudioNode | null = null;

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
  }

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

    // Create analyzer
    this.#analyser = audioContext.createAnalyser();
    this.#updateAnalyserSettings();

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

    // Draw the new column of frequency data
    for (let i = 0; i < fftSize; i++) {
      // Map the frequency data (0-255) to a color
      const value = dataArray[i];

      // Skip very low values for cleaner visualization
      if (value < 5) continue;

      // Create a vibrant color gradient
      const intensity = value / 255;

      // HSL color model for more vibrant colors
      const hue = 240 - intensity * 240; // Blue to red
      const saturation = 100;
      let lightness = 50;

      // Adjust lightness based on intensity for better contrast
      if (intensity > 0.8) {
        lightness = 60 + (intensity - 0.8) * 40; // Brighter for high intensities
      } else if (intensity < 0.2) {
        lightness = 30 + intensity * 100; // Darker for low intensities
      }

      this.#ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

      // Calculate y position - map frequency bin to canvas height
      const y = this.#canvas.height - Math.round((i / fftSize) * this.#canvas.height);

      // Draw a line instead of a pixel for better visibility
      const lineHeight = Math.max(1, Math.round(this.#canvas.height / fftSize) + 1);
      this.#ctx.fillRect(this.#canvas.width - 1, y - lineHeight / 2, 1, lineHeight);
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

    // Redraw canvas after resize
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
  };
}
