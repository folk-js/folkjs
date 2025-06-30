/**
 * Standard JSON-based I/O for HTML elements and DOM subtrees
 * - Plain values for textContent or input values
 * - Objects for forms
 * - Arrays for tables and lists
 */

// Type for all data that flows through the HTML I/O system
export type IOData = string | number | boolean | { [key: string]: any } | any[][] | any[];

// Internal handler interface
interface IOHandler {
  getValue(element: Element): IOData;
  setValue(element: Element, value: IOData): void;
}

// Registry of element handlers - only for elements needing special behavior
const handlers: Record<string, IOHandler> = {
  // Form controls with .value
  INPUT: {
    getValue: (el: HTMLInputElement) => el.value,
    setValue: (el: HTMLInputElement, value) => {
      el.value = String(value);
    },
  },
  TEXTAREA: {
    getValue: (el: HTMLTextAreaElement) => el.value,
    setValue: (el: HTMLTextAreaElement, value) => {
      el.value = String(value);
    },
  },
  SELECT: {
    getValue: (el: HTMLSelectElement) => el.value,
    setValue: (el: HTMLSelectElement, value) => {
      el.value = String(value);
    },
  },

  // OUTPUT element can use both .value and .textContent
  OUTPUT: {
    getValue: (el: HTMLOutputElement) => el.value || el.textContent || '',
    setValue: (el: HTMLOutputElement, value) => {
      const str = String(value);
      el.value = str;
      el.textContent = str;
    },
  },

  // Media elements with .src
  IMG: {
    getValue: (el: HTMLImageElement) => el.src,
    setValue: (el: HTMLImageElement, value) => {
      el.src = String(value);
    },
  },
  VIDEO: {
    getValue: (el: HTMLVideoElement) => el.src,
    setValue: (el: HTMLVideoElement, value) => {
      el.src = String(value);
    },
  },
  AUDIO: {
    getValue: (el: HTMLAudioElement) => el.src,
    setValue: (el: HTMLAudioElement, value) => {
      el.src = String(value);
    },
  },

  // Canvas - special case for data URL
  CANVAS: {
    getValue: (el: HTMLCanvasElement) => el.toDataURL(),
    setValue: (el: HTMLCanvasElement, value) => {
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
  },

  // Lists - handle arrays of items
  OL: {
    getValue: (el: Element) => {
      const items = Array.from(el.querySelectorAll('li'));
      return items.map((item) => item.textContent || '');
    },
    setValue: (el: Element, value) => {
      if (Array.isArray(value)) {
        el.innerHTML = '';
        value.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = String(item);
          li.contentEditable = 'true';

          // Trigger change events on edit
          li.addEventListener('input', () => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });

          el.appendChild(li);
        });

        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
  },
  UL: {
    getValue: (el: Element) => {
      const items = Array.from(el.querySelectorAll('li'));
      return items.map((item) => item.textContent || '');
    },
    setValue: (el: Element, value) => {
      if (Array.isArray(value)) {
        el.innerHTML = '';
        value.forEach((item) => {
          const li = document.createElement('li');
          li.textContent = String(item);
          li.contentEditable = 'true';

          // Trigger change events on edit
          li.addEventListener('input', () => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });

          el.appendChild(li);
        });

        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
  },

  // Form - outputs key-value object
  FORM: {
    getValue: (el: HTMLFormElement) => {
      const formData = new FormData(el);
      const result: { [key: string]: any } = {};

      // Handle regular form fields
      for (const [key, value] of formData.entries()) {
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

      // Handle unchecked checkboxes and radio buttons
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
    setValue: (el: HTMLFormElement, value) => {
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
  },

  // Table - outputs 2D array
  TABLE: {
    getValue: (el: HTMLTableElement) => {
      const rows = Array.from(el.querySelectorAll('tr'));
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return cells.map((cell) => cell.textContent || '');
      });
    },
    setValue: (el: HTMLTableElement, value) => {
      if (Array.isArray(value) && value.length > 0) {
        el.innerHTML = '';
        const hasHeaders = value.length > 1;

        value.forEach((rowData, rowIndex) => {
          if (Array.isArray(rowData) && rowData.length > 0) {
            const row = document.createElement('tr');

            rowData.forEach((cellData) => {
              const cellType = hasHeaders && rowIndex === 0 ? 'th' : 'td';
              const cell = document.createElement(cellType);
              cell.textContent = String(cellData);
              cell.contentEditable = 'true';

              // Trigger change events on edit
              cell.addEventListener('input', () => {
                el.dispatchEvent(new Event('input', { bubbles: true }));
              });

              row.appendChild(cell);
            });

            if (hasHeaders && rowIndex === 0) {
              const thead = document.createElement('thead');
              thead.appendChild(row);
              el.appendChild(thead);
            } else {
              let tbody = el.querySelector('tbody');
              if (!tbody) {
                tbody = document.createElement('tbody');
                el.appendChild(tbody);
              }
              tbody.appendChild(row);
            }
          }
        });

        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
  },
};

/**
 * Get standardized JSON data from any HTML element
 */
export function get(element: Element): IOData {
  const handler = handlers[element.tagName];
  if (handler) {
    return handler.getValue(element);
  }

  // Fallback: read textContent for any unhandled element
  return element.textContent || '';
}

/**
 * Set standardized JSON data to any HTML element
 */
export function set(element: Element, value: IOData): void {
  const handler = handlers[element.tagName];
  if (handler) {
    handler.setValue(element, value);
  } else {
    // Fallback: write to textContent for any unhandled element
    element.textContent = String(value);
  }
}
