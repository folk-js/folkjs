import { namedTypes as t, visit } from 'ast-types';
import type { ExpressionKind } from 'ast-types/lib/gen/kinds';
import type { NodePath } from 'ast-types/lib/node-path';

interface LiteralInfo {
  node: t.Node;
  path: NodePath;
  value: any;
  line: number;
  type: string;
}

/**
 * Type guard to check if a node is a literal
 */
function isLiteral(node: t.Node): boolean {
  return (
    t.StringLiteral.check(node) ||
    t.NumericLiteral.check(node) ||
    t.BooleanLiteral.check(node) ||
    // Handle regular Literal type (which might be used for strings/numbers)
    (t.Literal.check(node) && typeof node.value !== 'undefined')
  );
}

/**
 * Type guard to check if a node contains only literal values
 */
function isLiteralContainer(node: t.Node): boolean {
  if (t.ArrayExpression.check(node)) {
    return node.elements.every(
      (el) => el !== null && !t.SpreadElement.check(el) && (isLiteral(el) || isLiteralContainer(el)),
    );
  }

  if (t.ObjectExpression.check(node)) {
    return node.properties.every(
      (prop) =>
        t.ObjectProperty.check(prop) &&
        t.Identifier.check(prop.key) &&
        (isLiteral(prop.value) || isLiteralContainer(prop.value)),
    );
  }

  return false;
}

/**
 * Gets the literal type from a node
 */
function getLiteralType(node: t.Node): string {
  if (t.StringLiteral.check(node)) return 'StringLiteral';
  if (t.NumericLiteral.check(node)) return 'NumericLiteral';
  if (t.BooleanLiteral.check(node)) return 'BooleanLiteral';
  if (t.ArrayExpression.check(node)) return 'ArrayExpression';
  if (t.ObjectExpression.check(node)) return 'ObjectExpression';
  if (t.Literal.check(node)) {
    // Infer type from value for regular Literal nodes
    const type = typeof node.value;
    switch (type) {
      case 'string':
        return 'StringLiteral';
      case 'number':
        return 'NumericLiteral';
      case 'boolean':
        return 'BooleanLiteral';
      default:
        return 'Literal';
    }
  }
  return node.type;
}

/**
 * Gets the literal value from a node
 */
function getLiteralValue(node: t.Node): any {
  if (isLiteral(node)) {
    return (node as any).value;
  }

  if (t.ArrayExpression.check(node)) {
    return node.elements
      .filter((el): el is ExpressionKind => el !== null && !t.SpreadElement.check(el) && t.Expression.check(el))
      .map((el) => getLiteralValue(el));
  }

  if (t.ObjectExpression.check(node)) {
    return node.properties
      .filter((prop): prop is t.ObjectProperty => t.ObjectProperty.check(prop))
      .reduce(
        (obj, prop) => {
          if (t.Identifier.check(prop.key)) {
            obj[prop.key.name] = getLiteralValue(prop.value);
          }
          return obj;
        },
        {} as Record<string, any>,
      );
  }

  throw new Error(`Unsupported node type: ${node.type}`);
}

/**
 * Collects all literal values and literal-containing expressions from an AST
 */
export function collectLiterals(ast: t.Node): LiteralInfo[] {
  const literals: LiteralInfo[] = [];

  visit(ast, {
    visitNode(path: NodePath) {
      const node = path.node;

      // Skip if node has no location info
      if (!node.loc) {
        return this.traverse(path);
      }

      // Check for direct literals
      if (isLiteral(node)) {
        literals.push({
          node,
          path,
          value: getLiteralValue(node),
          line: node.loc.start.line,
          type: getLiteralType(node),
        });
      }
      // Check for arrays/objects containing only literals
      else if (isLiteralContainer(node)) {
        literals.push({
          node,
          path,
          value: getLiteralValue(node),
          line: node.loc.start.line,
          type: getLiteralType(node),
        });
      }

      return this.traverse(path);
    },
  });

  return literals;
}
