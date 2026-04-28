// ============================================================================
// Geometry — oriented projective plane primitives
// ============================================================================
//
// A self-contained library for the oriented projective plane (R² ∪ S¹ with
// antipodes-distinct). Knows nothing about atlases, faces, edges, stitches,
// or links — only points, junctions, lines, and convex polygons whose
// vertices may be at infinity.
//
// This is the geometric foundation that every model space plugs into. See
// `substrate.md` for the broader picture.

export { cross, applyLinearToDirection } from './point.ts';

export {
  type Junction,
  sameIdealDirection,
  junctionInTranslatedFrame,
} from './junction.ts';

export {
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  parameterOnSegment,
} from './line.ts';

export {
  polygonContains,
  polygonContainsStrict,
  isPolygonCCW,
} from './polygon.ts';
