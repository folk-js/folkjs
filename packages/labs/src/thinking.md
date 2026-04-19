## Things worth thinking about before they bite

**Brute-force point location.** Fine now, will bite later. The replacement is straightforward and doesn't change the API — swapping in a walk-based or spatial-index-based locator is a local change.

**`#lastComposites` rebuilt from scratch per frame.** Fine now (atlas is tiny), a hotspot later. The interesting thing is that composite invalidation is a graph problem: when an edge transform changes, every face downstream of that edge in the BFS tree from root needs invalidating. The BFS tree already has the structure needed to make this incremental.

**Frame-change arithmetic as a named concept.** The pattern `T_sub_to_ext = T_old · translate(p)` / `T_ext_to_sub = translate(-p) · inv(T_old)` shows up three times across two functions. That's a real operation with a real signature: "rebase a face frame at a point, re-expressing external transforms accordingly." Naming it and giving it one implementation will pay off as soon as you do anything beyond splits. Especially important once non-identity edge transforms exist, because the same logic has to work when `T_old` isn't identity.

**Shape-to-face reassignment via old-composites round-trip.** Works for now, but the cleanest version takes `(oldFace, subFaces, shapes, point)` and does the reassignment directly in face-local arithmetic rather than round-tripping through root-local. For identity transforms the two are equivalent; for non-identity transforms the round-trip is an extra source of floating-point error.

## Broader observations from seeing it in code

**The mathematical object is leaner than the discussion suggested.** The atlas is really just: a graph of half-edges with origin data and twin transforms. No vertex objects, no explicit equivalence classes, no separate "patch" abstraction, no reference surface, no operation stack. The theoretical layering we'd sketched (reference surface + operation stack + chart structure, with patches as a maximal-identity abstraction) was scaffolding for thinking; the actual object collapses all of it into the half-edge graph. Feels right.

**Junction identity is a computation, not a thing.** In a standard half-edge mesh, vertices are objects that own things. Here, position is per-half-edge (in its face frame), and "same vertex" is emergent from twin + next, verified at traversal time by the invariant that twin transforms carry origins to origins. This means **junction consistency is a derived property, not an enforced one.** Slightly scary but correct, and it accommodates future features like branch points / cone angles by intentionally relaxing the consistency at specific junctions.

**The transform invariants suggest a reduced representation.** Given a twin pair's transform and one half-edge's origin data, the twin's origin data is forced. You're storing both, with validation ensuring consistency. An alternative stores origin on only one half-edge per pair (the "primary") and derives it for the twin, halving origin storage and making junction-consistency structural rather than validated. Probably not worth doing now, but worth knowing the representation is "doubled" relative to its information content.

**Faces are abstract shapes that happen to live somewhere.** Because `halfEdges[0]`'s origin is always finite `(0, 0)` and the face's other junctions are expressed relative to it, a face is really a pair: (an anchor choice, plus relative offsets to other vertices). Absolute position in any sense comes only from the composite transform at render time. Two atlases with identical face-shape data and identical transforms but different roots are _the same atlas_ up to rendering convention. Root isn't part of the atlas's identity; it's a pointer into it.

**Splits live in a simpler algebra than operations will eventually need.** Splits introduce only translations between old and new sub-face frames — no non-identity linear parts. Other operations (expansions, tears, dilations) will introduce genuine non-identity edge transforms. Worth keeping the distinction explicit, because the "rebase-at-point" helper is specifically translation-shaped right now but will need to generalize.

**The atlas isn't a metric space.** There's no notion of distance in the structure. Face-local distance is ordinary Euclidean on face-local coordinates; distance between points in different faces is only meaningful once you pick a frame to express both in, and re-expressing through non-isometric transforms (dilations) will give different answers depending on frame choice. Distance is a derived concept computed via walks, and its canonical form depends on which transforms you assume to be isometries. The atlas is a _geometric structure_, not a _metric space_ — the difference is load-bearing.

**Shapes currently transform with their face.** Fine for rectangles under translation-only edge transforms. But once edge transforms have non-identity linear parts (scale, shear), a shape rendered through a composite will be visually stretched — which you want for some operations (dilation zoom) but not others (translation expand — the shape should move, not deform). The deeper structure: a shape has its own local frame, attached to a face by a frame-placement. Rendering is: face composite · shape placement · intrinsic shape geometry. Current code bakes placement into `(x, y)` and doesn't separate shape frame from face frame. Eventually you'll want an explicit shape-frame concept, probably with a per-shape flag for whether to resist face deformation.

**Mutation operations decompose into combinatorial rewrite + transform specification.** Every mutation is a local rewrite of the half-edge graph, plus a specification of the new edge transforms introduced. Splits interleave these; separating them would make more complex operations composable. A single op like "expand polygon by Δ" would decompose into: (1) subdivide each boundary edge to introduce new junctions and insert new triangles between old boundary and new one, (2) set transforms on the new edges to implement the Δ displacement.

**The at-infinity half-edges are a bookkeeping element, not a geometric one.** A face bounded by two adjacent ideal junctions has a "closing" half-edge between them with no twin, never stroked, never rendered, never crossed. It exists to make face iteration uniform. Slight abstraction leak — face data structure pretends all edges are equal, but some are physical and some are placeholder. Worth documenting.

## The n-gon question

Seeing this in code made me wonder whether the triangle assumption is actually earning its keep. I now think it isn't.

Triangles are conventional in meshes for reasons that are specific to mesh processing: unique planar embedding from three points, unambiguous barycentric interpolation, mature triangulation algorithms, GPU hardware preference. Of these, only the first is semantically meaningful for SIA — **face interiors don't need interpolation** (no per-vertex data is interpolated across a face), and we're not rasterizing triangles, we're applying CSS transforms to DOM subtrees.

Meanwhile, the operations we actually want produce n-gons naturally:

- **Expanding a polygon** produces the original n-gon as inner boundary, an expanded n-gon as outer boundary, an annular strip between. Triangulating the strip requires choosing diagonals that aren't semantic.
- **Tearing along an arc** produces a face that's become an n+2-gon with the two new arc-sides. Triangulation adds non-semantic diagonals.
- **The empty canvas** is semantically _one flat region_. With triangles, it's four wedge faces meeting at origin — four faces because each has to be a triangle, not because anything is distinct about the quadrants. With n-gons, it's one face with four ideal boundary half-edges and no twin pairs.

The triangles are artifacts of representation, not structure. **The natural "face" of an SIA is the maximal region sharing a single local coordinate frame, bounded by the edges where frame changes happen.** That's almost never a triangle.

With n-gon faces:

- The at-infinity half-edge stops feeling like a hack — it's just a boundary cycle element where two adjacent junctions happen to both be ideal.
- "Sparse" becomes genuinely sparse: faces exist only where operations create them.
- Face count is a meaningful semantic quantity ("how many regions have distinct frames") rather than a triangulation-quality artifact.
- Storage scales with operation complexity, not with triangulation choices.

Constraints I'd keep:

1. **Simply-connected faces** (topological disks). Annular operations subdivide into simply-connected pieces.
2. **Convex faces**, to keep containment cheap (n half-plane tests). Non-convex results subdivide into convex pieces.
3. **Anchor convention stays**: `halfEdges[0].origin` at face-local `(0, 0)`, frame is unique.

Concrete code change is small: `halfEdges` becomes variable-length, `triangleContains` becomes `polygonContains` with a convexity invariant check, splits produce polygon sub-faces where appropriate. Conceptual change is bigger: **faces are operation-induced regions, not triangulation primitives.** The data structure mirrors the operation history more directly.

Our triangulation would then become planar subdivision of some kind.

One thing to watch: non-convex operation results (tears, annular expansions) need a plan for convex decomposition. Not urgent for the first operations, but don't let the convexity invariant quietly break.

I think n-gons are the right move, and worth doing now before the code has many consumers. It aligns the structure with its semantics rather than with inherited mesh-processing conventions.
