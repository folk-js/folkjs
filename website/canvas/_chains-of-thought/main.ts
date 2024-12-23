import { FolkShape } from '../../../labs/folk-shape.ts';
import { FolkArrow } from '../../../labs/folk-arrow.ts';
import { FileSaver } from '../src/file-system.ts';

declare global {
  interface HTMLElementTagNameMap {
    'fc-thought': FolkThought;
  }
}

class FolkThought extends HTMLElement {
  static tagName = 'fc-thought';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  #deleteButton = this.querySelector('button[name="delete"]') as HTMLButtonElement;
  #text = this.querySelector('[name="text"]') as HTMLElement;

  #geometry = this.parentElement as FolkShape;

  constructor() {
    super();

    this.addEventListener('click', this);
  }

  get text() {
    return this.#text.innerHTML;
  }

  handleEvent(event: PointerEvent): void {
    if (event.type === 'click' && event.target === this.#deleteButton) {
      this.#geometry.remove();

      document
        .querySelectorAll(
          `folk-arrow[source="folk-shape[id='${this.#geometry.id}']"], 
          folk-arrow[target="folk-shape[id='${this.#geometry.id}']"]`
        )
        .forEach((el) => el.remove());
    }
  }
}

FolkShape.define();
FolkThought.define();
FolkArrow.define();

interface Thought {
  id: string;
  text: string;
  x: number;
  y: number;
}

interface Connection {
  sourceId: string;
  targetId: string;
}

interface ChainOfThought {
  thoughts: Thought[];
  connections: Connection[];
}

const html = String.raw;

function parseHTML(html: string): Element {
  return document.createRange().createContextualFragment(html).firstElementChild!;
}

function renderThought({ id, x, y, text }: Thought) {
  return html`<folk-shape id="${id}" x="${x}" y="${y}">
    <fc-thought>
      <div contenteditable="true" name="text">${text}</div>
      <button name="delete">␡</button>
    </fc-thought>
  </folk-shape>`;
}

function renderConnection({ sourceId, targetId }: Connection) {
  return html`<folk-arrow source="folk-shape[id='${sourceId}']" target="folk-shape[id='${targetId}']"></folk-arrow>`;
}

function renderChainOfThought({ thoughts, connections }: ChainOfThought) {
  return html`${thoughts.map(renderThought).join('')}${connections.map(renderConnection).join('')}`;
}

function parseChainOfThought(): ChainOfThought {
  return {
    thoughts: Array.from(document.querySelectorAll('folk-shape')).map((el) => ({
      id: el.id,
      text: (el.firstElementChild as FolkThought).text,
      x: el.x,
      y: el.y,
    })),
    connections: Array.from(document.querySelectorAll('folk-arrow')).map((el) => ({
      sourceId: (el.sourceElement as FolkShape).id,
      targetId: (el.targetElement as FolkShape).id,
    })),
  };
}

const openButton = document.querySelector('button[name="open"]')!;
const saveButton = document.querySelector('button[name="save"]')!;
const saveAsButton = document.querySelector('button[name="save-as"]')!;
const main = document.querySelector('main')!;
const fileSaver = new FileSaver('chains-of-thought', 'json', 'application/json');

main.addEventListener('dblclick', (e) => {
  if (e.target === main) {
    main.appendChild(
      parseHTML(
        renderThought({
          id: String(document.querySelectorAll('fc-thought').length + 1),
          text: '',
          x: e.clientX,
          y: e.clientY,
        })
      )
    );
  }
});

async function openFile(showPicker = true) {
  try {
    const text = await fileSaver.open(showPicker);
    const json = JSON.parse(text || '{ "thoughts": [], "connections": [] }');
    main.setHTMLUnsafe(renderChainOfThought(json));
  } catch (e) {
    // No file handler was persisted or the file is invalid JSON.
    console.error(e);
  }
}

function saveFile(promptNewFile = false) {
  const file = JSON.stringify(parseChainOfThought(), null, 2);
  fileSaver.save(file, promptNewFile);
}

openButton.addEventListener('click', () => {
  openFile();
});

saveButton.addEventListener('click', () => {
  saveFile();
});

saveAsButton.addEventListener('click', () => {
  saveFile(true);
});

openFile(false);
