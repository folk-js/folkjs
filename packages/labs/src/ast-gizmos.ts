import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import { basicSetup } from 'codemirror';
import { gizmoExtension } from './ast/gizmo-extension';

/**
 * A custom element that displays a CodeMirror editor with AST gizmos.
 * Emits a `change` event when the editor content changes.
 * @example
 * <folk-ast-gizmos value="const x = 1;"></folk-ast-gizmos>
 */
export class ASTGizmos extends FolkElement {
  static override tagName = 'folk-ast-gizmos';
  view: EditorView | null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.view = null;
  }

  override connectedCallback() {
    super.connectedCallback?.();

    const container = document.createElement('div');
    container.style.cssText = 'width: 100%; height: 100%;';
    this.shadowRoot?.appendChild(container);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        border: 1px solid #ddd;
        border-radius: 4px;
        overflow: auto;
        max-height: 40ch;
      }
    `;
    this.shadowRoot?.appendChild(style);

    this.view = new EditorView({
      doc: this.getAttribute('value') || '',
      parent: container,
      extensions: [
        basicSetup,
        javascript(),
        gizmoExtension(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value } }));
          }
        }),
      ],
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.();
    this.view?.destroy();
    this.view = null;
  }

  get value(): string {
    return this.view?.state.doc.toString() || '';
  }

  set value(newValue: string) {
    if (!this.view) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: newValue },
    });
  }
}
