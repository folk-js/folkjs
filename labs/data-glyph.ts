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

    // Observe font changes
    if ('fonts' in document) {
      document.fonts.ready.then(() => this.updateStyles());
    }

    // Set up a mutation observer for parent element style changes
    this.observeStyleChanges();
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

    // Update stroke width based on font weight
    this.updateStrokeWidth();
  }

  private updateStrokeWidth() {
    // Get computed font style of the parent or host element
    const computedStyle = getComputedStyle(this);
    const fontWeight = computedStyle.fontWeight;
    const fontSize = parseFloat(computedStyle.fontSize);

    // Convert font weight to a number if it's a string
    let numericWeight = parseInt(fontWeight, 10);
    if (isNaN(numericWeight)) {
      // Handle named weights
      numericWeight = fontWeight === 'bold' ? 700 : 400; // Default to 400 for 'normal' or other values
    }

    // Significantly increase the base stroke width
    const baseStrokeWidth = fontSize * 0.15; // Doubled from 0.075 to 0.15 (15% of font size)

    // Adjust the weight factor with a minimum value to ensure even light text has visible lines
    const weightFactor = Math.max(0.8, numericWeight / 400); // Minimum factor of 0.8

    // Calculate stroke width with a minimum floor
    const strokeWidth = Math.max(1.5, baseStrokeWidth * weightFactor);

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

  private observeStyleChanges() {
    // Create a MutationObserver to watch for style changes in the parent element
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;

      for (const mutation of mutations) {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'style' || mutation.attributeName === 'class')
        ) {
          shouldUpdate = true;
          break;
        }
      }

      if (shouldUpdate) {
        this.updateStrokeWidth();
      }
    });

    // Start observing the parent element for style changes
    if (this.parentElement) {
      observer.observe(this.parentElement, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }

    // Also observe the document's body for global style changes
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
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
