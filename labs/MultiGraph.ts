/**
 * MultiGraph - A directed multigraph is a graph that allows multiple edges between the same nodes
 *
 * Performance characteristics:
 * - Optimised for fast bidirectional traversal (source → target and target → source)
 * - Space complexity: O(|V| + |E|) where |V| is the number of vertices and |E| is the number of edges
 * - Most operations are O(1) or O(k) where k is the number of adjacent edges/nodes
 */

export interface BaseNode {
  id: string;
}

export interface BaseEdge {
  id: string;
  /** ID of the source node */
  source: string;
  /** ID of the target node */
  target: string;
}

export class MultiGraph<N extends BaseNode = BaseNode, E extends BaseEdge = BaseEdge> {
  /** Map of node IDs to node objects - O(1) lookup */
  protected nodes: Map<string, N>;
  /** Map of edge IDs to edge objects - O(1) lookup */
  protected edges: Map<string, E>;

  protected outgoingEdges: Map<string, Map<string, Set<string>>>;

  protected incomingEdges: Map<string, Map<string, Set<string>>>;

  constructor() {
    this.nodes = new Map();
    this.edges = new Map();
    this.outgoingEdges = new Map();
    this.incomingEdges = new Map();
  }

  /**
   * Adds a node to the graph
   * @param node - The node to add
   * @returns The added node
   * @complexity O(1)
   */
  addNode(node: N): N {
    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * Retrieves a node by its ID
   * @param id - The ID of the node to retrieve
   * @returns The node or undefined if not found
   * @complexity O(1)
   */
  getNode(id: string): N | undefined {
    return this.nodes.get(id);
  }

  /**
   * Removes a node and all its connected edges from the graph
   * @param id - The ID of the node to remove
   * @returns True if the node was removed, false if it wasn't found
   * @complexity O(k) where k is the number of edges connected to the node
   */
  removeNode(id: string): boolean {
    if (!this.nodes.has(id)) {
      return false;
    }

    // Remove the node
    this.nodes.delete(id);

    // Remove all outgoing edges
    const outgoing = this.outgoingEdges.get(id);
    if (outgoing) {
      for (const [targetId, edgeIds] of outgoing.entries()) {
        for (const edgeId of edgeIds) {
          this.edges.delete(edgeId);

          // Remove from incoming edges of target
          this.incomingEdges.get(targetId)?.get(id)?.delete(edgeId);
          if (this.incomingEdges.get(targetId)?.get(id)?.size === 0) {
            this.incomingEdges.get(targetId)?.delete(id);
          }
        }
      }
      this.outgoingEdges.delete(id);
    }

    // Remove all incoming edges
    const incoming = this.incomingEdges.get(id);
    if (incoming) {
      for (const [sourceId, edgeIds] of incoming.entries()) {
        for (const edgeId of edgeIds) {
          this.edges.delete(edgeId);

          // Remove from outgoing edges of source
          this.outgoingEdges.get(sourceId)?.get(id)?.delete(edgeId);
          if (this.outgoingEdges.get(sourceId)?.get(id)?.size === 0) {
            this.outgoingEdges.get(sourceId)?.delete(id);
          }
        }
      }
      this.incomingEdges.delete(id);
    }

    return true;
  }

  /**
   * Adds an edge between two nodes
   * @param edge - The edge to add
   * @returns The added edge or null if source or target node doesn't exist
   * @complexity O(1)
   */
  addEdge(edge: E): E | null {
    // Validate source and target nodes exist
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) {
      return null;
    }

    // Store the edge
    this.edges.set(edge.id, edge);

    // Update outgoing edges index
    if (!this.outgoingEdges.has(edge.source)) {
      this.outgoingEdges.set(edge.source, new Map());
    }

    if (!this.outgoingEdges.get(edge.source)!.has(edge.target)) {
      this.outgoingEdges.get(edge.source)!.set(edge.target, new Set());
    }

    this.outgoingEdges.get(edge.source)!.get(edge.target)!.add(edge.id);

    // Update incoming edges index
    if (!this.incomingEdges.has(edge.target)) {
      this.incomingEdges.set(edge.target, new Map());
    }

    if (!this.incomingEdges.get(edge.target)!.has(edge.source)) {
      this.incomingEdges.get(edge.target)!.set(edge.source, new Set());
    }

    this.incomingEdges.get(edge.target)!.get(edge.source)!.add(edge.id);

    return edge;
  }

  /**
   * Retrieves an edge by its ID
   * @param id - The ID of the edge to retrieve
   * @returns The edge or undefined if not found
   * @complexity O(1)
   */
  getEdge(id: string): E | undefined {
    return this.edges.get(id);
  }

  /**
   * Removes an edge from the graph
   * @param id - The ID of the edge to remove
   * @returns True if the edge was removed, false if it wasn't found
   * @complexity O(1)
   */
  removeEdge(id: string): boolean {
    const edge = this.edges.get(id);

    if (!edge) {
      return false;
    }

    // Remove from main edge store
    this.edges.delete(id);

    // Remove from outgoing index
    this.outgoingEdges.get(edge.source)?.get(edge.target)?.delete(id);

    // Clean up empty maps
    if (this.outgoingEdges.get(edge.source)?.get(edge.target)?.size === 0) {
      this.outgoingEdges.get(edge.source)?.delete(edge.target);
    }

    if (this.outgoingEdges.get(edge.source)?.size === 0) {
      this.outgoingEdges.delete(edge.source);
    }

    // Remove from incoming index
    this.incomingEdges.get(edge.target)?.get(edge.source)?.delete(id);

    // Clean up empty maps
    if (this.incomingEdges.get(edge.target)?.get(edge.source)?.size === 0) {
      this.incomingEdges.get(edge.target)?.delete(edge.source);
    }

    if (this.incomingEdges.get(edge.target)?.size === 0) {
      this.incomingEdges.delete(edge.target);
    }

    return true;
  }

  /**
   * Gets all edges originating from a node
   * @param nodeId - The ID of the source node
   * @returns Array of edges from the node
   * @complexity O(k) where k is the number of outgoing edges
   */
  getEdgesFrom(nodeId: string): E[] {
    const result: E[] = [];
    const outgoing = this.outgoingEdges.get(nodeId);

    if (outgoing) {
      for (const [targetId, edgeIds] of outgoing.entries()) {
        for (const edgeId of edgeIds) {
          const edge = this.edges.get(edgeId);
          if (edge) {
            result.push(edge);
          }
        }
      }
    }

    return result;
  }

  /**
   * Gets all edges targeting a node
   * @param nodeId - The ID of the target node
   * @returns Array of edges to the node
   * @complexity O(k) where k is the number of incoming edges
   */
  getEdgesTo(nodeId: string): E[] {
    const result: E[] = [];
    const incoming = this.incomingEdges.get(nodeId);

    if (incoming) {
      for (const [sourceId, edgeIds] of incoming.entries()) {
        for (const edgeId of edgeIds) {
          const edge = this.edges.get(edgeId);
          if (edge) {
            result.push(edge);
          }
        }
      }
    }

    return result;
  }

  /**
   * Gets all edges between two nodes
   * @param sourceId - The ID of the source node
   * @param targetId - The ID of the target node
   * @returns Array of edges between the nodes
   * @complexity O(k) where k is the number of edges between the nodes
   */
  getEdgesBetween(sourceId: string, targetId: string): E[] {
    const result: E[] = [];
    const edgeIds = this.outgoingEdges.get(sourceId)?.get(targetId);

    if (edgeIds) {
      for (const edgeId of edgeIds) {
        const edge = this.edges.get(edgeId);
        if (edge) {
          result.push(edge);
        }
      }
    }

    return result;
  }

  /**
   * Gets the first edge between two nodes, or undefined if none exists
   * @param sourceId - The ID of the source node
   * @param targetId - The ID of the target node
   * @returns The first edge found or undefined
   * @complexity O(1)
   */
  getFirstEdgeBetween(sourceId: string, targetId: string): E | undefined {
    const edgeIds = this.outgoingEdges.get(sourceId)?.get(targetId);
    if (!edgeIds || edgeIds.size === 0) return undefined;

    // Get the first edge ID from the set
    const edgeId = edgeIds.values().next().value;
    return edgeId ? this.edges.get(edgeId) : undefined;
  }

  /**
   * Gets all nodes in the graph
   * @returns Array of all nodes
   * @complexity O(n) where n is the number of nodes
   */
  getAllNodes(): N[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Gets all edges in the graph
   * @returns Array of all edges
   * @complexity O(e) where e is the number of edges
   */
  getAllEdges(): E[] {
    return Array.from(this.edges.values());
  }

  /**
   * Gets IDs of all nodes that have edges pointing to the specified node
   * @param nodeId - The ID of the target node
   * @returns Array of source node IDs
   * @complexity O(1)
   */
  getSourceNodes(nodeId: string): string[] {
    const incoming = this.incomingEdges.get(nodeId);
    return incoming ? Array.from(incoming.keys()) : [];
  }

  /**
   * Gets IDs of all nodes that the specified node has edges pointing to
   * @param nodeId - The ID of the source node
   * @returns Array of target node IDs
   * @complexity O(1)
   */
  getTargetNodes(nodeId: string): string[] {
    const outgoing = this.outgoingEdges.get(nodeId);
    return outgoing ? Array.from(outgoing.keys()) : [];
  }

  /**
   * Checks if a node exists in the graph
   * @param nodeId - The ID of the node to check
   * @returns True if the node exists, false otherwise
   * @complexity O(1)
   */
  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Checks if an edge exists in the graph
   * @param edgeId - The ID of the edge to check
   * @returns True if the edge exists, false otherwise
   */
  hasEdge(edgeId: string): boolean {
    return this.edges.has(edgeId);
  }

  /**
   * Checks if any edge exists between two nodes
   * @param sourceId - The ID of the source node
   * @param targetId - The ID of the target node
   * @returns True if any edge exists, false otherwise
   * @complexity O(1)
   */
  hasEdgeBetween(sourceId: string, targetId: string): boolean {
    const edgeIds = this.outgoingEdges.get(sourceId)?.get(targetId);
    return !!edgeIds && edgeIds.size > 0;
  }

  /**
   * Gets the number of nodes in the graph
   * @returns The number of nodes
   */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Gets the number of edges in the graph
   * @returns The number of edges
   */
  get edgeCount(): number {
    return this.edges.size;
  }

  /**
   * Creates a new edge with a generated ID
   * @param source - Source node ID
   * @param target - Target node ID
   * @returns Null if either node doesn't exist
   * This is a helper method for subclasses to implement their own edge creation
   */
  protected createEdgeWithNodes(source: string, target: string): { id: string; source: string; target: string } | null {
    if (!this.nodes.has(source) || !this.nodes.has(target)) {
      return null;
    }

    return {
      id: this.generateEdgeId(),
      source,
      target,
    };
  }

  /**
   * Performs a breadth-first traversal of the graph
   * @param startNodeId - The ID of the node to start from
   * @param callback - Function to call for each visited node
   * @complexity O(n + e) where n is the number of nodes and e is the number of edges
   */
  breadthFirstTraversal(startNodeId: string, callback: (node: N) => void): void {
    if (!this.nodes.has(startNodeId)) {
      return;
    }

    const visited = new Set<string>();
    const queue: string[] = [startNodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId)) {
        continue;
      }

      visited.add(currentId);
      const node = this.nodes.get(currentId)!;
      callback(node);

      const targetNodeIds = this.getTargetNodes(currentId);
      for (const targetId of targetNodeIds) {
        if (!visited.has(targetId)) {
          queue.push(targetId);
        }
      }
    }
  }

  /**
   * Performs a depth-first traversal of the graph
   * @param startNodeId - The ID of the node to start from
   * @param callback - Function to call for each visited node
   * @complexity O(n + e) where n is the number of nodes and e is the number of edges
   */
  depthFirstTraversal(startNodeId: string, callback: (node: N) => void): void {
    if (!this.nodes.has(startNodeId)) {
      return;
    }

    const visited = new Set<string>();

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) {
        return;
      }

      visited.add(nodeId);
      const node = this.nodes.get(nodeId)!;
      callback(node);

      const targetNodeIds = this.getTargetNodes(nodeId);
      for (const targetId of targetNodeIds) {
        dfs(targetId);
      }
    };

    dfs(startNodeId);
  }

  /**
   * Clears all nodes and edges from the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();
  }

  /**
   * Generates a unique ID for an edge
   * @returns A unique edge ID
   * @protected
   */
  protected generateEdgeId(): string {
    return `e_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
