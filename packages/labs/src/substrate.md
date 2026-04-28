# Substrate Direction: Condensed Notes

Companion to `thinking.md`. That doc captures the chosen _scheme_ (recessed regions). This one captures the structural shape of the _substrate_ underneath, as it should look after the upcoming refactor. Not a plan — a reference for the directions and the things explicitly left open.

## The goal-state feel

Two intuitions:

- **Working _in_ the space feels pseudo-Euclidean.** Code that works in flat 2D should port over and "just work." Novel behaviours (wrap, recursion, recess) emerge from the topology, not from extra ceremony at the call site.
- **Working _on_ the space feels algebraic.** Edits are compositional, every primitive that creates structure hands it back, primitives have paired inverses, schemes are configurations rather than imperative recipes.

A useful test: any topology demo we describe should be a one-paragraph configuration if the substrate is right. If it requires a thousand-line scheme, the substrate is wrong.

## What we have already committed to

- **The geometry library is separable.** A self-contained library for the **oriented projective plane** (R² ∪ S¹ with antipodes-distinct). It knows nothing about atlases, faces, or stitches; it's the foundation that every model space (today's R², future H², S², discrete spaces) plugs into.

- **Convex polygons everywhere.** Faces are convex k-gons; nothing in the substrate knows about axis-aligned bounding boxes.

- **Faces have multiple loops.** One outer CCW loop + zero or more inner CW loops. Standard DCEL extension. Inner loops are what some codebases call "holes."

- **Two named primitives for binding faces together: stitches and links.** A `Stitch` is a reciprocal binding between two edges (one from each face) with a transform; reciprocity is by construction, the asymmetric-twin trap is structurally impossible. A `Link` is a directed binding from a parent face to a child face, with a transform placing the child within the parent's frame; many links can target the same face. Manifolds are made of stitches; recursive/hypertext structures are made of links. Most schemes use one or the other; mixed is allowed.

- **An atlas with no links is a true atlas.** Once links are added, the structure is "an atlas plus links" — a directed multigraph on top of a base atlas. The `atlas/` folder name stays honest because the base concept is genuinely an atlas; links are an additive layer.

- **Schemes are not a layer.** A scheme is a named composition of substrate operations plus its UI affordances — no scheme-specific bookkeeping, no scheme-specific render path, no rescue logic. If a scheme requires substantial code, the substrate isn't general enough.

- **Recessed region and recursive structures are both target schemes.** Recessed regions are stitch-only; recursive zoom is naturally link-based.

## Structural shape

### Faces

- **Frame stored on the Face directly** (`frame: Matrix2D`). Frame transformations aren't constrained to fix-the-origin operations. As a side effect, an "all-ideal" face is representable, and the empty scene is a single face whose outer loop has all-ideal vertices.
- **Faces own their boundary edges.** Each face has its own private edges in face-local coordinates. There's no shared "logical edge" between two faces; instead, two edges (one from each face) are bound together by a Stitch. This keeps each face's geometry self-contained in its own frame.

### Edges

- **`Edge` is the boundary segment.** Two endpoints (junctions), in face-local coordinates, with optional `stitch?: Stitch` and optional `link?: Link`. It carries geometric data (length, midpoint, contains-point) and is the unit of subdivision.
- **No half-edges.** `Edge` for geometry, `Stitch`/`Link` for bindings. Directional traversal comes from iterating a face's loop — the loop's order implies direction; no separate "Side" or "HalfEdgeView" type.

### Loops

- **A face's boundary is a list of `Loop`s.** First loop is the outer (CCW), the rest are inner (CW). A "hole" is just an inner loop with no bindings on its edges.

### Stitches

- **`stitch(edgeA, edgeB, T)` returns a `Stitch`.** It binds the two edges with a transform that maps one's frame to the other's; the inverse direction is implicit. `unstitch(s)` undoes it. Each edge holds at most one stitch; re-binding requires `unstitch` first.
- **Reciprocal by construction.** If an edge is stitched, both sides know about it via the same `Stitch` object; there's no way to express an asymmetric binding here.

### Links

- **`link(parent, child, T)` returns a `Link`.** Places the child face inside the parent's frame at transform T. `unlink(l)` undoes it. The "where in the parent does the child appear" is implicit in the transform applied to the child's outline.
- **Many-to-one allowed.** A single child face can be the target of many Links from different parents with different transforms. The same child appears in many places.
- **Walking out of a child needs a return-path policy.** The substrate stores `(parent, child, T)` and nothing else about the back-direction. What happens at the child's outer boundary when a walker reaches it is a separate policy chosen by the walker (or the scheme). Common options:
  - *Contextual to entry* — remember which Link brought you in; leave via its inverse. Good default for visual continuity in zoom-style navigation.
  - *Designated primary parent* — child has one "home" parent; walking out always goes there regardless of how you entered.
  - *No return* — the walk terminates at the child's outer boundary; navigation back is a UI affordance.
  - *Paired return Link* — each entering Link is paired with a returning Link, possibly with a different transform.
  
  None is "the" answer; they're all valid for different schemes.

### Free edges and loops

- **Edges and loops with no stitch and no link are simply free.** Walking off a free edge terminates the walk. No sentinel face, no marker; the absence of a binding is its own meaning. "Infinite plane," "finite paper," and "open hole" are all just the absence of bindings on different loops.

### IDs and handles

- **Object identity is the runtime story.** `Face`, `Edge`, `Loop`, `Stitch`, `Link` are objects; equality is reference equality. No string/numeric IDs until persistence becomes a real requirement.
- **First-class handles in the API:** `Face`, `Edge`, `Loop`, `Stitch`, `Link`. Internal-only: `Junction`.

## Stitches and links: how they relate

Two binding primitives, one substrate. Their differences are small but consequential:

| Property | Stitch | Link |
|---|---|---|
| Topology | reciprocal (undirected) | directed |
| Held by | a specific edge of each of two faces | a parent face and a child face |
| Multiplicity per anchor | one per edge | many parents → one child allowed |
| Transform | one, with implicit inverse | one, no implied inverse |
| Geometric alignment | edges' geometry must align (they're "the same line" up to the transform) | no constraint; child placed wherever the transform puts it |
| When closed under cycles | gives a (G,X)-manifold | not necessarily; gives a directed graph of patches |

Schemes pick whichever they need. Stitches alone give us tori, recessed regions, hexagonal tilings, hyperbolic tilings, Klein bottles. Links give us recursive zoom, hypertext (per `website/demos/space/hypertext-zui.html`), and any structure where "the same face appears in many contexts." Mixed is allowed: a torus made of stitches that also contains a link-nested ZUI inside one of its sub-faces.

"Manifold-shaped" is a property an atlas can have (all bindings are stitches; cycle closure holds; transitions consistent) and the validator can check on demand.

### Implications for closed surfaces and recursion

- **A closed surface (full torus, full Klein bottle) cannot be embedded as a child via stitches alone.** It has no free boundary edges to stitch to a parent. To embed a torus-like region using stitches, you express it as a *surface-with-boundary*: a torus-with-puncture whose puncture-loop is the entrance, stitched to the parent. Alternatively, you Link it: the closed surface remains closed, and a Link places it inside the parent.
- **Pure recursion on a single region** — "zoom in forever, see the same thing nested smaller" — is a Link from a face to itself with a similarity transform. One primitive, one line of code.
- **Recursive chains** — "P contains A, A contains B, B contains C, C contains A" — are a small set of Links between four faces.

## Where change lives: across-boundary vs within-face

Three distinct cases for "how does the world deform" — calling them out separately because they end up tangled:

- **Discrete change at a boundary ("TARDIS").** Crossing a boundary lands you at a different scale, position, or orientation. Pure stitch/link semantics — the binding's transform carries the change. A face is "bigger on the inside" because its outer stitch/link has a transform with scale ≠ 1.

- **Smooth change across a face.** Geometry stretches or shrinks continuously within the face. The face's *model space* is non-flat: `(R², conformal)` for angle-preserving stretch, `(H², Möbius)` for genuine hyperbolic distance, etc. Combinatorics unchanged; the model space supplies the geometry.

- **Visual-only distortion.** Math inside the face is plain Euclidean; only the chart-to-screen rendering deviates. A per-face render hook (a function `local → screen`) overrides the default affine projection. Doesn't affect the substrate; only rendering.

Heuristic: *discrete-at-boundary is a stitch/link property; continuous-across-face is a model-space property; visual-only is a rendering property*.

## Surgery API

Fluent and mutating, with intermediate values:

```ts
const hex = atlas.createFace(hexagonVertices);
const [e0, e1, e2, e3, e4, e5] = hex.loops[0].edges;
stitch(e0, e3, T_h);
stitch(e1, e4, T_d1);
stitch(e2, e5, T_d2);
```

- **The runtime atlas is a stateful object.** Methods mutate in place and return the relevant new structural pieces (`Face`, `Edge`, `Loop`, `Stitch`, `Link`).
- **Every structural primitive has a paired inverse function.** `stitch` ↔ `unstitch`, `link` ↔ `unlink`, `createFace` ↔ `deleteFace`, `splitEdge` ↔ `joinEdges`, `splitFace` ↔ `mergeFaces`. The inverse is another function call, not a record. No `Move`/`Op`/`Surgery` type to construct.
- **Parametric changes are setters, not surgery.** Moving a face, rotating it, dragging a shape, scaling — these change values on existing structure (`face.frame = newFrame`, `shape.position = newPosition`). They don't go through the surgery API; they're plain mutations.
- **Composite operations** (today's `splitFaceAlongChord`, `insertStrip`, etc.) are finite sequences of primitives — named macros with their own validity checks but no extra mutation logic. The line between substrate and surgery library lives at the size of the primitive set.
- **Optional journaling later.** A thin wrapper that records each call gives undo stacks and replay. Doesn't need to be designed for now.

## The intrinsic API (pseudo-Euclidean inside)

A `Point`/`Vector` API where the chart is an implementation detail:

```ts
type Point   // internally (face, localX, localY) but doesn't expose it
type Vector  // tangent vector with an implicit base chart

p1 + v          // walk: exponential map across charts as needed
p1 - p2         // local geodesic; on non-simply-connected, multi-valued
shape.translate(v)
```

Two subtleties to settle when this is built:

- **`p1 - p2` is multi-valued on non-simply-connected spaces.** The API has to pick a discipline (shortest geodesic, primary + holonomy generator, refuse). This is where to make the choice — not at every call site.
- **Adding vectors at different base charts requires parallel transport**, which is path-dependent on a non-simply-connected manifold. Same point: pick the discipline once.

## Model-space pluggability

The substrate's combinatorics (faces, edges, loops, stitches, links) is independent of _what kind of space_ a face represents. The model space is per-face: a value combining a model (the X) and a transformation group (the G).

Construction reads like the math notation:

```ts
const Plane    = modelSpace(R2,  Similarity);
const HypPlane = modelSpace(H2,  Mobius);
const Sheet    = modelSpace(Z2,  Translation);
const Track    = modelSpace(Z,   Translation);
const Timeline = modelSpace(R,   Translation);

face.model = Plane;
```

Where `R2`, `H2`, `Z2`, `Z`, `R` are values describing the model's point/vector/predicate operations, and `Similarity`, `Mobius`, `Translation` are values describing the transformation group. `modelSpace(X, G)` is the constructor that ties them together and refuses ill-typed combinations. The construction pattern is the same shape as the (G, X) tuple notation, which is why the file structure (see below) mirrors it.

| `(G, X)` | What it gives you |
|---|---|
| `(R², similarity)` | classic 2D canvas (today) |
| `(R², conformal)` | smooth fish-eye / non-affine zoom without distortion-discontinuity |
| `(H², Möbius)` | hyperbolic plane; bounded-precision recursion |
| `(S², rotation)` | sphere |
| `(Z², translation)` | spreadsheet-like quantised grid (cells addressable as (row, col)) |
| `(R, translation)` | timeline / list dimension |
| `(Z, shift)` | discrete addressable list |

A multi-track timeline is `(Z, translation)` faces (each a track) stitched vertically; a spreadsheet is one `(Z², translation)` face; a hyperbolic tiling is `(H², Möbius)` faces with a discrete stitch group.

Cross-model bindings (e.g., a `(Z², translation)` cell stitched to an `(R², similarity)` patch) need a typed transform between the two model spaces. The substrate refuses ill-typed combinations — that's where the model-space layer earns its keep, and where "operations that don't make sense in one model are simply absent" gives a free correctness guarantee.

The deeper question — meaningfully relating different model spaces in one larger structure — is open. Worth thinking through with concrete examples (a quantised cell next to a continuous patch; a hyperbolic tile inside a Euclidean canvas) before committing to an interface shape.

## File structure

The model-space tuple notation directly informs the layout. Proposed:

```
packages/labs/src/atlas/
  geometry/                    # oriented projective plane primitives
    point.ts
    line.ts
    polygon.ts
    junction.ts
    index.ts
  models/                      # model spaces and transformation groups together
    r2.ts                      # exports R2
    z2.ts                      # exports Z2
    z.ts                       # exports Z
    r.ts                       # exports R
    h2.ts                      # exports H2 (later)
    similarity.ts              # exports Similarity
    translation.ts             # exports Translation
    mobius.ts                  # exports Mobius (later)
    index.ts                   # the modelSpace(X, G) constructor
  face.ts                      # Face + Loop, createFace/splitFace/mergeFaces/deleteFace
  edge.ts                      # Edge, splitEdge/joinEdges
  stitch.ts                    # Stitch, stitch/unstitch
  link.ts                      # Link, link/unlink
  intrinsic.ts                 # Point, Vector, exponential map
  walks.ts                     # BFS / image enumeration / traversal predicates
  index.ts
```

Element files stay at `packages/labs/src/` (`folk-atlas.ts`, `folk-atlas-region.ts`, etc.) and import from `atlas/`. The substrate doesn't know about elements; elements compose schemes from substrate operations.

Notes:

- **No `mesh/` folder.** `Face`, `Edge`, `Loop`, `Stitch`, `Link` are the atlas; they live at the root.
- **No `surgery/` folder.** Each structural primitive lives in the file of the type it produces (`stitch.ts` exports `Stitch` plus `stitch`/`unstitch`).
- **`models/` holds both X and G.** The `modelSpace(X, G)` constructor is the folder's `index.ts`. Adding a new model space is one or two files in `models/`; combinatorial code stays untouched.
- **`walks.ts` not `render.ts`.** BFS / image enumeration is general traversal; rendering proper lives in element files at the surface layer.

## Topology demos as forcing functions

Each of these should be a one-paragraph configuration when the substrate is right. They probe specific structural commitments:

| Demo | What it probes |
|---|---|
| Hexagonal torus from one hexagon (three opposite-edge stitches) | convex-polygon faces, edge-pair stitching, BFS rendering of the universal cover |
| Klein bottle from a square (one stitch with a reflection in its transform) | reflections in the transform group; non-orientable stitches |
| `RP²` from a hexagon (all three pairs antipodally stitched) | the limit case for one-face quotients |
| Triangle tiling of the plane | rotational symmetry at vertices; angle defects at junctions |
| Hyperbolic {7,3} tiling | model-space pluggability; Möbius transforms |
| Cone with non-`2π` apex angle | orbifold cone points; junction holonomy |
| Half-plane with finite boundary edges | free edges; "fall off the world" walks |
| Square with a fold-crease | a third edge category: chart-internal singular set |
| Recursive zoom (single self-link) | links as a primitive; BFS image enumeration with depth cap |
| Hypertext ZUI (link multigraph) | many-parents-one-child links; return-path policy |
| Recessed region inside a torus inside a hexagonal tiling | composition of three schemes |
| Scissor-cut + gusset + ungusset + uncut, returning to start | invertibility of paired primitives |
| Two unrelated faces edited "in parallel" | commutativity of disjoint mutations |
| Movable cut: drag a committed cut to a new position | inverse-pair composition (uncut + recut) |
| Face whose outer stitch has scale = 2 (TARDIS) | discrete-at-boundary scale; "bigger on the inside" |
| Face with `(R², conformal)` model space | smooth within-face geometric variation |

Mostly thought-experiments to validate structural choices, not all things to build immediately.

## Vocabulary

Public:

- **`Atlas`** — accurate as a base concept, honest as a folder name. With links added on top, it's "atlas plus links."
- **`Face`** — convex k-gon with one or more loops, a frame, and a model space.
- **`Edge`** — boundary segment; the unit of subdivision.
- **`Loop`** — a face's outer or inner boundary cycle.
- **`Stitch`** — reciprocal binding between two edges. Verbs: `stitch`/`unstitch`.
- **`Link`** — directed binding from a parent face to a child face. Verbs: `link`/`unlink`.

Internal:

- **`Junction`** — point in the oriented projective plane; not part of the API.

Other terms encountered in the surrounding code (`Hole`, `HalfEdge`, `Region`, `Identification`) are not part of this substrate.

The `thinking.md` fabric metaphor (patches, seams, pleats, hems) remains good user-facing language. Internal vocabulary stays technical and rigorous; user-facing vocabulary can be metaphor-driven; they don't have to match.

## What we're not committing to yet

- Whether `<folk-atlas>` should be renamed at the element level (e.g., `<folk-space>`). The substrate folder name (`atlas/`) is decided; the element name can change independently.
- Replayability / serialisation. Inverses are non-negotiable; replay is a free side-benefit if we want it later, achievable by a thin journal wrapper.
- Per-face non-affine frames. Affine is the default; the frame interface is structured so richer types can plug in if a scheme demands it.
- The default return-path policy for Links. The substrate exposes the choice; the renderer/scheme picks.
- The specific discipline for multi-valued geodesics in the intrinsic API.
- The exact shape of the cross-model-space transform interface.
- Whether `Loop` is a type or just a field convention on `Face`.

## Refactor ordering (loose, informal)

A working sequence — each step independently shippable, each individually reduces complexity:

1. **Set up `packages/labs/src/atlas/` with the geometry library** extracted from today's `atlas.ts`. Self-contained, with native convex polygon support. Lowest risk; biggest immediate clarity win.
2. **Multi-loop faces with free edges/loops.** A face has a list of loops; edges and loops with no binding are just free. Removes the `twin === null` special case throughout the codebase. Treats "infinite plane," "finite paper," and "open hole" uniformly as the absence of bindings.
3. **Application-level convex polygons.** Sub-area carving, drag, wrap-toggles all stop assuming AABB. Small residual after step 1 supplies the geometric primitives; mostly removing AABB-specific helpers at the call sites.
4. **`Stitch` as the binding primitive.** Reciprocal by construction. The half-edge concept is removed entirely; directional traversal becomes loop-iteration. Existing primitives audited and ported.
5. **`Frame` on `Face` explicitly; collapse the four-wedge seed.** The empty scene becomes a single all-ideal face.
6. **Narrow the structural primitive set; lift composites to named macros.** Every primitive has a paired inverse function. Parametric changes (move/rotate/scale) move to plain setters.
7. **`Link` as a second primitive,** sitting alongside `Stitch`. Faces gain `links: Link[]`. Walks traverse both stitches and links with policy-driven return-direction. First scheme to use it: port the hypertext-zui demo.
8. **Extract the intrinsic API** (`Point`, `Vector`, exponential map) into `intrinsic.ts`. Migrate shape drag, hit-test, and similar in-space code onto it.
9. **Model-space pluggability:** introduce `modelSpace(X, G)` and the `models/` folder, even if everything still uses `(R², Similarity)` to start. Future model spaces drop in as files.
10. **Schemes rebuilt as configurations.** `recessedRegion`, `torus`, `scaleLoop`, `recursiveZoom`, etc. become small named compositions of substrate operations with their UI affordances.

Each step lands in main; the next step builds on it; no big-bang refactor.
