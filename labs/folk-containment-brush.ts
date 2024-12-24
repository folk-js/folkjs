import { Gizmos, Point, Vector } from '@lib';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';

interface Containment {
  container: FolkShape;
  children: Set<FolkShape>;
  padding: number;
}

interface RowItem {
  rect: DOMRect;
  x: number;
}

interface Row {
  items: RowItem[];
  height: number;
  y: number;
}

export class FolkContainmentBrush extends FolkBaseSet {
  static override tagName = 'folk-containment-brush';

  // Core structure
  #containments = new Set<Containment>();
  #shapeToContainment = new Map<FolkShape, Containment>();

  // Interaction state
  #isPointerDown = false;
  #lastPointerPosition: Point | null = null;
  #selectedShapes = new Set<FolkShape>();

  // Canvas for brush visualization
  #canvas!: HTMLCanvasElement;
  #ctx!: CanvasRenderingContext2D;

  // Settings
  readonly #BRUSH_RADIUS = 60;
  readonly #CONTAINER_PADDING = 20;
  readonly #LERP_FACTOR = 0.25;

  connectedCallback() {
    super.connectedCallback();
    this.#setupCanvas();
    this.#setupEventListeners();
    requestAnimationFrame(this.#updateCanvas);
  }

  #setupCanvas() {
    this.#canvas = document.createElement('canvas');
    this.#canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: all;
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
    this.addEventListener('pointerup', this.#handleShapeDrop, true);
  }

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
        if (this.#isPointInRect(point, rect)) {
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

    // Add shapes under the brush stroke
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
      this.#tryCreateContainment(this.#selectedShapes);
    }

    this.#isPointerDown = false;
    this.#lastPointerPosition = null;
    this.#selectedShapes.clear();
  };

  #handleShapeDrop = (event: PointerEvent) => {
    if (!(event.target instanceof FolkShape)) return;
    const droppedShape = event.target;

    // Find potential containers
    this.sourceElements.forEach((element) => {
      if (element instanceof FolkShape && element !== droppedShape) {
        const containerRect = element.getTransformDOMRect();
        const shapeRect = droppedShape.getTransformDOMRect();

        // Check for significant overlap (e.g., 40% of the shape's area)
        if (this.#isRectOverlapping(shapeRect, containerRect, 0.4)) {
          const existingContainment = this.#shapeToContainment.get(element);
          if (existingContainment) {
            this.#addToContainment(existingContainment, droppedShape);
          } else {
            this.#createContainment(element, new Set([droppedShape]));
          }
        }
      }
    });
  };

  #updateCanvas = () => {
    // this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);

    // Update containments
    for (const containment of this.#containments) {
      this.#updateContainment(containment);
    }

    this.#visualizeContainments();
    requestAnimationFrame(this.#updateCanvas);
  };

  #tryCreateContainment(shapes: Set<FolkShape>) {
    const largestShape = this.#findLargestShape(shapes);
    if (!largestShape) return;

    const potentialChildren = new Set<FolkShape>();
    const containerRect = largestShape.getTransformDOMRect();

    shapes.forEach((shape) => {
      if (shape !== largestShape) {
        const childRect = shape.getTransformDOMRect();
        if (this.#isRectContained(childRect, containerRect)) {
          potentialChildren.add(shape);
        }
      }
    });

    if (potentialChildren.size > 0) {
      // Remove any existing containments for these shapes
      potentialChildren.forEach((child) => {
        const existingContainment = this.#shapeToContainment.get(child);
        if (existingContainment) {
          this.#removeFromContainment(existingContainment, child);
        }
      });

      // Create new containment
      this.#createContainment(largestShape, potentialChildren);
    }
  }

  #createContainment(container: FolkShape, children: Set<FolkShape>) {
    const containment: Containment = {
      container,
      children: new Set(children),
      padding: this.#CONTAINER_PADDING,
    };

    this.#containments.add(containment);
    this.#shapeToContainment.set(container, containment);
    children.forEach((child) => {
      this.#shapeToContainment.set(child, containment);
    });

    // Initial layout
    this.#updateChildrenLayout(containment);
  }

  #addToContainment(containment: Containment, shape: FolkShape) {
    // Remove from any existing containment
    const existingContainment = this.#shapeToContainment.get(shape);
    if (existingContainment) {
      this.#removeFromContainment(existingContainment, shape);
    }

    containment.children.add(shape);
    this.#shapeToContainment.set(shape, containment);
    this.#updateChildrenLayout(containment);
  }

  #removeFromContainment(containment: Containment, shape: FolkShape) {
    containment.children.delete(shape);
    this.#shapeToContainment.delete(shape);

    if (containment.children.size === 0) {
      this.#containments.delete(containment);
      this.#shapeToContainment.delete(containment.container);
    } else {
      this.#updateChildrenLayout(containment);
    }
  }

  #updateContainment(containment: Containment) {
    // Check if children are still contained
    const containerRect = containment.container.getTransformDOMRect();
    const childrenToRemove: FolkShape[] = [];

    containment.children.forEach((child) => {
      const childRect = child.getTransformDOMRect();
      if (!this.#isRectContained(childRect, containerRect)) {
        childrenToRemove.push(child);
      }
    });

    childrenToRemove.forEach((child) => {
      this.#removeFromContainment(containment, child);
    });

    // Update children layout
    this.#updateChildrenLayout(containment);
  }

  #updateChildrenLayout(containment: Containment) {
    if (containment.children.size === 0) return;

    const containerRect = containment.container.getTransformDOMRect();
    const children = Array.from(containment.children);

    // Calculate available space
    const availableWidth = containerRect.width - containment.padding * 2;
    const availableHeight = containerRect.height - containment.padding * 2;

    // Calculate positions and get row information
    const { positions, totalWidth, totalHeight } = this.#calculateSimplePositions(
      children.map((child) => child.getTransformDOMRect()),
      availableWidth,
      availableHeight,
      containment.padding,
    );

    // Update container size with lerping
    const targetWidth = totalWidth + containment.padding * 2;
    const targetHeight = totalHeight + containment.padding * 2;

    containment.container.width += (targetWidth - containerRect.width) * this.#LERP_FACTOR;
    containment.container.height += (targetHeight - containerRect.height) * this.#LERP_FACTOR;

    // Apply positions to children
    children.forEach((child, index) => {
      const targetPos = positions[index];
      const currentRect = child.getTransformDOMRect();

      child.x += (targetPos.x + containerRect.x + containment.padding - currentRect.x) * this.#LERP_FACTOR;
      child.y += (targetPos.y + containerRect.y + containment.padding - currentRect.y) * this.#LERP_FACTOR;
    });
  }

  #calculateSimplePositions(childRects: DOMRect[], maxWidth: number, maxHeight: number, gap: number) {
    const rows: Row[] = [];
    let currentRow: Row = { items: [], height: 0, y: 0 };
    let currentX = 0;
    let maxRowWidth = 0;

    childRects.forEach((rect) => {
      if (currentX + rect.width > maxWidth && currentRow.items.length > 0) {
        maxRowWidth = Math.max(maxRowWidth, currentX - gap);
        rows.push(currentRow);
        currentRow = { items: [], height: 0, y: 0 };
        currentX = 0;
      }

      currentRow.items.push({ rect, x: currentX });
      currentRow.height = Math.max(currentRow.height, rect.height);
      currentX += rect.width + gap;
    });

    if (currentRow.items.length > 0) {
      maxRowWidth = Math.max(maxRowWidth, currentX - gap);
      rows.push(currentRow);
    }

    const positions: Point[] = [];
    let currentY = 0;

    rows.forEach((row) => {
      row.y = currentY;
      row.items.forEach((item) => {
        positions.push({ x: item.x, y: row.y });
      });
      currentY += row.height + gap;
    });

    return {
      positions,
      totalWidth: maxRowWidth,
      totalHeight: currentY - gap,
    };
  }

  #visualizeContainments() {
    Gizmos.clear();

    // Draw active containments
    this.#containments.forEach((containment) => {
      const containerRect = containment.container.getTransformDOMRect();

      // Draw container bounds
      Gizmos.rect(containerRect, {
        color: 'rgba(0, 255, 0, 0.2)',
      });

      // Draw connections to children
      containment.children.forEach((child) => {
        const childRect = child.getTransformDOMRect();
        Gizmos.line(containerRect.center, childRect.center, { color: 'rgba(0, 255, 0, 0.3)', width: 1 });
      });
    });

    // Draw potential containment while selecting
    if (this.#isPointerDown && this.#selectedShapes.size >= 2) {
      const largestShape = this.#findLargestShape(this.#selectedShapes);
      if (largestShape) {
        const containerRect = largestShape.getTransformDOMRect();
        Gizmos.rect(containerRect, {
          color: 'rgba(255, 255, 0, 0.2)',
        });
      }
    }
  }

  // Utility methods
  #isPointInRect(point: Point, rect: DOMRect): boolean {
    return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  }

  #isLineIntersectingRect(lineStart: Point, lineEnd: Point, rect: DOMRect): boolean {
    const minX = Math.min(lineStart.x, lineEnd.x);
    const maxX = Math.max(lineStart.x, lineEnd.x);
    const minY = Math.min(lineStart.y, lineEnd.y);
    const maxY = Math.max(lineStart.y, lineEnd.y);

    return !(maxX < rect.x || minX > rect.x + rect.width || maxY < rect.y || minY > rect.y + rect.height);
  }

  #isRectContained(inner: DOMRect, outer: DOMRect): boolean {
    return (
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height
    );
  }

  #calculateBounds(rects: DOMRect[]): DOMRect {
    if (rects.length === 0) throw new Error('No rects to calculate bounds');

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    rects.forEach((rect) => {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    });

    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  #findLargestShape(shapes: Set<FolkShape>): FolkShape | null {
    let largestShape: FolkShape | null = null;
    let largestArea = 0;

    shapes.forEach((shape) => {
      const rect = shape.getTransformDOMRect();
      const area = rect.width * rect.height;
      if (area > largestArea) {
        largestArea = area;
        largestShape = shape;
      }
    });

    return largestShape;
  }

  #handleResize = () => {
    const { width, height } = this.getBoundingClientRect();
    this.#canvas.width = width;
    this.#canvas.height = height;
  };

  #drawBrushStroke(from: Point, to: Point) {
    Gizmos.line(from, to, { color: 'red', width: this.#BRUSH_RADIUS });
    this.#ctx.beginPath();
    this.#ctx.moveTo(from.x, from.y);
    this.#ctx.lineTo(to.x, to.y);
    this.#ctx.lineWidth = this.#BRUSH_RADIUS;
    this.#ctx.strokeStyle = 'rgba(150, 190, 255, 0.3)';
    this.#ctx.lineCap = 'round';
    this.#ctx.stroke();
  }

  #isRectOverlapping(rect1: DOMRect, rect2: DOMRect, threshold: number): boolean {
    const overlapX = Math.max(0, Math.min(rect1.right, rect2.right) - Math.max(rect1.left, rect2.left));
    const overlapY = Math.max(0, Math.min(rect1.bottom, rect2.bottom) - Math.max(rect1.top, rect2.top));

    const overlapArea = overlapX * overlapY;
    const rect1Area = rect1.width * rect1.height;

    return overlapArea / rect1Area >= threshold;
  }
}
