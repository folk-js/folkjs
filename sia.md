# The Sparse Ideal Atlas

**Status:** Working notes on a data structure for rich spatial canvases. Pre-prototype. Some properties are claimed and not yet verified; noted as such where relevant.

## What it is, in one paragraph

A Sparse Ideal Atlas (SIA) is a triangulation-like data structure that represents a 2D space for a spatial canvas. It is **sparse**: storage scales with the complexity of space operations present, not with canvas extent or shape count. It is **ideal**: vertices may lie at infinity, so a single face can cover an unbounded region of the plane. It is an **atlas**: each face carries its own local coordinate frame, and transforms on edges describe how to move between neighboring frames. Shapes live in faces with face-local coordinates. The global "Euclidean plane" is not stored; it is computed on demand by unfolding from a chosen root face through the transform graph.

This combines:

- Triangulations (incremental, local update structure)
- Projective/ideal vertices (vertices at infinity as first-class)
- Atlases with transition maps (from differential geometry — local charts glued by transforms)
- Face-local coordinates (each face is its own small coordinate system with good floating-point precision)

The goal is a substrate for spatial canvases that supports rich space-altering operations — expansion, contraction, stretching, tearing, folding, nesting — while keeping per-frame cost at or near flat-canvas cost for the common case of editing far from operations, and keeping edit cost local.

## The structural claim

An empty canvas is a small ring of faces with ideal "vertices" covering the whole plane. Adding a space operation adds a few faces and a few transforms, locally. Most of the canvas remains one or a few big faces with identity transforms — ~identical in cost and behavior to a flat canvas. The non-trivial structure only exists where the user has introduced it.

This is the key engineering property: you pay for complexity you introduce, nothing else.

## Invariants

A short list of model-level invariants the implementation must respect. Every operation preserves these.

1. **No global Euclidean frame.** Every coordinate, vector, length and direction is expressed *relative to some specific face*. There is no canonical "world origin". The choice of root face for rendering is a *rendering* decision (it picks which face's frame the screen happens to be aligned with), not a property of the geometric data.
2. **Edge-primary geometry.** The atlas is a graph of half-edges. Each half-edge carries its own intrinsic geometric data (a face-local vector for finite-target edges, or a unit direction for ideal-target edges). "Vertices" are not a primary concept: they are derived as the equivalence classes of half-edges that meet at a common physical point, recoverable by walking twin/next pointers. Vertex *positions in a face's frame* are derived by accumulating half-edge deltas around the face cycle.
3. **Canonical face frame, by convention.** Each face has a designated "anchor" half-edge (`halfEdges[0]`). Its starting junction sits at face-local `(0, 0)`. This is purely a numbering convention — there is no special vertex object — but it pins down each face's local frame uniquely so that face-local coordinates are well-defined.
4. **Triangle closure.** The deltas of a face's three half-edges sum to zero (modulo the convention that ideal-target half-edges contribute their direction in a separate channel). For 2-half-edge faces (both non-anchor edges go to ideal directions, the third side is at infinity and doesn't exist as data), only the two finite-target deltas exist and the closure condition is satisfied trivially.
5. **No rotation in edge transforms.** Edge transforms are restricted to translations + (potentially non-uniform) scales. The rotational components of all stored affine matrices are zero. Rotational regions are out of scope for the foreseeable future; this restriction keeps transforms commutative in their dominant cases and rules out the discrete-curvature failure mode where walking a closed loop accumulates a rotation.
6. **Composite transforms are derived, not stored.** Composite transforms (face-local → root-local) are recomputed from scratch each frame by walking the half-edge graph from a chosen root. They are never persisted. Only edge transforms (canonical primitives) and per-half-edge geometric data are stored, so stored data never accumulates floating-point drift.

## Primitives

### Half-edges (the primary objects)

The atlas is a graph of half-edges. Each half-edge carries:

- A **kind**: `'finite'` if its target is a finite junction in the same face, `'ideal'` if its target is "at infinity in some direction".
- A **delta**: for finite kind, a 2D vector in the face-local frame from this half-edge's starting junction to its target junction. For ideal kind, a unit direction vector in the face-local frame.
- A **twin** pointer to the corresponding half-edge in the adjacent face, or `null` if there is no adjacent face. (This happens at the line at infinity: an ideal-ideal pair of half-edges within a face implies a boundary "between" them at infinity, which is not a real edge in the atlas.)
- A **next** pointer to the next half-edge in the face cycle (CCW).
- A **face** pointer to the owning face.
- An **edge transform** (when twin is non-null): a 2D affine matrix mapping coordinates in `this.face`'s frame to `twin.face`'s frame. Translations and (potentially non-uniform) scales only — never a rotation.

There is no `Vertex` class. A "vertex" or "junction" is the equivalence class of half-edges that meet at the same physical point — discoverable by walking `.next.twin.next.twin...` (or the reverse) until the cycle closes.

A "finite vertex" is the meeting point of two or more half-edges where at least one has finite kind into or out of it. An "ideal vertex" is the shared direction of multiple ideal-kind half-edges in different faces — by convention all faces incident to the same physical "direction at infinity" use the same unit-direction vector.

### Faces

A face is a triangular region of the atlas. It owns:

- A small CCW-ordered list of half-edges: 3 if at least one of its non-anchor junctions is finite, 2 if both non-anchor junctions are ideal directions (in which case the third "side" is at infinity and exists only as topology, not as a stored half-edge).
- The set of shapes assigned to this face.

A face's local frame is pinned by the convention that `halfEdges[0]`'s starting junction sits at face-local `(0, 0)`. The other junctions are derived by accumulating half-edge deltas around the cycle.

A face with all-finite half-edges is a finite triangle. A face with at least one ideal-target half-edge is an infinite region (a wedge, a half-plane, a strip) extending to infinity in the ideal direction(s).

### Edges (twin pairs of half-edges)

A pair of twin half-edges constitutes an "edge" of the atlas. Each carries a transform from its face's frame to its twin's. The twin half-edge carries the inverse transform, and the two are constrained: applied to one's delta (for ideal: applied as the linear part to one's direction), they must equal the negation of the other's delta (or twin direction). This is the discrete consistency condition that means "the same physical edge looks the same from both sides".

For most edges in a canvas — those internal to flat, un-operated-on regions — the transform is the identity. Non-identity transforms exist only at operation boundaries. Walking from one face to another across an edge composes its transform.

**These primitives are never composed-and-decomposed into stored state.** Composite transforms (root → face) are recomputed per frame from the current root via a fresh walk, never persisted. This gives two important properties:

- A shape crossing an edge during a drag converts its face-local coordinates via that one edge's transform — O(1), exact, visually continuous.
- Shifting the root face (e.g. for floating-origin precision) is also O(1) at the data-structure level; the next frame's walk computes new composites from the new root. Stored coordinates never drift.

### Patches (deferred optimization)

A **patch** is a maximal set of faces sharing the same local frame (all edges between them have identity transforms). A patch behaves like a single flat region: shapes move between faces in a patch without any coordinate changes, and all shapes in a patch can be rendered with a single composite transform.

For prototyping we **omit patches as a first-class concept**. Every face is a triangle; the renderer walks each triangle independently. Patches re-enter later as either a render-time optimization (computed by union-find on identity edges) or as polygonal n-gon faces. Either way, the same atlas data structure and operation semantics apply.

### Shapes

A shape stores:

- A face reference
- Local coordinates in that face's frame
- Its own extent, geometry, appearance (unchanged from a flat canvas)

A shape lives in **exactly one face**, even if its visual extent crosses face boundaries. Cross-face rendering (drawing the same shape under multiple composite transforms) is deferred — for now, shapes near operation boundaries may visually extend past them without applying the boundary's transform. This is a deliberate trade-off: it keeps shape data and DOM rendering simple, matches user intuition that shapes far from operations behave like a normal canvas, and remains well-behaved during drag (the shape transitions to a new face only when its anchor crosses the boundary).

No shape ever has "global" coordinates. Coordinates are always local to some face.

## The key data structure properties

### Sparsity

Empty canvas: O(1) faces (three or four faces covering the whole plane with ideal vertices).

Canvas with N operations of combined boundary complexity B: O(B) faces introduced. Shape count does not affect face count.

Storage: O(operations) independent of shape count or canvas extent.

### Locality of edits (claimed, needs validation in prototyping)

Adding an operation modifies the triangulation only in a bounded region around the operation's boundary. Faces far from the operation are unchanged. Their stored data — local coordinates of contained shapes, transforms on their edges — remain bitwise identical.

The prototype starts with constrained Delaunay (CDT), whose locality is amortized but not worst-case. For the operation set we're targeting (sparse, convex, non-overlapping), this is acceptable. If worst-case locality becomes a measured problem, fall back to a bounded-flip variant or a custom incremental triangulation.

### Precision

A shape's local coordinates live in a face. Coordinates are numbers with good floating-point precision. Repeated moves within a single face's frame accumulate no error (standard flat-coordinate arithmetic). Moves between faces connected by identity edges are likewise lossless.

Repeated applications of operations to a region do not drift the coordinates of shapes in that region — their face-local coordinates remain unchanged. Only edge transforms change, and those are stored as canonical primitives, not composed.

At render time, composite transforms accumulate across walks from the root, which does introduce some floating-point error proportional to walk length. This error is:

- Bounded by walk length (typically small for any visible region)
- Not persisted — recomputed fresh each frame
- Does not affect stored coordinates

### Rigidity at distance

A shape far from any operation is in a face whose walk-path to the root passes only through identity edges. Its composite transform is the identity composed with itself many times — still identity. Its rendered position is its face-local coordinates directly.

If an operation is added somewhere else on the canvas, and the walk from the root to this shape's face does not pass through the operation, nothing changes. Exactly rigid.

If the walk _does_ pass through the operation, the composite transform includes the operation's boundary transform — typically a rigid translation. The shape's rendered position is translated, exactly rigidly.

No falloff, no distortion, no approximation. Far-field behavior is exactly Euclidean with exact rigid displacements.

### Interactions between operations

Two operations interact naturally through the walk. A walk from the root that passes through both accumulates both transforms. Growing one operation changes its boundary transforms, which changes the composite for any walk passing through it, which changes the rendered position of any face past it — including faces inside or past other operations.

This gives "stretched regions push each other" for free. No explicit force calculation. Just the geometry of walks through the transform graph.

## Operations

An operation is a local edit to the atlas. Operations are **first-class entities in the document** (DOM elements). Each operation owns the atlas pieces it created — the faces it inserted, the transforms it set on edges, the vertices it added — and mutates them in place when its parameters change. There is no derivation or replay: changing the operation's gizmo (e.g. dragging Δ larger) directly updates the relevant atlas state. Adding the operation element inserts its atlas pieces; removing it tears them down symmetrically.

The current envisioned operations:

### Expand a convex polygon by amount Δ (band-inside model)

Inserts a band of new faces between the original polygon interior and a new, outwardly-displaced polygon boundary. The polygon visually grows; the band lives inside the new boundary. Specifically:

- The polygon's vertices are duplicated. The original vertices remain at their positions; new vertices are placed at the original positions plus Δ along their outward normals.
- The original interior face is unchanged in shape and frame.
- A band of trapezoidal faces (each split into two triangles) fills the ring between original and new boundary vertices.
- The band's inner edges (against the original interior) carry identity transforms — the band is contiguous with the interior in the same frame.
- The band's outer edges (against the exterior) carry transforms that translate by Δ in the outward normal direction. Walking from inside to outside through one of these edges accumulates +Δ outward; the exterior past the band is therefore offset by Δ outward in screen space.

Shapes inside the polygon stay in their faces with unchanged local coordinates. Shapes in the exterior also stay in their faces with unchanged local coordinates, but render at translated positions because their walk from the root crosses one of the band's outer edges.

Cost: O(polygon edge count) new faces and transforms.

### Contract a convex polygon by amount Δ

The non-trivial inverse of expand — **not** equivalent to undoing a prior expansion. Contraction takes a polygon's region and removes a band of width Δ from its inside, drawing the exterior in by Δ:

- The polygon's vertices are duplicated. The original vertices remain at their positions (now the outer boundary of the removed band). New inner vertices are placed at the original positions minus Δ along outward normals.
- A band of faces sits between original (outer) and new (inner) boundary; this band carries identity-relative-to-exterior transforms on its outer edges and a Δ-inward translation on its inner edges (against the contracted interior).
- The contracted interior face is what was originally inside, now smaller by Δ on each side.

Shapes in the removed band must be reassigned. Default policy TBD: snap to the new inner boundary, snap to nearest face, or follow the transform inward (which collapses some shapes onto each other).

Cost: O(polygon edge count) new faces and transforms (plus reassignment cost for shapes in the band).

### Flatten a region

Retriangulate a region, absorbing accumulated transforms into shape coordinates. Shapes in the region get their current visual positions (as determined by the current composite transform) committed as new face-local coordinates in freshly-triangulated flat faces. After flattening, the region has identity transforms everywhere.

Useful for compute management and for simplifying regions where the space structure has served a purpose and is no longer needed.

Cost: O(shapes in region + faces in region).

### Nest a region

Declare that a face's interior is a separate sub-atlas. Walks that enter the face enter the sub-atlas recursively. Potentially self-referential (the sub-atlas is the top-level atlas), giving infinite zoom. Deferred to a later phase but accommodated by the structure without modification.

### Tear along an arc

Cut an arc into the atlas, introducing two new boundary edges. The two sides can then be pulled apart (by giving the new edges non-trivial transforms) or reconnected differently. Deferred.

## Rendering

### The root face

Rendering requires a choice of **root face** from which the walk begins. Several strategies:

- **Fixed root:** one face is designated as root forever. Simple. Composite transforms are stable.
- **Viewport-local root:** the face containing the viewport center is the root. Changes as the viewport moves. Risk: shapes visually jump when the root changes if the transition is not handled correctly. This is effectively a floating-origin root and is likely the most correct and elegant solution long-term.

Likely start with fixed root for simplicity.

### The walk

From the root, compute composite transforms for every face visible in the viewport. Implementation: breadth-first search from the root through the face graph, accumulating transforms. Only faces whose composite-transformed extent intersects the viewport need to be walked to.

Composites are computed fresh per frame; they are **not persisted** as state on faces. This guarantees stored data never drifts: only edge transforms (canonical primitives) and shape face-local coords (never written through composites) are stored. Per-frame float error from walk composition is bounded by walk depth and never accumulates.

The walk also acts as the spatial index. There is no separate BVH or grid: a face's composite-transformed extent against the viewport tells us whether to recurse into it and whether to render its shapes. For empty regions of the canvas the walk terminates after a handful of faces.

Pan and zoom are a global affine on top of the root: they multiply into the root's "to-screen" matrix and don't touch any atlas data. Panning does nothing structural; it changes one matrix at the top of the walk.

Note that there are many optimizations which can be explored in the future. And long-term we should consider what the computational ideal is in terms of asymptotic complexity.

### Rendering shapes

For each face in the viewport, apply the face's composite transform as a single uniform/matrix, then render all shapes in the face with their face-local coordinates. Standard GPU rendering. Each face is essentially a "layer" with its own transform, and shapes within the layer are simple 2D content.

For the DOM, this can be applied via CSS transforms.

### Cost per frame

- Walk: O(visible faces). For a canvas with no operations, visible faces is a small constant (the few ideal-vertex faces covering the plane, all identity-connected). For a canvas with operations, visible faces = a small constant + a small number per operation the viewport touches.
- Shape rendering: O(visible shapes), same as flat canvas.
- Transform computation: one matrix per visible face, trivial.

**Empty canvas or canvas edit far from operations: ~identical per-frame cost to a flat canvas.**

## Shape-level operations

### Moving a shape

During a drag, each frame:

1. Read mouse position in screen space.
2. Convert to the current face's local frame via the inverse of that face's composite transform.
3. Update shape's face-local coordinates.
4. Check if new coordinates are still within the face. If yes, done. If no, identify which edge was crossed and which face is on the other side. Apply the cross-edge transform to get new local coords in the new face. Update face assignment.

Because the cross-edge transform preserves the screen position of points on the edge, this transition is visually continuous — the shape stays under the cursor.

For identity edges, step 4 is trivial: crossing the edge doesn't change local coords at all, just the face pointer.

### Resizing / rotating

Happen in face-local coordinates. Behave as in a flat canvas. The shape's extent and rotation are stored in face-local terms and rendered via the face's composite transform.

Shapes that would, when rendered, extend past a face boundary are simply allowed to do so for now — they render with the host face's transform regardless of where they visually appear. Cross-face rendering (drawing a shape under multiple composite transforms) is deferred.

### Screen-to-atlas projection

Given a screen position, find the containing face:

1. Start from the root (or a cached viewport-local face).
2. Walk the visible-face graph; for each face whose screen-space extent contains the point, that's a candidate.
3. Return the face and the local coordinates (computed via the inverse composite transform).

The walk itself is the spatial index — face screen extents (composite transform applied to vertex positions) are computed during the per-frame walk and reused for picking. No separate index structure.

## What's hard and needs prototyping

### Triangulation algorithm

Choice for the prototype: **constrained Delaunay (CDT)**, with operation polygon edges as forced constraints. Quality (well-shaped triangles) does matter here because vertices serve as origin points for face frames and are visible in debug rendering, and degenerate triangles produce ill-conditioned inverses for point-location.

CDT's update locality is amortized but not worst-case. For the operation set we're targeting (sparse, convex, non-overlapping), this is acceptable. If worst-case locality becomes a concern we can move to bounded-flip CDT or a custom incremental variant later.

Libraries to consider initially: `poly2tri`, `cdt2d`. Likely roll our own incremental Bowyer-Watson with constraint preservation eventually, for full control over ideal vertices and locality.

### Anchor half-edge selection

Each face's frame is pinned by `halfEdges[0]`'s starting junction sitting at face-local `(0, 0)`. Picking which half-edge plays this role affects precision (the closer the rest of the face is to the anchor, the better the float behaviour) and rendering math (composite transforms are derived from edge transforms which are derived in part from this anchor). Likely heuristic: pick the half-edge whose start is the most "central" finite junction of the face. To be tuned during prototyping.

### Shapes spanning face boundaries (deferred)

Shapes live in exactly one face for the prototype. Cross-face rendering — drawing the same shape under multiple composite transforms — is a future enhancement; until then, shapes near operation boundaries may render past the boundary without applying the boundary's transform. This is acceptable for the common case and matches the "shapes far from operations behave like a flat canvas" intuition.

### Concurrent / animated edits

When operations animate or change simultaneously (e.g. dragging a Δ slider), transforms update frequently. Because composites are recomputed per frame from scratch, there's no cache to invalidate — the next frame just walks fresh. The cost is paying for a full walk per frame regardless. For the prototype this is fine; revisit only if profiling shows the walk dominating.

Concurrent editing is also relevant for collaborative editing (CRDTs over the operation set / atlas).

### Projective / ideal direction arithmetic

Needs to be implemented carefully to avoid division-by-zero and precision issues near infinity. In the edge-primary model this is mostly self-contained: ideal-target half-edges store unit directions, and the only operation that touches them is "apply the linear part of an edge transform to renormalize on the other side". Standard homogeneous-coordinate techniques apply but need careful implementation.

### Picking the empty canvas's default structure

The empty canvas needs some small set of faces covering all directions. How many ideal vertices, at what directions, is a design choice. Probably 4 (like a rectangle covering all quadrants) or 6 (hexagonal) to start with; some higher number like 32 may give better results for arbitrary-direction operations; adaptive insertion is the long-term answer.

### Nested / self-referential atlases

Deferred but the data structure should accommodate them from the start to avoid later refactoring. A face's "interior" might be either triangles or a reference to a sub-atlas.

## What's explicitly not attempted

- **Smooth deformation fields:** no per-pixel smooth warping. The atlas is piecewise-flat with rigid transitions. Smooth deformations inside a region would be a separate layer (e.g., shader-based) and are out of scope for the core structure.
- **Curved faces:** faces are flat triangles. Curves in the space come from many small faces, not from face geometry. This relates to the number of ideal vertices too, as for example expanding a circular region may look poor with only 4 ideal vertices.
- **General non-convex regions:** operations are defined for convex polygons initially. Non-convex regions can be decomposed into convex pieces.

## Prototyping plan

1. **Atlas substrate without operations.** A triangulation data structure (half-edge based) with finite and ideal vertices, face-local coordinates, identity transforms on every edge. Empty canvas = a small handful of triangles (a few ideal-vertex faces) covering the plane. Place shapes by face reference + local coords.
2. **Walk + render.** From a fixed root face, BFS visible faces, accumulate composite transforms (all identity for now), render shapes per face. Verify output matches a flat canvas exactly. Add debug visualization for triangles, vertices, root, viewport. Pan/zoom on top as a global render affine.
3. **Draw a region.** A `<folk-region>` (or similar) DOM element with a convex polygon attribute. Adding it inserts the polygon's vertices and locally re-triangulates (CDT) so the polygon's edges exist as edges in the atlas. All transforms remain identity. Render output is unchanged from step 2.
4. **First operation: expand.** Adding `expand="20"` (or similar) to the region: insert the band faces (band-inside model), set the band's outer-edge transforms to translate by Δ in outward normals. Verify shapes inside don't move, exterior shapes render at offset positions, and walks past the boundary compose correctly. Verify the no-monodromy claim empirically by walking closed loops in the exterior.
5. **Mutating the operation.** Drag a gizmo on the region to change Δ or polygon vertices. The operation element updates its atlas pieces in place — no replay. Verify visual continuity and locality (only the operation's own pieces change).
6. **Shape dragging across boundaries.** Verify visual continuity (the shape stays under the cursor) and correct face reassignment when a shape crosses a band edge during drag.
7. **Flatten.** Bake composite transforms into shape coords for a chosen region, replacing it with one identity-everywhere region. Visually a no-op; structurally a simplification. Sanity-checks transform math.
8. **Contract.** The non-trivial inverse of expand (band removed from inside the polygon, exterior pulled in by Δ). Decide and implement policy for shapes in the removed band.
9. **Multiple operations and stress test.** Verify two adjacent (non-overlapping) operations interact correctly via walks. Many operations, many shapes — measure per-frame cost and edit cost. Verify sparsity and locality claims empirically.

Only after these work should we consider nested atlases, tearing, infinite zoom, non-convex regions, or more exotic features.

## Open questions to revisit

- The UX model for operations beyond the basic expand/contract gizmo: how do users compose, group, select, and constrain them? How do operations relate to selections?
- Policy for shapes inside the band when contracting: snap outward to new boundary, snap to nearest face, follow the inward transform, or allow the user to specify per-shape behavior.
- Behavior when the user drags an expand gizmo's Δ negative (clamp at zero, switch to contract semantics, or disallow).
- When and whether to introduce floating-origin root for deep-zoom precision.
- When and whether patches re-enter as a first-class abstraction (render optimization or n-gon faces).
- Collaborative editing: CRDT structure for operations and the atlas itself.
- Text and complex content across face boundaries (likely: content stays in one face).
- Adaptive ideal-vertex insertion: starting with 4 or 6 ideal vertices is fine, but very-elongated content extents may want adaptively-inserted directions.

## Related prior work

The data structure draws from:

- **Combinatorial maps and half-edge structures** for the triangulation bookkeeping.
- **(G, X)-structures and geometric atlases** (Thurston) for the local-chart + transition-map framing.
- **Incremental Delaunay triangulation** (Shewchuk, Guibas-Stolfi) for the algorithmic basis.
- **Homogeneous coordinates and projective geometry** for ideal vertices.
- **Piecewise-flat / translation / dilation surfaces** for the rigid-pieces-with-transitions geometry.

The specific combination — sparse, ideal-vertex-capable, atlas-structured, optimized for interactive canvas editing with rich space operations — does not appear to be written up in this form elsewhere.
