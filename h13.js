// H13 REACTION-DIFFUSION
// — Orion Reed

// WAFFLE changes the simulation params (feed/kill)
// DRAGGING the letter changes the color palette
// wikipedia.org/wiki/Reaction–diffusion_system

// There's a LOT of things you can do with params
// and many other ways you can use them
// (like gradients to get different settings in different areas)
// Feel free to fork and experiment!

__loopBudget = 5000000 // idk what the budget actually needs to be

// CONFIGURATION

// Resolution scale (lower = faster, less detail)
const SCALE = 0.25

// Iterations per frame
const ITERATIONS = 6

// Diffusion
const DIFFUSION_A = 1.0
const DIFFUSION_B = 0.2

// Feed/Kill ranges (driven by q/r)
const FEED_MIN = 0.03
const FEED_MAX = 0.08
const KILL_MIN = 0.055
const KILL_MAX = 0.068
const SEED_STRENGTH = 0.1

// Center motion range (driven by params.t)
const CENTER_MOTION_MIN = 0.005
const CENTER_MOTION_MAX = 0.03

// Visual effects
const BRIGHTNESS = 1.5
const EMBOSS_STRENGTH = 0.5
const VIGNETTE_STRENGTH = 0.1

// Params → values
const feed = FEED_MIN + norm(params.q) * (FEED_MAX - FEED_MIN)
const kill = KILL_MIN + norm(params.r) * (KILL_MAX - KILL_MIN)
const pulse = 0.5 - 0.5 * cos(2 * PI * period("H13", params.t, 2))
const centerMotion = CENTER_MOTION_MIN + pulse * (CENTER_MOTION_MAX - CENTER_MOTION_MIN)

// Color palettes (x sweeps through, y shifts hue)
const palettes = [
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,0.7,0.4], d: [0.10,0.20,0.25] },
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,0.7,0.4], d: [0.00,0.15,0.20] },
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.00,0.15,0.25] },
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,1.0], d: [0.00,0.10,0.20] },
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,0.5], d: [0.25,0.20,0.20] },
  { a: [0.5,0.5,0.5], b: [0.5,0.5,0.5], c: [1.0,1.0,0.5], d: [0.30,0.20,0.20] },
]

const xNorm = norm(params.x)
const pos = xNorm * (palettes.length - 1)
const idx1 = floor(pos), idx2 = min(idx1 + 1, palettes.length - 1), blend = pos - idx1
const lerpVec = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
const colorA = lerpVec(palettes[idx1].a, palettes[idx2].a, blend)
const colorB = lerpVec(palettes[idx1].b, palettes[idx2].b, blend)
const colorC = lerpVec(palettes[idx1].c, palettes[idx2].c, blend)
const colorD = lerpVec(palettes[idx1].d, palettes[idx2].d, blend).map(v => v + params.y * 0.09)

// UTILITIES

function period(key, t, cycles) {
  if (!globalThis[key]) {
    globalThis[key] = { lastT: t, counter: 0 }
  }
  const state = globalThis[key]
  if (t < state.lastT) state.counter++
  state.lastT = t
  const totalProgress = (state.counter % cycles) + t
  return totalProgress / cycles
}

// LETTER DRAWING

const numH = 8
for (let i = 0; i < numH; i++) {
  const t = i / (numH - 1) - 0.5  // -0.5 to 0.5
  const angle = t * 0.1 * sinn(params.t)
  const spacing = 0.25
  const rotated = rotate(t * spacing, 0, angle, 0.5, 0.5)
  text("H", rotated.x, rotated.y, 2)
}

// MAIN

const tenfoldCanvas = document.querySelector("canvas")
const ctx = tenfoldCanvas.getContext("2d")
let state = window.h13

if (!state) {
  state = { initializing: true, ready: false, unsupported: false }
  window.h13 = state
  initWebGPU().then(gpuState => {
    Object.assign(state, gpuState, { initializing: false, ready: true })
  }).catch(() => {
    state.unsupported = true
    state.initializing = false
  })
}

async function initWebGPU() {
  if (!navigator.gpu) return Promise.reject()
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return Promise.reject()
  
  const device = await adapter.requestDevice()
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat()
  
  const offscreen = document.createElement("canvas")
  const gpuContext = offscreen.getContext("webgpu")
  gpuContext.configure({ device, format: presentationFormat, alphaMode: "premultiplied" })
  
  const rdModule = device.createShaderModule({ code: rdComputeShader })
  const compositeModule = device.createShaderModule({ code: compositeShader })
  
  const rdPipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: rdModule, entryPoint: "main" }
  })
  const compositePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module: compositeModule, entryPoint: "vertex_main" },
    fragment: { module: compositeModule, entryPoint: "frag_main", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list" }
  })
  
  const sampler = device.createSampler({ minFilter: "linear", magFilter: "linear" })
  const uniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const rdConfigBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const compositeConfigBuffer = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  
  return {
    device, offscreen, gpuContext, presentationFormat,
    rdPipeline, compositePipeline, sampler,
    uniformBuffer, rdConfigBuffer, compositeConfigBuffer,
    rdBindGroupLayout: rdPipeline.getBindGroupLayout(0),
    compositeBindGroupLayout: compositePipeline.getBindGroupLayout(0),
    textures: null, seedTexture: null, currentIdx: 0, lastWidth: 0, lastHeight: 0
  }
}

function createTextures(state, width, height) {
  const { device } = state
  const simW = floor(width * SCALE), simH = floor(height * SCALE)
  
  if (state.textures) {
    state.textures.forEach(t => t.destroy())
    state.seedTexture.destroy()
  }
  
  state.textures = [0, 1].map(() => device.createTexture({
    size: { width: simW, height: simH }, format: "rgba16float",
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  }))
  state.seedTexture = device.createTexture({
    size: { width: simW, height: simH }, format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  })
  
  state.simWidth = simW
  state.simHeight = simH
  state.lastWidth = width
  state.lastHeight = height
  state.currentIdx = 0
  initializeRD(state)
}

function initializeRD(state) {
  const { device, textures, simWidth, simHeight } = state
  const bytesPerPixel = 8
  const paddedBytesPerRow = ceil(simWidth * bytesPerPixel / 256) * 256
  const paddedWidth = paddedBytesPerRow / bytesPerPixel
  
  // Initialize: A=1, B=0 everywhere, random B seeds in center
  const data = new Float32Array(paddedWidth * simHeight * 4)
  for (let y = 0; y < simHeight; y++) {
    for (let x = 0; x < simWidth; x++) {
      const idx = (y * paddedWidth + x) * 4
      data[idx] = 1.0
      data[idx + 1] = 0.0
      data[idx + 2] = 0.0
      data[idx + 3] = 1.0
    }
  }
  
  const cx = floor(simWidth / 2), cy = floor(simHeight / 2)
  const radius = min(simWidth, simHeight) / 8
  for (let y = 0; y < simHeight; y++) {
    for (let x = 0; x < simWidth; x++) {
      const dx = x - cx, dy = y - cy
      if (sqrt(dx*dx + dy*dy) < radius && random() < 0.3) {
        data[(y * paddedWidth + x) * 4 + 1] = 1.0
      }
    }
  }
  
  // Convert to float16
  const f16Data = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) f16Data[i] = float32ToFloat16(data[i])
  
  const staging = device.createBuffer({
    size: f16Data.byteLength,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
    mappedAtCreation: true
  })
  new Uint16Array(staging.getMappedRange()).set(f16Data)
  staging.unmap()
  
  const encoder = device.createCommandEncoder()
  for (const tex of textures) {
    encoder.copyBufferToTexture(
      { buffer: staging, bytesPerRow: paddedBytesPerRow },
      { texture: tex },
      { width: simWidth, height: simHeight }
    )
  }
  device.queue.submit([encoder.finish()])
  staging.destroy()
}

function float32ToFloat16(val) {
  const f32 = new Float32Array([val])
  const i32 = new Int32Array(f32.buffer)[0]
  let bits = (i32 >> 16) & 0x8000, m = (i32 >> 12) & 0x07ff
  const e = (i32 >> 23) & 0xff
  if (e < 103) return bits
  if (e > 142) { bits |= 0x7c00; bits |= (e === 255 ? 0 : 1) && (i32 & 0x007fffff); return bits }
  if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits }
  bits |= ((e - 112) << 10) | (m >> 1)
  return bits + (m & 1)
}

// RENDER

if (state && state.unsupported) {
  text("try in Chrome :)", -1, -0.8, 0.15)
  text("WebGPU support needed", -1, 0.8, 0.15)
} else if (state && state.ready) {
  queueMicrotask(() => {
    const { device, offscreen, gpuContext, presentationFormat, rdPipeline, compositePipeline, sampler,
            uniformBuffer, rdConfigBuffer, compositeConfigBuffer, rdBindGroupLayout, compositeBindGroupLayout } = state
    
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    const width = tenfoldCanvas.width, height = tenfoldCanvas.height
    
    // Save original content
    const originalContent = document.createElement("canvas")
    originalContent.width = width
    originalContent.height = height
    originalContent.getContext("2d").drawImage(tenfoldCanvas, 0, 0)
    
    // Resize if needed
    if (width !== state.lastWidth || height !== state.lastHeight) {
      offscreen.width = width
      offscreen.height = height
      gpuContext.configure({ device, format: presentationFormat, alphaMode: "premultiplied" })
      createTextures(state, width, height)
    }
    
    const { textures, seedTexture, simWidth, simHeight } = state
    
    // Upload canvas as seed
    const seedCanvas = document.createElement("canvas")
    seedCanvas.width = simWidth
    seedCanvas.height = simHeight
    seedCanvas.getContext("2d").drawImage(tenfoldCanvas, 0, 0, simWidth, simHeight)
    device.queue.copyExternalImageToTexture({ source: seedCanvas }, { texture: seedTexture }, { width: simWidth, height: simHeight })
    
    // Update uniforms
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([pulse, params.t, 0, 0]))
    device.queue.writeBuffer(rdConfigBuffer, 0, new Float32Array([DIFFUSION_A, DIFFUSION_B, feed, kill, SEED_STRENGTH, centerMotion, 0, 0]))
    device.queue.writeBuffer(compositeConfigBuffer, 0, new Float32Array([...colorA, BRIGHTNESS, ...colorB, EMBOSS_STRENGTH, ...colorC, VIGNETTE_STRENGTH, ...colorD, 0]))
    
    const encoder = device.createCommandEncoder()
    
    // RD iterations
    for (let i = 0; i < ITERATIONS; i++) {
      const input = textures[state.currentIdx], output = textures[1 - state.currentIdx]
      const bindGroup = device.createBindGroup({
        layout: rdBindGroupLayout,
        entries: [
          { binding: 0, resource: input.createView() },
          { binding: 1, resource: output.createView() },
          { binding: 2, resource: seedTexture.createView() },
          { binding: 3, resource: { buffer: uniformBuffer } },
          { binding: 4, resource: { buffer: rdConfigBuffer } }
        ]
      })
      const pass = encoder.beginComputePass()
      pass.setPipeline(rdPipeline)
      pass.setBindGroup(0, bindGroup)
      pass.dispatchWorkgroups(ceil(simWidth / 14), ceil(simHeight / 14))
      pass.end()
      state.currentIdx = 1 - state.currentIdx
    }
    
    // Composite
    const compositeBindGroup = device.createBindGroup({
      layout: compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: textures[state.currentIdx].createView() },
        { binding: 3, resource: { buffer: compositeConfigBuffer } }
      ]
    })
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{ view: gpuContext.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }]
    })
    renderPass.setPipeline(compositePipeline)
    renderPass.setBindGroup(0, compositeBindGroup)
    renderPass.draw(3)
    renderPass.end()
    
    device.queue.submit([encoder.finish()])
    ctx.drawImage(offscreen, 0, 0, width, height)
    ctx.drawImage(originalContent, 0, 0)
    ctx.restore()
  })
}

// SHADERS

const rdComputeShader = `
const DISPATCH_SIZE = vec2u(14u, 14u);
const TILE_SIZE = vec2u(2u, 2u);
const laplacian: array<f32, 9> = array(0.05, 0.20, 0.05, 0.20, -1.0, 0.20, 0.05, 0.20, 0.05);

struct Uniforms { pulse: f32, time: f32, _p1: f32, _p2: f32 }
struct RDConfig { diffA: f32, diffB: f32, feed: f32, kill: f32, seedStrength: f32, centerMotion: f32, _p1: f32, _p2: f32 }

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var seedTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> u: Uniforms;
@group(0) @binding(4) var<uniform> cfg: RDConfig;

fn bilinear(t: texture_2d<f32>, coord: vec2f, dims: vec2u) -> vec4f {
  let f = fract(coord);
  let s = vec2u(coord + (0.5 - f));
  let m = dims - vec2u(1u);
  let tl = textureLoad(t, clamp(s, vec2u(0u), m), 0);
  let tr = textureLoad(t, clamp(s + vec2u(1u, 0u), vec2u(0u), m), 0);
  let bl = textureLoad(t, clamp(s + vec2u(0u, 1u), vec2u(0u), m), 0);
  let br = textureLoad(t, clamp(s + vec2u(1u, 1u), vec2u(0u), m), 0);
  return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y);
}

var<workgroup> cache: array<array<vec4f, 16>, 16>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(workgroup_id) wgID: vec3u, @builtin(local_invocation_id) localID: vec3u) {
  let kernelOffset = vec2u(1u);
  let tileOffset = localID.xy * TILE_SIZE;
  let dispatchOffset = wgID.xy * DISPATCH_SIZE;
  let dims = textureDimensions(inputTex, 0);
  let dimsF = vec2f(dims);

  // Load into cache
  for (var c = 0u; c < TILE_SIZE.x; c++) {
    for (var r = 0u; r < TILE_SIZE.y; r++) {
      let local = vec2u(c, r) + tileOffset;
      var sampleCoord = vec2i(dispatchOffset + local) - vec2i(kernelOffset);
      sampleCoord = clamp(sampleCoord, vec2i(0), vec2i(dims) - vec2i(1));
      var coordF = vec2f(sampleCoord);
      let uv = coordF / dimsF;
      coordF -= (uv * 2.0 - 1.0) * cfg.centerMotion * (2.0 * u.pulse + 2.0);
      let input = bilinear(inputTex, coordF, dims);
      let seed = textureLoad(seedTex, vec2u(sampleCoord), 0);
      let lum = dot(seed.rgb, vec3f(0.299, 0.587, 0.114));
      cache[local.y][local.x] = vec4f(input.rg, smoothstep(0.5, 1.0, lum) * seed.a, 0.0);
    }
  }
  workgroupBarrier();

  // Process
  let bounds = vec4u(dispatchOffset, min(dims, dispatchOffset + DISPATCH_SIZE));
  for (var c = 0u; c < TILE_SIZE.x; c++) {
    for (var r = 0u; r < TILE_SIZE.y; r++) {
      let local = vec2u(c, r) + tileOffset;
      let sample = dispatchOffset + local - kernelOffset;
      if (all(sample >= bounds.xy) && all(sample < bounds.zw)) {
        let uv = (2.0 * vec2f(sample) / vec2f(dims)) - 1.0;
        var lap = vec2f(0.0);
        for (var x = 0; x < 3; x++) {
          for (var y = 0; y < 3; y++) {
            let i = vec2i(local) + vec2i(x, y) - vec2i(kernelOffset);
            lap += cache[i.y][i.x].xy * laplacian[y * 3 + x];
          }
        }
        let dist = dot(uv, uv);
        let cacheVal = cache[local.y][local.x];
        let dA = cfg.diffA - dist * 0.1;
        var dB = max(0.1, cfg.diffB + dist * 0.05 + 0.05 * u.pulse);
        var kill = cfg.kill + cacheVal.b * cfg.seedStrength * (u.pulse * 0.3 + 0.7);
        let A = cacheVal.x;
        let B = cacheVal.y;
        let reaction = A * B * B;
        let rd = vec2f(
          A + (dA * lap.x - reaction + cfg.feed * (1.0 - A)),
          B + (dB * lap.y + reaction - (kill + cfg.feed) * B)
        );
        textureStore(outputTex, sample, vec4f(clamp(rd, vec2f(0.0), vec2f(1.0)), 0.0, 1.0));
      }
    }
  }
}
`

const compositeShader = `
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
struct Uniforms { pulse: f32, time: f32, _p1: f32, _p2: f32 }
struct CompositeConfig { colorA: vec3f, brightness: f32, colorB: vec3f, embossStrength: f32, colorC: vec3f, vignetteStrength: f32, colorD: vec3f, _p: f32 }

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> cfg: CompositeConfig;

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  const pos = array(vec2f(-1, 3), vec2f(-1, -1), vec2f(3, -1));
  const uvs = array(vec2f(0, -1), vec2f(0, 1), vec2f(2, 1));
  var out: VertexOutput;
  out.position = vec4f(pos[vi], 0, 1);
  out.uv = uvs[vi];
  return out;
}

fn pal(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

fn emboss(p: vec2f, input: vec4f, tex: texture_2d<f32>, s: sampler, texelSize: vec2f, scale: f32, shift: f32) -> vec4f {
  let tl = textureSample(tex, s, p + vec2f(-texelSize.x, texelSize.y) * scale);
  let br = textureSample(tex, s, p + vec2f(texelSize.x, -texelSize.y) * scale);
  let c = smoothstep(0.0, shift, input.r);
  let tlv = smoothstep(0.0, shift, tl.r);
  let brv = smoothstep(0.0, shift, br.r);
  return vec4f(tlv, c, brv, clamp(2.0 * brv - c - tlv, 0.0, 1.0));
}

@fragment
fn frag_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texSize = vec2f(textureDimensions(inputTex));
  let input = textureSample(inputTex, texSampler, uv);
  let value = smoothstep(0.225, 0.8, input.g);
  var base = pal(value * 0.4 + 0.4, cfg.colorA, cfg.colorB, cfg.colorC, cfg.colorD);
  base *= cfg.brightness * (u.pulse * 0.15 + 0.85);
  let st = uv * 2.0 - 1.0;
  let dist = length(st);
  let emb = emboss(uv, input, inputTex, texSampler, 1.0 / texSize, 0.5, 0.4 + dist * 0.3);
  let embossVal = emb.w * cfg.embossStrength * (u.pulse * 0.2 + 0.8);
  let specular = smoothstep(0.2, 0.3, 2.0 * emb.x - emb.y - emb.z) * 0.5 * (1.0 - dist);
  let color = base + vec3f(embossVal) + specular - dist * cfg.vignetteStrength;
  return vec4f(color, 1.0);
}
`
