/**
 * DataGlyph - A custom element for inline data visualizations
 *
 * Renders small, text-sized visualizations that flow with text content.
 * Supports multiple visualization types:
 * - line (default): Simple sparkline chart
 * - tree: Tiny tree visualization where node values determine appearance:
 *   - 0: Hollow blue node
 *   - 1: Filled red node
 *
 * Usage:
 * <data-glyph data="3,6,2,7,5,9,4" width="3em"></data-glyph>
 * <data-glyph type="tree" data="[1,[0],[1]]" width="3em"></data-glyph>
 */
export class DataGlyph extends HTMLElement {
  static get observedAttributes() {
    return ['data', 'width', 'type'];
  }

  // Baseline offset for font adjustment (percentage of em height)
  // This determines the distance from the font baseline to the bottom of the container
  private static readonly BASELINE_OFFSET: number = 0.25; // 25% of em height

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
    // Format: Nested arrays where:
    // - For nodes: 0 = hollow blue node, 1 = filled red node
    // - Example: [1,[0,[1],[0]],[1,[0]]] - Root is filled red, with two children
    //   First child is hollow blue with two children (one filled red, one hollow blue)
    //   Second child is filled red with one hollow blue child
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
    const topMargin = 0.1; // Root node position
    const bottomY = 0.9; // Leaf nodes position
    const leftX = 0.05; // Left boundary
    const rightX = 0.95; // Right boundary

    // Available dimensions
    const availableHeight = bottomY - topMargin;
    const availableWidth = rightX - leftX;

    // First, count total leaf nodes to determine spacing
    const countLeafNodes = (node: any): number => {
      if (!node) return 0;
      if (!Array.isArray(node) || node.length <= 1) return 1;

      const children = node.slice(1).filter(Boolean);
      if (children.length === 0) return 1;

      return children.reduce((sum, child) => sum + countLeafNodes(child), 0);
    };

    // Store all leaf nodes to position them later
    const leafNodes: any[] = [];

    // Collect all leaf nodes
    const collectLeafNodes = (node: any) => {
      if (!node) return;

      if (!Array.isArray(node) || node.length <= 1) {
        leafNodes.push(node);
        return;
      }

      const children = node.slice(1).filter(Boolean);
      if (children.length === 0) {
        leafNodes.push(node);
        return;
      }

      children.forEach(collectLeafNodes);
    };

    collectLeafNodes(this.treeData);

    // Pre-calculate node positions for the entire tree
    const nodePositions: Map<string, { x: number; y: number }> = new Map();
    const nodeIds: Map<any, string> = new Map();
    let nextId = 0;

    // Position leaf nodes evenly across the available width
    for (let i = 0; i < leafNodes.length; i++) {
      const node = leafNodes[i];
      const nodeId = `node_${nextId++}`;
      nodeIds.set(node, nodeId);

      // Calculate position based on leaf index
      let x: number;
      if (leafNodes.length === 1) {
        x = 0.5; // Center single leaf
      } else {
        // Distribute evenly from left to right
        x = leftX + (availableWidth * i) / (leafNodes.length - 1);
      }

      nodePositions.set(nodeId, { x, y: bottomY });
    }

    // Calculate positions for non-leaf nodes
    const calculateIntermediateNodePositions = (node: any, depth: number): string => {
      if (!node) return '';

      // If this node already has an ID (it's a leaf), return it
      if (nodeIds.has(node)) {
        return nodeIds.get(node) || '';
      }

      // Generate a unique ID for this node
      const nodeId = `node_${nextId++}`;
      nodeIds.set(node, nodeId);

      // Calculate Y position based on depth
      const y = depth === 0 ? topMargin : topMargin + (availableHeight * depth) / (maxDepth - 1);

      // For non-array nodes or empty arrays at non-leaf levels
      if (!Array.isArray(node) || node.length <= 1) {
        nodePositions.set(nodeId, { x: 0.5, y });
        return nodeId;
      }

      // Extract children
      const children = node.slice(1).filter(Boolean);

      // For nodes with no children
      if (children.length === 0) {
        nodePositions.set(nodeId, { x: 0.5, y });
        return nodeId;
      }

      // Process children recursively
      const childIds = children
        .map((child) => calculateIntermediateNodePositions(child, depth + 1))
        .filter((id) => id !== '');

      // Calculate X position as average of children's X positions
      if (childIds.length > 0) {
        const childXs = childIds.map((id) => nodePositions.get(id)?.x || 0);
        const avgX = childXs.reduce((sum, x) => sum + x, 0) / childXs.length;
        nodePositions.set(nodeId, { x: avgX, y });
      } else {
        // Default position if no children data available
        nodePositions.set(nodeId, { x: 0.5, y });
      }

      return nodeId;
    };

    // Start by positioning all leaf nodes, then work upward
    if (this.treeData) {
      // Special case for root
      if (maxDepth === 1) {
        const rootId = `node_${nextId++}`;
        nodeIds.set(this.treeData, rootId);
        nodePositions.set(rootId, { x: 0.5, y: topMargin });
      } else {
        calculateIntermediateNodePositions(this.treeData, 0);
      }
    }

    // Second pass: Draw all nodes and connections
    const drawnPositions = new Set<string>();

    const drawNodeAndConnections = (node: any, parentId: string | null = null): void => {
      if (!node) return;

      const nodeId = nodeIds.get(node);
      if (!nodeId || !nodePositions.has(nodeId)) return;

      const { x, y } = nodePositions.get(nodeId)!;

      // Get the node value to determine if it should be filled
      // If node is an array, the first element is the value
      // Otherwise, the node itself is the value
      let nodeValue = Array.isArray(node) ? node[0] : node;

      // Determine if the node should be filled (1) or hollow (0)
      const isFilled = nodeValue === 1;

      // Create a position key to avoid duplicate nodes
      const posKey = `${x.toFixed(4)},${y.toFixed(4)}`;

      // Only draw if we haven't already drawn at this position
      if (!drawnPositions.has(posKey)) {
        drawnPositions.add(posKey);
        this.drawPoint(x, y, isFilled);
      }

      // Draw connection to parent
      if (parentId) {
        const parentPos = nodePositions.get(parentId);
        if (parentPos) {
          this.drawLine(parentPos.x, parentPos.y, x, y, false, 0.8);
        }
      }

      // Recursively process children
      if (Array.isArray(node)) {
        const children = node.slice(1).filter(Boolean);
        children.forEach((child) => {
          drawNodeAndConnections(child, nodeId);
        });
      }
    };

    // Start drawing from the root
    drawNodeAndConnections(this.treeData);
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
   * Applies baseline offset adjustment
   */
  private relativeToSvgY(y: number): number {
    // Apply the baseline offset adjustment
    // This scales the y coordinate to stay within the visible part of the SVG
    // which accounts for the baseline offset
    return y * 100 * (1 - DataGlyph.BASELINE_OFFSET);
  }

  /**
   * Draws a line between two points using relative coordinates (0-1)
   * @param x1 Starting X coordinate (0-1)
   * @param y1 Starting Y coordinate (0-1)
   * @param x2 Ending X coordinate (0-1)
   * @param y2 Ending Y coordinate (0-1)
   * @param dotted Whether the line should be dotted (default: false)
   * @param thicknessMultiplier Multiplier for stroke width (default: 1)
   * @returns The created SVG path element
   */
  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dotted: boolean = false,
    thicknessMultiplier: number = 1,
  ): SVGPathElement {
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
    line.setAttribute('stroke-width', (this.getStrokeWidth() * thicknessMultiplier).toString());
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
   * @param thicknessMultiplier Multiplier for stroke width (default: 1)
   * @returns The created SVG path element
   */
  public drawPath(
    points: { x: number; y: number }[],
    dotted: boolean = false,
    thicknessMultiplier: number = 1,
  ): SVGPathElement {
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
    path.setAttribute('stroke-width', (this.getStrokeWidth() * thicknessMultiplier).toString());
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

    // Apply filled or outline style (will be overridden if specific colors are set later)
    if (filled) {
      dot.setAttribute('fill', 'currentColor');
      dot.setAttribute('stroke', 'currentColor');
    } else {
      // Create a mask effect by using a slightly larger white circle underneath
      // to "cut through" any lines, then draw the outline on top

      // First, create a slightly larger background circle to mask the lines
      const maskCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      maskCircle.setAttribute('cx', svgX.toString());
      maskCircle.setAttribute('cy', svgY.toString());
      maskCircle.setAttribute('r', (radius + strokeWidth / 2).toString());
      maskCircle.setAttribute('fill', 'var(--background-color, white)');
      maskCircle.setAttribute('transform', dot.getAttribute('transform') || '');

      // Add the mask circle first (before the outlined circle)
      this.dotGroup?.appendChild(maskCircle);

      // Then set up the hollow circle with transparent fill and visible stroke
      dot.setAttribute('fill', 'transparent');
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
