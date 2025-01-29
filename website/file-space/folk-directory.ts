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
    * {
      box-sizing: border-box;
    }

    #container {
      pointer-events: none;
      position: absolute;
      border: dashed rgba(100, 89, 89, 0.8);
      border-width: clamp(2px, calc(((-21.67 * var(--folk-scale)) + 18.75) * 1px), 15px);
      border-radius: 5px;
    }

    #name {
      position: absolute;
      top: clamp(0%, calc(((-1000 * var(--folk-scale)) + 200) * 1%), 50%);
      translate: 0px clamp(-50%, calc(((1000 * var(--folk-scale)) - 200) * 1%), 0px);
      left: 0;
      right: 0;
      padding: 0.25rem;
      font-family: monospace;
      font-weight: bold;
      font-size: clamp(2rem, calc(((-60 * var(--folk-scale)) + 17) * 1rem), 8rem);
      text-align: center;
      z-index: 2;
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

    this.#container.id = 'container';
    this.#displayName.id = 'name';

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

    const padding = 25;

    this.#container.style.top = `${top - padding * 2}px`;
    this.#container.style.left = `${left - padding}px`;
    this.#container.style.height = `${bottom - top + 2 * padding}px`;
    this.#container.style.width = `${right - left + 2 * padding}px`;
  }
}
