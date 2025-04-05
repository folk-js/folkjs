import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import { basicSetup, EditorView } from 'codemirror';
import { parse } from 'recast';
import { collectLiterals } from './ast/literal-finder';
import { LineWidget } from './widgets/line-widget';
import { LiteralWidget } from './widgets/literal-widget';

const addDecoration = StateEffect.define<{ pos: number; content: string }>();
const removeDecorations = StateEffect.define<null>();

const decorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(addDecoration)) {
        decorations = decorations.update({
          add: [
            Decoration.widget({
              widget: new LineWidget(e.value.content),
              side: -1,
            }).range(e.value.pos),
          ],
        });
      } else if (e.is(removeDecorations)) {
        decorations = Decoration.none;
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const addLiteralDecorations = StateEffect.define<{ line: number; value: any; type: string }[]>();
const removeLiteralDecorations = StateEffect.define<null>();

const literalDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(addLiteralDecorations)) {
        const newDecorations = e.value.map(({ line, value, type }) => {
          const pos = tr.state.doc.line(line).from;
          return Decoration.widget({
            widget: new LiteralWidget(value, type),
            side: -1,
          }).range(pos);
        });
        decorations = decorations.update({
          add: newDecorations,
          sort: true,
        });
      } else if (e.is(removeLiteralDecorations)) {
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
      .cm-line-widget {
        padding: 4px 8px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
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
        decorationField,
        literalDecorationField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.dispatchEvent(
              new CustomEvent('change', {
                detail: {
                  value: update.state.doc.toString(),
                },
              }),
            );
            // Update literal decorations when code changes
            this.updateLiteralDecorations();
          }
        }),
      ],
    });

    // Initial literal decorations
    this.updateLiteralDecorations();
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
      // Update literal decorations after setting new value
      this.updateLiteralDecorations();
    }
  }

  addLineDecoration(line: number, content: string) {
    if (!this.#view) return;

    const pos = this.#view.state.doc.line(line).from;
    this.#view.dispatch({
      effects: addDecoration.of({ pos, content }),
    });
  }

  clearDecorations() {
    if (!this.#view) return;

    this.#view.dispatch({
      effects: removeDecorations.of(null),
    });
  }

  private updateLiteralDecorations() {
    if (!this.#view) return;

    try {
      const code = this.#view.state.doc.toString();
      const ast = parse(code);
      const literals = collectLiterals(ast);

      this.#view.dispatch({
        effects: addLiteralDecorations.of(
          literals.map(({ value, line, type }) => ({
            line,
            value,
            type,
          })),
        ),
      });
    } catch (error) {
      console.warn('Failed to update literal decorations:', error);
    }
  }
}
