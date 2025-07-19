import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import * as S from '@folkjs/geometry/Shape2D';
import { FolkBaseSet } from './folk-base-set';
import { FolkShape } from './folk-shape';
import { type CellTemplate, FolkSpreadsheet, FolkSpreadSheetCell, templateCells } from './folk-spreadsheet';

FolkShape.define();
FolkSpreadsheet.define();

export class FolkSpaceProjector extends FolkBaseSet {
  static override tagName = 'folk-space-projector';

  static override styles = [
    FolkBaseSet.styles,
    css`
      folk-spreadsheet {
        position: absolute;
        bottom: 15px;
        right: 15px;
        pointer-events: auto;
        box-shadow: 0px 3px 5px 0px rgba(173, 168, 168, 0.6);
      }
    `,
  ];

  #spreadsheet = document.createElement('folk-spreadsheet');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#spreadsheet.style.setProperty('--cell-width', '50px');

    root.append(this.#spreadsheet);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#spreadsheet.addEventListener('propagate', this.#onPropagate);
    this.#spreadsheet.addEventListener('focusin', this.#onFocusin);
    this.#spreadsheet.addEventListener('focusout', this.#onFocusout);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#spreadsheet.removeEventListener('propagate', this.#onPropagate);
    this.#spreadsheet.removeEventListener('focusin', this.#onFocusin);
    this.#spreadsheet.removeEventListener('focusout', this.#onFocusout);
  }

  #lock = false;

  #onPropagate = (event: Event) => {
    const cell = event.target as FolkSpreadSheetCell;

    if (this.#lock && cell.dependencies.length === 0) return;

    const shape = this.sourceElements
      .values()
      .drop(cell.row - 1)
      .find(() => true);

    if (!(shape instanceof FolkShape)) return;

    // beware of infinite event loop
    switch (cell.column) {
      case 'A': {
        shape.x = cell.value;
        return;
      }
      case 'B': {
        shape.y = cell.value;
        return;
      }
      case 'C': {
        shape.width = cell.value;
        return;
      }
      case 'D': {
        shape.height = cell.value;
        return;
      }
      case 'E': {
        shape.rotation = (cell.value * Math.PI) / 180;
        return;
      }
    }
  };

  #onFocusin = (event: Event) => {
    const cell = event.target;

    if (!(cell instanceof FolkSpreadSheetCell)) return;

    const shape = this.sourceElements
      .values()
      .drop(cell.row - 1)
      .find(() => true);

    if (!(shape instanceof FolkShape)) return;

    shape.highlighted = true;
  };

  #onFocusout = (event: Event) => {
    const cell = event.target;

    if (!(cell instanceof FolkSpreadSheetCell)) return;

    const shape = this.sourceElements
      .values()
      .drop(cell.row - 1)
      .find(() => true);

    if (!(shape instanceof FolkShape)) return;

    shape.highlighted = false;
  };

  override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('sourceElements')) {
      const cells: Record<string, CellTemplate> = {};

      let row = 1;
      for (const el of this.sourceElements) {
        if (!(el instanceof FolkShape)) {
          cells[`A${row}`] = { readonly: true };
          cells[`B${row}`] = { readonly: true };
          cells[`C${row}`] = { readonly: true };
          cells[`D${row}`] = { readonly: true };
          cells[`E${row}`] = { readonly: true };
        }
        row++;
      }

      const html = templateCells(this.sourceElements.size, 5, cells);
      this.#spreadsheet.setHTMLUnsafe(html);
    }

    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#lock = true;
    let row = 1;
    for (const el of this.sourceElements) {
      const rect = this.sourcesMap.get(el)!;

      updateCell(this.#spreadsheet.getCell('A', row)!, rect.x);
      updateCell(this.#spreadsheet.getCell('B', row)!, rect.y);
      updateCell(this.#spreadsheet.getCell('C', row)!, rect.width);
      updateCell(this.#spreadsheet.getCell('D', row)!, rect.height);

      if (S.isShape2D(rect)) {
        updateCell(this.#spreadsheet.getCell('E', row)!, (rect.rotation * 180) / Math.PI);
      } else {
        updateCell(this.#spreadsheet.getCell('E', row)!, 0);
      }
      row += 1;
    }

    Promise.resolve().then(() => {
      this.#lock = false;
    });
  }
}

function updateCell(cell: FolkSpreadSheetCell, expression: number) {
  if (cell.dependencies.length) return;

  cell.expression = Math.round(expression);
}
