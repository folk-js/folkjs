// "H" via vector field line tracing

// Debug mode - shows vectors and H cells instead of field lines
const DEBUG = false

// Field configuration
const FIELD_SIZE = 12         // Grid resolution for H shape (always square)
const SEED = 42               // Random seed
const DEBUG_ARROW_LEN = 0.1   // Length of debug arrows

// H shape configuration (in grid cells)
const H_LEFT = 1              // Left vertical bar start column
const H_RIGHT = 8             // Right vertical bar start column  
const H_BAR_WIDTH = 3         // Width of vertical bars
const H_CROSSBAR_TOP = 4      // Crossbar top row
const H_CROSSBAR_BOTTOM = 7   // Crossbar bottom row

// Field behavior configuration  
// Inside H: swirly noise
const INSIDE_CURL = 0.7       // Curl strength inside H
const INSIDE_NOISE = 0.5      // Noise randomness inside H

// Outside H: spiral inward
const SPIRAL_TWIST = 0.15     // How much to twist inward vectors (in turns, 0.25 = 90°)
const INWARD_STRENGTH = 0.8   // How strongly vectors point inward (vs twisted)

// Particle/tracing configuration
const PARTICLES_X = 16        // Particles grid columns
const PARTICLES_Y = 16        // Particles grid rows
const JITTER = 0.4            // Random offset for particle positions (0-1)
const TRACE_STEPS = 25        // Steps per particle trail
const STEP_SIZE = 0.02        // How far particle moves per step

// Animation
const FLOW_SPEED = 1.0        // How fast the field animates with params.t

// Pre-computed constants
const HALF_FIELD_SIZE = FIELD_SIZE * 0.5
const INV_PARTICLES_X = 2 / PARTICLES_X
const INV_PARTICLES_Y = 2 / PARTICLES_Y
const CELL_SIZE = 2 / FIELD_SIZE
const H_LEFT_END = H_LEFT + H_BAR_WIDTH
const H_RIGHT_END = H_RIGHT + H_BAR_WIDTH
const FIELD_SIZE_MINUS_1 = FIELD_SIZE - 1

// High-resolution field grid for fast lookups
const GRID_RES = 128  // Resolution of pre-computed field
const GRID_BOUND = 1.15  // Slightly beyond [-1.1, 1.1] bounds
const GRID_SCALE = (GRID_RES - 1) / (2 * GRID_BOUND)
const INV_GRID_SCALE = 1 / GRID_SCALE

// Initialize state and pre-compute field grid (once)
if (!params.s.fieldGrid) {
  // Seeded PRNG for noise
  let seed = SEED
  const random = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  
  // Generate noise grid for field variation
  const noiseGrid = []
  for (let i = 0; i <= FIELD_SIZE; i++) {
    noiseGrid[i] = []
    for (let j = 0; j <= FIELD_SIZE; j++) {
      noiseGrid[i][j] = random() * TAU
    }
  }
  
  // Sample noise with bilinear interpolation
  const sampleNoise = (nx, ny) => {
    const gx = (nx + 1) * HALF_FIELD_SIZE
    const gy = (ny + 1) * HALF_FIELD_SIZE
    const x0 = gx | 0, y0 = gy | 0
    const tx = gx - x0, ty = gy - y0
    const cx0 = x0 < 0 ? 0 : x0 > FIELD_SIZE ? FIELD_SIZE : x0
    const cy0 = y0 < 0 ? 0 : y0 > FIELD_SIZE ? FIELD_SIZE : y0
    const cx1 = x0 + 1 > FIELD_SIZE ? FIELD_SIZE : x0 + 1
    const cy1 = y0 + 1 > FIELD_SIZE ? FIELD_SIZE : y0 + 1
    const a00 = noiseGrid[cx0][cy0], a10 = noiseGrid[cx1][cy0]
    const a01 = noiseGrid[cx0][cy1], a11 = noiseGrid[cx1][cy1]
    return a00 + (a10 - a00) * tx + (a01 - a00) * ty + (a00 - a10 - a01 + a11) * tx * ty
  }
  
  // Check if inside H
  const isInsideH = (x, y) => {
    if (x >= H_LEFT && x < H_LEFT_END && y >= 1 && y < FIELD_SIZE_MINUS_1) return true
    if (x >= H_RIGHT && x < H_RIGHT_END && y >= 1 && y < FIELD_SIZE_MINUS_1) return true
    if (y >= H_CROSSBAR_TOP && y < H_CROSSBAR_BOTTOM && x >= H_LEFT && x < H_RIGHT_END) return true
    return false
  }
  
  // Pre-compute field: store (baseVx, baseVy, inside) per cell
  // baseV is the unit vector BEFORE time rotation
  const grid = new Float32Array(GRID_RES * GRID_RES * 3)
  
  for (let j = 0; j < GRID_RES; j++) {
    for (let i = 0; i < GRID_RES; i++) {
      const x = -GRID_BOUND + i * INV_GRID_SCALE
      const y = -GRID_BOUND + j * INV_GRID_SCALE
      const idx = (j * GRID_RES + i) * 3
      
      // Map to H grid coords
      const gx = (x + 1) * HALF_FIELD_SIZE
      const gy = (y + 1) * HALF_FIELD_SIZE
      const inside = isInsideH(gx | 0, gy | 0)
      
      let bx, by
      
      if (inside) {
        // Inside H: compute base angle (without time rotation)
        const baseAngle = sampleNoise(x, y)
        const curlAngle = Math.atan2(-x, y)
        const spatialPhase = Math.sin(x * 3.0) * Math.cos(y * 3.0) * TAU
        const mixedAngle = baseAngle * INSIDE_NOISE + curlAngle * INSIDE_CURL + spatialPhase
        bx = Math.cos(mixedAngle)
        by = Math.sin(mixedAngle)
      } else {
        // Outside H: compute base direction (before time-dependent twist)
        const dist = Math.sqrt(x * x + y * y) || 0.001
        const nx = -x / dist
        const ny = -y / dist
        // Apply base twist (without time component)
        const baseTwist = SPIRAL_TWIST * TAU
        const ct = Math.cos(baseTwist), st = Math.sin(baseTwist)
        const rx = nx * ct - ny * st
        const ry = nx * st + ny * ct
        // Mix and normalize
        bx = rx * (1 - INWARD_STRENGTH) + nx * INWARD_STRENGTH
        by = ry * (1 - INWARD_STRENGTH) + ny * INWARD_STRENGTH
        const len = Math.sqrt(bx * bx + by * by) || 1
        bx /= len
        by /= len
      }
      
      grid[idx] = bx
      grid[idx + 1] = by
      grid[idx + 2] = inside ? 1 : 0
    }
  }
  
  params.s.fieldGrid = grid
  params.s.fieldOut = { x: 0, y: 0, inside: false }
}

const fieldGrid = params.s.fieldGrid
const fieldOut = params.s.fieldOut

// Pre-compute time rotation for this frame (2 trig calls total!)
const timeAngle = params.t * FLOW_SPEED * TAU
const cosTime = cos(timeAngle)
const sinTime = sin(timeAngle)

// Fast field lookup: just grid sample + rotation matrix (NO trig in hot path)
function getField(x, y) {
  // Map to grid indices
  const gi = ((x + GRID_BOUND) * GRID_SCALE) | 0
  const gj = ((y + GRID_BOUND) * GRID_SCALE) | 0
  
  // Clamp to grid bounds
  const ci = gi < 0 ? 0 : gi >= GRID_RES ? GRID_RES - 1 : gi
  const cj = gj < 0 ? 0 : gj >= GRID_RES ? GRID_RES - 1 : gj
  
  const idx = (cj * GRID_RES + ci) * 3
  const bx = fieldGrid[idx]
  const by = fieldGrid[idx + 1]
  
  // Apply time rotation (4 muls, 2 adds - no trig!)
  fieldOut.x = bx * cosTime - by * sinTime
  fieldOut.y = bx * sinTime + by * cosTime
  fieldOut.inside = fieldGrid[idx + 2] > 0.5
  return fieldOut
}

// Generate particle starting positions (grid with jitter)
const particles = []
{
  let seed = SEED + 100
  const jitterRng = () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  for (let i = 0; i < PARTICLES_X; i++) {
    for (let j = 0; j < PARTICLES_Y; j++) {
      const baseX = -1 + (i + 0.5) * INV_PARTICLES_X
      const baseY = -1 + (j + 0.5) * INV_PARTICLES_Y
      const jx = (jitterRng() - 0.5) * INV_PARTICLES_X * JITTER
      const jy = (jitterRng() - 0.5) * INV_PARTICLES_Y * JITTER
      particles.push({ x: baseX + jx, y: baseY + jy })
    }
  }
}

if (DEBUG) {
  // Debug mode: show grid, H cells, and vectors
  // Local isInsideH for debug visualization
  const isInsideH = (x, y) => {
    if (x >= H_LEFT && x < H_LEFT_END && y >= 1 && y < FIELD_SIZE_MINUS_1) return true
    if (x >= H_RIGHT && x < H_RIGHT_END && y >= 1 && y < FIELD_SIZE_MINUS_1) return true
    if (y >= H_CROSSBAR_TOP && y < H_CROSSBAR_BOTTOM && x >= H_LEFT && x < H_RIGHT_END) return true
    return false
  }
  
  for (let i = 0; i < FIELD_SIZE; i++) {
    for (let j = 0; j < FIELD_SIZE; j++) {
      const cx = -1 + (i + 0.5) * CELL_SIZE
      const cy = -1 + (j + 0.5) * CELL_SIZE
      
      const inside = isInsideH(i, j)
      
      // Draw cell outline if inside H
      if (inside) {
        const x0 = -1 + i * CELL_SIZE
        const y0 = -1 + j * CELL_SIZE
        rect(x0, y0, CELL_SIZE, CELL_SIZE)
      }
      
      // Draw vector arrow
      const field = getField(cx, cy)
      const ax = field.x * DEBUG_ARROW_LEN
      const ay = field.y * DEBUG_ARROW_LEN
      
      // Dot at center
      circle(cx, cy, 0.015)
      
      // Arrow from center
      move(cx, cy)
      line(cx + ax, cy + ay)
    }
  }
} else {
  // Normal mode: trace field lines from each particle
  const numParticles = particles.length
  for (let pi = 0; pi < numParticles; pi++) {
    const p = particles[pi]
    let x = p.x
    let y = p.y
    
    // Check if starting inside bounds
    if (x < -1 || x > 1 || y < -1 || y > 1) continue
    
    // Track if we're currently drawing (inside H)
    let wasInside = false
    
    for (let step = 0; step < TRACE_STEPS; step++) {
      const field = getField(x, y)
      x += field.x * STEP_SIZE
      y += field.y * STEP_SIZE
      
      // Stop if out of bounds
      if (x < -1.1 || x > 1.1 || y < -1.1 || y > 1.1) break
      
      // Use inside flag from getField (avoids duplicate calculation)
      if (field.inside) {
        if (!wasInside) {
          // Entering H, start new line segment
          move(x, y)
        } else {
          // Continue drawing inside H
          line(x, y)
        }
        wasInside = true
      } else {
        wasInside = false
      }
    }
  }
}
