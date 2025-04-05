import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, WidgetType } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import { basicSetup, EditorView } from 'codemirror';
import { parse, print } from 'recast';
import { findGizmoMatches } from './ast/gizmo-visitor';

const addGizmos = StateEffect.define<{ line: number; element: HTMLElement; displayMode: 'inline' | 'block' }[]>();
const clearGizmos = StateEffect.define<null>();

class GizmoWidget extends WidgetType {
  constructor(element: HTMLElement, displayMode: 'inline' | 'block') {
    super();
    this.element = element;
    this.displayMode = displayMode;
  }

  element: HTMLElement;
  displayMode: 'inline' | 'block';

  override toDOM() {
    return this.element;
  }

  override eq(other: GizmoWidget) {
    return this.element === other.element;
  }
}

const gizmoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(addGizmos)) {
        const newDecorations = e.value.map(({ line, element, displayMode }) => {
          const pos = tr.state.doc.line(line).from;
          return Decoration.widget({
            widget: new GizmoWidget(element, displayMode),
            side: displayMode === 'block' ? -1 : 1,
            block: displayMode === 'block',
          }).range(pos);
        });
        decorations = decorations.update({
          add: newDecorations,
          sort: true,
        });
      } else if (e.is(clearGizmos)) {
        decorations = Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class CodeEditorGizmos extends FolkElement {
  static override tagName = 'folk-code-editor';

  #view: EditorView | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback() {
    super.connectedCallback?.();

    // Create a container for the editor
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    this.shadowRoot?.appendChild(container);

    // Add some basic styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        border: 1px solid #ddd;
        border-radius: 4px;
        overflow: hidden;
      }
      .cm-editor {
        height: 100%;
      }
      .cm-scroller {
        font-family: monospace;
      }
    `;
    this.shadowRoot?.appendChild(style);

    // Initialize CodeMirror
    this.#view = new EditorView({
      doc: this.getAttribute('value') || '',
      parent: container,
      extensions: [
        basicSetup,
        javascript(),
        gizmoField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.dispatchEvent(
              new CustomEvent('change', {
                detail: {
                  value: update.state.doc.toString(),
                },
              }),
            );
            // Update gizmos when code changes
            this.updateGizmos();
          }
        }),
      ],
    });

    // Initial gizmos
    this.updateGizmos();
  }

  override disconnectedCallback() {
    super.disconnectedCallback?.();
    this.#view?.destroy();
  }

  get value(): string {
    return this.#view?.state.doc.toString() || '';
  }

  set value(newValue: string) {
    if (this.#view) {
      this.#view.dispatch({
        changes: {
          from: 0,
          to: this.#view.state.doc.length,
          insert: newValue,
        },
      });
      // Update gizmos after setting new value
      this.updateGizmos();
    }
  }

  private updateGizmos() {
    console.log('update gizmos');
    if (!this.#view) return;

    try {
      const code = this.#view.state.doc.toString();
      const ast = parse(code);
      const matches = findGizmoMatches(ast);

      // Create gizmos for each match
      const gizmos = matches.map(({ node, line, gizmoClass }) => {
        const gizmo = new gizmoClass();
        gizmo.updateNode(node, () => {
          // When a gizmo changes the AST, update the editor
          this.updateFromAST(ast);
        });
        return {
          line,
          element: gizmo,
          displayMode: gizmoClass.displayMode,
        };
      });

      this.#view.dispatch({
        effects: addGizmos.of(gizmos),
      });
    } catch (error) {
      console.warn('Failed to update gizmos:', error);
    }
  }

  private updateFromAST(ast: ReturnType<typeof parse>) {
    if (!this.#view) return;

    // Use recast to print the modified AST back to code
    const newCode = print(ast).code;

    this.#view.dispatch({
      changes: {
        from: 0,
        to: this.#view.state.doc.length,
        insert: newCode,
      },
    });
  }
}
