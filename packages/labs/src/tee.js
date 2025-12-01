// (HYPER)TEXT T20 
// — Orion Reed

__loopBudget = 30000 // it shouldnt need this

const t = params.t                      // time: 0→1 looping
const q = params.q                      // waffle H: split variation
const r = params.r                      // waffle V: thickness

// Reset random state when time loops back to 0
if (t < (params.s.lastT || 0)) {
  params.s.barRotRand = (random() - 0.5) * 2   // -1 to 1
  params.s.stemRotRand = (random() - 0.5) * 2
  params.s.barOffsetX = (random() - 0.5) * 0.3
  params.s.stemOffsetY = (random() - 0.5) * 0.4
}
params.s.lastT = t

// Get random values (stable within loop)
const barRotRand = params.s.barRotRand || 0
const stemRotRand = params.s.stemRotRand || 0
const barOffsetX = params.s.barOffsetX || 0
const stemOffsetY = params.s.stemOffsetY || 0

// === HELPERS ===
const ease = x => x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2
const easeOut = x => 1 - pow(1 - x, 2)  // starts fast, slows down
function mix(a, b, t) { return a + (b - a) * t }

// Keyframe interpolation helper
function keyframe(phase, points, easeFn = ease) {
  const keys = Object.keys(points).map(Number).sort((a, b) => a - b)
  
  // Before first key
  if (phase <= keys[0]) return points[keys[0]]
  
  // After last key
  if (phase >= keys[keys.length - 1]) return points[keys[keys.length - 1]]
  
  // Find surrounding keys and interpolate
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i]
    const k1 = keys[i + 1]
    if (phase >= k0 && phase <= k1) {
      const t = (phase - k0) / (k1 - k0)
      return mix(points[k0], points[k1], easeFn(t))
    }
  }
  
  return points[keys[keys.length - 1]]
}

// Create a box at a LOCAL offset, rotate around ORIGIN, then translate to refPos
function boxRelative(refPos, refRot, localOffset, size) {
  const localBox = box(localOffset, size)
  const rotated = rotate(localBox, refRot, false)
  return translate(rotated, refPos)
}

// === ANIMATION ===
// Everything is symmetric, with t=0 and t=1 at collapsed state (phase=0)
// and t=0.5 at exploded state (phase=10)

// Phase constants (timeline milestones)
const COLLAPSED = 0
const PAUSE_END = 0.5
const EXPAND_Y_END = 3
const EXPAND_Z_END = 5
const EXPLODE_START = 6
const SPLIT_START = 8
const MAX_PHASE = 10

// Triangle wave: 0→10→0 as t goes 0→0.5→1
const phase = t < 0.5 ? t * 20 : (1 - t) * 20

// === CAMERA ===
// x=0, y=0 shows a normal front-facing T; drag to rotate
const baseRotY = -params.x * PI * 0.5
const baseRotX = params.y * PI * 0.4

// Auto-rotate when depth expands to showcase it
const autoRot = keyframe(phase, {
  [COLLAPSED]: 0,
  [EXPAND_Y_END]: 0,
  [EXPAND_Z_END]: 0.3,  // more rotation
  [MAX_PHASE]: 0.35
})

const spin = baseRotY + autoRot
const elev = baseRotX + autoRot
const zoom = 0.7

// === ANIMATION CONTINUED ===

// Assembly: how close pieces are (1=together, 0=scattered)
const assembly = keyframe(phase, {
  [COLLAPSED]: 1,
  [EXPLODE_START]: 1,
  [MAX_PHASE]: 0
})

// Scale animations
const scaleX = 1
const scaleY = keyframe(phase, {
  [COLLAPSED]: 0.001,
  [PAUSE_END]: 0.001,
  [EXPAND_Y_END]: 1,
  [MAX_PHASE]: 1
})
const scaleZ = keyframe(phase, {
  [COLLAPSED]: 0.05,
  [PAUSE_END]: 0.05,
  [EXPAND_Y_END]: 0.05,
  [EXPAND_Z_END]: 1,
  [MAX_PHASE]: 1
})

// Split happens late in explosion (ease-out: starts fast, slows down)
const splitAmount = keyframe(phase, {
  [SPLIT_START]: 0,
  [MAX_PHASE]: 0.5
}, easeOut)
const showSplit = phase > SPLIT_START

// === WAFFLE EFFECTS ===
const depth = denorm(r, 0.2, 0.4)
const splitVariation = denorm(q, 0, 1)  // q controls split gap and rotation

// === T GEOMETRY ===
const barW = 1.3, barH = 0.26
const stemW = 0.26, stemH = 1.2
const halfBarW = barW / 2

// Junction point
const junctionY = -0.4
const barHomeY = junctionY - barH / 2
const stemHomeY = junctionY + stemH / 2

// Scattered positions & rotations
const barScatter = { x: 0, y: -0.5, z: 0.6 }
const barScatterRot = { x: 3, y: 0.5, z: 0.2 }
const stemScatter = { x: 0, y: 0.5, z: -0.5 }
const stemScatterRot = { x: -0.7, y: -3.7, z: 0.3 }

// Bar position & rotation (with random variation when exploded)
const explosionFade = phase > EXPLODE_START ? (phase - EXPLODE_START) / (MAX_PHASE - EXPLODE_START) : 0
const barPos = {
  x: mix(barScatter.x, 0, assembly) * scaleX + barOffsetX * explosionFade,
  y: mix(barScatter.y + barHomeY, barHomeY, assembly) * scaleY,
  z: mix(barScatter.z, 0, assembly) * scaleZ
}
const barRot = {
  x: mix(barScatterRot.x, 0, assembly) + barRotRand * 0.6 * explosionFade,
  y: mix(barScatterRot.y, 0, assembly) + barRotRand * 0.5 * explosionFade,
  z: mix(barScatterRot.z, 0, assembly)
}

// Split-specific rotations (unique for each half)
const leftSplitRot = {
  x: 1.9 * splitAmount,
  y: -0.2 * splitAmount,
  z: 0.15 * splitAmount
}
const rightSplitRot = {
  x: 2.25 * splitAmount,
  y: -1.45 * splitAmount,
  z: -0.6 * splitAmount
}

// Stem position & rotation (with random variation when exploded)
const stemPos = {
  x: mix(stemScatter.x, 0, assembly) * scaleX,
  y: mix(stemScatter.y + stemHomeY, stemHomeY, assembly) * scaleY + stemOffsetY * explosionFade,
  z: mix(stemScatter.z, 0, assembly) * scaleZ
}
const stemRot = {
  x: mix(stemScatterRot.x, 0, assembly) + stemRotRand * 0.5 * explosionFade,
  y: mix(stemScatterRot.y, 0, assembly) + stemRotRand * 0.6 * explosionFade,
  z: mix(stemScatterRot.z, 0, assembly)
}

// Size with scale applied
const barSize = { x: barW * scaleX, y: barH * scaleY, z: depth * scaleZ }
const stemSize = { x: stemW * scaleX, y: stemH * scaleY, z: depth * scaleZ }

// === BUILD SHAPES ===
const shapes = []

// TOP BAR
if (showSplit) {
  // Waffle q controls split gap and twist
  const splitGap = splitAmount * 0.3 * (1 + splitVariation * 0.5)
  
  // Unique rotations for each half
  const leftRot = { 
    x: barRot.x + leftSplitRot.x, 
    y: barRot.y + leftSplitRot.y, 
    z: barRot.z + leftSplitRot.z 
  }
  shapes.push(boxRelative(
    barPos, leftRot,
    { x: (-halfBarW / 2 - splitGap) * scaleX, y: 0, z: 0 },
    { x: halfBarW * scaleX, y: barH * scaleY, z: depth * scaleZ }
  ))
  
  const rightRot = { 
    x: barRot.x + rightSplitRot.x, 
    y: barRot.y + rightSplitRot.y, 
    z: barRot.z + rightSplitRot.z 
  }
  shapes.push(boxRelative(
    barPos, rightRot,
    { x: (halfBarW / 2 + splitGap) * scaleX, y: 0, z: 0 },
    { x: halfBarW * scaleX, y: barH * scaleY, z: depth * scaleZ }
  ))
} else {
  shapes.push(rotate(box(barPos, barSize), barRot))
}

// STEM
shapes.push(rotate(box(stemPos, stemSize), stemRot))

// === GEOMETRIC CONSTRUCTION: GUIDE BOX WITH CORNER MARKERS ===
if (assembly > 0.7) {
  const fade = (assembly - 0.7) * 3.33
  
  // Fade out when very close to collapsed
  const collapseFade = phase < 0.5 ? 0 : 1
  const vis = fade * collapseFade
  
  // Guide box: taller and grows when scattered
  const guideMargin = 0.6 + (1 - assembly) * 0.35
  const guideW = (barW + guideMargin) * scaleX
  const guideH = ((barHomeY - barH / 2 + (stemHomeY + stemH / 2)) + guideMargin * 3.3) * scaleY  // taller
  const guideD = (depth + guideMargin) * scaleZ
  
  const guideCenterY = ((barHomeY - barH / 2 + stemHomeY + stemH / 2) / 2) * scaleY
  
  // 8 corners
  const hw = guideW / 2, hh = guideH / 2, hd = guideD / 2
  const corners = [
    { x: -hw, y: guideCenterY - hh, z: -hd },
    { x:  hw, y: guideCenterY - hh, z: -hd },
    { x: -hw, y: guideCenterY + hh, z: -hd },
    { x:  hw, y: guideCenterY + hh, z: -hd },
    { x: -hw, y: guideCenterY - hh, z:  hd },
    { x:  hw, y: guideCenterY - hh, z:  hd },
    { x: -hw, y: guideCenterY + hh, z:  hd },
    { x:  hw, y: guideCenterY + hh, z:  hd },
  ]
  
  const markerSize = 0.04 * vis * scaleY //min(scaleY, scaleZ)
  for (const corner of corners) {
    shapes.push(cube(corner, markerSize))
  }
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
