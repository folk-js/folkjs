// SMITH TILES S16
// - Orion Reed
// waffle left/right: scale, x/y: change letter

// Layout: I N K / S W I / T C H
const letterPatterns = [
  // Row 0 (top)
  [ // 0: I
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1]
  ],
  [ // 1: N
    [1, 0,0,0, 1],
    [1, 1,0,0, 1],
    [1, 0,1,0, 1],
    [1, 0,0,1, 1],
    [1, 0,0,0, 1]
  ],
  [ // 2: K
    [1, 0, 0, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [1, 0, 1, 0],
    [1, 0, 0, 1]
  ],
  // Row 1 (middle)
  [ // 3: S
    [0, 1, 1, 1, 0],
    [0, 1, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 1, 0],
    [0, 1, 1, 1, 0]
  ],
  [ // 4: W
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 1, 0, 1, 1],
    [1, 0, 0, 0, 1]
  ],
  [ // 5: I (tall)
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 1, 1]
  ],
  // Row 2 (bottom)
  [ // 6: T
    [1, 1, 1],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0]
  ],
  [ // 7: C
    [0, 1, 1, 1],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 1, 1]
  ],
  [ // 8: H
    [1, 0,0, 1],
    [1, 0,0, 1],
    [1, 1,1, 1],
    [1, 0,0, 1],
    [1, 0,0, 1]
  ]
]

const SCALE = floor(denorm((params.q + 1) / 2, 1, 6))

// Edge i: TOP=0, RIGHT=1, BOTTOM=2, LEFT=3
// Corner c connects edges c and (c+1)%4
// Corner 0=TR(a1), 1=BR(b2), 2=BL(a2), 3=TL(b1)
const edgeDx = [0, 1, 0, -1]
const edgeDy = [-1, 0, 1, 0]
const cornerCx = [1, 1, -1, -1]
const cornerCy = [-1, 1, 1, -1]

// Helper functions for the geometry
const opposite = e => (e + 2) % 4
const turnRight = e => (e + 1) % 4
const turnLeft = e => (e + 3) % 4
const cornerStart = c => turnRight(c) * 0.25  // arc start angle
const borderCorner = (dir, useClosed) => useClosed ? turnRight(dir) : dir

// Apply bias to x to shift S so it overlaps with center (x=0)
// Bias shifts center but preserves edges: tapering = 1 at center, 0 at edges
const biasedX = params.x + (-0.35) * (1 - abs(params.x))
const patternX = min(max(floor((biasedX + 1) / 2 * 3), 0), 2)
const patternY = min(max(floor((params.y + 1) / 2 * 3), 0), 2)
const patternIdx = patternY * 3 + patternX
const letterPattern = letterPatterns[patternIdx]
const letterH = letterPattern.length
const letterW = letterPattern[0].length
const maxDim = max(letterH, letterW)
const n = letterH * SCALE + 2
const nMax = maxDim * SCALE + 2
const cRad = 1 / nMax

const offsetX = (maxDim - letterW) * SCALE * cRad
const offsetY = (maxDim - letterH) * SCALE * cRad

// Loop detection - change seed each cycle for variety
if (!params.s.loopState) {
  params.s.loopState = { lastT: params.t, loopCount: 0 }
}
if (params.t < params.s.loopState.lastT) {
  params.s.loopState.loopCount++
}
params.s.loopState.lastT = params.t
let seed = 232 + params.s.loopState.loopCount * 12345

// rng
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

// cell geometry helper
function cellCenter(x, y) {
  return [-1 + (2 * x + 1) * cRad + offsetX, -1 + (2 * y + 1) * cRad + offsetY]
}


// build 0/1 grid with scaling + 1-cell empty border
const grid = Array.from({ length: n }, () => Array(n).fill(0))

for (let r = 0; r < letterH; r++) {
  for (let c = 0; c < letterW; c++) {
    if (letterPattern[r][c] !== 1) continue
    for (let i = 0; i < SCALE; i++) {
      grid[1 + r * SCALE + i].fill(1, 1 + c * SCALE, 1 + c * SCALE + SCALE)
    }
  }
}

function isFilled(x, y) {
  return y >= 0 && y < n && x >= 0 && x < n && grid[y][x] === 1
}

// === BUILD TILE MAP ===

// Interior cells get random tile type, border cells get specific corners via perimeter walk
function buildTileMap() {
  const tileMap = new Map() // key: "x,y" -> corners[] (0-3)
  
  // Interior cells: type 0 uses corners [0,2], type 1 uses corners [1,3]
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (grid[y][x] === 1) {
        const t = random() < 0.5 ? 0 : 1
        tileMap.set(`${x},${y}`, [t, t + 2])
      }
    }
  }
  
  // Find any border cell to start perimeter walk
  let startX = 0, startY = 0
  outer: for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!isFilled(x, y) && (isFilled(x+1, y) || isFilled(x-1, y) || isFilled(x, y+1) || isFilled(x, y-1))) {
        startX = x; startY = y
        break outer
      }
    }
  }
  
  // Helper to add corner to tileMap
  const addCorner = (x, y, corner) => {
    const key = `${x},${y}`
    if (!tileMap.has(key)) tileMap.set(key, [])
    const corners = tileMap.get(key)
    if (!corners.includes(corner)) corners.push(corner)
  }
  
  // Walk perimeter and add border corners directly to tileMap
  let x = startX, y = startY, dir = 0, isOpen = false
  
  // Find initial direction (filled cell on right)
  for (let d = 0; d < 4; d++) {
    const r = turnRight(d)
    if (isFilled(x + edgeDx[r], y + edgeDy[r])) { dir = d; break }
  }
  const startDir = dir
  
  const visited = new Set()
  let first = true, safety = 0
  
  do {
    const rightDir = turnRight(dir)
    const atCorner = !isFilled(x + edgeDx[rightDir], y + edgeDy[rightDir])
    
    // Add border corner: skip only when at corner and not open
    if (!atCorner || isOpen) {
      addCorner(x, y, borderCorner(dir, isOpen))
    }
    if (!atCorner) isOpen = !isOpen
    
    const visitKey = `${x},${y},${dir}`
    if (visited.has(visitKey) && !first) break
    visited.add(visitKey)
    first = false
    
    // Move or turn
    if (atCorner) {
      dir = rightDir
      ;[x, y] = [x + edgeDx[rightDir], y + edgeDy[rightDir]]
    } else if (!isFilled(x + edgeDx[dir], y + edgeDy[dir])) {
      ;[x, y] = [x + edgeDx[dir], y + edgeDy[dir]]
    } else {
      dir = turnLeft(dir)
    }
  } while ((x !== startX || y !== startY || dir !== startDir) && ++safety < n * n * 4)
  
  return tileMap
}

const tileMap = buildTileMap()

// Corner c connects edges c and (c+1)%4
// Given entry edge, find exit edge for a corner
const getExitEdge = (corner, entryEdge) => entryEdge === corner ? turnRight(corner) : corner

// Find which corner in list connects to entry edge
const findConnectingCorner = (corners, entryEdge) => {
  if (!corners) return null
  // Corner c connects to edges c and (c+1)%4, i.e., c and turnRight(c)
  // So corners touching edge e are: e itself, and turnLeft(e)
  return corners.find(c => c === entryEdge || c === turnLeft(entryEdge)) ?? null
}

// Trace all closed curves
const curves = []
const visited = new Set()

for (const [key, corners] of tileMap) {
  const [tileX, tileY] = key.split(',').map(Number)
  
  for (const corner of corners) {
    if (visited.has(`${key},${corner}`)) continue
    
    const curve = []
    let x = tileX, y = tileY, c = corner
    let entryEdge = c  // arbitrary: enter from first edge of corner
    
    for (let safety = 0; safety < n * n * 4; safety++) {
      const visitKey = `${x},${y},${c}`
      if (visited.has(visitKey)) break
      
      visited.add(visitKey)
      curve.push({ x, y, corner: c, entryEdge })
      
      // Move to next cell
      const exitEdge = getExitEdge(c, entryEdge)
      const nextX = x + edgeDx[exitEdge], nextY = y + edgeDy[exitEdge]
      const nextCorners = tileMap.get(`${nextX},${nextY}`)
      const nextCorner = findConnectingCorner(nextCorners, opposite(exitEdge))
      if (nextCorner === null) break
      
      x = nextX; y = nextY
      c = nextCorner
      entryEdge = opposite(exitEdge)
    }
    
    if (curve.length > 0) curves.push(curve)
  }
}

// Sort curves by length (longest first) for nicer animations
curves.sort((a, b) => b.length - a.length)


/// ---- final drawing ----
const smoothstep = p => p * p * (3 - 2 * p)
const t = params.t
const unbuilding = t >= 0.6
const curvePhase = t < 0.4 ? smoothstep(t / 0.4)
                 : t < 0.6 ? 1
                 : 1 - smoothstep((t - 0.6) / 0.4)

// Draw corner arc with progress (0-1), direction based on entry edge
function drawCorner(corner, x, y, progress, entryEdge, reverseAnim = false) {
  const [cellX, cellY] = cellCenter(x, y)
  const p = max(0, min(1, progress))
  const cx = cornerCx[corner] * cRad
  const cy = cornerCy[corner] * cRad
  const start = cornerStart(corner)
  const reverse = entryEdge === corner  // reverse if entering from first edge
  
  begin()
  if (reverse !== reverseAnim) {
    arc(cellX + cx, cellY + cy, cRad, start + 0.25 - 0.25 * p, start + 0.25)
  } else {
    arc(cellX + cx, cellY + cy, cRad, start, start + 0.25 * p)
  }
}

// === ANIMATION ===
// Flatten curves into single arc list for simpler indexing
const allArcs = curves.flat()
const totalArcs = allArcs.length
const arcIndex = curvePhase * totalArcs

// Unified build/unbuild: compute ranges and partial arc info
const fullStart = unbuilding ? floor(totalArcs - arcIndex) + 1 : 0
const fullEnd = unbuilding ? totalArcs : floor(arcIndex)
const partialIdx = unbuilding ? floor(totalArcs - arcIndex) : floor(arcIndex)
const partialProgress = unbuilding ? 1 - ((totalArcs - arcIndex) % 1) : arcIndex % 1

// Draw completed arcs
for (let i = fullStart; i < fullEnd; i++) {
  const step = allArcs[i]
  drawCorner(step.corner, step.x, step.y, 1, step.entryEdge)
}

// Draw partial arc (currently animating)
if (partialIdx < totalArcs && partialProgress > 0) {
  const step = allArcs[partialIdx]
  drawCorner(step.corner, step.x, step.y, partialProgress, step.entryEdge, unbuilding)
}
