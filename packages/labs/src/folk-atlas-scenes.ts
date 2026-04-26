import type { Face } from './atlas.ts';
import type { FolkAtlas } from './folk-atlas.ts';
import { FolkAtlasShape } from './folk-atlas-shape.ts';

/**
 * A scene builder receives a freshly-reset {@link FolkAtlas} (empty seed
 * atlas, no shapes or regions, view centred on screen) and populates it.
 *
 * Optionally returns a {@link Face} that the loader will switch the atlas
 * root to before re-centring the viewport. This lets a scene place its
 * "interesting" region away from the seed-atlas axes (which avoids the
 * 4-quadrant straddle limitation in `createRegionAtScreenRect`) and
 * still have it appear at screen centre when the scene loads.
 */
export type SceneBuilder = (atlas: FolkAtlas) => Face | void;

/**
 * Helper: append a `<folk-atlas-shape>` with the given root-frame seed
 * coordinates and label. The atlas's mutation observer picks it up on
 * the next microtask and assigns it to whichever face contains the seed.
 */
function addShape(atlas: FolkAtlas, x: number, y: number, label: string): FolkAtlasShape {
  const shape = new FolkAtlasShape();
  shape.x = x;
  shape.y = y;
  shape.width = 120;
  shape.height = 56;
  shape.textContent = label;
  atlas.append(shape);
  return shape;
}

/**
 * Helper: build a region offset into the +x/+y quadrant of the seed
 * atlas, sized in screen pixels. We deliberately avoid the seed origin
 * because `createRegionAtScreenRect` straddling the X/Y axes splits the
 * intended rectangle into per-quadrant sub-rects. After this returns,
 * the caller usually wants to `atlas.atlas.switchRoot(region.face)`
 * (returned via the scene builder's return value) so the loader re-centres
 * the viewport on it.
 */
function addRegionAt(
  atlas: FolkAtlas,
  rect: { x: number; y: number; width: number; height: number },
) {
  return atlas.createRegionAtScreenRect(rect);
}

/**
 * Quadrant offsets (atlas root frame) used to keep region cuts strictly
 * interior to a single seed-atlas wedge:
 *   - The seed atlas has 4 wedges meeting at origin, bounded by the X
 *     and Y half-axes. A region cut whose seed lies *on* an axis is
 *     degenerate (`walkLine: seam is not strictly interior to host`).
 *   - We therefore park scene rects in the screen's NE quadrant offset
 *     well clear of both axes, so all 4 cut seeds are strictly inside
 *     the NE wedge.
 */
const QUADRANT_INSET = 60;

/**
 * Return the centre of the rectangle the scene placed via
 * {@link addRegionInQuadrant}, expressed in the seed atlas's root frame
 * (i.e. screen-centred coordinates). Useful for placing shapes inside.
 */
function quadrantCentre(
  atlas: FolkAtlas,
  width: number,
  height: number,
): { x: number; y: number } {
  // Atlas-frame x and y of the rect's centre, mirroring the layout in
  // {@link addRegionInQuadrant}: top-left at (+QUADRANT_INSET, +QUADRANT_INSET).
  void atlas;
  return {
    x: QUADRANT_INSET + width / 2,
    y: QUADRANT_INSET + height / 2,
  };
}

/**
 * Place a region of the given pixel size in the screen's bottom-right
 * quadrant, well clear of the seed atlas axes. Returns the bound
 * {@link FolkAtlasRegion} (or `null` if the cuts failed for some reason).
 */
function addRegionInQuadrant(atlas: FolkAtlas, width: number, height: number) {
  const rect = atlas.getBoundingClientRect();
  return atlas.createRegionAtScreenRect({
    x: rect.width / 2 + QUADRANT_INSET,
    y: rect.height / 2 + QUADRANT_INSET,
    width,
    height,
  });
}

/**
 * Built-in scenes. Each returns an optional {@link Face} that becomes
 * the new atlas root (so the viewport recentres on it) after the scene
 * runs.
 */
export const SCENES: Record<string, SceneBuilder> = {
  blank: () => {
    // Pure seed atlas: 4 wedges meeting at the origin, no shapes, no
    // regions. Useful for testing primitive interactions in isolation.
  },

  'default': (atlas) => {
    // The original demo content: one labelled shape per quadrant.
    addShape(atlas, 140, 120, 'NE quadrant');
    addShape(atlas, -260, 80, 'NW quadrant');
    addShape(atlas, -200, -180, 'SW quadrant');
    addShape(atlas, 100, -160, 'SE quadrant');
  },

  'cylinder-h': (atlas) => {
    const region = addRegionInQuadrant(atlas, 240, 200);
    if (!region) return;
    atlas.wrapRegionAxis(region, 'horizontal');
    const c = quadrantCentre(atlas, 240, 200);
    addShape(atlas, c.x, c.y, 'inside H-wrap');
    return atlas.regionFace(region) ?? undefined;
  },

  'cylinder-v': (atlas) => {
    const region = addRegionInQuadrant(atlas, 200, 240);
    if (!region) return;
    atlas.wrapRegionAxis(region, 'vertical');
    const c = quadrantCentre(atlas, 200, 240);
    addShape(atlas, c.x, c.y, 'inside V-wrap');
    return atlas.regionFace(region) ?? undefined;
  },

  torus: (atlas) => {
    const region = addRegionInQuadrant(atlas, 220, 220);
    if (!region) return;
    atlas.wrapRegionAxis(region, 'horizontal');
    atlas.wrapRegionAxis(region, 'vertical');
    const c = quadrantCentre(atlas, 220, 220);
    addShape(atlas, c.x, c.y, 'inside torus');
    return atlas.regionFace(region) ?? undefined;
  },

  'scaled-2x': (atlas) => {
    // Single region with interior scale 2. From outside, contents render
    // at half size (the "zoom in to enter" feel). Wheel-zoom into the
    // region to cross the boundary; the root switch renormalises the view
    // so contents fill the screen at their native face-local size.
    const region = addRegionInQuadrant(atlas, 240, 220);
    if (!region) return;
    atlas.setRegionScale(region, 2);
    const c = quadrantCentre(atlas, 240, 220);
    addShape(atlas, c.x - 30, c.y - 20, 'inside');
    addShape(atlas, c.x + 40, c.y + 25, '½× outside');
    addShape(atlas, -260, -180, 'outside');
    return atlas.regionFace(region) ?? undefined;
  },

  'scaled-4x': (atlas) => {
    // Same as scaled-2x but with a deeper zoom factor so the scale
    // discontinuity is more obvious.
    const region = addRegionInQuadrant(atlas, 240, 220);
    if (!region) return;
    atlas.setRegionScale(region, 4);
    const c = quadrantCentre(atlas, 240, 220);
    addShape(atlas, c.x, c.y, 'inside (¼× outside)');
    addShape(atlas, -260, -180, 'outside');
    return atlas.regionFace(region) ?? undefined;
  },
};

export function listSceneNames(): string[] {
  return Object.keys(SCENES);
}
