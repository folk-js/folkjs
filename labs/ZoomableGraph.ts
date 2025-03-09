/**
 * ZoomableGraph - A system for navigating between connected nodes through zooming
 *
 * This implementation provides a graph-based navigation system that allows users to
 * zoom in and out of nodes, creating a fluid visualization experience for exploring
 * graph structures. Unlike strictly hierarchical systems, this supports arbitrary
 * graph topologies, including cycles, allowing users to zoom through connected nodes
 * in any direction.
 *
 * Core Concepts:
 *
 * 1. Nodes & Edges:
 *    - Nodes represent viewable content with unique IDs
 *    - Edges connect nodes with spatial information (bounds) about how they relate
 *    - Bounds define where a target node appears when viewed from a source node
 *    - The graph can contain cycles, allowing for non-hierarchical exploration
 *
 * 2. Reference Frame:
 *    - At any time, the user is "inside" one node (the reference frame)
 *    - Navigation happens by zooming into connected nodes or out to parent nodes
 *    - The system maintains scale and position continuity during transitions
 *    - Users can potentially zoom in circles through a cyclic graph structure
 *
 * 3. Viewport Management:
 *    - Tracks viewport dimensions, scale, and offset
 *    - Handles zooming with proper focal point preservation
 *    - Manages panning within the current reference frame
 *
 * Navigation Behavior:
 *
 * - Zooming In: When a node connected to the current reference frame completely
 *   fills the viewport, the system transitions to make that node the new reference frame.
 *
 * - Zooming Out: When the entire current reference frame becomes visible in the
 *   viewport, the system transitions back to a parent node.
 *
 * - Coordinate Transformations: The system handles transformations between
 *   screen coordinates, reference frame coordinates, and connected node coordinates.
 *
 * - Visual Continuity: When transitioning between nodes, the system preserves
 *   the visual appearance by calculating appropriate scales and offsets.
 */

// A unique identifier for each node in the graph
type NodeId = string;

// Simple node with ID and data
export interface ZoomNode {
  id: NodeId;
  data: {
    color: string;
    // Could add other properties later
  };
}

// Edge connecting nodes with position/size information
export interface ZoomEdge {
  sourceId: NodeId;
  targetId: NodeId;
  // How the target node appears when viewed from the source node
  // All values are relative (0-1) where:
  // - x,y: position within source node (0,0 is top-left, 1,1 is bottom-right)
  // - width,height: size relative to source node (1,1 would be same size as source)
  bounds: { x: number; y: number; width: number; height: number };
}

export class ZoomableGraph {
  private nodes = new Map<NodeId, ZoomNode>();
  private edges = new Map<string, ZoomEdge>(); // key format: "sourceId->targetId"

  // Current reference frame (the node we're "in")
  private referenceFrameId: NodeId;

  // Viewport properties relative to reference frame
  private viewportScale: number = 1;
  private viewportOffset = { x: 0, y: 0 };

  // Viewport dimensions
  private viewportWidth: number;
  private viewportHeight: number;

  constructor(initialNode: ZoomNode, viewportWidth: number, viewportHeight: number) {
    this.nodes.set(initialNode.id, initialNode);
    this.referenceFrameId = initialNode.id;
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
  }

  // Add a node to the graph
  addNode(node: ZoomNode): void {
    this.nodes.set(node.id, node);
  }

  // Connect two nodes with a defined bounds
  // bounds uses relative coordinates where:
  // - x,y: position within source node (0,0 is top-left, 1,1 is bottom-right)
  // - width,height: size relative to source node (1,1 would be same size as source)
  addEdge(sourceId: NodeId, targetId: NodeId, bounds: { x: number; y: number; width: number; height: number }): void {
    const edge: ZoomEdge = {
      sourceId,
      targetId,
      bounds,
    };
    this.edges.set(`${sourceId}->${targetId}`, edge);
  }

  // Get the current view state
  getViewState() {
    return {
      referenceFrameId: this.referenceFrameId,
      viewportScale: this.viewportScale,
      viewportOffset: { ...this.viewportOffset },
    };
  }

  // Update viewport dimensions
  setViewportDimensions(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  // Core zooming function
  zoom(factor: number, focalPointX: number, focalPointY: number): void {
    // Convert focal point to reference frame coordinates
    const frameFocalX = this.viewportOffset.x + focalPointX / this.viewportScale;
    const frameFocalY = this.viewportOffset.y + focalPointY / this.viewportScale;

    // Apply zoom factor
    const newScale = this.viewportScale * factor;
    this.viewportScale = newScale;

    // Adjust offset to keep focal point stationary on screen
    this.viewportOffset.x = frameFocalX - focalPointX / this.viewportScale;
    this.viewportOffset.y = frameFocalY - focalPointY / this.viewportScale;

    // Check if we need to change reference frame
    this.checkReferenceFrameChange(frameFocalX, frameFocalY);
  }

  // Pan within the current reference frame
  pan(deltaX: number, deltaY: number): void {
    // Convert screen space delta to reference frame space
    this.viewportOffset.x -= deltaX / this.viewportScale;
    this.viewportOffset.y -= deltaY / this.viewportScale;
  }

  // Check if reference frame should change based on viewport coverage
  private checkReferenceFrameChange(focalX: number, focalY: number): void {
    // Find edges where the current reference frame is the source
    const outgoingEdges = this.getOutgoingEdges(this.referenceFrameId);

    for (const edge of outgoingEdges) {
      // Check if focal point is within this edge's bounds
      if (this.pointInBounds(focalX, focalY, edge.bounds)) {
        // Calculate how much of the viewport is covered by the target node
        // Since bounds are in 0-1 relative coordinates, we need to compare
        // the scaled target size to the viewport dimensions
        const targetViewportWidth = edge.bounds.width * this.viewportScale;
        const targetViewportHeight = edge.bounds.height * this.viewportScale;

        // If target node fills the viewport (or is larger), navigate to it
        if (targetViewportWidth >= this.viewportWidth && targetViewportHeight >= this.viewportHeight) {
          this.navigateToNode(edge.targetId, focalX, focalY);
          return;
        }
      }
    }

    // Find edges where the current reference frame is the target
    const incomingEdges = this.getIncomingEdges(this.referenceFrameId);

    // Check if we should zoom out to a parent node
    if (incomingEdges.length > 0) {
      // Calculate how much of the current reference frame is visible
      // In 0-1 coordinates, the entire frame has size 1x1
      const visibleWidth = this.viewportWidth / this.viewportScale;
      const visibleHeight = this.viewportHeight / this.viewportScale;

      // If we can see the entire current node (or more), switch to parent node
      if (visibleWidth >= 1 && visibleHeight >= 1) {
        // Navigate to the first incoming edge's source
        this.navigateToNode(incomingEdges[0].sourceId, focalX, focalY);
      }
    }
  }

  // Navigate to a new reference frame
  private navigateToNode(newFrameId: NodeId, focalX: number, focalY: number): void {
    const currentToNew = this.edges.get(`${this.referenceFrameId}->${newFrameId}`);
    const newToCurrent = this.edges.get(`${newFrameId}->${this.referenceFrameId}`);

    if (currentToNew) {
      // Zoom in: Navigate into a node
      const bounds = currentToNew.bounds;

      // Calculate new scale to maintain visual size
      // Important: This preserves the exact scale ratio between frames
      const newScale = this.viewportScale * bounds.width;

      // Convert focal point to new frame's coordinate system
      const newFocalX = (focalX - bounds.x) / bounds.width;
      const newFocalY = (focalY - bounds.y) / bounds.height;

      // Update reference frame
      this.referenceFrameId = newFrameId;

      // Set scale that maintains visual continuity
      this.viewportScale = newScale;

      // Set offset to maintain focal point position
      this.viewportOffset.x = newFocalX - focalX / newScale;
      this.viewportOffset.y = newFocalY - focalY / newScale;
    } else if (newToCurrent) {
      // Zoom out: Navigate out of a node
      const bounds = newToCurrent.bounds;

      // Calculate new scale to maintain visual size
      const newScale = this.viewportScale / bounds.width;

      // Convert focal point from current frame to new frame
      const newFocalX = bounds.x + focalX * bounds.width;
      const newFocalY = bounds.y + focalY * bounds.height;

      // Update reference frame
      this.referenceFrameId = newFrameId;

      // Set scale that maintains visual continuity
      this.viewportScale = newScale;

      // Set offset to maintain focal point position
      this.viewportOffset.x = newFocalX - focalX / newScale;
      this.viewportOffset.y = newFocalY - focalY / newScale;
    }
  }

  // Utility function to check if a point is within bounds
  private pointInBounds(
    x: number,
    y: number,
    bounds: { x: number; y: number; width: number; height: number },
  ): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
  }

  // Get all edges where sourceId is the source
  private getOutgoingEdges(sourceId: NodeId): ZoomEdge[] {
    const result: ZoomEdge[] = [];

    for (const edge of this.edges.values()) {
      if (edge.sourceId === sourceId) {
        result.push(edge);
      }
    }

    return result;
  }

  // Get all edges where targetId is the target
  private getIncomingEdges(targetId: NodeId): ZoomEdge[] {
    const result: ZoomEdge[] = [];

    for (const edge of this.edges.values()) {
      if (edge.targetId === targetId) {
        result.push(edge);
      }
    }

    return result;
  }

  // Get node bounds in the viewport
  getNodeViewportBounds(nodeId: NodeId): {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  } {
    // Current reference frame is always "full viewport"
    if (nodeId === this.referenceFrameId) {
      return {
        x: -this.viewportOffset.x * this.viewportScale,
        y: -this.viewportOffset.y * this.viewportScale,
        width: this.viewportScale,
        height: this.viewportScale,
        visible: true,
      };
    }

    // Check if there's a direct edge from reference frame to this node
    const edge = this.edges.get(`${this.referenceFrameId}->${nodeId}`);
    if (edge) {
      // The bounds are in 0-1 relative coordinates
      return {
        x: (edge.bounds.x - this.viewportOffset.x) * this.viewportScale,
        y: (edge.bounds.y - this.viewportOffset.y) * this.viewportScale,
        width: edge.bounds.width * this.viewportScale,
        height: edge.bounds.height * this.viewportScale,
        visible: true,
      };
    }

    // Node is not directly connected from the reference frame
    return { x: 0, y: 0, width: 0, height: 0, visible: false };
  }

  // Get a node by ID
  getNode(nodeId: NodeId): ZoomNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get nodes reachable from the current reference frame by following outgoing edges
   * This is useful for rendering a finite number of nodes that are directly or indirectly
   * connected to the current reference frame in the forward direction
   *
   * @param limit Maximum number of nodes to return
   * @returns Array of nodes with their viewport bounds
   */
  getConnectedNodes(limit: number = 10): Array<{
    node: ZoomNode;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
      visible: boolean;
    };
  }> {
    const result: Array<{
      node: ZoomNode;
      bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
        visible: boolean;
      };
    }> = [];

    // Keep track of visited nodes to avoid cycles
    const visited = new Set<NodeId>();
    visited.add(this.referenceFrameId);

    // Queue for breadth-first traversal
    const queue: NodeId[] = [];

    // Start with direct neighbors of the reference frame
    const outgoingEdges = this.getOutgoingEdges(this.referenceFrameId);
    for (const edge of outgoingEdges) {
      queue.push(edge.targetId);
    }

    // Breadth-first traversal of the graph
    while (queue.length > 0 && result.length < limit) {
      const nodeId = queue.shift()!;

      // Skip if we've already visited this node
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      // Add this node to the result
      const node = this.nodes.get(nodeId);
      if (node) {
        const bounds = this.getNodeViewportBounds(nodeId);
        result.push({ node, bounds });

        // If we haven't reached the limit, add this node's neighbors to the queue
        if (result.length < limit) {
          const nextEdges = this.getOutgoingEdges(nodeId);
          for (const edge of nextEdges) {
            if (!visited.has(edge.targetId)) {
              queue.push(edge.targetId);
            }
          }
        }
      }
    }

    return result;
  }
}
