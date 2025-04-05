import { namedTypes as t, visit } from 'ast-types';
import type { NodePath } from 'ast-types/lib/node-path';

import { ASTGizmo } from './ast-gizmo';
import { BooleanGizmo } from './boolean-gizmo';
import { DimensionGizmo } from './dimension-gizmo';

// Add new gizmo classes here
const gizmoClasses = [BooleanGizmo, DimensionGizmo] as const;

export interface GizmoMatch {
  node: t.Node;
  line: number;
  gizmoClass: typeof ASTGizmo;
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
          matches.push({
            node,
            line: node.loc.start.line,
            gizmoClass: GizmoClass,
          });
          break; // Stop after first match
        }
      }

      return this.traverse(path);
    },
  });

  return matches;
}
