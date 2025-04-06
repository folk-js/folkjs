import { javascript } from '@codemirror/lang-javascript';
import { StateEffect, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, WidgetType } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import type { namedTypes } from 'ast-types';
import { basicSetup, EditorView } from 'codemirror';
import { parse, print } from 'recast';
import type { ASTGizmo } from './ast/ast-gizmo';
import { findGizmoMatches } from './ast/gizmo-visitor';

interface GizmoDecoration {
  from: number;
  to: number;
  element: ASTGizmo;
  displayMode: 'inline' | 'block';
}

const setGizmoDecorations = StateEffect.define<GizmoDecoration[]>();

class GizmoWidget extends WidgetType {
  element: ASTGizmo;
  displayMode: 'inline' | 'block';

  constructor(element: ASTGizmo, displayMode: 'inline' | 'block') {
    super();
    this.element = element;
    this.displayMode = displayMode;
  }

  override toDOM() {
    return this.element;
  }

  override eq(other: GizmoWidget) {
    // Two widgets are equal if they represent the same gizmo element
    return this.element === other.element;
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
        const newDecorations = e.value.map(({ from, to, element, displayMode }) => {
          const widget = new GizmoWidget(element, displayMode);
          return displayMode === 'inline'
            ? Decoration.replace({ widget }).range(from, to)
            : Decoration.widget({ widget, side: -1, block: true }).range(from);
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
  #gizmoElements = new Map<string, ASTGizmo>();

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
    this.#gizmoElements.clear();
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

  private getNodePosition(view: EditorView, node: namedTypes.Node, fallbackLine: number): { from: number; to: number } {
    if (!node.loc) {
      const linePos = view.state.doc.line(fallbackLine);
      return { from: linePos.from, to: linePos.from };
    }

    const fromLine = view.state.doc.line(node.loc.start.line);
    const toLine = view.state.doc.line(node.loc.end.line);
    return {
      from: fromLine.from + node.loc.start.column,
      to: toLine.from + node.loc.end.column,
    };
  }

  private updateGizmos() {
    if (!this.#view) return;

    try {
      // Try to parse the code
      let ast;
      try {
        ast = parse(this.#view.state.doc.toString());
      } catch {
        // If we can't parse, remove all gizmos
        this.#gizmoElements.clear();
        this.#view.dispatch({ effects: setGizmoDecorations.of([]) });
        return;
      }

      const matches = findGizmoMatches(ast);
      if (matches.length === 0) {
        // No matches, remove all gizmos
        this.#gizmoElements.clear();
        this.#view.dispatch({ effects: setGizmoDecorations.of([]) });
        return;
      }

      // Track which gizmos are still in use
      const currentPathIds = new Set<string>();

      // Create or update gizmos and collect their decorations
      const decorations = matches.map(({ node, line, gizmoClass, pathId }) => {
        currentPathIds.add(pathId);

        // Reuse or create gizmo element
        let gizmo = this.#gizmoElements.get(pathId) as ASTGizmo;
        if (!gizmo) {
          gizmo = new gizmoClass();
          this.#gizmoElements.set(pathId, gizmo);
        }

        // Update the gizmo with new node
        gizmo.updateNode(node, () => this.updateFromAST(ast));

        // Calculate position
        const { from, to } = this.getNodePosition(this.#view!, node, line);

        return {
          from,
          to,
          element: gizmo,
          displayMode: gizmoClass.displayMode,
        };
      });

      // Clean up unused gizmos
      for (const [pathId, _] of this.#gizmoElements) {
        if (!currentPathIds.has(pathId)) {
          this.#gizmoElements.delete(pathId);
        }
      }

      // Update decorations with gizmo elements
      this.#view.dispatch({ effects: setGizmoDecorations.of(decorations) });
    } catch (error) {
      console.warn('Failed to update gizmos:', error);
      // On error, remove all gizmos
      this.#gizmoElements.clear();
      this.#view.dispatch({ effects: setGizmoDecorations.of([]) });
    }
  }

  private updateFromAST(ast: ReturnType<typeof parse>) {
    if (!this.#view) return;
    const newCode = print(ast).code;
    this.#view.dispatch({
      changes: { from: 0, to: this.#view.state.doc.length, insert: newCode },
    });
  }
}
