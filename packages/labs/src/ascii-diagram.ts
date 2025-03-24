// e.g:
// <ascii-diagram width="80" height="10">
// <!-- QR 1 -->
// BOX 0 0 13 10 <br />
// BOX 1 1 11 3 ACK <br />
// BOX 1 4 11 5 CHUNK <br />
// <!-- QR 2 -->
// BOX 30 0 13 10 <br />
// BOX 31 1 11 3 ACK <br />
// BOX 31 4 11 5 CHUNK <br />
// <!-- Arrows -->
// ARROW 11 5 19 -3 h(i,chunk) <br />
// </ascii-diagram>

export class AsciiDiagram extends HTMLElement {
  private grid: string[][] = [];
  private width: number = 80;
  private height: number = 20;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  static get observedAttributes() {
    return ['width', 'height'];
  }

  connectedCallback() {
    this.width = parseInt(this.getAttribute('width') || '80');
    this.height = parseInt(this.getAttribute('height') || '20');
    this.render();
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue) {
      if (name === 'width') {
        this.width = parseInt(newValue || '80');
      } else if (name === 'height') {
        this.height = parseInt(newValue || '20');
      }
      this.render();
    }
  }

  private initializeGrid() {
    this.grid = Array(this.height)
      .fill(null)
      .map(() => Array(this.width).fill(' '));
  }

  private render() {
    if (!this.shadowRoot) return;

    this.initializeGrid();
    const content = this.textContent || '';

    // Parse each line of the content
    const lines = content.trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const command = parts[0].toUpperCase();
      const x = parseInt(parts[1]);
      const y = parseInt(parts[2]);
      const width = parseInt(parts[3]);
      const height = parseInt(parts[4]);

      // Calculate x2, y2 from x, y, width, height
      const x2 = x + width - 1;
      const y2 = y + height - 1;

      // Extract the text (everything after the coordinates)
      const text = parts.slice(5).join(' ');

      switch (command) {
        case 'BOX':
          this.drawBox(x, y, x2, y2, text);
          break;
        case 'LINE':
          // For LINE, interpret as start(x,y) to end(x+width,y+height)
          this.drawLine(x, y, x + width, y + height, text);
          break;
        case 'ARROW':
          // For ARROW, interpret as start(x,y) to end(x+width,y+height)
          this.drawArrow(x, y, x + width, y + height, text);
          break;
        case 'TEXT':
          this.drawText(x, y, x2, y2, text);
          break;
      }
    }

    // Convert grid to HTML
    const pre = document.createElement('pre');
    pre.style.fontFamily = 'monospace';
    pre.style.whiteSpace = 'pre';
    pre.style.margin = '0';
    pre.style.padding = '8px';
    pre.style.backgroundColor = '#f5f5f5';
    pre.style.border = '1px solid #ddd';
    pre.style.borderRadius = '4px';
    pre.style.overflow = 'auto';

    pre.textContent = this.grid.map((row) => row.join('')).join('\n');

    // Clear and append
    this.shadowRoot.innerHTML = '';
    this.shadowRoot.appendChild(pre);
  }

  private drawBox(x1: number, y1: number, x2: number, y2: number, text: string = '') {
    // Ensure coordinates are within grid
    x1 = Math.max(0, Math.min(x1, this.width - 1));
    y1 = Math.max(0, Math.min(y1, this.height - 1));
    x2 = Math.max(0, Math.min(x2, this.width - 1));
    y2 = Math.max(0, Math.min(y2, this.height - 1));

    // Draw horizontal lines
    for (let x = x1 + 1; x < x2; x++) {
      this.grid[y1][x] = '─';
      this.grid[y2][x] = '─';
    }

    // Draw vertical lines
    for (let y = y1 + 1; y < y2; y++) {
      this.grid[y][x1] = '│';
      this.grid[y][x2] = '│';
    }

    // Draw corners
    this.grid[y1][x1] = '┌';
    this.grid[y1][x2] = '┐';
    this.grid[y2][x1] = '└';
    this.grid[y2][x2] = '┘';

    // Add text if provided
    if (text) {
      this.drawText(x1 + 1, y1 + 1, x2 - 1, y2 - 1, text);
    }
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number, text: string = '') {
    // Ensure coordinates are within grid
    x1 = Math.max(0, Math.min(x1, this.width - 1));
    y1 = Math.max(0, Math.min(y1, this.height - 1));
    x2 = Math.max(0, Math.min(x2, this.width - 1));
    y2 = Math.max(0, Math.min(y2, this.height - 1));

    // Simple line drawing algorithm (Bresenham)
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const sx = x1 < x2 ? 1 : -1;
    const sy = y1 < y2 ? 1 : -1;
    let err = dx - dy;

    let currentX = x1;
    let currentY = y1;

    while (currentX !== x2 || currentY !== y2) {
      this.grid[currentY][currentX] = this.getLineChar(currentX, currentY, currentX + sx, currentY + sy);

      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        currentX += sx;
      }
      if (e2 < dx) {
        err += dx;
        currentY += sy;
      }
    }

    // Add text if provided
    if (text) {
      const midX = Math.floor((x1 + x2) / 2);
      const midY = Math.floor((y1 + y2) / 2);
      this.placeTextNearPoint(midX, midY, text);
    }
  }

  private getLineChar(x1: number, y1: number, x2: number, y2: number): string {
    if (x1 === x2) return '│'; // Vertical line
    if (y1 === y2) return '─'; // Horizontal line
    return ' '; // No diagonal lines
  }

  private drawArrow(x1: number, y1: number, x2: number, y2: number, text: string = '') {
    if (x1 !== x2 && y1 !== y2) {
      // Determine which dimension has the larger difference
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);

      // Define midpoints at outer scope so they're available everywhere
      let midX: number;
      let midY: number;

      // Depending on which dimension is larger, route differently
      if (dx > dy) {
        // Route horizontally first, then vertically
        midX = Math.floor((x1 + x2) / 2);
        midY = y2; // Define midY for this case

        // Draw horizontal segment first
        for (let x = Math.min(x1, midX) + 1; x < Math.max(x1, midX); x++) {
          this.grid[y1][x] = '─';
        }

        // Draw vertical segment
        for (let y = Math.min(y1, y2) + 1; y < Math.max(y1, y2); y++) {
          this.grid[y][midX] = '│';
        }

        // Draw second horizontal segment
        for (let x = Math.min(midX, x2) + 1; x < Math.max(midX, x2); x++) {
          this.grid[y2][x] = '─';
        }

        // Place corner characters
        if (x1 < midX) {
          // First corner
          this.grid[y1][midX] = y1 < y2 ? '┐' : '┘';
        } else {
          // First corner
          this.grid[y1][midX] = y1 < y2 ? '┌' : '└';
        }

        if (midX < x2) {
          // Second corner
          this.grid[y2][midX] = y1 < y2 ? '└' : '┌';
        } else {
          // Second corner
          this.grid[y2][midX] = y1 < y2 ? '┘' : '┐';
        }

        // Add text
        if (text) {
          if (dx > dy) {
            // For horizontally-dominant arrows, center text on the middle of the first horizontal segment
            const textY = Math.max(0, y1 - 1); // Place text slightly above the horizontal line
            const textX = Math.floor((x1 + midX) / 2);
            this.placeTextNearPoint(textX, textY, text);
          } else {
            // For vertically-dominant arrows, center text on the middle of the horizontal segment
            const textX = Math.floor((x1 + x2) / 2);
            this.placeTextNearPoint(textX, midY, text);
          }
        }
      } else {
        // Route vertically first, then horizontally
        midY = Math.floor((y1 + y2) / 2);
        midX = x2; // Define midX for this case

        // Draw vertical segment first
        for (let y = Math.min(y1, midY) + 1; y < Math.max(y1, midY); y++) {
          this.grid[y][x1] = '│';
        }

        // Draw horizontal segment
        for (let x = Math.min(x1, x2) + 1; x < Math.max(x1, x2); x++) {
          this.grid[midY][x] = '─';
        }

        // Draw second vertical segment
        for (let y = Math.min(midY, y2) + 1; y < Math.max(midY, y2); y++) {
          this.grid[y][x2] = '│';
        }

        // Place corner characters
        if (y1 < midY) {
          // First corner
          this.grid[midY][x1] = x1 < x2 ? '└' : '┘';
        } else {
          // First corner
          this.grid[midY][x1] = x1 < x2 ? '┌' : '┐';
        }

        if (midY < y2) {
          // Second corner
          this.grid[midY][x2] = x1 < x2 ? '┐' : '┌';
        } else {
          // Second corner
          this.grid[midY][x2] = x1 < x2 ? '┘' : '└';
        }

        // Add text
        if (text) {
          if (dx > dy) {
            // For horizontally-dominant arrows, center text on the middle of the first horizontal segment
            const textY = Math.max(0, y1 - 1); // Place text slightly above the horizontal line
            const textX = Math.floor((x1 + midX) / 2);
            this.placeTextNearPoint(textX, textY, text);
          } else {
            // For vertically-dominant arrows, center text on the middle of the horizontal segment
            const textX = Math.floor((x1 + x2) / 2);
            this.placeTextNearPoint(textX, midY, text);
          }
        }
      }

      if (dx > dy) {
        this.drawArrowhead(x2, y2, x2, midX);
      } else {
        this.drawArrowhead(x2, y2, x2, midY);
      }
    } else {
      // Straight arrow (either horizontal or vertical)
      this.drawLine(x1, y1, x2, y2, '');
      this.drawArrowhead(x2, y2, x1, y1);

      if (text) {
        const midX = Math.floor((x1 + x2) / 2);
        const midY = Math.floor((y1 + y2) / 2);
        this.placeTextNearPoint(midX, midY, text);
      }
    }
  }

  private drawArrowhead(x: number, y: number, fromX: number, fromY: number) {
    // Determine direction and place appropriate arrow character
    if (x > fromX && y === fromY) {
      // Right
      this.grid[y][x] = '▲';
    } else if (x < fromX && y === fromY) {
      // Left
      this.grid[y][x] = '◄';
    } else if (x === fromX && y > fromY) {
      // Down
      this.grid[y][x] = '▼';
    } else if (x === fromX && y < fromY) {
      // Up
      this.grid[y][x] = '►';
    }
  }

  private drawText(x1: number, y1: number, x2: number, y2: number, text: string) {
    // Ensure coordinates are within grid
    x1 = Math.max(0, Math.min(x1, this.width - 1));
    y1 = Math.max(0, Math.min(y1, this.height - 1));
    x2 = Math.max(0, Math.min(x2, this.width - 1));
    y2 = Math.max(0, Math.min(y2, this.height - 1));

    // Calculate available space
    const boxWidth = x2 - x1 + 1;
    const boxHeight = y2 - y1 + 1;

    if (boxWidth <= 0 || boxHeight <= 0 || !text) return;

    // Word-wrap the text
    const words = text.split(' ');
    let currentLine = '';
    let currentY = y1;

    for (const word of words) {
      // Check if adding this word exceeds the box width
      if ((currentLine + (currentLine ? ' ' : '') + word).length <= boxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        // Place the current line and start a new one
        if (currentY <= y2) {
          this.placeLine(x1, currentY, currentLine, boxWidth);
          currentY++;
          currentLine = word;
        } else {
          // Out of vertical space
          break;
        }
      }
    }

    // Place the last line
    if (currentLine && currentY <= y2) {
      this.placeLine(x1, currentY, currentLine, boxWidth);
    }
  }

  private placeLine(x: number, y: number, text: string, maxWidth: number) {
    if (y < 0 || y >= this.height) return;

    // Center the text horizontally within the available space
    const paddingLeft = Math.floor((maxWidth - text.length) / 2);
    const startX = x + paddingLeft;

    for (let i = 0; i < text.length; i++) {
      const posX = startX + i;
      if (posX >= 0 && posX < this.width) {
        this.grid[y][posX] = text[i];
      }
    }
  }

  private placeTextNearPoint(x: number, y: number, text: string) {
    // Try placing text to the right
    if (x + 1 + text.length < this.width) {
      for (let i = 0; i < text.length; i++) {
        this.grid[y][x + 1 + i] = text[i];
      }
      return;
    }

    // Try placing text to the left
    if (x - text.length >= 0) {
      for (let i = 0; i < text.length; i++) {
        this.grid[y][x - text.length + i] = text[i];
      }
      return;
    }

    // Try placing text above
    if (y > 0) {
      const startX = Math.max(0, x - Math.floor(text.length / 2));
      const endX = Math.min(this.width - 1, startX + text.length - 1);
      const textToPlace = text.substring(0, endX - startX + 1);

      for (let i = 0; i < textToPlace.length; i++) {
        this.grid[y - 1][startX + i] = textToPlace[i];
      }
      return;
    }

    // Try placing text below
    if (y < this.height - 1) {
      const startX = Math.max(0, x - Math.floor(text.length / 2));
      const endX = Math.min(this.width - 1, startX + text.length - 1);
      const textToPlace = text.substring(0, endX - startX + 1);

      for (let i = 0; i < textToPlace.length; i++) {
        this.grid[y + 1][startX + i] = textToPlace[i];
      }
    }
  }
}

// Register the custom element
customElements.define('ascii-diagram', AsciiDiagram);
