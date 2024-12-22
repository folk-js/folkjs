import { Point } from '@lib';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

/**
 * A component that creates a canvas-based brush field behind its children.
 * The field affects child elements based on brush strokes that fade over time.
 */
export class FolkBrushField extends FolkBaseSet {
  static override tagName = 'folk-brush-field';

  #canvas!: HTMLCanvasElement;
  #ctx!: CanvasRenderingContext2D;
  #lastFrameTime = 0;
  #isPointerDown = false;
  #lastPointerPosition: Point | null = null;

  // Brush settings
  readonly #FADE_RATE = 0.98; // How quickly the brush strokes fade (per frame)
  readonly #BRUSH_RADIUS = 30;
  readonly #BRUSH_STRENGTH = 1.0;

  connectedCallback() {
    super.connectedCallback();

    // Create and setup canvas
    this.#canvas = document.createElement('canvas');
    this.#canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    `;

    const ctx = this.#canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    this.#ctx = ctx;

    // Initialize canvas with black (no effect)
    this.renderRoot.prepend(this.#canvas);
    this.#handleResize();
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Setup event listeners
    this.addEventListener('pointerdown', this.#handlePointerDown);
    this.addEventListener('pointermove', this.#handlePointerMove);
    this.addEventListener('pointerup', this.#handlePointerUp);
    this.addEventListener('pointerleave', this.#handlePointerUp);

    // Start animation loop
    this.#updateCanvas();

    // Initial resize
    this.#handleResize();
    window.addEventListener('resize', this.#handleResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
  }

  #handleResize = () => {
    const { width, height } = this.getBoundingClientRect();
    this.#canvas.width = width;
    this.#canvas.height = height;
  };

  #handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;

    this.#isPointerDown = true;
    // Convert page coordinates to canvas coordinates
    const rect = this.#canvas.getBoundingClientRect();
    this.#lastPointerPosition = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  #handlePointerMove = (event: PointerEvent) => {
    if (!this.#isPointerDown) return;

    // Convert page coordinates to canvas coordinates
    const rect = this.#canvas.getBoundingClientRect();
    const currentPos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (this.#lastPointerPosition) {
      this.#drawBrushStroke(this.#lastPointerPosition, currentPos);
    }

    this.#lastPointerPosition = currentPos;
  };

  #handlePointerUp = () => {
    this.#isPointerDown = false;
    this.#lastPointerPosition = null;
  };

  #drawBrushStroke(from: Point, to: Point) {
    const ctx = this.#ctx;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = this.#BRUSH_RADIUS * 2;
    ctx.strokeStyle = `rgba(150, 190, 255, ${this.#BRUSH_STRENGTH})`;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  #updateCanvas = (timestamp = 0) => {
    this.#lastFrameTime = timestamp;

    // Create a temporary canvas for the fade operation
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.#canvas.width;
    tempCanvas.height = this.#canvas.height;
    const tempCtx = tempCanvas.getContext('2d')!;

    // Draw existing content
    tempCtx.drawImage(this.#canvas, 0, 0);

    // Clear main canvas
    this.#ctx.fillStyle = 'black';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Apply fade using globalAlpha
    this.#ctx.globalAlpha = this.#FADE_RATE;
    this.#ctx.drawImage(tempCanvas, 0, 0);
    this.#ctx.globalAlpha = 1;

    // Update child elements based on field strength
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        const rect = element.getTransformDOMRect();

        // Sample field strength across a grid
        const SAMPLE_COUNT = 3; // 3x3 grid
        let totalStrength = 0;
        let samples = 0;

        // Sample in a grid pattern across the shape
        for (let i = 0; i < SAMPLE_COUNT; i++) {
          for (let j = 0; j < SAMPLE_COUNT; j++) {
            const samplePoint = {
              x: rect.x + (rect.width * (i + 0.5)) / SAMPLE_COUNT,
              y: rect.y + (rect.height * (j + 0.5)) / SAMPLE_COUNT,
            };

            totalStrength += this.#sampleField(samplePoint);
            samples++;
          }
        }

        // Use average strength to affect the shape
        const avgStrength = totalStrength / samples;
        if (avgStrength > 0) {
          element.x += avgStrength * 5; // Move 5px right at full strength
        }
      }
    });

    requestAnimationFrame(this.#updateCanvas);
  };

  #sampleField(point: Point): number {
    // Ensure we don't sample outside the canvas
    const x = Math.max(0, Math.min(Math.round(point.x), this.#canvas.width - 1));
    const y = Math.max(0, Math.min(Math.round(point.y), this.#canvas.height - 1));

    // Get the field strength at the given point
    const pixel = this.#ctx.getImageData(x, y, 1, 1).data;
    return pixel[0] / 255; // Use red channel as strength (0-1)
  }
}
