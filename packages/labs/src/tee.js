// i line
// — Orion Reed
const t = params.t  // time: 0→1 looping

// === TWEAKABLES ===
const numSegments = 5         // number of stem segments (not counting dot)
const dotSeparation = 0.3    // how far dot floats above
const segmentSpread = 0.1    // base spread per segment when split
const rotationStrength = 1.2  // how much segments tumble
const bounceHeight = 0.35     // how high the bounce goes
const bounceDecay = 2.5       // how quickly bounce dampens
const alignStagger = 0.02     // time offset between each segment aligning (cascade effect)

// === TIMELINE ===
// 0.00 → 0.12: solid line rotating
// 0.12 → 0.20: dot pops off top
// 0.20 → 0.42: segments cascade off bottom (with rotation!)
// 0.42 → 0.50: BEAT - everything holds, fully exploded
// 0.50 → 0.68: segments rotate back into alignment (staggered, bottom first)
// 0.68 → 0.85: everything slams back together
// 0.85 → 1.00: elastic bounce from impact

const T_DOT_START = 0.12
const T_DOT_END = 0.20
const T_SEG_START = 0.20
const T_SEG_END = 0.42
const T_BEAT_END = 0.50      // hold/pause before alignment
const T_ALIGN_START = 0.50
const T_ALIGN_END = 0.68
const T_RETURN_START = 0.68
const T_RETURN_END = 0.85
const T_BOUNCE_START = 0.85
const T_BOUNCE_END = 1.0

// === HELPERS ===
const easeOut = x => 1 - pow(1 - x, 3)
const easeIn = x => x * x * x * x * x  // quintic - much faster acceleration!
const easeInOut = x => x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
function mix(a, b, t) { return a + (b - a) * t }
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x }
function remap(x, a, b) { return clamp((x - a) / (b - a), 0, 1) }

// Elastic bounce: quick up, settles back down
function elasticBounce(x) {
  // Damped sine wave that starts at peak and settles to 0
  return sin(x * PI) * exp(-x * bounceDecay)
}

// Reset random state when time loops back to 0
if (t < (params.s.lastT || 0)) {
  params.s.segments = []
  for (let i = 0; i < numSegments; i++) {
    params.s.segments.push({
      rot: vec3((random() - 0.5) * 2, (random() - 0.5) * 2, (random() - 0.5) * 2)
    })
  }
}
params.s.lastT = t

const segmentData = params.s.segments || []

// === CAMERA ===
const spin = t * PI * 2 + 0.4  // continuous rotation (perfect loop!)
const elev = 0.45
const zoom = 0.85

// === GEOMETRY ===
const segW = 0.28
const segD = 0.28
const totalH = 1.4  // total height of the full line (including dot segment)
const segH = totalH / (numSegments + 1)  // +1 for dot segment

// === ANIMATION STATE ===

// Dot separation phase
const dotPhase = easeOut(remap(t, T_DOT_START, T_DOT_END))

// Segment cascade phase (each segment has staggered timing)
const segCascadeDuration = T_SEG_END - T_SEG_START
const segStagger = segCascadeDuration / (numSegments + 1)

// Alignment phase - segments rotate back into alignment with stagger (bottom first)
const alignPhase = remap(t, T_ALIGN_START, T_ALIGN_END)

// Return phase (everything slams back - accelerates like gravity)
const returnPhase = easeIn(remap(t, T_RETURN_START, T_RETURN_END))

// Bounce phase (elastic rebound after impact)
const bouncePhase = remap(t, T_BOUNCE_START, T_BOUNCE_END)
const bounceOffset = bouncePhase > 0 ? elasticBounce(bouncePhase) * bounceHeight : 0

// Helper: get rotation alignment for a segment (staggered, bottom first)
// Returns 0 during explosion, then 0→1 as segment aligns
function getRotationAlign(segIndex) {
  // Before alignment phase starts, rotation is full (return 0)
  if (alignPhase <= 0) return 0
  
  // Bottom segments (high index) align first
  const alignOrder = numSegments - 1 - segIndex
  const totalStaggerTime = (numSegments - 1) * alignStagger
  const alignDuration = max(0.05, 1 - totalStaggerTime)  // ensure positive duration
  const segStartNorm = alignOrder * alignStagger  // when this segment starts (0-1 in align phase)
  
  const localProgress = clamp((alignPhase - segStartNorm) / alignDuration, 0, 1)
  return easeInOut(localProgress)
}

// === BUILD SHAPES ===
const shapes = []

// Determine which pieces have split off
// A piece is "split" when its raw splitProgress > 0 (before return phase)

// Dot split state
const dotRawSplit = remap(t, T_DOT_START, T_DOT_END)
const dotHasSplit = dotRawSplit > 0.001

// Segment split states (from bottom up)
const segmentHasSplit = []
for (let i = 0; i < numSegments; i++) {
  const splitOrder = numSegments - 1 - i  // bottom splits first
  const segStart = T_SEG_START + splitOrder * segStagger
  const rawSplit = remap(t, segStart, T_SEG_END)
  segmentHasSplit[i] = rawSplit > 0.001
}

// Find the first unsplit segment (from top, i.e. lowest index)
let firstUnsplitSeg = -1
for (let i = 0; i < numSegments; i++) {
  if (!segmentHasSplit[i]) {
    firstUnsplitSeg = i
    break
  }
}

// Count unsplit segments
const unsplitCount = firstUnsplitSeg >= 0 ? numSegments - firstUnsplitSeg : 0
// But wait - segments split from BOTTOM, so unsplit ones are at TOP
// Let me recalculate: if bottom splits first, then unsplit segments are consecutive from index 0

// Actually let's be more careful:
// segmentHasSplit[i] where i=0 is top segment, i=numSegments-1 is bottom
// Bottom (high i) splits first due to splitOrder = numSegments - 1 - i
// So unsplit segments are the ones with lower indices (top ones)

let unsplitFromTop = 0
for (let i = 0; i < numSegments; i++) {
  if (!segmentHasSplit[i]) unsplitFromTop++
  else break  // once we hit a split one, the rest below are also split
}

const fullyMerged = returnPhase >= 1

// === RENDER DOT ===
if (dotHasSplit && !fullyMerged) {
  // Dot has split off - render it individually
  const dotEffectiveSplit = easeOut(dotRawSplit) * (1 - returnPhase)
  const dotBaseY = -totalH / 2 + segH / 2
  const dotFinalY = dotBaseY - dotEffectiveSplit * dotSeparation - bounceOffset
  shapes.push(box({ x: 0, y: dotFinalY, z: 0 }, { x: segW, y: segH, z: segD }))
}

// === RENDER SPLIT SEGMENTS ===
if (!fullyMerged) {
  for (let i = 0; i < numSegments; i++) {
    if (segmentHasSplit[i]) {
      // This segment has split - render individually
      const splitOrder = numSegments - 1 - i
      const segStart = T_SEG_START + splitOrder * segStagger
      const segEnd = segStart + segStagger * 1.5
      const rawSplit = easeOut(remap(t, segStart, min(segEnd, T_SEG_END)))
      const effectiveSplit = rawSplit * (1 - returnPhase)
      
      // Base position (i+1 because dot is index 0)
      const baseY = -totalH / 2 + segH / 2 + (i + 1) * segH
      const spreadAmount = effectiveSplit * segmentSpread * (i + 1) * 1.5
      const finalY = baseY + spreadAmount - bounceOffset
      
      // Rotation: uses staggered alignment phase (bottom aligns first, then cascade up)
      const data = segmentData[i] || { rot: vec3(0, 0, 0) }
      const rotAlign = getRotationAlign(i)  // 0 = full rotation, 1 = aligned
      const effectiveRotation = rawSplit * (1 - rotAlign)
      const rotAmount = effectiveRotation * rotationStrength
      const rot = {
        x: data.rot.x * rotAmount,
        y: data.rot.y * rotAmount * 0.3,
        z: data.rot.z * rotAmount
      }
      
      const piece = box({ x: 0, y: finalY, z: 0 }, { x: segW, y: segH, z: segD })
      if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) {
        shapes.push(rotate(piece, rot))
      } else {
        shapes.push(piece)
      }
    }
  }
}

// === RENDER UNSPLIT PORTION AS ONE SHAPE ===
if (fullyMerged) {
  // Everything merged - render as single line
  shapes.length = 0
  shapes.push(box({ x: 0, y: -bounceOffset, z: 0 }, { x: segW, y: totalH, z: segD }))
} else if (!dotHasSplit) {
  // Nothing has split yet - render as single line
  shapes.push(box({ x: 0, y: -bounceOffset, z: 0 }, { x: segW, y: totalH, z: segD }))
} else if (unsplitFromTop > 0) {
  // Dot has split, but some top segments remain unsplit
  // Render ONLY the unsplit segments (NOT the dot's space - dot is rendered separately)
  const unsplitH = segH * unsplitFromTop
  // Unsplit segments start right after the dot's original position
  // Dot was at index 0, segments start at index 1
  // First unsplit segment is at index 1 in the original full bar
  const unsplitTopY = -totalH / 2 + segH  // skip the dot's space
  const unsplitCenterY = unsplitTopY + unsplitH / 2 - bounceOffset
  shapes.push(box({ x: 0, y: unsplitCenterY, z: 0 }, { x: segW, y: unsplitH, z: segD }))
} else if (dotHasSplit && unsplitFromTop === 0) {
  // Dot split, all segments split - nothing unsplit, no unified shape needed
}

// === RENDER ===
render(shapes)







// === GEOMETRY MICRO-LIB (this was FUN!!!) ===

// Algorithms used:
// - Cyrus-Beck line clipping (1978): https://en.wikipedia.org/wiki/Cyrus%E2%80%93Beck_algorithm
// - Roberts hidden line removal for convex polyhedra (1963): https://en.wikipedia.org/wiki/Hidden-line_removal
// - Back-face culling: https://en.wikipedia.org/wiki/Back-face_culling

// Constraints: Non-intersecting convex polyhedra only, sorry :)
// All geometry functions return { verts: [{x,y,z}...], faces: [[indices...]...] }
// Faces use CCW winding when viewed from outside

// Vector utilities
function vec3(x, y, z) { return { x, y, z } }
function vadd(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z } }
function vscale(v, s) { return { x: v.x * s, y: v.y * s, z: v.z * s } }
function vlength(v) { return hypot(v.x, v.y, v.z) }
function vnormalize(v) {
  const len = vlength(v)
  return len < 1e-10 ? vec3(0, 0, 0) : vscale(v, 1 / len)
}

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

// Hidden line modes:
// - 'none': full line removal, only show visible edges (classic wireframe)
// - 'xray': show lines occluded by OTHER objects as dotted (X-ray vision)
// - 'backface': show back-face edges of shapes as dotted (see-through)
// - 'all': combine xray + backface (full transparency)

function computeVisible(objects, spin, elev, zoom, hiddenMode = 'none') {
  const viewDir = { x: 0, y: 0, z: -1 }
  const showXray = hiddenMode === 'xray' || hiddenMode === 'all'
  const showBackface = hiddenMode === 'backface' || hiddenMode === 'all'

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

  // Collect candidate edges
  const candidateEdges = []
  for (const e of edgeMap.values()) {
    const hasFrontFace = e.faceIndices.some(fi => allFaces[fi].isFront)
      const obj = viewObjects[e.objIdx]
    
    if (hasFrontFace) {
      // Edge has at least one front-facing face — starts visible
      candidateEdges.push({ objIdx: e.objIdx, p0: obj.verts[e.i0], p1: obj.verts[e.i1], isBackface: false })
    } else if (showBackface) {
      // Edge is entirely on back faces — starts hidden (if we're showing backfaces)
      candidateEdges.push({ objIdx: e.objIdx, p0: obj.verts[e.i0], p1: obj.verts[e.i1], isBackface: true })
    }
  }

  // Front-facing faces for occlusion testing
  const frontFaces = allFaces.filter(f => f.isFront)

  // Clip each candidate edge against front faces of OTHER objects
  const visibleSegments = []
  const hiddenSegments = []

  for (const edge of candidateEdges) {
    const { x: x0, y: y0, z: z0 } = edge.p0
    const { x: x1, y: y1, z: z1 } = edge.p1
    // Back-face edges start as hidden; front-face edges start visible
    let segments = [{ t0: 0, t1: 1, hidden: edge.isBackface }]

    for (const face of frontFaces) {
      // Skip self-occlusion for front-face edges (handled by face culling)
      // But DO apply self-occlusion for back-face edges (they can be hidden by front faces of same object)
      if (face.objIdx === edge.objIdx && !edge.isBackface) continue 

      const newSegments = []
      for (const seg of segments) {
        // Already hidden segments stay hidden, no further processing needed
        if (seg.hidden) { newSegments.push(seg); continue }

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
          // Segment in front of face, keep it as-is
          newSegments.push(seg)
          continue
        }

        // Segment is behind face — split around occluded region
        const gEnter = seg.t0 + tEnter * (seg.t1 - seg.t0)
        const gLeave = seg.t0 + tLeave * (seg.t1 - seg.t0)
        if (gEnter > seg.t0 + 1e-6) newSegments.push({ t0: seg.t0, t1: gEnter, hidden: false })
        if (gLeave - gEnter > 1e-6) newSegments.push({ t0: gEnter, t1: gLeave, hidden: true })
        if (gLeave < seg.t1 - 1e-6) newSegments.push({ t0: gLeave, t1: seg.t1, hidden: false })
      }
      segments = newSegments
    }

    // Output visible and hidden portions
    for (const seg of segments) {
      const result = {
        x0: x0 + seg.t0 * (x1 - x0), y0: y0 + seg.t0 * (y1 - y0),
        x1: x0 + seg.t1 * (x1 - x0), y1: y0 + seg.t1 * (y1 - y0),
      }
      // Only include hidden segments if we're in a mode that shows them
      if (seg.hidden) {
        if (showXray || showBackface) hiddenSegments.push(result)
      } else {
        visibleSegments.push(result)
      }
    }
  }

  return { visible: visibleSegments, hidden: hiddenSegments }
}


// Draw a dotted line from (x0,y0) to (x1,y1)
function dottedLine(x0, y0, x1, y1, dotLen = 0.02, gapLen = 0.02) {
  const dx = x1 - x0, dy = y1 - y0
  const len = hypot(dx, dy)
  if (len < 1e-6) return
  const ux = dx / len, uy = dy / len
  const step = dotLen + gapLen
  let t = 0
  while (t < len) {
    const tEnd = min(t + dotLen, len)
    move(x0 + t * ux, y0 + t * uy)
    line(x0 + tEnd * ux, y0 + tEnd * uy)
    t += step
  }
}

// Hidden line modes:
// - 'none': full line removal, only show visible edges (classic wireframe)
// - 'xray': show lines occluded by OTHER objects as dotted (X-ray vision)
// - 'backface': show back-face edges of shapes as dotted (see-through)
// - 'all': combine xray + backface (full transparency)
function render(shapes, hiddenMode = 'none') {
  const { visible, hidden } = computeVisible(shapes, spin, elev, zoom, hiddenMode)
  begin()
  
  // Draw visible lines (solid)
  for (const s of visible) {
    move(s.x0, s.y0)
    line(s.x1, s.y1)
  }
  
  // Draw hidden lines (dotted)
  for (const s of hidden) {
    dottedLine(s.x0, s.y0, s.x1, s.y1)
  }
}
