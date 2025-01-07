import { FolkBaseSet } from '@labs/folk-base-set';
import { css, PropertyValues } from '@lit/reactive-element';
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
      border: 2px solid black;
    }
  `;

  #container = document.createElement('div');
  #directoryHandle: FileSystemDirectoryHandle | null = null;

  get directoryHandle() {
    return this.#directoryHandle;
  }
  set directoryHandle(directoryHandle) {
    this.#directoryHandle = directoryHandle;
    this.#updateDirectory();
  }

  get name() {
    return this.#directoryHandle?.name || '';
  }

  // TODO: handle cancellation
  async #updateDirectory() {
    this.textContent = '';

    if (this.#directoryHandle === null) return;

    for await (const fileHandle of this.#directoryHandle.values()) {
      if (fileHandle instanceof FileSystemDirectoryHandle) {
        console.warn('Nested directories are supported yet.');
        continue;
      }

      const file = document.createElement('folk-file');

      file.name = `${this.name}/${fileHandle.name}`;
      file.fileHandle = fileHandle;

      const shape = document.createElement('folk-shape');

      // need a better layout
      shape.x = Math.floor(Math.random() * 1000);
      shape.y = Math.floor(Math.random() * 1000);

      shape.appendChild(file);

      this.appendChild(shape);
    }
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    root.prepend(this.#container);
    return root;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

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

    const padding = 5;

    this.#container.style.top = `${top - padding}px`;
    this.#container.style.left = `${left - padding}px`;
    this.#container.style.height = `${bottom - top + padding}px`;
    this.#container.style.width = `${right - left + padding}px`;
  }
}
