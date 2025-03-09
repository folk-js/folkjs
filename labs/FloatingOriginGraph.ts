/**
 * FloatingOriginGraph - A graph structure that supports infinite zooming
 * by changing the reference node.
 */

// Define the node structure - simplified, no longer contains connections or transform
export interface Node<T = any> {
  id: string;
  data: T;
}

// Define the edge structure - connects nodes and contains transform information
export interface Edge {
  source: string; // Source node ID
  target: string; // Target node ID
  transform: DOMMatrix; // Transform to apply when going from source to target
}

// Define node and edge map types
export type NodeMap<T = any> = Record<string, Node<T>>;
export type EdgeMap = Record<string, Edge>; // Maps source node ID to edge

// Define zoom checking callback types
export type ShouldZoomInCallback = <T>(
  graph: FloatingOriginGraph<T>,
  canvasWidth: number,
  canvasHeight: number,
) => boolean;
export type ShouldZoomOutCallback = <T>(
  graph: FloatingOriginGraph<T>,
  canvasWidth: number,
  canvasHeight: number,
) => boolean;

export class FloatingOriginGraph<T = any> {
  #nodes: NodeMap<T>;
  #edges: EdgeMap; // Directed edges from source to target
  #referenceNodeId: string;
  #viewportTransform: DOMMatrix;

  /**
   * Create a new FloatingOriginGraph
   * @param nodes - Object mapping node IDs to node objects
   * @param edges - Object mapping source node IDs to edges
   * @param initialReferenceNodeId - The ID of the initial reference node
   */
  constructor(nodes: NodeMap<T>, edges: EdgeMap, initialReferenceNodeId: string = Object.keys(nodes)[0]) {
    this.#nodes = nodes;
    this.#edges = edges;
    this.#referenceNodeId = initialReferenceNodeId;
    this.#viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Get the current reference node
   */
  get referenceNode(): Node<T> {
    return this.#nodes[this.#referenceNodeId];
  }

  /**
   * Get the current reference node ID
   */
  get referenceNodeId(): string {
    return this.#referenceNodeId;
  }

  /**
   * Set the reference node ID
   */
  set referenceNodeId(id: string) {
    if (!this.#nodes[id]) {
      throw new Error(`Node with ID "${id}" does not exist`);
    }
    this.#referenceNodeId = id;
  }

  /**
   * Get the current viewport transform
   */
  get viewportTransform(): DOMMatrix {
    return this.#viewportTransform;
  }

  /**
   * Set the viewport transform
   */
  set viewportTransform(transform: DOMMatrix) {
    this.#viewportTransform = transform;
  }

  /**
   * Get all nodes in the graph
   */
  get nodes(): NodeMap<T> {
    return this.#nodes;
  }

  /**
   * Get all edges in the graph
   */
  get edges(): EdgeMap {
    return this.#edges;
  }

  /**
   * Helper method to get the next node ID for the current node
   * @param nodeId - The current node ID
   * @returns The next node ID or undefined if not found
   */
  getNextNodeId(nodeId: string): string | undefined {
    const edge = this.#edges[nodeId];
    return edge?.target;
  }

  /**
   * Helper method to get the previous node ID for the current node
   * (a node that has an edge pointing to the current node)
   * @param nodeId - The current node ID
   * @returns The previous node ID or undefined if not found
   */
  getPrevNodeId(nodeId: string): string | undefined {
    // Find nodes that have an edge targeting the current node
    for (const [sourceId, edge] of Object.entries(this.#edges)) {
      if (edge.target === nodeId) {
        return sourceId;
      }
    }
    return undefined;
  }

  /**
   * Get the edge from a source node
   * @param sourceNodeId - The source node ID
   * @returns The edge or undefined if not found
   */
  getEdge(sourceNodeId: string): Edge | undefined {
    return this.#edges[sourceNodeId];
  }

  /**
   * Find the edge connecting to the target node
   * @param targetNodeId - The target node ID
   * @returns The edge or undefined if not found
   */
  findEdgeToNode(targetNodeId: string): Edge | undefined {
    for (const edge of Object.values(this.#edges)) {
      if (edge.target === targetNodeId) {
        return edge;
      }
    }
    return undefined;
  }

  /**
   * Iterate through visible nodes with their accumulated transforms
   * This provides both the node and its transform relative to the reference node
   * @param distance - Maximum number of nodes to include
   * @returns Iterator yielding objects with node, nodeId, and accumulated transform
   */
  *getVisibleNodesWithTransforms(distance: number = 12): Generator<{
    nodeId: string;
    node: Node<T>;
    transform: DOMMatrix;
  }> {
    // Always yield the reference node first with identity transform
    yield {
      nodeId: this.#referenceNodeId,
      node: this.#nodes[this.#referenceNodeId],
      transform: new DOMMatrix(), // Identity transform
    };

    // Then yield subsequent nodes with accumulated transforms
    let currentNodeId = this.#referenceNodeId;
    let currentTransform = new DOMMatrix(); // Start with identity matrix
    let count = 0;

    while (count < distance) {
      const edge = this.getEdge(currentNodeId);
      if (!edge) break;

      // Move to the next node
      currentNodeId = edge.target;
      const node = this.#nodes[currentNodeId];
      if (!node) break;

      // Accumulate the transform from the edge
      currentTransform = currentTransform.multiply(edge.transform);

      // Yield the node with its accumulated transform
      yield {
        nodeId: currentNodeId,
        node,
        transform: currentTransform,
      };

      count++;
    }
  }

  /**
   * Apply zoom transform centered on a point
   * @param centerX - X coordinate of zoom center point
   * @param centerY - Y coordinate of zoom center point
   * @param zoomFactor - Factor to zoom by (> 1 to zoom in, < 1 to zoom out)
   * @param canvasWidth - Width of the canvas (used for reference node checking)
   * @param canvasHeight - Height of the canvas (used for reference node checking)
   * @param shouldZoomIn - Optional callback to determine if zooming in should change reference node
   * @param shouldZoomOut - Optional callback to determine if zooming out should change reference node
   * @returns Boolean indicating if the reference node changed
   */
  zoomAtPoint(
    centerX: number,
    centerY: number,
    zoomFactor: number,
    canvasWidth?: number,
    canvasHeight?: number,
    shouldZoomIn?: ShouldZoomInCallback,
    shouldZoomOut?: ShouldZoomOutCallback,
  ): boolean {
    // Apply zoom transform centered on the specified point
    const newTransform = new DOMMatrix()
      .translate(centerX, centerY)
      .scale(zoomFactor)
      .translate(-centerX, -centerY)
      .multiply(this.#viewportTransform);

    this.#viewportTransform = newTransform;

    // Check if we need to change reference nodes (if canvas dimensions and callbacks are provided)
    if (
      canvasWidth !== undefined &&
      canvasHeight !== undefined &&
      (shouldZoomIn !== undefined || shouldZoomOut !== undefined)
    ) {
      return this.checkAndUpdateReferenceNode(zoomFactor < 1, canvasWidth, canvasHeight, shouldZoomIn, shouldZoomOut);
    }

    return false;
  }

  /**
   * Apply a pan transform to the viewport
   * @param dx - Change in x position
   * @param dy - Change in y position
   */
  pan(dx: number, dy: number): void {
    const newTransform = new DOMMatrix().translate(dx, dy).multiply(this.#viewportTransform);

    this.#viewportTransform = newTransform;
  }

  /**
   * Check if reference node needs to change and update it if needed
   * @param isZoomingOut - Whether we're zooming out
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @param shouldZoomIn - Callback to determine if zooming in should change reference node
   * @param shouldZoomOut - Callback to determine if zooming out should change reference node
   * @returns Boolean indicating if the reference node changed
   */
  checkAndUpdateReferenceNode(
    isZoomingOut: boolean,
    canvasWidth: number,
    canvasHeight: number,
    shouldZoomIn?: ShouldZoomInCallback,
    shouldZoomOut?: ShouldZoomOutCallback,
  ): boolean {
    if (isZoomingOut && shouldZoomOut) {
      // Check if we need to go to previous node
      if (shouldZoomOut(this, canvasWidth, canvasHeight)) {
        return this.moveReferenceBackward();
      }
    } else if (!isZoomingOut && shouldZoomIn) {
      // Check if next node fills the screen
      if (shouldZoomIn(this, canvasWidth, canvasHeight)) {
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
    const visibleNodes = [this.#referenceNodeId];

    let currentNodeId = this.#referenceNodeId;
    let count = 0;
    while (count < distance) {
      const nextNodeId = this.getNextNodeId(currentNodeId);
      if (!nextNodeId) break;

      visibleNodes.push(nextNodeId);
      currentNodeId = nextNodeId;
      count++;
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
    let currentNodeId = this.#referenceNodeId;

    while (currentNodeId !== toNodeId) {
      const edge = this.getEdge(currentNodeId);
      if (!edge) break;

      currentNodeId = edge.target;
      transform = edge.transform.multiply(transform);
    }

    return transform;
  }

  /**
   * Move the reference node to the next node
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceForward(): boolean {
    const nextNodeId = this.getNextNodeId(this.#referenceNodeId);
    if (!nextNodeId) return false;

    // Calculate the visual transform of the next node before changing reference
    const visualTransformBefore = this.#viewportTransform.multiply(this.getAccumulatedTransform(nextNodeId));

    // Update reference node
    this.#referenceNodeId = nextNodeId;

    // After changing reference, the next node is now at the origin (identity transform)
    const visualTransformAfter = new DOMMatrix();

    // Calculate the difference between before and after transforms
    const compensationTransform = visualTransformBefore.multiply(visualTransformAfter.inverse());

    // Adjust viewport transform to compensate exactly for the difference
    this.#viewportTransform = compensationTransform;

    return true;
  }

  /**
   * Move the reference node to the previous node
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceBackward(): boolean {
    const prevNodeId = this.getPrevNodeId(this.#referenceNodeId);
    if (!prevNodeId) return false;

    // Get the edge from previous node to reference node
    const prevToRefEdge = this.getEdge(prevNodeId);
    if (!prevToRefEdge) return false;

    // Update reference node
    this.#referenceNodeId = prevNodeId;

    // Apply the inverse of the edge transform to maintain visual position
    this.#viewportTransform = this.#viewportTransform.multiply(this.invertTransform(prevToRefEdge.transform));

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
    let currentNodeId = this.#referenceNodeId;

    while (currentNodeId !== nodeId) {
      const edge = this.getEdge(currentNodeId);
      if (!edge) break;

      currentNodeId = edge.target;
      transform = edge.transform.multiply(transform);
    }

    // Apply viewport transform
    transform = this.#viewportTransform.multiply(transform);

    // The node is drawn at the canvas center, so apply canvas center offset
    const screenX = canvasWidth / 2 + transform.e;
    const screenY = canvasHeight / 2 + transform.f;

    return { x: screenX, y: screenY };
  }

  /**
   * Reset the view to the initial reference node
   * @param initialNodeId - Optional node ID to reset to, defaults to the first node
   */
  resetView(initialNodeId: string = Object.keys(this.#nodes)[0]): void {
    this.#referenceNodeId = initialNodeId;
    this.#viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
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
