import { KeyValueStore } from '@folkjs/canvas';

export class FilePicker {
  #id;
  #fileType;
  #fileExtension;
  #mimeType;
  #store;
  #fileHandlerPromise;

  // Feature detection. The API needs to be supported and the app not run in an iframe.
  #supportsFileSystemAccess =
    'showSaveFilePicker' in window &&
    (() => {
      try {
        return window.self === window.top;
      } catch {
        return false;
      }
    })();

  constructor(id: string, fileType: string, mimeType: string) {
    this.#id = id;
    this.#fileType = fileType;
    this.#fileExtension = `.${this.#fileType}`;
    this.#mimeType = mimeType;
    this.#store = new KeyValueStore<FileSystemFileHandle>(this.#id);
    this.#fileHandlerPromise = this.#loadFileHandler();
  }

  async #loadFileHandler() {
    const file = await this.#store.get('file');

    if (file === undefined) return undefined;

    // We need to request permission since the file handler was persisted.
    // Calling `queryPermission` seems unnecessary atm since the browser prompts permission for each session
    const previousPermission = await file.queryPermission({ mode: 'readwrite' });
    if (previousPermission === 'granted') return file;

    // this requires user interaction
    // const newPermission = await file.requestPermission({ mode: 'readwrite' });
    // if (newPermission === 'granted') return file;

    return undefined;
  }

  async open(showPicker = true): Promise<string> {
    let fileHandler = await this.#fileHandlerPromise;

    if (showPicker) {
      fileHandler = await this.#showOpenFilePicker();
    }

    if (fileHandler === undefined) return '';

    const file = await fileHandler.getFile();
    const text = await file.text();
    return text;
  }

  async save(content: string, promptNewFile = false) {
    // TODO: progressively enhance using anchor downloads?
    if (!this.#supportsFileSystemAccess) {
      throw new Error('File System Access API is not supported.');
    }

    let fileHandler = await this.#fileHandlerPromise;

    if (promptNewFile || fileHandler === undefined) {
      fileHandler = await this.#showSaveFilePicker();
    }

    const writer = await fileHandler.createWritable();
    await writer.write(content);
    await writer.close();
  }

  clear() {
    this.#store.clear();
  }

  async #showSaveFilePicker() {
    this.#fileHandlerPromise = window.showSaveFilePicker({
      id: this.#id,
      suggestedName: `${this.#id}.${this.#fileType}`,
      types: [
        {
          description: `${this.#fileType.toUpperCase()} document`,
          accept: { [this.#mimeType]: [this.#fileExtension] } as FilePickerAcceptType['accept'],
        },
      ],
    });

    const fileHandler = (await this.#fileHandlerPromise)!;
    await this.#store.set('file', fileHandler);
    return fileHandler;
  }

  async #showOpenFilePicker() {
    this.#fileHandlerPromise = window
      .showOpenFilePicker({
        id: this.#id,
        types: [
          {
            description: `${this.#fileType.toUpperCase()} document`,
            accept: { [this.#mimeType]: [this.#fileExtension] } as FilePickerAcceptType['accept'],
          },
        ],
      })
      .then((files) => files[0]);

    const fileHandler = (await this.#fileHandlerPromise)!;
    await this.#store.set('file', fileHandler);
    return fileHandler;
  }
}
