// VERLET-W14
// — Orion Reed

const ANCHORS = [
  { x: -0.9, y: -0.8 },  // left
  { x: 0, y: -0.2 },        // middle
  { x: 0.9, y: -0.8 }    // right
]

const GRAVITY = 1.5
const DAMPING = 0.99
// Number of simulation cycles to run when rope first spawns
const PRESIM = 20

// Rope length variation
const ROPE_LENGTH_MIN = 1.2
const ROPE_LENGTH_MAX = 1.6

// Timing (in seconds)
const SPAWN_INTERVAL_MIN = 0.5
const SPAWN_INTERVAL_MAX = 1.0
const CUT_DELAY_MIN = 2.0
const CUT_DELAY_MAX = 4.0
const UNFIX_DELAY_MIN = 3.0
const UNFIX_DELAY_MAX = 5.0
const CUT_POS_MIN = 0.2
const CUT_POS_MAX = 0.8

// Use mouse position to control gravity direction
const gravityX = params.x * 2
const gravityY = GRAVITY + params.y * 2

// ==== STATE INITIALIZATION ====
if (params.s.absoluteTime === undefined) {
  params.s.absoluteTime = 0
  params.s.lastFrameTime = Date.now() / 1000
  params.s.nextSpawnTime = 0
  params.s.ropes = []
  params.s.nextSegment = 0
}

// Track real delta time
const now = Date.now() / 1000
const dt = now - params.s.lastFrameTime
params.s.lastFrameTime = now
params.s.absoluteTime += dt

// Utility: absolute time + random
const arand = (min, max) => params.s.absoluteTime + rand(min, max)

// ==== ROPE SPAWNING ====
if (params.s.absoluteTime >= params.s.nextSpawnTime) {
  const segmentIndex = params.s.nextSegment
  params.s.nextSegment = 1 - segmentIndex
  
  const lengthVariation = denorm(rand(), ROPE_LENGTH_MIN, ROPE_LENGTH_MAX)
  const [startAnchor, endAnchor] = segmentIndex === 0 ? [ANCHORS[0], ANCHORS[1]] : [ANCHORS[1], ANCHORS[2]]
  
  const rope = createRope(
    startAnchor.x, startAnchor.y,
    endAnchor.x, endAnchor.y,
    { restDist: 0.03 * lengthVariation }
  )
  
  // Presimulate rope to let it settle
  for (let i = 0; i < PRESIM; i++) {
    simulateRope(rope, gravityX, gravityY, DAMPING)
  }
  
  params.s.ropes.push({
    rope,
    anchorIndices: segmentIndex === 0 ? [0, 1] : [1, 2],
    cutTime: arand(CUT_DELAY_MIN, CUT_DELAY_MAX),
    cutPosition: rand(CUT_POS_MIN, CUT_POS_MAX),
    unfixStartTime: arand(UNFIX_DELAY_MIN, UNFIX_DELAY_MAX),
    unfixEndTime: arand(UNFIX_DELAY_MIN, UNFIX_DELAY_MAX),
    hasCut: false,
    hasUnfixedStart: false,
    hasUnfixedEnd: false
  })
  
  params.s.nextSpawnTime = arand(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX)
}

// ==== ROPE PROCESSING LOOP ====
const { absoluteTime, ropes } = params.s

for (let i = ropes.length - 1; i >= 0; i--) {
  const ropeData = ropes[i]
  const { rope, anchorIndices, hasCut, cutTime, cutPosition } = ropeData

  // 1. LIFECYCLE: Cut rope
  if (!hasCut && absoluteTime >= cutTime) {
    const result = cutRope(rope, cutPosition)
    if (result) {
      const [rope1, rope2] = result
      const [startIdx, endIdx] = anchorIndices
      
      // Make middle anchor detach 3x faster
      // so it looks more like a "W"
      const rope1UnfixStartTime = startIdx === 1 
        ? absoluteTime + (ropeData.unfixStartTime - absoluteTime) / 3
        : ropeData.unfixStartTime
      
      const rope2UnfixEndTime = endIdx === 1
        ? absoluteTime + (ropeData.unfixEndTime - absoluteTime) / 3
        : ropeData.unfixEndTime

      ropes.splice(i, 1,
        {
          ...ropeData,
          rope: rope1,
          unfixStartTime: rope1UnfixStartTime,
          unfixEndTime: Infinity,
          hasUnfixedEnd: false,
          hasCut: true
        },
        {
          ...ropeData,
          rope: rope2,
          unfixStartTime: Infinity,
          unfixEndTime: rope2UnfixEndTime,
          hasUnfixedStart: false,
          hasCut: true
        }
      )
      continue
    }
  }

  // 2. LIFECYCLE: Unfix anchors
  if (!ropeData.hasUnfixedStart && absoluteTime >= ropeData.unfixStartTime) {
    unfixAnchor(rope, true)
    ropeData.hasUnfixedStart = true
  }
  if (!ropeData.hasUnfixedEnd && absoluteTime >= ropeData.unfixEndTime) {
    unfixAnchor(rope, false)
    ropeData.hasUnfixedEnd = true
  }

  // 3. CLEANUP: AABB culling
  const clippedRopes = cutAABB(rope, -1, -1, 1, 1)
  if (!clippedRopes) {
    ropes.splice(i, 1)
    continue
  }
  
  if (clippedRopes.length > 1) {
    ropes.splice(i, 1, ...clippedRopes.map(r => ({ ...ropeData, rope: r, hasCut: true })))
    continue
  }
  
  if (clippedRopes[0].points.length < rope.points.length) {
    ropeData.rope = clippedRopes[0]
  }

  // 4. UPDATE: Simulate physics
  simulateRope(ropeData.rope, gravityX, gravityY, DAMPING)

  // 5. RENDER: Draw rope
  drawRope(ropeData.rope)
}

for (let anchor of ANCHORS) {
  begin(true)
  circle(anchor.x, anchor.y, 0.02)
}

// ==== ROPE SIM MICRO-LIB (reuse encouraged!) ====

function createRope(startX, startY, endX, endY, options = {}) {
  const segments = options.segments || 60
  const restDist = options.restDist || 0.03

  const points = []
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1)
    const x = startX + (endX - startX) * t
    const y = startY + (endY - startY) * t

    points.push({
      x, y,
      oldX: x,
      oldY: y,
      fixed: i === 0 || i === segments - 1
    })
  }

  return {
    points,
    restDist
  }
}

function cutRope(rope, normalizedPosition) {
  const cutIndex = floor(normalizedPosition * (rope.points.length - 1))

  // Don't cut at the very ends
  if (cutIndex <= 0 || cutIndex >= rope.points.length - 1) {
    return null
  }

  // Clone the cut point so each rope has its own
  const cutPoint = rope.points[cutIndex]
  const cutPointClone = {
    x: cutPoint.x,
    y: cutPoint.y,
    oldX: cutPoint.oldX,
    oldY: cutPoint.oldY,
    fixed: false
  }

  // Create two new ropes from the cut
  const rope1 = {
    points: rope.points.slice(0, cutIndex + 1),
    restDist: rope.restDist
  }

  const rope2 = {
    points: [cutPointClone, ...rope.points.slice(cutIndex + 1)],
    restDist: rope.restDist
  }

  return [rope1, rope2]
}

function cutAABB(rope, minX, minY, maxX, maxY) {
  const isInBounds = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY

  const ropes = []
  let sectionStart = -1

  for (let i = 0; i < rope.points.length; i++) {
    const inBounds = isInBounds(rope.points[i])

    if (inBounds && sectionStart === -1) {
      // Entering bounds - start new section
      sectionStart = i
    } else if (!inBounds && sectionStart !== -1) {
      // Leaving bounds - end current section
      ropes.push({
        points: rope.points.slice(sectionStart, i),
        restDist: rope.restDist
      })
      sectionStart = -1
    }
  }

  // Handle final section if still in bounds at end
  if (sectionStart !== -1) {
    ropes.push({
      points: rope.points.slice(sectionStart),
      restDist: rope.restDist
    })
  }

  return ropes.length > 0 ? ropes : null
}

function unfixAnchor(rope, isStart = true) {
  if (isStart) {
    rope.points[0].fixed = false
  } else {
    rope.points[rope.points.length - 1].fixed = false
  }
}

function simulateRope(rope, gravityX, gravityY, damping, steps = 2) {
  for (let step = 0; step < steps; step++) {
    const dt = 0.016

    // Apply forces
    for (let p of rope.points) {
      if (!p.fixed) {
        const vx = (p.x - p.oldX) * damping
        const vy = (p.y - p.oldY) * damping

        p.oldX = p.x
        p.oldY = p.y

        p.x += vx + gravityX * dt * dt
        p.y += vy + gravityY * dt * dt
      }
    }

    // Distance constraints
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < rope.points.length - 1; i++) {
        const p1 = rope.points[i]
        const p2 = rope.points[i + 1]

        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const d = sqrt(dx * dx + dy * dy)

        if (d < 0.0001) continue

        const diff = (d - rope.restDist) / d
        const offsetX = dx * diff * 0.5
        const offsetY = dy * diff * 0.5

        if (!p1.fixed) {
          p1.x += offsetX
          p1.y += offsetY
        }
        if (!p2.fixed) {
          p2.x -= offsetX
          p2.y -= offsetY
        }
      }
    }
  }
}

function drawRope(rope) {
  begin()
  for (let p of rope.points) {
    line(p.x, p.y)
  }
}

// ======== END OF MICRO-LIB :) ======== //