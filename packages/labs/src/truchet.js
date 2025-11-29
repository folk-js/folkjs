// SMITH TILES S16
// - Orion Reed

// Use params.q to control scale from 1 to 6
const SCALE = floor(denorm((params.q + 1) / 2, 1, 6))
const PERIMETER = false

// 9 letter patterns in a 3x3 grid controlled by x/y
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

// Select pattern based on params.x and params.y
// x,y range from -1 to 1, map to 3x3 grid
const BORDER = 1
const patternX = min(floor((params.x + 1) / 2 * 3), 2)
const patternY = min(floor((params.y + 1) / 2 * 3), 2)
const patternIdx = patternY * 3 + patternX
const letterPattern = letterPatterns[patternIdx]
const letterH = letterPattern.length
const letterW = letterPattern[0].length
const maxDim = max(letterH, letterW)
const n = letterH * SCALE + BORDER * 2
const nMax = maxDim * SCALE + BORDER * 2
const cSize = 2 / nMax
const cRad = cSize / 2

const offsetX = ((maxDim - letterW) * SCALE * cSize) / 2
const offsetY = ((maxDim - letterH) * SCALE * cSize) / 2


// Loop detection - change seed each cycle
if (!params.s.loopState) {
  params.s.loopState = { lastT: params.t, loopCount: 0 }
}

// Detect if t has looped (went from high to low)
if (params.t < params.s.loopState.lastT) {
  params.s.loopState.loopCount++
}
params.s.loopState.lastT = params.t

// rng - seed changes with each loop
let seed = 232 + params.s.loopState.loopCount * 12345

// rng
function random() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

// cell geometry helper
function cellCenter(x, y) {
  return [-1 + x * cSize + cRad + offsetX, -1 + y * cSize + cRad + offsetY]
}

function box(x, y) {
  const [cx, cy] = cellCenter(x, y)
  begin()
  rect(cx - cRad, cy - cRad, cRad * 2, cRad * 2)
}

function dir(x, y, dir = null) {
  const [cx, cy] = cellCenter(x, y)
  begin()
  rect(cx - cRad, cy - cRad, cRad * 2, cRad * 2)

  switch (dir) {
    case null:
      circle(cx, cy, 0.01)
      break
    case "UP":
      line(cx, cy)
      line(cx, cy - cRad)
      break
    case "RIGHT":
      line(cx, cy)
      line(cx + cRad, cy)
      break
    case "DOWN":
      line(cx, cy)
      line(cx, cy + cRad)
      break
    case "LEFT":
      line(cx, cy)
      line(cx - cRad, cy)
      break
  }
}

function a1(x, y) {
  const [cx, cy] = cellCenter(x, y)
  begin(); arc(cx + cRad, cy - cRad, cRad, 0.25, 0.5)
}

function a2(x, y) {
  const [cx, cy] = cellCenter(x, y)
  begin(); arc(cx - cRad, cy + cRad, cRad, 0.75, 1.0)
}

function b1(x, y) {
  const [cx, cy] = cellCenter(x, y)
  begin(); arc(cx - cRad, cy - cRad, cRad, 0.0, 0.25)
}

function b2(x, y) {
  const [cx, cy] = cellCenter(x, y)
  begin(); arc(cx + cRad, cy + cRad, cRad, 0.5, 0.75)
}

function a(x, y) { a1(x, y); a2(x, y) }
function b(x, y) { b1(x, y); b2(x, y) }

// build 0/1 grid with scaling + 1-cell empty border
const grid = Array.from({ length: n }, () => Array(n).fill(0))

for (let r = 0; r < letterH; r++) {
  for (let c = 0; c < letterW; c++) {
    if (letterPattern[r][c] !== 1) continue

    const rowStart = BORDER + r * SCALE
    const colStart = BORDER + c * SCALE

    for (let i = 0; i < SCALE; i++) {
      grid[rowStart + i].fill(1, colStart, colStart + SCALE)
    }
  }
}

// Direction vectors: UP, RIGHT, DOWN, LEFT
const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]]
const dirNames = ["UP", "RIGHT", "DOWN", "LEFT"]

function isFilled(x, y) {
  return y >= 0 && y < n && x >= 0 && x < n && grid[y][x] === 1
}

function findRandomStartCell() {
  const candidates = []
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!isFilled(x, y) && (isFilled(x+1, y) || isFilled(x-1, y) || isFilled(x, y+1) || isFilled(x, y-1))) {
        candidates.push([x, y])
      }
    }
  }
  return candidates[Math.floor(random() * candidates.length)] || [0, 0]
}

const startCell = findRandomStartCell()

function walkPerimeter(startX, startY) {
  const perimeter = []
  let x = startX, y = startY, dir = 0
  
  // Find initial direction (filled cell on right)
  for (let d = 0; d < 4; d++) {
    const [rdx, rdy] = dirs[(d + 1) % 4]
    if (isFilled(x + rdx, y + rdy)) { dir = d; break }
  }
  
  const visited = new Set()
  let first = true
  
  do {
    // Check if we can turn right (outer corner)
    const [rdx, rdy] = dirs[(dir + 1) % 4]
    const isCorner = !isFilled(x + rdx, y + rdy)
    
    perimeter.push({
      x, y, 
      filledCell: [x + rdx, y + rdy],
      direction: dirNames[dir],
      corner: isCorner
    })
    
    const key = `${x},${y},${dir}`
    if (visited.has(key) && !first) break
    visited.add(key)
    first = false
    
    // Move or turn
    if (isCorner) {
      dir = (dir + 1) % 4  // Turn right
      ;[x, y] = [x + rdx, y + rdy]
    } else {
      const [dx, dy] = dirs[dir]
      if (!isFilled(x + dx, y + dy)) {
        ;[x, y] = [x + dx, y + dy]  // Go straight
      } else {
        dir = (dir + 3) % 4  // Turn left
      }
    }
    
    if (perimeter.length > n * n * 4) break
  } while (x !== startX || y !== startY || dir !== 0)
  
  return perimeter
}

function buildBorderCells(perimeter) {
  const tiles = {
    closed: { UP: "b2", RIGHT: "a2", DOWN: "b1", LEFT: "a1" },
    open:   { UP: "a1", RIGHT: "b2", DOWN: "a2", LEFT: "b1" }
  }
  
  const borderCells = []
  let isOpen = false
  
  // Skip last cell if same as first
  const len = perimeter.length
  const lastIdx = (len > 1 && perimeter[0].x === perimeter[len-1].x && perimeter[0].y === perimeter[len-1].y) ? len - 1 : len
  
  for (let i = 0; i < lastIdx; i++) {
    const c = perimeter[i]
    
    if (c.corner && isOpen) {
      borderCells.push({ x: c.x, y: c.y, type: tiles.closed[c.direction], closed: true })
    } else if (!c.corner) {
      const closed = isOpen
      borderCells.push({ 
        x: c.x, y: c.y, 
        type: tiles[closed ? 'closed' : 'open'][c.direction], 
        closed 
      })
      isOpen = !isOpen
    }
  }
  
  return borderCells
}

const perimeterCells = walkPerimeter(startCell[0], startCell[1])
const borderCells = buildBorderCells(perimeterCells)





/// ---- final drawing bits, will animate.. ----

const t = params.t

// === PHASES ===
const phase = (1 - cos(t * TAU)) / 2

// Phase 1: 0/1 grid cells come in randomly (phase 0 → 0.2)
const gridPhaseStart = 0.0
const gridPhaseEnd = 0.2

// Phase 2: perimeter cells (phase 0.2 → 0.8)
const perimPhaseStart = PERIMETER ? 0.25 : 1
const perimPhaseEnd = PERIMETER ? 0.5 : 1

const borderPhaseStart = PERIMETER ? 0.35 : 0.2
const borderPhaseEnd = 0.8

// Helper: clamp a value between 0 and 1
function cnorm(value, start, end) {
  return max(0, min(1, (value - start) / (end - start)))
}

// === PHASE 1: 0/1 GRID with random reveals ===
const gridPhase = cnorm(phase, gridPhaseStart, gridPhaseEnd)

// Generate random reveal order for grid cells (stable)
const gridCells = []
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; x++) {
    if (grid[y][x] === 1) {
      gridCells.push({ x, y, order: random() })
    }
  }
}
gridCells.sort((a, b) => a.order - b.order)

// Draw grid cells that have been revealed
const numGridCells = floor(gridPhase * gridCells.length)
for (let i = 0; i < numGridCells; i++) {
  const cell = gridCells[i]
  ;(random() < 0.5 ? a : b)(cell.x, cell.y)
}

// === PHASE 2 & 3: PERIMETER → BORDER TRANSITION ===
const perimPhase = cnorm(phase, perimPhaseStart, perimPhaseEnd)
const borderPhase = cnorm(phase, borderPhaseStart, borderPhaseEnd)

// Calculate how many cells to show
const numPerimCells = floor(perimPhase * perimeterCells.length)
const numBorderCells = floor(borderPhase * borderCells.length)

// Calculate what fraction of perimeter should be replaced by border
// When border is fully revealed (borderPhase=1), all perimeter should be replaced
const replaceRatio = borderPhase

// Show perimeter cells (these will be replaced by border)
for (let i = 0; i < numPerimCells; i++) {
  const c = perimeterCells[i]
  
  // Fade out perimeter based on how much of it should be replaced
  // If we're at position i out of numPerimCells, and border has progressed replaceRatio,
  // we should hide this cell if i/numPerimCells < replaceRatio
  const cellRatio = i / perimeterCells.length
  const shouldFade = cellRatio < replaceRatio
  
  if (!shouldFade) {
    box(c.x, c.y)
    if (c.corner) dir(c.x, c.y, null)
    else dir(c.x, c.y, c.direction)
  }
}

// Show border cells (these replace perimeter)
for (let i = 0; i < numBorderCells; i++) {
  const c = borderCells[i]
  switch (c.type) {
    case "a1": a1(c.x, c.y); break
    case "a2": a2(c.x, c.y); break
    case "b1": b1(c.x, c.y); break
    case "b2": b2(c.x, c.y); break
  }
}


