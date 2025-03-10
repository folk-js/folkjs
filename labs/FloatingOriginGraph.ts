/**
 * FloatingOriginGraph - A graph structure that supports infinite zooming
 * by changing the reference frame node. This allows for zoomable user interfaces that contain cycles,
 * where there is no top or bottom to the zoom. Memory consumption is finite and you'll never hit floating point
 * precision limits.

 * @note This is a PoC, lots of optimisations are possible. Graph visibility culling, caching, etc.
 * There's quite a bit of jank leftover from figuring this out, after we play with it some more we can do a cleanup pass.
 * Also not sure yet what the best API is for this.
 */

export interface Node<T = any> {
  id: string;
  data: T;
}

export interface Edge {
  source: string; // Source node ID
  target: string; // Target node ID
  transform: DOMMatrix;
}

type NodeMap<T = any> = Record<string, Node<T>>;
type EdgeMap = Record<string, Edge[]>;

export type ShouldZoomInCallback = <T>(
  graph: FloatingOriginGraph<T>,
  canvasWidth: number,
  canvasHeight: number,
  nextNodeId: string,
) => boolean;
export type ShouldZoomOutCallback = <T>(
  graph: FloatingOriginGraph<T>,
  canvasWidth: number,
  canvasHeight: number,
  prevNodeId: string,
) => boolean;

export class FloatingOriginGraph<T = any> {
  #nodes: NodeMap<T>;
  #edges: EdgeMap; // Directed edges from source to target
  #referenceNodeId: string;
  #viewportTransform: DOMMatrix;

  /**
   * Create a new FloatingOriginGraph
   * @param nodes - Array of nodes or object mapping node IDs to node objects
   * @param edges - Array of edges or object mapping source node IDs to arrays of edges
   * @param initialReferenceNodeId - The ID of the initial reference node
   */
  constructor(nodes: Node<T>[] | NodeMap<T>, edges: Edge[] | EdgeMap, initialReferenceNodeId?: string) {
    // Convert nodes array to map if necessary
    if (Array.isArray(nodes)) {
      this.#nodes = {};
      for (const node of nodes) {
        this.#nodes[node.id] = node;
      }
    } else {
      this.#nodes = nodes;
    }

    // Initialize the edges map, converting array to map if necessary
    this.#edges = {};
    if (Array.isArray(edges)) {
      // Group edges by source
      for (const edge of edges) {
        if (!this.#edges[edge.source]) {
          this.#edges[edge.source] = [];
        }
        this.#edges[edge.source].push(edge);
      }
    } else {
      // Initialize from object, ensuring each node ID maps to an array
      for (const [sourceId, edgesArray] of Object.entries(edges)) {
        this.#edges[sourceId] = Array.isArray(edgesArray) ? edgesArray : [edgesArray];
      }
    }

    // Use provided initial reference node or default to first node
    this.#referenceNodeId = initialReferenceNodeId || Object.keys(this.#nodes)[0];
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
   * Get all nodes as an array
   */
  get nodesArray(): Node<T>[] {
    return Object.values(this.#nodes);
  }

  /**
   * Get all edges in the graph
   */
  get edges(): EdgeMap {
    return this.#edges;
  }

  /**
   * Get all edges as a flat array
   */
  get edgesArray(): Edge[] {
    const result: Edge[] = [];
    for (const edgeArray of Object.values(this.#edges)) {
      result.push(...edgeArray);
    }
    return result;
  }

  /**
   * Get all outgoing edges from a node
   * @param nodeId - The source node ID
   * @returns Array of edges from the node
   */
  getEdgesFrom(nodeId: string): Edge[] {
    return this.#edges[nodeId] || [];
  }

  /**
   * Helper method to get the next node IDs for the current node
   * @param nodeId - The current node ID
   * @returns Array of target node IDs
   */
  getNextNodeIds(nodeId: string): string[] {
    const edges = this.getEdgesFrom(nodeId);
    return edges.map((edge) => edge.target);
  }

  /**
   * Helper method to get nodes that have edges pointing to the specified node
   * @param nodeId - The target node ID
   * @returns Array of source node IDs
   */
  getPrevNodeIds(nodeId: string): string[] {
    const prevNodeIds: string[] = [];

    for (const [sourceId, edges] of Object.entries(this.#edges)) {
      for (const edge of edges) {
        if (edge.target === nodeId) {
          prevNodeIds.push(sourceId);
          break; // Only add each source once
        }
      }
    }

    return prevNodeIds;
  }

  /**
   * Get the best next node to follow when zooming in
   * @param nodeId - The current node ID
   * @returns The next node ID or undefined if none found
   */
  getBestNextNodeId(nodeId: string): string | undefined {
    const edges = this.getEdgesFrom(nodeId);
    return edges.length > 0 ? edges[0].target : undefined;
  }

  /**
   * Get the best previous node to follow when zooming out
   * @param nodeId - The current node ID
   * @returns The previous node ID or undefined if none found
   */
  getBestPrevNodeId(nodeId: string): string | undefined {
    const prevNodeIds = this.getPrevNodeIds(nodeId);
    return prevNodeIds.length > 0 ? prevNodeIds[0] : undefined;
  }

  /**
   * Get an edge between source and target nodes
   * @param sourceNodeId - The source node ID
   * @param targetNodeId - The target node ID
   * @returns The edge or undefined if not found
   */
  getEdge(sourceNodeId: string, targetNodeId: string): Edge | undefined {
    const edges = this.getEdgesFrom(sourceNodeId);
    return edges.find((edge) => edge.target === targetNodeId);
  }

  /**
   * Find all edges connecting to the target node
   * @param targetNodeId - The target node ID
   * @returns The edges targeting the node
   */
  findEdgesToNode(targetNodeId: string): Edge[] {
    const result: Edge[] = [];
    for (const edges of Object.values(this.#edges)) {
      for (const edge of edges) {
        if (edge.target === targetNodeId) {
          result.push(edge);
        }
      }
    }
    return result;
  }

  /**
   * Iterate through visible nodes with their accumulated transforms
   * This provides both the node and its transform relative to the reference node
   * @param maxNodes - Maximum number of nodes to include
   * @returns Iterator yielding objects with node, nodeId, and accumulated transform
   */
  *getVisibleNodesWithTransforms(maxNodes: number = 40): Generator<{
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

    // Count of nodes yielded so far (including reference node)
    let nodesYielded = 1;

    // Create a queue for breadth-first traversal
    const queue: {
      nodeId: string;
      transform: DOMMatrix;
      depth: number;
    }[] = [];

    // Start with all edges from the reference node
    const edges = this.getEdgesFrom(this.#referenceNodeId);
    for (const edge of edges) {
      // Create a copy of the transform by extracting and reapplying its values
      const originalTransform = edge.transform;
      const copiedTransform = new DOMMatrix([
        originalTransform.a,
        originalTransform.b,
        originalTransform.c,
        originalTransform.d,
        originalTransform.e,
        originalTransform.f,
      ]);

      queue.push({
        nodeId: edge.target,
        transform: copiedTransform,
        depth: 1,
      });
    }

    // Process the queue until we hit maxNodes limit
    while (queue.length > 0 && nodesYielded < maxNodes) {
      const { nodeId, transform, depth } = queue.shift()!;

      // Get the node (skip if it doesn't exist)
      const node = this.#nodes[nodeId];
      if (!node) continue;

      // Yield the node
      yield { nodeId, node, transform };
      nodesYielded++;

      // Add all outgoing edges to the queue
      const nextEdges = this.getEdgesFrom(nodeId);
      for (const edge of nextEdges) {
        // Copy the current transform and multiply by edge transform
        const nextTransform = new DOMMatrix([
          transform.a,
          transform.b,
          transform.c,
          transform.d,
          transform.e,
          transform.f,
        ]).multiply(edge.transform);

        queue.push({
          nodeId: edge.target,
          transform: nextTransform,
          depth: depth + 1,
        });
      }
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
      const prevNodeId = this.getBestPrevNodeId(this.#referenceNodeId);
      if (prevNodeId && shouldZoomOut(this, canvasWidth, canvasHeight, prevNodeId)) {
        return this.moveReferenceBackward();
      }
    } else if (!isZoomingOut && shouldZoomIn) {
      // Check all connected nodes to see if any fully cover the screen
      const nextNodeIds = this.getNextNodeIds(this.#referenceNodeId);

      // First, check if any nodes fully cover the screen according to shouldZoomIn callback
      const coveringNodes = nextNodeIds.filter((nodeId) => shouldZoomIn(this, canvasWidth, canvasHeight, nodeId));

      if (coveringNodes.length > 0) {
        // If multiple nodes cover the screen, determine which is closest to the center of view
        let bestNodeId = coveringNodes[0];

        if (coveringNodes.length > 1) {
          let bestDistance = Infinity;
          const centerX = canvasWidth / 2;
          const centerY = canvasHeight / 2;

          for (const nodeId of coveringNodes) {
            const position = this.getNodeScreenPosition(nodeId, canvasWidth, canvasHeight);
            if (position) {
              const distance = Math.hypot(position.x - centerX, position.y - centerY);

              if (distance < bestDistance) {
                bestDistance = distance;
                bestNodeId = nodeId;
              }
            }
          }
        }

        // Move reference to the best fully-covering node
        return this.moveReferenceForward(bestNodeId);
      }
    }
    return false;
  }

  /**
   * Get a list of nodes visible from the reference node
   * @param maxNodes - Maximum number of nodes to include
   * @returns Array of node IDs visible from the reference node
   */
  getVisibleNodes(maxNodes: number = 40): string[] {
    // Always include the reference node
    const result: string[] = [this.#referenceNodeId];

    // Count the reference node
    let nodesAdded = 1;

    // Create a queue for breadth-first traversal
    const queue: { nodeId: string; depth: number }[] = [{ nodeId: this.#referenceNodeId, depth: 0 }];

    while (queue.length > 0 && nodesAdded < maxNodes) {
      const { nodeId, depth } = queue.shift()!;

      // Get all next nodes
      const nextNodeIds = this.getNextNodeIds(nodeId);
      for (const nextId of nextNodeIds) {
        // Skip if node doesn't exist
        if (!this.#nodes[nextId]) continue;

        // Add to result
        result.push(nextId);
        nodesAdded++;

        // Stop if we've reached the limit
        if (nodesAdded >= maxNodes) break;

        // Add to queue for further exploration
        queue.push({ nodeId: nextId, depth: depth + 1 });
      }
    }

    return result;
  }

  /**
   * Get the accumulated transform from the reference node to a target node
   * @param toNodeId - Target node ID
   * @returns The accumulated transform matrix or null if no path found
   */
  getAccumulatedTransform(toNodeId: string): DOMMatrix | null {
    if (toNodeId === this.#referenceNodeId) {
      return new DOMMatrix(); // Identity transform for self
    }

    // Use breadth-first search to find a path from reference to target
    const visited = new Set<string>([this.#referenceNodeId]);
    const queue: { nodeId: string; transform: DOMMatrix }[] = [
      { nodeId: this.#referenceNodeId, transform: new DOMMatrix() },
    ];

    while (queue.length > 0) {
      const { nodeId, transform } = queue.shift()!;

      const edges = this.getEdgesFrom(nodeId);
      for (const edge of edges) {
        if (edge.target === toNodeId) {
          // Found a path to target
          return transform.multiply(edge.transform);
        }

        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push({
            nodeId: edge.target,
            transform: transform.multiply(edge.transform),
          });
        }
      }
    }

    // No path found
    return null;
  }

  /**
   * Move the reference node to a specified next node
   * @param targetNodeId - The target node ID to move to (if undefined, will use best next node)
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceForward(targetNodeId?: string): boolean {
    // If no specific target is provided, use the best next node
    const nextNodeId = targetNodeId || this.getBestNextNodeId(this.#referenceNodeId);
    if (!nextNodeId) return false;

    // Verify that the next node is actually connected to the current reference node
    const edge = this.getEdge(this.#referenceNodeId, nextNodeId);
    if (!edge) return false;

    // Calculate the visual transform of the next node before changing reference
    const transform = this.getAccumulatedTransform(nextNodeId);
    if (!transform) return false;

    const visualTransformBefore = this.#viewportTransform.multiply(transform);

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
   * Move the reference node to a specified previous node
   * @param targetNodeId - The target node ID to move to (if undefined, will use best previous node)
   * @returns Boolean indicating if the operation was successful
   */
  moveReferenceBackward(targetNodeId?: string): boolean {
    // If no specific target is provided, use the best previous node
    const prevNodeId = targetNodeId || this.getBestPrevNodeId(this.#referenceNodeId);
    if (!prevNodeId) return false;

    // Get the edge from previous node to reference node
    const prevToRefEdge = this.getEdge(prevNodeId, this.#referenceNodeId);
    if (!prevToRefEdge) return false;

    // Calculate the visual position of the current reference node
    const currentVisualtransform = this.#viewportTransform;

    // Calculate the exact visual transform to maintain after changing reference
    // First get the transform from the new reference node to the old one
    const edgeTransform = prevToRefEdge.transform;

    // Update reference node
    this.#referenceNodeId = prevNodeId;

    // Calculate the new viewport transform that maintains the exact same visual state
    // by applying the inverse of the edge transform
    const invertedEdgeTransform = this.invertTransform(edgeTransform);
    this.#viewportTransform = currentVisualtransform.multiply(invertedEdgeTransform);

    return true;
  }

  /**
   * Calculate screen position of a node
   * @param nodeId - The ID of the node to get the position for
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns The x, y coordinates of the node on screen or null if node not found
   */
  getNodeScreenPosition(nodeId: string, canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
    const transform = this.getAccumulatedTransform(nodeId);
    if (!transform) return null;

    // Apply viewport transform
    const screenTransform = this.#viewportTransform.multiply(transform);

    // The node is drawn at the canvas center, so apply canvas center offset
    const screenX = canvasWidth / 2 + screenTransform.e;
    const screenY = canvasHeight / 2 + screenTransform.f;

    return { x: screenX, y: screenY };
  }

  /**
   * Reset the view to the initial reference node
   * @param initialNodeId - Optional node ID to reset to, defaults to the first node
   */
  resetView(initialNodeId?: string): void {
    this.#referenceNodeId = initialNodeId || Object.keys(this.#nodes)[0];
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
