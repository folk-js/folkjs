import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

type Line = [x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, thickness: number];

function nextPowerOf2(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 2)));
}

function uboView(shader: string, name: string): StructuredView {
  return makeStructuredView(makeShaderDataDefinitions(shader).uniforms[name]);
}

function createComputePipeline(device: GPUDevice, label: string, code: string): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
}

function uploadVertexData(
  device: GPUDevice,
  existing: GPUBuffer | undefined,
  data: Float32Array<ArrayBuffer>,
): GPUBuffer {
  if (!existing || existing.size < data.byteLength) {
    existing?.destroy();
    existing = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  device.queue.writeBuffer(existing, 0, data);
  return existing;
}

// ── World-render shaders (shapes, lines, mouse light → world texture) ──

const worldRenderShader = /*wgsl*/ `
struct VertexInput { @location(0) position: vec2f, @location(1) color: vec3f }
struct VertexOutput { @builtin(position) position: vec4f, @location(0) color: vec3f }
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  return out;
}
@fragment fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(srgbToLinear(in.color), 1.0);
}
`;

const lineRenderShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) p1: vec2f,
  @location(2) p2: vec2f,
  @location(3) radius: f32,
}
struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f, @location(1) p2: vec2f,
  @location(2) color: vec3f, @location(3) thickness: f32,
) -> VertexOutput {
  let r = thickness * 0.5;
  let minP = min(p1, p2) - vec2f(r);
  let maxP = max(p1, p2) + vec2f(r);
  var corners = array<vec2f, 6>(
    vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(1,0), vec2f(1,1), vec2f(0,1),
  );
  let c = corners[vid];
  let pixel = minP + (maxP - minP) * c;
  let clip = vec2f(pixel.x / canvas.width * 2.0 - 1.0, 1.0 - pixel.y / canvas.height * 2.0);
  var out: VertexOutput;
  out.position = vec4f(clip, 0.0, 1.0);
  out.color = color; out.p1 = p1; out.p2 = p2; out.radius = r;
  return out;
}
@fragment fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let pos = in.position.xy;
  let ab = in.p2 - in.p1; let ap = pos - in.p1;
  let lenSq = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / lenSq, 0.0, 1.0), 0.0, lenSq < 0.001);
  let nearest = in.p1 + ab * t;
  let d = length(pos - nearest) - in.radius;
  if (d > 0.0) { discard; }
  return vec4f(srgbToLinear(in.color), 1.0);
}
`;

// ── HRC cascade merge shader ──
// Processes one cascade level for one direction. Each invocation handles
// one (perpIdx, alongIdx, angleIdx) probe. It traces a short ray to the
// next cascade's probe positions and merges with the higher cascade's
// already-computed fluence. Follows the amitabha reference implementation.

const cascadeMergeShader = /*wgsl*/ `
struct CascadeParams {
  perpSize: u32,
  alongSize: u32,
  numAngles: u32,
  spacing: f32,
  nextNumAngles: u32,
  nextSpacing: f32,
  nextAlongSize: u32,
  isLastCascade: u32,
  screenW: f32,
  screenH: f32,
  originX: f32,
  originY: f32,
  alongAxisX: f32,
  alongAxisY: f32,
  perpAxisX: f32,
  perpAxisY: f32,
};

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var prevCascade: texture_2d<f32>;
@group(0) @binding(2) var currCascade: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: CascadeParams;
@group(0) @binding(4) var cascadeSampler: sampler;

fn toWorld(perpIdx: i32, alongIdx: i32, sp: f32) -> vec2f {
  return vec2f(params.originX, params.originY)
       + vec2f(params.perpAxisX, params.perpAxisY) * (f32(perpIdx) + 0.5)
       + vec2f(params.alongAxisX, params.alongAxisY) * (f32(alongIdx) * sp + 0.5);
}

fn readPrev(perpIdx: i32, alongIdx: i32, angleIdx: u32, numAng: u32) -> vec3f {
  if (perpIdx < 0 || alongIdx < 0 ||
      perpIdx >= i32(params.perpSize) || alongIdx >= i32(params.nextAlongSize)) {
    return vec3f(0.0);
  }
  let x = f32(alongIdx * i32(numAng) + i32(angleIdx)) + 0.5;
  let y = f32(perpIdx) + 0.5;
  let dims = vec2f(textureDimensions(prevCascade));
  let uv = vec2f(x, y) / dims;
  return textureSampleLevel(prevCascade, cascadeSampler, uv, 0.0).rgb;
}

fn sampleWorld(worldPos: vec2f) -> vec4f {
  let px = vec2i(i32(floor(worldPos.x + 0.5)), i32(floor(worldPos.y + 0.5)));
  if (px.x < 0 || px.y < 0 || px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) {
    return vec4f(0.0);
  }
  return textureLoad(worldTex, px, 0);
}

fn traceRay(startW: vec2f, endW: vec2f) -> vec4f {
  let delta = endW - startW;
  let dist = length(delta);
  if (dist < 0.5) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let numSteps = clamp(u32(ceil(dist)), 1u, 512u);
  let step = delta / f32(numSteps);
  var radiance = vec3f(0.0);
  var transmittance = 1.0;
  for (var i = 0u; i < numSteps; i++) {
    let pos = startW + step * (f32(i) + 0.5);
    let s = sampleWorld(pos);
    radiance += transmittance * s.rgb;
    transmittance *= (1.0 - s.a);
  }
  return vec4f(radiance, transmittance);
}

fn overComp(traced: vec4f, behind: vec3f) -> vec3f {
  return traced.rgb + traced.a * behind;
}

fn angSize(a: u32, numAng: u32, sp: f32) -> f32 {
  let AR = f32(numAng);
  let af = f32(a);
  return atan2(2.0 * af - AR + 2.0, sp) - atan2(2.0 * af - AR, sp);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let perpIdx = i32(gid.x);
  let flatIdx = gid.y;
  let alongIdx = i32(flatIdx / params.numAngles);
  let angleIdx = flatIdx % params.numAngles;

  if (perpIdx >= i32(params.perpSize) || alongIdx >= i32(params.alongSize)) { return; }

  let uSize = angSize(angleIdx * 2u, params.nextNumAngles, params.nextSpacing);
  let lSize = angSize(angleIdx * 2u + 1u, params.nextNumAngles, params.nextSpacing);
  let offset = 2 * i32(angleIdx) - i32(params.numAngles) + 1;
  let offset_0 = offset - 1;
  let offset_1 = offset + 1;
  let startW = toWorld(perpIdx, alongIdx, params.spacing);

  var result = vec3f(0.0);

  if (alongIdx % 2 == 0) {
    let nearAlong = alongIdx / 2;
    let farAlong = nearAlong + 1;

    let fPerpUp = perpIdx + offset_0 * 2;
    let fPerpLo = perpIdx + offset_1 * 2;
    let endUp = toWorld(fPerpUp, farAlong, params.nextSpacing);
    let endLo = toWorld(fPerpLo, farAlong, params.nextSpacing);

    let trUp = traceRay(startW, endUp);
    let trLo = traceRay(startW, endLo);

    let farUp = readPrev(fPerpUp, farAlong, angleIdx * 2u, params.nextNumAngles);
    let farLo = readPrev(fPerpLo, farAlong, angleIdx * 2u + 1u, params.nextNumAngles);

    let nearUp = readPrev(perpIdx, nearAlong, angleIdx * 2u, params.nextNumAngles);
    let nearLo = readPrev(perpIdx, nearAlong, angleIdx * 2u + 1u, params.nextNumAngles);

    let upper = (nearUp + overComp(trUp, farUp)) * 0.5;
    let lower = (nearLo + overComp(trLo, farLo)) * 0.5;
    result = (upper * uSize + lower * lSize) / (uSize + lSize);
  } else {
    // Odd probes: between next cascade probes, trace to both
    let tAlong = alongIdx / 2 + 1;
    let tPerpUp = perpIdx + offset_0;
    let tPerpLo = perpIdx + offset_1;
    let endUp = toWorld(tPerpUp, tAlong, params.nextSpacing);
    let endLo = toWorld(tPerpLo, tAlong, params.nextSpacing);

    let trUp = traceRay(startW, endUp);
    let trLo = traceRay(startW, endLo);

    let farUp = readPrev(tPerpUp, tAlong, angleIdx * 2u, params.nextNumAngles);
    let farLo = readPrev(tPerpLo, tAlong, angleIdx * 2u + 1u, params.nextNumAngles);

    let upper = overComp(trUp, farUp);
    let lower = overComp(trLo, farLo);
    result = (upper * uSize + lower * lSize) / (uSize + lSize);
  }

  let outX = alongIdx * i32(params.numAngles) + i32(angleIdx);
  textureStore(currCascade, vec2i(outX, perpIdx), vec4f(result, 1.0));
}
`;

// ── Fluence accumulation shader ──
// Reads cascade-0 result and adds it to the running fluence total.
// Direction determines how pixel coords map to cascade-0 texel coords.

const fluenceAccumShader = /*wgsl*/ `
struct AccumParams {
  direction: u32,
  isFirstDir: u32,
  screenW: u32,
  screenH: u32,
};
@group(0) @binding(0) var cascadeTex: texture_2d<f32>;
@group(0) @binding(1) var prevFluence: texture_2d<f32>;
@group(0) @binding(2) var currFluence: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: AccumParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.screenW || gid.y >= params.screenH) { return; }
  var cc: vec2i;
  switch (params.direction) {
    case 0u: { cc = vec2i(i32(gid.x) + 1, i32(gid.y)); }
    case 1u: { cc = vec2i(i32(gid.y) + 1, i32(gid.x)); }
    case 2u: { cc = vec2i(i32(params.screenW) - i32(gid.x), i32(gid.y)); }
    case 3u: { cc = vec2i(i32(params.screenH) - i32(gid.y), i32(gid.x)); }
    default: { cc = vec2i(i32(gid.x) + 1, i32(gid.y)); }
  }
  let cv = textureLoad(cascadeTex, cc, 0);
  let pc = vec2i(gid.xy);
  if (params.isFirstDir == 1u) {
    textureStore(currFluence, pc, cv);
  } else {
    let prev = textureLoad(prevFluence, pc, 0);
    textureStore(currFluence, pc, prev + cv);
  }
}
`;

// ── Final blit shader ──

const blitShader = /*wgsl*/ `
struct BlitParams { exposure: f32, pad0: f32, pad1: f32, pad2: f32 };
@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlitParams;
@group(0) @binding(3) var linearSamp: sampler;

fn acesTonemap(x: vec3f) -> vec3f {
  return clamp(
    (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
    vec3f(0.0), vec3f(1.0),
  );
}
fn linearToSrgb(c: vec3f) -> vec3f { return pow(c, vec3f(1.0 / 2.2)); }

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn triangularDither(fragCoord: vec2u) -> vec3f {
  let seed = fragCoord.x + fragCoord.y * 8192u;
  let r0 = f32(pcg(seed)) / 4294967295.0;
  let r1 = f32(pcg(seed + 1u)) / 4294967295.0;
  return vec3f((r0 + r1 - 1.0) / 255.0);
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  return vec4f(pos[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(fluenceTex));
  let uv = pos.xy / dims;
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let emissive = world.rgb * world.a;
  let indirect = fluence;
  let hdr = (emissive + indirect) * params.exposure;
  let mapped = acesTonemap(hdr);
  let srgb = linearToSrgb(mapped) + triangularDither(vec2u(pos.xy));
  return vec4f(srgb, 1.0);
}
`;

// ── Direction definitions ──

interface DirConfig {
  alongAxis: [number, number];
  perpAxis: [number, number];
  originFn: (w: number, h: number) => [number, number];
  perpSize: (w: number, h: number) => number;
  alongBase: (w: number, h: number) => number;
}

const DIRECTIONS: DirConfig[] = [
  { alongAxis: [1, 0], perpAxis: [0, 1], originFn: () => [0, 0], perpSize: (_w, h) => h, alongBase: (w) => w },
  { alongAxis: [0, 1], perpAxis: [1, 0], originFn: () => [0, 0], perpSize: (w) => w, alongBase: (_w, h) => h },
  {
    alongAxis: [-1, 0],
    perpAxis: [0, 1],
    originFn: (w) => [w, 0],
    perpSize: (_w, h) => h,
    alongBase: (w) => w,
  },
  {
    alongAxis: [0, -1],
    perpAxis: [1, 0],
    originFn: (_w, h) => [0, h],
    perpSize: (w) => w,
    alongBase: (_w, h) => h,
  },
];

// ── Component ──

export class FolkHolographicRC extends FolkBaseSet {
  static override tagName = 'folk-holographic-rc';

  @property({ type: Number, reflect: true }) exposure = 2.0;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World texture
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;
  #worldRenderPipeline!: GPURenderPipeline;

  // Shape / line / mouse light rendering
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;
  #lines: Line[] = [];
  #lineInstanceBuffer?: GPUBuffer;
  #lineInstanceCapacity = 0;
  #lineCount = 0;
  #lineBufferDirty = false;
  #lineRenderPipeline!: GPURenderPipeline;
  #lineUBO?: GPUBuffer;
  #lineBindGroup?: GPUBindGroup;
  #mousePosition = { x: 0, y: 0 };
  #mouseLightColor = { r: 0.8, g: 0.6, b: 0.3 };
  #mouseLightRadius = 10;
  #mouseLightBuffer?: GPUBuffer;
  #mouseLightVertexCount = 0;

  // HRC cascade textures (ping-pong pair)
  #cascadeTextures!: GPUTexture[];
  #cascadeTextureViews!: GPUTextureView[];

  // Fluence textures (ping-pong for directional accumulation)
  #fluenceTextures!: GPUTexture[];
  #fluenceTextureViews!: GPUTextureView[];

  // Pipelines
  #cascadeMergePipeline!: GPUComputePipeline;
  #fluenceAccumPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Sampler
  #linearSampler!: GPUSampler;

  // Uniform buffers + structured views
  #cascadeParamsBuffer!: GPUBuffer;
  #cascadeParamsView!: StructuredView;
  #accumParamsBuffer!: GPUBuffer;
  #accumParamsView!: StructuredView;
  #blitParamsBuffer!: GPUBuffer;
  #blitParamsView!: StructuredView;

  // Computed
  #numCascades = 0;
  #maxCascadeDim = 0;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  // Debug: 0=all directions, 1=east, 2=south, 3=west, 4=north
  #debugDir = 0;
  // Debug: 0=use all cascades, >0=limit to N cascades
  #debugCascadeCount = 0;

  // Frame timing (exposed via getter for external overlays)
  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

  static readonly #colors: [number, number, number][] = [
    [0, 0, 0],
    [0.05, 0.05, 0.05],
    [1, 0.25, 0.25],
    [1, 0.5, 0.2],
    [0.75, 0.75, 0.2],
    [0.25, 0.8, 0.35],
    [0.25, 0.75, 0.75],
    [0.3, 0.4, 1],
    [0.65, 0.3, 1],
    [0.8, 0.8, 0.8],
  ];

  override async connectedCallback() {
    super.connectedCallback();
    await this.#initWebGPU();
    this.#initResources();
    this.#initPipelines();
    window.addEventListener('resize', this.#handleResize);
    window.addEventListener('mousemove', this.#handleMouseMove);
    window.addEventListener('keydown', this.#handleKeyDown);
    this.#isRunning = true;
    this.#startAnimationLoop();
    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#isRunning = false;
    if (this.#animationFrame) cancelAnimationFrame(this.#animationFrame);
    window.removeEventListener('resize', this.#handleResize);
    window.removeEventListener('mousemove', this.#handleMouseMove);
    window.removeEventListener('keydown', this.#handleKeyDown);
    this.#destroyResources();
  }

  addLine(x1: number, y1: number, x2: number, y2: number, colorIndex: number, thickness = 20) {
    const [r, g, b] = FolkHolographicRC.#colors[colorIndex] ?? FolkHolographicRC.#colors[1];
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness]);
    this.#lineBufferDirty = true;
  }

  clearLines() {
    this.#lines = [];
    this.#lineBufferDirty = true;
  }

  setMouseLightColor(r: number, g: number, b: number) {
    this.#mouseLightColor = { r, g, b };
  }

  setMouseLightRadius(radius: number) {
    this.#mouseLightRadius = radius;
  }

  eraseAt(x: number, y: number, radius: number) {
    this.#lines = this.#lines.filter((line) => {
      const [x1, y1, x2, y2] = line;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(x - x1, y - y1) > radius;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) > radius;
    });
    this.#lineBufferDirty = true;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;
    this.#updateShapeData();
  }

  // ── WebGPU init ──

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    this.#device = await adapter.requestDevice();

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#canvas.style.position = 'absolute';
    this.#canvas.style.inset = '0';
    this.#canvas.style.width = '100%';
    this.#canvas.style.height = '100%';
    this.#canvas.style.pointerEvents = 'none';
    this.renderRoot.prepend(this.#canvas);

    const context = this.#canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to get WebGPU context.');
    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
    this.#linearSampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  #initResources() {
    const { width, height } = this.#canvas;
    const device = this.#device;

    this.#maxCascadeDim = nextPowerOf2(Math.max(width, height));
    this.#numCascades = Math.log2(this.#maxCascadeDim);

    this.#worldTexture = device.createTexture({
      label: 'HRC-World',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#worldTextureView = this.#worldTexture.createView();

    const cascadeSize = this.#maxCascadeDim;
    this.#cascadeTextures = [0, 1].map((i) =>
      device.createTexture({
        label: `HRC-Cascade-${i}`,
        size: { width: cascadeSize, height: cascadeSize },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#cascadeTextureViews = this.#cascadeTextures.map((t) => t.createView());

    this.#fluenceTextures = [0, 1].map((i) =>
      device.createTexture({
        label: `HRC-Fluence-${i}`,
        size: { width, height },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#fluenceTextureViews = this.#fluenceTextures.map((t) => t.createView());

    this.#cascadeParamsView = uboView(cascadeMergeShader, 'params');
    this.#accumParamsView = uboView(fluenceAccumShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');

    this.#cascadeParamsBuffer = device.createBuffer({
      label: 'HRC-CascadeParams',
      size: this.#numCascades * 4 * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#accumParamsBuffer = device.createBuffer({
      label: 'HRC-AccumParams',
      size: 4 * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#blitParamsBuffer = device.createBuffer({
      label: 'HRC-BlitParams',
      size: this.#blitParamsView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  #initPipelines() {
    const device = this.#device;

    const worldModule = device.createShaderModule({ code: worldRenderShader });
    this.#worldRenderPipeline = device.createRenderPipeline({
      label: 'HRC-WorldRender',
      layout: 'auto',
      vertex: {
        module: worldModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x3' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: worldModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' as GPUTextureFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const lineModule = device.createShaderModule({ code: lineRenderShader });
    this.#lineRenderPipeline = device.createRenderPipeline({
      label: 'HRC-LineRender',
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'instance' as GPUVertexStepMode,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 2, offset: 16, format: 'float32x3' as GPUVertexFormat },
              { shaderLocation: 3, offset: 28, format: 'float32' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' as GPUTextureFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.#cascadeMergePipeline = createComputePipeline(device, 'HRC-CascadeMerge', cascadeMergeShader);
    this.#fluenceAccumPipeline = createComputePipeline(device, 'HRC-FluenceAccum', fluenceAccumShader);

    const blitModule = device.createShaderModule({ code: blitShader });
    this.#renderPipeline = device.createRenderPipeline({
      label: 'HRC-Blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  #destroyResources() {
    this.#worldTexture?.destroy();
    this.#cascadeTextures?.forEach((t) => t.destroy());
    this.#fluenceTextures?.forEach((t) => t.destroy());
    this.#cascadeParamsBuffer?.destroy();
    this.#accumParamsBuffer?.destroy();
    this.#blitParamsBuffer?.destroy();
  }

  // ── Shape / line data (unchanged from scaffold) ──

  #updateShapeData() {
    const vertices: number[] = [];
    const elements = Array.from(this.sourceElements);
    this.sourceRects.forEach((rect, index) => {
      const x0 = (rect.left / this.#canvas.width) * 2 - 1;
      const y0 = 1 - (rect.top / this.#canvas.height) * 2;
      const x1 = (rect.right / this.#canvas.width) * 2 - 1;
      const y1 = 1 - (rect.bottom / this.#canvas.height) * 2;
      const element = elements[index];
      const colorAttr = element?.getAttribute('data-color');
      let r: number, g: number, b: number;
      if (colorAttr !== null) {
        const colorIndex = parseInt(colorAttr) || 0;
        const color = FolkHolographicRC.#colors[colorIndex] || FolkHolographicRC.#colors[0];
        [r, g, b] = color;
      } else {
        const hue = index * 0.618;
        r = 0.5 + 0.5 * Math.sin(hue * Math.PI * 2);
        g = 0.5 + 0.5 * Math.sin((hue + 0.333) * Math.PI * 2);
        b = 0.5 + 0.5 * Math.sin((hue + 0.666) * Math.PI * 2);
      }
      vertices.push(x0, y0, r, g, b, x1, y0, r, g, b, x0, y1, r, g, b);
      vertices.push(x1, y0, r, g, b, x1, y1, r, g, b, x0, y1, r, g, b);
    });
    this.#shapeCount = this.sourceRects.length;
    if (vertices.length === 0) return;
    this.#shapeDataBuffer = uploadVertexData(this.#device, this.#shapeDataBuffer, new Float32Array(vertices));
  }

  #updateLineBuffer() {
    if (!this.#device || this.#lines.length === 0) {
      this.#lineCount = 0;
      return;
    }
    const count = this.#lines.length;
    const FPL = 8;
    if (!this.#lineInstanceBuffer || this.#lineInstanceCapacity < count) {
      this.#lineInstanceBuffer?.destroy();
      this.#lineInstanceCapacity = Math.max(count, 256);
      this.#lineInstanceBuffer = this.#device.createBuffer({
        size: this.#lineInstanceCapacity * FPL * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const data = new Float32Array(count * FPL);
    for (let i = 0; i < count; i++) {
      const [x1, y1, x2, y2, r, g, b, th] = this.#lines[i];
      const off = i * FPL;
      data[off] = x1;
      data[off + 1] = y1;
      data[off + 2] = x2;
      data[off + 3] = y2;
      data[off + 4] = r;
      data[off + 5] = g;
      data[off + 6] = b;
      data[off + 7] = th;
    }
    this.#device.queue.writeBuffer(this.#lineInstanceBuffer, 0, data);
    this.#lineCount = count;
  }

  #updateMouseLightBuffer() {
    if (!this.#device) return;
    const SEGS = 12;
    const { x, y } = this.#mousePosition;
    const { r, g, b } = this.#mouseLightColor;
    const rad = this.#mouseLightRadius;
    const toClipX = (px: number) => (px / this.#canvas.width) * 2 - 1;
    const toClipY = (py: number) => 1 - (py / this.#canvas.height) * 2;
    const rx = (rad / this.#canvas.width) * 2;
    const ry = (rad / this.#canvas.height) * 2;
    const cx = toClipX(x);
    const cy = toClipY(y);
    const verts: number[] = [];
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGS) * Math.PI * 2;
      verts.push(cx, cy, r, g, b);
      verts.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b);
      verts.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b);
    }
    this.#mouseLightVertexCount = verts.length / 5;
    this.#mouseLightBuffer = uploadVertexData(this.#device, this.#mouseLightBuffer, new Float32Array(verts));
  }

  // ── Render loop ──

  #startAnimationLoop() {
    const render = (now: number) => {
      if (!this.#isRunning) return;
      this.#updateFrameTiming(now);
      this.#renderFrame();
      this.#animationFrame = requestAnimationFrame(render);
    };
    this.#animationFrame = requestAnimationFrame(render);
  }

  #renderFrame() {
    if (this.#lineBufferDirty) {
      this.#lineBufferDirty = false;
      this.#updateLineBuffer();
    }
    this.#updateMouseLightBuffer();

    const { width, height } = this.#canvas;
    const device = this.#device;
    const numCascades = this.#numCascades;

    // Upload all cascade params for all 4 directions before encoding
    this.#uploadAllCascadeParams(width, height);

    this.#blitParamsView.set({ exposure: this.exposure });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    const encoder = device.createCommandEncoder();

    // ── Step 1: Render world texture ──
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: this.#worldTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      pass.setPipeline(this.#worldRenderPipeline);
      if (this.#shapeDataBuffer && this.#shapeCount > 0) {
        pass.setVertexBuffer(0, this.#shapeDataBuffer);
        pass.draw(this.#shapeCount * 6);
      }
      if (this.#lineInstanceBuffer && this.#lineCount > 0) {
        pass.setPipeline(this.#lineRenderPipeline);
        if (!this.#lineBindGroup) {
          this.#lineUBO?.destroy();
          this.#lineUBO = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
          device.queue.writeBuffer(this.#lineUBO, 0, new Float32Array([width, height]));
          this.#lineBindGroup = device.createBindGroup({
            layout: this.#lineRenderPipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.#lineUBO } }],
          });
        }
        pass.setBindGroup(0, this.#lineBindGroup);
        pass.setVertexBuffer(0, this.#lineInstanceBuffer);
        pass.draw(6, this.#lineCount);
        pass.setPipeline(this.#worldRenderPipeline);
      }
      if (this.#mouseLightBuffer && this.#mouseLightVertexCount > 0) {
        pass.setVertexBuffer(0, this.#mouseLightBuffer);
        pass.draw(this.#mouseLightVertexCount);
      }
      pass.end();
    }

    // ── Step 2: HRC cascade processing for each direction ──
    let fluenceReadView = this.#fluenceTextureViews[0];
    let fluenceWriteView = this.#fluenceTextureViews[1];
    let fluenceResultView = this.#fluenceTextureViews[0];
    let isFirstProcessedDir = true;

    for (let dir = 0; dir < 4; dir++) {
      if (this.#debugDir > 0 && dir !== this.#debugDir - 1) continue;

      const cfg = DIRECTIONS[dir];
      const perpSize = cfg.perpSize(width, height);
      const alongBase = nextPowerOf2(cfg.alongBase(width, height));
      const dirCascades = Math.log2(alongBase);

      const effectiveCascades = this.#debugCascadeCount > 0
        ? Math.min(this.#debugCascadeCount, dirCascades)
        : dirCascades;
      let lastWriteView = this.#cascadeTextureViews[0];
      for (let level = effectiveCascades - 1; level >= 0; level--) {
        const k = numCascades - 1 - level;
        const readFromA = k % 2 !== 0;
        const readView = this.#cascadeTextureViews[readFromA ? 0 : 1];
        const writeView = this.#cascadeTextureViews[readFromA ? 1 : 0];

        const spacing = 1 << level;
        const alongSize = alongBase >> level;
        const numAngles = 1 << level;

        const flatSize = alongSize * numAngles;
        const paramsOffset = (dir * numCascades + (numCascades - 1 - level)) * 256;

        const bg = device.createBindGroup({
          layout: this.#cascadeMergePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#worldTextureView },
            { binding: 1, resource: readView },
            { binding: 2, resource: writeView },
            { binding: 3, resource: { buffer: this.#cascadeParamsBuffer, offset: paramsOffset, size: 64 } },
            { binding: 4, resource: this.#linearSampler },
          ],
        });

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#cascadeMergePipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(perpSize / 16), Math.ceil(flatSize / 16));
        pass.end();
        lastWriteView = writeView;
      }

      // Use the stopped level's output (or cascade 0 in normal mode)
      const cascade0View = lastWriteView;

      const accumOffset = dir * 256;
      this.#accumParamsView.set({ direction: dir, isFirstDir: isFirstProcessedDir ? 1 : 0, screenW: width, screenH: height });
      device.queue.writeBuffer(this.#accumParamsBuffer, accumOffset, this.#accumParamsView.arrayBuffer);

      if (isFirstProcessedDir) {
        isFirstProcessedDir = false;
        fluenceWriteView = this.#fluenceTextureViews[0];
        fluenceReadView = this.#fluenceTextureViews[1];
      } else {
        const temp = fluenceWriteView;
        fluenceWriteView = fluenceReadView;
        fluenceReadView = temp;
      }

      const accumBG = device.createBindGroup({
        layout: this.#fluenceAccumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: cascade0View },
          { binding: 1, resource: fluenceReadView },
          { binding: 2, resource: fluenceWriteView },
          { binding: 3, resource: { buffer: this.#accumParamsBuffer, offset: accumOffset, size: 16 } },
        ],
      });

      const accumPass = encoder.beginComputePass();
      accumPass.setPipeline(this.#fluenceAccumPipeline);
      accumPass.setBindGroup(0, accumBG);
      accumPass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      accumPass.end();

      fluenceResultView = fluenceWriteView;
    }

    // ── Step 3: Final blit ──
    {
      const blitBG = device.createBindGroup({
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: fluenceResultView },
          { binding: 1, resource: this.#worldTextureView },
          { binding: 2, resource: { buffer: this.#blitParamsBuffer } },
          { binding: 3, resource: this.#linearSampler },
        ],
      });

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(this.#renderPipeline);
      pass.setBindGroup(0, blitBG);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.draw(4);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  #uploadAllCascadeParams(width: number, height: number) {
    const numCascades = this.#numCascades;
    const device = this.#device;

    for (let dir = 0; dir < 4; dir++) {
      const cfg = DIRECTIONS[dir];
      const perpSize = cfg.perpSize(width, height);
      const alongBase = nextPowerOf2(cfg.alongBase(width, height));
      const dirCascades = Math.log2(alongBase);
      const [originX, originY] = cfg.originFn(width, height);
      const [axX, axY] = cfg.alongAxis;
      const [pxX, pxY] = cfg.perpAxis;

      for (let level = dirCascades - 1; level >= 0; level--) {
        const spacing = 1 << level;
        this.#cascadeParamsView.set({
          perpSize,
          alongSize: alongBase >> level,
          numAngles: 1 << level,
          spacing,
          nextNumAngles: 1 << (level + 1),
          nextSpacing: 1 << (level + 1),
          nextAlongSize: alongBase >> (level + 1),
          isLastCascade: level === dirCascades - 1 ? 1 : 0,
          screenW: width,
          screenH: height,
          originX, originY,
          alongAxisX: axX, alongAxisY: axY,
          perpAxisX: pxX, perpAxisY: pxY,
        });
        const slotIndex = dir * numCascades + (numCascades - 1 - level);
        device.queue.writeBuffer(this.#cascadeParamsBuffer, slotIndex * 256, this.#cascadeParamsView.arrayBuffer);
      }
    }
  }

  // ── Event handlers ──

  #handleResize = async () => {
    if (this.#resizing) return;
    this.#resizing = true;
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);
    await this.#device.queue.onSubmittedWorkDone();

    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });
    this.#destroyResources();
    this.#initResources();
    this.#lineBindGroup = undefined;
    this.#updateShapeData();

    this.#resizing = false;
    this.#isRunning = true;
    this.#startAnimationLoop();
  };

  #handleMouseMove = (e: MouseEvent) => {
    const rect = this.getBoundingClientRect();
    this.#mousePosition.x = e.clientX - rect.left;
    this.#mousePosition.y = e.clientY - rect.top;
  };

  #handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'd' || e.key === 'D') {
      this.#debugDir = (this.#debugDir + 1) % 5;
      const names = ['All', 'East', 'South', 'West', 'North'];
      console.log(`HRC debug dir: ${names[this.#debugDir]}`);
    }
    if (e.key === '`' || e.key === '~') {
      const delta = e.shiftKey ? -1 : 1;
      this.#debugCascadeCount = ((this.#debugCascadeCount + delta) % (this.#numCascades + 1) + this.#numCascades + 1) % (this.#numCascades + 1);
      const maxSpacing = this.#debugCascadeCount > 0 ? Math.pow(2, this.#debugCascadeCount - 1) : Math.pow(2, this.#numCascades - 1);
      const label = this.#debugCascadeCount === 0 ? `all (max spacing ${maxSpacing})` : `${this.#debugCascadeCount} (max spacing ${maxSpacing})`;
      console.log(`HRC cascades: ${label}`);
    }
  };

  get fps() {
    return this.#smoothedFrameTime > 0 ? Math.round(1000 / this.#smoothedFrameTime) : 0;
  }

  get frameTimeMs() {
    return this.#smoothedFrameTime;
  }

  get resolution() {
    return { width: this.#canvas?.width ?? 0, height: this.#canvas?.height ?? 0 };
  }

  get debugInfo() {
    const dirNames = ['All', 'E', 'S', 'W', 'N'];
    const dirLabel = this.#debugDir > 0 ? ` [${dirNames[this.#debugDir]}]` : '';
    const ec = this.#debugCascadeCount > 0 ? this.#debugCascadeCount : this.#numCascades;
    const ccLabel = this.#debugCascadeCount > 0 ? ` C${this.#debugCascadeCount}/${this.#numCascades}` : '';
    return `${dirLabel}${ccLabel} sp${Math.pow(2, ec - 1)}`;
  }

  #updateFrameTiming(now: number) {
    if (this.#lastFrameTimestamp > 0) {
      const dt = now - this.#lastFrameTimestamp;
      const alpha = 0.05;
      this.#smoothedFrameTime =
        this.#smoothedFrameTime === 0 ? dt : this.#smoothedFrameTime + alpha * (dt - this.#smoothedFrameTime);
    }
    this.#lastFrameTimestamp = now;
  }
}
