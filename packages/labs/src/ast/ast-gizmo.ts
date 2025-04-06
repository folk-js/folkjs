import { FolkElement } from '@folkjs/canvas/folk-element';
import { namedTypes as t } from 'ast-types';

export type GizmoDisplayMode = 'inline' | 'block';

export class ASTGizmo extends FolkElement {
  #onChange?: () => void;
  protected node!: t.Node;
  static displayMode: GizmoDisplayMode = 'inline';
  #isSetup = false;

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

  // Ensure UI is set up
  private ensureUI() {
    if (!this.#isSetup && this.isConnected) {
      this.setupUI();
      this.#isSetup = true;
    }
  }

  // Update with new AST node and onChange handler
  updateNode(node: t.Node, onChange: () => void) {
    this.node = node;
    this.#onChange = onChange;

    // Ensure UI is set up before updating
    this.ensureUI();

    // Only update if UI is ready
    if (this.#isSetup) {
      this.update();
    }
  }

  // Called when the element is connected to the DOM
  public override connectedCallback() {
    super.connectedCallback?.();

    // Set up UI if we have a node
    if (this.node) {
      this.ensureUI();
      if (this.#isSetup) {
        this.update();
      }
    }
  }


  // Subclasses implement this to set up their UI elements - should only be called once
  protected setupUI() {}

  // Subclasses implement this to update their UI with node data
  protected override update() {}
}
