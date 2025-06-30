/**
 * Standard JSON-based I/O for HTML elements and DOM subtrees
 * - Plain values for textContent or input values
 * - Objects for forms
 * - 1D arrays for lists
 * - 2D arrays for tables
 */

/** NOTE: this is all still very crude, might change dramatically, but a thin normalization layer over read/write for html has already proved very compelling for its utility */

export type IOData = string | number | boolean | { [key: string]: any } | any[][] | any[];

// Internal handler interface with proper typing
type IOHandler<T> = {
  get(element: T): IOData;
  set(element: T, value: IOData): void;
};

const handlers: {
  [K in keyof HTMLElementTagNameMap]?: IOHandler<HTMLElementTagNameMap[K]>;
} = {
  // Form controls with .value
  input: {
    get: (el) => el.value,
    set: (el, value) => {
      el.value = String(value);
    },
  },
  textarea: {
    get: (el) => el.value,
    set: (el, value) => {
      el.value = String(value);
    },
  },
  select: {
    get: (el) => el.value,
    set: (el, value) => {
      el.value = String(value);
    },
  },

  // Media elements with .src
  img: {
    get: (el) => el.src,
    set: (el, value) => {
      el.src = String(value);
    },
  },
  video: {
    get: (el) => el.src,
    set: (el, value) => {
      el.src = String(value);
    },
  },
  audio: {
    get: (el) => el.src,
    set: (el, value) => {
      el.src = String(value);
    },
  },

  // Canvas - data URL
  canvas: {
    get: (el) => el.toDataURL(),
    set: (el, value) => {
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

  // Lists - preserve existing elements where possible
  ol: {
    get: (el) => {
      const items = Array.from(el.querySelectorAll('li'));
      return items.map((item) => item.textContent || '');
    },
    set: (el, value) => {
      if (!Array.isArray(value)) return;

      const existingItems = Array.from(el.querySelectorAll('li'));

      // Update existing items
      value.forEach((item, index) => {
        if (index < existingItems.length) {
          existingItems[index].textContent = String(item);
        } else {
          // Add new item
          const li = document.createElement('li');
          li.textContent = String(item);
          li.contentEditable = 'true';
          li.addEventListener('input', () => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          el.appendChild(li);
        }
      });

      // Remove excess items
      for (let i = existingItems.length - 1; i >= value.length; i--) {
        existingItems[i].remove();
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  },
  ul: {
    get: (el) => {
      const items = Array.from(el.querySelectorAll('li'));
      return items.map((item) => item.textContent || '');
    },
    set: (el, value) => {
      if (!Array.isArray(value)) return;

      const existingItems = Array.from(el.querySelectorAll('li'));

      // Update existing items
      value.forEach((item, index) => {
        if (index < existingItems.length) {
          existingItems[index].textContent = String(item);
        } else {
          // Add new item
          const li = document.createElement('li');
          li.textContent = String(item);
          li.contentEditable = 'true';
          li.addEventListener('input', () => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          });
          el.appendChild(li);
        }
      });

      // Remove excess items
      for (let i = existingItems.length - 1; i >= value.length; i--) {
        existingItems[i].remove();
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  },

  // Form - key-value object
  form: {
    get: (el) => {
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
    set: (el, value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;

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
    },
  },

  // Table - 2D array, preserve structure where possible
  table: {
    get: (el) => {
      const rows = Array.from(el.querySelectorAll('tr'));
      return rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td, th'));
        return cells.map((cell) => cell.textContent || '');
      });
    },
    set: (el, value) => {
      if (!Array.isArray(value) || value.length === 0) return;

      const existingRows = Array.from(el.querySelectorAll('tr'));
      const hasHeaders = value.length > 1;

      // Update existing rows and cells
      value.forEach((rowData, rowIndex) => {
        if (!Array.isArray(rowData) || rowData.length === 0) return;

        let row: HTMLTableRowElement;
        if (rowIndex < existingRows.length) {
          row = existingRows[rowIndex];
        } else {
          // Create new row
          row = document.createElement('tr');
          if (hasHeaders && rowIndex === 0) {
            let thead = el.querySelector('thead');
            if (!thead) {
              thead = document.createElement('thead');
              el.appendChild(thead);
            }
            thead.appendChild(row);
          } else {
            let tbody = el.querySelector('tbody');
            if (!tbody) {
              tbody = document.createElement('tbody');
              el.appendChild(tbody);
            }
            tbody.appendChild(row);
          }
        }

        const existingCells = Array.from(row.querySelectorAll('td, th'));

        // Update existing cells
        rowData.forEach((cellData, cellIndex) => {
          if (cellIndex < existingCells.length) {
            existingCells[cellIndex].textContent = String(cellData);
          } else {
            // Add new cell
            const cellType = hasHeaders && rowIndex === 0 ? 'th' : 'td';
            const cell = document.createElement(cellType);
            cell.textContent = String(cellData);
            cell.contentEditable = 'true';
            cell.addEventListener('input', () => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
            });
            row.appendChild(cell);
          }
        });

        // Remove excess cells
        for (let i = existingCells.length - 1; i >= rowData.length; i--) {
          existingCells[i].remove();
        }
      });

      // Remove excess rows
      for (let i = existingRows.length - 1; i >= value.length; i--) {
        existingRows[i].remove();
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
  },
};

/**
 * Get standardized JSON data from any HTML element
 */
export function get(element: Element): IOData {
  const handler = handlers[element.tagName.toLowerCase() as keyof typeof handlers];
  if (handler) {
    return handler.get(element as any);
  }

  // Fallback: read textContent for any unhandled element
  return element.textContent || '';
}

/**
 * Set standardized JSON data to any HTML element
 */
export function set(element: Element, value: IOData): void {
  const handler = handlers[element.tagName.toLowerCase() as keyof typeof handlers];
  if (handler) {
    handler.set(element as any, value);
  } else {
    // Fallback: write to textContent for any unhandled element
    element.textContent = String(value);
  }
}
