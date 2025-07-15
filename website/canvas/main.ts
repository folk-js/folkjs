import '@folkjs/labs/standalone/folk-space-attribute';
import '@folkjs/labs/standalone/folk-shape-attribute';
import '@folkjs/labs/standalone/folk-sync-attribute';
import '@folkjs/labs/standalone/folk-arrow';
import {deleteElementByClick} from '@folkjs/labs/interactions/delete';
import {dragToCreateShape} from '@folkjs/labs/interactions/create-element';


const space = document.querySelector('main')!;
const instruments = document.querySelector('#instruments')!;

function getActiveInstrument() {
  return instruments.querySelector<HTMLInputElement>('input:checked')!.value
}

function setActiveInstrument(instrument: string) {
  const input = instruments.querySelector<HTMLInputElement>(`input[type="radio"][value="${instrument}"]`)

  if (!input) return;
    
  input.checked = true;
  input.focus();

  startInstrument(instrument)
}

let cancelInstrument: AbortController | null = null;

async function startInstrument(activeInstrument: string = getActiveInstrument()) {
  cancelInstrument?.abort();

  cancelInstrument = new AbortController();

  switch(activeInstrument) {
    // for right now, the select instrument isn't an instrument, it's really just normal browser mode
    case 'select': {
      return;
    }
    case 'pan': {
      break;
    }
    case 'draw': {
      break;
    }
    case 'erase': {
      const el = await deleteElementByClick(space, cancelInstrument.signal);

      if (el) startInstrument('erase');
      
      break;
    }
    case 'rectangle': {
      const el = await dragToCreateShape(space, cancelInstrument.signal, () => document.createElement('div'));
      
      if (el) setActiveInstrument('select');
      break;
    }
    case 'arrow': {
      break;
    }
  }
}

instruments?.addEventListener('input', async (e) => {
  const activeInstrument = (e.target as HTMLInputElement).value;

  startInstrument(activeInstrument);
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && getActiveInstrument() !== 'select') {
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    setActiveInstrument('select');
  }

  console.log(e)
})

startInstrument();