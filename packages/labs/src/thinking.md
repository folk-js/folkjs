# SIA Prototype Direction: Gizmos + Fill Triangulation

## The substrate distinction

**The atlas is the substrate.** It deals in faces (edges are lower-level internals). It handles filling natively. It doesn't enforce a scheme.

**"Schemes" are choices in how the atlas is used**, expressed in `folk-atlas.ts` or equivalent. The atlas itself shouldn't know or care. Different applications can use the atlas with different schemes — the substrate is general-purpose; the scheme is where trade-offs get chosen.

## The trade-off space

Multiple approaches can be built on the atlas substrate, each trading different things:

- Local topology with non-identity edge transforms (gives up global Euclidean pan/zoom; gets exact rigidity within faces but loses it across cumulative edges with transforms).
- Sectored rigid translation (keeps Euclidean pan/zoom; accepts tears at ray discontinuities).
- Smooth render-time displacement field (no tears; accepts shear everywhere in affected regions).
- Shape-aware / explicit rigid groups (users designate important diagrams).
- Implicit rigidity via SDF-like kernels (system detects clusters heuristically).
- Compact-support operations (effect bounded; loses unbounded reach).
- Or other choices like looping / self-connected: the top-level face (or some designated face) has boundary edges identified with other boundary edges of itself, giving toroidal, cylindrical, Klein-bottle, dilation-loop, or other topologies.

The atlas should let these be expressed without baking any of them in.

## The chosen direction for this prototype

**Gizmos + fill triangulation + "shear may exist but is minimized by good triangulation."**

- Gizmos replace direct edge manipulation (which was always wrong — it was just there to poke things).
- The atlas auto-triangulates within each face (can be in euclidean terms, i suspect, if we normalize things right and extend delauney or whatever to support ideal vertices).
- Gizmos are convex polygon child-faces placed inside existing faces.
- When a gizmo is added/sized (on pointer-up, not during drag, to reduce churn), the containing face is re-filled.
- Filling is always scoped to one face at a time. Face edges never overlap.

## Recursive structure

- Base case: one face (the infinite plane).
- Add a gizmo: the outer face gets a child; its interior is filled to accommodate.
- A gizmo inside a gizmo is the same pattern one level down — each face handles its own fill independently.
- This directly supports nested operations (and eventually infinite zoom / recursive canvases).

## Terminology

The "triangulation in the context of a face" wants a name. **Fill** — it's short and clear. The face has a boundary (can be finite or ideal), some contents (child gizmos), and fill between. "Fill faces" for the interstitial polygons produced by the filling process.

## What "good fill" looks like

- No super-thin slivers.
- No super-acute angles.
- Local — adding a gizmo only creates new fill near it.
- Deterministic.
- Works with finite and ideal boundary vertices.

For first prototype: **constrained Delaunay triangulation** of the parent face's complement-of-gizmos. The parent boundary and gizmo boundaries are constraints. Output is triangles for fill. Sub-faces (gizmos) stay as whatever polygons the user made them — n-gon where needed.

Ideal vertices on the boundary can be handled by extending constrained Delaunay, or by bounding with a large representation and treating ideals as points on that boundary. (the latter, i will point out, is incorrect)

Face identity for unchanged faces must be stable.

## The semantics of a gizmo

A gizmo is a convex child face with transforms on its boundary edges encoding its geometric effect. For the "make space" gizmo: each boundary edge's transform is its outward-normal times Δ, where Δ is user-controlled (dragging to grow).

At Δ=0 everything is identity. As Δ grows, the gizmo's effect on the parent's fill grows.

Fill triangulation plays the role of sectored decomposition: each fill triangle is effectively a "sector" with its own rigid translation. Fill-triangle boundaries are where discontinuities live. Good fill makes these discontinuities small and well-distributed.

**Correction on reach:** fill is bounded by the parent face's boundary — when the parent face _is_ the infinite plane (ideal vertices at infinity), the fill still extends to infinity, and so do the effective rays-from-gizmo-vertices. That's fine; that's how a gizmo in the top-level plane gets effect at all distances. For a gizmo inside a finite parent, the fill is bounded by that parent.

## Implementation sketch

1. Replace `editEdgeTranslation` with a `createGizmo` primitive that adds a child face inside a parent.
2. Implement fill triangulation (constrained Delaunay) scoped per-face.
3. On gizmo creation/resize/move (pointer-up), re-fill the parent.
4. Set gizmo boundary transforms per outward-normal × Δ.
5. Set fill-internal edge transforms to reconcile adjacent fill faces (maintaining cycle closure).
6. Validate invariants (cycle closure, junction consistency) in dev.

## Architectural summary

- Atlas (`atlas.ts`): faces, half-edges, transforms, topology mutations, fill/tesellation/triangulation. Scheme-agnostic.
- Application layer (`folk-atlas.ts`): gizmos, UX, scheme-level operations. Translates user gestures into atlas mutations according to the chosen scheme.
- Validator: separate, dev-only, composable per scheme. Fine to bake into whichever file for now

### Future Notes

The current code hardcodes Matrix2D as the edge transform type. The substrate could instead require transforms to satisfy a small interface (apply-to-point, compose, invert, identity), letting schemes provide their own transform types. Potentially useful for Nonlinear radial maps for fisheye-lens gizmos. Möbius transforms for bounded-hyperbolic infinite zoom — zoom forever into a region without coordinates blowing up. Among others. Not important now though.
