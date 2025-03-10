/**
 * DataGlyph - A custom element for inline data visualizations
 *
 * Renders small, text-sized visualizations that flow with text content.
 * Supports multiple visualization types:
 * - line (default): Simple sparkline chart
 * - tree: Tiny tree visualization
 *
 * Usage:
 * <data-glyph data="3,6,2,7,5,9,4" width="3em"></data-glyph>
 * <data-glyph type="tree" data="[1,[2,3],[4,[5,6]]]" width="3em"></data-glyph>
 */
export class DataGlyph extends HTMLElement {
  static get observedAttributes() {
    return ['data', 'width', 'type'];
  }

  // Shadow DOM
  private shadow: ShadowRoot;

  // SVG elements
  private svg: SVGSVGElement;

  // Visualization type
  private type: 'line' | 'tree' = 'line';

  // Parsed data
  private dataPoints: number[] = [];
  private treeData: any = null;
  private width: string = '4em';

  // Drawing groups
  private lineGroup: SVGGElement | null = null;
  private dotGroup: SVGGElement | null = null;

  constructor() {
    super();

    // Create shadow DOM
    this.shadow = this.attachShadow({ mode: 'open' });

    // Create SVG element
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Set up standard viewBox and don't force aspect ratio preservation
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');

    // Create styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-block;
        width: var(--dataglyph-width, 4em);
        height: 1em;
        vertical-align: middle;
        position: relative;
        line-height: 0;
      }
      svg {
        position: absolute;
        width: 100%;
        height: 100%;
        left: 0;
        bottom: 0;
        overflow: visible;
      }
      .node, .point {
        fill: currentColor;
      }
      .link {
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
    `;

    // Append to shadow DOM
    this.shadow.appendChild(style);
    this.shadow.appendChild(this.svg);
  }

  connectedCallback() {
    // Check for type attribute
    if (this.hasAttribute('type')) {
      this.type = this.getAttribute('type') as 'line' | 'tree';
    }

    // Initial rendering
    this.parseData();
    this.updateStyles();
    this.render();

    // One-time font ready check
    if ('fonts' in document) {
      document.fonts.ready.then(() => this.updateStyles());
    }
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue === newValue) return;

    switch (name) {
      case 'data':
        this.parseData();
        this.render();
        break;
      case 'width':
        this.width = newValue || '4em';
        this.updateStyles();
        break;
      case 'type':
        this.type = (newValue as 'line' | 'tree') || 'line';
        this.parseData();
        this.render();
        break;
    }
  }

  private parseData() {
    const dataAttr = this.getAttribute('data');
    if (!dataAttr) return;

    // Common setup for all data parsing
    this.setupDataParsing();

    // Parse data based on type
    switch (this.type) {
      case 'line':
        this.parseLineData(dataAttr);
        break;
      case 'tree':
        this.parseTreeData(dataAttr);
        break;
    }
  }

  private setupDataParsing() {
    // Reset data structures
    if (this.type === 'line') {
      this.treeData = null;
    } else if (this.type === 'tree') {
      this.dataPoints = [];
    }
  }

  private parseLineData(dataAttr: string) {
    // Parse as array if comma-delimited string for line charts
    if (typeof dataAttr === 'string') {
      this.dataPoints = dataAttr.split(',').map((val) => parseFloat(val.trim()));
    } else if (Array.isArray(dataAttr)) {
      this.dataPoints = dataAttr;
    }
  }

  private parseTreeData(dataAttr: string) {
    // Parse as JSON for tree data
    try {
      this.treeData = JSON.parse(dataAttr);
    } catch (e) {
      console.error('Invalid tree data format', e);
      this.treeData = null;
    }
  }

  private updateStyles() {
    // Set width using CSS variable
    this.style.setProperty('--dataglyph-width', this.width);
    this.svg.setAttribute('viewBox', '0 0 100 100');
    this.svg.setAttribute('preserveAspectRatio', 'none');
  }

  private getStrokeWidth() {
    // Get computed font style
    const computedStyle = getComputedStyle(this);
    const fontSize = parseFloat(computedStyle.fontSize);

    // For 1-bit style, use a simple fixed percentage of font size
    // This creates a consistent stroke weight regardless of font weight
    return fontSize * 0.1; // 8% of font size for a crisp line
  }

  private render() {
    // Common setup for all types
    this.setupRender();

    // Render based on type
    switch (this.type) {
      case 'line':
        this.renderLineChart();
        break;
      case 'tree':
        this.renderTree();
        break;
    }
  }

  private setupRender() {
    // Clear previous content
    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }

    // Create groups for lines and dots - LINES FIRST so dots appear ON TOP
    this.lineGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.dotGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Add groups in correct order - lines BEFORE dots
    this.svg.appendChild(this.lineGroup);
    this.svg.appendChild(this.dotGroup);
  }

  private renderLineChart() {
    if (!this.dataPoints.length) return;

    // Set viewBox for consistent scaling
    const viewBoxWidth = 100;
    const viewBoxHeight = 100;
    this.svg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);

    if (!this.lineGroup || !this.dotGroup) return;

    // Normalize values to 0-1 range
    const normalizedValues = this.normalizeValues(this.dataPoints);

    // Create points for the path
    const points = normalizedValues.map((value, index) => {
      // Calculate x based on index, y based on normalized value
      // Leave 10% margin at top and bottom
      const x = index / (this.dataPoints.length - 1);
      const y = 1 - (value * 0.8 + 0.1); // Invert because SVG y is top-down, add margins

      return { x, y };
    });

    // Use drawPath utility to create the line
    this.drawPath(points, false);
  }

  private renderTree() {
    if (!this.treeData) return;

    // Analyze tree to understand its structure
    const analysis = this.analyzeTreeStructure(this.treeData);

    // Maximum tree depth including root
    const maxDepth = analysis.depth + 1;

    // Adjust margins to ensure all content stays within the 0-1 range
    // Top margin - position root node slightly down from the top
    const topMargin = 0.1;

    // Adjusted bottom margin to prevent overflow
    // Leave more bottom margin to ensure even deep trees stay within bounds
    const bottomY = 0.9; // 20% margin from bottom

    // Calculate vertical spacing based on available space and depth
    // Ensure the spacing doesn't push nodes below the bottom margin
    const availableHeight = bottomY - topMargin;
    const verticalSpacing = availableHeight / Math.max(1, maxDepth - 1);

    // Use slightly less width for the tree to prevent horizontal overflow
    const treeWidth = 1; // 7.5% margin on each side

    // Function to recursively render tree nodes with proper spacing
    const renderNode = (node: any, x: number, y: number, width: number, depth: number = 0, maxDepth: number) => {
      if (!node) return;

      // Create the node using the drawPoint utility
      this.drawPoint(x, y, true);

      if (Array.isArray(node)) {
        const children = node.slice(1);

        if (children.length > 0) {
          // Calculate position for children based on depth
          // For leaf nodes (at maxDepth-1), position at bottom
          // For intermediate nodes, position proportionally
          const childY =
            depth === maxDepth - 2
              ? bottomY // Position leaves at bottom
              : y + verticalSpacing; // Regular spacing for other levels

          // Distribute children evenly across the allocated width
          const childWidth = width / children.length;

          // Draw children
          children.forEach((child, i) => {
            const childX = x - width / 2 + childWidth * (i + 0.5);

            // Draw connecting line
            this.drawLine(x, y, childX, childY, false);

            // Recurse to child
            renderNode(child, childX, childY, childWidth, depth + 1, maxDepth);
          });
        }
      }
    };

    // Render tree with root at the top and centered horizontally
    renderNode(this.treeData, 0.5, topMargin, treeWidth, 0, maxDepth);
  }

  private analyzeTreeStructure(node: any): { depth: number; leafCount: number } {
    if (!node) {
      return { depth: 0, leafCount: 0 };
    }

    if (!Array.isArray(node) || node.length <= 1) {
      return { depth: 0, leafCount: 1 };
    }

    const children = node.slice(1);
    if (children.length === 0) {
      return { depth: 0, leafCount: 1 };
    }

    // Analyze each child
    const childAnalysis = children.map((child) => this.analyzeTreeStructure(child));

    // Determine maximum depth and total leaf count
    const maxChildDepth = Math.max(...childAnalysis.map((a) => a.depth));
    const totalLeafCount = childAnalysis.reduce((sum, a) => sum + a.leafCount, 0);

    return {
      depth: maxChildDepth + 1,
      leafCount: totalLeafCount,
    };
  }

  // Public API for programmatic updates
  set data(value: number[] | string | any) {
    switch (this.type) {
      case 'line':
        if (typeof value === 'string') {
          this.setAttribute('data', value);
        } else if (Array.isArray(value)) {
          this.setAttribute('data', value.join(','));
        }
        break;
      case 'tree':
        this.setAttribute('data', JSON.stringify(value));
        break;
    }
  }

  get data(): any {
    return this.type === 'line' ? this.dataPoints : this.treeData;
  }

  /**
   * Drawing API
   * These methods provide a simple way to draw custom visualizations
   * using relative coordinates (0-1) within the element bounds
   */

  /**
   * Converts a relative x coordinate (0-1) to SVG x coordinate
   */
  private relativeToSvgX(x: number): number {
    return x * 100;
  }

  /**
   * Converts a relative y coordinate (0-1) to SVG y coordinate
   */
  private relativeToSvgY(y: number): number {
    return y * 100;
  }

  /**
   * Draws a line between two points using relative coordinates (0-1)
   * @param x1 Starting X coordinate (0-1)
   * @param y1 Starting Y coordinate (0-1)
   * @param x2 Ending X coordinate (0-1)
   * @param y2 Ending Y coordinate (0-1)
   * @param dotted Whether the line should be dotted (default: false)
   * @returns The created SVG path element
   */
  public drawLine(x1: number, y1: number, x2: number, y2: number, dotted: boolean = false): SVGPathElement {
    // Ensure drawing groups exist
    if (!this.lineGroup) {
      this.setupRender();
    }

    // Convert relative coordinates to SVG coordinates
    const svgX1 = this.relativeToSvgX(x1);
    const svgY1 = this.relativeToSvgY(y1);
    const svgX2 = this.relativeToSvgX(x2);
    const svgY2 = this.relativeToSvgY(y2);

    // Create the line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', `M ${svgX1},${svgY1} L ${svgX2},${svgY2}`);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', this.getStrokeWidth().toString());
    line.classList.add('link');

    // Apply dotted style if requested
    if (dotted) {
      line.setAttribute('stroke-dasharray', '3,3');
    }

    // Add to line group
    this.lineGroup?.appendChild(line);

    return line;
  }

  /**
   * Draws a path through multiple points using relative coordinates (0-1)
   * @param points Array of points with relative x, y coordinates (0-1)
   * @param dotted Whether the path should be dotted (default: false)
   * @returns The created SVG path element
   */
  public drawPath(points: { x: number; y: number }[], dotted: boolean = false): SVGPathElement {
    // Ensure drawing groups exist
    if (!this.lineGroup) {
      this.setupRender();
    }

    if (points.length < 2) {
      console.error('drawPath requires at least 2 points');
      return document.createElementNS('http://www.w3.org/2000/svg', 'path');
    }

    // Convert relative coordinates to SVG coordinates
    const svgPoints = points.map((p) => ({
      x: this.relativeToSvgX(p.x),
      y: this.relativeToSvgY(p.y),
    }));

    // Create the path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    // Create SVG path data
    const pathData = `M ${svgPoints.map((p) => `${p.x},${p.y}`).join(' L ')}`;
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', this.getStrokeWidth().toString());
    path.classList.add('link');

    // Apply dotted style if requested
    if (dotted) {
      path.setAttribute('stroke-dasharray', '3,3');
    }

    // Add to line group
    this.lineGroup?.appendChild(path);

    return path;
  }

  /**
   * Draws a circle at a point using relative coordinates (0-1)
   * @param x X coordinate (0-1)
   * @param y Y coordinate (0-1)
   * @param filled Whether the circle should be filled (default: true)
   * @returns The created SVG circle element
   */
  public drawPoint(x: number, y: number, filled: boolean = true): SVGCircleElement {
    // Ensure drawing groups exist
    if (!this.dotGroup) {
      this.setupRender();
    }

    // Convert relative coordinates to SVG coordinates
    const svgX = this.relativeToSvgX(x);
    const svgY = this.relativeToSvgY(y);

    // Calculate radius
    const strokeWidth = this.getStrokeWidth();
    const radius = strokeWidth * 2;

    // Create the circle
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', svgX.toString());
    dot.setAttribute('cy', svgY.toString());
    dot.setAttribute('r', radius.toString());

    // Apply a transformation to correct the aspect ratio for circles
    // Get the computed dimensions of the component to calculate the aspect ratio
    const computedStyle = getComputedStyle(this);
    const width = parseFloat(computedStyle.width);
    const height = parseFloat(computedStyle.height);
    const aspectRatio = width / height;

    // Apply the scale transform with the center of the circle as the transform origin
    // This ensures the circle stays in place and only its shape is affected
    dot.setAttribute('transform', `translate(${svgX}, ${svgY}) scale(1, ${aspectRatio}) translate(-${svgX}, -${svgY})`);

    dot.classList.add('point');

    // Apply filled or outline style
    if (filled) {
      dot.setAttribute('fill', 'currentColor');
      dot.setAttribute('stroke', 'none');
    } else {
      dot.setAttribute('fill', 'none');
      dot.setAttribute('stroke', 'currentColor');
      dot.setAttribute('stroke-width', strokeWidth.toString());
    }

    // Add to dot group
    this.dotGroup?.appendChild(dot);

    return dot;
  }

  /**
   * Normalizes an array of numbers to the 0-1 range
   * @param values Array of numbers to normalize
   * @returns Array of normalized values between 0 and 1
   */
  private normalizeValues(values: number[]): number[] {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);

    // If all values are the same, return array of 0.5
    if (min === max) {
      return values.map(() => 0.5);
    }

    // Scale to 0-1 range
    return values.map((value) => (value - min) / (max - min));
  }
}

// Register the custom element
if (!customElements.get('data-glyph')) {
  customElements.define('data-glyph', DataGlyph);
}
