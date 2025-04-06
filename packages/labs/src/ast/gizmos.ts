import { namedTypes as t } from 'ast-types';
import { uhtml } from '../tags';

export type GizmoStyle = 'inline' | 'block';

export interface Gizmo<T extends t.Node = t.Node> {
  match: (node: t.Node) => node is T;
  render: (
    node: T,
    onChange: () => void,
    dimensions: { width: number; height: number },
    state: Map<string, unknown>,
  ) => HTMLElement;
  style: GizmoStyle;
  lines?: number; // Number of lines for block gizmos (defaults to 1)
}

export const BooleanGizmo: Gizmo<t.BooleanLiteral> = {
  style: 'inline',

  match(node): node is t.BooleanLiteral {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  },

  render(node, onChange, dimensions, state): HTMLElement {
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

  render(node, onChange, dimensions, state): HTMLElement {
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

  render(node, onChange, dimensions, state): HTMLElement {
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

  render(node, onChange, dimensions, state): HTMLElement {
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

interface Point2DObject extends t.ObjectExpression {
  properties: Array<
    t.Property & {
      key: t.Identifier;
      value: t.NumericLiteral | t.UnaryExpression;
    }
  >;
}

interface Point2DArrayNode extends t.ArrayExpression {
  elements: Array<Point2DObject>;
}

export const Point2DArrayGizmo: Gizmo<Point2DArrayNode> = {
  style: 'block',
  lines: 5,

  match(node): node is Point2DArrayNode {
    return (
      t.ArrayExpression.check(node) &&
      node.elements.length > 0 &&
      node.elements.every(
        (elem): elem is Point2DObject =>
          t.ObjectExpression.check(elem) &&
          elem.properties.length >= 2 &&
          elem.properties.every(
            (prop): prop is Point2DObject['properties'][0] =>
              t.Property.check(prop) &&
              t.Identifier.check(prop.key) &&
              (prop.key.name === 'x' || prop.key.name === 'y') &&
              ((t.Literal.check(prop.value) && typeof prop.value.value === 'number') ||
                (t.UnaryExpression.check(prop.value) &&
                  prop.value.operator === '-' &&
                  t.Literal.check(prop.value.argument) &&
                  typeof prop.value.argument.value === 'number')),
          ),
      )
    );
  },

  render(node, onChange, dimensions, state): HTMLElement {
    const points = node.elements.map((n) => {
      const xProp = n.properties.find((p) => t.Identifier.check(p.key) && p.key.name === 'x');
      const yProp = n.properties.find((p) => t.Identifier.check(p.key) && p.key.name === 'y');

      const getValue = (
        prop:
          | (t.Property & {
              key: t.Identifier;
              value: t.NumericLiteral | t.UnaryExpression;
            })
          | undefined,
      ): number => {
        if (!prop) return 0;
        const value = prop.value;
        // @ts-expect-error will fix later
        if (t.Literal.check(value)) return value.value as number;
        if (t.UnaryExpression.check(value) && t.Literal.check(value.argument)) {
          return -(value.argument.value as number);
        }
        return 0;
      };

      return {
        x: getValue(xProp),
        y: getValue(yProp),
      };
    });

    const canvas = document.createElement('canvas');

    // Find bounds
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    // Calculate appropriate width based on the data's aspect ratio
    const padding = 10;
    const contentHeight = dimensions.height - padding * 2;
    const contentWidth = (rangeX / rangeY) * contentHeight;
    const totalWidth = contentWidth + padding * 2;

    // Set canvas size (capped at available width)
    canvas.width = Math.min(dimensions.width, totalWidth);
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

    // Calculate scale factors based on available space
    const scaleX = (rect.width - padding * 2) / rangeX;
    const scaleY = (rect.height - padding * 2) / rangeY;

    // Use the same scale factor for both axes to maintain aspect ratio
    const scale = Math.min(scaleX, scaleY);

    // Center the content if there's extra space
    const extraWidth = rect.width - (rangeX * scale + padding * 2);
    const extraHeight = rect.height - (rangeY * scale + padding * 2);
    const offsetX = padding + extraWidth / 2;
    const offsetY = padding + extraHeight / 2;

    function toCanvasCoords(x: number, y: number) {
      return {
        x: offsetX + (x - minX) * scale,
        y: rect.height - (offsetY + (y - minY) * scale),
      };
    }

    function fromCanvasCoords(x: number, y: number) {
      return {
        x: (x - offsetX) / scale + minX,
        y: (rect.height - y - offsetY) / scale + minY,
      };
    }

    function draw() {
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Draw axes
      ctx.strokeStyle = '#666';
      if (minX <= 0 && maxX >= 0) {
        const { x } = toCanvasCoords(0, 0);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rect.height);
        ctx.stroke();
      }
      if (minY <= 0 && maxY >= 0) {
        const { y } = toCanvasCoords(0, 0);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rect.width, y);
        ctx.stroke();
      }

      // Draw points and lines
      if (points.length > 0) {
        ctx.strokeStyle = '#4a9eff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        // Draw main path
        const firstPoint = toCanvasCoords(points[0].x, points[0].y);
        ctx.moveTo(firstPoint.x, firstPoint.y);

        for (let i = 1; i < points.length; i++) {
          const { x, y } = toCanvasCoords(points[i].x, points[i].y);
          ctx.lineTo(x, y);
        }

        // Always close the path if we have at least 3 points
        if (points.length > 2) {
          ctx.lineTo(firstPoint.x, firstPoint.y);
        }

        ctx.stroke();

        // Draw point handles
        ctx.fillStyle = '#4a9eff';
        points.forEach((point) => {
          const { x, y } = toCanvasCoords(point.x, point.y);
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    function updatePoint(index: number, x: number, y: number, isShiftKey: boolean) {
      const point = fromCanvasCoords(x, y);
      const roundedX = isShiftKey ? Math.round(point.x) : Math.round(point.x * 100) / 100;
      const roundedY = isShiftKey ? Math.round(point.y) : Math.round(point.y * 100) / 100;

      const element = node.elements[index];
      const xProp = element.properties.find((p) => t.Identifier.check(p.key) && p.key.name === 'x');
      const yProp = element.properties.find((p) => t.Identifier.check(p.key) && p.key.name === 'y');

      function updateValue(prop: typeof xProp, value: number) {
        if (!prop) return;

        if (value >= 0) {
          // Convert to positive numeric literal
          prop.value = { type: 'NumericLiteral', value };
        } else {
          // Convert to negative unary expression
          prop.value = {
            type: 'UnaryExpression',
            operator: '-',
            argument: { type: 'NumericLiteral', value: -value },
            prefix: true,
          };
        }
      }

      updateValue(xProp, roundedX);
      updateValue(yProp, roundedY);

      points[index] = { x: roundedX, y: roundedY };
      draw();
      onChange();
    }

    let activePointIndex = -1;

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Find closest point
      points.forEach((point, index) => {
        const { x: px, y: py } = toCanvasCoords(point.x, point.y);
        const dist = Math.hypot(x - px, y - py);
        if (dist < 10) {
          activePointIndex = index;
        }
      });

      if (activePointIndex >= 0) {
        updatePoint(activePointIndex, x, y, e.shiftKey);

        const onMove = (e: MouseEvent) => {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          updatePoint(activePointIndex, x, y, e.shiftKey);
        };

        const onUp = () => {
          activePointIndex = -1;
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

interface Matrix2DNode extends t.ObjectExpression {
  properties: Array<
    t.Property & {
      key: t.Identifier;
      value: t.NumericLiteral | t.UnaryExpression;
    }
  >;
}

export const Matrix2DGizmo: Gizmo<Matrix2DNode> = {
  style: 'block',
  lines: 5,

  match(node): node is Matrix2DNode {
    return (
      t.ObjectExpression.check(node) &&
      node.properties.length === 6 &&
      node.properties.every(
        (prop): prop is Matrix2DNode['properties'][0] =>
          t.Property.check(prop) &&
          t.Identifier.check(prop.key) &&
          ['a', 'b', 'c', 'd', 'e', 'f'].includes(prop.key.name) &&
          ((t.Literal.check(prop.value) && typeof prop.value.value === 'number') ||
            (t.UnaryExpression.check(prop.value) &&
              prop.value.operator === '-' &&
              t.Literal.check(prop.value.argument) &&
              typeof prop.value.argument.value === 'number')),
      )
    );
  },

  render(node, onChange, dimensions, state): HTMLElement {
    const matrix = {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
    };

    // Extract values from node
    node.properties.forEach((prop) => {
      if (t.Identifier.check(prop.key)) {
        const key = prop.key.name as keyof typeof matrix;
        if (t.Literal.check(prop.value)) {
          // @ts-expect-error will fix later
          matrix[key] = prop.value.value as number;
        } else if (t.UnaryExpression.check(prop.value) && t.Literal.check(prop.value.argument)) {
          matrix[key] = -(prop.value.argument.value as number);
        }
      }
    });

    const canvas = document.createElement('canvas');
    // Make it square based on height
    canvas.width = dimensions.height;
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

    // Set up the coordinate system
    const padding = 20;
    const scale = Math.min((rect.width - padding * 2) / 2, (rect.height - padding * 2) / 2);
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    function draw() {
      ctx.clearRect(0, 0, rect.width, rect.height);

      // Draw grid
      ctx.strokeStyle = '#eee';
      ctx.lineWidth = 1;

      // Vertical grid lines
      for (let x = -2; x <= 2; x += 0.5) {
        ctx.beginPath();
        const startPoint = transformPoint(x, -2);
        const endPoint = transformPoint(x, 2);
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
      }

      // Horizontal grid lines
      for (let y = -2; y <= 2; y += 0.5) {
        ctx.beginPath();
        const startPoint = transformPoint(-2, y);
        const endPoint = transformPoint(2, y);
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
      }

      // Draw axes
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 2;

      // X axis
      ctx.beginPath();
      const xStart = transformPoint(-2, 0);
      const xEnd = transformPoint(2, 0);
      ctx.moveTo(xStart.x, xStart.y);
      ctx.lineTo(xEnd.x, xEnd.y);
      ctx.stroke();

      // Y axis
      ctx.beginPath();
      const yStart = transformPoint(0, -2);
      const yEnd = transformPoint(0, 2);
      ctx.moveTo(yStart.x, yStart.y);
      ctx.lineTo(yEnd.x, yEnd.y);
      ctx.stroke();

      // Draw unit vectors
      ctx.strokeStyle = '#4a9eff';
      ctx.lineWidth = 3;

      // Unit vector i (1,0)
      const origin = transformPoint(0, 0);
      const unitI = transformPoint(1, 0);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(unitI.x, unitI.y);
      ctx.stroke();

      // Unit vector j (0,1)
      const unitJ = transformPoint(0, 1);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(unitJ.x, unitJ.y);
      ctx.stroke();

      // Draw handles
      ctx.fillStyle = '#4a9eff';
      [origin, unitI, unitJ].forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function transformPoint(x: number, y: number) {
      return {
        x: centerX + scale * (matrix.a * x + matrix.c * y + matrix.e),
        y: centerY + scale * (matrix.b * x + matrix.d * y + matrix.f),
      };
    }

    function inverseTransformPoint(x: number, y: number) {
      // Transform to local coordinates
      x = (x - centerX) / scale;
      y = (y - centerY) / scale;

      // Calculate determinant
      const det = matrix.a * matrix.d - matrix.b * matrix.c;
      if (Math.abs(det) < 1e-6) return { x: 0, y: 0 };

      // Apply inverse transform
      const ix = (matrix.d * (x - matrix.e) - matrix.c * (y - matrix.f)) / det;
      const iy = (-matrix.b * (x - matrix.e) + matrix.a * (y - matrix.f)) / det;

      return { x: ix, y: iy };
    }

    function updateMatrix(newMatrix: typeof matrix) {
      Object.assign(matrix, newMatrix);

      // Update the AST node
      node.properties.forEach((prop) => {
        if (t.Identifier.check(prop.key)) {
          const key = prop.key.name as keyof typeof matrix;
          const value = matrix[key];

          if (value >= 0) {
            prop.value = { type: 'NumericLiteral', value };
          } else {
            prop.value = {
              type: 'UnaryExpression',
              operator: '-',
              argument: { type: 'NumericLiteral', value: -value },
              prefix: true,
            };
          }
        }
      });

      draw();
      onChange();
    }

    let activeHandle: 'origin' | 'i' | 'j' | null = null;
    let lastPoint = { x: 0, y: 0 };

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Check which handle was clicked
      const origin = transformPoint(0, 0);
      const unitI = transformPoint(1, 0);
      const unitJ = transformPoint(0, 1);

      const points = [
        { name: 'origin' as const, point: origin },
        { name: 'i' as const, point: unitI },
        { name: 'j' as const, point: unitJ },
      ];

      for (const { name, point } of points) {
        const dist = Math.hypot(x - point.x, y - point.y);
        if (dist < 10) {
          activeHandle = name;
          lastPoint = { x, y };
          break;
        }
      }

      if (activeHandle) {
        const onMove = (e: MouseEvent) => {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          if (activeHandle === 'origin') {
            // Update translation
            const dx = (x - lastPoint.x) / scale;
            const dy = (y - lastPoint.y) / scale;
            updateMatrix({
              ...matrix,
              e: matrix.e + dx,
              f: matrix.f + dy,
            });
          } else {
            // Update transformation matrix based on new unit vector positions
            const currentPoint = inverseTransformPoint(x, y);
            if (activeHandle === 'i') {
              updateMatrix({
                ...matrix,
                a: currentPoint.x,
                b: currentPoint.y,
              });
            } else if (activeHandle === 'j') {
              updateMatrix({
                ...matrix,
                c: currentPoint.x,
                d: currentPoint.y,
              });
            }
          }

          lastPoint = { x, y };
        };

        const onUp = () => {
          activeHandle = null;
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
