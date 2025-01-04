import '@labs/standalone/folk-pinch.ts';
import { FolkPinch } from '@labs/standalone/folk-pinch.ts';
import '@labs/standalone/folk-shape.ts';
import { FolkElement } from '@lib';
import { html } from '@lib/tags';
import { css } from '@lit/reactive-element';

export type FileCreator = (fileName: string, fileExtension: string, content: File) => Element | DocumentFragment;

export class FolkFileSpace extends FolkElement {
  static tagName = 'folk-file-space';

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
      position: relative;
    }

    folk-pinch {
      position: absolute;
      inset: 0;
    }

    button {
      position: relative;
      top: 1rem;
      left: 1rem;
    }
  `;

  #pinch!: FolkPinch;

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    root.setHTMLUnsafe(html`
      <folk-pinch grid><slot></slot></folk-pinch>
      <button id="open-directory">Open directory</button>
      <button id="open-file">Open file</button>
    `);

    this.#pinch = root.querySelector('folk-pinch')!;

    root.addEventListener('click', this);

    return root;
  }

  async handleEvent(event: Event) {
    if (!(event.target instanceof HTMLElement)) return;

    switch (event.type) {
      case 'click': {
        if (event.target.id === 'open-directory') {
          // pass in previous opened or active directory.
          const directoryHandle = await window.showDirectoryPicker({
            id: 'file-space',
            startIn: 'documents',
            mode: 'readwrite',
          });

          for await (const fileHandle of directoryHandle.values()) {
            if (fileHandle instanceof FileSystemDirectoryHandle) {
              console.warn('Nested directories are supported yet :(');
              continue;
            }
            const fileName = `${directoryHandle.name}/${fileHandle.name}`;
            const fileExtension = /(?:\.([^.]+))?$/.exec(fileName)?.[1] || 'txt';

            const fileCreator = FolkFileSpace.#fileCreators.get(fileExtension);

            if (fileCreator === undefined) {
              console.warn(`File '${fileName}' has to file creator for extension '${fileExtension}'.`);
              continue;
            }

            const file = await fileHandle.getFile();

            const element = fileCreator(fileName, fileExtension, file);

            const shape = document.createElement('folk-shape');

            shape.appendChild(element);

            this.appendChild(shape);
          }
        } else if (event.target.id === 'open-file') {
          console.log('open file');
        }
        break;
      }
    }
  }
}

FolkFileSpace.define();
