/**
 * ShiftingOriginGraph - A graph structure that supports infinite zooming
 * by changing the reference frame node. This allows for zoomable user interfaces that contain cycles,
 * where there is no top or bottom to the zoom. Memory consumption is finite and you'll never hit floating point
 * precision limits.
 *
 * The key concept is that any node can become the center of the universe (reference node),
 * with all other nodes positioned relative to it.
 *
 * @note This is a PoC, lots of optimisations are possible. Graph visibility culling, caching, etc.
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
  graph: ShiftingOriginGraphv2<T>,
  canvasWidth: number,
  canvasHeight: number,
  nodeId: string,
  transform: DOMMatrix,
) => boolean;

export type ShouldZoomOutCallback = <T>(
  graph: ShiftingOriginGraphv2<T>,
  canvasWidth: number,
  canvasHeight: number,
) => boolean;

export type NodeCullingCallback = <T>(nodeId: string, transform: DOMMatrix, viewportTransform: DOMMatrix) => boolean;

export class ShiftingOriginGraphv2<T = any> {
  #nodes: NodeMap<T>;
  #edges: EdgeMap; // Directed edges from source to target
  #reverseEdges: EdgeMap; // Reverse index mapping target to source edges
  #referenceNodeId: string;
  #viewportTransform: DOMMatrix;
  #maxNodes = 30;

  /**
   * Create a new ShiftingOriginGraph
   * @param nodes - Array of nodes
   * @param edges - Array of edges
   * @param initialReferenceNodeId - The ID of the initial reference node
   * @param maxNodes - Maximum number of nodes to track for visibility
   */
  constructor(nodes: Node<T>[] = [], edges: Edge[] = [], initialReferenceNodeId?: string, maxNodes?: number) {
    this.#maxNodes = maxNodes || 30;

    this.#nodes = {};
    for (const node of nodes) {
      this.#nodes[node.id] = node;
    }

    this.#edges = {};
    this.#reverseEdges = {};

    // Group edges by source
    for (const edge of edges) {
      this.#addEdgeToMaps(edge);
    }

    // Use provided initial reference node or default to first node
    this.#referenceNodeId = initialReferenceNodeId || Object.keys(this.#nodes)[0] || '';
    this.#viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Add a node to the graph
   * @param node - The node to add
   * @returns The added node
   */
  addNode(node: Node<T>): Node<T> {
    this.#nodes[node.id] = node;

    // If this is the first node, make it the reference node
    if (Object.keys(this.#nodes).length === 1) {
      this.#referenceNodeId = node.id;
    }

    return node;
  }

  /**
   * Remove a node from the graph
   * @param nodeId - The ID of the node to remove
   * @returns True if the node was removed, false if it wasn't found
   */
  removeNode(nodeId: string): boolean {
    if (!this.#nodes[nodeId]) {
      return false;
    }

    // Remove the node
    delete this.#nodes[nodeId];

    // Remove all edges connected to this node
    if (this.#edges[nodeId]) {
      delete this.#edges[nodeId];
    }

    // Remove from reverse edges
    Object.keys(this.#reverseEdges).forEach((targetId) => {
      this.#reverseEdges[targetId] = (this.#reverseEdges[targetId] || []).filter((edge) => edge.source !== nodeId);

      if (this.#reverseEdges[targetId].length === 0) {
        delete this.#reverseEdges[targetId];
      }
    });

    // Remove the node from forward edges of other nodes
    Object.keys(this.#edges).forEach((sourceId) => {
      this.#edges[sourceId] = (this.#edges[sourceId] || []).filter((edge) => edge.target !== nodeId);

      if (this.#edges[sourceId].length === 0) {
        delete this.#edges[sourceId];
      }
    });

    // If we removed the reference node, pick a new one
    if (nodeId === this.#referenceNodeId) {
      const keys = Object.keys(this.#nodes);
      if (keys.length > 0) {
        this.resetView(keys[0]);
      }
    }

    return true;
  }

  /**
   * Add an edge to the graph
   * @param edge - The edge to add
   * @returns The added edge
   */
  addEdge(edge: Edge): Edge {
    this.#addEdgeToMaps(edge);
    return edge;
  }

  /**
   * Convenience method to add an edge between two nodes
   * @param sourceId - The source node ID
   * @param targetId - The target node ID
   * @param transform - The transform to apply
   * @returns The created edge or null if the source or target node doesn't exist
   */
  addEdgeBetween(sourceId: string, targetId: string, transform: DOMMatrix): Edge | null {
    // Verify that both nodes exist
    if (!this.#nodes[sourceId] || !this.#nodes[targetId]) {
      return null;
    }

    const edge: Edge = {
      source: sourceId,
      target: targetId,
      transform,
    };

    this.#addEdgeToMaps(edge);
    return edge;
  }

  /**
   * Remove an edge between two nodes
   * @param sourceId - The source node ID
   * @param targetId - The target node ID
   * @returns True if the edge was removed, false if it wasn't found
   */
  removeEdge(sourceId: string, targetId: string): boolean {
    if (!this.#edges[sourceId]) {
      return false;
    }

    const initialLength = this.#edges[sourceId].length;
    this.#edges[sourceId] = this.#edges[sourceId].filter((edge) => edge.target !== targetId);

    if (this.#edges[sourceId].length === 0) {
      delete this.#edges[sourceId];
    }

    // Also remove from reverse edges
    if (this.#reverseEdges[targetId]) {
      this.#reverseEdges[targetId] = this.#reverseEdges[targetId].filter((edge) => edge.source !== sourceId);

      if (this.#reverseEdges[targetId].length === 0) {
        delete this.#reverseEdges[targetId];
      }
    }

    return initialLength !== this.#edges[sourceId]?.length;
  }

  /**
   * Get the current reference node
   */
  get referenceNode(): Node<T> {
    return this.#nodes[this.#referenceNodeId];
  }

  /**
   * Get the current viewport transform
   */
  get viewportTransform(): DOMMatrix {
    return this.#viewportTransform;
  }

  /**
   * Get all nodes in the graph
   */
  get nodes(): NodeMap<T> {
    return this.#nodes;
  }

  /**
   * Iterate through visible nodes with their accumulated transforms
   * This provides both the node and its transform relative to the reference node
   * @param shouldCullNode - Optional callback to determine if a node should be culled
   * @returns Iterator yielding objects with node, nodeId, and accumulated transform
   */
  *getVisibleNodes(shouldCullNode?: NodeCullingCallback): Generator<{
    nodeId: string;
    node: Node<T>;
    transform: DOMMatrix;
  }> {
    // Always yield the reference node first with identity transform
    const identityMatrix = new DOMMatrix();

    yield {
      nodeId: this.#referenceNodeId,
      node: this.#nodes[this.#referenceNodeId],
      transform: identityMatrix,
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
    const edges = this.#getEdgesFrom(this.#referenceNodeId);
    for (const edge of edges) {
      // Create a copy of the transform
      const copiedTransform = this.#copyMatrix(edge.transform);

      // Check if node should be culled using the callback
      const shouldCull = shouldCullNode ? shouldCullNode(edge.target, copiedTransform, this.#viewportTransform) : false;

      if (!shouldCull) {
        queue.push({
          nodeId: edge.target,
          transform: copiedTransform,
          depth: 1,
        });
      }
    }

    // Process the queue until we hit maxNodes limit
    while (queue.length > 0 && nodesYielded < this.#maxNodes) {
      const { nodeId, transform, depth } = queue.shift()!;

      // Get the node (skip if it doesn't exist)
      const node = this.#nodes[nodeId];
      if (!node) continue;

      // Yield the node
      yield { nodeId, node, transform };
      nodesYielded++;

      // Add all outgoing edges to the queue
      const nextEdges = this.#getEdgesFrom(nodeId);
      for (const edge of nextEdges) {
        // Copy the current transform and multiply by edge transform
        const nextTransform = this.#copyMatrix(transform).multiply(edge.transform);

        // Check if node should be culled using the callback
        const shouldCull = shouldCullNode ? shouldCullNode(edge.target, nextTransform, this.#viewportTransform) : false;

        if (!shouldCull) {
          queue.push({
            nodeId: edge.target,
            transform: nextTransform,
            depth: depth + 1,
          });
        }
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
    const tempMatrix = new DOMMatrix().translate(centerX, centerY).scale(zoomFactor).translate(-centerX, -centerY);

    // Multiply with viewport transform
    const newTransform = tempMatrix.multiply(this.#viewportTransform);

    this.#viewportTransform = newTransform;

    // Check if we need to change reference nodes (if canvas dimensions and callbacks are provided)
    if (
      canvasWidth !== undefined &&
      canvasHeight !== undefined &&
      (shouldZoomIn !== undefined || shouldZoomOut !== undefined)
    ) {
      return this.#checkAndUpdateReferenceNode(zoomFactor < 1, canvasWidth, canvasHeight, shouldZoomIn, shouldZoomOut);
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
   * Reset the view to the initial reference node
   * @param initialNodeId - Optional node ID to reset to, defaults to the first node
   */
  resetView(initialNodeId?: string): void {
    this.#referenceNodeId = initialNodeId || Object.keys(this.#nodes)[0];
    this.#viewportTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /* ---- PRIVATE METHODS ---- */

  /**
   * Helper method to add an edge to both the forward and reverse edge maps
   * @param edge - The edge to add
   */
  #addEdgeToMaps(edge: Edge): void {
    // Forward index
    if (!this.#edges[edge.source]) {
      this.#edges[edge.source] = [];
    }
    // Check if the edge already exists
    const existingEdgeIndex = this.#edges[edge.source].findIndex((e) => e.target === edge.target);
    if (existingEdgeIndex >= 0) {
      // Replace the existing edge
      this.#edges[edge.source][existingEdgeIndex] = edge;
    } else {
      // Add a new edge
      this.#edges[edge.source].push(edge);
    }

    // Reverse index
    if (!this.#reverseEdges[edge.target]) {
      this.#reverseEdges[edge.target] = [];
    }
    // Check if the edge already exists in the reverse map
    const existingReverseEdgeIndex = this.#reverseEdges[edge.target].findIndex((e) => e.source === edge.source);
    if (existingReverseEdgeIndex >= 0) {
      // Replace the existing edge
      this.#reverseEdges[edge.target][existingReverseEdgeIndex] = edge;
    } else {
      // Add a new edge
      this.#reverseEdges[edge.target].push(edge);
    }
  }

  /**
   * Get all outgoing edges from a node
   * @param nodeId - The source node ID
   * @returns Array of edges from the node
   */
  #getEdgesFrom(nodeId: string): Edge[] {
    return this.#edges[nodeId] || [];
  }

  /**
   * Helper method to get the next node IDs for the current node
   * @param nodeId - The current node ID
   * @returns Array of target node IDs
   */
  #getNextNodeIds(nodeId: string): string[] {
    const edges = this.#getEdgesFrom(nodeId);
    return edges.map((edge) => edge.target);
  }

  /**
   * Get the IDs of all nodes that have edges to the specified node
   * @param nodeId - The ID of the node to get previous nodes for
   * @returns Array of node IDs that have edges to the specified node
   */
  #getPrevNodeIds(nodeId: string): string[] {
    const edges = this.#reverseEdges[nodeId] || [];
    return edges.map((edge) => edge.source);
  }

  /**
   * Get an edge between source and target nodes
   * @param sourceNodeId - The source node ID
   * @param targetNodeId - The target node ID
   * @returns The edge or undefined if not found
   */
  #getEdge(sourceNodeId: string, targetNodeId: string): Edge | undefined {
    const edges = this.#getEdgesFrom(sourceNodeId);
    return edges.find((edge) => edge.target === targetNodeId);
  }

  /**
   * Check if reference node needs to change and update it if needed
   * @param isZoomingOut - Whether we're zooming out
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @param shouldZoomIn - Callback to determine if a node covers the screen when zooming in
   * @param shouldZoomOut - Callback to determine if reference node no longer covers the screen when zooming out
   * @returns Boolean indicating if the reference node changed
   */
  #checkAndUpdateReferenceNode(
    isZoomingOut: boolean,
    canvasWidth: number,
    canvasHeight: number,
    shouldZoomIn?: ShouldZoomInCallback,
    shouldZoomOut?: ShouldZoomOutCallback,
  ): boolean {
    if (isZoomingOut && shouldZoomOut) {
      // Check if the reference node no longer covers the screen
      if (shouldZoomOut(this, canvasWidth, canvasHeight)) {
        // Get the first incoming edge to the reference node
        const prevNodeId = this.#getPrevNodeIds(this.#referenceNodeId)[0];
        if (!prevNodeId) return false;

        // Get the edge from previous node to current node
        const edge = this.#getEdge(prevNodeId, this.#referenceNodeId);
        if (!edge) return false;

        // Apply the backward shift to maintain visual state
        this.#unshiftOrigin(edge);
        return true;
      }
    } else if (!isZoomingOut && shouldZoomIn) {
      // Get all outgoing edges from the reference node
      const edges = this.#getEdgesFrom(this.#referenceNodeId);

      // Find the first node that covers the screen
      for (const edge of edges) {
        const nodeId = edge.target;
        if (shouldZoomIn(this, canvasWidth, canvasHeight, nodeId, edge.transform)) {
          // Apply the forward shift to maintain visual state
          this.#shiftOrigin(edge);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Shift the origin to a new node by following an edge
   * @param edge - The edge connecting current reference node to the new reference node
   */
  #shiftOrigin(edge: Edge): void {
    // When we change reference nodes, we need to update the viewport transform
    // to keep everything looking the same visually.

    // Update reference node to the target of the edge
    this.#referenceNodeId = edge.target;

    // 1. We combine current viewport with the edge transform
    // 2. This becomes our new viewport transform

    // Why this works:
    // - Before: viewport * edge = how target node appears
    // - After: new target node is at origin (0,0)
    // - So new viewport must equal: viewport * edge
    this.#viewportTransform = this.#viewportTransform.multiply(edge.transform);
  }

  /**
   * Shift the origin back to a previous node by following an edge in reverse
   * @param edge - The edge connecting new reference node to the current reference node
   */
  #unshiftOrigin(edge: Edge): void {
    // When shifting origin backwards, we need to apply the inverse of the edge transform

    // Update reference node to the source of the edge
    this.#referenceNodeId = edge.source;

    // 1. Calculate the inverse of the edge transform
    const inverseEdgeTransform = edge.transform.inverse();

    // 2. Multiply current viewport by the inverse transform
    // This undoes the effect of the edge transform

    // Why this works:
    // - Before: viewport shows current reference node
    // - After: we want to see from previous node's perspective
    // - So we apply the inverse transform: viewport * edge⁻¹
    this.#viewportTransform = this.#viewportTransform.multiply(inverseEdgeTransform);
  }

  /**
   * Create a copy of a transform matrix
   */
  #copyMatrix(source: DOMMatrix): DOMMatrix {
    const result = new DOMMatrix();
    result.a = source.a;
    result.b = source.b;
    result.c = source.c;
    result.d = source.d;
    result.e = source.e;
    result.f = source.f;
    return result;
  }
}
