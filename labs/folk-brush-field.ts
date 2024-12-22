import { Gizmos, Point, Vector } from '@lib';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

interface Alignment {
  axis: 'horizontal' | 'vertical';
  start: Point;
  end: Point;
  shapes: Set<FolkShape>;
  orderedShapes: FolkShape[]; // Shapes ordered along the line
  targetPositions: Map<FolkShape, Point>; // Where each shape should go
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

  #alignments: Alignment[] = [];

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
    if (this.#currentStroke && this.#currentStroke.shapes.size >= 2) {
      const alignment = this.#createAlignment(this.#currentStroke.shapes);
      if (alignment) {
        // Find alignments that would be completely contained in our new selection
        const containedAlignments = this.#findContainedAlignments(this.#currentStroke.shapes);

        if (containedAlignments.length > 0) {
          // Remove all contained alignments
          this.#alignments = this.#alignments.filter((a) => !containedAlignments.includes(a));
        }

        // Find remaining alignments we could merge with on the same axis
        const existingAlignments = this.#findExistingAlignments(this.#currentStroke.shapes, alignment.axis);

        if (existingAlignments.length > 0) {
          // Merge with remaining alignments
          this.#mergeAlignments(existingAlignments, this.#currentStroke.shapes);
        } else {
          // Check if we can add as new alignment
          const canAdd = Array.from(alignment.shapes).every((shape) => this.#canAddToAlignment(shape, alignment.axis));

          if (canAdd) {
            this.#alignments.push(alignment);
          }
        }
      }
    }

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

  #calculateAlignmentProperties(shapes: Set<FolkShape>, axis: 'horizontal' | 'vertical') {
    const isHorizontal = axis === 'horizontal';
    const direction = isHorizontal ? Vector.right() : Vector.down();

    // Get bounds and centers
    const rects = Array.from(shapes).map((shape) => shape.getTransformDOMRect());

    // Find fixed shapes (those with alignments on other axis)
    const fixedPoints = Array.from(shapes)
      .map((shape) => {
        const rect = shape.getTransformDOMRect();
        const existing = this.#getShapeAlignments(shape);
        const isFixed = existing[isHorizontal ? 'vertical' : 'horizontal'];

        return isFixed
          ? {
              shape,
              point: {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
              },
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Order shapes along the primary axis
    const orderedShapes = Array.from(shapes).sort((a, b) => {
      const rectA = a.getTransformDOMRect();
      const rectB = b.getTransformDOMRect();
      const centerA = isHorizontal ? rectA.x + rectA.width / 2 : rectA.y + rectA.height / 2;
      const centerB = isHorizontal ? rectB.x + rectB.width / 2 : rectB.y + rectB.height / 2;
      return centerA - centerB;
    });

    // Calculate total size needed
    const totalShapeSize = orderedShapes.reduce((sum, shape) => {
      const rect = shape.getTransformDOMRect();
      return sum + (isHorizontal ? rect.width : rect.height);
    }, 0);
    const totalPadding = (orderedShapes.length - 1) * this.#TARGET_PADDING;
    const requiredLength = totalShapeSize + totalPadding;

    // Determine line position based on fixed points
    let lineCenter: Point;
    if (fixedPoints.length > 0) {
      // Use average position of fixed points for the relevant axis
      const fixedCoord =
        fixedPoints.reduce((sum, { point }) => sum + (isHorizontal ? point.y : point.x), 0) / fixedPoints.length;

      // Get the center point along the other axis
      const bounds = Vector.bounds(
        rects.map((rect) => ({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        })),
      );

      lineCenter = isHorizontal
        ? {
            x: (bounds.min.x + bounds.max.x) / 2,
            y: fixedCoord,
          }
        : {
            x: fixedCoord,
            y: (bounds.min.y + bounds.max.y) / 2,
          };
    } else {
      // No fixed points, use bounds center
      const rectPoints = rects.flatMap((rect) => [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.bottom },
      ]);
      lineCenter = Vector.center(rectPoints);
    }

    // Calculate line endpoints
    const halfLength = requiredLength / 2;
    const start = Vector.add(lineCenter, Vector.scale(direction, -halfLength));
    const end = Vector.add(lineCenter, Vector.scale(direction, halfLength));

    // Calculate target positions
    const targetPositions = new Map<FolkShape, Point>();
    let currentPos = -halfLength;

    orderedShapes.forEach((shape) => {
      const rect = shape.getTransformDOMRect();
      const size = isHorizontal ? rect.width : rect.height;
      const center = currentPos + size / 2;

      const fixedPoint = fixedPoints.find((fp) => fp.shape === shape);
      if (fixedPoint) {
        // Keep fixed shapes at their current position
        targetPositions.set(shape, fixedPoint.point);
      } else {
        const offset = Vector.scale(direction, center);
        const target = Vector.add(lineCenter, offset);
        targetPositions.set(shape, target);
      }

      currentPos += size + this.#TARGET_PADDING;
    });

    return {
      axis,
      start,
      end,
      shapes,
      orderedShapes,
      targetPositions,
    };
  }

  #createAlignment(shapes: Set<FolkShape>): Alignment | null {
    if (shapes.size < 2) return null;

    // Calculate spreads to determine axis
    const centers = Array.from(shapes).map((shape) => {
      const rect = shape.getTransformDOMRect();
      return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };
    });
    const centerBounds = Vector.bounds(centers);
    const xSpread = centerBounds.max.x - centerBounds.min.x;
    const ySpread = centerBounds.max.y - centerBounds.min.y;

    const axis = xSpread > ySpread ? 'horizontal' : 'vertical';

    return this.#calculateAlignmentProperties(shapes, axis);
  }

  #visualizeAlignment() {
    Gizmos.clear();

    if (this.#currentStroke) {
      // Show affected shapes
      this.#currentStroke.shapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        Gizmos.rect(rect, { color: 'rgba(255, 0, 0, 0.5)' });
      });

      // Create and show alignment
      const alignment = this.#createAlignment(this.#currentStroke.shapes);
      if (alignment) {
        // Draw the alignment line
        Gizmos.line(alignment.start, alignment.end, {
          color: 'rgba(0, 255, 0, 0.8)',
          width: 2,
        });

        // Draw connections between shapes and their targets
        alignment.shapes.forEach((shape) => {
          const rect = shape.getTransformDOMRect();
          const center = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };

          const target = alignment.targetPositions.get(shape);
          if (target) {
            // Draw line from shape to target
            Gizmos.line(center, target, {
              color: 'rgba(0, 0, 255, 0.5)',
              width: 1,
            });

            // Check if shape is fixed (has alignment on other axis)
            const existing = this.#getShapeAlignments(shape);
            const isFixed = existing[alignment.axis === 'horizontal' ? 'vertical' : 'horizontal'];

            // Draw target point with different color for fixed shapes
            Gizmos.point(target, {
              color: isFixed ? 'red' : 'blue',
            });
          }
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

    // Update all alignments
    if (this.#currentStroke) {
      this.#visualizeAlignment();
    } else {
      this.#alignments.forEach((alignment) => {
        // Move shapes towards their targets
        alignment.shapes.forEach((shape) => {
          const target = alignment.targetPositions.get(shape);
          if (!target) return;

          const rect = shape.getTransformDOMRect();
          const currentCenter = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          };

          // Calculate new position
          const newX = currentCenter.x + (target.x - currentCenter.x) * this.#ALIGNMENT_STRENGTH;
          const newY = currentCenter.y + (target.y - currentCenter.y) * this.#ALIGNMENT_STRENGTH;

          // Update shape position
          shape.x = newX - rect.width / 2;
          shape.y = newY - rect.height / 2;
        });
      });

      // Visualize all current alignments
      this.#visualizeActiveAlignments();
    }

    requestAnimationFrame(this.#updateCanvas);
  };

  #visualizeActiveAlignments() {
    Gizmos.clear();

    this.#alignments.forEach((alignment) => {
      // Draw the alignment line
      Gizmos.line(alignment.start, alignment.end, {
        color: alignment.axis === 'horizontal' ? 'rgba(0, 255, 0, 0.8)' : 'rgba(0, 0, 255, 0.8)',
        width: 2,
      });

      // Draw connections and targets
      alignment.shapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        const center = {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };

        const target = alignment.targetPositions.get(shape);
        if (target) {
          Gizmos.line(center, target, {
            color: 'rgba(0, 0, 255, 0.5)',
            width: 1,
          });

          Gizmos.point(target, {
            color: 'blue',
          });
        }
      });
    });
  }

  #getShapeAlignments(shape: FolkShape): { horizontal?: Alignment; vertical?: Alignment } {
    return this.#alignments.reduce(
      (acc, alignment) => {
        if (alignment.shapes.has(shape)) {
          acc[alignment.axis] = alignment;
        }
        return acc;
      },
      {} as { horizontal?: Alignment; vertical?: Alignment },
    );
  }

  #canAddToAlignment(shape: FolkShape, axis: 'horizontal' | 'vertical'): boolean {
    const existing = this.#getShapeAlignments(shape);
    return !existing[axis];
  }

  #findExistingAlignments(shapes: Set<FolkShape>, axis: 'horizontal' | 'vertical'): Alignment[] {
    // Find all alignments that share shapes with our new set and have the same axis
    return this.#alignments.filter(
      (existing) => existing.axis === axis && Array.from(shapes).some((shape) => existing.shapes.has(shape)),
    );
  }

  #mergeAlignments(alignments: Alignment[], newShapes: Set<FolkShape>) {
    if (alignments.length === 0) return null;

    // Use the first alignment as our base
    const mergedAlignment = alignments[0];

    // Add shapes from other alignments and new shapes
    const allShapes = new Set<FolkShape>();
    alignments.forEach((alignment) => {
      alignment.shapes.forEach((shape) => allShapes.add(shape));
    });
    newShapes.forEach((shape) => allShapes.add(shape));

    // Remove other alignments from our list
    this.#alignments = this.#alignments.filter((a) => !alignments.includes(a) || a === mergedAlignment);

    // Merge all shapes into the remaining alignment
    this.#mergeIntoAlignment(mergedAlignment, allShapes);

    return mergedAlignment;
  }

  #mergeIntoAlignment(existing: Alignment, newShapes: Set<FolkShape>) {
    // Add new shapes to existing alignment
    newShapes.forEach((shape) => {
      if (!existing.shapes.has(shape) && this.#canAddToAlignment(shape, existing.axis)) {
        existing.shapes.add(shape);
      }
    });

    // Recalculate alignment using shared method
    const newAlignment = this.#calculateAlignmentProperties(existing.shapes, existing.axis);

    // Update existing alignment properties
    existing.start = newAlignment.start;
    existing.end = newAlignment.end;
    existing.orderedShapes = newAlignment.orderedShapes;
    existing.targetPositions = newAlignment.targetPositions;
  }

  #findContainedAlignments(shapes: Set<FolkShape>): Alignment[] {
    // Find all alignments where every shape is in our new selection
    return this.#alignments.filter((existing) => Array.from(existing.shapes).every((shape) => shapes.has(shape)));
  }
}
