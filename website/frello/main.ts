import { type PropertyValues, ReactiveElement, css, property } from '@folkjs/dom/ReactiveElement';
import { html } from '@folkjs/dom/tags';
import '@folkjs/labs/standalone/folk-sync-attribute';

const sharedStyles = css`
  :focus,
  :focus-visible {
    outline: none;
    border-color: var(--bgColor-accent-emphasis);
    box-shadow: 0 0 0 1px var(--bgColor-accent-emphasis);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  button {
    background-color: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--fgColor-muted);
    font-size: 18px;
    padding: 8px 8px;
    text-align: left;

    &:hover {
      background-color: var(--transparent-bgColor-hover);
    }
  }

  textarea {
    field-sizing: content;
    resize: none;

    &:not(:focus) {
      max-height: 6lh;
    }
  }

  input,
  textarea {
    background-color: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: inherit;
    padding: 0.25rem 0.5rem;
  }
`;

class KanbanBoard extends ReactiveElement {
  static override tagName = 'kanban-board' as const;

  static override styles = css`
    ${sharedStyles}

    :host {
      display: grid;
      grid-template-areas:
        'heading heading'
        'filter add-column'
        'columns columns';
      grid-template-rows: auto auto 1fr;
      grid-template-columns: 1fr auto;
      gap: 1rem;
      height: 100%;
      padding: 1rem;

      > h2 {
        grid-area: heading;
        margin: 0;

        input {
          font-size: 22px;
        }
      }

      > label {
        grid-area: filter;
        display: flex;
        align-items: center;
        gap: 1rem;

        input {
          border: solid 1px var(--borderColor-default);
          border-radius: 6px;
          flex: 1;
        }
      }

      > ul {
        grid-area: columns;
        flex: 1;
        display: flex;
        gap: 1rem;
        overflow-x: auto;
      }

      > button {
        grid-area: add-column;
        justify-self: center;
        align-self: center;
      }
    }
  `;

  @property({ type: String, reflect: true }) name = '';

  @property({ type: String }) filter = '';

  #nameInput!: HTMLInputElement;
  #filterInput!: HTMLInputElement;

  get cards(): KanbanCard[] {
    return Array.from(this.querySelectorAll('kanban-card'));
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.addEventListener('input', this);
    root.addEventListener('click', this);

    const { frag, name, filter } =
      html(`<h2><input ref="name" placeholder="Board name" on-input="BOARD_NAME_UPDATE" /></h2>
<label for="filter">Filter: <input ref="filter" name="filter" id="filter" on-input="FILTER_CARDS" /></label>
<button on-click="ADD_COLUMN">Add Column</button>
<ul>
  <slot></slot>
</ul>`);

    this.#nameInput = name;
    this.#filterInput = filter;

    root.appendChild(frag);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('name')) this.#nameInput.value = this.name;

    if (changedProperties.has('filter')) this.#filterInput.value = this.filter;
  }

  handleEvent(event: Event) {
    const { intention } = findClosestIntention(event);

    if (intention === undefined) return;

    switch (intention) {
      case 'BOARD_NAME_UPDATE': {
        this.name = this.#nameInput.value;
        return;
      }
      case 'ADD_COLUMN': {
        const column = document.createElement('kanban-column');
        this.appendChild(column);
        column.focusName();
        return;
      }
      case 'FILTER_CARDS': {
        this.filter = this.#filterInput.value;

        const filter = this.filter.toLowerCase();

        this.cards.forEach((card) => {
          if (filter === '') {
            card.filtered = false;
            return;
          }
          card.filtered = !(
            card.name.toLowerCase().includes(filter) || card.description.toLowerCase().includes(filter)
          );
        });
        return;
      }
    }
  }

  focusName() {
    this.#nameInput.focus();
  }
}

class KanbanColumn extends ReactiveElement {
  static override tagName = 'kanban-column' as const;

  static override styles = css`
    ${sharedStyles}

    :host {
      background-color: var(--bgColor-inset);
      border: solid 1px var(--borderColor-default);
      border-radius: 6px;
      cursor: move;
      display: grid;
      grid-template-areas:
        'name delete'
        'cards cards'
        'add add';
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 1fr auto;
      gap: 0.5rem;
      min-width: 350px;
      overflow-y: auto;
      padding: 1rem;
      position: relative;
      width: 350px;
    }

    :host(:state(dragging)) {
      opacity: 0.01;
    }

    input {
      grid-area: name;
      font-size: 16px;
      font-weight: bold;
    }

    button[name='delete'] {
      grid-area: delete;
      font-size: 12px;
    }

    ul {
      grid-area: cards;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      scroll-padding-bottom: 7px;
    }

    button[name='add'] {
      grid-area: add;
      text-align: center;
    }
  `;

  @property({ type: String, reflect: true }) name = '';

  #nameInput!: HTMLInputElement;
  #internals = this.attachInternals();

  get cards(): KanbanCard[] {
    return Array.from(this.querySelectorAll('kanban-card'));
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.tabIndex = 0;
    this.draggable = true;
    this.#internals.role = 'listitem';

    root.addEventListener('input', this);
    root.addEventListener('click', this);
    this.addEventListener('keydown', this);
    this.addEventListener('dragstart', this);
    this.addEventListener('dragend', this);
    this.addEventListener('dragover', this);

    const { frag, name } = html(`
      <input ref="name" on-input="UPDATE_COLUMN_NAME" />
      <button name="delete" on-click="DELETE_COLUMN">Delete</button>
      <ul>
        <slot></slot>
      </ul>
      <button name="add" on-click="ADD_CARD">Add Item</button>
    `);

    this.#nameInput = name;

    root.appendChild(frag);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('name')) this.#nameInput.value = this.name;
  }

  moveRight() {
    this.nextElementSibling?.insertAdjacentElement('afterend', this);
    this.focus();
  }

  moveLeft() {
    this.previousElementSibling?.insertAdjacentElement('beforebegin', this);
    this.focus();
  }

  handleEvent(event: Event) {
    if (event instanceof KeyboardEvent && event.composedPath()[0] === this) {
      if (event.code === 'ArrowRight') {
        this.moveRight();
      } else if (event.code === 'ArrowLeft') {
        this.moveLeft();
      }
      return;
    }

    if (event instanceof DragEvent) {
      event.stopPropagation();
      event.stopImmediatePropagation();

      switch (event.type) {
        case 'dragstart': {
          (document.activeElement as HTMLElement)?.blur();
          this.#internals.states.add('dragging');
          event.dataTransfer!.effectAllowed = 'move';
          return;
        }
        case 'dragover': {
          event.preventDefault();

          const draggedCardOrColumn = document.querySelector<KanbanCard | KanbanColumn>(
            'kanban-card:state(dragging), kanban-column:state(dragging)',
          );

          // Only append a dragged card if the column is empty, otherwise make the user drag over another card
          if (draggedCardOrColumn instanceof KanbanCard) {
            const rect = this.lastElementChild?.getBoundingClientRect();

            if (rect == undefined || event.clientY > rect.bottom) {
              this.appendChild(draggedCardOrColumn);
            }
          } else if (draggedCardOrColumn instanceof KanbanColumn && this !== draggedCardOrColumn) {
            const rect = this.getBoundingClientRect();
            const midpoint = rect.left + rect.width / 2;
            const isLeft = event.clientX <= midpoint;

            if (isLeft && draggedCardOrColumn !== this.previousElementSibling) {
              this.insertAdjacentElement('beforebegin', draggedCardOrColumn);
            } else if (!isLeft && draggedCardOrColumn !== this.nextElementSibling) {
              this.insertAdjacentElement('afterend', draggedCardOrColumn);
            }
          }

          return;
        }
        case 'dragend': {
          event.preventDefault();
          this.#internals.states.delete('dragging');
          return;
        }
      }
    }

    const { intention } = findClosestIntention(event);

    if (intention === undefined) return;

    switch (intention) {
      case 'UPDATE_COLUMN_NAME': {
        this.name = this.#nameInput.value;
        return;
      }
      case 'DELETE_COLUMN': {
        this.remove();
        return;
      }
      case 'ADD_CARD': {
        const card = document.createElement('kanban-card');
        this.appendChild(card);
        card.focusName();
        return;
      }
    }
  }

  focusName() {
    this.#nameInput.focus();
  }
}

class KanbanCard extends ReactiveElement {
  static override tagName = 'kanban-card' as const;

  static override styles = [
    sharedStyles,
    css`
      :host {
        background-color: var(--overlay-bgColor);
        border: solid 1px var(--borderColor-default);
        border-radius: 6px;
        display: grid;
        grid-template-areas:
          'name delete'
          'description description';
        grid-template-rows: auto auto;
        grid-template-columns: 1fr auto;
        gap: 0.25rem;
        cursor: move;
        padding: 1rem;
      }

      :host(:state(filtered)) {
        display: none;
      }

      :host(:state(dragging)) {
        opacity: 0.1;
      }

      input {
        grid-area: name;
      }

      button {
        grid-area: delete;
        font-size: 12px;
      }

      textarea {
        grid-area: description;
      }
    `,
  ];

  @property({ type: String, reflect: true }) name = '';

  @property({ type: String, reflect: true }) description = '';

  #internals = this.attachInternals();
  #nameInput!: HTMLInputElement;
  #description!: HTMLTextAreaElement;

  #filtered = false;
  get filtered() {
    return this.#filtered;
  }
  set filtered(filtered) {
    this.#filtered = filtered;
    this.#filtered ? this.#internals.states.add('filtered') : this.#internals.states.delete('filtered');
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.tabIndex = 0;
    this.draggable = true;
    this.#internals.role = 'listitem';

    root.addEventListener('input', this);
    root.addEventListener('click', this);
    this.addEventListener('keydown', this);
    this.addEventListener('dragstart', this);
    this.addEventListener('dragend', this);
    this.addEventListener('dragover', this);

    const { frag, name, textarea } = html(`
      <input type="text" ref="name" on-input="UPDATE_CARD_NAME" />
      <button on-click="DELETE_CARD">Delete</button>
      <textarea ref="textarea" placeholder="Add a description" on-input="UPDATE_CARD_DESCRIPTION"></textarea>
    `);

    this.#nameInput = name;
    this.#description = textarea;

    root.append(frag);

    return root;
  }

  protected override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('name')) this.#nameInput.value = this.name;

    if (changedProperties.has('description')) this.#description.value = this.description;
  }

  handleEvent(event: Event) {
    if (event instanceof KeyboardEvent && event.composedPath()[0] === this) {
      if (event.shiftKey && event.code === 'ArrowUp') {
        this.parentElement?.insertAdjacentElement('afterbegin', this);
      } else if (event.shiftKey && event.code === 'ArrowDown') {
        this.parentElement?.appendChild(this);
      } else if (event.code === 'ArrowUp') {
        closestSibling(this, ':not(:state(filtered))', 'before')?.insertAdjacentElement('beforebegin', this);
      } else if (event.code === 'ArrowDown') {
        closestSibling(this, ':not(:state(filtered))', 'after')?.insertAdjacentElement('afterend', this);
      } else if (event.code === 'ArrowRight') {
        this.closest('kanban-column')?.nextElementSibling?.appendChild(this);
      } else if (event.code === 'ArrowLeft') {
        this.closest('kanban-column')?.previousElementSibling?.appendChild(this);
      }

      // refocus this element
      this.focus();
      return;
    }

    if (event instanceof DragEvent) {
      event.stopPropagation();
      event.stopImmediatePropagation();

      switch (event.type) {
        case 'dragstart': {
          (document.activeElement as HTMLElement)?.blur();
          this.#internals.states.add('dragging');
          event.dataTransfer!.effectAllowed = 'move';
          return;
        }
        case 'dragover': {
          event.preventDefault();

          const draggedCard = document.querySelector('kanban-card:state(dragging)');

          if (draggedCard === null || draggedCard === this) return;

          const rect = this.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          const isAbove = event.clientY <= midpoint;

          if (isAbove && this.previousElementSibling !== draggedCard) {
            this.insertAdjacentElement('beforebegin', draggedCard);
            event.dataTransfer!.dropEffect = 'move';
          } else if (!isAbove && this.nextElementSibling !== draggedCard) {
            this.insertAdjacentElement('afterend', draggedCard);
            event.dataTransfer!.dropEffect = 'move';
          }
          return;
        }
        case 'dragend': {
          event.preventDefault();
          this.#internals.states.delete('dragging');
          return;
        }
      }
    }

    const { intention } = findClosestIntention(event);

    if (intention === undefined) return;

    switch (intention) {
      case 'UPDATE_CARD_NAME': {
        this.name = this.#nameInput.value;
        return;
      }
      case 'UPDATE_CARD_DESCRIPTION': {
        this.description = this.#description.value;
        return;
      }
      case 'DELETE_CARD': {
        this.remove();
        return;
      }
    }
  }

  focusName() {
    this.#nameInput.focus();
  }
}

KanbanBoard.define();
KanbanColumn.define();
KanbanCard.define();

declare global {
  interface HTMLElementTagNameMap {
    [KanbanBoard.tagName]: KanbanBoard;
    [KanbanColumn.tagName]: KanbanColumn;
    [KanbanCard.tagName]: KanbanCard;
  }
}

/** Utils */
interface Intention {
  intention: string;
  target: Element;
}

function findClosestIntention(
  event: Event,
  excludedIntentions?: ReadonlySet<string>,
): Intention | { intention?: never; target?: never } {
  let target: Element | null = event.target as Element | null;

  while (target !== null) {
    const attributeName = `on-${event.type}`;
    const intentionTarget = target.closest(`[${CSS.escape(attributeName)}]`);
    if (intentionTarget !== null) {
      const intention = intentionTarget.getAttribute(attributeName)!;
      if (excludedIntentions === undefined || !excludedIntentions.has(intention)) {
        return { intention, target: intentionTarget };
      }
    }
    target = intentionTarget?.parentElement || null;
  }

  return {};
}

function closestSibling(el: Element, selector: string, where: 'before' | 'after'): Element | null {
  const siblingProperty = where === 'before' ? 'previousElementSibling' : 'nextElementSibling';
  let sibling = el[siblingProperty];
  while (sibling !== null && !sibling.matches(selector)) {
    sibling = sibling[siblingProperty];
  }
  return sibling;
}
