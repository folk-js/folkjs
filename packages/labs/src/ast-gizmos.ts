import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import type { namedTypes } from 'ast-types';
import { basicSetup } from 'codemirror';
import { parse, print, visit } from 'recast';
import type { Gizmo } from './ast/gizmos';
import { BooleanGizmo, DimensionGizmo } from './ast/gizmos';

// Registry of available gizmos
const gizmos: Gizmo[] = [BooleanGizmo, DimensionGizmo];

// Single state effect for all gizmo updates
const updateGizmos = StateEffect.define<
  Array<{
    node: namedTypes.Node;
    gizmo: Gizmo;
    ast: namedTypes.File;
    position: {
      from: number;
      to: number;
    };
    view: EditorView;
  }>
>();

class GizmoWidget extends WidgetType {
  element: HTMLElement | null;
  node: namedTypes.Node;
  gizmo: Gizmo;
  ast: namedTypes.File;
  view: EditorView;

  constructor(node: namedTypes.Node, gizmo: Gizmo, ast: namedTypes.File, view: EditorView) {
    super();
    this.element = null;
    this.node = node;
    this.gizmo = gizmo;
    this.ast = ast;
    this.view = view;
  }

  override eq(other: GizmoWidget): boolean {
    return this.node === other.node && this.gizmo === other.gizmo;
  }

  override toDOM(): HTMLElement {
    if (!this.element) {
      this.element = this.gizmo.render(this.node, () => {
        const newCode = print(this.ast).code;
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: newCode },
        });
      });

      // Add styling to ensure proper sizing and prevent overflow
      if (this.gizmo.style === 'block') {
        const lineHeight = this.view.defaultLineHeight;
        this.element.style.cssText = `
          display: block;
          height: ${Math.floor(lineHeight)}px;
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        `;
      }
    }
    return this.element;
  }

  override destroy(): void {
    this.element = null;
  }
}

// Single state field for all gizmo decorations
const gizmoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (const e of tr.effects) {
      if (e.is(updateGizmos)) {
        const widgets = e.value.map(({ node, gizmo, ast, position, view }) => {
          const widget = new GizmoWidget(node, gizmo, ast, view);

          if (gizmo.style === 'inline') {
            return Decoration.replace({ widget }).range(position.from, position.to);
          } else {
            // For block gizmos, find the start of the line containing the node
            const line = view.state.doc.lineAt(position.from);
            return Decoration.widget({
              widget,
              block: true,
              side: -1, // Place above the line
            }).range(line.from); // Place at start of line instead of at node position
          }
        });

        decorations = Decoration.set(widgets, true);
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

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
        gizmoField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            this.updateGizmos();
            this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value } }));
          }
        }),
      ],
    });

    this.updateGizmos();
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

  private updateGizmos() {
    if (!this.view) return;
    const view = this.view;

    try {
      const ast = parse(this.value);
      const matches: Array<{
        node: namedTypes.Node;
        gizmo: Gizmo;
        ast: namedTypes.File;
        position: { from: number; to: number };
        view: EditorView;
      }> = [];

      visit(ast, {
        visitNode(path) {
          const node = path.node;
          if (!node.loc) {
            return this.traverse(path);
          }

          for (const gizmo of gizmos) {
            if (gizmo.match(node)) {
              const fromLine = view.state.doc.line(node.loc.start.line);
              const toLine = view.state.doc.line(node.loc.end.line);
              matches.push({
                node,
                gizmo,
                ast,
                position: {
                  from: fromLine.from + node.loc.start.column,
                  to: toLine.from + node.loc.end.column,
                },
                view,
              });
              break;
            }
          }

          return this.traverse(path);
        },
      });

      this.view.dispatch({ effects: updateGizmos.of(matches) });
    } catch (error) {
      console.error('Failed to update gizmos:', error);
      this.view.dispatch({ effects: updateGizmos.of([]) });
    }
  }
}
