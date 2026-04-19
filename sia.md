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

An empty canvas is a single convex face whose boundary half-edges go to ideal directions, covering the whole plane with one frame. (The temporary triangle-only implementation has it as a small ring of wedge faces meeting at the origin — same plane coverage, just split into triangles by implementation requirement, not by anything semantic.) Adding a space operation adds a few faces and a few transforms, locally. Most of the canvas remains one or a few big faces with identity transforms — ~identical in cost and behavior to a flat canvas. The non-trivial structure only exists where the user has introduced it.

This is the key engineering property: you pay for complexity you introduce, nothing else.

## Invariants

A short list of model-level invariants the implementation must respect. Every operation preserves these.

1. **No global Euclidean frame.** Every coordinate, vector, length and direction is expressed *relative to some specific face*. There is no canonical "world origin". Functions exposed by the atlas never accept or return a "root-local" or "world" coordinate; they traffic in `FaceLocalPoint`s (a `(face, x, y)` triple).
2. **Root is a pointer, not part of the atlas's identity.** A choice of root face is required for rendering (it picks which face's frame the screen happens to be aligned with), but two atlases with identical face data and identical edge transforms but different roots are *the same atlas*. Re-rooting is an O(1) bookkeeping operation: `Atlas.switchRoot(newRoot)` returns a compensation matrix `C` (the new root's old composite) so the view transform can absorb the change without any face-local coordinate moving.
3. **The atlas is a geometric structure, not a metric space.** There is no global notion of distance, area, or angle. Face-local distance is ordinary Euclidean on face-local coordinates. Distance between points in different faces is only meaningful once you pick a frame to express both in. Re-expressing through non-isometric transforms (eventual scale operations) would give different answers depending on frame choice. *Geometric* operations are well-defined; *metric* questions need an explicit choice of frame.
4. **Edge-primary geometry; junction identity is derived, not enforced.** The atlas is a graph of half-edges. Each half-edge carries its own intrinsic geometric data (a face-local vector for finite-target edges, or a unit direction for ideal-target edges). "Vertices" / "junctions" are not primary objects: they are the equivalence classes of half-edges that meet at the same physical point, recoverable by walking `aroundJunction` (twin/next). Junction *consistency* is a derived property — the twin-transform invariants (`transform * h.next.origin = twin.origin`, etc.) are what make junction identity coherent. Intentionally relaxing this consistency at specific junctions is how future operations like cone points, branch cuts, and self-glued boundaries would be expressed.
5. **Canonical face frame, by convention.** Each face has a designated "anchor" half-edge (`halfEdges[0]`). Its starting junction sits at face-local `(0, 0)`. This is purely a numbering convention — there is no special vertex object — but it pins down each face's local frame uniquely so that face-local coordinates are well-defined.
6. **Faces are convex k-gons, k ≥ 3.** Every face is a convex polygon (possibly with some vertices at infinity, in which case the face extends to infinity in those directions). Operations that would produce non-convex regions are responsible for decomposing into convex sub-faces at mutation time; the data structure never holds a non-convex face. Cycle closure (sum of half-edge deltas around the face cycle is zero, modulo ideal-direction conventions) is a structural consequence.
7. **Edge transforms are translations only, in the operational regime.** Each edge transform has the form `(x, y) ↦ (x + tx, y + ty)`. The linear part is the identity matrix; only the translation varies. This rules out scale, rotation, shear, and reflection from all current and near-term operations (expand, contract, drag, flatten). It keeps composites commutative, rules out the discrete-curvature failure mode where walking a closed loop accumulates a rotation, and means shapes never visually deform when re-anchored across an edge.

   *Future extension.* Infinite-zoom and recursive-space operations (deferred) will require enabling **uniform scale** alongside translation — the group `(x, y) ↦ s · (x, y) + (tx, ty)` with `s > 0`. Rotation, shear, and anisotropic scale remain ruled out indefinitely; their absence is what keeps the structure conformal in the current regime and angle-preserving in the future regime. Operations that can accidentally introduce non-conformal transforms must be rejected.
8. **Composite transforms are derived, not stored.** Composite transforms (face-local → root-local) are recomputed from scratch each frame by walking the half-edge graph from the current root. They are never persisted. Only edge transforms (canonical primitives) and per-half-edge geometric data are stored, so stored data never accumulates floating-point drift.

## Primitives

### Half-edges (the primary objects)

The atlas is a graph of half-edges. Each half-edge carries:

- A **kind**: `'finite'` if its target is a finite junction in the same face, `'ideal'` if its target is "at infinity in some direction".
- A **delta**: for finite kind, a 2D vector in the face-local frame from this half-edge's starting junction to its target junction. For ideal kind, a unit direction vector in the face-local frame.
- A **twin** pointer to the corresponding half-edge in the adjacent face, or `null` if there is no adjacent face. (This happens at the line at infinity: an ideal-ideal pair of half-edges within a face implies a boundary "between" them at infinity, which is not a real edge in the atlas.)
- A **next** pointer to the next half-edge in the face cycle (CCW).
- A **face** pointer to the owning face.
- An **edge transform** (when twin is non-null): a 2D affine matrix mapping coordinates in `this.face`'s frame to `twin.face`'s frame. Translations only in the current operational regime (invariant 7); future-extensible to translation + uniform scale, never to rotation, shear, anisotropic scale, or reflection.

There is no `Vertex` class. A "vertex" or "junction" is the equivalence class of half-edges that meet at the same physical point — discoverable by walking `.next.twin.next.twin...` (or the reverse) until the cycle closes.

A "finite vertex" is the meeting point of two or more half-edges where at least one has finite kind into or out of it. An "ideal vertex" is the shared direction of multiple ideal-kind half-edges in different faces — by convention all faces incident to the same physical "direction at infinity" use the same unit-direction vector.

### Faces

A face is a convex polygonal region of the atlas. It owns:

- A CCW-ordered list of `k ≥ 3` half-edges forming its boundary cycle.
- The set of shapes assigned to this face.

A face's local frame is pinned by the convention that `halfEdges[0]`'s starting junction sits at face-local `(0, 0)`. The other junctions are derived by accumulating half-edge deltas around the cycle.

A face is the **maximal region sharing a single local coordinate frame**, bounded by the edges where frame changes happen. That is the *semantic* definition; "triangle" or "polygon" is just the shape that falls out for a given operation. The empty canvas, for example, is a single face whose `k` boundary half-edges all go to ideal directions — one frame, no frame transitions, and the polygon just happens to span the entire plane.

A face with all-finite half-edges is a bounded convex polygon. A face with one or more ideal-target half-edges is an unbounded convex region (a wedge, a strip, a half-plane, or the whole plane) extending to infinity in those directions. Adjacent ideal half-edges represent a piece of the line at infinity between them; that "closing" half-edge has no twin and no transform — it is a bookkeeping element so that face iteration is uniform.

**Implementation status.** The current implementation pins `k = 3` everywhere (`Face.halfEdges` is a fixed 3-tuple). Generalizing to variable-`k` is the next planned refactor — see "Prototyping plan" below. The semantic and invariant model already assumes convex k-gons.

### Edges (twin pairs of half-edges)

A pair of twin half-edges constitutes an "edge" of the atlas. Each carries a translation `(tx, ty)` from its face's frame to its twin's; the twin carries the negation. The pair is constrained so that applying one's transform to one's stored junction data produces the twin's stored junction data — the discrete consistency condition that means "the same physical edge looks the same from both sides". Junction identity at the endpoints (invariant 4) is exactly this condition.

For most edges in a canvas — those internal to flat, un-operated-on regions — the transform is the zero translation (identity). Non-zero translations exist only at operation boundaries. Walking from one face to another across an edge adds its translation.

There is **gauge freedom** in how a given physical configuration is represented: the same visible result can be expressed by translations living in shape positions, in edge transforms, or in the root's view transform. Re-anchoring (`switchRoot`) and rebase-at-point operations move budget between these representations without changing what the user sees.

**Edges as the user-facing concept.** Half-edges are the implementation; "edges" (twin pairs) are the user-facing object. Selecting an edge — for instance to drag a transform gizmo — selects the twin pair, not one of its halves. At-infinity half-edges (no twin) are not selectable; there is nothing on the other side to translate relative to.

**Composites are derived, not stored.** Composite transforms (face-local → root-local) are recomputed per frame from the current root via a fresh walk, never persisted. This gives:

- A shape crossing an edge during a drag converts its face-local coordinates via that one edge's transform — O(1), exact, visually continuous.
- Shifting the root face is O(1) at the data-structure level. `Atlas.switchRoot(newRoot)` returns the compensation matrix; the next frame's walk computes new composites from the new root. Stored coordinates never drift.

### Patches (subsumed by convex k-gon faces)

Earlier drafts of this design distinguished between *triangles* (the primitives) and *patches* (maximal triangle clusters with identity transforms between them — i.e. one logical region with one frame). With **convex k-gon faces** (invariant 6), the patch concept dissolves: a face simply *is* a maximal region with one frame. Operations introduce new faces only where new frames are needed, not because triangulation requires it.

The `triangle` framing remains useful as the *initial implementation* (it's what the code currently does) and as the algorithmic fallback for non-convex outcomes. But the structural unit is the face-as-frame-region; triangles are an artifact, not a semantic.

### Shapes

A shape stores:

- A face reference
- Local coordinates in that face's frame
- Its own extent, geometry, appearance (unchanged from a flat canvas)

A shape lives in **exactly one face**, even if its visual extent crosses face boundaries. Cross-face rendering (drawing the same shape under multiple composite transforms) is deferred — for now, shapes near operation boundaries may visually extend past them without applying the boundary's transform. This is a deliberate trade-off: it keeps shape data and DOM rendering simple, matches user intuition that shapes far from operations behave like a normal canvas, and remains well-behaved during drag (the shape transitions to a new face only when its anchor crosses the boundary).

No shape ever has "global" coordinates. Coordinates are always local to some face.

## The key data structure properties

### Sparsity

Empty canvas: O(1) faces — semantically a single all-ideal-boundary face under the convex k-gon model; currently a small wedge ring under the triangle-only implementation.

Canvas with N operations of combined boundary complexity B: O(B) faces introduced. Shape count does not affect face count.

Storage: O(operations) independent of shape count or canvas extent.

### Locality of edits (claimed, needs validation in prototyping)

Adding an operation modifies the subdivision only in a bounded region around the operation's boundary. Faces far from the operation are unchanged. Their stored data — local coordinates of contained shapes, transforms on their edges — remain bitwise identical.

Each operation supplies its own subdivision (it knows what sub-faces and edges it needs to introduce); we do not run a generic triangulator over the whole atlas. Locality is therefore inherent to operation design, not delegated to a triangulation algorithm's amortized properties.

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

Every operation decomposes into a **combinatorial rewrite** of the half-edge graph plus a **transform specification** for any new edges introduced. The decomposition is useful as a mental model and as a code-organization principle, though it isn't entirely free: the transform specification has to be globally consistent (translations around any cycle sum to zero), which is a non-local constraint. Operations are responsible for satisfying it.

### Edge gizmo (exploratory primitive)

The simplest interactive operation: select an edge (a twin pair) and drag its translation. With translation-only transforms this is a single 2D handle per edge — typically rendered at the edge's midpoint with an arrow showing the displacement. Dragging updates `(tx, ty)` on `h.transform` and `-(tx, ty)` on `h.twin.transform`, then triggers composite recomputation. All faces downstream of that edge in the BFS tree visually translate.

This is intended as a sandbox for building intuition about how edge transforms compose, and for catching cycle-closure bugs visually before more structured operations are added. When uniform scale lands, the gizmo extends naturally: scroll on the handle for scale, drag for translation.

The current envisioned higher-level operations:

### Expand a convex polygon by amount Δ (band-inside model)

Inserts a band of new faces between the original polygon interior and a new, outwardly-displaced polygon boundary. The polygon visually grows; the band lives inside the new boundary. Specifically:

- The polygon's vertices are duplicated. The original vertices remain at their positions; new vertices are placed at the original positions plus Δ along their outward normals.
- The original interior face is unchanged in shape and frame.
- A band of trapezoidal faces (one per polygon edge) fills the ring between original and new boundary vertices. With convex k-gon faces (invariant 6), each trapezoid is a single 4-gon face; under the temporary triangle-only implementation each trapezoid is split into two triangles.
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

Rendering requires a choice of **root face** from which the walk begins. The current implementation uses a **viewport-following root**: whenever the viewport center crosses into a different face, `Atlas.switchRoot(newRoot)` re-anchors the atlas to that face and returns a compensation matrix `C` (the new root's old composite). The view's pan/zoom transform absorbs `C` so that no shape moves on screen — the change is purely a re-expression. This both keeps composites short (fewer transforms accumulated, better float precision) and makes face-relative gizmo math cheap (the focused region is, more often than not, near the root).

`switchRoot` is O(1) at the data-structure level: it only flips a pointer. The actual composite recomputation happens on the next render walk, from the new root.

### The walk

From the root, compute composite transforms for every face visible in the viewport. Implementation: breadth-first search from the root through the face graph, accumulating transforms. Only faces whose composite-transformed extent intersects the viewport need to be walked to.

Composites are computed fresh per frame; they are **not persisted** as state on faces. This guarantees stored data never drifts: only edge transforms (canonical primitives) and shape face-local coords (never written through composites) are stored. Per-frame float error from walk composition is bounded by walk depth and never accumulates.

The walk also acts as the spatial index. There is no separate BVH or grid: a face's composite-transformed extent against the viewport tells us whether to recurse into it and whether to render its shapes. For empty regions of the canvas the walk terminates after a handful of faces.

Pan and zoom are a global affine on top of the root: they multiply into the root's "to-screen" matrix and don't touch any atlas data. Panning does nothing structural; it changes one matrix at the top of the walk (and may trigger a `switchRoot` when the viewport center crosses a face boundary).

Note that there are many optimizations which can be explored in the future. And long-term we should consider what the computational ideal is in terms of asymptotic complexity.

### Per-face visibility (scalar)

The walk associates each visited face with a scalar `visibility ∈ [0, 1]` rather than a boolean "in viewport / not." Visibility is the product of independent factors, each a smooth falloff:

- **Screen-distance factor.** 1 inside the viewport rect; falls off smoothly to 0 over a buffer band beyond the viewport; exactly 0 past the buffer.
- **Scale factor.** 1 at on-screen scales; falls off smoothly to 0 once the face's effective per-pixel size of one local unit drops below ~1 logical pixel. (Trivially 1 in the translation-only regime; only becomes interesting once uniform scale enters.)
- Other factors can be added (e.g. opacity blend with depth in BFS).

For the prototype the **threshold is `> 0`**: any face with non-zero visibility is rendered, period. The plumbing exists so that culling can be enabled later by raising the threshold (and shapes can use the scalar for opacity blending, LOD, throttled event handling, etc.) without restructuring the renderer. In recursive / self-similar atlases (deferred) the visibility scalar is what makes BFS terminate naturally — the same logical face appears multiple times in the visible set, once per BFS path, and paths whose accumulated composite drives visibility to zero are pruned.

This is **per-face visibility only**. Per-shape visibility (a shape might be off-screen even though its face is on-screen) is a separate concern, not currently needed; if it becomes needed, it composes on top.

### Rendering shapes

For each face in the viewport, apply the face's composite transform as a single matrix, then render all shapes in the face with their face-local coordinates. Each face is essentially a "layer" with its own transform, and shapes within the layer are simple 2D content. For the DOM, this is applied via CSS transforms.

A shape lives in **exactly one face** at a time. In the translation-only regime (invariant 7) this is unambiguous: translations preserve size and orientation, so a shape rendered through any composite looks the same regardless of which face it's anchored to — the only thing that changes when a shape transitions across an edge is the bookkeeping (face pointer + face-local position).

Once uniform scale is enabled (future regime), one-face-per-shape produces "popping" at boundaries between faces of different effective scale: a shape's visible size pops when it transfers ownership across a non-trivial edge. The honest fix is **per-face clipped rendering**: split the shape against the face boundary it overlaps, render each piece through its own face's composite. The two pieces meet at the boundary with matching position but kinked size — which is the correct visualization of "you're crossing into a region with different local scale." This uses the same Sutherland-Hodgman polygon clipping the debug overlay already does for face polygons, so it's not exotic — just deferred until uniform scale lands.

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

### Subdivision algorithm

The historical framing was "triangulation algorithm" (constrained Delaunay over the polygon constraints). With convex k-gon faces (invariant 6) the question becomes "**convex planar subdivision** of the operation footprint." For our operation set — convex polygons with translation-only edge transforms — the subdivisions are constructive: each operation knows what sub-faces it needs to introduce and produces them directly, without going through a generic triangulator.

For example, expand-by-Δ on a convex k-gon produces k trapezoids around it, plus the unchanged interior face. Contract is symmetric. No CDT needed.

CDT remains a useful tool for two ancillary cases: (a) the temporary triangle-only implementation, where the trapezoids are split into pairs of triangles, and (b) any future operation that needs to insert an interior vertex into an arbitrary face. For (b), libraries to consider: `poly2tri`, `cdt2d`. Likely roll our own incremental Bowyer-Watson with constraint preservation eventually, for full control over ideal vertices and locality.

Convex decomposition for non-convex operation results (tears) is handled by each operation defining its own sub-face partition; the data structure never needs a generic non-convex decomposer.

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
- **Curved faces:** faces are flat convex polygons. Curves in the space come from many small faces, not from face geometry. This relates to the number of ideal vertices too: expanding a circular region looks better with more ideal vertices radiating outward.
- **Non-convex faces.** Per invariant 6, every face is convex. Operations whose results would be non-convex (e.g. tears) are responsible for decomposing into convex sub-faces at mutation time.
- **Rotation, shear, anisotropic scale, reflection in edge transforms.** Per invariant 7. These would break the conformal / angle-preserving property and reintroduce the discrete-curvature failure mode.
- **Global metric.** The atlas has no canonical distance/area/angle. Per invariant 3.
- **Per-shape stretching with face transforms.** A shape lives in one face and is rendered through that face's composite. Cross-face clipped rendering is deferred until uniform scale lands (at which point it becomes necessary, not just nice-to-have).

## Prototyping plan

Status as of writing: steps 1–3 complete and shape dragging (step 6) works for the trivial case. Edge gizmo and visibility plumbing are next, then the move to convex k-gons, then expand.

1. ✅ **Atlas substrate without operations.** Edge-primary half-edge graph with finite and ideal junctions, face-local coordinates, identity translations on every edge. Empty canvas = four wedge faces covering the plane.
2. ✅ **Walk + render.** BFS from root, accumulate composites, canvas-based debug overlay (clipped face polygons, edge strokes, centroid labels), pan/zoom on top as a global view transform. `switchRoot` re-anchors when the viewport center crosses a face boundary, with view compensation.
3. ✅ **Split primitives.** `splitFaceAtInterior` and `splitFaceAlongEdge` as the imperative testbed for atlas mutation; shift-click in the demo invokes them. Shapes are reassigned across the split using anchor-frame physical-position preservation.
4. ⏭ **Per-face visibility scalar.** Plumb the visibility scalar through the walk; renderer culls only at exact zero, but the value is available downstream (for opacity, LOD, recursion termination later).
5. ⏭ **Move to convex k-gon faces.** Generalize `Face.halfEdges` from a fixed 3-tuple to a variable-length CCW list; replace `triangleContains` with `polygonContains` (n half-plane tests, with a convexity-invariant assertion). Update splits accordingly. The empty canvas becomes a single 4-gon face, and operation-introduced faces match the operation's natural shape (trapezoids, quads) without forced triangulation.
6. ⏭ **Frame-change-at-point helper.** Factor out the duplicated rebase-at-point arithmetic from the split primitives into a single named operation. Generalize to handle non-translation transforms (in preparation for uniform scale, even though it isn't enabled yet).
7. ⏭ **Edge gizmo.** Click an edge (twin pair), drag a midpoint handle to set its translation. Triggers composite recomputation. The first interactive way to *see* the transform graph behaving as more than a static subdivision.
8. ⏭ **Region as operation host.** A `<folk-region>` DOM element with a convex polygon attribute. Adding it inserts the polygon's vertices and locally subdivides so the polygon's edges exist as edges in the atlas. All transforms remain identity. Render output is unchanged from before.
9. ⏭ **First operation: expand.** Adding `expand="20"` to a region: insert the band faces, set the band's outer-edge transforms to translate by Δ in outward normals. Verify interior shapes don't move, exterior shapes render at offset positions, and walks past the boundary compose correctly. Empirically verify cycle closure (translations around any closed loop sum to zero).
10. ⏭ **Mutating the operation.** Drag the region's gizmo to change Δ or polygon vertices. The operation element updates its atlas pieces in place — no replay. Verify visual continuity and locality (only the operation's own pieces change).
11. ⏭ **Shape dragging across non-identity boundaries.** Verify visual continuity (shape stays under cursor) and correct face reassignment when a shape crosses a band edge during drag.
12. ⏭ **Flatten.** Bake composite transforms into shape coords for a chosen region, replacing it with one identity-everywhere region. Visually a no-op; structurally a simplification. Sanity-checks transform math end-to-end.
13. ⏭ **Contract.** The non-trivial inverse of expand. Decide and implement policy for shapes in the removed band.
14. ⏭ **Multiple operations and stress test.** Verify two adjacent (non-overlapping) operations interact correctly via walks. Many operations, many shapes — measure per-frame cost and edit cost. Empirically verify sparsity and locality.

Only after these work should we consider nested atlases, tearing, uniform scale (infinite zoom / recursive spaces), or more exotic features.

## Open questions to revisit

- **The UX model for operations beyond expand/contract.** How do users compose, group, select, and constrain operations? How do operations relate to selections? How does the edge gizmo coexist with region gizmos?
- **Contract band shape policy.** Snap to new inner boundary, snap to nearest face, follow the inward transform (which collapses some shapes onto each other), or per-shape user choice.
- **Behavior when an expand gizmo's Δ is dragged negative.** Clamp at zero, switch to contract semantics, or disallow.
- **Per-shape visibility / opacity blending** as a layer over per-face visibility — needed only when shape counts grow large or when fade-edges are wanted as a UX cue.
- **Collaborative editing.** CRDT structure for operations and the atlas itself. Atlas mutations are non-commutative; conflict resolution would need real thought.
- **Persistence / serialization.** The half-edge graph with shared `twin`/`face` references is awkward to serialize directly. Likely the right format is the operation history, not the unrolled atlas.
- **Adaptive ideal-vertex insertion.** Starting with 4 ideal directions is fine for the prototype; some operations (e.g. expanding a circular region) want denser radial coverage. Adaptive insertion is the long-term answer.
- **Text and complex content across face boundaries.** Likely: content stays in one face for the foreseeable future. Per-face clipped rendering (deferred) is the principled answer.
- **Enabling uniform scale.** When and with what UX. The data structure accommodates it without modification; the renderer needs per-face clipped shape rendering at that point.

## Related prior work

The data structure draws from:

- **Combinatorial maps and half-edge structures** for the triangulation bookkeeping.
- **(G, X)-structures and geometric atlases** (Thurston) for the local-chart + transition-map framing.
- **Incremental Delaunay triangulation** (Shewchuk, Guibas-Stolfi) for the algorithmic basis.
- **Homogeneous coordinates and projective geometry** for ideal vertices.
- **Piecewise-flat / translation / dilation surfaces** for the rigid-pieces-with-transitions geometry.

The specific combination — sparse, ideal-vertex-capable, atlas-structured, optimized for interactive canvas editing with rich space operations — does not appear to be written up in this form elsewhere.
