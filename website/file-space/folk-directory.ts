import { FolkBaseSet } from '@labs/folk-base-set';
import { css, PropertyValues } from '@lit/reactive-element';
import { state } from '@lit/reactive-element/decorators.js';
import { FolkFile } from './folk-file.ts';

FolkFile.define();

declare global {
  interface HTMLElementTagNameMap {
    'folk-directory': FolkDirectory;
  }
}

export class FolkDirectory extends FolkBaseSet {
  static tagName = 'folk-directory';

  static styles = css`
    :host {
      position: absolute;
      inset: 0;
    }

    div {
      position: absolute;
      border: 2px dashed #64595961;
      border-radius: 5px;

      span {
        font-family: monospace;
        font-size: 2rem;
        position: absolute;
        bottom: 100%;
        left: -2px;
        border: 2px dashed #64595961;
        border-bottom: 0;
        border-radius: 5px;
        padding: 0.25rem;
      }
    }
  `;

  @state() directoryHandle: FileSystemDirectoryHandle | null = null;

  get name() {
    return this.directoryHandle?.name || '';
  }

  #container = document.createElement('div');
  #displayName = document.createElement('span');

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#container.appendChild(this.#displayName);

    root.prepend(this.#container);

    return root;
  }

  override async update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (changedProperties.has('directoryHandle')) {
      // TODO: handle cancellation
      this.textContent = '';

      if (this.directoryHandle === null) return;

      this.#displayName.textContent = `/${this.name}`;

      for await (const fileHandle of this.directoryHandle.values()) {
        if (fileHandle instanceof FileSystemDirectoryHandle) {
          console.warn('Nested directories are supported yet.');
          continue;
        }

        const file = document.createElement('folk-file');

        file.directory = this.name;
        file.fileHandle = fileHandle;

        const shape = document.createElement('folk-shape');

        // need a better layout
        shape.x = Math.floor(Math.random() * 1000);
        shape.y = Math.floor(Math.random() * 1000);

        shape.appendChild(file);

        this.appendChild(shape);
      }
    }

    if (this.sourcesMap.size !== this.sourceElements.size) {
      this.#container.style.display = 'none';
      return;
    }

    this.#container.style.display = '';

    const rects = this.sourceRects;

    const top = Math.min.apply(
      null,
      rects.map((rect) => rect.top),
    );
    const right = Math.max.apply(
      null,
      rects.map((rect) => rect.right),
    );
    const bottom = Math.max.apply(
      null,
      rects.map((rect) => rect.bottom),
    );
    const left = Math.min.apply(
      null,
      rects.map((rect) => rect.left),
    );

    const padding = 10;

    this.#container.style.top = `${top - padding}px`;
    this.#container.style.left = `${left - padding}px`;
    this.#container.style.height = `${bottom - top + padding}px`;
    this.#container.style.width = `${right - left + padding}px`;
  }
}
