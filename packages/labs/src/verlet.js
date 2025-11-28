// ==== CONFIGURATION ====
// Anchor points
const LEFT_ANCHOR = { x: -0.7, y: -0.6 }
const MIDDLE_ANCHOR = { x: 0, y: 0 }
const RIGHT_ANCHOR = { x: 0.7, y: -0.6 }

const NUM_ROPES_PER_V = 3
const LENGTH_VARIATION = 0.15

const SEGMENT_LENGTH = 60
const BASE_REST_DIST = 0.03

// Physics
const STEPS = 2
const GRAVITY = 1.5
const DAMPING = 0.985

// Wobble
const WOBBLE_AMOUNT = 0.015
const WOBBLE_SPEED = 0.8

// Breaking
const BREAK_CHANCE = 0.015  // chance per frame after t > 0.5

// Interaction
const MOUSE_INFLUENCE = 0.25
const MOUSE_FORCE = 0.08

// Anchor circle size
const ANCHOR_RADIUS = 0.05

// ==== INITIALIZATION ====
if (params.t < (params.s.lastT || 0)) {
  params.s.ropes = null
}
params.s.lastT = params.t

const lerp = (a, b, t) => a + (b - a) * t

if (!params.s.ropes) {
  params.s.ropes = []
  
  const segments = [
    [LEFT_ANCHOR, MIDDLE_ANCHOR],
    [MIDDLE_ANCHOR, RIGHT_ANCHOR]
  ]
  
  for (let [start, end] of segments) {
    for (let r = 0; r < NUM_ROPES_PER_V; r++) {
      const lengthMult = 1 + (rand() - 0.5) * LENGTH_VARIATION * 2
      const restDist = BASE_REST_DIST * lengthMult
      const offset = (r - (NUM_ROPES_PER_V - 1) / 2) * 0.02
      
      const points = []
      for (let i = 0; i < SEGMENT_LENGTH; i++) {
        const t = i / (SEGMENT_LENGTH - 1)
        const x = lerp(start.x + offset, end.x + offset, t)
        const y = lerp(start.y, end.y, t)
        
        points.push({
          x, y,
          oldX: x,
          oldY: y,
          fixed: i === 0 || i === SEGMENT_LENGTH - 1,
          wobblePhase: rand() * TAU
        })
      }
      
      params.s.ropes.push({ 
        points, 
        restDist,
        broken: false,
        breakIndex: -1
      })
    }
  }
}

// ==== ROPE BREAKING ====
if (params.t > 0.5) {
  for (let rope of params.s.ropes) {
    if (!rope.broken && rand() < BREAK_CHANCE) {
      rope.broken = true
      rope.breakIndex = floor(rand(0.3, 0.7) * rope.points.length)
    }
  }
}

// ==== PHYSICS SIMULATION ====
for (let step = 0; step < STEPS; step++) {
  const dt = 0.016
  const gravity = GRAVITY + params.r * 2
  
  for (let rope of params.s.ropes) {
    for (let i = 0; i < rope.points.length; i++) {
      const p = rope.points[i]
      
      if (!p.fixed) {
        const vx = (p.x - p.oldX) * DAMPING
        const vy = (p.y - p.oldY) * DAMPING
        
        p.oldX = p.x
        p.oldY = p.y
        
        // Smooth wobble
        const wobbleX = sin((params.t * WOBBLE_SPEED + p.wobblePhase) * TAU) * WOBBLE_AMOUNT
        const wobbleY = cos((params.t * WOBBLE_SPEED * 1.3 + p.wobblePhase) * TAU) * WOBBLE_AMOUNT * 0.5
        
        p.x += vx + wobbleX
        p.y += vy + gravity * dt * dt + wobbleY
      }
    }
  }
  
  // Distance constraints (skip broken segments)
  for (let iter = 0; iter < 3; iter++) {
    for (let rope of params.s.ropes) {
      for (let i = 0; i < rope.points.length - 1; i++) {
        // Skip constraint across break point
        if (rope.broken && i === rope.breakIndex) continue
        
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

// ==== MOUSE INTERACTION ====
if (params.x !== 0 || params.y !== 0) {
  const mouseX = params.x
  const mouseY = params.y
  
  for (let rope of params.s.ropes) {
    for (let p of rope.points) {
      if (!p.fixed) {
        const dx = mouseX - p.x
        const dy = mouseY - p.y
        const d = sqrt(dx * dx + dy * dy)
        
        if (d < MOUSE_INFLUENCE) {
          const force = (1 - d / MOUSE_INFLUENCE) * MOUSE_FORCE
          p.x += dx * force
          p.y += dy * force
        }
      }
    }
  }
}

// ==== RENDERING ====
// Draw ropes
for (let rope of params.s.ropes) {
  if (rope.broken) {
    // Draw first segment
    begin()
    for (let i = 0; i <= rope.breakIndex; i++) {
      line(rope.points[i].x, rope.points[i].y)
    }
    
    // Draw second segment
    begin()
    for (let i = rope.breakIndex + 1; i < rope.points.length; i++) {
      line(rope.points[i].x, rope.points[i].y)
    }
  } else {
    begin()
    for (let p of rope.points) {
      line(p.x, p.y)
    }
  }
}

// Draw anchor points
circle(LEFT_ANCHOR.x, LEFT_ANCHOR.y, ANCHOR_RADIUS)
circle(MIDDLE_ANCHOR.x, MIDDLE_ANCHOR.y, ANCHOR_RADIUS)
circle(RIGHT_ANCHOR.x, RIGHT_ANCHOR.y, ANCHOR_RADIUS)