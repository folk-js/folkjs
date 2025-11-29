// CONVEX C22
// - Orion Reed

__loopBudget = 80000

function period(cycles, key = "_cyclePeriod") {
  if (!params.s[key]) {
    params.s[key] = { lastT: params.t, counter: 0 }
  }

  const state = params.s[key]
    
  // Detect if t has looped (went from high to low)
  if (params.t < state.lastT) {
    state.counter++
  }
  
  state.lastT = params.t
  
  // Calculate position within the extended period
  const totalProgress = (state.counter % cycles) + params.t
  return totalProgress / cycles
}

const mix = (a, b, t) => a + (b - a) * t
const polar = (angle, radius) => ({ x: cos(angle) * radius, y: sin(angle) * radius })
const cnorm = (value, start, end) => max(0, min(1, (value - start) / (end - start)))

const longPeriod = period(3)
const swivelWindow = cnorm(longPeriod, 0, 0.3)
const swivelPulse = sin(swivelWindow * PI)
const swivelSmooth = swivelPulse * swivelPulse * (3 - 2 * swivelPulse)

const spin = -params.x * PI * 0.5 + swivelSmooth * TAU
const elev = params.y * PI * 0.4 + swivelSmooth * -0.3
const zoom = 1.5

const mouthAngle = 1.5

// User controls
const numSegments = floor(mix(4, 18, (params.q + 1) / 2))
const innerRadius = mix(0.1, 0.5, (params.r + 1) / 2)

// === C GEOMETRY ===
const shapes = []

const outerRadius = 0.6
const depth = 0.25

// Generate trapezoid segments around the C
const startAngle = mouthAngle / 2
const endAngle = TAU - mouthAngle / 2

for (let i = 0; i < numSegments; i++) {
  const angleSpan = endAngle - startAngle
  const segmentAngleStart = startAngle + (i / numSegments) * angleSpan
  const segmentAngleEnd = startAngle + ((i + 1) / numSegments) * angleSpan
  
  // Calculate the 4 corners of each trapezoid in 2D
  const outer1 = polar(segmentAngleStart, outerRadius)
  const outer2 = polar(segmentAngleEnd, outerRadius)
  const inner1 = polar(segmentAngleStart, innerRadius)
  const inner2 = polar(segmentAngleEnd, innerRadius)
  
  // Create a 2D trapezoid polygon (CCW winding when viewed from +Z)
  const trapezoid = [inner1, inner2, outer2, outer1]
  
  // Ripple effect - two frequencies that perfectly loop
  const segmentPhase = i / numSegments
  const ripple1 = sin((params.t * 2 + segmentPhase) * TAU) // 2x frequency
  const ripple2 = sin((params.t * 3 + segmentPhase) * TAU) // 3x frequency
  
  // Combine ripples for scale (0.7 to 1.3 range)
  const scaleAmount = 0.5 - ripple1 * 0.2// + ripple2 * 0.1
  
  // Combine ripples for rotation (±0.3 radians)
  const rotAmount = ripple2 * 0.2
  
  // Extrude the trapezoid to make a 3D segment
  shapes.push(
    rotate(
      scale(
        extrude(trapezoid, 0.3, { x: 0, y: 0, z: 0 }),
        scaleAmount
      ),
      { x: rotAmount, y: -rotAmount, z: rotAmount }
    )
  )
}

render(shapes)







// === GEOMETRY MICRO-LIB (this was FUN!!!) ===

// Algorithms used:
// - Cyrus-Beck line clipping (1978): https://en.wikipedia.org/wiki/Cyrus%E2%80%93Beck_algorithm
// - Roberts hidden line removal for convex polyhedra (1963): https://en.wikipedia.org/wiki/Hidden-line_removal
// - Back-face culling: https://en.wikipedia.org/wiki/Back-face_culling

// Constraints: Non-intersecting convex polyhedra only, sorry :)
// All geometry functions return { verts: [{x,y,z}...], faces: [[indices...]...] }
// Faces use CCW winding when viewed from outside

// --- Transform functions ---

// Rotate a point around origin by Euler angles (radians, applied as Y → X → Z)
function rotatePoint(p, rot) {
  let { x, y, z } = p
  // Y-axis rotation (yaw)
  if (rot.y) {
    const c = cos(rot.y), sn = sin(rot.y)
    const x1 = x * c + z * sn, z1 = -x * sn + z * c
    x = x1; z = z1
  }
  // X-axis rotation (pitch)
  if (rot.x) {
    const c = cos(rot.x), sn = sin(rot.x)
    const y1 = y * c - z * sn, z1 = y * sn + z * c
    y = y1; z = z1
  }
  // Z-axis rotation (roll)
  if (rot.z) {
    const c = cos(rot.z), sn = sin(rot.z)
    const x1 = x * c - y * sn, y1 = x * sn + y * c
    x = x1; y = y1
  }
  return { x, y, z }
}

// Translate a shape by offset
function translate(shape, offset) {
  return {
    verts: shape.verts.map(v => ({
      x: v.x + offset.x,
      y: v.y + offset.y,
      z: v.z + offset.z,
    })),
    faces: shape.faces,
  }
}

// Rotate a shape around its centroid (or origin if centroid=false)
function rotate(shape, rot, aroundCentroid = true) {
  let cx = 0, cy = 0, cz = 0
  if (aroundCentroid) {
    for (const v of shape.verts) { cx += v.x; cy += v.y; cz += v.z }
    cx /= shape.verts.length; cy /= shape.verts.length; cz /= shape.verts.length
  }
  return {
    verts: shape.verts.map(v => {
      const local = { x: v.x - cx, y: v.y - cy, z: v.z - cz }
      const rotated = rotatePoint(local, rot)
      return { x: rotated.x + cx, y: rotated.y + cy, z: rotated.z + cz }
    }),
    faces: shape.faces,
  }
}

// Scale a shape around its centroid (or origin if centroid=false)
function scale(shape, s, aroundCentroid = true) {
  const sx = typeof s === 'number' ? s : s.x
  const sy = typeof s === 'number' ? s : s.y
  const sz = typeof s === 'number' ? s : s.z
  let cx = 0, cy = 0, cz = 0
  if (aroundCentroid) {
    for (const v of shape.verts) { cx += v.x; cy += v.y; cz += v.z }
    cx /= shape.verts.length; cy /= shape.verts.length; cz /= shape.verts.length
  }
  return {
    verts: shape.verts.map(v => ({
      x: cx + (v.x - cx) * sx,
      y: cy + (v.y - cy) * sy,
      z: cz + (v.z - cz) * sz,
    })),
    faces: shape.faces,
  }
}

// --- 2D Polygon Utilities ---

// Calculate signed area of 2D polygon (positive = CCW, negative = CW)
function signedArea2D(polygon) {
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i].x * polygon[j].y
    area -= polygon[j].x * polygon[i].y
  }
  return area / 2
}

// Check if 2D polygon has CCW winding
function isCCW(polygon) {
  return signedArea2D(polygon) > 0
}

// --- Extrusion ---

// Extrude a 2D convex polygon (CCW winding) along Z axis
// polygon: [{x, y}, ...] in CCW order
// depth: total depth of extrusion
// pos: center position of resulting shape
function extrude(polygon, depth = 1, pos = { x: 0, y: 0, z: 0 }) {
  const n = polygon.length
  const halfZ = depth / 2
  const verts = []

  // Back face vertices (z = -halfZ)
  for (const p of polygon) {
    verts.push({ x: pos.x + p.x, y: pos.y + p.y, z: pos.z - halfZ })
  }
  // Front face vertices (z = +halfZ)
  for (const p of polygon) {
    verts.push({ x: pos.x + p.x, y: pos.y + p.y, z: pos.z + halfZ })
  }

  const faces = []

  // Front face (indices n to 2n-1, CCW when viewed from +Z)
  const front = []
  for (let i = 0; i < n; i++) front.push(n + i)
  faces.push(front)

  // Back face (indices 0 to n-1, reversed for CCW when viewed from -Z)
  const back = []
  for (let i = n - 1; i >= 0; i--) back.push(i)
  faces.push(back)

  // Side quads
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // Back[i] → Back[j] → Front[j] → Front[i] (CCW from outside)
    faces.push([i, j, n + j, n + i])
  }

  return { verts, faces }
}

// --- Primitives ---

function box(pos = { x: 0, y: 0, z: 0 }, size = { x: 1, y: 1, z: 1 }) {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2
  const verts = [
    // 0: back-bottom-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z - hz }, 
    // 1: back-bottom-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z - hz }, 
    // 2: back-top-right
    { x: pos.x + hx, y: pos.y + hy, z: pos.z - hz }, 
    // 3: back-top-left
    { x: pos.x - hx, y: pos.y + hy, z: pos.z - hz }, 
    // 4: front-bottom-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z + hz },
    // 5: front-bottom-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z + hz },
    // 6: front-top-right
    { x: pos.x + hx, y: pos.y + hy, z: pos.z + hz },
    // 7: front-top-left
    { x: pos.x - hx, y: pos.y + hy, z: pos.z + hz }, 
  ]
  const faces = [
    [7, 6, 5, 4], // front  (+Z)
    [0, 1, 2, 3], // back   (-Z)
    [3, 2, 6, 7], // top    (+Y)
    [4, 5, 1, 0], // bottom (-Y)
    [4, 0, 3, 7], // left   (-X)
    [5, 6, 2, 1], // right  (+X)
  ]
  return { verts, faces }
}

function cube(pos = { x: 0, y: 0, z: 0 }, size = 1) {
  return box(pos, { x: size, y: size, z: size })
}

// Tetrahedron (4 triangular faces)
function tetra(pos = { x: 0, y: 0, z: 0 }, size = 1) {
  const s = size / 2
  // Regular tetrahedron vertices
  const verts = [
    { x: pos.x + s,  y: pos.y - s * 0.577, z: pos.z - s * 0.577 },
    { x: pos.x - s,  y: pos.y - s * 0.577, z: pos.z - s * 0.577 },
    { x: pos.x,      y: pos.y + s * 0.816, z: pos.z - s * 0.577 },
    { x: pos.x,      y: pos.y,             z: pos.z + s * 1.155 },
  ]
  const faces = [
    [2, 1, 0], // back
    [1, 3, 0], // bottom-left
    [2, 3, 1], // bottom-right
    [0, 3, 2], // front
  ]
  return { verts, faces }
}

// Octahedron (8 triangular faces)
function octa(pos = { x: 0, y: 0, z: 0 }, size = 1) {
  const s = size / 2
  const verts = [
    { x: pos.x + s, y: pos.y,     z: pos.z     }, // 0: +X
    { x: pos.x - s, y: pos.y,     z: pos.z     }, // 1: -X
    { x: pos.x,     y: pos.y + s, z: pos.z     }, // 2: +Y
    { x: pos.x,     y: pos.y - s, z: pos.z     }, // 3: -Y
    { x: pos.x,     y: pos.y,     z: pos.z + s }, // 4: +Z
    { x: pos.x,     y: pos.y,     z: pos.z - s }, // 5: -Z
  ]
  const faces = [
    [4, 2, 0], [1, 2, 4], [5, 2, 1], [0, 2, 5], // top 4
    [3, 4, 0], [3, 1, 4], [3, 5, 1], [3, 0, 5], // bottom 4
  ]
  return { verts, faces }
}

// Wedge / Triangular prism (2 triangular + 3 rectangular faces)
function wedge(pos = { x: 0, y: 0, z: 0 }, size = { x: 1, y: 1, z: 1 }) {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2
  const verts = [
    // 0: back-bottom-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z - hz }, 
    // 1: back-bottom-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z - hz }, 
    // 2: back-top-center
    { x: pos.x,      y: pos.y + hy, z: pos.z - hz }, 
    // 3: front-bottom-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z + hz }, 
    // 4: front-bottom-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z + hz }, 
    // 5: front-top-center
    { x: pos.x,      y: pos.y + hy, z: pos.z + hz }, 
  ]
  const faces = [
    [0, 1, 2],       // back triangle
    [5, 4, 3],       // front triangle
    [3, 4, 1, 0],    // bottom quad
    [0, 2, 5, 3],    // left quad
    [1, 4, 5, 2],    // right quad
  ]
  return { verts, faces }
}

// Pyramid (square base, 4 triangular sides)
function pyramid(pos = { x: 0, y: 0, z: 0 }, size = { x: 1, y: 1, z: 1 }) {
  const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2
  const verts = [
    // 0: base back-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z - hz }, 
    // 1: base back-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z - hz }, 
    // 2: base front-right
    { x: pos.x + hx, y: pos.y - hy, z: pos.z + hz }, 
    // 3: base front-left
    { x: pos.x - hx, y: pos.y - hy, z: pos.z + hz }, 
    // 4: apex
    { x: pos.x,      y: pos.y + hy, z: pos.z      }, 
  ]
  const faces = [
    [3, 2, 1, 0], // base (bottom)
    [1, 4, 0],    // back
    [2, 4, 1],    // right
    [3, 4, 2],    // front
    [0, 4, 3],    // left
  ]
  return { verts, faces }
}

// === MATH UTILITIES ===

function toView(p, spin, elev, zoom) {
  let x = p.x * zoom, y = p.y * zoom, z = p.z * zoom
  // Spin around Y
  const cs = cos(spin), ss = sin(spin)
  const x1 = x * cs + z * ss, z1 = -x * ss + z * cs
  // Elevate around X
  const ce = cos(elev), se = sin(elev)
  return { x: x1, y: y * ce - z1 * se, z: y * se + z1 * ce }
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z }

function normalize(v) {
  const len = hypot(v.x, v.y, v.z)
  return len < 1e-10 ? { x: 0, y: 0, z: 0 } : { x: v.x / len, y: v.y / len, z: v.z / len }
}

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }

// === CYRUS-BECK LINE CLIPPING ===
// Clips line segment (x0,y0)→(x1,y1) against convex polygon (CCW winding)
// Returns [tEnter, tLeave] or null if fully outside

function cyrusBeckClip(x0, y0, x1, y1, polygon) {
  const dx = x1 - x0, dy = y1 - y0
  let tEnter = 0, tLeave = 1
  const n = polygon.length

  for (let i = 0; i < n; i++) {
    const p0 = polygon[i], p1 = polygon[(i + 1) % n]
    // Outward normal for CCW polygon: rotate edge 90° clockwise
    const nx = p1.y - p0.y, ny = -(p1.x - p0.x)
    const denom = -(nx * dx + ny * dy)
    const numer = nx * (x0 - p0.x) + ny * (y0 - p0.y)

    if (abs(denom) < 1e-10) {
      if (numer > 1e-10) return null // Parallel and outside
    } else {
      const t = numer / denom
      if (denom > 0) { if (t > tEnter) tEnter = t } // Entering
      else { if (t < tLeave) tLeave = t }           // Leaving
      if (tEnter > tLeave) return null
    }
  }
  return [tEnter, tLeave]
}

// === PLANE DEPTH COMPUTATION ===
// Returns z-depth at screen point (x,y) on plane defined by 3 vertices

function planeZAt(x, y, v0, v1, v2) {
  const n = cross(sub(v1, v0), sub(v2, v0))
  if (abs(n.z) < 1e-10) return null // Edge-on face
  // Plane equation: n·(P - v0) = 0 → solve for z
  return v0.z - (n.x * (x - v0.x) + n.y * (y - v0.y)) / n.z
}

// === MAIN HIDDEN LINE REMOVAL ===

function computeVisible(objects, spin, elev, zoom) {
  const viewDir = { x: 0, y: 0, z: -1 }

  // Transform all objects to view space and compute face data
  const allFaces = []
  const viewObjects = objects.map((obj, objIdx) => {
    const viewVerts = obj.verts.map(v => toView(v, spin, elev, zoom))
    obj.faces.forEach(indices => {
      const v0 = viewVerts[indices[0]], v1 = viewVerts[indices[1]], v2 = viewVerts[indices[2]]
      const normal = normalize(cross(sub(v1, v0), sub(v2, v0)))
      const isFront = dot(normal, viewDir) < 0
      allFaces.push({
        objIdx,
        indices,
        verts3D: indices.map(i => viewVerts[i]),
        poly2D: indices.map(i => ({ x: viewVerts[i].x, y: viewVerts[i].y })),
        isFront,
      })
    })
    return { verts: viewVerts, faces: obj.faces }
  })

  // Build edge map with face adjacency
  const edgeMap = new Map()
  allFaces.forEach((face, faceIdx) => {
    const n = face.indices.length
    for (let k = 0; k < n; k++) {
      const i0 = face.indices[k], i1 = face.indices[(k + 1) % n]
      const key = `${face.objIdx},${min(i0, i1)},${max(i0, i1)}`
      if (!edgeMap.has(key)) edgeMap.set(key, { objIdx: face.objIdx, i0, i1, faceIndices: [] })
      edgeMap.get(key).faceIndices.push(faceIdx)
    }
  })

  // Collect candidate edges: those with at least one front-facing adjacent face
  const candidateEdges = []
  for (const e of edgeMap.values()) {
    if (e.faceIndices.some(fi => allFaces[fi].isFront)) {
      const obj = viewObjects[e.objIdx]
      candidateEdges.push({ objIdx: e.objIdx, p0: obj.verts[e.i0], p1: obj.verts[e.i1] })
    }
  }

  // Front-facing faces for occlusion testing
  const frontFaces = allFaces.filter(f => f.isFront)

  // Clip each candidate edge against front faces of OTHER objects
  const visibleSegments = []

  for (const edge of candidateEdges) {
    const { x: x0, y: y0, z: z0 } = edge.p0
    const { x: x1, y: y1, z: z1 } = edge.p1
    let segments = [{ t0: 0, t1: 1 }]

    for (const face of frontFaces) {
      // Skip self-occlusion (handled by face culling)
      if (face.objIdx === edge.objIdx) continue 

      const newSegments = []
      for (const seg of segments) {
        // Segment endpoints in this sub-segment
        const sx0 = x0 + seg.t0 * (x1 - x0), sy0 = y0 + seg.t0 * (y1 - y0), sz0 = z0 + seg.t0 * (z1 - z0)
        const sx1 = x0 + seg.t1 * (x1 - x0), sy1 = y0 + seg.t1 * (y1 - y0), sz1 = z0 + seg.t1 * (z1 - z0)

        // Clip against face's 2D projection
        const clip = cyrusBeckClip(sx0, sy0, sx1, sy1, face.poly2D)
        if (!clip) { newSegments.push(seg); continue } // No overlap

        const [tEnter, tLeave] = clip

        // Check depth at middle of clipped region
        const tMid = (tEnter + tLeave) / 2
        const mx = sx0 + tMid * (sx1 - sx0), my = sy0 + tMid * (sy1 - sy0), mz = sz0 + tMid * (sz1 - sz0)
        const faceZ = planeZAt(mx, my, face.verts3D[0], face.verts3D[1], face.verts3D[2])

        if (faceZ === null || mz <= faceZ + 1e-6) {
          // Segment in front of face, keep it
          newSegments.push(seg)
          continue
        }

        // Segment is behind face — split around occluded region
        const gEnter = seg.t0 + tEnter * (seg.t1 - seg.t0)
        const gLeave = seg.t0 + tLeave * (seg.t1 - seg.t0)
        if (gEnter > seg.t0 + 1e-6) newSegments.push({ t0: seg.t0, t1: gEnter })
        if (gLeave < seg.t1 - 1e-6) newSegments.push({ t0: gLeave, t1: seg.t1 })
      }
      segments = newSegments
      if (segments.length === 0) break
    }

    // Output visible portions
    for (const seg of segments) {
      visibleSegments.push({
        x0: x0 + seg.t0 * (x1 - x0), y0: y0 + seg.t0 * (y1 - y0),
        x1: x0 + seg.t1 * (x1 - x0), y1: y0 + seg.t1 * (y1 - y0),
      })
    }
  }

  return visibleSegments
}


function render(shapes) {
  const segments = computeVisible(shapes, spin, elev, zoom)
  begin()
  for (const s of segments) {
    move(s.x0, s.y0)
    line(s.x1, s.y1)
  }
}
