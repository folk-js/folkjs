// K12 METABALLS

// ---------- settings ----------
const slowTime = period('k12_slowPeriod', params.t, 3)
const animTime = cosLoop(slowTime)
const wobbleAmplitude = 0.05
const wobbleFrequency = 10.0 + params.r * 2.0
const thresholdLow = 1+(2*norm(params.r))
const thresholdHigh = thresholdLow+0.5
const ballRadius = 0.08 + (0.05*norm(params.q))

const verticalBalls = 10
const upperDiagonalBalls = 7
const lowerDiagonalBalls = 8
const minSpacing = 0.25  

function cosLoop(t) {
  return 0.5 - 0.5 * cos(2 * PI * t)
}

// ------------------------------------------------

const MAX_BALLS = 200  
const numBalls = verticalBalls + upperDiagonalBalls + lowerDiagonalBalls

let state = globalThis.k12

const tenfoldCanvas = document.querySelector("canvas")
const ctx = tenfoldCanvas.getContext("2d")

if (!state) {
  const offscreenCanvas = document.createElement("canvas")
  const gl = offscreenCanvas.getContext("webgl2")
  
  if (!gl) {
    state = { error: true }
    globalThis.k12 = state
  } else {
    const vertexShaderSource = `#version 300 es
      in vec2 position;
      out vec2 vPos;
      
      void main() {
        vPos = position;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;
    
    const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 vPos;
out vec4 fragColor;

uniform float time;
uniform vec3 balls[${MAX_BALLS}];
uniform int numBalls;
uniform float thresholdLow;
uniform float thresholdHigh;

float metaball(vec2 p, vec2 center, float radius) {
  float dist = distance(p, center);
  if (dist < 0.0001) return 1000.0;
  return (radius * radius) / (dist * dist);
}

void main() {
  vec2 p = vPos;
  
  float sum = 0.0;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= numBalls) break;
    if (balls[i].z > 0.0) {
      sum += metaball(p, balls[i].xy, balls[i].z);
    }
  }
  
  float alpha = 0.0;
  if (sum > thresholdLow && sum < thresholdHigh) {
    alpha = 1.0;
  }
  
  vec3 color = vec3(1.0);
  fragColor = vec4(color, alpha);
}
`;

    const vertexShader = gl.createShader(gl.VERTEX_SHADER)
    gl.shaderSource(vertexShader, vertexShaderSource)
    gl.compileShader(vertexShader)
    
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)
    gl.shaderSource(fragmentShader, fragmentShaderSource)
    gl.compileShader(fragmentShader)
    
    const program = gl.createProgram()
    gl.attachShader(program, vertexShader)
    gl.attachShader(program, fragmentShader)
    gl.linkProgram(program)
    
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    
    const timeLoc = gl.getUniformLocation(program, "time")
    const ballsLoc = gl.getUniformLocation(program, "balls")
    const numBallsLoc = gl.getUniformLocation(program, "numBalls")
    const thresholdLowLoc = gl.getUniformLocation(program, "thresholdLow")
    const thresholdHighLoc = gl.getUniformLocation(program, "thresholdHigh")
    const positionLoc = gl.getAttribLocation(program, "position")
    
    state = {
      offscreenCanvas,
      gl,
      program,
      buffer,
      timeLoc,
      ballsLoc,
      numBallsLoc,
      thresholdLowLoc,
      thresholdHighLoc,
      positionLoc,
      error: false
    }
    
    globalThis.k12 = state
  }
}

if (state && state.error) {
  text("WebGL2 not available", 0, 0, 0.2)
} else if (state) {
  queueMicrotask(() => {
    const {
      offscreenCanvas,
      gl,
      program,
      buffer,
      timeLoc,
      ballsLoc,
      numBallsLoc,
      thresholdLowLoc,
      thresholdHighLoc,
      positionLoc
    } = state
    
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    
    const tileX = Math.floor(tenfoldCanvas.width * 2 / 3)
    const tileY = 0
    const tileW = Math.floor(tenfoldCanvas.width / 3)
    const tileH = Math.floor(tenfoldCanvas.height / 4)
    
    if (offscreenCanvas.width !== tileW || offscreenCanvas.height !== tileH) {
      offscreenCanvas.width = tileW
      offscreenCanvas.height = tileH
      gl.viewport(0, 0, tileW, tileH)
    }
    
    
    const ballPositions = new Float32Array(MAX_BALLS * 3)
    let ballIndex = 0
    
    for (let i = 0; i < verticalBalls; i++) {
      const t = i / (verticalBalls - 1)
      const phase = ballIndex * 0.713  // phase based on index
      const wiggleX = sin((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase) * wobbleFrequency * 2) * wobbleAmplitude
      const wiggleY = cos((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase * 1.3) * wobbleFrequency * 1.5) * wobbleAmplitude
      
      ballPositions[ballIndex * 3] = -0.6 + wiggleX
      ballPositions[ballIndex * 3 + 1] = -0.7 + 1.4 * t + wiggleY
      ballPositions[ballIndex * 3 + 2] = ballRadius
      ballIndex++
    }
    
    // Upper diagonal
    const upperDiagLength = Math.sqrt(1.2*1.2 + 0.7*0.7)
    const upperStart = minSpacing / upperDiagLength
    for (let i = 0; i < upperDiagonalBalls; i++) {
      const t = upperStart + (1 - upperStart) * (i / (upperDiagonalBalls - 1))
      const phase = ballIndex * 0.7
      const wiggleX = sin((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase) * wobbleFrequency * 2) * wobbleAmplitude
      const wiggleY = cos((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase * 1.3) * wobbleFrequency * 1.5) * wobbleAmplitude
      
      ballPositions[ballIndex * 3] = -0.6 + 1.2 * t + wiggleX
      ballPositions[ballIndex * 3 + 1] = 0 - 0.7 * t + wiggleY
      ballPositions[ballIndex * 3 + 2] = ballRadius
      ballIndex++
    }
    
    // Lower diagonal
    const lowerStart = minSpacing / upperDiagLength
    for (let i = 0; i < lowerDiagonalBalls; i++) {
      const t = lowerStart + (1 - lowerStart) * (i / (lowerDiagonalBalls - 1))
      const phase = ballIndex * 0.7
      const wiggleX = sin((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase) * wobbleFrequency * 2) * wobbleAmplitude
      const wiggleY = cos((animTime * (0.8 + (ballIndex % 5) * 0.1) + phase * 1.3) * wobbleFrequency * 1.5) * wobbleAmplitude
      
      ballPositions[ballIndex * 3] = -0.6 + 1.2 * t + wiggleX
      ballPositions[ballIndex * 3 + 1] = 0 + 0.7 * t + wiggleY
      ballPositions[ballIndex * 3 + 2] = ballRadius
      ballIndex++
    }
    
    gl.useProgram(program)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    
    gl.uniform1f(timeLoc, animTime)
    gl.uniform1i(numBallsLoc, numBalls)
    gl.uniform1f(thresholdLowLoc, thresholdLow)
    gl.uniform1f(thresholdHighLoc, thresholdHigh)
    gl.uniform3fv(ballsLoc, ballPositions)
    
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)
    
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    
    ctx.drawImage(offscreenCanvas, tileX, tileY, tileW, tileH)
    
    ctx.restore()
  })
}

/** Util: Create a looping value with a different period than params.t */
function period(key, t, cycles) {
  if (!globalThis[key]) {
    globalThis[key] = { lastT: t, counter: 0 }
  }
  
  const state = globalThis[key]
  
  // Detect if t has looped (went from high to low)
  if (t < state.lastT) {
    state.counter++
  }
  
  state.lastT = t
  
  // Calculate position within the extended period
  const totalProgress = (state.counter % cycles) + t
  return totalProgress / cycles
}