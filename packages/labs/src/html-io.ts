// Element I/O type definitions
export interface ElementIO {
  getValue(element: Element, inputValue?: any): any | Promise<any>;
  setValue(element: Element, value: any): void | Promise<void>;
  getChangeEventName(element: Element): string;
}

// Standard I/O mappings for different element types
export const ELEMENT_IO_MAP: Map<string, ElementIO> = new Map([
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
