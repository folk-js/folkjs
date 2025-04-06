import { namedTypes as t } from 'ast-types';
import { uhtml } from '../tags';

export type GizmoStyle = 'inline' | 'block';

export interface Gizmo<T extends t.Node = t.Node> {
  match: (node: t.Node) => node is T;
  render: (node: T, onChange: () => void) => HTMLElement;
  style: GizmoStyle;
}

export const BooleanGizmo: Gizmo<t.BooleanLiteral> = {
  style: 'inline',

  match(node): node is t.BooleanLiteral {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  },

  render(node, onChange): HTMLElement {
    return uhtml`<input 
      type="checkbox" 
      .checked=${node.value}
      @change=${(e: Event) => {
        if (e.target instanceof HTMLInputElement) {
          node.value = e.target.checked;
          onChange();
        }
      }}
    />`;
  },
};

export const DateTimeGizmo: Gizmo<t.StringLiteral> = {
  style: 'inline',

  match(node): node is t.StringLiteral {
    if (!t.Literal.check(node) || typeof node.value !== 'string') {
      return false;
    }
    // Try to parse the string as a date
    const date = new Date(node.value);
    return !isNaN(date.getTime());
  },

  render(node, onChange): HTMLElement {
    const input = document.createElement('input');
    input.type = 'datetime-local';

    // Convert the string to a datetime-local compatible format
    const date = new Date(node.value);
    input.value = date.toISOString().slice(0, 16); // Format: YYYY-MM-DDThh:mm

    input.addEventListener('change', () => {
      if (input.value) {
        node.value = new Date(input.value).toISOString();
        onChange();
      }
    });

    return input;
  },
};

interface DimensionObject extends t.ObjectExpression {
  properties: Array<
    t.Property & {
      key: t.Identifier;
      value: t.NumericLiteral;
    }
  >;
}

export const DimensionGizmo: Gizmo<DimensionObject> = {
  style: 'inline',

  match(node): node is DimensionObject {
    return (
      t.ObjectExpression.check(node) && hasProperty(node, 'width', 'number') && hasProperty(node, 'height', 'number')
    );
  },

  render(node, onChange): HTMLElement {
    const width = getProperty(node, 'width', 'number');
    const height = getProperty(node, 'height', 'number');

    return uhtml`<span style="display: inline-flex; align-items: center; gap: 2px"><input
        type="number"
        style="width: 4em; margin: 0"
        value=${width?.value ?? ''}
        @change=${(e: Event) => {
          if (width && e.target instanceof HTMLInputElement) {
            width.value = parseFloat(e.target.value);
            onChange();
          }
        }}
      /><span>×</span><input
        type="number"
        style="width: 4em; margin: 0"
        value=${height?.value ?? ''}
        @change=${(e: Event) => {
          if (height && e.target instanceof HTMLInputElement) {
            height.value = parseFloat(e.target.value);
            onChange();
          }
        }}
      /></span>`;
  },
};

/* Gizmo Utils */

type TypeCheck<T> = ((value: any) => value is T) | string;

function checkType<T>(value: any, check: TypeCheck<T>): value is T {
  return typeof check === 'string' ? typeof value === check : check(value);
}

function hasProperty<T extends t.Node>(node: t.ObjectExpression, name: string, check: TypeCheck<T>): boolean {
  return node.properties.some(
    (prop) =>
      t.Property.check(prop) &&
      t.Identifier.check(prop.key) &&
      prop.key.name === name &&
      t.Literal.check(prop.value) &&
      checkType(prop.value.value, check),
  );
}

function hasElement(array: t.ArrayExpression, check: TypeCheck<any>): boolean {
  return array.elements.some((elem) => elem !== null && checkType(elem, check));
}

function getProperty<T>(
  node: t.ObjectExpression,
  name: string,
  check: TypeCheck<T>,
): (t.NumericLiteral & { value: T }) | undefined {
  const prop = node.properties.find(
    (p): p is t.Property & { value: t.NumericLiteral & { value: T } } =>
      t.Property.check(p) &&
      t.Identifier.check(p.key) &&
      p.key.name === name &&
      t.Literal.check(p.value) &&
      checkType(p.value.value, check),
  );
  return prop?.value;
}
