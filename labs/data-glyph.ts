/**
 * DataGlyph - A custom element for inline data visualizations
 *
 * Renders small, text-sized visualizations that flow with text content.
 * Currently supports a line-type visualization (sparkline).
 *
 * Usage:
 * <p>Sales have been trending <data-glyph data="3,6,2,7,5,9,4" width="3em"></data-glyph> over the past week.</p>
 */
export class DataGlyph extends HTMLElement {
  static get observedAttributes() {
    return ['data', 'width'];
  }

  // Shadow DOM
  private shadow: ShadowRoot;

  // SVG elements
  private svg: SVGSVGElement;
  private path: SVGPathElement;

  // Parsed data
  private dataPoints: number[] = [];
  private width: string = '4em';

  constructor() {
    super();

    // Create shadow DOM
    this.shadow = this.attachShadow({ mode: 'open' });

    // Create SVG elements
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    // Set up SVG structure
    this.svg.appendChild(this.path);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.path.setAttribute('fill', 'none');
    this.path.setAttribute('stroke', 'currentColor');
    this.path.setAttribute('stroke-linecap', 'round');
    this.path.setAttribute('stroke-linejoin', 'round');

    // Create styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-block;
        width: var(--dataglyph-width, 4em);
        height: 1em;
        vertical-align: baseline;
        position: relative;
        line-height: 0; /* Prevent line height issues */
      }
      svg {
        position: absolute;
        width: 100%;
        height: 100%;
        left: 0;
        bottom: 0;
        overflow: visible;
      }
    `;

    // Append to shadow DOM
    this.shadow.appendChild(style);
    this.shadow.appendChild(this.svg);
  }

  connectedCallback() {
    // Initial rendering
    this.parseData();
    this.updateStyles();
    this.renderPath();

    // One-time font ready check
    if ('fonts' in document) {
      document.fonts.ready.then(() => this.updateStyles());
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return;

    if (name === 'data') {
      this.parseData();
      this.renderPath();
    } else if (name === 'width') {
      this.width = newValue || '4em';
      this.updateStyles();
    }
  }

  private parseData() {
    const dataAttr = this.getAttribute('data');
    if (!dataAttr) return;

    // Parse as array if comma-delimited string
    if (typeof dataAttr === 'string') {
      this.dataPoints = dataAttr.split(',').map((val) => parseFloat(val.trim()));
    } else if (Array.isArray(dataAttr)) {
      this.dataPoints = dataAttr;
    }
  }

  private updateStyles() {
    // Set width using CSS variable
    this.style.setProperty('--dataglyph-width', this.width);

    // Adjust SVG viewBox
    this.svg.setAttribute('viewBox', `0 0 100 100`);

    // Set stroke width based on font properties - calculated once at init/update
    this.setStrokeWidth();
  }

  private setStrokeWidth() {
    // Get computed font style
    const computedStyle = getComputedStyle(this);
    const fontWeight = computedStyle.fontWeight;
    const fontSize = parseFloat(computedStyle.fontSize);

    // Convert font weight to a number if it's a string
    let numericWeight = parseInt(fontWeight, 10);
    if (isNaN(numericWeight)) {
      // Handle named weights
      numericWeight = fontWeight === 'bold' ? 700 : 400; // Default to 400 for 'normal' or other values
    }

    // Use a more generous base stroke width
    const baseStrokeWidth = fontSize * 0.2; // 20% of font size

    // Scale based on font weight but ensure it's never too thin
    const weightFactor = Math.max(1.0, numericWeight / 400);

    // Calculate stroke width with a minimum floor
    const strokeWidth = Math.max(2, baseStrokeWidth * weightFactor);

    // Set the stroke width
    this.path.setAttribute('stroke-width', strokeWidth.toString());
  }

  private renderPath() {
    if (!this.dataPoints.length) return;

    // Find min/max values for normalization
    const min = Math.min(...this.dataPoints);
    const max = Math.max(...this.dataPoints);
    const range = max - min || 1; // Prevent division by zero

    // Create points for the path
    const points = this.dataPoints.map((value, index) => {
      const x = (index / (this.dataPoints.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 80; // Leave 10% margin top/bottom
      return `${x},${y}`;
    });

    // Create SVG path
    const pathData = `M ${points.join(' L ')}`;
    this.path.setAttribute('d', pathData);
  }

  // Public API for programmatic updates
  set data(value: number[] | string) {
    if (typeof value === 'string') {
      this.setAttribute('data', value);
    } else if (Array.isArray(value)) {
      this.setAttribute('data', value.join(','));
    }
  }

  get data(): number[] {
    return this.dataPoints;
  }
}

// Register the custom element
if (!customElements.get('data-glyph')) {
  customElements.define('data-glyph', DataGlyph);
}
