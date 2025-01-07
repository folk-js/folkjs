import '@labs/standalone/folk-pinch.ts';
import '@labs/standalone/folk-shape.ts';
import { FolkDirectory } from './folk-directory.ts';

FolkDirectory.define();

const pinch = document.querySelector('folk-pinch')!;

document.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLElement)) return;

  if (event.target.id === 'open-directory') {
    // pass in previous opened or active directory.
    const directoryHandle = await window.showDirectoryPicker({
      id: 'file-space',
      startIn: 'documents',
      mode: 'readwrite',
    });

    const directory = document.createElement('folk-directory');

    directory.directoryHandle = directoryHandle;

    pinch.appendChild(directory);
  } else if (event.target.id === 'open-file') {
    console.log('open file');
  }
});
