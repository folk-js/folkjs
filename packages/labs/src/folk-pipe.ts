import { FolkElement } from '@folkjs/canvas';
import { css, property, state, type CSSResultGroup } from '@folkjs/canvas/reactive-element';

// Element I/O type definitions
interface ElementIO {
  getValue(element: Element): any;
  setValue(element: Element, value: any): void;
  getChangeEventName(element: Element): string;
}

// Standard I/O mappings for different element types
const ELEMENT_IO_MAP: Map<string, ElementIO> = new Map([
  // Form controls with .value
  [
    'INPUT',
    {
      getValue: (el: HTMLInputElement) => el.value,
      setValue: (el: HTMLInputElement, value: any) => {
        el.value = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'TEXTAREA',
    {
      getValue: (el: HTMLTextAreaElement) => el.value,
      setValue: (el: HTMLTextAreaElement, value: any) => {
        el.value = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'SELECT',
    {
      getValue: (el: HTMLSelectElement) => el.value,
      setValue: (el: HTMLSelectElement, value: any) => {
        el.value = String(value);
      },
      getChangeEventName: () => 'change',
    },
  ],

  // Content elements with textContent
  [
    'P',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'DIV',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'SPAN',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'PRE',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'CODE',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H1',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H2',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H3',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H4',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H5',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],
  [
    'H6',
    {
      getValue: (el: Element) => el.textContent || '',
      setValue: (el: Element, value: any) => {
        el.textContent = String(value);
      },
      getChangeEventName: () => 'input',
    },
  ],

  // OUTPUT element can use both .value and .textContent
  [
    'OUTPUT',
    {
      getValue: (el: HTMLOutputElement) => el.value || el.textContent || '',
      setValue: (el: HTMLOutputElement, value: any) => {
        const str = String(value);
        el.value = str;
        el.textContent = str;
      },
      getChangeEventName: () => 'input',
    },
  ],

  // Media elements with .src
  [
    'IMG',
    {
      getValue: (el: HTMLImageElement) => el.src,
      setValue: (el: HTMLImageElement, value: any) => {
        el.src = String(value);
      },
      getChangeEventName: () => 'load',
    },
  ],
  [
    'VIDEO',
    {
      getValue: (el: HTMLVideoElement) => el.src,
      setValue: (el: HTMLVideoElement, value: any) => {
        el.src = String(value);
      },
      getChangeEventName: () => 'loadeddata',
    },
  ],
  [
    'AUDIO',
    {
      getValue: (el: HTMLAudioElement) => el.src,
      setValue: (el: HTMLAudioElement, value: any) => {
        el.src = String(value);
      },
      getChangeEventName: () => 'loadeddata',
    },
  ],

  // Canvas - special case for data URL output
  [
    'CANVAS',
    {
      getValue: (el: HTMLCanvasElement) => el.toDataURL(),
      setValue: (el: HTMLCanvasElement, value: any) => {
        // For canvas input, we could load an image from data URL
        const ctx = el.getContext('2d');
        if (ctx && typeof value === 'string' && value.startsWith('data:image/')) {
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, el.width, el.height);
            ctx.drawImage(img, 0, 0);
          };
          img.src = value;
        }
      },
      getChangeEventName: () => 'change',
    },
  ],
]);

export class FolkPipe extends FolkElement {
  static override tagName = 'folk-pipe';

  static override styles: CSSResultGroup = css`
    :host {
      display: none;
    }
  `;

  @state() private sourceElement: Element | null = null;
  @state() private targetElement: Element | null = null;

  #structuralMutationObserver: MutationObserver | null = null;
  #contentMutationObserver: MutationObserver | null = null;
  #sourceEventListener: ((event: Event) => void) | null = null;
  #lastSourceValue: any = null;
  #pollingIntervalId: number | null = null;

  override connectedCallback() {
    super.connectedCallback();
    this.#setupPipe();
    this.#observeStructuralChanges();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #setupPipe() {
    this.#findElements();
    this.#setupReactivity();
    this.#performInitialSync();
  }

  #findElements() {
    const previousSibling = this.previousElementSibling;
    const nextSibling = this.nextElementSibling;

    this.sourceElement = previousSibling;
    this.targetElement = nextSibling;
  }

  #setupReactivity() {
    this.#removeReactivity();

    if (!this.sourceElement) return;

    // Setup both event listening AND content observation
    this.#setupEventListening();
    this.#setupContentObservation();
  }

  #setupEventListening() {
    if (!this.sourceElement) return;

    const io = this.#getElementIO(this.sourceElement);
    if (!io) return;

    const eventName = io.getChangeEventName(this.sourceElement);

    this.#sourceEventListener = () => {
      this.#syncFromSourceToTarget();
    };

    this.sourceElement.addEventListener(eventName, this.#sourceEventListener);

    // Also listen for contenteditable changes
    if (this.sourceElement.hasAttribute('contenteditable')) {
      this.sourceElement.addEventListener('input', this.#sourceEventListener);
    }
  }

  #setupContentObservation() {
    if (!this.sourceElement) return;

    this.#contentMutationObserver = new MutationObserver((mutations) => {
      let shouldSync = false;

      for (const mutation of mutations) {
        // Check for text content changes
        if (mutation.type === 'characterData') {
          shouldSync = true;
          break;
        }

        // Check for attribute changes (like value, src, etc.)
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          if (
            attrName === 'value' ||
            attrName === 'src' ||
            (this.sourceElement!.tagName === 'INPUT' && attrName === 'value')
          ) {
            shouldSync = true;
            break;
          }
        }

        // Check for child node changes (affects textContent)
        if (mutation.type === 'childList') {
          shouldSync = true;
          break;
        }
      }

      if (shouldSync) {
        this.#syncFromSourceToTarget();
      }
    });

    // Observe the source element for content changes
    this.#contentMutationObserver.observe(this.sourceElement, {
      attributes: true,
      attributeFilter: ['value', 'src'],
      characterData: true,
      childList: true,
      subtree: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });

    // Also poll for value changes on form elements (since .value changes don't trigger mutations)
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(this.sourceElement.tagName)) {
      this.#startValuePolling();
    }
  }

  #startValuePolling() {
    if (!this.sourceElement) return;

    const checkForChanges = () => {
      if (!this.sourceElement) return;

      const io = this.#getElementIO(this.sourceElement);
      if (!io) return;

      const currentValue = io.getValue(this.sourceElement);
      if (currentValue !== this.#lastSourceValue) {
        this.#lastSourceValue = currentValue;
        this.#syncFromSourceToTarget();
      }
    };

    // Use a shorter interval for better responsiveness to programmatic changes
    this.#pollingIntervalId = window.setInterval(checkForChanges, 50);
  }

  #removeReactivity() {
    this.#removeEventListening();
    this.#removeContentObservation();
  }

  #removeEventListening() {
    if (this.#sourceEventListener && this.sourceElement) {
      const io = this.#getElementIO(this.sourceElement);
      if (io) {
        const eventName = io.getChangeEventName(this.sourceElement);
        this.sourceElement.removeEventListener(eventName, this.#sourceEventListener);
      }

      if (this.sourceElement.hasAttribute('contenteditable')) {
        this.sourceElement.removeEventListener('input', this.#sourceEventListener);
      }
    }
    this.#sourceEventListener = null;
  }

  #removeContentObservation() {
    this.#contentMutationObserver?.disconnect();
    this.#contentMutationObserver = null;

    // Clean up polling interval
    if (this.#pollingIntervalId !== null) {
      clearInterval(this.#pollingIntervalId);
      this.#pollingIntervalId = null;
    }
  }

  #performInitialSync() {
    this.#syncFromSourceToTarget();
  }

  #syncFromSourceToTarget() {
    if (!this.sourceElement || !this.targetElement) return;

    const sourceIO = this.#getElementIO(this.sourceElement);
    const targetIO = this.#getElementIO(this.targetElement);

    if (!sourceIO || !targetIO) return;

    const value = sourceIO.getValue(this.sourceElement);

    // Always update the target, but only update lastSourceValue if it actually changed
    if (value !== this.#lastSourceValue) {
      this.#lastSourceValue = value;
    }
    targetIO.setValue(this.targetElement, value);
  }

  #getElementIO(element: Element): ElementIO | null {
    return ELEMENT_IO_MAP.get(element.tagName) || null;
  }

  #observeStructuralChanges() {
    this.#structuralMutationObserver = new MutationObserver((mutations) => {
      let shouldRefresh = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if elements around us have changed
          const addedNodes = Array.from(mutation.addedNodes);
          const removedNodes = Array.from(mutation.removedNodes);

          if (addedNodes.includes(this) || removedNodes.includes(this)) {
            shouldRefresh = true;
            break;
          }

          // Check if our source or target elements were moved/removed
          if (this.sourceElement && removedNodes.includes(this.sourceElement)) {
            shouldRefresh = true;
            break;
          }
          if (this.targetElement && removedNodes.includes(this.targetElement)) {
            shouldRefresh = true;
            break;
          }

          // Check if siblings around us changed
          if (mutation.target === this.parentElement) {
            shouldRefresh = true;
            break;
          }
        }
      }

      if (shouldRefresh) {
        this.#setupPipe();
      }
    });

    // Observe the parent and document for structural changes
    if (this.parentElement) {
      this.#structuralMutationObserver.observe(this.parentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  #cleanup() {
    this.#removeReactivity();
    this.#structuralMutationObserver?.disconnect();
    this.#structuralMutationObserver = null;
  }
}
