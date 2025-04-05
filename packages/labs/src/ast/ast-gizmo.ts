import { FolkElement } from '@folkjs/canvas/folk-element';
import { namedTypes as t } from 'ast-types';

export type GizmoDisplayMode = 'inline' | 'block';

export class ASTGizmo extends FolkElement {
  #onChange?: () => void;
  #pendingNode?: t.Node;
  protected node!: t.Node;
  static displayMode: GizmoDisplayMode = 'inline';
  #isConnected = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Add basic styles for gizmo container
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: ${(this.constructor as typeof ASTGizmo).displayMode === 'inline' ? 'inline-block' : 'block'};
        ${(this.constructor as typeof ASTGizmo).displayMode === 'inline' ? 'vertical-align: middle;' : ''}
        margin: 0;
      }
    `;
    this.shadowRoot?.appendChild(style);
  }

  // Static pattern matching - each gizmo defines what it matches
  static match(node: t.Node): boolean {
    return false;
  }

  // Signal that we modified the AST
  protected changed() {
    if (this.#onChange) {
      this.#onChange();
    }
  }

  // Update with new AST node and onChange handler
  updateNode(node: t.Node, onChange: () => void) {
    this.node = node;
    this.#onChange = onChange;

    if (this.#isConnected) {
      this.update();
    } else {
      // Save the node for when we connect
      this.#pendingNode = node;
    }
  }

  // Called when the element is connected to the DOM
  public override connectedCallback() {
    super.connectedCallback?.();
    this.setupUI();
    this.#isConnected = true;

    // If we had a pending update, apply it now
    if (this.#pendingNode) {
      this.update();
      this.#pendingNode = undefined;
    }
  }

  // Subclasses implement this to set up their UI elements
  protected setupUI() {}

  // Subclasses implement this to update their UI with node data
  protected override update() {}
}
