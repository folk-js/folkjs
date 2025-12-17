// GRAPH LAYOUT - Fruchterman-Reingold "S"
// — Orion Reed

// ==== GRAPH STRUCTURE ====
const NODE_COUNT = 50
const SKELETON_POINTS = 12
const S_WIDTH = 1       // Width of S curve
const S_HEIGHT = 2      // Height of S curve
const TUBE_WIDTH = 0.2    // Width of the S-shaped tube
const STRUCTURAL_EDGE_COUNT = 2

// ==== ALGORITHM PARAMETERS ====
const K = 0.05 + 0.15 * params.t            // Optimal distance between nodes (small for planar graph)
const DEGREE_INFLUENCE = 0.3                // How much node degree affects repulsion (0 = all equal, 1 = strong hierarchy)
const ITERATIONS = 2       // Iterations per frame for smooth animation
const INITIAL_TEMP = 0.3   // Lower initial temp for subtle adjustments
const COOLING_FACTOR = 0.99
const MIN_TEMP = 0.005

// ==== CUSTOM FORCE WEIGHTS ====
const BOUNDARY_STRENGTH = 5
const STRUCTURAL_EDGE_STRENGTH = 0.2 * (1+params.q)  // Multiplier for structural edge attraction (vs normal edges)
const VERTICAL_BIAS_STRENGTH = 0.05   // Force to keep nodes at their initial vertical position
const SHOW_SKELETON = false // Set to true to see anchor points

// ==== HELPER FUNCTIONS ====

function generateSCurve(numPoints) {
  const points = []
  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1)
    
    // S curve using double sine wave
    const x = sin((t * 2 - 1) * PI) * S_WIDTH
    const y = (t - 0.5) * S_HEIGHT
    
    points.push({ x, y })
  }
  return points
}

function createGraph(numNodes) {
  const nodes = []
  
  // Create nodes along the S curve with some width (like a tube)
  // We'll place them in a way that follows the curve progression
  for (let i = 0; i < numNodes; i++) {
    const t = i / (numNodes - 1) // 0 to 1 along the curve
    
    // Get position on S curve
    const curveX = sin((t * 2 - 1) * PI) * S_WIDTH
    const curveY = (t - 0.5) * S_HEIGHT
    
    // Add perpendicular offset for tube width
    // Calculate tangent direction
    const dt = 0.01
    const nextX = sin(((t + dt) * 2 - 1) * PI) * S_WIDTH
    const nextY = ((t + dt) - 0.5) * S_HEIGHT
    const tangentX = nextX - curveX
    const tangentY = nextY - curveY
    const tangentLen = sqrt(tangentX * tangentX + tangentY * tangentY)
    
    // Perpendicular is (-tangentY, tangentX) normalized
    const perpX = -tangentY / tangentLen
    const perpY = tangentX / tangentLen
    
    // Random offset perpendicular to curve
    const offset = rand(-TUBE_WIDTH, TUBE_WIDTH)
    
    nodes.push({
      x: curveX + perpX * offset,
      y: curveY + perpY * offset,
      fx: 0,
      fy: 0,
      fixed: false,
      curvePosition: t, // Track position along curve for connectivity
      targetY: curveY + perpY * offset // Store initial Y for vertical bias
    })
  }
  
  // Create planar edges by connecting nearby nodes in curve order
  const edges = []
  
  for (let i = 0; i < numNodes; i++) {
    // Connect to next node in sequence (main chain)
    if (i < numNodes - 1) {
      edges.push({ source: i, target: i + 1, type: 'normal' })
    }
    
    // Connect to nodes 2-4 steps ahead (skip connections for variety)
    for (let offset = 2; offset <= 4; offset++) {
      const target = i + offset
      if (target < numNodes && rand() < 0.3) { // 30% chance
        edges.push({ source: i, target: target, type: 'normal' })
      }
    }
    
    // Occasionally connect to nearby nodes with similar curve position
    if (rand() < 0.2 && i > 2 && i < numNodes - 2) {
      const lookback = floor(rand(1, 4))
      const target = i - lookback
      if (target >= 0) {
        // Only connect if close enough in space to maintain planarity
        const dx = nodes[i].x - nodes[target].x
        const dy = nodes[i].y - nodes[target].y
        const dist = sqrt(dx * dx + dy * dy)
        if (dist < 0.2) {
          edges.push({ source: i, target: target, type: 'normal' })
        }
      }
    }
  }
  
  // Add structural edges: tie ends to middle to prevent stretching
  const topThird = floor(numNodes * 0.15)  // Top of S
  const middleStart = floor(numNodes * 0.4)
  const middleEnd = floor(numNodes * 0.6)
  const bottomThird = floor(numNodes * 0.85) // Bottom of S
  
  // Connect top to middle (2-3 connections)
  for (let i = 0; i < 2; i++) {
    const topNode = floor(rand(0, topThird))
    const midNode = floor(rand(middleStart, middleEnd))
    edges.push({ source: topNode, target: midNode, type: 'structural' })
  }
  
  // Connect bottom to middle (2-3 connections)
  for (let i = 0; i < STRUCTURAL_EDGE_COUNT; i++) {
    const bottomNode = floor(rand(bottomThird, numNodes))
    const midNode = floor(rand(middleStart, middleEnd))
    edges.push({ source: bottomNode, target: midNode, type: 'structural' })
  }
  
  // Calculate node degrees (number of connections)
  for (let node of nodes) {
    node.degree = 0
  }
  for (let edge of edges) {
    nodes[edge.source].degree++
    nodes[edge.target].degree++
  }
  
  return { nodes, edges }
}

// ==== STATE INITIALIZATION ====
// Detect loop: when params.t goes backward (loops), re-randomize
if (!params.s.graph || params.t < (params.s.currentT || 0)) {
  params.s.skeleton = generateSCurve(SKELETON_POINTS) // For debug visualization
  params.s.graph = createGraph(NODE_COUNT)
  params.s.temperature = INITIAL_TEMP
}

// Store current t for next frame
params.s.currentT = params.t

const { graph, skeleton, temperature } = params.s

// ==== FRUCHTERMAN-REINGOLD ALGORITHM ====

// Attractive force (for connected nodes)
function f_a(distance, k) {
  return (distance * distance) / k
}

// Repulsive force (for all node pairs)
function f_r(distance, k) {
  return (k * k) / distance
}

// Run multiple iterations per frame
for (let iter = 0; iter < ITERATIONS; iter++) {
  // Reset forces
  for (let node of graph.nodes) {
    node.fx = 0
    node.fy = 0
  }
  
  // 1. REPULSIVE FORCES (all pairs)
  // Calculate average degree for scaling
  let avgDegree = 0
  for (let node of graph.nodes) {
    avgDegree += node.degree || 1
  }
  avgDegree /= graph.nodes.length
  
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      const v = graph.nodes[i]
      const u = graph.nodes[j]
      
      const dx = v.x - u.x
      const dy = v.y - u.y
      const dist = sqrt(dx * dx + dy * dy) || 0.01
      
      // Scale repulsion by node degree (highly connected nodes repel more)
      const vDegreeScale = 1 + ((v.degree || 1) / avgDegree - 1) * DEGREE_INFLUENCE
      const uDegreeScale = 1 + ((u.degree || 1) / avgDegree - 1) * DEGREE_INFLUENCE
      const degreeScale = (vDegreeScale + uDegreeScale) / 2
      
      const repulsion = f_r(dist, K) * degreeScale
      const fx = (dx / dist) * repulsion
      const fy = (dy / dist) * repulsion
      
      v.fx += fx
      v.fy += fy
      u.fx -= fx
      u.fy -= fy
    }
  }
  
  // 2. ATTRACTIVE FORCES (edges only)
  for (let edge of graph.edges) {
    const v = graph.nodes[edge.source]
    const u = graph.nodes[edge.target]
    
    // Safety check: skip if either node is undefined
    if (!v || !u) continue
    
    const dx = v.x - u.x
    const dy = v.y - u.y
    const dist = sqrt(dx * dx + dy * dy) || 0.01
    
    const attraction = f_a(dist, K)
    
    // Apply different strength for structural edges
    const strength = edge.type === 'structural' ? STRUCTURAL_EDGE_STRENGTH : 1.0
    const fx = (dx / dist) * attraction * strength
    const fy = (dy / dist) * attraction * strength
    
    v.fx -= fx
    v.fy -= fy
    u.fx += fx
    u.fy += fy
  }
  
  // 3. VERTICAL BIAS (stretching force to keep S upright)
  // Nodes above center get pulled up, nodes below get pulled down
  for (let node of graph.nodes) {
    // targetY is the original distance from center - use it as the force direction
    node.fy += node.targetY * VERTICAL_BIAS_STRENGTH
  }
  
  // 4. BOUNDARY FORCES (soft AABB constraint, bounds are -1 to 1)
  for (let node of graph.nodes) {
    if (node.x < -1) {
      node.fx += (-1 - node.x) * BOUNDARY_STRENGTH
    } else if (node.x > 1) {
      node.fx += (1 - node.x) * BOUNDARY_STRENGTH
    }
    
    if (node.y < -1) {
      node.fy += (-1 - node.y) * BOUNDARY_STRENGTH
    } else if (node.y > 1) {
      node.fy += (1 - node.y) * BOUNDARY_STRENGTH
    }
  }
  
  // 5. APPLY FORCES with temperature-based displacement limiting
  for (let node of graph.nodes) {
    if (node.fixed) continue
    
    const disp = sqrt(node.fx * node.fx + node.fy * node.fy) || 0.01
    
    // Limit displacement by temperature
    const cappedDisp = min(disp, params.s.temperature)
    
    node.x += (node.fx / disp) * cappedDisp
    node.y += (node.fy / disp) * cappedDisp
  }
  
  // Cool down temperature
  params.s.temperature = max(
    MIN_TEMP,
    params.s.temperature * COOLING_FACTOR
  )
}

// ==== RENDERING ====

// Draw edges
for (let edge of graph.edges) {
  const v = graph.nodes[edge.source]
  const u = graph.nodes[edge.target]
  
  // Safety check: skip if either node is undefined
  if (!v || !u) continue
  
  if (edge.type === 'normal') {
    // Solid line
    begin()
    line(v.x, v.y)
    line(u.x, u.y)
  } else if (edge.type === 'structural') {
    // Dotted line
    const segments = 10
    for (let i = 0; i < segments; i++) {
      if (i % 2 === 0) { // Only draw even segments for dashed effect
        const t1 = i / segments
        const t2 = (i + 1) / segments
        const x1 = v.x + (u.x - v.x) * t1
        const y1 = v.y + (u.y - v.y) * t1
        const x2 = v.x + (u.x - v.x) * t2
        const y2 = v.y + (u.y - v.y) * t2
        
        begin()
        line(x1, y1)
        line(x2, y2)
      }
    }
  }
}

// Draw nodes (filled circles)
for (let node of graph.nodes) {
  begin(true)
  circle(node.x, node.y, 0.02)
}

// Draw skeleton (small dots, optional debug view)
if (SHOW_SKELETON) {
  for (let point of skeleton) {
    begin(true)
    circle(point.x, point.y, 0.008)
  }
}