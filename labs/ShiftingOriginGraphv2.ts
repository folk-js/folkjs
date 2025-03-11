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
  nextNodeId: string,
) => boolean;

export type ShouldZoomOutCallback = <T>(
  graph: ShiftingOriginGraphv2<T>,
  canvasWidth: number,
  canvasHeight: number,
  prevNodeId: string,
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

      const edges = this.#getEdgesFrom(nodeId);
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
   * Get the best next node to follow when zooming in
   * @param nodeId - The current node ID
   * @returns The next node ID or undefined if none found
   */
  #getBestNextNodeId(nodeId: string): string | undefined {
    const edges = this.#getEdgesFrom(nodeId);
    return edges.length > 0 ? edges[0].target : undefined;
  }

  /**
   * Get the best previous node to follow when zooming out
   * @param nodeId - The current node ID
   * @returns The previous node ID or undefined if none found
   */
  #getBestPrevNodeId(nodeId: string): string | undefined {
    const prevNodeIds = this.#getPrevNodeIds(nodeId);
    return prevNodeIds.length > 0 ? prevNodeIds[0] : undefined;
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
   * @param shouldZoomIn - Callback to determine if zooming in should change reference node
   * @param shouldZoomOut - Callback to determine if zooming out should change reference node
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
      // Check if we need to go to previous node
      const prevNodeId = this.#getBestPrevNodeId(this.#referenceNodeId);
      if (prevNodeId && shouldZoomOut(this, canvasWidth, canvasHeight, prevNodeId)) {
        return this.#moveReferenceBackward();
      }
    } else if (!isZoomingOut && shouldZoomIn) {
      // Check all connected nodes to see if any fully cover the screen
      const nextNodeIds = this.#getNextNodeIds(this.#referenceNodeId);

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
            const position = this.#getNodeScreenPosition(nodeId, canvasWidth, canvasHeight);
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
        return this.#moveReferenceForward(bestNodeId);
      }
    }
    return false;
  }

  /**
   * Move the reference node to a specified next node
   * @param targetNodeId - The target node ID to move to (if undefined, will use best next node)
   * @returns Boolean indicating if the operation was successful
   */
  #moveReferenceForward(targetNodeId?: string): boolean {
    // If no specific target is provided, use the best next node
    const nextNodeId = targetNodeId || this.#getBestNextNodeId(this.#referenceNodeId);
    if (!nextNodeId) return false;

    return this.#moveReference(this.#referenceNodeId, nextNodeId, false);
  }

  /**
   * Move the reference node to a specified previous node
   * @param targetNodeId - The target node ID to move to (if undefined, will use best previous node)
   * @returns Boolean indicating if the operation was successful
   */
  #moveReferenceBackward(targetNodeId?: string): boolean {
    // If no specific target is provided, use the best previous node
    const prevNodeId = targetNodeId || this.#getBestPrevNodeId(this.#referenceNodeId);
    if (!prevNodeId) return false;

    return this.#moveReference(prevNodeId, this.#referenceNodeId, true);
  }

  /**
   * Shared logic for moving the reference node
   * @param fromNodeId - The starting node ID
   * @param toNodeId - The target node ID
   * @param isBackward - Whether moving backward (true) or forward (false)
   * @returns Boolean indicating if the operation was successful
   */
  #moveReference(fromNodeId: string, toNodeId: string, isBackward: boolean): boolean {
    // Verify that the edge exists between the nodes
    const edge = this.#getEdge(fromNodeId, toNodeId);
    if (!edge) return false;

    if (isBackward) {
      // Calculate the current visual transform
      const currentVisualTransform = this.#viewportTransform;

      // Update reference node
      this.#referenceNodeId = fromNodeId;

      // Apply inverse transform to maintain visual state
      const invertedEdgeTransform = edge.transform.inverse();
      this.#viewportTransform = currentVisualTransform.multiply(invertedEdgeTransform);
    } else {
      // Calculate the visual transform before changing reference
      const transform = this.getAccumulatedTransform(toNodeId);
      if (!transform) return false;

      const visualTransformBefore = this.#viewportTransform.multiply(transform);

      // Update reference node
      this.#referenceNodeId = toNodeId;

      // After changing reference, the target node is at the origin
      const visualTransformAfter = new DOMMatrix();

      // Calculate and apply compensation transform
      this.#viewportTransform = visualTransformBefore.multiply(visualTransformAfter.inverse());
    }

    return true;
  }

  /**
   * Calculate the new viewport transform when shifting origin to a new node
   * @param edge - The edge connecting current reference node to the new reference node
   * @returns The new viewport transform that preserves visual appearance
   */
  #shiftOrigin(edge: Edge): DOMMatrix {
    // When we change reference nodes, we need to update the viewport transform
    // to keep everything looking the same visually.

    // 1. We combine current viewport with the edge transform
    // 2. This becomes our new viewport transform

    // Why this works:
    // - Before: viewport * edge = how target node appears
    // - After: new target node is at origin (0,0)
    // - So new viewport must equal: viewport * edge
    return this.#viewportTransform.multiply(edge.transform);
  }

  /**
   * Calculate the new viewport transform when shifting origin backwards
   * @param edge - The edge connecting new reference node to the current reference node
   * @returns The new viewport transform that preserves visual appearance
   */
  #shiftOriginBackwards(edge: Edge): DOMMatrix {
    // When shifting origin backwards, we need to apply the inverse of the edge transform

    // 1. Calculate the inverse of the edge transform
    const inverseEdgeTransform = edge.transform.inverse();

    // 2. Multiply current viewport by the inverse transform
    // This undoes the effect of the edge transform

    // Why this works:
    // - Before: viewport shows current reference node
    // - After: we want to see from previous node's perspective
    // - So we apply the inverse transform: viewport * edge⁻¹
    return this.#viewportTransform.multiply(inverseEdgeTransform);
  }

  /**
   * Calculate screen position of a node
   * @param nodeId - The ID of the node to get the position for
   * @param canvasWidth - Width of the canvas
   * @param canvasHeight - Height of the canvas
   * @returns The x, y coordinates of the node on screen or null if node not found
   */
  #getNodeScreenPosition(nodeId: string, canvasWidth: number, canvasHeight: number): { x: number; y: number } | null {
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
