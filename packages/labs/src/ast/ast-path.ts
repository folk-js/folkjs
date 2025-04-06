import { namedTypes as t } from 'ast-types';
import type { NodePath } from 'ast-types/lib/node-path';

/**
 * Generates a stable path ID for a node in the AST.
 * The path ID is a string that represents the path from the root node to the target node,
 * including array indices and property names, but excluding source positions.
 */
export function generatePathId(path: NodePath): string {
  const segments: string[] = [];
  let current: NodePath | null = path;

  // Handle the current node
  if (current?.node?.type) {
    segments.unshift(current.node.type);
  }

  // Walk up the tree
  while (current) {
    const parentPath: NodePath | null | undefined = current.parentPath;
    // Stop if we've reached the root
    if (!parentPath) break;

    const name = current.name;
    const parentNode = parentPath.node;

    // Skip if we don't have valid parent info
    if (!parentNode || !name) break;

    try {
      // If parent field is an array, include the index
      if (Array.isArray(parentNode[name])) {
        const index = (parentNode[name] as any[]).indexOf(current.node);
        if (index !== -1) {
          segments.unshift(`${name}[${index}]`);
        }
      } else {
        segments.unshift(name);
      }

      // Add parent node type for additional stability
      if (parentNode.type) {
        segments.unshift(parentNode.type);
      }
    } catch (e) {
      // If anything goes wrong accessing properties, stop here
      break;
    }

    current = parentPath;
  }

  // Return the path or 'Program' for root nodes
  if (segments.length === 1 && segments[0] === 'Program') {
    return 'Program';
  }

  if (segments.length === 0) {
    throw new Error('Could not generate path ID for node');
  }

  return segments.join('/');
}
