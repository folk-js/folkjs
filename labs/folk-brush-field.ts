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
  #isPointerDown = false;
  #lastPointerPosition: Point | null = null;

  // Brush settings
  readonly #FADE_RATE = 0.98; // How quickly the brush strokes fade (per frame)
  readonly #BRUSH_RADIUS = 30;
  readonly #BRUSH_STRENGTH = 1.0;
  readonly #ALIGNMENT_STRENGTH = 0.1; // How strongly shapes align (0-1)
  readonly #TARGET_PADDING = 20; // Desired padding between shapes

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

    const ctx = this.#canvas.getContext('2d', { willReadFrequently: true });
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

  #updateCanvas = () => {
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

    // Find all shapes within influence distance of the brush stroke
    const activeShapes = Array.from(this.sourceElements).filter((element) => {
      if (!(element instanceof FolkShape)) return false;
      const rect = element.getTransformDOMRect();
      const center = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };

      // Check if shape is near any active field area
      const strength = this.#sampleField(center);
      return strength > 0.1;
    }) as FolkShape[];

    // Calculate if arrangement is vertical or horizontal if we have enough shapes
    if (activeShapes.length > 1) {
      // Get centers of all shapes
      const points = activeShapes.map((shape) => {
        const rect = shape.getTransformDOMRect();
        return {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      });

      // Calculate the spread in x and y directions
      const minX = Math.min(...points.map((p) => p.x));
      const maxX = Math.max(...points.map((p) => p.x));
      const minY = Math.min(...points.map((p) => p.y));
      const maxY = Math.max(...points.map((p) => p.y));

      const isMoreHorizontal = maxX - minX > maxY - minY;

      // Align shapes along the dominant axis
      activeShapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        const neighbors = activeShapes.filter((s) => s !== shape);

        let avgX = 0,
          avgY = 0,
          avgWidth = 0,
          avgHeight = 0,
          avgRotation = 0;
        let pushX = 0,
          pushY = 0;

        neighbors.forEach((neighbor) => {
          const nRect = neighbor.getTransformDOMRect();

          // Calculate centers
          const centerX = rect.x + rect.width / 2;
          const centerY = rect.y + rect.height / 2;
          const nCenterX = nRect.x + nRect.width / 2;
          const nCenterY = nRect.y + nRect.height / 2;

          // Calculate minimum required distance between centers
          const minDistX = (rect.width + nRect.width) / 2 + this.#TARGET_PADDING;
          const minDistY = (rect.height + nRect.height) / 2 + this.#TARGET_PADDING;

          // Calculate actual distance
          const deltaX = centerX - nCenterX;
          const deltaY = centerY - nCenterY;

          if (Math.abs(deltaX) < minDistX) {
            pushX += Math.sign(deltaX) * (minDistX - Math.abs(deltaX));
          }
          if (Math.abs(deltaY) < minDistY) {
            pushY += Math.sign(deltaY) * (minDistY - Math.abs(deltaY));
          }

          // For horizontal arrangements, align Y positions exactly
          if (isMoreHorizontal) {
            avgY += nCenterY;
          } else {
            // For vertical arrangements, align X positions exactly
            avgX += nCenterX;
          }

          avgWidth += nRect.width;
          avgHeight += nRect.height;
          avgRotation += nRect.rotation;
        });

        if (neighbors.length > 0) {
          // Only average the non-aligned axis
          if (isMoreHorizontal) {
            avgY /= neighbors.length;
            // Set target Y to be exactly at average Y position
            const targetY = avgY - rect.height / 2;
            shape.y += (targetY - rect.y) * this.#ALIGNMENT_STRENGTH;
            // Allow X movement based on spacing
            shape.x += pushX * this.#ALIGNMENT_STRENGTH;
          } else {
            avgX /= neighbors.length;
            // Set target X to be exactly at average X position
            const targetX = avgX - rect.width / 2;
            shape.x += (targetX - rect.x) * this.#ALIGNMENT_STRENGTH;
            // Allow Y movement based on spacing
            shape.y += pushY * this.#ALIGNMENT_STRENGTH;
          }

          avgWidth /= neighbors.length;
          avgHeight /= neighbors.length;
          avgRotation /= neighbors.length;

          const fieldStrength = this.#sampleField({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          });
          const strength = this.#ALIGNMENT_STRENGTH * fieldStrength;

          // Apply size and rotation changes
          shape.width += (avgWidth - rect.width) * strength;
          shape.height += (avgHeight - rect.height) * strength;
          shape.rotation += (avgRotation - rect.rotation) * strength;
        }
      });
    }

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
