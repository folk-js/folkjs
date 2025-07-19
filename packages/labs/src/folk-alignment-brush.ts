import { Gizmos } from '@folkjs/canvas/folk-gizmos';
import { css } from '@folkjs/dom/ReactiveElement';
import type { Point } from '@folkjs/geometry/Vector2';
import * as V from '@folkjs/geometry/Vector2';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

interface AlignmentLine {
  shapes: Set<FolkShape>;
  points: Map<FolkShape, Point>;
  lineStart: Point;
  lineEnd: Point;
  isHorizontal: boolean;
}

export class FolkAlignmentBrush extends FolkBaseSet {
  static override tagName = 'folk-alignment-brush';

  static override styles = css`
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    ::slotted(*) {
      pointer-events: auto;
    }
  `;

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

  // Add new constants for removal threshold
  readonly #REMOVAL_THRESHOLD_MULTIPLIER = 1.0; // Multiplied by shape size

  // Add property to track dragging state
  #draggedShape: FolkShape | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.#setupCanvas();
    this.#setupEventListeners();
    requestAnimationFrame(this.#updateCanvas);
  }

  override disconnectedCallback() {
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
    this.addEventListener('pointerdown', this.#handleShapePointerDown, true);
    this.addEventListener('pointerup', this.#handleShapePointerUp, true);
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

      // Check if we've selected all shapes from multiple alignments
      const allShapesSelected = Array.from(overlappingAlignments).every((alignment) =>
        Array.from(alignment.shapes).every((shape) => this.#selectedShapes.has(shape)),
      );

      if (overlappingAlignments.size === 0) {
        // Case: No overlapping alignments - create new alignment
        this.#createAlignment(this.#selectedShapes);
      } else if (overlappingAlignments.size === 1 || !allShapesSelected) {
        // Case: One overlapping alignment or partial selection - merge into it
        const existingAlignment = overlappingAlignments.values().next().value;
        if (existingAlignment) {
          this.#mergeIntoAlignment(existingAlignment, this.#selectedShapes);
        }
      } else {
        // Case: Multiple complete alignments selected - merge all into new alignment
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
    const bounds = V.bounds(...centers);
    const isHorizontal = bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
    const center = V.center(...centers);

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
    // Check for dragged shapes that could join existing alignments
    const activeShape = document.activeElement instanceof FolkShape ? document.activeElement : null;
    if (activeShape && !this.#shapeToAlignments.has(activeShape)) {
      const rect = activeShape.getTransformDOMRect();

      // Find closest alignment within threshold
      for (const alignment of this.#alignments) {
        const perpDistance = alignment.isHorizontal
          ? Math.abs(rect.center.y - alignment.lineStart.y)
          : Math.abs(rect.center.x - alignment.lineStart.x);

        const linePos = alignment.isHorizontal ? rect.center.x : rect.center.y;
        const lineStart = alignment.isHorizontal ? alignment.lineStart.x : alignment.lineStart.y;
        const lineEnd = alignment.isHorizontal ? alignment.lineEnd.x : alignment.lineEnd.y;

        const threshold = (alignment.isHorizontal ? rect.height : rect.width) * this.#REMOVAL_THRESHOLD_MULTIPLIER;

        if (perpDistance <= threshold && linePos >= lineStart && linePos <= lineEnd) {
          this.#mergeIntoAlignment(alignment, new Set([activeShape]));
          break;
        }
      }
    }

    // Existing alignment handling
    for (const alignment of this.#alignments) {
      alignment.shapes.forEach((shape) => {
        if (shape === this.#draggedShape) {
          // Handle dragged shape logic
          const rect = shape.getTransformDOMRect();
          const current = rect.center;

          // Calculate perpendicular and parallel distances from line
          const perpDistance = alignment.isHorizontal
            ? Math.abs(current.y - alignment.lineStart.y)
            : Math.abs(current.x - alignment.lineStart.x);

          const linePos = alignment.isHorizontal ? current.x : current.y;
          const lineStart = alignment.isHorizontal ? alignment.lineStart.x : alignment.lineStart.y;
          const lineEnd = alignment.isHorizontal ? alignment.lineEnd.x : alignment.lineEnd.y;

          // Calculate removal thresholds
          const perpThreshold =
            (alignment.isHorizontal ? rect.height : rect.width) * this.#REMOVAL_THRESHOLD_MULTIPLIER;

          // Remove if too far perpendicular to line or beyond line endpoints
          if (perpDistance > perpThreshold || linePos < lineStart || linePos > lineEnd) {
            this.#removeShapeFromAlignment(shape, alignment);
          } else {
            // Recalculate positions while keeping the line fixed
            const positions = this.#calculateLinePoints(alignment.shapes, alignment.isHorizontal, {
              x: alignment.isHorizontal ? (alignment.lineStart.x + alignment.lineEnd.x) / 2 : alignment.lineStart.x,
              y: alignment.isHorizontal ? alignment.lineStart.y : (alignment.lineStart.y + alignment.lineEnd.y) / 2,
            });
            alignment.points = positions.points;
          }
          return;
        } else {
          // Move non-dragged shapes
          const target = alignment.points.get(shape)!;
          const current = shape.getTransformDOMRect().center;
          shape.x += (target.x - current.x) * 0.25;
          shape.y += (target.y - current.y) * 0.25;
        }
      });
    }
  }

  #removeShapeFromAlignment(shape: FolkShape, alignment: AlignmentLine) {
    alignment.shapes.delete(shape);
    alignment.points.delete(shape);

    const shapeAlignments = this.#shapeToAlignments.get(shape);
    if (shapeAlignments) {
      shapeAlignments.delete(alignment);
      if (shapeAlignments.size === 0) {
        this.#shapeToAlignments.delete(shape);
      }
    }

    // Remove alignment if less than 2 shapes remain
    if (alignment.shapes.size < 2) {
      this.#removeAlignment(alignment);
    } else {
      // Recalculate positions while keeping line fixed
      const center = {
        x: alignment.isHorizontal ? (alignment.lineStart.x + alignment.lineEnd.x) / 2 : alignment.lineStart.x,
        y: alignment.isHorizontal ? alignment.lineStart.y : (alignment.lineStart.y + alignment.lineEnd.y) / 2,
      };

      const positions = this.#calculateLinePoints(alignment.shapes, alignment.isHorizontal, center);
      alignment.points = positions.points;
      alignment.lineStart = positions.lineStart;
      alignment.lineEnd = positions.lineEnd;
    }
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
      const bounds = V.bounds(...centers);
      const isHorizontal = bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
      const center = V.center(...centers);

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

  // Helper methods to support the new functionality
  #determineAlignment(shapes: Set<FolkShape>): boolean {
    const centers = Array.from(shapes).map((shape) => shape.getTransformDOMRect().center);
    const bounds = V.bounds(...centers);
    return bounds.max.x - bounds.min.x > bounds.max.y - bounds.min.y;
  }

  #mergeIntoAlignment(alignment: AlignmentLine, newShapes: Set<FolkShape>) {
    // Add new shapes to existing alignment
    newShapes.forEach((shape) => alignment.shapes.add(shape));

    // Recalculate alignment positions while keeping line fixed
    const center = {
      x: alignment.isHorizontal ? (alignment.lineStart.x + alignment.lineEnd.x) / 2 : alignment.lineStart.x,
      y: alignment.isHorizontal ? alignment.lineStart.y : (alignment.lineStart.y + alignment.lineEnd.y) / 2,
    };

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

  // gross but here it is
  #handleShapePointerDown = (event: PointerEvent) => {
    if (event.target instanceof FolkShape) {
      this.#draggedShape = event.target;
    }
  };

  #handleShapePointerUp = () => {
    this.#draggedShape = null;
  };
}
