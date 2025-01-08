import { FolkElement } from '@lib';
import { css, PropertyValues } from '@lit/reactive-element';
import { state } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'folk-file': FolkFile;
  }
}

export interface FileCreator<T extends Element = Element> {
  create(file: File): T | Promise<T>;
  destroy?(): void;
  getValue?(element: T): FileSystemWriteChunkType | undefined;
}

export class FolkFile extends FolkElement {
  static tagName = 'folk-file';

  static #fileCreators = new Map<string, FileCreator>();

  static addFileType<T extends Element>(fileTypes: string[], fileCreator: FileCreator<T>) {
    for (const fileType of fileTypes) {
      this.#fileCreators.set(fileType, fileCreator);
    }
  }

  // https://developer.mozilla.org/en-US/docs/Web/HTTP/MIME_types/Common_types
  static {
    // images
    this.addFileType(['apng', 'avif', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp'], {
      create(file) {
        const image = document.createElement('img');
        image.src = URL.createObjectURL(file);
        image.alt = `Image of file '${file.name}'`;
        return image;
      },
    });

    this.addFileType(['mp3', 'wav', 'mov'], {
      create(file) {
        const audio = document.createElement('audio');
        audio.src = URL.createObjectURL(file);
        audio.controls = true;
        audio.volume = 0.25;
        return audio;
      },
    });

    // videos
    this.addFileType(['mp4', 'oog', 'webm'], {
      create(file) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.controls = true;
        video.volume = 0.25;
        return video;
      },
    });

    this.addFileType(['md'], {
      async create(file) {
        await import('./folk-markdown.ts');
        const md = document.createElement('folk-markdown');
        md.value = await file.text();
        return md;
      },
      getValue: (element) => element.value,
    });

    // embeds
    // <object type="application/pdf" data="/media/examples/In-CC0.pdf" width="250" height="200"></object>
    this.addFileType(['pdf'], {
      create(file) {
        const object = document.createElement('object');
        object.type = 'application/pdf';
        object.width = '600';
        object.height = '700';
        object.data = URL.createObjectURL(file);
        return object;
      },
    });

    // this.addFileType(['json'], () => {});

    // this.addFileType(['csv'], () => {});
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      border: 2px dashed #64595961;
      border-radius: 5px;
      overflow: hidden;
      width: min-content;
    }

    :host > span {
      font-family: monospace;
      padding: 0.25rem;
    }
  `;

  @state() fileHandle: FileSystemFileHandle | null = null;

  directory = '';

  get name() {
    return this.fileHandle?.name || '';
  }

  get path() {
    return `/${this.directory}/${this.name}`;
  }

  #type = '';
  get type() {
    return this.#type;
  }

  #displayName = document.createElement('span');
  #display = document.createElement('div');
  #fileCreator: FileCreator | undefined = undefined;

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.append(this.#displayName, this.#display);

    return root;
  }

  override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has('fileHandle')) {
      this.#type = this.fileHandle === null ? '' : /(?:\.([^.]+))?$/.exec(this.name)?.[1] || 'txt';
    }
  }

  override async update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    this.#display.textContent = '';

    if (this.fileHandle === null) return;

    this.#displayName.textContent = this.path;

    this.#fileCreator?.destroy?.();

    this.#fileCreator = FolkFile.#fileCreators.get(this.type);

    if (this.#fileCreator === undefined) {
      console.warn(`File '${this.name}' has to file creator for extension '${this.type}'.`);
      return;
    }

    const file = await this.fileHandle.getFile();

    const element = await this.#fileCreator.create(file);

    this.#display.appendChild(element);
  }

  async save() {
    const content = this.#fileCreator?.getValue?.(this.#display.firstElementChild!);
    console.log(this.name, content);
    if (!this.fileHandle || content === undefined) return;

    const writer = await this.fileHandle.createWritable();
    await writer.write(content);
    await writer.close();
  }
}
