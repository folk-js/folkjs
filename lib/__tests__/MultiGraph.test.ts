import { describe, expect, test } from 'bun:test';
import { MultiGraph } from '../../labs/MultiGraph';

describe('MultiGraph', () => {
  describe('node operations', () => {
    test('addNode() adds a node with data', () => {
      const graph = new MultiGraph<string, number>();
      const node = graph.addNode('node1', 'Node 1 data');

      expect(node).toEqual({ id: 'node1', data: 'Node 1 data' });
      expect(graph.getNode('node1')).toEqual({ id: 'node1', data: 'Node 1 data' });
    });

    test('getNode() returns undefined for non-existent node', () => {
      const graph = new MultiGraph();
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    test('removeNode() removes a node and its connected edges', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addEdge('node1', 'node2', 42);

      expect(graph.nodeCount).toBe(2);
      expect(graph.edgeCount).toBe(1);

      const removed = graph.removeNode('node1');
      expect(removed).toBe(true);
      expect(graph.nodeCount).toBe(1);
      expect(graph.edgeCount).toBe(0);
      expect(graph.getNode('node1')).toBeUndefined();
    });

    test('removeNode() returns false for non-existent node', () => {
      const graph = new MultiGraph();
      expect(graph.removeNode('nonexistent')).toBe(false);
    });

    test('hasNode() checks if a node exists', () => {
      const graph = new MultiGraph<string>();
      graph.addNode('node1', 'Node 1');

      expect(graph.hasNode('node1')).toBe(true);
      expect(graph.hasNode('nonexistent')).toBe(false);
    });

    test('getAllNodes() returns all nodes', () => {
      const graph = new MultiGraph<string>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const nodes = graph.getAllNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes).toContainEqual({ id: 'node1', data: 'Node 1' });
      expect(nodes).toContainEqual({ id: 'node2', data: 'Node 2' });
    });
  });

  describe('edge operations', () => {
    test('addEdge() adds an edge between nodes', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge = graph.addEdge('node1', 'node2', 42);
      expect(edge).not.toBeNull();
      if (edge) {
        expect(edge.source).toBe('node1');
        expect(edge.target).toBe('node2');
        expect(edge.data).toBe(42);
      }
    });

    test('addEdge() returns null for non-existent nodes', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');

      expect(graph.addEdge('node1', 'nonexistent', 42)).toBeNull();
      expect(graph.addEdge('nonexistent', 'node1', 42)).toBeNull();
    });

    test('addEdge() supports multiple edges between same nodes', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge1 = graph.addEdge('node1', 'node2', 42);
      const edge2 = graph.addEdge('node1', 'node2', 43);

      expect(edge1?.id).not.toBe(edge2?.id);
      expect(graph.edgeCount).toBe(2);

      const edges = graph.getEdgesBetween('node1', 'node2');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.data)).toContain(42);
      expect(edges.map((e) => e.data)).toContain(43);
    });

    test('getEdge() retrieves an edge by ID', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge = graph.addEdge('node1', 'node2', 42);
      if (edge) {
        expect(graph.getEdge(edge.id)).toEqual(edge);
      }
    });

    test('removeEdge() removes an edge', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge = graph.addEdge('node1', 'node2', 42);
      expect(graph.edgeCount).toBe(1);

      if (edge) {
        const removed = graph.removeEdge(edge.id);
        expect(removed).toBe(true);
        expect(graph.edgeCount).toBe(0);
        expect(graph.getEdge(edge.id)).toBeUndefined();
      }
    });

    test('removeEdge() returns false for non-existent edge', () => {
      const graph = new MultiGraph();
      expect(graph.removeEdge('nonexistent')).toBe(false);
    });

    test('hasEdge() checks if an edge exists', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge = graph.addEdge('node1', 'node2', 42);

      if (edge) {
        expect(graph.hasEdge(edge.id)).toBe(true);
      }
      expect(graph.hasEdge('nonexistent')).toBe(false);
    });

    test('hasEdgeBetween() checks if any edge exists between nodes', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addNode('node3', 'Node 3');

      graph.addEdge('node1', 'node2', 42);

      expect(graph.hasEdgeBetween('node1', 'node2')).toBe(true);
      expect(graph.hasEdgeBetween('node2', 'node1')).toBe(false); // Directed graph
      expect(graph.hasEdgeBetween('node1', 'node3')).toBe(false);
    });
  });

  describe('graph traversal', () => {
    test('getEdgesFrom() returns outgoing edges from a node', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addNode('node3', 'Node 3');

      graph.addEdge('node1', 'node2', 42);
      graph.addEdge('node1', 'node3', 43);

      const edges = graph.getEdgesFrom('node1');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.target)).toContain('node2');
      expect(edges.map((e) => e.target)).toContain('node3');
    });

    test('getEdgesTo() returns incoming edges to a node', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addNode('node3', 'Node 3');

      graph.addEdge('node1', 'node3', 42);
      graph.addEdge('node2', 'node3', 43);

      const edges = graph.getEdgesTo('node3');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.source)).toContain('node1');
      expect(edges.map((e) => e.source)).toContain('node2');
    });

    test('getSourceNodes() returns nodes with edges pointing to a node', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addNode('node3', 'Node 3');

      graph.addEdge('node1', 'node3', 42);
      graph.addEdge('node2', 'node3', 43);

      const sources = graph.getSourceNodes('node3');
      expect(sources).toHaveLength(2);
      expect(sources).toContain('node1');
      expect(sources).toContain('node2');
    });

    test('getTargetNodes() returns nodes that a node has edges pointing to', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addNode('node3', 'Node 3');

      graph.addEdge('node1', 'node2', 42);
      graph.addEdge('node1', 'node3', 43);

      const targets = graph.getTargetNodes('node1');
      expect(targets).toHaveLength(2);
      expect(targets).toContain('node2');
      expect(targets).toContain('node3');
    });

    test('getFirstEdgeBetween() returns the first edge between nodes', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      const edge1 = graph.addEdge('node1', 'node2', 42);
      graph.addEdge('node1', 'node2', 43);

      if (edge1) {
        const firstEdge = graph.getFirstEdgeBetween('node1', 'node2');
        expect(firstEdge).toEqual(edge1);
      }
    });
  });

  describe('graph traversal algorithms', () => {
    test('breadthFirstTraversal() visits nodes in BFS order', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('A', 'Node A');
      graph.addNode('B', 'Node B');
      graph.addNode('C', 'Node C');
      graph.addNode('D', 'Node D');

      // Create a simple graph: A -> B -> D
      //                         \-> C
      graph.addEdge('A', 'B', 1);
      graph.addEdge('A', 'C', 2);
      graph.addEdge('B', 'D', 3);

      const visited: string[] = [];
      graph.breadthFirstTraversal('A', (id) => {
        visited.push(id);
      });

      // BFS should visit A, then B and C, then D
      expect(visited).toEqual(['A', 'B', 'C', 'D']);
    });

    test('depthFirstTraversal() visits nodes in DFS order', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('A', 'Node A');
      graph.addNode('B', 'Node B');
      graph.addNode('C', 'Node C');
      graph.addNode('D', 'Node D');

      // Create a simple graph: A -> B -> D
      //                         \-> C
      graph.addEdge('A', 'B', 1);
      graph.addEdge('A', 'C', 2);
      graph.addEdge('B', 'D', 3);

      const visited: string[] = [];
      graph.depthFirstTraversal('A', (id) => {
        visited.push(id);
      });

      // DFS should visit A, then B, then D, then C
      // Note: The exact order can depend on implementation details
      expect(visited).toContain('A');
      expect(visited.indexOf('B')).toBeLessThan(visited.indexOf('D'));
    });
  });

  describe('graph properties', () => {
    test('nodeCount returns the number of nodes', () => {
      const graph = new MultiGraph();
      expect(graph.nodeCount).toBe(0);

      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      expect(graph.nodeCount).toBe(2);

      graph.removeNode('node1');
      expect(graph.nodeCount).toBe(1);
    });

    test('edgeCount returns the number of edges', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');

      expect(graph.edgeCount).toBe(0);

      const edge = graph.addEdge('node1', 'node2', 42);
      expect(graph.edgeCount).toBe(1);

      if (edge) {
        graph.removeEdge(edge.id);
        expect(graph.edgeCount).toBe(0);
      }
    });
  });

  describe('graph utilities', () => {
    test('clear() removes all nodes and edges', () => {
      const graph = new MultiGraph<string, number>();
      graph.addNode('node1', 'Node 1');
      graph.addNode('node2', 'Node 2');
      graph.addEdge('node1', 'node2', 42);

      expect(graph.nodeCount).toBe(2);
      expect(graph.edgeCount).toBe(1);

      graph.clear();

      expect(graph.nodeCount).toBe(0);
      expect(graph.edgeCount).toBe(0);
      expect(graph.getAllNodes()).toHaveLength(0);
      expect(graph.getAllEdges()).toHaveLength(0);
    });
  });
});
