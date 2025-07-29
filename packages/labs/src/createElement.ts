import { ReactiveElement } from '@folkjs/dom/ReactiveElement';

export function createElement(componentFunc: Function): ReactiveElement {
  // Fix kebab-case conversion
  const tagName = componentFunc.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

  // Only define the class if it doesn't exist already
  if (!customElements.get(tagName)) {
    const { params, types } = extractParamsAndTypes(componentFunc);

    class FunctionComponent extends ReactiveElement {
      static override tagName = tagName;

      static override get properties() {
        const properties: Record<string, any> = {};
        params.forEach((param) => {
          properties[param] = {
            type: types[param],
            reflect: true,
          };
        });
        return properties;
      }

      protected override createRenderRoot() {
        return this; // Skip shadow DOM, render to light DOM
      }

      protected override update(changedProperties: Map<string | number | symbol, unknown>) {
        super.update(changedProperties);

        // Build props object from current property values
        const props: Record<string, any> = {};
        params.forEach((param) => {
          props[param] = (this as any)[param];
        });

        // Call the original function and update innerHTML
        const result = componentFunc(props);
        this.innerHTML = result;
      }
    }

    customElements.define(tagName, FunctionComponent);
  }

  // Return a new instance
  return document.createElement(tagName) as ReactiveElement;
}

function extractParamsAndTypes(func: Function): { params: string[]; types: Record<string, any> } {
  const source = func.toString();
  const match = source.match(/\{\s*([^}]*)\s*\}/);

  if (!match) return { params: [], types: {} };

  const params: string[] = [];
  const types: Record<string, any> = {};

  const paramString = match[1];
  const paramDeclarations = paramString.split(',');

  paramDeclarations.forEach((declaration) => {
    const trimmed = declaration.trim();
    if (!trimmed) return;

    if (trimmed.includes('=')) {
      const [name, defaultValue] = trimmed.split('=').map((s) => s.trim());
      params.push(name);

      if (defaultValue === 'true' || defaultValue === 'false') {
        types[name] = Boolean;
      } else if (/^-?\d+(\.\d+)?$/.test(defaultValue)) {
        types[name] = Number;
      } else {
        types[name] = String;
      }
    } else {
      params.push(trimmed);
      types[trimmed] = String;
    }
  });

  return { params, types };
}
