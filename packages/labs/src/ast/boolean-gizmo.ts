import { namedTypes as t } from 'ast-types';
import type { GizmoDisplayMode } from './ast-gizmo';
import { ASTGizmo } from './ast-gizmo';

export class BooleanGizmo extends ASTGizmo {
  static override tagName = 'ast-boolean-gizmo';
  static override displayMode: GizmoDisplayMode = 'inline';
  #checkbox!: HTMLInputElement;

  protected override setupUI() {
    this.#checkbox = document.createElement('input');
    this.#checkbox.type = 'checkbox';

    this.#checkbox.addEventListener('change', () => {
      const node = this.node as t.BooleanLiteral;
      node.value = this.#checkbox.checked;
      this.changed();
    });

    this.shadowRoot?.appendChild(this.#checkbox);
  }

  static override match(node: t.Node): boolean {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  }

  protected override update() {
    console.log('updating boolean gizmo');
    const node = this.node as t.BooleanLiteral;
    this.#checkbox.checked = node.value;
  }
}

BooleanGizmo.define();
