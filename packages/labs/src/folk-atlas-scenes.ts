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

  'zoom-deep': (atlas) => {
    // Russian-doll stack of N nested scaled regions to demonstrate "infinite"
    // (well, deep) zoom. Each region is carved INSIDE its parent via a
    // face-bounded cut (no propagation through twin edges — see
    // `splitFaceAlongLine`), so deep cuts don't slice every parent above
    // them. Each level then gets a uniform interior scale; combined with a
    // shrinking screen footprint per level, the result is a self-similar
    // tunnel the user can wheel-zoom into.
    //
    // Self-similar tuning:
    //   - We pick `shrink ≈ 1/S` so each successive level's screen-pixel
    //     footprint shrinks by the same factor that the parent's interior
    //     magnifies — every level fills (just under) the entirety of its
    //     parent's interior, and the user sees a tunnel of identical-looking
    //     rectangles when they wheel-zoom in.
    //   - With S=1.6 and shrink=0.6 the per-level safety margin is
    //     `1 - shrink·S = 0.04` (the child fills 96% of parent face-local
    //     space). Smaller margins give visually tighter tunnels but make
    //     the seed point of each cut sit perilously close to the parent's
    //     boundary — past ~20 levels the rect becomes sub-pixel at the
    //     default zoom and the carve algorithm bails out (we break on null).
    //   - We rely on `createRegionAtScreenRect` returning null when the cuts
    //     fail (e.g. seed not strictly interior, host too small) instead of
    //     guarding with a fixed pixel threshold — that lets us push the
    //     stack as deep as numerics allow before stopping.
    //
    // Shapes: we drop a labelled landmark roughly every quarter of the way
    // down the stack so the user can verify the wheel-zoom is actually
    // crossing levels (the substrate auto-switches `atlas.root` when the
    // viewport centre lands inside a deeper region — see
    // `#maybeSwitchRootToViewportCentre`).
    const N = 20;
    const S = 1.6;
    const shrink = 0.6;
    const rect = atlas.getBoundingClientRect();
    // The whole stack must live inside a single seed-atlas wedge (the +x/+y
    // quadrant by convention) — otherwise the first carve straddles the
    // seed origin and `createRegionAtScreenRect` carves four sub-rects
    // (one per quadrant) instead of a single region. We anchor the
    // outermost rect's top-left at `(QUADRANT_INSET, QUADRANT_INSET)` in
    // root-frame and shrink toward its centre, which keeps every nested
    // rect strictly in +x/+y too (the centre is fixed; only the half-size
    // shrinks).
    const initialW = 360;
    const initialH = 320;
    const cx0 = rect.width / 2 + QUADRANT_INSET + initialW / 2;
    const cy0 = rect.height / 2 + QUADRANT_INSET + initialH / 2;
    let cw = initialW;
    let ch = initialH;
    let levelsCarved = 0;
    for (let i = 0; i < N; i++) {
      const region = atlas.createRegionAtScreenRect({
        x: cx0 - cw / 2,
        y: cy0 - ch / 2,
        width: cw,
        height: ch,
      });
      if (!region) break;
      atlas.setRegionScale(region, S);
      levelsCarved = i + 1;
      // Drop a labelled landmark every 5 levels. The shape's seed coords are
      // in the root frame (the same frame `createRegionAtScreenRect`'s
      // `screenRect` resolves to here, with `view = identity` and
      // `view.translation = (rect.width/2, rect.height/2)`); the mutation
      // observer assigns it to whichever face currently contains that point
      // (the deepest region we've carved so far, since each carve consumed
      // the previous deepest face).
      if (i % 5 === 0) {
        const rootX = cx0 - rect.width / 2;
        const rootY = cy0 - rect.height / 2;
        addShape(atlas, rootX, rootY, `level ${i}`);
      }
      cw *= shrink;
      ch *= shrink;
    }
    if (levelsCarved < N) {
      console.info(
        `[folk-atlas-scenes] zoom-deep: carved ${levelsCarved}/${N} levels before the cuts failed`,
      );
    }
    // Don't switchRoot — leave the user at the outermost view so they can
    // wheel-zoom in to traverse all the levels naturally. The auto-switch
    // in `#maybeSwitchRootToViewportCentre` handles re-rooting on the way in.
    return undefined;
  },
};

export function listSceneNames(): string[] {
  return Object.keys(SCENES);
}
