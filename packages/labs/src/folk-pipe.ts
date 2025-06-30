import { FolkElement } from '@folkjs/canvas';
import { css, property, state, type CSSResultGroup } from '@folkjs/canvas/reactive-element';

// Hash module system integration
async function ensureHashModulesReady(): Promise<void> {
  // Check if hash modules are already ready (from HTML bootloader)
  if ((window as any).hashModulesReady) {
    return Promise.resolve();
  }

  // Wait for hash modules to be ready
  return new Promise<void>((resolve) => {
    const handleReady = () => {
      document.removeEventListener('hash-modules-ready', handleReady);
      resolve();
    };

    document.addEventListener('hash-modules-ready', handleReady);
  });
}

// Element I/O type definitions
interface ElementIO {
  getValue(element: Element, inputValue?: any): any | Promise<any>;
  setValue(element: Element, value: any): void | Promise<void>;
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
        const valueStr = String(value);

        // If the value looks like a hex color, apply it as background
        if (/^#[0-9a-fA-F]{6}$/.test(valueStr)) {
          const htmlEl = el as HTMLElement;
          htmlEl.style.backgroundColor = valueStr;

          // Update text content to show the color name
          const colorNames: { [key: string]: string } = {
            '#ff0000': '🔴 Red',
            '#00ff00': '🟢 Green',
            '#0000ff': '🔵 Blue',
            '#ffff00': '🟡 Yellow',
          };

          el.textContent = colorNames[valueStr.toLowerCase()] || valueStr;

          // Set text color for contrast
          const r = parseInt(valueStr.substr(1, 2), 16);
          const g = parseInt(valueStr.substr(3, 2), 16);
          const b = parseInt(valueStr.substr(5, 2), 16);
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          htmlEl.style.color = brightness > 128 ? 'black' : 'white';
        } else {
          el.textContent = valueStr;
        }
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

  // Script elements with textContent (for editable code)
  [
    'SCRIPT',
    {
      getValue: async (el: HTMLScriptElement, inputValue?: any) => {
        // For hash modules, try to execute the default export as a function
        if (el.type === 'hash-module' && el.id) {
          try {
            // Ensure all hash modules are processed first
            await ensureHashModulesReady();

            const module = await import(`#${el.id}`);

            if (typeof module.default === 'function') {
              // Call the function with the input value from the pipe
              return await module.default(inputValue);
            }
          } catch (error) {
            console.error('Error executing hash module:', error);
            return `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        // Fallback to textContent for non-hash modules
        return el.textContent || '';
      },
      setValue: async (el: HTMLScriptElement, value: any) => {
        // For hash modules, execute the function with the input value and display the result
        if (el.type === 'hash-module' && el.id) {
          try {
            // Ensure all hash modules are processed first
            await ensureHashModulesReady();

            const module = await import(`#${el.id}`);

            if (typeof module.default === 'function') {
              const result = await module.default(value);
              // Store the result in a data attribute or display it somehow
              el.dataset.pipeResult = String(result);
              el.dispatchEvent(new CustomEvent('pipe-result', { detail: result }));

              // Find the next element to pipe the result to
              const nextPipe = el.nextElementSibling;
              if (nextPipe && nextPipe.tagName === 'FOLK-PIPE') {
                const nextTarget = nextPipe.nextElementSibling;
                if (nextTarget) {
                  const targetIO = ELEMENT_IO_MAP.get(nextTarget.tagName);
                  if (targetIO) {
                    targetIO.setValue(nextTarget, result);
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error executing hash module on setValue:', error);
            el.dataset.pipeResult = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        } else {
          // For regular scripts, set textContent
          el.textContent = String(value);
        }
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

  // Form - outputs key-value object of all form elements
  [
    'FORM',
    {
      getValue: (el: HTMLFormElement) => {
        const formData = new FormData(el);
        const result: { [key: string]: any } = {};

        // Handle regular form fields
        for (const [key, value] of formData.entries()) {
          // If key already exists, convert to array (for multiple checkboxes, selects, etc.)
          if (result[key] !== undefined) {
            if (Array.isArray(result[key])) {
              result[key].push(value);
            } else {
              result[key] = [result[key], value];
            }
          } else {
            result[key] = value;
          }
        }

        // Handle unchecked checkboxes and radio buttons (they don't appear in FormData)
        const inputs = el.querySelectorAll('input[name]');
        inputs.forEach((element) => {
          const input = element as HTMLInputElement;
          if ((input.type === 'checkbox' || input.type === 'radio') && !input.checked) {
            if (result[input.name] === undefined) {
              result[input.name] = input.type === 'checkbox' ? false : null;
            }
          }
        });

        return result;
      },
      setValue: (el: HTMLFormElement, value: any) => {
        if (typeof value === 'object' && value !== null) {
          Object.entries(value).forEach(([key, val]) => {
            const elements = el.querySelectorAll(`[name="${key}"]`);
            elements.forEach((element) => {
              if (element instanceof HTMLInputElement) {
                if (element.type === 'checkbox' || element.type === 'radio') {
                  element.checked = Boolean(val);
                } else {
                  element.value = String(val);
                }
              } else if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
                element.value = String(val);
              }
            });
          });
        }
      },
      getChangeEventName: () => 'input',
    },
  ],

  // Table - outputs 2D array representation
  [
    'TABLE',
    {
      getValue: (el: HTMLTableElement) => {
        const rows = Array.from(el.querySelectorAll('tr'));
        return rows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          return cells.map((cell) => cell.textContent || '');
        });
      },
      setValue: (el: HTMLTableElement, value: any) => {
        if (Array.isArray(value) && value.length > 0) {
          // Clear existing content completely
          el.innerHTML = '';

          // Determine if first row should be headers
          const hasHeaders = value.length > 1;

          value.forEach((rowData, rowIndex) => {
            if (Array.isArray(rowData) && rowData.length > 0) {
              const row = document.createElement('tr');

              rowData.forEach((cellData) => {
                // First row gets th elements if we have multiple rows, otherwise td
                const cellType = hasHeaders && rowIndex === 0 ? 'th' : 'td';
                const cell = document.createElement(cellType);
                cell.textContent = String(cellData);

                // Make cells editable for interaction
                cell.contentEditable = 'true';

                // Add input listener to trigger table change events
                cell.addEventListener('input', () => {
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                });

                row.appendChild(cell);
              });

              // Add the row to the appropriate parent
              if (hasHeaders && rowIndex === 0) {
                // Create thead for header row
                const thead = document.createElement('thead');
                thead.appendChild(row);
                el.appendChild(thead);
              } else {
                // Create tbody if it doesn't exist
                let tbody = el.querySelector('tbody');
                if (!tbody) {
                  tbody = document.createElement('tbody');
                  el.appendChild(tbody);
                }
                tbody.appendChild(row);
              }
            }
          });

          // Dispatch a change event to notify that the table structure changed
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      getChangeEventName: () => 'input',
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

    const checkForChanges = async () => {
      if (!this.sourceElement) return;

      const io = this.#getElementIO(this.sourceElement);
      if (!io) return;

      try {
        const currentValue = await io.getValue(this.sourceElement);
        if (currentValue !== this.#lastSourceValue) {
          this.#lastSourceValue = currentValue;
          this.#syncFromSourceToTarget();
        }
      } catch (error) {
        console.error('Error checking for changes:', error);
      }
    };

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

    if (this.#pollingIntervalId !== null) {
      clearInterval(this.#pollingIntervalId);
      this.#pollingIntervalId = null;
    }
  }

  #performInitialSync() {
    this.#syncFromSourceToTarget();
  }

  async #syncFromSourceToTarget() {
    if (!this.sourceElement || !this.targetElement) return;

    const sourceIO = this.#getElementIO(this.sourceElement);
    const targetIO = this.#getElementIO(this.targetElement);

    if (!sourceIO || !targetIO) return;

    try {
      let sourceValue;

      // Hash modules need input from the previous element in the chain
      if (this.sourceElement.tagName === 'SCRIPT' && (this.sourceElement as HTMLScriptElement).type === 'hash-module') {
        const prevPipe = this.sourceElement.previousElementSibling;
        if (prevPipe && prevPipe.tagName === 'FOLK-PIPE') {
          const prevSource = prevPipe.previousElementSibling;
          if (prevSource) {
            const inputValue = await this.#getValueFromPreviousInChain(prevSource);
            sourceValue = await sourceIO.getValue(this.sourceElement, inputValue);
          } else {
            sourceValue = await sourceIO.getValue(this.sourceElement);
          }
        } else {
          sourceValue = await sourceIO.getValue(this.sourceElement);
        }
      } else {
        sourceValue = await sourceIO.getValue(this.sourceElement);
      }

      if (sourceValue !== this.#lastSourceValue) {
        this.#lastSourceValue = sourceValue;
      }

      await targetIO.setValue(this.targetElement, sourceValue);
    } catch (error) {
      console.error('Error syncing from source to target:', error);
      // Set error message on target
      targetIO.setValue(this.targetElement, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #getElementIO(element: Element): ElementIO | null {
    return ELEMENT_IO_MAP.get(element.tagName) || null;
  }

  async #getValueFromPreviousInChain(element: Element): Promise<any> {
    const io = this.#getElementIO(element);
    if (!io) return undefined;

    // If this is a hash module, we need to get its input from the previous element
    if (element.tagName === 'SCRIPT' && (element as HTMLScriptElement).type === 'hash-module') {
      const prevPipe = element.previousElementSibling;
      if (prevPipe && prevPipe.tagName === 'FOLK-PIPE') {
        const prevSource = prevPipe.previousElementSibling;
        if (prevSource) {
          const inputValue = await this.#getValueFromPreviousInChain(prevSource);
          return await io.getValue(element, inputValue);
        }
      }
      return await io.getValue(element);
    } else {
      // Regular element, just get its value
      return await io.getValue(element);
    }
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
