// H11 HEAT
// — Orion Reed

text("h", 0, 0, 0.5 * cosLoop(params.t)+1.5)

// ---------- settings ----------
const amp   = (0.1 + params.y) * cosLoop(params.t)
const speed = 2.0
const scale = (4 + 4*params.x) * cosLoop(params.t)
const colorPhase = params.t
const colorScale = 6 
const colorStrength = 1.0 

function cosLoop(t) {
  return 0.5 - 0.5 * cos(2 * PI * t)
}

// ------------------------------------------------

let state = window.h11

// Get the Tenfold canvas
const tenfoldCanvas = document.querySelector("canvas")
const ctx = tenfoldCanvas.getContext("2d")

if (!state) {
  const offscreenCanvas = document.createElement("canvas")
  const gl = offscreenCanvas.getContext("webgl2")
  
  if (!gl) {
    state = { error: true }
    window.h11 = state
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
uniform sampler2D tenfoldTexture;

// wobble controls (set from JS)
uniform float amp;    // distortion amplitude
uniform float speed;  // animation speed
uniform float scale;  // spatial frequency

// color controls (set from JS)
uniform float colorPhase;     // 0..1 phase
uniform float colorScale;     // spatial scale of color pattern
uniform float colorStrength;  // how strongly shapes are tinted

// ---------- noise / fbm ----------

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);

  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  vec2 u = f * f * (3.0 - 2.0 * f);

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.0;
    a *= 0.5;
  }
  return v;
}

// Nice cosine palette (Inigo Quilez)
vec3 palette(float t) {
  vec3 a = vec3(0.55, 0.20, 0.70);
  vec3 b = vec3(0.45, 0.45, 0.45);
  vec3 c = vec3(1.00, 1.00, 1.00);
  vec3 d = vec3(0.00, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

// -------------------------------

void main() {
  // base UV (0,0) top-left, (1,1) bottom-right
  vec2 uv = vPos * 0.5 + 0.5;
  uv.y = 1.0 - uv.y;

  // ----- grid / H11 tile info -----
  // 3-wide, 4-high grid, H11 = bottom-right tile
  vec2 tileMin   = vec2(2.0/3.0, 3.0/4.0);
  vec2 tileMax   = vec2(1.0,     1.0);
  vec2 tileCenter    = 0.5 * (tileMin + tileMax);
  vec2 tileHalfSize  = 0.5 * (tileMax - tileMin);

  vec2 local = (uv - tileCenter) / tileHalfSize;
  float rectDist = max(abs(local.x), abs(local.y)); // 0 in center, 1 on tile border

  // chaos is 0 in/around our tile, ramps up away from it
  float chaos = smoothstep(1.0, 2.0, rectDist);

  // ----- wobble (scaled by chaos) -----
  vec2 wp = vec2(uv.x, uv.y * 2.0);
  float n1 = fbm(wp * scale + vec2(0.0,        time * speed));
  float n2 = fbm(wp * scale + vec2(37.0, time * speed * 1.2));

  float wobbleStrength = chaos; // calm near H11, crazy far away
  vec2 offset = (vec2(n1, n2) - 0.5) * amp * wobbleStrength;

  vec2 duv = uv + offset;
  duv = clamp(duv, vec2(0.0), vec2(1.0));

  // ----- sample Tenfold canvas -----
  vec4 existing = texture(tenfoldTexture, duv);

  // Strong mask for the white graphics
  float luminance = dot(existing.rgb, vec3(0.299, 0.587, 0.114));
  float shapeMask = smoothstep(0.8, 1.0, luminance) * existing.a;

  // ----- procedural color field (domain-warped noise) -----

  // Domain-warped fbm
  vec2 cuv = duv * colorScale;
  float tPhase = colorPhase * 6.28318; // 0..2π loop

  vec2 q = vec2(
    fbm(cuv + vec2(0.0, 0.0) + vec2(cos(tPhase), sin(tPhase))),
    fbm(cuv + vec2(5.2, 1.3) + vec2(-sin(tPhase), cos(tPhase)))
  );

  float v = fbm(cuv * 2.0 + q * 3.0);
  float tColor = fract(v + colorPhase); // wrap 0..1 cleanly

  vec3 fieldColor = palette(tColor);

  // radiate strength from our tile: 0 near H11, 1 far
  float radialStrength = pow(chaos, 0.9);

  // ====== BACKGROUND: almost black with subtle noise ======
  // a separate noise field, independent of hue, just dark grey speckle
  float bgN = fbm(cuv * 1.5 + q * 2.7 + vec2(19.3, -11.7));
  bgN = pow(bgN, 2.0);                  // push most values towards 0
  float bgBrightness = 0.01 + 0.06 * bgN; // 0.01–0.07-ish
  // optionally make noise a bit stronger away from H11:
  bgBrightness *= mix(0.7, 1.3, radialStrength);
  vec3 bgColor = vec3(bgBrightness);    // pure greyscale, very dark

  // ====== SHAPES colorized by fieldColor ======
  float tint = clamp(radialStrength * colorStrength, 0.0, 1.0);

  float fieldLum = dot(fieldColor, vec3(0.299, 0.587, 0.114));
  vec3 fieldNorm = (fieldLum > 0.001)
    ? fieldColor / fieldLum         // normalize to ~1 brightness
    : vec3(1.0, 1.0, 1.0);

  vec3 shapeBase = vec3(1.0);
  vec3 shapeColor = mix(shapeBase, fieldNorm, tint);

  // slight brightness modulation
  float flicker = 0.97 + 0.03 * sin(time * 3.0 + v * 10.0);
  shapeColor *= flicker;
  shapeColor = clamp(shapeColor, 0.0, 1.0);

  // composite: dark background + bright shapes
  vec3 color = mix(bgColor, shapeColor, shapeMask);

  fragColor = vec4(color, 1.0);
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
    
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ])
    
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    
    const texture = gl.createTexture()
    
    // Get uniform/attribute locations once
    const timeLoc = gl.getUniformLocation(program, "time")
    const texLoc = gl.getUniformLocation(program, "tenfoldTexture")
    const positionLoc = gl.getAttribLocation(program, "position")

    // wobble uniform locations
    const ampLoc   = gl.getUniformLocation(program, "amp")
    const speedLoc = gl.getUniformLocation(program, "speed")
    const scaleLoc = gl.getUniformLocation(program, "scale")

    // color uniform locations
    const colorPhaseLoc    = gl.getUniformLocation(program, "colorPhase")
    const colorScaleLoc    = gl.getUniformLocation(program, "colorScale")
    const colorStrengthLoc = gl.getUniformLocation(program, "colorStrength")
    
    // Setup texture parameters once
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    
    state = {
      offscreenCanvas,
      gl,
      program,
      buffer,
      texture,
      timeLoc,
      texLoc,
      positionLoc,
      ampLoc,
      speedLoc,
      scaleLoc,
      colorPhaseLoc,
      colorScaleLoc,
      colorStrengthLoc,
      error: false
    }
    
    window.h11 = state
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
      texture,
      timeLoc,
      texLoc,
      positionLoc,
      ampLoc,
      speedLoc,
      scaleLoc,
      colorPhaseLoc,
      colorScaleLoc,
      colorStrengthLoc
    } = state
    
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    
    // Resize if needed
    if (offscreenCanvas.width !== tenfoldCanvas.width || offscreenCanvas.height !== tenfoldCanvas.height) {
      offscreenCanvas.width = tenfoldCanvas.width
      offscreenCanvas.height = tenfoldCanvas.height
      gl.viewport(0, 0, offscreenCanvas.width, offscreenCanvas.height)
    }
    
    // Upload texture
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tenfoldCanvas)
    
    gl.useProgram(program)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    
    // Set uniforms
    gl.uniform1f(timeLoc, params.t)
    gl.uniform1i(texLoc, 0)

    // wobble params from JS
    gl.uniform1f(ampLoc,   amp)
    gl.uniform1f(speedLoc, speed)
    gl.uniform1f(scaleLoc, scale)

    // color params from JS
    gl.uniform1f(colorPhaseLoc,    colorPhase)
    gl.uniform1f(colorScaleLoc,    colorScale)
    gl.uniform1f(colorStrengthLoc, colorStrength)
    
    // Setup attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(positionLoc)
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0)
    
    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    
    // Copy back
    ctx.drawImage(offscreenCanvas, 0, 0, tenfoldCanvas.width, tenfoldCanvas.height)
    ctx.restore()
  })
}
