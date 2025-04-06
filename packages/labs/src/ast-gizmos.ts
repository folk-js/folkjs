import { javascript } from '@codemirror/lang-javascript';
import { type Extension, RangeSet, StateEffect, type StateEffectType, StateField } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import { FolkElement } from '@folkjs/canvas/folk-element';
import type { namedTypes } from 'ast-types';
import { basicSetup } from 'codemirror';
import { parse, print, visit } from 'recast';
import { BooleanGizmo, DateTimeGizmo, DimensionGizmo, type Gizmo } from './ast/gizmos';

// Registry of available gizmos
const gizmos: Array<Gizmo<any>> = [BooleanGizmo, DimensionGizmo, DateTimeGizmo];

interface GizmoPosition {
  line: number;
  column: number;
}

interface GizmoRange {
  from: number;
  to: number;
  enabled: boolean;
  fromPos: GizmoPosition;
  toPos: GizmoPosition;
}

interface GizmoMatch {
  node: namedTypes.Node;
  gizmo: Gizmo<any>;
  ast: namedTypes.File;
  position: { from: number; to: number };
  view: EditorView;
}

interface GizmoExtension {
  extension: Extension;
  updateGizmos: () => void;
  findGizmoAtPosition: (view: EditorView, pos: number) => ({ gizmo: Gizmo<any> } & GizmoRange) | null;
  gizmoRangesField: StateField<GizmoRange[]>;
  effects: {
    updateGizmos: StateEffectType<GizmoMatch[]>;
    updateGizmoRanges: StateEffectType<Array<Omit<GizmoRange, 'enabled'> & { enabled?: boolean }>>;
    toggleAllGizmosEffect: StateEffectType<boolean>;
    toggleGizmoEffect: StateEffectType<Omit<GizmoRange, 'from' | 'to'>>;
  };
}

// Create a gizmo extension factory
function createGizmoExtension(editor: ASTGizmos): GizmoExtension {
  let editorView: EditorView | null = null;

  // State effects for gizmo operations
  const updateGizmos = StateEffect.define<GizmoMatch[]>();
  const updateGizmoRanges = StateEffect.define<Array<Omit<GizmoRange, 'enabled'> & { enabled?: boolean }>>();
  const toggleAllGizmosEffect = StateEffect.define<boolean>();
  const toggleGizmoEffect = StateEffect.define<Omit<GizmoRange, 'from' | 'to'>>();

  // Store editor instance in the view state
  const editorInstanceField = StateField.define<ASTGizmos>({
    create() {
      return editor;
    },
    update(value) {
      return value;
    },
  });

  // State field to track gizmo ranges and their enabled state
  const gizmoRangesField = StateField.define<GizmoRange[]>({
    create() {
      return [];
    },
    update(ranges, tr) {
      let newRanges = ranges;

      for (const effect of tr.effects) {
        if (effect.is(updateGizmoRanges)) {
          // Preserve existing enabled states when updating ranges
          newRanges = effect.value.map((range) => {
            const existingRange = ranges.find(
              (r) =>
                r.fromPos.line === range.fromPos.line &&
                r.fromPos.column === range.fromPos.column &&
                r.toPos.line === range.toPos.line &&
                r.toPos.column === range.toPos.column,
            );
            return {
              ...range,
              enabled: range.enabled ?? existingRange?.enabled ?? true,
            };
          });
        } else if (effect.is(toggleAllGizmosEffect)) {
          // Toggle all ranges to the specified value
          newRanges = ranges.map((range) => ({ ...range, enabled: effect.value }));
        } else if (effect.is(toggleGizmoEffect)) {
          // Toggle only the specified range, preserving others
          newRanges = ranges.map((range) =>
            range.fromPos.line === effect.value.fromPos.line &&
            range.fromPos.column === effect.value.fromPos.column &&
            range.toPos.line === effect.value.toPos.line &&
            range.toPos.column === effect.value.toPos.column
              ? { ...range, enabled: effect.value.enabled }
              : range,
          );
        }
      }
      return newRanges;
    },
  });

  // State field to track gizmo matches for reference
  const gizmoMatchesField = StateField.define<{
    matches: GizmoMatch[];
  }>({
    create() {
      return { matches: [] };
    },
    update(state, tr) {
      for (const effect of tr.effects) {
        if (effect.is(updateGizmos)) {
          return { matches: effect.value };
        }
      }
      return state;
    },
  });

  // Extension to make gizmos atomic
  const atomicGizmos = EditorView.atomicRanges.of((view) => {
    const ranges = view.state.field(gizmoRangesField);
    return RangeSet.of(
      ranges
        .filter((range) => range.enabled)
        .map((range) => {
          const value = {
            eq: () => true,
            startSide: -1,
            endSide: 1,
            mapMode: 0,
            point: false,
            range(from: number, to: number) {
              return { from, to, value: this };
            },
          };
          return { from: range.from, to: range.to, value };
        }),
      true,
    );
  });

  class GizmoWidget extends WidgetType {
    element: HTMLElement | null;
    node: namedTypes.Node;
    gizmo: Gizmo<any>;
    ast: namedTypes.File;
    view: EditorView;

    constructor(node: namedTypes.Node, gizmo: Gizmo<any>, ast: namedTypes.File, view: EditorView) {
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
          const ranges = tr.state.field(gizmoRangesField);
          const widgets = e.value
            .map((match) => {
              // Only create widgets for enabled gizmos
              const range = ranges.find((r) => r.from === match.position.from && r.to === match.position.to);
              if (!range?.enabled) return null;

              const widget = new GizmoWidget(match.node, match.gizmo, match.ast, match.view);

              if (match.gizmo.style === 'inline') {
                return Decoration.replace({
                  widget,
                  side: -1,
                }).range(match.position.from, match.position.to);
              } else {
                const line = match.view.state.doc.lineAt(match.position.from);
                return Decoration.widget({
                  widget,
                  block: true,
                }).range(line.from);
              }
            })
            .filter((dec): dec is { from: number; to: number; value: Decoration } => dec !== null);

          decorations = Decoration.set(widgets, true);
        }
      }
      return decorations;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  // Helper to find gizmo at a given position
  function findGizmoAtPosition(
    view: EditorView,
    pos: number,
  ):
    | ({
        gizmo: Gizmo<any>;
      } & GizmoRange)
    | null {
    const ranges = view.state.field(gizmoRangesField);
    const matches = view.state.field(gizmoMatchesField).matches;

    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      if (pos >= range.from && pos <= range.to) {
        return {
          gizmo: matches[i].gizmo,
          ...range,
        };
      }
    }
    return null;
  }

  // Keyboard shortcut to toggle gizmo at cursor/selection
  const toggleGizmoKeymap = keymap.of([
    {
      key: 'Mod-e',
      run: (view: EditorView) => {
        const selection = view.state.selection.main;
        const gizmoAtStart = findGizmoAtPosition(view, selection.from);
        const gizmoAtEnd = selection.empty ? null : findGizmoAtPosition(view, selection.to);

        // Get all unique gizmos in the selection range
        const gizmosToToggle = new Set<Omit<GizmoRange, 'from' | 'to'>>();
        if (gizmoAtStart)
          gizmosToToggle.add({
            fromPos: gizmoAtStart.fromPos,
            toPos: gizmoAtStart.toPos,
            enabled: !gizmoAtStart.enabled, // Toggle the current state
          });
        if (gizmoAtEnd)
          gizmosToToggle.add({
            fromPos: gizmoAtEnd.fromPos,
            toPos: gizmoAtEnd.toPos,
            enabled: !gizmoAtEnd.enabled, // Toggle the current state
          });

        if (gizmosToToggle.size > 0) {
          // Prepare toggle effects for each gizmo
          const effects = Array.from(gizmosToToggle).map(({ fromPos, toPos, enabled }) =>
            toggleGizmoEffect.of({ fromPos, toPos, enabled }),
          );

          // Dispatch state change and trigger update
          view.dispatch({ effects });

          // Update gizmos
          updateGizmosState();
        }
        return true;
      },
      preventDefault: true,
      stopPropagation: true,
    },
  ]);

  // Function to update gizmos
  function updateGizmosState() {
    if (!editorView) return;
    const view = editorView;
    const existingRanges = view.state.field(gizmoRangesField);

    try {
      const ast = parse(view.state.doc.toString());
      const matches: GizmoMatch[] = [];
      const newRanges: GizmoRange[] = [];

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
              const position = {
                from: fromLine.from + node.loc.start.column,
                to: toLine.from + node.loc.end.column,
              };

              // Store line/column positions for stability
              const positionWithLineCol = {
                ...position,
                fromPos: { line: node.loc.start.line, column: node.loc.start.column },
                toPos: { line: node.loc.end.line, column: node.loc.end.column },
              };

              // Find existing range to preserve enabled state by matching line/column
              const existingRange = existingRanges.find(
                (r) =>
                  r.fromPos.line === positionWithLineCol.fromPos.line &&
                  r.fromPos.column === positionWithLineCol.fromPos.column &&
                  r.toPos.line === positionWithLineCol.toPos.line &&
                  r.toPos.column === positionWithLineCol.toPos.column,
              );

              matches.push({
                node,
                gizmo,
                ast,
                position,
                view,
              });

              newRanges.push({
                ...positionWithLineCol,
                enabled: existingRange?.enabled ?? true,
              });
              break;
            }
          }

          return this.traverse(path);
        },
      });

      // Dispatch effects to update decorations and atomic ranges
      view.dispatch({
        effects: [
          updateGizmos.of(matches), // Send all matches, filtering happens in gizmoField
          updateGizmoRanges.of(newRanges),
        ],
      });
    } catch (error) {
      // On error, preserve existing ranges but clear decorations
      // This ensures ranges and their enabled states persist through parse errors
      view.dispatch({
        effects: [
          updateGizmos.of([]), // Clear decorations temporarily
          updateGizmoRanges.of(existingRanges), // Preserve existing ranges and their states
        ],
      });
    }
  }

  // Return all the extensions needed for gizmo functionality
  return {
    extension: [
      editorInstanceField,
      gizmoRangesField,
      gizmoMatchesField,
      atomicGizmos,
      gizmoField,
      toggleGizmoKeymap,
      EditorView.updateListener.of((update) => {
        if (!editorView) editorView = update.view;
        if (update.docChanged) {
          updateGizmosState();
        }
      }),
    ],
    updateGizmos: updateGizmosState,
    findGizmoAtPosition,
    gizmoRangesField,
    effects: {
      updateGizmos,
      updateGizmoRanges,
      toggleAllGizmosEffect,
      toggleGizmoEffect,
    },
  };
}

export class ASTGizmos extends FolkElement {
  static override tagName = 'folk-ast-gizmos';
  view: EditorView | null;
  #gizmoExtension: GizmoExtension | null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.view = null;
    this.#gizmoExtension = null;
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

    // Create gizmo extension
    this.#gizmoExtension = createGizmoExtension(this);

    this.view = new EditorView({
      doc: this.getAttribute('value') || '',
      parent: container,
      extensions: [
        basicSetup,
        javascript(),
        this.#gizmoExtension.extension,
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
    this.#gizmoExtension = null;
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
