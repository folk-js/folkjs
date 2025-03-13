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
import { BaseEdge, BaseNode, MultiGraph } from './MultiGraph';

/**
 * Node for ShiftingOriginGraph with data property
 */
export interface ZoomNode<T = any> extends BaseNode {
  /** Data associated with the node */
  data: T;
}

/**
 * Edge for ShiftingOriginGraph with transform property
 */
export interface ZoomEdge extends BaseEdge {
  /** Transform matrix defining the spatial relationship */
  transform: DOMMatrix;
}

/**
 * Callback for determining if zooming in should change the reference node
 */
export type ShouldZoomInCallback = (
  combinedTransform: DOMMatrix,
  canvasWidth: number,
  canvasHeight: number,
  nodeId: string,
) => boolean;

/**
 * Callback for determining if zooming out should change the reference node
 */
export type ShouldZoomOutCallback = (originTransform: DOMMatrix, canvasWidth: number, canvasHeight: number) => boolean;

/**
 * Callback for determining if a node should be culled during traversal
 */
export type NodeCullingCallback = (nodeId: string, transform: DOMMatrix, originTransform: DOMMatrix) => boolean;

/**
 * ShiftingOriginGraph - A graph that supports infinite zooming by changing reference frames
 * @template T - The type of data stored in nodes
 */
export class ShiftingOriginGraphv2<T = any> extends MultiGraph<ZoomNode<T>, ZoomEdge> {
  /** ID of the current origin node */
  originNodeId: string;
  /** Transform applied to the viewport */
  #originTransform: DOMMatrix;
  /** Maximum number of nodes to track for visibility */
  #maxNodes = 30;

  /**
   * Create a new ShiftingOriginGraph
   * @param nodes - Array of nodes
   * @param edges - Array of edges
   * @param initialOriginNodeId - The ID of the initial origin node
   * @param maxNodes - Maximum number of nodes to track for visibility
   */
  constructor(nodes: ZoomNode<T>[] = [], edges: ZoomEdge[] = [], initialOriginNodeId?: string, maxNodes?: number) {
    super(); // Initialize the MultiGraph base class

    this.#maxNodes = maxNodes || 30;

    // Add nodes to the graph
    for (const node of nodes) {
      this.addNode(node);
    }

    // Add edges to the graph
    for (const edge of edges) {
      this.addEdge(edge);
    }

    // Use provided initial origin node or default to first node
    this.originNodeId = initialOriginNodeId || (this.nodes.size > 0 ? Array.from(this.nodes.keys())[0] : '');
    this.#originTransform = new DOMMatrix().translate(0, 0).scale(1);
  }

  /**
   * Get the current origin node
   */
  get originNode(): ZoomNode<T> {
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
   * This provides both the node and its transform relative to the origin node
   * @param shouldCullNode - Optional callback to determine if a node should be culled
   * @returns Iterator yielding objects with node, nodeId, and accumulated transform
   */
  *getVisibleNodes(shouldCullNode?: NodeCullingCallback): Generator<{
    nodeId: string;
    node: ZoomNode<T>;
    transform: DOMMatrix;
  }> {
    // Always yield the origin node first with identity transform
    const identityMatrix = new DOMMatrix();
    const originNode = this.getNode(this.originNodeId);

    if (!originNode) return;

    yield {
      nodeId: this.originNodeId,
      node: originNode,
      transform: identityMatrix,
    };

    // Count of nodes yielded so far (including origin node)
    let nodesYielded = 1;

    // Create a queue for breadth-first traversal
    const queue: {
      nodeId: string;
      transform: DOMMatrix;
      depth: number;
    }[] = [];

    // Start with all edges from the origin node
    const edges = this.getEdgesFrom(this.originNodeId);
    for (const edge of edges) {
      // Create a copy of the transform
      const copiedTransform = Matrix.copyDOMMatrix(edge.transform);

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
        const nextTransform = Matrix.copyDOMMatrix(transform).multiply(edge.transform);

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
   * @param canvasWidth - Width of the canvas (used for origin node checking)
   * @param canvasHeight - Height of the canvas (used for origin node checking)
   * @param shouldZoomIn - Optional callback to determine if zooming in should change origin node
   * @param shouldZoomOut - Optional callback to determine if zooming out should change origin node
   * @returns Boolean indicating if the origin node changed
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

    // If we don't have canvas dimensions or callbacks, we can't check for origin node changes
    if (
      canvasWidth === undefined ||
      canvasHeight === undefined ||
      (shouldZoomIn === undefined && shouldZoomOut === undefined)
    ) {
      return false;
    }

    const isZoomingOut = zoomFactor < 1;

    // Check if we're zooming out and need to change origin node
    if (isZoomingOut && shouldZoomOut) {
      // Check if the reference node no longer covers the screen
      if (shouldZoomOut(this.#originTransform, canvasWidth, canvasHeight)) {
        // Get the first incoming edge to the reference node
        const prevNodeIds = this.getSourceNodes(this.originNodeId);
        if (prevNodeIds.length === 0) return false;

        const prevNodeId = prevNodeIds[0];

        // Get the edge from previous node to current node
        const edge = this.getFirstEdgeBetween(prevNodeId, this.originNodeId);
        if (!edge) return false;

        // Apply the backward shift to maintain visual state
        this.#unshiftOrigin(edge);
        return true;
      }
    }
    // Check if we're zooming in and need to change origin node
    else if (!isZoomingOut && shouldZoomIn) {
      // Get all outgoing edges from the reference node
      const edges = this.getEdgesFrom(this.originNodeId);

      // Find the first node that covers the screen
      for (const edge of edges) {
        const nodeId = edge.target;
        // Calculate the combined transform
        const combinedTransform = this.#originTransform.multiply(edge.transform);
        if (shouldZoomIn(combinedTransform, canvasWidth, canvasHeight, nodeId)) {
          // Apply the forward shift to maintain visual state
          this.#shiftOrigin(edge);
          return true;
        }
      }
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

  /**
   * Shift the origin to a new node by following an edge
   * @param edge - The edge connecting current origin node to the new origin node
   */
  #shiftOrigin(edge: ZoomEdge): void {
    // When we change origin nodes, we need to update the viewport transform
    // to keep everything looking the same visually.

    // Update origin node to the target of the edge
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
   * @param edge - The edge connecting new origin node to the current origin node
   */
  #unshiftOrigin(edge: ZoomEdge): void {
    // When shifting origin backwards, we need to apply the inverse of the edge transform

    // Update origin node to the source of the edge
    this.originNodeId = edge.source;

    // 1. Calculate the inverse of the edge transform
    const inverseEdgeTransform = edge.transform.inverse();

    // 2. Multiply current viewport by the inverse transform
    // This undoes the effect of the edge transform

    // Why this works:
    // - Before: viewport shows current origin node
    // - After: we want to see from previous node's perspective
    // - So we apply the inverse transform: viewport * edge⁻¹
    this.#originTransform = this.#originTransform.multiply(inverseEdgeTransform);
  }
}
