import { describe, expect, test } from 'bun:test';
import { BaseEdge, BaseNode, MultiGraph } from '../../labs/MultiGraph';

// Define test node type that extends BaseNode
interface TestNode extends BaseNode {
  data: string;
}

// Define test edge type that extends BaseEdge
interface TestEdge extends BaseEdge {
  data: number;
}

describe('MultiGraph', () => {
  describe('node operations', () => {
    test('addNode() adds a node with data', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      const node: TestNode = { id: 'node1', data: 'Node 1 data' };
      const result = graph.addNode(node);

      expect(result).toEqual({ id: 'node1', data: 'Node 1 data' });
      expect(graph.getNode('node1')).toEqual({ id: 'node1', data: 'Node 1 data' });
    });

    test('getNode() returns undefined for non-existent node', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      expect(graph.getNode('nonexistent')).toBeUndefined();
    });

    test('removeNode() removes a node and its connected edges', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };
      graph.addEdge(edge);

      expect(graph.nodeCount).toBe(2);
      expect(graph.edgeCount).toBe(1);

      const removed = graph.removeNode('node1');
      expect(removed).toBe(true);
      expect(graph.nodeCount).toBe(1);
      expect(graph.edgeCount).toBe(0);
      expect(graph.getNode('node1')).toBeUndefined();
    });

    test('removeNode() returns false for non-existent node', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      expect(graph.removeNode('nonexistent')).toBe(false);
    });

    test('hasNode() checks if a node exists', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });

      expect(graph.hasNode('node1')).toBe(true);
      expect(graph.hasNode('nonexistent')).toBe(false);
    });

    test('getAllNodes() returns all nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const nodes = graph.getAllNodes();
      expect(nodes).toHaveLength(2);
      expect(nodes).toContainEqual({ id: 'node1', data: 'Node 1' });
      expect(nodes).toContainEqual({ id: 'node2', data: 'Node 2' });
    });
  });

  describe('edge operations', () => {
    test('addEdge() adds an edge between nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };
      const result = graph.addEdge(edge);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.source).toBe('node1');
        expect(result.target).toBe('node2');
        expect(result.data).toBe(42);
      }
    });

    test('addEdge() returns null for non-existent nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });

      const edgeToNonExistent: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'nonexistent',
        data: 42,
      };

      const edgeFromNonExistent: TestEdge = {
        id: 'edge2',
        source: 'nonexistent',
        target: 'node1',
        data: 42,
      };

      expect(graph.addEdge(edgeToNonExistent)).toBeNull();
      expect(graph.addEdge(edgeFromNonExistent)).toBeNull();
    });

    test('addEdge() supports multiple edges between same nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node1',
        target: 'node2',
        data: 43,
      };

      const result1 = graph.addEdge(edge1);
      const result2 = graph.addEdge(edge2);

      expect(result1?.id).not.toBe(result2?.id);
      expect(graph.edgeCount).toBe(2);

      const edges = graph.getEdgesBetween('node1', 'node2');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.data)).toContain(42);
      expect(edges.map((e) => e.data)).toContain(43);
    });

    test('getEdge() retrieves an edge by ID', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      const result = graph.addEdge(edge);
      if (result) {
        expect(graph.getEdge(result.id)).toEqual(result);
      }
    });

    test('removeEdge() removes an edge', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      graph.addEdge(edge);
      expect(graph.edgeCount).toBe(1);

      const removed = graph.removeEdge(edge.id);
      expect(removed).toBe(true);
      expect(graph.edgeCount).toBe(0);
      expect(graph.getEdge(edge.id)).toBeUndefined();
    });

    test('removeEdge() returns false for non-existent edge', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      expect(graph.removeEdge('nonexistent')).toBe(false);
    });

    test('hasEdge() checks if an edge exists', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      graph.addEdge(edge);
      expect(graph.hasEdge(edge.id)).toBe(true);
      expect(graph.hasEdge('nonexistent')).toBe(false);
    });

    test('hasEdgeBetween() checks if any edge exists between nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });
      graph.addNode({ id: 'node3', data: 'Node 3' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      graph.addEdge(edge);

      expect(graph.hasEdgeBetween('node1', 'node2')).toBe(true);
      expect(graph.hasEdgeBetween('node2', 'node1')).toBe(false); // Directed graph
      expect(graph.hasEdgeBetween('node1', 'node3')).toBe(false);
    });
  });

  describe('graph traversal', () => {
    test('getEdgesFrom() returns outgoing edges from a node', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });
      graph.addNode({ id: 'node3', data: 'Node 3' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node1',
        target: 'node3',
        data: 43,
      };

      graph.addEdge(edge1);
      graph.addEdge(edge2);

      const edges = graph.getEdgesFrom('node1');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.target)).toContain('node2');
      expect(edges.map((e) => e.target)).toContain('node3');
    });

    test('getEdgesTo() returns incoming edges to a node', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });
      graph.addNode({ id: 'node3', data: 'Node 3' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node3',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node2',
        target: 'node3',
        data: 43,
      };

      graph.addEdge(edge1);
      graph.addEdge(edge2);

      const edges = graph.getEdgesTo('node3');
      expect(edges).toHaveLength(2);
      expect(edges.map((e) => e.source)).toContain('node1');
      expect(edges.map((e) => e.source)).toContain('node2');
    });

    test('getSourceNodes() returns nodes with edges pointing to a node', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });
      graph.addNode({ id: 'node3', data: 'Node 3' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node3',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node2',
        target: 'node3',
        data: 43,
      };

      graph.addEdge(edge1);
      graph.addEdge(edge2);

      const sources = graph.getSourceNodes('node3');
      expect(sources).toHaveLength(2);
      expect(sources).toContain('node1');
      expect(sources).toContain('node2');
    });

    test('getTargetNodes() returns nodes that a node has edges pointing to', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });
      graph.addNode({ id: 'node3', data: 'Node 3' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node1',
        target: 'node3',
        data: 43,
      };

      graph.addEdge(edge1);
      graph.addEdge(edge2);

      const targets = graph.getTargetNodes('node1');
      expect(targets).toHaveLength(2);
      expect(targets).toContain('node2');
      expect(targets).toContain('node3');
    });

    test('getFirstEdgeBetween() returns the first edge between nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge1: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      const edge2: TestEdge = {
        id: 'edge2',
        source: 'node1',
        target: 'node2',
        data: 43,
      };

      graph.addEdge(edge1);
      graph.addEdge(edge2);

      const firstEdge = graph.getFirstEdgeBetween('node1', 'node2');
      expect(firstEdge).toEqual(edge1);
    });
  });

  describe('graph traversal algorithms', () => {
    test('breadthFirstTraversal() visits nodes in BFS order', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'A', data: 'Node A' });
      graph.addNode({ id: 'B', data: 'Node B' });
      graph.addNode({ id: 'C', data: 'Node C' });
      graph.addNode({ id: 'D', data: 'Node D' });

      // Create a simple graph: A -> B -> D
      //                         \-> C
      const edgeAB: TestEdge = { id: 'edge1', source: 'A', target: 'B', data: 1 };
      const edgeAC: TestEdge = { id: 'edge2', source: 'A', target: 'C', data: 2 };
      const edgeBD: TestEdge = { id: 'edge3', source: 'B', target: 'D', data: 3 };

      graph.addEdge(edgeAB);
      graph.addEdge(edgeAC);
      graph.addEdge(edgeBD);

      const visited: string[] = [];
      graph.breadthFirstTraversal('A', (node) => {
        visited.push(node.id);
      });

      // BFS should visit A, then B and C, then D
      expect(visited).toEqual(['A', 'B', 'C', 'D']);
    });

    test('depthFirstTraversal() visits nodes in DFS order', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'A', data: 'Node A' });
      graph.addNode({ id: 'B', data: 'Node B' });
      graph.addNode({ id: 'C', data: 'Node C' });
      graph.addNode({ id: 'D', data: 'Node D' });

      // Create a simple graph: A -> B -> D
      //                         \-> C
      const edgeAB: TestEdge = { id: 'edge1', source: 'A', target: 'B', data: 1 };
      const edgeAC: TestEdge = { id: 'edge2', source: 'A', target: 'C', data: 2 };
      const edgeBD: TestEdge = { id: 'edge3', source: 'B', target: 'D', data: 3 };

      graph.addEdge(edgeAB);
      graph.addEdge(edgeAC);
      graph.addEdge(edgeBD);

      const visited: string[] = [];
      graph.depthFirstTraversal('A', (node) => {
        visited.push(node.id);
      });

      // DFS should visit A, then follow a path to leaf before backtracking
      expect(visited).toContain('A');
      expect(visited.indexOf('B')).toBeLessThan(visited.indexOf('D'));
    });
  });

  describe('graph properties', () => {
    test('nodeCount returns the number of nodes', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      expect(graph.nodeCount).toBe(0);

      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      expect(graph.nodeCount).toBe(2);

      graph.removeNode('node1');
      expect(graph.nodeCount).toBe(1);
    });

    test('edgeCount returns the number of edges', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      expect(graph.edgeCount).toBe(0);

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      graph.addEdge(edge);
      expect(graph.edgeCount).toBe(1);

      graph.removeEdge(edge.id);
      expect(graph.edgeCount).toBe(0);
    });
  });

  describe('graph utilities', () => {
    test('clear() removes all nodes and edges', () => {
      const graph = new MultiGraph<TestNode, TestEdge>();
      graph.addNode({ id: 'node1', data: 'Node 1' });
      graph.addNode({ id: 'node2', data: 'Node 2' });

      const edge: TestEdge = {
        id: 'edge1',
        source: 'node1',
        target: 'node2',
        data: 42,
      };

      graph.addEdge(edge);

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
