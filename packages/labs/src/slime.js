// PHYSARUM SLIME MOLD SIMULATION
// — Variation of Orion Reed's H13 Reaction-Diffusion

// WAFFLE changes sensor angle and distance
// DRAGGING the letter changes the color palette
// Based on physarum transport networks

__loopBudget = 5000000;

// CONFIGURATION
const SCALE = 0.5;
const AGENT_COUNT = 80000;

// Agent behavior
const MOVE_SPEED = 1.0;
const TURN_SPEED = 45.0; // degrees

// Sensor configuration (driven by q/r)
const SENSOR_ANGLE_MIN = 20.0;
const SENSOR_ANGLE_MAX = 60.0;
const SENSOR_DIST_MIN = 9.0;
const SENSOR_DIST_MAX = 30.0;

// Trail behavior
const DEPOSIT_RADIUS = 1.0;
const DECAY_RATE = 0.02;

// Visual
const BRIGHTNESS = 1.8;
const VIGNETTE_STRENGTH = 0.12;

// Params → values
const sensorAngle = SENSOR_ANGLE_MIN + norm(params.q) * (SENSOR_ANGLE_MAX - SENSOR_ANGLE_MIN);
const sensorDist = SENSOR_DIST_MIN + norm(params.r) * (SENSOR_DIST_MAX - SENSOR_DIST_MIN);
const pulse = 0.5 - 0.5 * cos(2 * PI * period('PHYSARUM', params.t, 3));

// Color palettes
const neutral = [0.5, 0.5, 0.5];
const palettes = [
  { a: neutral, b: neutral, c: [1.0, 0.8, 0.3], d: [0.0, 0.15, 0.3] },
  { a: neutral, b: neutral, c: [0.8, 1.0, 0.4], d: [0.1, 0.2, 0.3] },
  { a: neutral, b: neutral, c: [0.5, 1.0, 1.0], d: [0.15, 0.2, 0.35] },
  { a: neutral, b: neutral, c: [1.0, 0.6, 1.0], d: [0.3, 0.2, 0.25] },
  { a: neutral, b: neutral, c: [1.0, 0.5, 0.3], d: [0.0, 0.25, 0.35] },
  { a: neutral, b: neutral, c: [0.6, 0.8, 1.0], d: [0.2, 0.15, 0.3] },
];

const xNorm = norm(params.x);
const pos = xNorm * (palettes.length - 1);
const idx1 = floor(pos),
  idx2 = min(idx1 + 1, palettes.length - 1),
  blend = pos - idx1;
const lerpVec = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const colorA = lerpVec(palettes[idx1].a, palettes[idx2].a, blend);
const colorB = lerpVec(palettes[idx1].b, palettes[idx2].b, blend);
const colorC = lerpVec(palettes[idx1].c, palettes[idx2].c, blend);
const colorD = lerpVec(palettes[idx1].d, palettes[idx2].d, blend).map((v) => v + params.y * 0.09);

function period(key, t, cycles) {
  if (!globalThis[key]) globalThis[key] = { lastT: t, counter: 0 };
  const state = globalThis[key];
  if (t < state.lastT) state.counter++;
  state.lastT = t;
  return ((state.counter % cycles) + t) / cycles;
}

// Letter drawing
const numP = 10;
for (let i = 0; i < numP; i++) {
  const t = i / (numP - 1) - 0.5;
  const angle = t * 0.15 * sinn(params.t);
  const rotated = rotate(t * 0.2, 0, angle, 0.5, 0.5);
  text('P', rotated.x, rotated.y, 1.8);
}

// MAIN
const tenfoldCanvas = document.querySelector('canvas');
const ctx = tenfoldCanvas.getContext('2d');
let state = window.physarum;

if (!state) {
  state = { initializing: true, ready: false, unsupported: false };
  window.physarum = state;
  initWebGPU()
    .then((gpuState) => {
      Object.assign(state, gpuState, { initializing: false, ready: true });
    })
    .catch((e) => {
      console.error(e);
      state.unsupported = true;
      state.initializing = false;
    });
}

async function initWebGPU() {
  if (!navigator.gpu) return Promise.reject('No WebGPU');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return Promise.reject('No adapter');
  const device = await adapter.requestDevice();
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

  const offscreen = document.createElement('canvas');
  const gpuContext = offscreen.getContext('webgpu');
  gpuContext.configure({ device, format: presentationFormat, alphaMode: 'premultiplied' });

  // Create shader modules
  const agentModule = device.createShaderModule({ code: agentShader });
  const decayModule = device.createShaderModule({ code: decayShader });
  const blurModule = device.createShaderModule({ code: blurShader });
  const renderModule = device.createShaderModule({ code: renderShader });

  // Create pipelines
  const agentPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: agentModule, entryPoint: 'main' },
  });
  const decayPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: decayModule, entryPoint: 'main' },
  });
  const blurPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: blurModule, entryPoint: 'main' },
  });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format: presentationFormat }] },
    primitive: { topology: 'triangle-list' },
  });

  const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const colorBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  return {
    device,
    offscreen,
    gpuContext,
    presentationFormat,
    sampler,
    agentPipeline,
    decayPipeline,
    blurPipeline,
    renderPipeline,
    uniformBuffer,
    colorBuffer,
    resources: null,
    lastWidth: 0,
    lastHeight: 0,
  };
}

function createResources(state, width, height) {
  const { device } = state;
  const simW = floor(width * SCALE),
    simH = floor(height * SCALE);

  if (state.resources) {
    state.resources.agentBuffer.destroy();
    state.resources.storageTexture.destroy();
    state.resources.readTexture.destroy();
    state.resources.seedTexture.destroy();
  }

  // Agent buffer: posX, posY, dirX, dirY
  const agentData = new Float32Array(AGENT_COUNT * 4);
  for (let i = 0; i < AGENT_COUNT; i++) {
    const r = random() * min(simW, simH) * 0.2;
    const theta = random() * 2 * PI;
    agentData[i * 4 + 0] = simW / 2 + cos(theta) * r; // posX
    agentData[i * 4 + 1] = simH / 2 + sin(theta) * r; // posY
    // Direction pointing outward
    agentData[i * 4 + 2] = cos(theta + PI); // dirX
    agentData[i * 4 + 3] = sin(theta + PI); // dirY
  }

  const agentBuffer = device.createBuffer({
    size: agentData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(agentBuffer, 0, agentData);

  // Storage texture (write in compute)
  const storageTexture = device.createTexture({
    size: { width: simW, height: simH },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  });

  // Read texture (read in compute, copied from storage)
  const readTexture = device.createTexture({
    size: { width: simW, height: simH },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  // Seed texture for text
  const seedTexture = device.createTexture({
    size: { width: simW, height: simH },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  state.resources = { agentBuffer, storageTexture, readTexture, seedTexture, simW, simH };
  state.lastWidth = width;
  state.lastHeight = height;
}

// RENDER
if (state && state.unsupported) {
  text('try in Chrome :)', -1, -0.8, 0.15);
  text('WebGPU support needed', -1, 0.8, 0.15);
} else if (state && state.ready) {
  queueMicrotask(() => {
    const {
      device,
      offscreen,
      gpuContext,
      presentationFormat,
      sampler,
      agentPipeline,
      decayPipeline,
      blurPipeline,
      renderPipeline,
      uniformBuffer,
      colorBuffer,
    } = state;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const width = tenfoldCanvas.width,
      height = tenfoldCanvas.height;

    const originalContent = document.createElement('canvas');
    originalContent.width = width;
    originalContent.height = height;
    originalContent.getContext('2d').drawImage(tenfoldCanvas, 0, 0);

    if (width !== state.lastWidth || height !== state.lastHeight) {
      offscreen.width = width;
      offscreen.height = height;
      gpuContext.configure({ device, format: presentationFormat, alphaMode: 'premultiplied' });
      createResources(state, width, height);
    }

    const { agentBuffer, storageTexture, readTexture, seedTexture, simW, simH } = state.resources;

    // Upload seed texture
    const seedCanvas = document.createElement('canvas');
    seedCanvas.width = simW;
    seedCanvas.height = simH;
    seedCanvas.getContext('2d').drawImage(tenfoldCanvas, 0, 0, simW, simH);
    device.queue.copyExternalImageToTexture(
      { source: seedCanvas },
      { texture: seedTexture },
      { width: simW, height: simH },
    );

    // Update uniforms
    device.queue.writeBuffer(
      uniformBuffer,
      0,
      new Float32Array([
        simW,
        simH,
        AGENT_COUNT,
        params.t,
        sensorAngle,
        sensorDist,
        MOVE_SPEED,
        TURN_SPEED,
        DEPOSIT_RADIUS,
        DECAY_RATE,
        pulse,
        0,
      ]),
    );
    device.queue.writeBuffer(
      colorBuffer,
      0,
      new Float32Array([...colorA, BRIGHTNESS, ...colorB, VIGNETTE_STRENGTH, ...colorC, 0, ...colorD, pulse]),
    );

    const encoder = device.createCommandEncoder();

    // 1. Agent update pass - sense, move, deposit
    const agentBindGroup = device.createBindGroup({
      layout: agentPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: agentBuffer } },
        { binding: 2, resource: readTexture.createView() },
        { binding: 3, resource: storageTexture.createView() },
        { binding: 4, resource: seedTexture.createView() },
      ],
    });
    const agentPass = encoder.beginComputePass();
    agentPass.setPipeline(agentPipeline);
    agentPass.setBindGroup(0, agentBindGroup);
    agentPass.dispatchWorkgroups(ceil(AGENT_COUNT / 64));
    agentPass.end();

    // Copy storage -> read
    encoder.copyTextureToTexture({ texture: storageTexture }, { texture: readTexture }, { width: simW, height: simH });

    // 2. Decay pass
    const decayBindGroup = device.createBindGroup({
      layout: decayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: readTexture.createView() },
        { binding: 2, resource: storageTexture.createView() },
      ],
    });
    const decayPass = encoder.beginComputePass();
    decayPass.setPipeline(decayPipeline);
    decayPass.setBindGroup(0, decayBindGroup);
    decayPass.dispatchWorkgroups(simW, simH);
    decayPass.end();

    // Copy storage -> read
    encoder.copyTextureToTexture({ texture: storageTexture }, { texture: readTexture }, { width: simW, height: simH });

    // 3. Blur pass
    const blurBindGroup = device.createBindGroup({
      layout: blurPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: readTexture.createView() },
        { binding: 2, resource: storageTexture.createView() },
      ],
    });
    const blurPass = encoder.beginComputePass();
    blurPass.setPipeline(blurPipeline);
    blurPass.setBindGroup(0, blurBindGroup);
    blurPass.dispatchWorkgroups(ceil(simW / 8), ceil(simH / 8));
    blurPass.end();

    // Copy storage -> read for rendering
    encoder.copyTextureToTexture({ texture: storageTexture }, { texture: readTexture }, { width: simW, height: simH });

    // 4. Render pass
    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: colorBuffer } },
        { binding: 2, resource: sampler },
        { binding: 3, resource: readTexture.createView() },
      ],
    });
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(6);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    ctx.drawImage(offscreen, 0, 0, width, height);
    ctx.drawImage(originalContent, 0, 0);
    ctx.restore();
  });
}

// SHADERS

const agentShader = `
struct Uniforms {
  width: f32, height: f32, agentCount: f32, time: f32,
  sensorAngle: f32, sensorDist: f32, moveSpeed: f32, turnSpeed: f32,
  depositRadius: f32, decayRate: f32, pulse: f32, _pad: f32
}

struct Agent { posX: f32, posY: f32, dirX: f32, dirY: f32 }

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> agents: array<Agent>;
@group(0) @binding(2) var readTex: texture_2d<f32>;
@group(0) @binding(3) var writeTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var seedTex: texture_2d<f32>;

fn rotate2d(v: vec2f, degrees: f32) -> vec2f {
  let rad = radians(degrees);
  let c = cos(rad);
  let s = sin(rad);
  return vec2f(v.x * c - v.y * s, v.x * s + v.y * c);
}

fn hash(p: u32) -> f32 {
  var x = p;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / 4294967295.0;
}

fn senseTrail(pos: vec2f, dir: vec2f) -> f32 {
  let sensorPos = pos + dir * u.sensorDist;
  var sum = 0.0;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      let sampleX = i32(sensorPos.x) + x;
      let sampleY = i32(sensorPos.y) + y;
      if (sampleX >= 0 && sampleX < i32(u.width) && sampleY >= 0 && sampleY < i32(u.height)) {
        sum += textureLoad(readTex, vec2i(sampleX, sampleY), 0).r;
        // Add attraction to seed (text)
        let seed = textureLoad(seedTex, vec2i(sampleX, sampleY), 0);
        sum += dot(seed.rgb, vec3f(0.299, 0.587, 0.114)) * seed.a * 2.0;
      }
    }
  }
  return sum;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let idx = id.x;
  if (idx >= u32(u.agentCount)) { return; }
  
  var agent = agents[idx];
  let pos = vec2f(agent.posX, agent.posY);
  var dir = normalize(vec2f(agent.dirX, agent.dirY));
  
  // Boundary reflection
  if (pos.x < 0.0 || pos.x >= u.width) { dir.x *= -1.0; }
  if (pos.y < 0.0 || pos.y >= u.height) { dir.y *= -1.0; }
  
  // Sense in three directions
  let dirL = rotate2d(dir, u.sensorAngle);
  let dirR = rotate2d(dir, -u.sensorAngle);
  
  let F = senseTrail(pos, dir);
  let FL = senseTrail(pos, dirL);
  let FR = senseTrail(pos, dirR);
  
  // Decide rotation
  let rng = hash(idx + u32(u.time * 1000.0));
  if (F > FL && F > FR) {
    // Keep going straight
  } else if (F < FL && F < FR) {
    // Random turn
    if (rng < 0.5) {
      dir = rotate2d(dir, u.turnSpeed);
    } else {
      dir = rotate2d(dir, -u.turnSpeed);
    }
  } else if (FL < FR) {
    dir = rotate2d(dir, -u.turnSpeed);
  } else if (FR < FL) {
    dir = rotate2d(dir, u.turnSpeed);
  }
  
  // Add small random wiggle
  dir = rotate2d(dir, (hash(idx * 7u + u32(u.time * 500.0)) - 0.5) * 10.0);
  dir = normalize(dir);
  
  // Move
  let newPos = pos + dir * u.moveSpeed;
  
  // Clamp to bounds
  agent.posX = clamp(newPos.x, 0.0, u.width - 1.0);
  agent.posY = clamp(newPos.y, 0.0, u.height - 1.0);
  agent.dirX = dir.x;
  agent.dirY = dir.y;
  
  agents[idx] = agent;
  
  // Deposit trail (draw white dot)
  let depositPos = vec2i(i32(agent.posX), i32(agent.posY));
  let radius = i32(u.depositRadius);
  for (var dx = -radius; dx <= radius; dx++) {
    for (var dy = -radius; dy <= radius; dy++) {
      if (dx * dx + dy * dy <= radius * radius) {
        let writePos = depositPos + vec2i(dx, dy);
        if (writePos.x >= 0 && writePos.x < i32(u.width) && writePos.y >= 0 && writePos.y < i32(u.height)) {
          textureStore(writeTex, writePos, vec4f(1.0, 1.0, 1.0, 1.0));
        }
      }
    }
  }
}
`;

const decayShader = `
struct Uniforms {
  width: f32, height: f32, agentCount: f32, time: f32,
  sensorAngle: f32, sensorDist: f32, moveSpeed: f32, turnSpeed: f32,
  depositRadius: f32, decayRate: f32, pulse: f32, _pad: f32
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var readTex: texture_2d<f32>;
@group(0) @binding(2) var writeTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let color = textureLoad(readTex, vec2i(id.xy), 0).rgb;
  let decayed = max(color - u.decayRate, vec3f(0.0));
  textureStore(writeTex, vec2i(id.xy), vec4f(decayed, 1.0));
}
`;

const blurShader = `
struct Uniforms {
  width: f32, height: f32, agentCount: f32, time: f32,
  sensorAngle: f32, sensorDist: f32, moveSpeed: f32, turnSpeed: f32,
  depositRadius: f32, decayRate: f32, pulse: f32, _pad: f32
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var readTex: texture_2d<f32>;
@group(0) @binding(2) var writeTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u32(u.width) || id.y >= u32(u.height)) { return; }
  
  var sum = vec4f(0.0);
  let pos = vec2i(id.xy);
  
  sum += textureLoad(readTex, pos + vec2i(-1, -1), 0);
  sum += textureLoad(readTex, pos + vec2i( 0, -1), 0);
  sum += textureLoad(readTex, pos + vec2i( 1, -1), 0);
  sum += textureLoad(readTex, pos + vec2i(-1,  0), 0);
  sum += textureLoad(readTex, pos + vec2i( 0,  0), 0);
  sum += textureLoad(readTex, pos + vec2i( 1,  0), 0);
  sum += textureLoad(readTex, pos + vec2i(-1,  1), 0);
  sum += textureLoad(readTex, pos + vec2i( 0,  1), 0);
  sum += textureLoad(readTex, pos + vec2i( 1,  1), 0);
  
  let blurred = sum / 9.0;
  textureStore(writeTex, pos, blurred);
}
`;

const renderShader = `
struct ColorConfig {
  colorA: vec3f, brightness: f32,
  colorB: vec3f, vignette: f32,
  colorC: vec3f, _p1: f32,
  colorD: vec3f, pulse: f32
}

struct VSOutput { @builtin(position) pos: vec4f, @location(0) uv: vec2f }

@group(0) @binding(1) var<uniform> colors: ColorConfig;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var tex: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VSOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1),
    vec2f(1, -1), vec2f(1, 1), vec2f(-1, 1)
  );
  var uvs = array<vec2f, 6>(
    vec2f(0, 1), vec2f(1, 1), vec2f(0, 0),
    vec2f(1, 1), vec2f(1, 0), vec2f(0, 0)
  );
  var out: VSOutput;
  out.pos = vec4f(positions[i], 0, 1);
  out.uv = uvs[i];
  return out;
}

fn palette(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let trail = textureSample(tex, samp, uv).r;
  
  // Color based on trail intensity
  let value = smoothstep(0.0, 1.0, trail);
  var color = palette(value * 0.5 + 0.3, colors.colorA, colors.colorB, colors.colorC, colors.colorD);
  color *= colors.brightness * (colors.pulse * 0.15 + 0.85);
  
  // Vignette
  let st = uv * 2.0 - 1.0;
  let dist = length(st);
  color -= dist * colors.vignette;
  
  return vec4f(max(color, vec3f(0.0)), 1.0);
}
`;
