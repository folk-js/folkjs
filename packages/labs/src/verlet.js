// VERLET-W14 (work-in-progress)
// — Orion Reed

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

function updateRopeAnchors(rope, startPos, endPos) {
  if (rope.points[0].fixed) {
    rope.points[0].x = startPos.x
    rope.points[0].y = startPos.y
  }
  if (rope.points[rope.points.length - 1].fixed) {
    rope.points[rope.points.length - 1].x = endPos.x
    rope.points[rope.points.length - 1].y = endPos.y
  }
}

function simulateRope(rope, gravity, damping, steps = 2) {
  for (let step = 0; step < steps; step++) {
    const dt = 0.016

    // Apply forces
    for (let p of rope.points) {
      if (!p.fixed) {
        const vx = (p.x - p.oldX) * damping
        const vy = (p.y - p.oldY) * damping

        p.oldX = p.x
        p.oldY = p.y

        p.x += vx
        p.y += vy + gravity * dt * dt
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

function applyForce(rope, mouseX, mouseY, influence = 0.25, force = 0.08) {
  for (let p of rope.points) {
    if (!p.fixed) {
      const dx = mouseX - p.x
      const dy = mouseY - p.y
      const d = sqrt(dx * dx + dy * dy)

      if (d < influence) {
        const f = (1 - d / influence) * force
        p.x += dx * f
        p.y += dy * f
      }
    }
  }
}

// ======== END OF MICRO-LIB :) ======== //

// ==== CONFIGURATION ====
const ANCHORS = [
  { x: -0.8, y: -0.6 },  // left
  { x: 0, y: 0 },        // middle
  { x: 0.8, y: -0.6 }    // right
]

const NUM_ROPES_PER_SEGMENT = 4
const ROPE_SPREAD = 0.02
const GRAVITY = 1.5
const DAMPING = 0.985

// anchors
const WOBBLE_AMOUNT = 0.1
const BREAK_START = 0.5
const BREAK_END = 1

// ==== STATE INITIALIZATION ====
if (!params.s.lastT || params.t < params.s.lastT) {
  params.s.ropes = []
}
params.s.lastT = params.t

// ==== ROPE LIFECYCLE ====
const totalRopes = NUM_ROPES_PER_SEGMENT * 2

// Add ropes during first half of loop (t < 0.5)
if (params.t < 0.5) {
  const targetCount = floor((params.t / 0.5) * totalRopes)

  while (params.s.ropes.length < targetCount) {
    const ropeIndex = params.s.ropes.length
    const segmentIndex = floor(ropeIndex / NUM_ROPES_PER_SEGMENT)
    const ropeInSegment = ropeIndex % NUM_ROPES_PER_SEGMENT

    const offset = (ropeInSegment - (NUM_ROPES_PER_SEGMENT - 1) / 2) * ROPE_SPREAD
    const lengthVariation = 1 + (rand() - 0.5) * 0.3

    let rope, anchorIndices
    if (segmentIndex === 0) {
      rope = createRope(
        ANCHORS[0].x + offset, ANCHORS[0].y,
        ANCHORS[1].x + offset, ANCHORS[1].y,
        { restDist: 0.03 * lengthVariation }
      )
      anchorIndices = [0, 1]
    } else {
      rope = createRope(
        ANCHORS[1].x + offset, ANCHORS[1].y,
        ANCHORS[2].x + offset, ANCHORS[2].y,
        { restDist: 0.03 * lengthVariation }
      )
      anchorIndices = [1, 2]
    }

    params.s.ropes.push({
      rope,
      anchorIndices,
      cutTime: rand(BREAK_START, BREAK_END),
      cutPosition: rand(0.2, 0.8),
      unfixStartTime: rand(BREAK_START, BREAK_END),
      unfixEndTime: rand(BREAK_START, BREAK_END),
      hasCut: false,
      hasUnfixedStart: false,
      hasUnfixedEnd: false
    })
  }
}

// Process cuts and unfixing
for (let i = params.s.ropes.length - 1; i >= 0; i--) {
  const ropeData = params.s.ropes[i]

  // Cut rope
  if (!ropeData.hasCut && params.t >= ropeData.cutTime) {
    const result = cutRope(ropeData.rope, ropeData.cutPosition)
    if (result) {
      const [rope1, rope2] = result

      // Replace this rope with the two new pieces
      params.s.ropes.splice(i, 1,
        {
          rope: rope1,
          anchorIndices: ropeData.anchorIndices,
          unfixStartTime: ropeData.unfixStartTime,
          unfixEndTime: Infinity,
          hasUnfixedStart: ropeData.hasUnfixedStart,
          hasUnfixedEnd: false
        },
        {
          rope: rope2,
          anchorIndices: ropeData.anchorIndices,
          unfixStartTime: Infinity,
          unfixEndTime: ropeData.unfixEndTime,
          hasUnfixedStart: false,
          hasUnfixedEnd: ropeData.hasUnfixedEnd
        }
      )
    }
  }

  // Unfix start anchor
  if (!ropeData.hasUnfixedStart && params.t >= ropeData.unfixStartTime) {
    unfixAnchor(ropeData.rope, true)
    ropeData.hasUnfixedStart = true
  }

  // Unfix end anchor
  if (!ropeData.hasUnfixedEnd && params.t >= ropeData.unfixEndTime) {
    unfixAnchor(ropeData.rope, false)
    ropeData.hasUnfixedEnd = true
  }
}

// Cull ropes using AABB
for (let i = params.s.ropes.length - 1; i >= 0; i--) {
  const ropeData = params.s.ropes[i]
  const clippedRopes = cutAABB(ropeData.rope, -1, -1, 1, 1)

  if (!clippedRopes) {
    // Completely out of bounds - remove
    params.s.ropes.splice(i, 1)
  } else if (clippedRopes.length > 1) {
    // Rope split into multiple sections - replace with new sections
    const newRopeData = clippedRopes.map(rope => ({
      rope,
      anchorIndices: ropeData.anchorIndices,
      unfixStartTime: Infinity,
      unfixEndTime: Infinity,
      hasUnfixedStart: true,
      hasUnfixedEnd: true
    }))
    params.s.ropes.splice(i, 1, ...newRopeData)
  } else if (clippedRopes[0].points.length < ropeData.rope.points.length) {
    // Rope was trimmed - update with clipped version
    ropeData.rope = clippedRopes[0]
  }
}

// ==== CALCULATE WOBBLING ANCHORS ====
const wobblePhase = params.t * TAU
const wobbledAnchors = ANCHORS.map((anchor, i) => ({
  x: anchor.x + sin(wobblePhase + i * 2) * WOBBLE_AMOUNT,
  y: anchor.y + cos(wobblePhase + i * 2) * WOBBLE_AMOUNT * 0.5
}))

// ==== UPDATE ====
const gravity = GRAVITY + params.r * 2

for (let ropeData of params.s.ropes) {
  const { rope, anchorIndices } = ropeData

  // Update anchor positions
  const [startIdx, endIdx] = anchorIndices
  updateRopeAnchors(rope, wobbledAnchors[startIdx], wobbledAnchors[endIdx])

  // Simulate physics
  simulateRope(rope, gravity, DAMPING)

  // Mouse interaction
  if (params.x !== 0 || params.y !== 0) {
    applyForce(rope, params.x, params.y)
  }
}

// ==== RENDER ====
for (let ropeData of params.s.ropes) {
  drawRope(ropeData.rope)
}

for (let anchor of wobbledAnchors) {
  begin(true)
  circle(anchor.x, anchor.y, 0.02)
}