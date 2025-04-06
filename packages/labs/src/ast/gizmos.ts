import { namedTypes as t } from 'ast-types';
import { uhtml } from '../tags';

export type GizmoStyle = 'inline' | 'block';

export interface Gizmo<T extends t.Node = t.Node> {
  match: (node: t.Node) => node is T;
  render: (node: T, onChange: () => void, dimensions: { width: number; height: number }) => HTMLElement;
  style: GizmoStyle;
  lines?: number; // Number of lines for block gizmos (defaults to 1)
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

interface NumberArrayNode extends t.ArrayExpression {
  elements: Array<t.NumericLiteral | t.UnaryExpression>;
}

function isNumericLiteral(node: any): node is t.NumericLiteral {
  return t.Literal.check(node) && typeof node.value === 'number';
}

export const NumberArrayGizmo: Gizmo<NumberArrayNode> = {
  style: 'block',
  lines: 5,

  match(node): node is NumberArrayNode {
    return (
      t.ArrayExpression.check(node) &&
      node.elements.length > 0 &&
      node.elements.every(
        (elem): elem is t.NumericLiteral | t.UnaryExpression =>
          isNumericLiteral(elem) ||
          (t.UnaryExpression.check(elem) && elem.operator === '-' && isNumericLiteral(elem.argument)),
      )
    );
  },

  render(node, onChange, dimensions): HTMLElement {
    const values = node.elements.map((n) => {
      if (t.UnaryExpression.check(n) && isNumericLiteral(n.argument)) {
        return -n.argument.value;
      }
      if (isNumericLiteral(n)) {
        return n.value;
      }
      return 0; // fallback that should never happen due to match check
    });

    const canvas = document.createElement('canvas');
    // Set physical size
    const BAR_GAP = 2;
    const BAR_WIDTH = 18; // 20 - BAR_GAP to maintain same total column width
    canvas.width = values.length * BAR_WIDTH + (values.length - 1) * BAR_GAP;
    canvas.height = dimensions.height;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = { width: canvas.width, height: canvas.height };
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    canvas.style.border = '1px solid #ccc';
    canvas.style.borderRadius = '4px';

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const max = Math.max(...values, 0);
    const min = Math.min(...values, 0);
    const range = max - min;

    function draw() {
      ctx.clearRect(0, 0, rect.width, rect.height);
      const scale = rect.height / (range || 1);

      // Calculate zero line position
      const zeroY = rect.height - -min * scale;

      ctx.fillStyle = '#4a9eff';
      values.forEach((value, i) => {
        const height = Math.abs(value) * scale;
        const x = i * (BAR_WIDTH + BAR_GAP);
        if (value >= 0) {
          // Positive bars grow up from zero line
          const y = min < 0 ? zeroY - height : rect.height - height;
          ctx.fillRect(x, y, BAR_WIDTH, height);
        } else {
          // Negative bars grow down from zero line
          const y = min < 0 ? zeroY : rect.height;
          ctx.fillRect(x, y, BAR_WIDTH, height);
        }
      });

      // Draw zero line if we have negative values (drawn last to be on top)
      if (min < 0 && max > 0) {
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(rect.width, zeroY);
        ctx.stroke();
      }
    }

    function updateValue(index: number, y: number, isShiftKey: boolean) {
      const scale = rect.height / (range || 1);
      const newValue = (rect.height - y) / scale + min;
      const roundedValue = isShiftKey ? Math.round(newValue) : Math.round(newValue * 100) / 100;

      const element = node.elements[index];
      if (roundedValue >= 0) {
        // Convert to positive numeric literal
        if (t.UnaryExpression.check(element)) {
          node.elements[index] = { type: 'NumericLiteral', value: roundedValue };
        } else if (isNumericLiteral(element)) {
          element.value = roundedValue;
        }
      } else {
        // Convert to negative unary expression
        if (t.UnaryExpression.check(element)) {
          (element.argument as t.NumericLiteral).value = -roundedValue;
        } else {
          node.elements[index] = {
            type: 'UnaryExpression',
            operator: '-',
            argument: { type: 'NumericLiteral', value: -roundedValue },
            prefix: true,
          };
        }
      }
      values[index] = roundedValue;
      draw();
      onChange();
    }

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const index = Math.floor(x / (BAR_WIDTH + BAR_GAP));
      if (index >= 0 && index < values.length) {
        updateValue(index, y, e.shiftKey);

        const onMove = (e: MouseEvent) => {
          const y = e.clientY - rect.top;
          updateValue(index, y, e.shiftKey);
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
    });

    draw();
    return canvas;
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
