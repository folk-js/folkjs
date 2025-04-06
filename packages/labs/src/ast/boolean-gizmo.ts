import { namedTypes as t } from 'ast-types';
import type { GizmoDisplayMode } from './ast-gizmo';
import { ASTGizmo } from './ast-gizmo';

export class BooleanGizmo extends ASTGizmo {
  static override tagName = 'ast-boolean-gizmo';
  static override displayMode: GizmoDisplayMode = 'inline';
  #checkbox?: HTMLInputElement;

  protected override setupUI() {
    this.#checkbox = document.createElement('input');
    this.#checkbox.type = 'checkbox';

    // We know checkbox exists since we just created it
    const checkbox = this.#checkbox;
    checkbox.addEventListener('change', () => {
      const node = this.node as t.BooleanLiteral;
      node.value = checkbox.checked;
      console.log(node.value);
      this.changed();
    });

    this.shadowRoot?.appendChild(checkbox);
  }

  static override match(node: t.Node): boolean {
    return t.Literal.check(node) && typeof node.value === 'boolean';
  }

  protected override update() {
    if (!this.#checkbox) return;
    const node = this.node as t.BooleanLiteral;
    this.#checkbox.checked = node.value;
  }
}

BooleanGizmo.define();
