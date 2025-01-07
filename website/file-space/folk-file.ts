import { FolkElement } from '@lib';
import { css, PropertyValues } from '@lit/reactive-element';
import { state } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'folk-file': FolkFile;
  }
}

export type FileCreator = (fileName: string, fileExtension: string, content: File) => Element | DocumentFragment;

export class FolkFile extends FolkElement {
  static tagName = 'folk-file';

  static #fileCreators = new Map<string, any>();

  static addFileType(fileTypes: string[], fileCreator: FileCreator) {
    for (const fileType of fileTypes) {
      this.#fileCreators.set(fileType, fileCreator);
    }
  }

  // https://developer.mozilla.org/en-US/docs/Web/HTTP/MIME_types/Common_types
  static {
    // images
    this.addFileType(
      ['apng', 'avif', 'gif', 'jpg', 'jpeg', 'png', 'svg', 'webp'],
      (fileName, fileExtension, content) => {
        const image = document.createElement('img');
        image.src = URL.createObjectURL(content);
        image.alt = `Image of file '${fileName}'`;
        image.setAttribute('file-name', fileName);
        return image;
      },
    );

    this.addFileType(['mp3', 'wav', 'mov'], (fileName, fileExtension, content) => {
      const audio = document.createElement('audio');
      audio.src = URL.createObjectURL(content);
      audio.controls = true;
      audio.volume = 0.25;
      audio.setAttribute('file-name', fileName);
      return audio;
    });

    // videos
    this.addFileType(['mp4', 'oog', 'webm'], (fileName, fileExtension, content) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(content);
      video.controls = true;
      video.volume = 0.25;
      video.setAttribute('file-name', fileName);
      return video;
    });

    this.addFileType(['md'], (fileName, fileExtension, content) => {
      // @ts-ignore
      import('https://cdn.jsdelivr.net/npm/zero-md@3?register');

      const md = document.createElement('zero-md') as any;
      md.src = URL.createObjectURL(content);
      md.setAttribute('file-name', fileName);
      return md;
    });

    // embeds
    // this.addFileType(['pdf'], () => {
    //   // <object type="application/pdf" data="/media/examples/In-CC0.pdf" width="250" height="200"></object>
    // });

    // this.addFileType(['json'], () => {});

    // this.addFileType(['csv'], () => {});
  }

  static styles = css`
    :host {
      display: block;
    }

    span {
      display: inline-block;
      font-family: monospace;
      border: 2px dashed #64595961;
      border-bottom: 0;
    }
  `;

  @state() fileHandle: FileSystemFileHandle | null = null;

  #name = '';
  get name() {
    return this.#name || this.fileHandle?.name || '';
  }
  set name(name) {
    this.#name = name;
  }

  #type = '';
  get type() {
    return this.#type;
  }

  #displayName = document.createElement('span');
  #display = document.createElement('div');

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

    this.#displayName.textContent = `/${this.name}`;

    const fileCreator = FolkFile.#fileCreators.get(this.type);

    if (fileCreator === undefined) {
      console.warn(`File '${this.name}' has to file creator for extension '${this.type}'.`);
      return;
    }

    const file = await this.fileHandle.getFile();

    const element = fileCreator(this.name, this.type, file);

    this.#display.appendChild(element);
  }
}
