import '@folkjs/labs/standalone/folk-shape';
import '@folkjs/labs/standalone/folk-space';
import { FolkDirectory } from './folk-directory';

FolkDirectory.define();

const pinch = document.querySelector('folk-space')!;

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
  } else if (event.target.id === 'save') {
    document.querySelectorAll('folk-file').forEach((file) => file.save());
  }
});
