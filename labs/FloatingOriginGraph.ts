/**
 * FloatingOriginGraph - A graph structure that supports infinite zooming
 * by changing the reference node.
 */

// Define the node structure
export interface Node {
  id: string;
  prev?: string;
  next?: string;
  data: any;
  width: number;
  height: number;
  transform: DOMMatrix;
}

// Define node map type
export type NodeMap = Record<string, Node>;

export class FloatingOriginGraph {
  private _nodes: NodeMap;
  private _referenceNodeId: string;
  private _viewportTransform: DOMMatrix;

  /**
   * Create a new FloatingOriginGraph
   * @param nodes - Object mapping node IDs to node objects
   * @param initialReferenceNodeId - The ID of the initial reference node
   */
  constructor(nodes: NodeMap, initialReferenceNodeId: string = Object.keys(nodes)[0]) {
    this._nodes = nodes;
    this._referenceNodeId = initialReferenceNodeId;
    this._viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Get the current reference node
   */
  get referenceNode(): Node {
    return this._nodes[this._referenceNodeId];
  }

  /**
   * Get the current reference node ID
   */
  get referenceNodeId(): string {
    return this._referenceNodeId;
  }

  /**
   * Set the reference node ID
   */
  set referenceNodeId(id: string) {
    if (!this._nodes[id]) {
      throw new Error(`Node with ID "${id}" does not exist`);
    }
    this._referenceNodeId = id;
  }

  /**
   * Get the current viewport transform
   */
  get viewportTransform(): DOMMatrix {
    return this._viewportTransform;
  }

  /**
   * Set the viewport transform
   */
  set viewportTransform(transform: DOMMatrix) {
    this._viewportTransform = transform;
  }

  /**
   * Apply zoom transform centered on a point
   * @param centerX - X coordinate of zoom center point
   * @param centerY - Y coordinate of zoom center point
   * @param zoomFactor - Factor to zoom by (> 1 to zoom in, < 1 to zoom out)
   * @param canvasWidth - Width of the canvas (used for reference node checking)
   * @param canvasHeight - Height of the canvas (used for reference node checking)
   * @returns Boolean indicating if the reference node changed
   */
  zoomAtPoint(
    centerX: number,
    centerY: number,
    zoomFactor: number,
    canvasWidth?: number,
    canvasHeight?: number,
  ): boolean {
    // Apply zoom transform centered on the specified point
    const newTransform = new DOMMatrix()
      .translate(centerX, centerY)
      .scale(zoomFactor)
      .translate(-centerX, -centerY)
      .multiply(this._viewportTransform);

    this._viewportTransform = newTransform;

    // Check if we need to change reference nodes (if canvas dimensions are provided)
    if (canvasWidth !== undefined && canvasHeight !== undefined) {
      return this.checkAndUpdateReferenceNode(zoomFactor < 1, canvasWidth, canvasHeight);
    }

    return false;
  }

  /**
   * Apply a pan transform to the viewport
   * @param dx - Change in x position
   * @param dy - Change in y position
   */
  pan(dx: number, dy: number): void {
    const newTransform = new DOMMatrix().translate(dx, dy).multiply(this._viewportTransform);

    this._viewportTransform = newTransform;
  }

  /**
   * Check if reference node needs to change and update it if needed
   * @param isZoomingOut - Whether we're zooming out
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns Boolean indicating if the reference node changed
   */
  checkAndUpdateReferenceNode(isZoomingOut: boolean, canvasWidth: number, canvasHeight: number): boolean {
    if (isZoomingOut) {
      // Check if we need to go to previous node
      if (this.shouldZoomOutToPrevNode(canvasWidth, canvasHeight)) {
        return this.moveReferenceBackward();
      }
    } else {
      // Check if next node fills the screen
      if (this.shouldZoomInToNextNode(canvasWidth, canvasHeight)) {
        return this.moveReferenceForward();
      }
    }
    return false;
  }

  /**
   * Get a list of nodes visible from the reference node up to a specified distance
   * @param distance - Maximum number of nodes to include
   * @returns Array of node IDs visible from the reference node
   */
  getVisibleNodes(distance: number = 12): string[] {
    const visibleNodes = [this._referenceNodeId];

    let currentNodeId = this._referenceNodeId;
    let count = 0;
    while (this._nodes[currentNodeId]?.next && count < distance) {
      const nextNodeId = this._nodes[currentNodeId].next;
      if (nextNodeId) {
        visibleNodes.push(nextNodeId);
        currentNodeId = nextNodeId;
        count++;
      } else {
        break;
      }
    }

    return visibleNodes;
  }

  /**
   * Get the accumulated transform from the reference node to a target node
   * @param toNodeId - Target node ID
   * @returns The accumulated transform matrix
   */
  getAccumulatedTransform(toNodeId: string): DOMMatrix {
    let transform = new DOMMatrix();
    let currentNodeId = this._referenceNodeId;

    while (currentNodeId !== toNodeId) {
      const nextNodeId = this._nodes[currentNodeId]?.next;
      if (!nextNodeId) break;

      currentNodeId = nextNodeId;
      transform = this._nodes[currentNodeId].transform.multiply(transform);
    }

    return transform;
  }

  /**
   * Move the reference node to the next node
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceForward(): boolean {
    const nextNodeId = this._nodes[this._referenceNodeId]?.next;
    if (!nextNodeId) return false;

    // Calculate the visual transform of the next node before changing reference
    const visualTransformBefore = this._viewportTransform.multiply(this.getAccumulatedTransform(nextNodeId));

    // Update reference node
    this._referenceNodeId = nextNodeId;

    // After changing reference, the next node is now at the origin (identity transform)
    const visualTransformAfter = new DOMMatrix();

    // Calculate the difference between before and after transforms
    const compensationTransform = visualTransformBefore.multiply(visualTransformAfter.inverse());

    // Adjust viewport transform to compensate exactly for the difference
    this._viewportTransform = compensationTransform;

    return true;
  }

  /**
   * Move the reference node to the previous node
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceBackward(): boolean {
    const prevNodeId = this._nodes[this._referenceNodeId]?.prev;
    if (!prevNodeId) return false;

    // Get the transform from previous node to current node
    const nodeTransform = this._nodes[this._referenceNodeId].transform;

    // Update reference node
    this._referenceNodeId = prevNodeId;

    // Apply the inverse of the node transform to maintain visual position
    this._viewportTransform = this._viewportTransform.multiply(this.invertTransform(nodeTransform));

    return true;
  }

  /**
   * Calculate screen position of a node
   * @param nodeId - The ID of the node to get the position for
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns The x, y coordinates of the node on screen
   */
  getNodeScreenPosition(nodeId: string, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
    let transform = new DOMMatrix();

    // Accumulate transforms from reference node to target node
    let currentNodeId = this._referenceNodeId;
    while (currentNodeId !== nodeId) {
      const nextNodeId = this._nodes[currentNodeId]?.next;
      if (!nextNodeId) break;

      currentNodeId = nextNodeId;
      transform = this._nodes[currentNodeId].transform.multiply(transform);
    }

    // Apply viewport transform
    transform = this._viewportTransform.multiply(transform);

    // The node is drawn at the canvas center, so apply canvas center offset
    const screenX = canvasWidth / 2 + transform.e;
    const screenY = canvasHeight / 2 + transform.f;

    return { x: screenX, y: screenY };
  }

  /**
   * Check if a node should become the new reference when zooming in
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns Boolean indicating if the reference node should change
   */
  shouldZoomInToNextNode(canvasWidth: number, canvasHeight: number): boolean {
    const nextNodeId = this._nodes[this._referenceNodeId]?.next;
    if (!nextNodeId) return false;

    const nextNode = this._nodes[nextNodeId];
    if (!nextNode) return false;

    // Get the transform from reference node to next node
    const nextNodeTransform = this.getAccumulatedTransform(nextNodeId);

    // Calculate effective scale from combined viewport and node transform
    const combinedTransform = this._viewportTransform.multiply(nextNodeTransform);
    const effectiveScale = Math.hypot(combinedTransform.a, combinedTransform.b);

    // Calculate next node dimensions after transform
    const transformedWidth = nextNode.width * effectiveScale;
    const transformedHeight = nextNode.height * effectiveScale;

    // Check if next node covers the screen (with some buffer)
    return transformedWidth > canvasWidth * 1.2 && transformedHeight > canvasHeight * 1.2;
  }

  /**
   * Check if the reference node should change when zooming out
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns Boolean indicating if the reference node should change
   */
  shouldZoomOutToPrevNode(canvasWidth: number, canvasHeight: number): boolean {
    const node = this._nodes[this._referenceNodeId];
    if (!node) return false;

    // Get the previous node ID
    const prevNodeId = node.prev;
    if (!prevNodeId) return false;

    // Calculate effective scale from viewport transform
    const effectiveScale = Math.hypot(this._viewportTransform.a, this._viewportTransform.b);

    // Calculate current node dimensions after transform
    const transformedWidth = node.width * effectiveScale;
    const transformedHeight = node.height * effectiveScale;

    // Check if current node is too small on screen (with buffer)
    return transformedWidth < canvasWidth || transformedHeight < canvasHeight;
  }

  /**
   * Reset the view to the initial reference node
   * @param initialNodeId - Optional node ID to reset to, defaults to the first node
   */
  resetView(initialNodeId: string = Object.keys(this._nodes)[0]): void {
    this._referenceNodeId = initialNodeId;
    this._viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Helper function to invert a transform
   * @param transform - The transform to invert
   * @returns The inverted transform
   */
  private invertTransform(transform: DOMMatrix): DOMMatrix {
    return transform.inverse();
  }
}
