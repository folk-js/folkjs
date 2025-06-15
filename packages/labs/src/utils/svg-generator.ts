/**
 * SVG Polygon generation utilities
 */

export interface PolygonGenerationOptions {
  sides: number;
  radius?: number;
  baseRadius?: number;
  irregularity?: number; // 0-1, how much to vary from regular
  spikiness?: number; // 0-1, how much to vary radius
  type?: 'regular' | 'irregular' | 'random';
  centerX?: number;
  centerY?: number;
}

export interface SVGRenderOptions {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  size?: number;
  viewBox?: string;
}

/**
 * Generate polygon points based on type
 */
export function generatePolygonPoints(options: PolygonGenerationOptions): string {
  const {
    sides,
    radius = 30,
    irregularity = 0.5,
    spikiness = 0.3,
    type = 'regular',
    centerX = 50,
    centerY = 50,
  } = options;

  // Use radius directly, or baseRadius if explicitly provided
  const baseRadius = options.baseRadius ?? radius;

  if (type === 'random') {
    const bounds = { minX: 10, maxX: 90, minY: 10, maxY: 90 };
    const centerXRandom = (bounds.minX + bounds.maxX) / 2;
    const centerYRandom = (bounds.minY + bounds.maxY) / 2;

    const coords = [];
    for (let i = 0; i < sides; i++) {
      const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
      const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
      const angle = Math.atan2(y - centerYRandom, x - centerXRandom);
      coords.push({ x, y, angle });
    }

    coords.sort((a, b) => a.angle - b.angle);
    return coords.map((coord) => `${coord.x.toFixed(2)},${coord.y.toFixed(2)}`).join(' ');
  }

  const points = [];
  const angleStep = (2 * Math.PI) / sides;
  const angleOffsets =
    type === 'irregular'
      ? Array.from({ length: sides }, () => (Math.random() - 0.5) * irregularity)
      : Array(sides).fill(0);

  for (let i = 0; i < sides; i++) {
    const angle = i * angleStep - Math.PI / 2 + angleOffsets[i];
    const radiusVariation = type === 'irregular' ? 1 + (Math.random() - 0.5) * spikiness : 1;
    const currentRadius = baseRadius * radiusVariation;

    const x = centerX + currentRadius * Math.cos(angle);
    const y = centerY + currentRadius * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return points.join(' ');
}

/**
 * Create SVG with fitted viewBox based on bounding box
 */
export function createFittedSVGPolygon(
  polygonOptions: PolygonGenerationOptions,
  renderOptions: SVGRenderOptions & { padding?: number } = {},
): string {
  const { fill = '#ffffff', stroke = '#000000', strokeWidth = 2, size = 100, padding = 5 } = renderOptions;

  const points = generatePolygonPoints(polygonOptions);

  // Calculate bounding box to create fitted viewBox
  const pairs = points.split(' ');
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  pairs.forEach((pair) => {
    const [x, y] = pair.split(',').map(Number);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  const viewMinX = minX - padding;
  const viewMinY = minY - padding;
  const viewWidth = maxX - minX + padding * 2;
  const viewHeight = maxY - minY + padding * 2;
  const viewBox = `${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}`;

  return `<svg width="${size}" height="${size}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
  <polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
</svg>`;
}
