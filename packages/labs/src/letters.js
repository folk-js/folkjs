// HYPERTEXT T-20

// === INPUTS ===
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
const baseRotX = -params.y * PI * 0.4

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
const depth = denorm(r, 0.18, 0.35)
const splitVariation = denorm(q, 0, 1)  // q controls split gap and rotation

// === T GEOMETRY ===
const barW = 1.3, barH = 0.26
const stemW = 0.26, stemH = 0.85
const halfBarW = barW / 2

// Junction point
const junctionY = -0.15
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
  
  // Unique rotations for each half (asymmetric movement)
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
  const collapseFade = phase < 0.1 ? phase / 0.1 : 1
  const vis = fade * collapseFade
  
  // Guide box: taller and grows when scattered
  const guideMargin = 0.4 + (1 - assembly) * 0.35
  const guideW = (barW + guideMargin) * scaleX
  const guideH = ((barHomeY - barH / 2 + (stemHomeY + stemH / 2)) + guideMargin * 3) * scaleY  // taller
  const guideD = (depth + guideMargin * 2) * scaleZ
  
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
  
  const markerSize = 0.055 * vis * min(scaleY, scaleZ)
  for (const corner of corners) {
    shapes.push(cube(corner, markerSize))
  }
}

render(shapes)

// === API REFERENCE ===
// 
// PRIMITIVES — create shapes at pos {x,y,z} with size {x,y,z} or scalar
//   box(pos, size)        — axis-aligned box
//   cube(pos, size)       — equal-sided box  
//   tetra(pos, size)      — tetrahedron (4 faces)
//   octa(pos, size)       — octahedron (8 faces)
//   wedge(pos, size)      — triangular prism
//   pyramid(pos, size)    — square base + 4 triangular sides
//   extrude(poly2D, depth, pos) — extrude 2D convex polygon along Z
//
// TRANSFORMS — modify shapes, return new shape
//   translate(shape, offset)           — move by {x,y,z}
//   rotate(shape, angles, aroundCentroid?) — rotate by {x,y,z} radians
//   scale(shape, factor, aroundCentroid?)  — scale uniformly or {x,y,z}
//
// RENDER
//   render(shapes)        — compute hidden lines & draw
//   computeVisible(shapes, spin, elev, zoom) — returns line segments
//
// CONSTRAINTS
//   - All shapes must be CONVEX
//   - Shapes must NOT intersect each other

// === API REFERENCE ===
// 
// PRIMITIVES — create shapes at pos {x,y,z} with size {x,y,z} or scalar
//   box(pos, size)        — axis-aligned box
//   cube(pos, size)       — equal-sided box  
//   tetra(pos, size)      — tetrahedron (4 faces)
//   octa(pos, size)       — octahedron (8 faces)
//   wedge(pos, size)      — triangular prism
//   pyramid(pos, size)    — square base + 4 triangular sides
//   extrude(poly2D, depth, pos) — extrude 2D convex polygon along Z
//
// TRANSFORMS — modify shapes, return new shape
//   translate(shape, offset)           — move by {x,y,z}
//   rotate(shape, angles, aroundCentroid?) — rotate by {x,y,z} radians
//   scale(shape, factor, aroundCentroid?)  — scale uniformly or {x,y,z}
//
// RENDER
//   render(shapes)        — compute hidden lines & draw
//   computeVisible(shapes, spin, elev, zoom) — returns line segments
//
// CONSTRAINTS
//   - All shapes must be CONVEX
//   - Shapes must NOT intersect each other