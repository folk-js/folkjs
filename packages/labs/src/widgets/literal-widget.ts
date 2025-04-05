import { WidgetType } from '@codemirror/view';

export class LiteralWidget extends WidgetType {
  #value: any;
  #type: string;

  constructor(value: any, type: string) {
    super();
    this.#value = value;
    this.#type = type;
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-literal-widget';
    wrap.style.padding = '2px 4px';
    wrap.style.backgroundColor = '#f8f8f8';
    wrap.style.borderRadius = '4px';
    wrap.style.margin = '0';
    wrap.style.fontSize = '0.9em';
    wrap.style.fontFamily = 'monospace';
    wrap.style.color = '#666';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'cm-literal-type';
    typeSpan.textContent = this.#type;
    typeSpan.style.color = '#999';
    typeSpan.style.marginRight = '8px';

    const valueSpan = document.createElement('span');
    valueSpan.className = 'cm-literal-value';
    valueSpan.textContent = this.formatValue(this.#value);
    valueSpan.style.color = this.getValueColor(this.#type);

    wrap.appendChild(typeSpan);
    wrap.appendChild(valueSpan);
    return wrap;
  }

  private formatValue(value: any): string {
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.formatValue(v)).join(', ')}]`;
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  private getValueColor(type: string): string {
    switch (type) {
      case 'StringLiteral':
        return '#a31515'; // red for strings
      case 'NumericLiteral':
        return '#098658'; // green for numbers
      case 'BooleanLiteral':
        return '#0000ff'; // blue for booleans
      case 'ArrayExpression':
      case 'ObjectExpression':
        return '#811f3f'; // purple for complex types
      default:
        return '#000000';
    }
  }
}
