import { Gizmos, Point, Vector } from '@lib';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

interface AlignmentLine {
  shapes: Set<FolkShape>;
  points: Map<FolkShape, Point>;
  lineStart: Point;
  lineEnd: Point;
  isHorizontal: boolean;
}

export class FolkBrushField extends FolkBaseSet {
  static override tagName = 'folk-brush-field';

  // Core structure
  #alignments = new Set<AlignmentLine>();
  #shapeToAlignments = new Map<FolkShape, Set<AlignmentLine>>();

  // Interaction state
  #isPointerDown = false;
  #lastPointerPosition: Point | null = null;
  #selectedShapes = new Set<FolkShape>();

  // Canvas for brush visualization
  #canvas!: HTMLCanvasElement;
  #ctx!: CanvasRenderingContext2D;

  // Brush settings
  readonly #BRUSH_RADIUS = 60;
  readonly #TARGET_PADDING = 20;

  connectedCallback() {
    super.connectedCallback();
    this.#setupCanvas();
    this.#setupEventListeners();
    requestAnimationFrame(this.#updateCanvas);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
  }

  #setupCanvas() {
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
    this.renderRoot.prepend(this.#canvas);
    this.#handleResize();
  }

  #setupEventListeners() {
    this.addEventListener('pointerdown', this.#handlePointerDown);
    this.addEventListener('pointermove', this.#handlePointerMove);
    this.addEventListener('pointerup', this.#handlePointerUp);
    this.addEventListener('pointerleave', this.#handlePointerUp);
    window.addEventListener('resize', this.#handleResize);
  }

  #handleResize = () => {
    const { width, height } = this.getBoundingClientRect();
    this.#canvas.width = width;
    this.#canvas.height = height;
  };

  #handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.target !== this) return;

    const rect = this.#canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    this.#selectedShapes.clear();
    this.#isPointerDown = true;
    this.#lastPointerPosition = point;

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
          this.#selectedShapes.add(element);
        }
      }
    });
  };

  #handlePointerMove = (event: PointerEvent) => {
    if (!this.#isPointerDown || !this.#lastPointerPosition) return;

    const rect = this.#canvas.getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    // Check for shapes under the new line segment
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape) {
        const shapeRect = element.getTransformDOMRect();
        if (this.#isLineIntersectingRect(this.#lastPointerPosition!, point, shapeRect)) {
          this.#selectedShapes.add(element);
        }
      }
    });

    this.#drawBrushStroke(this.#lastPointerPosition, point);
    this.#lastPointerPosition = point;
  };

  #handlePointerUp = () => {
    if (this.#selectedShapes.size >= 2) {
      // Find existing alignments that overlap with selected shapes
      const overlappingAlignments = new Set<AlignmentLine>();
      const isHorizontal = this.#determineAlignment(this.#selectedShapes);

      // Find all overlapping alignments with the same orientation
      for (const shape of this.#selectedShapes) {
        const shapeAlignments = this.#shapeToAlignments.get(shape);
        if (shapeAlignments) {
          for (const alignment of shapeAlignments) {
            if (alignment.isHorizontal === isHorizontal) {
              overlappingAlignments.add(alignment);
            }
          }
        }
      }

      if (overlappingAlignments.size === 0) {
        // Case: No overlapping alignments - create new alignment
        this.#createAlignment(this.#selectedShapes);
      } else if (overlappingAlignments.size === 1) {
        // Case: One overlapping alignment - merge into it
        const existingAlignment = overlappingAlignments.values().next().value;
        if (existingAlignment) {
          this.#mergeIntoAlignment(existingAlignment, this.#selectedShapes);
        }
      } else {
        // Case: Multiple overlapping alignments - merge all into new alignment
        const allShapes = new Set<FolkShape>();
        this.#selectedShapes.forEach((shape) => allShapes.add(shape));
        overlappingAlignments.forEach((alignment) => {
          alignment.shapes.forEach((shape) => allShapes.add(shape));
          this.#removeAlignment(alignment);
        });
        this.#createAlignment(allShapes);
      }
    }

    this.#isPointerDown = false;
    this.#lastPointerPosition = null;
    this.#selectedShapes.clear();
  };

  #isLineIntersectingRect(lineStart: Point, lineEnd: Point, rect: DOMRect): boolean {
    // Simple AABB check
    const minX = Math.min(lineStart.x, lineEnd.x);
    const maxX = Math.max(lineStart.x, lineEnd.x);
    const minY = Math.min(lineStart.y, lineEnd.y);
    const maxY = Math.max(lineStart.y, lineEnd.y);

    return !(maxX < rect.left || minX > rect.right || maxY < rect.top || minY > rect.bottom);
  }

  #createAlignment(shapes: Set<FolkShape>) {
    if (shapes.size < 2) {
      return;
    }

    // Calculate axis based on shape distribution
    const centers = Array.from(shapes).map((shape) => shape.getTransformDOMRect().center);
    const bounds = Vector.bounds(centers);
    const isHorizontal = bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
    const center = Vector.center(centers);

    const positions = this.#calculateLinePoints(shapes, isHorizontal, center);
    const alignment: AlignmentLine = {
      shapes: new Set(shapes), // Create a new Set to avoid reference issues
      isHorizontal,
      ...positions,
    };

    // Update lookups
    this.#alignments.add(alignment);
    shapes.forEach((shape) => {
      if (!this.#shapeToAlignments.has(shape)) {
        this.#shapeToAlignments.set(shape, new Set());
      }
      this.#shapeToAlignments.get(shape)!.add(alignment);
    });
  }

  #drawBrushStroke(from: Point, to: Point) {
    this.#ctx.beginPath();
    this.#ctx.moveTo(from.x, from.y);
    this.#ctx.lineTo(to.x, to.y);
    this.#ctx.lineWidth = this.#BRUSH_RADIUS;
    this.#ctx.strokeStyle = 'rgba(150, 190, 255, 0.3)';
    this.#ctx.lineCap = 'round';
    this.#ctx.stroke();
  }

  #calculateLinePoints(
    shapes: Set<FolkShape>,
    isHorizontal: boolean,
    centerPoint: Point,
  ): {
    points: Map<FolkShape, Point>;
    lineStart: Point;
    lineEnd: Point;
  } {
    const targetPositions = new Map<FolkShape, Point>();

    // Get centers and calculate total extent
    const shapeInfo = Array.from(shapes).map((shape) => {
      const rect = shape.getTransformDOMRect();
      return {
        shape,
        rect,
        center: rect.center,
        size: isHorizontal ? rect.width : rect.height,
      };
    });

    // Sort shapes along the primary axis
    shapeInfo.sort((a, b) => (isHorizontal ? a.center.x - b.center.x : a.center.y - b.center.y));

    // Calculate total length including padding between shapes
    const totalLength = shapeInfo.reduce((sum, info, index) => {
      return sum + info.size + (index < shapeInfo.length - 1 ? this.#TARGET_PADDING : 0);
    }, 0);

    // Start position (centered around centerPoint)
    let currentPos = -totalLength / 2;

    // Calculate positions along the line
    shapeInfo.forEach((info) => {
      const point = isHorizontal
        ? { x: centerPoint.x + currentPos + info.size / 2, y: centerPoint.y }
        : { x: centerPoint.x, y: centerPoint.y + currentPos + info.size / 2 };

      targetPositions.set(info.shape, point);
      currentPos += info.size + this.#TARGET_PADDING;
    });

    // Calculate line extent (add padding to ends)
    const halfLength = totalLength / 2;
    const lineStart = isHorizontal
      ? { x: centerPoint.x - halfLength, y: centerPoint.y }
      : { x: centerPoint.x, y: centerPoint.y - halfLength };

    const lineEnd = isHorizontal
      ? { x: centerPoint.x + halfLength, y: centerPoint.y }
      : { x: centerPoint.x, y: centerPoint.y + halfLength };

    return {
      points: targetPositions,
      lineStart,
      lineEnd,
    };
  }

  #visualizeAlignments() {
    Gizmos.clear();

    // Show active alignments
    for (const alignment of this.#alignments) {
      const style = { color: 'blue', width: 2 };

      // Draw alignment line
      Gizmos.line(alignment.lineStart, alignment.lineEnd, style);

      // Draw shape connections and targets
      alignment.shapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        const current = rect.center;
        const target = alignment.points.get(shape)!;

        Gizmos.line(current, target, {
          color: 'rgba(150, 150, 150, 0.5)',
          width: 1,
        });

        Gizmos.point(target, {
          color: style.color,
          size: 4,
        });
      });
    }

    // Show potential alignment
    if (this.#isPointerDown && this.#selectedShapes.size >= 2) {
      const centers = Array.from(this.#selectedShapes).map((shape) => shape.getTransformDOMRect().center);
      const bounds = Vector.bounds(centers);
      const isHorizontal = bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
      const center = Vector.center(centers);

      const positions = this.#calculateLinePoints(this.#selectedShapes, isHorizontal, center);
      const potential = {
        shapes: this.#selectedShapes,
        isHorizontal,
        lineStart: positions.lineStart,
        lineEnd: positions.lineEnd,
        points: positions.points,
      };

      // Draw potential alignment
      const style = { color: 'green', width: 2 };
      Gizmos.line(potential.lineStart, potential.lineEnd, style);

      potential.shapes.forEach((shape) => {
        const rect = shape.getTransformDOMRect();
        const current = rect.center;
        const target = potential.points.get(shape)!;

        Gizmos.line(current, target, {
          color: 'rgba(150, 150, 150, 0.5)',
          width: 1,
        });

        Gizmos.point(target, {
          color: style.color,
          size: 4,
        });
      });
    }
  }

  #updateCanvas = () => {
    // Clear canvas with fade effect
    this.#ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Update shape positions
    this.#lerpShapesTowardsTargets();

    this.#visualizeAlignments();
    requestAnimationFrame(this.#updateCanvas);
  };

  #lerpShapesTowardsTargets() {
    for (const alignment of this.#alignments) {
      alignment.shapes.forEach((shape) => {
        if (document.activeElement === shape) return;
        const target = alignment.points.get(shape)!;
        const current = shape.getTransformDOMRect().center;

        // Simple lerp towards target
        shape.x += (target.x - current.x) * 0.25;
        shape.y += (target.y - current.y) * 0.25;
      });
    }
  }

  // Helper methods to support the new functionality
  #determineAlignment(shapes: Set<FolkShape>): boolean {
    const centers = Array.from(shapes).map((shape) => shape.getTransformDOMRect().center);
    const bounds = Vector.bounds(centers);
    return bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
  }

  #mergeIntoAlignment(alignment: AlignmentLine, newShapes: Set<FolkShape>) {
    // Add new shapes to existing alignment
    newShapes.forEach((shape) => alignment.shapes.add(shape));

    // Recalculate alignment positions
    const center =
      alignment.lineStart.y === alignment.lineEnd.y
        ? { x: (alignment.lineStart.x + alignment.lineEnd.x) / 2, y: alignment.lineStart.y }
        : { x: alignment.lineStart.x, y: (alignment.lineStart.y + alignment.lineEnd.y) / 2 };

    const positions = this.#calculateLinePoints(alignment.shapes, alignment.isHorizontal, center);
    alignment.points = positions.points;
    alignment.lineStart = positions.lineStart;
    alignment.lineEnd = positions.lineEnd;

    // Update shape-to-alignment mappings
    newShapes.forEach((shape) => {
      if (!this.#shapeToAlignments.has(shape)) {
        this.#shapeToAlignments.set(shape, new Set());
      }
      this.#shapeToAlignments.get(shape)!.add(alignment);
    });
  }

  #removeAlignment(alignment: AlignmentLine) {
    // Remove from main set
    this.#alignments.delete(alignment);

    // Remove from all shape mappings
    alignment.shapes.forEach((shape) => {
      const alignments = this.#shapeToAlignments.get(shape);
      if (alignments) {
        alignments.delete(alignment);
        if (alignments.size === 0) {
          this.#shapeToAlignments.delete(shape);
        }
      }
    });
  }
}
