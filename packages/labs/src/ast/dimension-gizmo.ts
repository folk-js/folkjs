import { namedTypes as t } from 'ast-types';
import type { GizmoDisplayMode } from './ast-gizmo';
import { ASTGizmo } from './ast-gizmo';

export class DimensionGizmo extends ASTGizmo {
  static override tagName = 'ast-dimension-gizmo';
  static override displayMode: GizmoDisplayMode = 'block';
  #widthInput!: HTMLInputElement;
  #heightInput!: HTMLInputElement;

  protected override setupUI() {
    this.#widthInput = document.createElement('input');
    this.#widthInput.type = 'number';
    this.#widthInput.style.width = '4em';
    this.#widthInput.style.margin = '0 2px';

    this.#heightInput = document.createElement('input');
    this.#heightInput.type = 'number';
    this.#heightInput.style.width = '4em';
    this.#heightInput.style.margin = '0 2px';

    const separator = document.createElement('span');
    separator.textContent = '×';

    this.#widthInput.addEventListener('change', () => {
      const prop = this.getProperty('width');
      if (prop?.value && t.Literal.check(prop.value) && typeof prop.value.value === 'number') {
        prop.value.value = parseFloat(this.#widthInput.value);
        this.changed();
      }
    });

    this.#heightInput.addEventListener('change', () => {
      const prop = this.getProperty('height');
      if (prop?.value && t.Literal.check(prop.value) && typeof prop.value.value === 'number') {
        prop.value.value = parseFloat(this.#heightInput.value);
        console.log('height', prop.value.value);
        this.changed();
      }
    });

    this.shadowRoot?.appendChild(this.#widthInput);
    this.shadowRoot?.appendChild(separator);
    this.shadowRoot?.appendChild(this.#heightInput);
  }

  static override match(node: t.Node): boolean {
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
  }

  protected override update() {
    const widthProp = this.getProperty('width');
    const heightProp = this.getProperty('height');

    if (widthProp?.value && t.Literal.check(widthProp.value) && typeof widthProp.value.value === 'number') {
      this.#widthInput.value = widthProp.value.value.toString();
    }
    if (heightProp?.value && t.Literal.check(heightProp.value) && typeof heightProp.value.value === 'number') {
      this.#heightInput.value = heightProp.value.value.toString();
    }
  }

  private getProperty(name: string): t.Property | undefined {
    const obj = this.node as t.ObjectExpression;
    console.log(obj);
    return obj.properties.find(
      (p) => t.Property.check(p) && t.Identifier.check(p.key) && p.key.name === name,
    ) as t.Property;
  }
}

DimensionGizmo.define();
