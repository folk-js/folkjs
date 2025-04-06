import { namedTypes as t } from 'ast-types';

export type GizmoStyle = 'inline' | 'block';

export interface Gizmo<T extends t.Node = t.Node> {
  match: (node: t.Node) => node is T;
  render: (node: T, onChange: () => void) => HTMLElement;
  style: GizmoStyle;
}

export const BooleanGizmo: Gizmo<t.BooleanLiteral> = {
  style: 'inline',

  match(node: t.Node): node is t.BooleanLiteral {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  },

  render(node: t.BooleanLiteral, onChange: () => void): HTMLElement {
    const container = document.createElement('span');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = node.value;

    checkbox.addEventListener('change', () => {
      node.value = checkbox.checked;
      onChange();
    });

    container.appendChild(checkbox);
    return container;
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

  match(node: t.Node): node is DimensionObject {
    return (
      t.ObjectExpression.check(node) && hasProperty(node, 'width', 'number') && hasProperty(node, 'height', 'number')
    );
  },

  render(node: DimensionObject, onChange: () => void): HTMLElement {
    const container = document.createElement('span');
    const widthInput = document.createElement('input');
    const heightInput = document.createElement('input');
    const separator = document.createElement('span');

    widthInput.type = 'number';
    heightInput.type = 'number';
    widthInput.style.width = '4em';
    heightInput.style.width = '4em';
    widthInput.style.margin = '0 2px';
    heightInput.style.margin = '0 2px';
    separator.textContent = '×';

    const width = getProperty(node, 'width', 'number');
    const height = getProperty(node, 'height', 'number');

    if (width) {
      widthInput.value = width.value.toString();
    }
    if (height) {
      heightInput.value = height.value.toString();
    }

    widthInput.addEventListener('change', () => {
      if (width) {
        width.value = parseFloat(widthInput.value);
        onChange();
      }
    });

    heightInput.addEventListener('change', () => {
      if (height) {
        height.value = parseFloat(heightInput.value);
        onChange();
      }
    });

    container.appendChild(widthInput);
    container.appendChild(separator);
    container.appendChild(heightInput);
    return container;
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
