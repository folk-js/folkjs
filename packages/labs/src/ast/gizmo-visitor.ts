import { namedTypes as t, visit } from 'ast-types';
import type { NodePath } from 'ast-types/lib/node-path';

import { ASTGizmo } from './ast-gizmo';
import { generatePathId } from './ast-path';
import { BooleanGizmo } from './boolean-gizmo';
import { DimensionGizmo } from './dimension-gizmo';

// Add new gizmo classes here
const gizmoClasses = [BooleanGizmo, DimensionGizmo] as const;

export interface GizmoMatch {
  node: t.Node;
  line: number;
  gizmoClass: typeof ASTGizmo;
  pathId: string;
}

export function findGizmoMatches(ast: t.Node): GizmoMatch[] {
  const matches: GizmoMatch[] = [];

  visit(ast, {
    visitNode(path: NodePath) {
      const node = path.node;

      // Skip if node has no location info
      if (!node.loc) {
        return this.traverse(path);
      }

      // Check each gizmo class for a match
      for (const GizmoClass of gizmoClasses) {
        if (GizmoClass.match(node)) {
          try {
            const pathId = generatePathId(path);
            console.log('pathId', pathId);
            matches.push({
              node,
              line: node.loc.start.line,
              gizmoClass: GizmoClass,
              pathId,
            });
          } catch (e) {
            // Skip nodes where we can't generate a path ID
            console.warn('Failed to generate path ID for matched node:', e);
          }
          break; // Stop after first match
        }
      }

      return this.traverse(path);
    },
  });

  return matches;
}
