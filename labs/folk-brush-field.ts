import { Point } from '@lib';
import { Gizmos } from '@lib/folk-gizmos';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

interface Alignment {
  axis: 'horizontal' | 'vertical';
  start: Point;
  end: Point;
  shapes: Set<FolkShape>;
  // We'll add confidence values later
}

export class FolkBrushField extends FolkBaseSet {
  static override tagName = 'folk-brush-field';

  #canvas!: HTMLCanvasElement;
  #ctx!: CanvasRenderingContext2D;
  #isPointerDown = false;
  #lastPointerPosition: Point | null = null;

  // Brush settings
  readonly #FADE_RATE = 0.98; // How quickly the brush strokes fade (per frame)
  readonly #BRUSH_RADIUS = 60;
  readonly #BRUSH_STRENGTH = 1.0;
  readonly #ALIGNMENT_STRENGTH = 0.1; // How strongly shapes align (0-1)
  readonly #TARGET_PADDING = 20; // Desired padding between shapes

  #currentStroke: {
    path: Point[]; // Track the actual brush path
    shapes: Set<FolkShape>;
  } | null = null;

  #currentAlignment: Alignment | null = null;

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

    // Initialize canvas with white (full strength)
    this.renderRoot.prepend(this.#canvas);
    this.#handleResize();
    this.#ctx.fillStyle = 'white';
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

    const rect = this.#canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    // Initialize new stroke with just the start point
    this.#currentStroke = {
      path: [point],
      shapes: new Set(),
    };

    // Find shapes under initial point
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        const rect = element.getTransformDOMRect();
        if (
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height
        ) {
          this.#currentStroke?.shapes.add(element);
        }
      }
    });

    this.#lastPointerPosition = point;
    this.#isPointerDown = true;
  };

  #handlePointerMove = (event: PointerEvent) => {
    if (!this.#isPointerDown || !this.#currentStroke) return;

    const rect = this.#canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    // Add point to path
    this.#currentStroke.path.push(point);

    // Check for shapes under the new line segment
    if (this.#lastPointerPosition) {
      this.sourceElements.forEach((element) => {
        if (element instanceof FolkShape) {
          const shapeRect = element.getTransformDOMRect();
          if (this.#isLineIntersectingRect(this.#lastPointerPosition!, point, shapeRect)) {
            this.#currentStroke?.shapes.add(element);
          }
        }
      });

      this.#drawBrushStroke(this.#lastPointerPosition, point);
      this.#visualizeAlignment();
    }

    this.#lastPointerPosition = point;
  };

  #handlePointerUp = () => {
    this.#isPointerDown = false;
    this.#lastPointerPosition = null;
    this.#currentStroke = null;
  };

  #isLineIntersectingRect(lineStart: Point, lineEnd: Point, rect: DOMRect): boolean {
    // Simple AABB check first
    const minX = Math.min(lineStart.x, lineEnd.x);
    const maxX = Math.max(lineStart.x, lineEnd.x);
    const minY = Math.min(lineStart.y, lineEnd.y);
    const maxY = Math.max(lineStart.y, lineEnd.y);

    if (maxX < rect.left || minX > rect.right || maxY < rect.top || minY > rect.bottom) {
      return false;
    }

    // For more precise detection, we could add line-segment intersection tests
    // but for brush strokes, AABB + proximity might be good enough
    return true;
  }

  #createAlignment(shapes: Set<FolkShape>): Alignment | null {
    if (shapes.size < 2) return null;

    // Get bounds of all shapes
    const rects = Array.from(shapes).map((shape) => shape.getTransformDOMRect());
    const centers = rects.map((rect) => ({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    }));

    // Calculate spreads
    const xs = centers.map((p) => p.x);
    const ys = centers.map((p) => p.y);
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);

    const isHorizontal = xSpread > ySpread;
    const avgOther = isHorizontal
      ? ys.reduce((sum, y) => sum + y, 0) / ys.length
      : xs.reduce((sum, x) => sum + x, 0) / xs.length;

    return {
      axis: isHorizontal ? 'horizontal' : 'vertical',
      start: isHorizontal ? { x: Math.min(...xs), y: avgOther } : { x: avgOther, y: Math.min(...ys) },
      end: isHorizontal ? { x: Math.max(...xs), y: avgOther } : { x: avgOther, y: Math.max(...ys) },
      shapes,
    };
  }

  #visualizeAlignment() {
    Gizmos.clear();

    if (this.#currentStroke) {
      // Show affected shapes
      this.#currentStroke.shapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        Gizmos.rect(rect, { color: 'lightblue' });
      });

      // Create and show alignment if we have enough shapes
      const alignment = this.#createAlignment(this.#currentStroke.shapes);
      if (alignment) {
        // Draw the alignment line
        Gizmos.line(alignment.start, alignment.end, { color: 'blue', width: 2 });

        // Draw points at shape projections onto the line
        alignment.shapes.forEach((shape) => {
          const rect = shape.getTransformDOMRect();
          const center = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };

          // Project center onto alignment line
          const projected =
            alignment.axis === 'horizontal'
              ? { x: center.x, y: alignment.start.y }
              : { x: alignment.start.x, y: center.y };

          Gizmos.point(projected, { color: 'blue', size: 4 });
        });
      }
    }
  }

  #drawBrushStroke(from: Point, to: Point) {
    const ctx = this.#ctx;

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = this.#BRUSH_RADIUS;
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
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Apply fade using globalAlpha
    this.#ctx.globalAlpha = this.#FADE_RATE;
    this.#ctx.drawImage(tempCanvas, 0, 0);
    this.#ctx.globalAlpha = 1;

    // Update alignments here later
    if (this.#currentStroke) {
      this.#visualizeAlignment();
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
