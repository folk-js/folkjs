// W10 SAND
// — Orion Reed

// Waffle controls where the sand is pouring and how much
// Click/drag to remove sand and walls

__loopBudget = 80000

// ----- CONFIG -----
const GRID_W = 80
const GRID_H = 80

const CELL_EMPTY = 0
const CELL_SAND = 1
const CELL_WALL = 2

// ----- HELPERS -----
function idx(x, y) {
  return x + y * GRID_W
}

function cellToClip(x, y) {
  const nx = (x + 0.5) / GRID_W
  const ny = (y + 0.5) / GRID_H
  return {
    x: denorm(nx, -1, 1),
    y: denorm(ny, -1, 1)
  }
}

function gaussianRand() {
  const u1 = rand(0, 1)
  const u2 = rand(0, 1)
  return sqrt(-2 * log(u1)) * cos(TAU * u2)
}

// ----- STATE INITIALIZATION -----
let state = window.SandWState

if (!state || state.GRID_W !== GRID_W || params.t < 0.01) {
  const cells = new Array(GRID_W * GRID_H).fill(CELL_EMPTY)
  
  const topY = floor(GRID_H)
  const bottomY = floor(GRID_H / 3)
  
  const x1 = floor(0)
  const x2 = floor(GRID_W * 0.2)
  const x3 = floor(GRID_W * 0.5)
  const x4 = floor(GRID_W * 0.8)
  const x5 = floor(GRID_W)
  
  function drawLine(x1, y1, x2, y2) {
    const dx = abs(x2 - x1)
    const dy = abs(y2 - y1)
    const steps = max(dx, dy) * 2
    
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = floor(x1 + (x2 - x1) * t)
      const y = floor(y1 + (y2 - y1) * t)
      
      if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) {
        cells[idx(x, y)] = CELL_WALL
        if (x + 1 < GRID_W) cells[idx(x + 1, y)] = CELL_WALL
      }
    }
  }
  
  drawLine(x1, bottomY, x2, topY)
  drawLine(x2, topY, x3, bottomY)
  drawLine(x3, bottomY, x4, topY)
  drawLine(x4, topY, x5, bottomY)
  
  state = {
    cells,
    GRID_W,
    GRID_H
  }
  
  window.SandWState = state
}

const cells = state.cells

// ----- SPAWN SAND -----
const qNorm = (params.q + 1) / 2
const rNorm = (params.r + 1) / 2

const spawnX = floor(qNorm * (GRID_W - 1))
const spawnRate = floor(denorm(rNorm, 0, 4))

const spreadWidth = GRID_W * 0.15

for (let n = 0; n < spawnRate; n++) {
  const gaussian = gaussianRand()
  const offset = gaussian * spreadWidth
  const sx = clamp(floor(spawnX + offset), 0, GRID_W - 1)
  const sy = 0
  
  if (cells[idx(sx, sy)] === CELL_EMPTY) {
    cells[idx(sx, sy)] = CELL_SAND
  }
}

// ----- MOUSE INTERACTION -----
const pxNorm = (params.x + 1) / 2
const pyNorm = (params.y + 1) / 2
const pxCell = floor(pxNorm * (GRID_W - 1))
const pyCell = floor(pyNorm * (GRID_H - 1))
const brushSize = 2

for (let dy = -brushSize; dy <= brushSize; dy++) {
  for (let dx = -brushSize; dx <= brushSize; dx++) {
    const x = pxCell + dx
    const y = pyCell + dy
    
    if (x >= 0 && x < GRID_W && y >= 0 && y < GRID_H) {
      if (dx * dx + dy * dy <= brushSize * brushSize) {
        if (cells[idx(x, y)] !== CELL_EMPTY) {
          cells[idx(x, y)] = CELL_EMPTY
        }
      }
    }
  }
}

// ----- UPDATE SAND -----
for (let y = GRID_H - 2; y >= 0; y--) {
  const startX = (y % 2 === 0) ? 0 : GRID_W - 1
  const endX = (y % 2 === 0) ? GRID_W : -1
  const stepX = (y % 2 === 0) ? 1 : -1
  
  for (let x = startX; x !== endX; x += stepX) {
    const i = idx(x, y)
    
    if (cells[i] !== CELL_SAND) continue
    
    if (y + 1 < GRID_H && cells[idx(x, y + 1)] === CELL_EMPTY) {
      cells[idx(x, y + 1)] = CELL_SAND
      cells[i] = CELL_EMPTY
      continue
    }
    
    const dirs = rand(0, 1) < 0.5 ? [-1, 1] : [1, -1]
    
    for (const dir of dirs) {
      const nx = x + dir
      if (nx >= 0 && nx < GRID_W && y + 1 < GRID_H) {
        if (cells[idx(nx, y + 1)] === CELL_EMPTY) {
          cells[idx(nx, y + 1)] = CELL_SAND
          cells[i] = CELL_EMPTY
          break
        }
      }
    }
  }
}

// ----- RENDER -----
const cellSize = 2 / GRID_W
const sandR = cellSize * 0.3
const wallR = cellSize * 0.35

// Set to true to show walls for debugging
const showWalls = false

for (let y = 0; y < GRID_H; y++) {
  for (let x = 0; x < GRID_W; x++) {
    const cell = cells[idx(x, y)]
    
    if (cell === CELL_EMPTY) continue
    if (cell === CELL_WALL && !showWalls) continue
    
    const pos = cellToClip(x, y)
    const r = cell === CELL_WALL ? wallR : sandR
    
    circle(pos.x, pos.y, r)
  }
}