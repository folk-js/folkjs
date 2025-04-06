import { namedTypes as t } from 'ast-types';

export type GizmoStyle = 'inline' | 'block';

export interface Gizmo {
  match: (node: t.Node) => boolean;
  render: (node: t.Node, onChange: () => void) => HTMLElement;
  style: GizmoStyle;
}

export const BooleanGizmo: Gizmo = {
  style: 'block',

  match(node: t.Node): boolean {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  },

  render(node: t.Node, onChange: () => void): HTMLElement {
    const container = document.createElement('span');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';

    // Cast node to BooleanLiteral since we know it matches from our predicate
    const boolNode = node as t.BooleanLiteral;
    checkbox.checked = boolNode.value;

    checkbox.addEventListener('change', () => {
      boolNode.value = checkbox.checked;
      onChange();
    });

    container.appendChild(checkbox);
    return container;
  },
};

export const DimensionGizmo: Gizmo = {
  style: 'block',

  match(node: t.Node): boolean {
    if (!t.ObjectExpression.check(node)) return false;

    let hasWidth = false,
      hasHeight = false;
    for (const prop of node.properties) {
      if (!t.Property.check(prop) || !t.Identifier.check(prop.key)) continue;

      if (prop.key.name === 'width' && t.Literal.check(prop.value) && typeof prop.value.value === 'number') {
        hasWidth = true;
      } else if (prop.key.name === 'height' && t.Literal.check(prop.value) && typeof prop.value.value === 'number') {
        hasHeight = true;
      }
    }
    return hasWidth && hasHeight;
  },

  render(node: t.Node, onChange: () => void): HTMLElement {
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

    const obj = node as t.ObjectExpression;
    const getProperty = (name: string): t.Property | undefined => {
      return obj.properties.find(
        (p) => t.Property.check(p) && t.Identifier.check(p.key) && p.key.name === name,
      ) as t.Property;
    };

    const widthProp = getProperty('width');
    const heightProp = getProperty('height');

    if (widthProp?.value && t.Literal.check(widthProp.value) && widthProp.value.value !== null) {
      widthInput.value = widthProp.value.value.toString();
    }
    if (heightProp?.value && t.Literal.check(heightProp.value) && heightProp.value.value !== null) {
      heightInput.value = heightProp.value.value.toString();
    }

    widthInput.addEventListener('input', () => {
      if (widthProp?.value && t.Literal.check(widthProp.value)) {
        widthProp.value.value = parseFloat(widthInput.value);
        onChange();
      }
    });

    heightInput.addEventListener('input', () => {
      if (heightProp?.value && t.Literal.check(heightProp.value)) {
        heightProp.value.value = parseFloat(heightInput.value);
        onChange();
      }
    });

    container.appendChild(widthInput);
    container.appendChild(separator);
    container.appendChild(heightInput);
    return container;
  },
};
