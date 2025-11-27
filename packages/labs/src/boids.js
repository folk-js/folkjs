// BOIDS-N04
// By Orion Reed

// waffle x = number of boids
// waffle y = how far a boid can 'see'
// click/drag to have the boids fly away

// Forks are encouraged! I'm sure the parameters can be better.
// There's definitely ways to make this a lot faster too
// If you manage to get the loop budget down to its default of 10K
// with the waffle.x at 50% then I'll buy you a coffee/beer :)

__loopBudget = 70000

const numBoids = floor(denorm((params.q + 1) / 2, 80, 300))
const visualRange = denorm((params.r + 1) / 2, 0.12, 0.3)
const separationWeight = 0.01
const alignmentWeight = 0.01
const cohesionWeight = 0.005
const boundaryWeight = 0.002
const speedLimit = 0.008
const fleeWeight = 0.3
const fleeRadius = 0.5
const boidSize = 0.02
const homeWeight = 0.001
const wandererRatio = 0.3

// Precomputed bits
const separationDist = visualRange * 0.35
const visualRangeSq = visualRange * visualRange
const separationDistSq = separationDist * separationDist
const fleeRadiusSq = fleeRadius * fleeRadius

const shape = [
  {x: -1, y: -1}, {x: -0.75, y: -1}, {x: 0.75, y: 0.6}, {x: 0.75, y: -1},
  {x: 1, y: -1}, {x: 1, y: 1}, {x: 0.75, y: 1}, {x: -0.75, y: -0.6},
  {x: -0.75, y: 1}, {x: -1, y: 1},
]

function dist(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return sqrt(dx * dx + dy * dy)
}

function distSq(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function sub(a, b) { return {x: a.x - b.x, y: a.y - b.y} }
function add(a, b) { return {x: a.x + b.x, y: a.y + b.y} }
function mulS(a, s) { return {x: a.x * s, y: a.y * s} }
function divS(a, s) { return {x: a.x / s, y: a.y / s} }
function len(a) { return sqrt(a.x * a.x + a.y * a.y) }
function normalize(a) { 
  const l = len(a)
  return l > 0 ? divS(a, l) : {x: 0, y: 0} 
}

function isInPoly(point, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const intersects =
      ((a.y > point.y) !== (b.y > point.y)) &&
      point.x <= ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

function closestPointOnPoly(point, poly) {
  let closest = null
  let minDistSq = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ab = sub(b, a)
    const ap = sub(point, a)
    const abLenSq = ab.x * ab.x + ab.y * ab.y
    if (abLenSq === 0) continue
    let t = (ap.x * ab.x + ap.y * ab.y) / (abLenSq)
    t = clamp(t, 0, 1)
    const projected = add(a, mulS(ab, t))
    const dx = point.x - projected.x
    const dy = point.y - projected.y
    const dSq = dx * dx + dy * dy
    if (dSq < minDistSq) {
      minDistSq = dSq
      closest = projected
    }
  }
  return { point: closest, dist: sqrt(minDistSq) }
}

function randomPointInShape() {
  let x, y, attempts = 0
  do {
    x = rand()
    y = rand()
    attempts++
  } while (!isInPoly({x, y}, shape) && attempts < 100)
  return {x, y}
}

// @tenfold crew... maybe a lil sprinking of input
// is something we want for real?
if (!window.n04PointerSetup) {
  window.n04PointerDown = false
  window.addEventListener('pointerdown', () => { window.n04PointerDown = true })
  window.addEventListener('pointerup', () => { window.n04PointerDown = false })
  window.addEventListener('pointercancel', () => { window.n04PointerDown = false })
  window.addEventListener('pointerleave', () => { window.n04PointerDown = false })
  window.n04PointerSetup = true
}

let state = window.n04
if (!state || state.numBoids !== numBoids || params.t <= 0.01) {
  const boids = []
  for (let i = 0; i < numBoids; i++) {
    const home = randomPointInShape()
    const angle = rand(0, TAU)
    boids.push({
      x: home.x,
      y: home.y,
      vx: cos(angle) * 0.003,
      vy: sin(angle) * 0.003,
      home,
      isWanderer: i < numBoids * wandererRatio,
      wanderAngle: rand(0, TAU)
    })
  }
  state = { boids, numBoids }
  window.n04 = state
}

const boids = state.boids
const n = boids.length
const pointerDown = window.n04PointerDown
const mouse = pointerDown ? {x: params.x, y: params.y} : null

for (let i = 0; i < n; i++) {
  const boid = boids[i]
  let separation = {x: 0, y: 0}
  let alignment = {x: 0, y: 0}
  let cohesion = {x: 0, y: 0}
  let neighbors = 0
  
  for (let j = 0; j < n; j++) {
    if (i === j) continue
    const other = boids[j]

    const dSq = distSq(boid, other)
    if (dSq === 0 || dSq > visualRangeSq) continue

    // behaviour: alignment
    const d = sqrt(dSq)
    neighbors++
    alignment.x += other.vx
    alignment.y += other.vy
    cohesion.x += other.x
    cohesion.y += other.y
    if (dSq < separationDistSq) {
      const diff = sub(boid, other)
      const factor = 1 - (d / separationDist)
      separation = add(separation, mulS(normalize(diff), factor))
    }
  }

  // behaviour: cohesion
  if (neighbors > 0) {
    alignment = divS(alignment, neighbors)
    alignment = mulS(sub(alignment, {x: boid.vx, y: boid.vy}), alignmentWeight)
    cohesion = divS(cohesion, neighbors)
    cohesion = mulS(sub(cohesion, boid), cohesionWeight)
    separation = mulS(separation, separationWeight)
  }

  // behaviour: boundary avoidance
  let boundary = {x: 0, y: 0}
  const inside = isInPoly(boid, shape)
  if (!inside) {
    const edgeInfo = closestPointOnPoly(boid, shape)
    if (edgeInfo.dist > 0.06) {
      const toInside = sub(edgeInfo.point, boid)
      boundary = mulS(
        normalize(toInside),
        boundaryWeight * (1 + (edgeInfo.dist - 0.06) * 8)
      )
    }
  }

  // behaviour: Boid wanna go home
  // this helps keep the more evenly spread out in the "N" 
  let home = {x: 0, y: 0}
  const homeDist = dist(boid, boid.home)
  if (boid.isWanderer) {
    boid.wanderAngle += rand(-0.1, 0.1)
    home = add(
      {x: cos(boid.wanderAngle) * 0.002, y: sin(boid.wanderAngle) * 0.002},
      mulS(sub(boid.home, boid), homeWeight * 0.3)
    )
  } else {
    home = mulS(sub(boid.home, boid), homeWeight * (1 + homeDist * 2))
  }

  // behaviour: run away from your mouse when you click
  let flee = {x: 0, y: 0}
  if (mouse) {
    const mouseDistSq = distSq(boid, mouse)
    if (mouseDistSq < fleeRadiusSq && mouseDistSq > 0) {
      const mouseDist = sqrt(mouseDistSq)
      const dir = sub(boid, mouse)
      flee = mulS(
        normalize(dir),
        fleeWeight * (1 - mouseDist / fleeRadius)
      )
    }
  }
  
  boid.vx += separation.x + alignment.x + cohesion.x + boundary.x + flee.x + home.x
  boid.vy += separation.y + alignment.y + cohesion.y + boundary.y + flee.y + home.y
  
  const maxSpeed = boid.isWanderer ? speedLimit * 1.3 : speedLimit
  const speed = len({x: boid.vx, y: boid.vy})
  if (speed > maxSpeed) {
    boid.vx = (boid.vx / speed) * maxSpeed
    boid.vy = (boid.vy / speed) * maxSpeed
  }
  
  boid.x += boid.vx
  boid.y += boid.vy
}

for (const boid of boids) {
  const angle = atan2(boid.vy, boid.vx)
  const tip = {x: boid.x + cos(angle) * boidSize, y: boid.y + sin(angle) * boidSize}
  const left = {x: boid.x + cos(angle + 2.5) * boidSize * 0.6, y: boid.y + sin(angle + 2.5) * boidSize * 0.6}
  const right = {x: boid.x + cos(angle - 2.5) * boidSize * 0.6, y: boid.y + sin(angle - 2.5) * boidSize * 0.6}
  begin()
  move(tip.x, tip.y)
  line(left.x, left.y)
  line(right.x, right.y)
  line(tip.x, tip.y)
}

// DEBUG: uncomment to see letter outline
// begin()
// for (const pt of shape) line(pt.x, pt.y)
// line(shape[0].x, shape[0].y)

