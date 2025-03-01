/**
 * FolkSpectrogram - A custom element for visualizing audio frequency data
 *
 * This component creates a real-time scrolling spectrogram visualization
 * that can be connected to any Web Audio API source or analyzer node.
 */

export class FolkSpectrogram extends HTMLElement {
  // Properties for observed attributes
  static get observedAttributes(): string[] {
    return ['height', 'fft-size', 'min-decibels', 'max-decibels', 'smoothing'];
  }

  static define(): void {
    if (!customElements.get('folk-spectrogram')) {
      customElements.define('folk-spectrogram', FolkSpectrogram);
    }
  }

  #canvas: HTMLCanvasElement;
  #ctx: CanvasRenderingContext2D;
  #analyser: AnalyserNode | null = null;
  #audioContext: AudioContext | null = null;
  #animationId: number | null = null;
  #connected: boolean = false;
  #resizeObserver: ResizeObserver;
  #audioSource: AudioNode | null = null;

  // Configuration
  private config = {
    fftSize: 2048,
    minDecibels: -90,
    maxDecibels: -10,
    smoothingTimeConstant: 0.3,
  };

  constructor() {
    super();

    // Create shadow DOM
    const shadow = this.attachShadow({ mode: 'open' });

    // Create canvas element
    this.#canvas = document.createElement('canvas');
    this.#canvas.style.width = '100%';
    this.#canvas.style.height = '100%';
    this.#canvas.style.display = 'block';
    this.#canvas.style.backgroundColor = '#000';
    this.#canvas.style.borderRadius = '4px';

    // Add canvas to shadow DOM
    shadow.appendChild(this.#canvas);

    // Get canvas context
    const context = this.#canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get canvas context');
    }
    this.#ctx = context;

    // Bind methods
    this._draw = this._draw.bind(this);
    this._resizeCanvas = this._resizeCanvas.bind(this);

    // Add resize observer
    this.#resizeObserver = new ResizeObserver(this._resizeCanvas);
    this.#resizeObserver.observe(this);
  }

  connectedCallback(): void {
    this._resizeCanvas();
    window.addEventListener('resize', this._resizeCanvas);

    // Apply attributes
    this._applyAttributes();
  }

  disconnectedCallback(): void {
    this.stop();
    this.disconnect();
    window.removeEventListener('resize', this._resizeCanvas);
    this.#resizeObserver.disconnect();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;

    if (name === 'height' && newValue) {
      this.style.height = `${newValue}px`;
      this._resizeCanvas();
    } else if (name === 'fft-size' && newValue) {
      this.config.fftSize = parseInt(newValue, 10);
      this._updateAnalyserSettings();
    } else if (name === 'min-decibels' && newValue) {
      this.config.minDecibels = parseFloat(newValue);
      this._updateAnalyserSettings();
    } else if (name === 'max-decibels' && newValue) {
      this.config.maxDecibels = parseFloat(newValue);
      this._updateAnalyserSettings();
    } else if (name === 'smoothing' && newValue) {
      this.config.smoothingTimeConstant = parseFloat(newValue);
      this._updateAnalyserSettings();
    }
  }

  /**
   * Apply attributes from HTML to component
   */
  private _applyAttributes(): void {
    // Apply height attribute
    const height = this.getAttribute('height');
    if (height) {
      this.style.height = `${height}px`;
      this._resizeCanvas();
    }

    // Apply FFT size
    const fftSize = this.getAttribute('fft-size');
    if (fftSize) {
      this.config.fftSize = parseInt(fftSize, 10);
    }

    // Apply min decibels
    const minDecibels = this.getAttribute('min-decibels');
    if (minDecibels) {
      this.config.minDecibels = parseFloat(minDecibels);
    }

    // Apply max decibels
    const maxDecibels = this.getAttribute('max-decibels');
    if (maxDecibels) {
      this.config.maxDecibels = parseFloat(maxDecibels);
    }

    // Apply smoothing
    const smoothing = this.getAttribute('smoothing');
    if (smoothing) {
      this.config.smoothingTimeConstant = parseFloat(smoothing);
    }
  }

  /**
   * Update analyzer settings based on current configuration
   */
  private _updateAnalyserSettings(): void {
    if (this.#analyser) {
      this.#analyser.fftSize = this.config.fftSize;
      this.#analyser.minDecibels = this.config.minDecibels;
      this.#analyser.maxDecibels = this.config.maxDecibels;
      this.#analyser.smoothingTimeConstant = this.config.smoothingTimeConstant;
    }
  }

  /**
   * Connect to an audio source
   * @param source - Audio source node
   * @param audioContext - Audio context
   */
  connect(source: AudioNode, audioContext: AudioContext): void {
    // Disconnect any existing connections
    this.disconnect();

    this.#audioContext = audioContext;
    this.#audioSource = source;

    // Create analyzer
    this.#analyser = audioContext.createAnalyser();
    this._updateAnalyserSettings();

    // Connect source to analyzer
    source.connect(this.#analyser);
    this.#connected = true;

    // Draw frequency scale
    this._drawFrequencyScale();
  }

  /**
   * Get the analyzer node
   * @returns The analyzer node or null if not connected
   */
  getAnalyser(): AnalyserNode | null {
    return this.#analyser;
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

    // Draw frequency scale
    this._drawFrequencyScale();

    // Start animation
    this.#animationId = requestAnimationFrame(this._draw);
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
   * Show error message on canvas
   * @param message - Error message to display
   */
  showError(message: string): void {
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    this.#ctx.fillStyle = 'white';
    this.#ctx.font = '14px Arial';
    this.#ctx.textAlign = 'center';
    this.#ctx.fillText(message, this.#canvas.width / 2, this.#canvas.height / 2);
  }

  /**
   * Draw frequency scale on the right side
   */
  private _drawFrequencyScale(): void {
    const height = this.#canvas.height;
    const width = this.#canvas.width;

    // Draw scale background
    this.#ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.#ctx.fillRect(width - 40, 0, 40, height);

    this.#ctx.fillStyle = 'white';
    this.#ctx.font = '10px Arial';
    this.#ctx.textAlign = 'right';

    // Draw frequency markers
    const maxFreq = this.#audioContext ? this.#audioContext.sampleRate / 2 : 24000; // Nyquist frequency
    const step = height / 10;

    for (let i = 0; i <= 10; i++) {
      const y = height - i * step;
      const freq = (i / 10) * maxFreq;

      // Format frequency display
      const freqText = freq >= 1000 ? `${(freq / 1000).toFixed(1)} kHz` : `${freq.toFixed(0)} Hz`;

      // Draw tick mark
      this.#ctx.fillRect(width - 35, y, 5, 1);

      // Draw text
      this.#ctx.fillText(freqText, width - 8, y + 3);
    }
  }

  /**
   * Draw spectrogram frame
   */
  private _draw(): void {
    if (!this.#analyser || !this.#connected) return;

    // Get frequency data
    const fftSize = this.#analyser.frequencyBinCount;
    const dataArray = new Uint8Array(fftSize);
    this.#analyser.getByteFrequencyData(dataArray);

    // Shift existing spectrogram to the left
    const imageData = this.#ctx.getImageData(1, 0, this.#canvas.width - 41, this.#canvas.height);
    this.#ctx.putImageData(imageData, 0, 0);

    // Clear the right edge where we'll draw new data
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(this.#canvas.width - 41, 0, 1, this.#canvas.height);

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
      this.#ctx.fillRect(this.#canvas.width - 41, y - lineHeight / 2, 1, lineHeight);
    }

    // Continue animation
    this.#animationId = requestAnimationFrame(this._draw);
  }

  /**
   * Resize canvas to match container dimensions
   */
  private _resizeCanvas(): void {
    if (!this.#canvas) return;

    const rect = this.getBoundingClientRect();
    this.#canvas.width = rect.width;
    this.#canvas.height = rect.height;

    // Redraw canvas after resize
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Draw frequency scale
    if (this.#audioContext) {
      this._drawFrequencyScale();
    }
  }
}
