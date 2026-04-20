# Sparse Ideal Atlas: Direction

## What the atlas is for

A substrate for 2D canvas-like spaces that are locally Euclidean but globally can do things a flat plane cannot: stretch and morph in response to operations, host recursive or infinite-zoom structures, loop or self-connect, and support bounded-precision navigation across all of these. The goal is that building any of these feels natural on the same substrate — that "normal canvas" is just the degenerate case where none of the interesting topology is used.

The atlas handles the structural commitments (faces with local frames, half-edges with transforms, face-relative coordinates for precision, adaptive root for rendering). Applications on top of the atlas choose _schemes_ — how gizmos and operations translate into atlas mutations. The substrate is general-purpose; the scheme is where specific trade-offs are picked.

## Key commitments (the substrate)

- **Faces, not just edges.** Faces are the primary unit. Each has a local coordinate frame, a canonical anchor (face.halfEdges[0] at local origin), boundary half-edges, and may contain shapes at face-local positions.
- **Half-edges carry transforms.** Each twin pair relates two adjacent faces' frames. Transforms compose through walks; composites are computed fresh per render.
- **Face-relative coordinates.** No global frame, no world center. Shapes are stored in their containing face's frame. Rendering picks a root (viewport-centered) and walks to compute composites.
- **No edge transforms shall accumulate walk-dependent meaning.** A shape's rendered position must be walk-independent — cycle closure holds everywhere.
- **Validator is dev-only.** Invariants (cycle closure, anchor canonicality, junction consistency, CCW+convexity) are checked in development; production skips them.
- **Schemes live in the application layer.** The atlas does not enforce what operations mean. `folk-atlas.ts` (or equivalent) picks a scheme; the atlas supports the primitives.

## The chosen scheme: recessed regions

After extended exploration of many schemes and their trade-offs, the direction we've converged on is the **recessed region** model. This is the scheme for the prototype, and it's the one that gives us the properties we actually want.

### The fabric analogy

Think of the canvas as a plastically-deformable fabric. In its neutral state it is flat and Euclidean. Drawing a gizmo creates a **recessed region** — a pocket pushed into the fabric. The recession has a flat interior (its own Euclidean region) and a ring of transition polygons mediating between the interior and the exterior.

- **Inside the recession**: flat, Euclidean, intrinsically as large as it is (possibly larger than the "mouth" of the recession would suggest from outside).
- **Outside the recession**: flat, Euclidean, entirely unchanged by the recession's presence.
- **Transition ring**: real 2D polygons that carry the geometric bridge between inside and outside. These are the "slope" of the fabric recession.

### Rendering depends on where the viewport center is

The core mechanic that gives us full locality is that **the viewport center's face chooses the root**, and composites are relative to that root:

- **Viewport in the outer face**: outside renders native-sized (stored coordinates). The gizmo appears at its compressed outer-view size: a small inner region surrounded by the transition ring. Changing the gizmo's inner size does not change anything about the outer face's rendering.
- **Viewport in the inner face**: inside renders native-sized. The outside is visible "through the gizmo's mouth" at compressed outer-view size. Changing outer extents does not change the inner rendering.
- **Viewport center on a transition polygon**: smooth interpolation. That polygon becomes root; neighbors render relative to it; panning across the transition ring smoothly shifts the view from outer-native to inner-native (or vice versa). No visual jumps because root switches are compensated.

### Full locality, genuinely

Alice grows her gizmo's inner size. Bob is elsewhere, his viewport center in an outer face.

Bob's root is his outer face. Bob renders his own content at stored positions, unchanged. Alice's gizmo in Bob's view (if it's visible at all) still has its outer appearance — same transition ring width, same compressed inner rendering. The only thing that has changed is the specific content inside Alice's gizmo, if Bob's viewport happens to include Alice's gizmo (which he sees compressed anyway).

**Bob's content does not move.** Adjacent faces to Bob's origin do not shift. No shear, no translation, no falloff-effect at distance. The growth is entirely local to observers whose viewport center traverses into Alice's gizmo.

Effect at distance comes from navigation: if Bob pans toward Alice's gizmo and enters it, the journey is longer than it was before Alice grew it, because the inner region is intrinsically larger. This is space genuinely expanding — navigational distance increases without any distant points shifting.

### Two operations, two handles

Growing a gizmo's **inner** size and growing its **outer** extent are different operations with different semantics:

- **Inner handle** (at the inner edge of the transition ring): drags out the gizmo's interior. Inside becomes bigger, outside unchanged.
- **Outer handle** (at the outer edge of the transition ring): drags the outer boundary. The gizmo takes more visual space in the outer face.

Both handles exist on the transition ring — one edge per side — and give users clear, distinct affordances.

### Why this works where earlier schemes did not

The long conversation explored many schemes that ran into structural problems:

- **Sectored rigid translation with rays to infinity**: gave effect at all distances but violated locality — Alice's growth propagated along rays into Bob's area.
- **Smooth displacement fields (falloff)**: gave continuity but shear everywhere; no region was truly rigid.
- **Compact-support bumps**: gave locality but had to place the effect-boundary somewhere, concentrating error where unlucky content sat.
- **Voronoi-based fill**: concentrated error on Voronoi cell boundaries; same unlucky-content problem.
- **Rigid groups or shape-awareness**: gave locality but required users to designate content explicitly.

The recessed region model escapes this because **it does not try to distribute effect across the outer face at all.** The gizmo's effect is purely internal to its own structure (inner + transition ring). The outer face is entirely unaffected by changes to the gizmo. "Effect at distance" is reinterpreted as navigational distance, not as distant displacement.

This requires abandoning the goal of "distant shapes translate outward when a gizmo grows." But that goal was the source of the trade-offs. Giving it up gives us everything else we wanted: true locality, rigidity everywhere, no shear, no discontinuities, no shape-awareness, no rigid-group designation.

## Structural layout

For a convex gizmo inside a parent face:

- The **inner face** (a convex polygon, the gizmo's interior) is a normal face in the atlas.
- The **transition ring** is a set of polygonal faces arranged around the inner face, with a consistent width. Each transition polygon has:
  - One edge shared with the inner face.
  - One edge shared with the outer face.
  - Two edges shared with adjacent transition polygons.
- The **outer face** is the parent face (the plane, or whatever contains the gizmo). From the atlas perspective, the gizmo introduces a boundary into the outer face — ideally a hole, or as a fan subdivision if we don't support holes initially.

Transforms on edges:

- **Inner ↔ transition polygon**: encodes the relationship between the inner face's frame and the transition polygon's frame. Set so the inner's boundary matches the transition's inner-side edge geometrically.
- **Transition polygon ↔ outer face**: encodes the relationship between the transition's outer-side edge and the outer face's corresponding boundary.
- **Transition polygon ↔ adjacent transition polygon**: encodes the continuity of the ring around the gizmo.

The transforms are chosen such that:

- Walking inside a face (same frame) is Euclidean.
- Walking across a transition polygon smoothly bridges inner and outer frames.
- Cycle closure holds globally (walks from root to any face give a unique composite).

Growing the gizmo's inner size changes the inner-to-transition transform (more intrinsic inner units per transition unit). Growing the outer extent changes the transition-to-outer transform (more outer units per transition unit). These are independent operations.

### About the transition ring's transforms

For the inside and outside to both be Euclidean, the transition ring is where any non-Euclidean behavior lives. Two options for representing it:

1. **Many small affine polygons approximating the transition**: the ring is subdivided finely enough that each polygon's transforms are approximately the local tangent of the smooth transition. This keeps the atlas purely affine (Matrix2D throughout) at the cost of many faces.
2. **Fewer polygons with richer transforms**: allow non-affine transforms on the transition polygons' boundary edges (e.g., nonlinear radial maps), so a single polygon can represent a significant section of the transition. This requires generalizing the atlas's transform type.

The first option is simpler to implement; the second is cleaner conceptually. Start with the first; generalize later if the need becomes acute.

## What gives us embedded / recursive / looping

The recessed region model composes naturally with richer topologies:

- **Embedded gizmos**: a gizmo inside another gizmo's inner face. The inner face has its own recession; this is just recursion at one extra level. No special handling.
- **Recursive / infinite-zoom**: a gizmo whose inner face connects (via its transition) back to a larger region of the canvas. Zooming in shows a smaller-rendered version of something else; zooming further keeps doing this. Requires transforms that include scale (similarities, or Möbius for bounded hyperbolic recursion).
- **Looping**: a face (possibly the inner face of a gizmo, possibly a plain face) has boundary edges that twin back to other edges of itself. Pan across and you wrap.

These are all achievable by choices of topology and transforms on the same substrate. The recessed region model is the scheme for the "stretch space" operation; other operations (recursive, looping) use similar structural primitives with different transform and topology choices.

## Other schemes we've mapped (for reference)

The atlas substrate should permit multiple schemes. Some we've identified:

- **Local topology with non-identity edge transforms**: gives up global Euclidean pan/zoom in exchange for exact per-face rigidity and simple edge transforms.
- **Sectored rigid translation**: global Euclidean with ray discontinuities at sector boundaries.
- **Smooth render-time displacement field**: no tears, but shear in affected regions.
- **Compact-support operations**: bounded effect radius.
- **Shape-aware / explicit rigid groups**: user designates important diagrams.
- **Looping / self-connected schemes**: torus, Klein bottle, cylinder, dilation loop, rotational wrap.

The recessed region is our default. Others are available and may be useful for specific applications; the atlas should not preclude them.

## Transform types: where we stand

The current code uses `Matrix2D` for edge transforms throughout. This handles:

- Translations (the common case for gluing flat faces).
- Rotations (needed when faces have non-aligned orientations around a gizmo).
- Reflections (needed for Klein-bottle-like identifications).
- Scales (needed for similarity-based recursion).

Beyond Matrix2D, there are cases where richer types matter:

- **Möbius transforms** for bounded hyperbolic infinite zoom.
- **Conformal maps** for clean welding of curved boundaries.
- **Nonlinear radial maps** for fisheye-lens gizmos.
- **Arbitrary smooth diffeomorphisms** for the transition ring in the recessed region model (one way to represent non-affine transitions).

The substrate could abstract over this by requiring transforms to satisfy a small interface (apply, compose, invert, identity). For now, `Matrix2D` is sufficient; we keep in mind that the abstraction is possible and avoid hardcoding matrix specifics where an interface would work.

## Filling / between-face structure

Earlier in the design we talked about "fill" — triangulating the space between gizmos. The direction has evolved:

- "Fill" as a separate concept is probably the wrong abstraction. There are just faces.
- Ordinary n-gon faces (without UI handles) are gizmo-lite — regions the user or the system creates to organize space.
- The between-gizmo structure should be **derived from the gizmos themselves**, not from a separate triangulation step. Voronoi-like decomposition, or something more sophisticated that considers content distribution, is the design space.
- For the recessed region scheme specifically, the "between" is simple: gizmos have transition rings, and outside the rings is the outer face (or a hole in it). No triangulation is needed between gizmos — they just sit in the outer face.

When the outer face needs to have holes (for gizmos), the atlas may need to support faces with multiple boundary loops. This is a known extension. Start without it (use fan subdivisions if needed); add hole support if the fan approach becomes painful.

## Planar embedding, cycle closure, and correctness

Every valid atlas configuration must satisfy:

- **No face overlaps**: the rendered faces, drawn via composites, tile their region without overlap.
- **No face gaps**: no uncovered regions.
- **Cycle closure**: walks between any two faces give a unique composite (independent of path).
- **Junction consistency**: twin half-edges agree on the geometry of their shared edge after transform.
- **Convex faces** (in the current scheme): polygon containment tests are unambiguous.

Discontinuities violate these invariants. A scheme that appears to have discontinuities is not a valid atlas — the structural resolution is to introduce real faces (strips, wedges, transition polygons) that absorb the discontinuities. The recessed region model does this by construction.

## Gizmo creation and editing

Gizmos in the recessed region scheme are created at any size. A gizmo can start at any size; the "size" is not tied to Δ from zero. Growing or shrinking is just modifying the inner or outer size parameter on an existing gizmo.

During continuous interaction (drag):

- Edit the relevant transforms on edges (inner-to-transition, transition-to-outer).
- The atlas stays valid (cycle closure maintained by construction).
- Face stored geometries on the transition ring may update to match the new size.

On pointer-up:

- Re-triangulate the transition ring if it has become degenerate (e.g., very thin).
- Re-derive the structure if topological changes are needed.

Shapes' stored coordinates never change from gizmo operations. Shapes in the inner face stay at their inner-frame positions; shapes in the outer stay at outer-frame positions. Only transforms on edges move.

## What still needs design work

- **Exact geometry of the transition ring**: how many polygons, what shape, what stored geometry. Probably parameterized by the gizmo's boundary (number of vertices, curvature).
- **The transform profile across the transition**: affine approximation vs. non-affine. How smooth is the slope.
- **Rendering the transition ring visually**: should it have a visible "mesh" or "emboss" effect that makes the geometry legible to users, or render transparently? UX question.
- **Handles and interaction**: UI for the inner and outer handles, how they're distinguished visually, how they feel to drag.
- **Supporting faces with holes** (eventually): for scaling to many gizmos cleanly.
- **Cut operation** (a separate gizmo type): dividing a face along a line, possibly inserting a strip of new normal-space between the halves. Different semantics from the recessed region.
- **Compose with recursive / looping topologies**: how the recessed region interacts with gizmos whose inner face loops or recurses.

## The prototype plan

1. Replace `editEdgeTranslation` with structured gizmo creation.
2. Implement the cut gizmo first (simplest: adds a strip face along a line, two halves of the parent continue normally). This tests the basic structural mutation machinery without needing the transition ring.
3. Implement the recessed region gizmo: inner face + transition ring + outer face (with hole support or fan subdivision).
4. Implement handles on the transition ring for inner and outer size.
5. Validate all invariants (dev-mode): cycle closure, containment, junction consistency.
6. Test the rendering at viewport-center crossings: pan across a transition ring, verify smoothness.
7. Experiment with transition ring rendering styles (emboss-like vs. transparent).

Other schemes (looping, recursive) can be prototyped later on the same substrate.
