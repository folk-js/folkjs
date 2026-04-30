// ============================================================================
// Geometry — oriented projective plane primitives
// ============================================================================
//
// A self-contained library for the oriented projective plane (R² ∪ S¹ with
// antipodes-distinct). Knows nothing about atlases, faces, edges, stitches,
// or links — only points, lines, and convex polygons whose vertices may be
// at infinity.
//
// `HomPoint` and `HomLine` (in `projective.ts`) are the substrate's two
// geometric types. All operations work uniformly on finite and ideal
// inputs; there is no kind-discriminator dispatch in the geometry layer.
//
// See `step-6.md` and `substrate.md` for the broader design.

export { cross } from './point.ts';

export {
  HomPoint,
  HomLine,
  signedTurn,
  lerpHom,
} from './projective.ts';

export {
  leftOfDirectedEdge,
  leftOfDirectedEdgeStrict,
  polygonContains,
  polygonContainsStrict,
  sameIdealDirection,
  isPolygonCCW,
  isPolygonCW,
  parameterOnSegment,
} from './predicates.ts';
