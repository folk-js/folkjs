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

import { Matrix } from '@lib/Matrix';
import { MultiGraph, Edge as MultiGraphEdge, Node as MultiGraphNode } from './MultiGraph';

// Re-export the Node type using 'export type' for TypeScript module compatibility
export type { Node } from './MultiGraph';

// Our custom Edge interface extends MultiGraph's Edge but changes 'data' to 'transform'
export interface Edge {
  id: string;
  source: string;
  target: string;
  transform: DOMMatrix;
}

export type ShouldZoomInCallback = <T>(
  combinedTransform: DOMMatrix,
  canvasWidth: number,
  canvasHeight: number,
  nodeId: string,
) => boolean;

export type ShouldZoomOutCallback = <T>(
  originTransform: DOMMatrix,
  canvasWidth: number,
  canvasHeight: number,
) => boolean;

export type NodeCullingCallback = <T>(nodeId: string, transform: DOMMatrix, originTransform: DOMMatrix) => boolean;

// Extend MultiGraph with our specialized ShiftingOrigin functionality
export class ShiftingOriginGraphv2<T = any> extends MultiGraph<T, DOMMatrix> {
  originNodeId: string;
  #originTransform: DOMMatrix;
  #maxNodes = 30;

  /**
   * Create a new ShiftingOriginGraph
   * @param nodes - Array of nodes
   * @param edges - Array of edges
   * @param initialReferenceNodeId - The ID of the initial reference node
   * @param maxNodes - Maximum number of nodes to track for visibility
   */
  constructor(nodes: MultiGraphNode<T>[] = [], edges: Edge[] = [], initialReferenceNodeId?: string, maxNodes?: number) {
    super(); // Initialize the MultiGraph base class

    this.#maxNodes = maxNodes || 30;

    // Add nodes to the graph
    for (const node of nodes) {
      this.addNode(node.id, node.data);
    }

    // Add edges to the graph
    for (const edge of edges) {
      // Convert our Edge type to MultiGraph edge format - transform becomes data
      super.addEdge(edge.source, edge.target, edge.transform, edge.id);
    }

    // Use provided initial reference node or default to first node
    this.originNodeId = initialReferenceNodeId || (this.nodes.size > 0 ? Array.from(this.nodes.keys())[0] : '');
    this.#originTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Add a node to the graph
   * @param node - The node to add or the node ID if providing data separately
   * @param data - The node data (if not included in node parameter)
   * @returns The added node
   */
  addNode(node: MultiGraphNode<T> | string, data?: T): MultiGraphNode<T> {
    let nodeId: string;
    let nodeData: T;

    if (typeof node === 'string') {
      // Called with separate id and data parameters
      nodeId = node;
      nodeData = data as T;
    } else {
      // Called with a complete node object
      nodeId = node.id;
      nodeData = node.data;
    }

    const createdNode = super.addNode(nodeId, nodeData);

    // If this is the first node, make it the reference node
    if (this.nodeCount === 1) {
      this.originNodeId = nodeId;
    }

    return createdNode;
  }

  /**
   * Override the addEdge method from MultiGraph to work with our custom Edge interface
   * @param source - Source node ID
   * @param target - Target node ID
   * @param data - Either a DOMMatrix transform or data to be used as transform
   * @param id - Optional edge ID
   * @returns The added edge or null if the nodes don't exist
   */
  addEdge(source: string, target: string, data: DOMMatrix, id?: string): MultiGraphEdge<DOMMatrix> | null;
  /**
   * Add an edge from an Edge object
   * @param edge - The Edge object to add
   * @returns The added edge or null if the nodes don't exist
   */
  addEdge(edge: Edge): MultiGraphEdge<DOMMatrix> | null;
  /**
   * Implementation of addEdge that handles both signatures
   */
  addEdge(
    sourceOrEdge: string | Edge,
    target?: string,
    transform?: DOMMatrix,
    id?: string,
  ): MultiGraphEdge<DOMMatrix> | null {
    // Handle case where a complete edge object is passed
    if (typeof sourceOrEdge !== 'string') {
      const edge = sourceOrEdge;
      return super.addEdge(edge.source, edge.target, edge.transform, edge.id);
    }

    // Handle standard case (string source + target + transform)
    if (!target || !transform) {
      return null;
    }

    // Generate a unique ID if not provided
    const edgeId = id || this.#generateEdgeId(sourceOrEdge, target);

    // Call MultiGraph's addEdge with transform as the data
    return super.addEdge(sourceOrEdge, target, transform, edgeId);
  }

  /**
   * Convenience method to add an edge between two nodes
   * @param sourceId - The source node ID
   * @param targetId - The target node ID
   * @param transform - The transform to apply
   * @returns The created edge or null if the source or target node doesn't exist
   */
  addEdgeBetween(sourceId: string, targetId: string, transform: DOMMatrix): MultiGraphEdge<DOMMatrix> | null {
    return this.addEdge(sourceId, targetId, transform);
  }

  /**
   * Convert a MultiGraph edge to our Edge format
   * @param edge - The MultiGraph edge to convert
   * @returns The converted edge in our format
   */
  convertToEdge(edge: MultiGraphEdge<DOMMatrix>): Edge {
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      transform: edge.data,
    };
  }

  /**
   * Remove an edge between two nodes
   * @param sourceId - The source node ID or edge ID
   * @param targetId - The target node ID (not needed if sourceId is an edge ID)
   * @returns True if the edge was removed, false if it wasn't found
   */
  removeEdge(sourceId: string, targetId?: string): boolean {
    if (targetId) {
      // We need to find the specific edge ID
      const edge = this.getFirstEdgeBetween(sourceId, targetId);
      if (edge) {
        return super.removeEdge(edge.id);
      }
      return false;
    } else {
      // sourceId is the edge ID directly
      return super.removeEdge(sourceId);
    }
  }

  /**
   * Get the current reference node
   */
  get referenceNode(): MultiGraphNode<T> {
    return this.getNode(this.originNodeId)!;
  }

  /**
   * Get the current origin transform
   */
  get originTransform(): DOMMatrix {
    return this.#originTransform;
  }

  /**
   * Iterate through visible nodes with their accumulated transforms
   * This provides both the node and its transform relative to the reference node
   * @param shouldCullNode - Optional callback to determine if a node should be culled
   * @returns Iterator yielding objects with node, nodeId, and accumulated transform
   */
  *getVisibleNodes(shouldCullNode?: NodeCullingCallback): Generator<{
    nodeId: string;
    node: MultiGraphNode<T>;
    transform: DOMMatrix;
  }> {
    // Always yield the reference node first with identity transform
    const identityMatrix = new DOMMatrix();
    const originNode = this.getNode(this.originNodeId);

    if (!originNode) return;

    yield {
      nodeId: this.originNodeId,
      node: originNode,
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
    const edges = this.getEdgesFrom(this.originNodeId);
    for (const edge of edges) {
      // Create a copy of the transform
      const copiedTransform = Matrix.copyDOMMatrix(edge.data);

      // Check if node should be culled using the callback
      const shouldCull = shouldCullNode ? shouldCullNode(edge.target, copiedTransform, this.#originTransform) : false;

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
      const node = this.getNode(nodeId);
      if (!node) continue;

      // Yield the node
      yield { nodeId, node, transform };
      nodesYielded++;

      // Add all outgoing edges to the queue
      const nextEdges = this.getEdgesFrom(nodeId);
      for (const edge of nextEdges) {
        // Copy the current transform and multiply by edge transform
        const nextTransform = Matrix.copyDOMMatrix(transform).multiply(edge.data);

        // Check if node should be culled using the callback
        const shouldCull = shouldCullNode ? shouldCullNode(edge.target, nextTransform, this.#originTransform) : false;

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
    const newTransform = tempMatrix.multiply(this.#originTransform);

    this.#originTransform = newTransform;

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
    const newTransform = new DOMMatrix().translate(dx, dy).multiply(this.#originTransform);

    this.#originTransform = newTransform;
  }

  /**
   * Reset the view to the initial reference node
   * @param initialNodeId - Optional node ID to reset to, defaults to the first node
   */
  resetView(initialNodeId?: string): void {
    this.originNodeId = initialNodeId || (this.nodes.size > 0 ? Array.from(this.nodes.keys())[0] : '');
    this.#originTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /* ---- PRIVATE METHODS ---- */

  /**
   * Generate a unique ID for an edge based on source and target
   * @param source - Source node ID
   * @param target - Target node ID
   * @returns A unique edge ID
   */
  #generateEdgeId(source: string, target: string): string {
    return `e_${source}_${target}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Get the IDs of all nodes that have edges to the specified node
   * @param nodeId - The ID of the node to get previous nodes for
   * @returns Array of node IDs that have edges to the specified node
   */
  #getPrevNodeIds(nodeId: string): string[] {
    return this.getSourceNodes(nodeId);
  }

  /**
   * Get an edge between source and target nodes
   * @param sourceNodeId - The source node ID
   * @param targetNodeId - The target node ID
   * @returns The edge or undefined if not found
   */
  #getEdge(sourceNodeId: string, targetNodeId: string): Edge | undefined {
    const edge = this.getFirstEdgeBetween(sourceNodeId, targetNodeId);
    if (!edge) return undefined;

    return this.convertToEdge(edge);
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
      if (shouldZoomOut(this.#originTransform, canvasWidth, canvasHeight)) {
        // Get the first incoming edge to the reference node
        const prevNodeId = this.#getPrevNodeIds(this.originNodeId)[0];
        if (!prevNodeId) return false;

        // Get the edge from previous node to current node
        const edge = this.#getEdge(prevNodeId, this.originNodeId);
        if (!edge) return false;

        // Apply the backward shift to maintain visual state
        this.#unshiftOrigin(edge);
        return true;
      }
    } else if (!isZoomingOut && shouldZoomIn) {
      // Get all outgoing edges from the reference node
      const edges = this.getEdgesFrom(this.originNodeId);

      // Find the first node that covers the screen
      for (const edge of edges) {
        const nodeId = edge.target;
        // Calculate the combined transform
        const combinedTransform = this.#originTransform.multiply(edge.data);
        if (shouldZoomIn(combinedTransform, canvasWidth, canvasHeight, nodeId)) {
          // Convert to our Edge type for shiftOrigin
          const ourEdge = this.convertToEdge(edge);

          // Apply the forward shift to maintain visual state
          this.#shiftOrigin(ourEdge);
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
    this.originNodeId = edge.target;

    // 1. We combine current viewport with the edge transform
    // 2. This becomes our new viewport transform

    // Why this works:
    // - Before: viewport * edge = how target node appears
    // - After: new target node is at origin (0,0)
    // - So new viewport must equal: viewport * edge
    this.#originTransform = this.#originTransform.multiply(edge.transform);
  }

  /**
   * Shift the origin back to a previous node by following an edge in reverse
   * @param edge - The edge connecting new reference node to the current reference node
   */
  #unshiftOrigin(edge: Edge): void {
    // When shifting origin backwards, we need to apply the inverse of the edge transform

    // Update reference node to the source of the edge
    this.originNodeId = edge.source;

    // 1. Calculate the inverse of the edge transform
    const inverseEdgeTransform = edge.transform.inverse();

    // 2. Multiply current viewport by the inverse transform
    // This undoes the effect of the edge transform

    // Why this works:
    // - Before: viewport shows current reference node
    // - After: we want to see from previous node's perspective
    // - So we apply the inverse transform: viewport * edge⁻¹
    this.#originTransform = this.#originTransform.multiply(inverseEdgeTransform);
  }
}
