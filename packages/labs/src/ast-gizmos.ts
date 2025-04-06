import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, WidgetType } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import type { namedTypes } from 'ast-types';
import { basicSetup, EditorView } from 'codemirror';
import { parse, print, visit } from 'recast';
import type { Gizmo } from './ast/gizmos';
import { BooleanGizmo, DimensionGizmo } from './ast/gizmos';

// Registry of available gizmos
const gizmos: Gizmo[] = [BooleanGizmo, DimensionGizmo];

interface GizmoDecoration {
  node: namedTypes.Node;
  gizmo: Gizmo;
  onUpdate: () => void;
  position: {
    startLine: number;
    endLine: number;
    startCol: number;
    endCol: number;
    startChar: number;
    endChar: number;
  };
}

const setGizmoDecorations = StateEffect.define<GizmoDecoration[]>();

class GizmoWidget extends WidgetType {
  node: namedTypes.Node;
  gizmo: Gizmo;
  #element: HTMLElement | null = null;
  #onUpdate: () => void;
  #position: GizmoDecoration['position'];

  constructor(node: namedTypes.Node, gizmo: Gizmo, onUpdate: () => void, position: GizmoDecoration['position']) {
    super();
    this.node = node;
    this.gizmo = gizmo;
    this.#onUpdate = onUpdate;
    this.#position = position;
  }

  override toDOM(view: EditorView) {
    // Create element on first use
    if (!this.#element) {
      this.#element = this.gizmo.render(this.node, this.#onUpdate);

      // For block gizmos, position them with proper column alignment using editor measurements
      if (this.gizmo.style === 'block') {
        const charWidth = view.defaultCharacterWidth;
        const indentWidth = (this.#position.startCol + 2) * charWidth;
        this.#element.style.marginLeft = `${indentWidth}px`;
      }
    }
    return this.#element;
  }

  override eq(other: GizmoWidget) {
    // Two widgets are equal if they represent the same node and gizmo type
    return this.node === other.node && this.gizmo === other.gizmo;
  }

  override destroy() {
    // Let the element be garbage collected
    this.#element = null;
  }
}

const gizmoField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setGizmoDecorations)) {
        const newDecorations = e.value.map(({ node, gizmo, onUpdate, position }) => {
          const widget = new GizmoWidget(node, gizmo, onUpdate, position);
          if (gizmo.style === 'inline') {
            return Decoration.replace({ widget }).range(position.startChar, position.endChar);
          } else {
            // For block gizmos, create a zero-width widget at the start of the line
            const lineStart = tr.state.doc.line(position.startLine).from;
            return Decoration.widget({
              widget,
              side: -1,
              block: true,
            }).range(lineStart);
          }
        });

        // Replace all decorations with the new set
        decorations = Decoration.set(newDecorations, true);
      }
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export class ASTGizmos extends FolkElement {
  static override tagName = 'folk-ast-gizmos';
  #view: EditorView | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback() {
    super.connectedCallback?.();

    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    this.shadowRoot?.appendChild(container);

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        border: 1px solid #ddd;
        border-radius: 4px;
        overflow: hidden;
      }
      .cm-editor { height: 100%; }
      .cm-scroller { font-family: monospace; }
    `;
    this.shadowRoot?.appendChild(style);

    this.#view = new EditorView({
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
    this.#view?.destroy();
    this.#view = null;
  }

  get value(): string {
    return this.#view?.state.doc.toString() || '';
  }

  set value(newValue: string) {
    if (!this.#view) return;
    this.#view.dispatch({
      changes: { from: 0, to: this.#view.state.doc.length, insert: newValue },
    });
  }

  private getNodePosition(view: EditorView, node: namedTypes.Node): GizmoDecoration['position'] | null {
    if (!node.loc) {
      return null;
    }

    const fromLine = view.state.doc.line(node.loc.start.line);
    const toLine = view.state.doc.line(node.loc.end.line);
    const startChar = fromLine.from + node.loc.start.column;
    const endChar = toLine.from + node.loc.end.column;

    return {
      startLine: node.loc.start.line,
      endLine: node.loc.end.line,
      startCol: node.loc.start.column,
      endCol: node.loc.end.column,
      startChar,
      endChar,
    };
  }

  private findGizmoMatches(ast: namedTypes.Node): Array<{ node: namedTypes.Node; gizmo: Gizmo }> {
    const matches: Array<{ node: namedTypes.Node; gizmo: Gizmo }> = [];

    visit(ast, {
      visitNode(path) {
        const node = path.node;

        // Skip if node has no location info
        if (!node.loc) {
          return this.traverse(path);
        }

        // Check each gizmo for a match
        for (const gizmo of gizmos) {
          if (gizmo.match(node)) {
            matches.push({ node, gizmo });
            break; // Stop after first match
          }
        }

        return this.traverse(path);
      },
    });

    return matches;
  }

  private updateGizmos() {
    if (!this.#view) return;

    try {
      // Try to parse the code
      const ast = parse(this.#view.state.doc.toString());
      const matches = this.findGizmoMatches(ast);

      // Create decorations for each match
      const decorations = matches.flatMap(({ node, gizmo }) => {
        const position = this.getNodePosition(this.#view!, node);
        if (!position) return [];

        return [
          {
            node,
            gizmo,
            position,
            onUpdate: () => {
              const newCode = print(ast).code;
              this.#view!.dispatch({
                changes: { from: 0, to: this.#view!.state.doc.length, insert: newCode },
              });
            },
          },
        ];
      });

      // Update decorations - CodeMirror will handle cleanup of old ones
      this.#view.dispatch({ effects: setGizmoDecorations.of(decorations) });
    } catch (error) {
      console.log('Failed to update gizmos: ', error);
      // On error, clear all decorations
      this.#view.dispatch({ effects: setGizmoDecorations.of([]) });
    }
  }
}
