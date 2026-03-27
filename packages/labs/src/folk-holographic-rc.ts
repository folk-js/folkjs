import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

type Line = [x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, thickness: number];

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

fn toWorld(perpIdx: i32, alongIdx: i32, sp: f32) -> vec2f {
  return vec2f(params.originX, params.originY)
       + vec2f(params.perpAxisX, params.perpAxisY) * f32(perpIdx)
       + vec2f(params.alongAxisX, params.alongAxisY) * (f32(alongIdx) * sp);
}

fn readPrev(perpIdx: i32, alongIdx: i32, angleIdx: u32, numAng: u32) -> vec3f {
  let x = alongIdx * i32(numAng) + i32(angleIdx);
  let y = perpIdx;
  if (x < 0 || y < 0) { return vec3f(0.0); }
  let dims = textureDimensions(prevCascade);
  if (u32(x) >= dims.x || u32(y) >= dims.y) { return vec3f(0.0); }
  return textureLoad(prevCascade, vec2i(x, y), 0).rgb;
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
  let numSteps = clamp(u32(ceil(dist)), 1u, 128u);
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

  var result = vec3f(0.0);

  if (params.isLastCascade == 0u) {
    let uSize = angSize(angleIdx * 2u, params.nextNumAngles, params.nextSpacing);
    let lSize = angSize(angleIdx * 2u + 1u, params.nextNumAngles, params.nextSpacing);
    let offset = 2 * i32(angleIdx) - i32(params.numAngles) + 1;
    let offset_0 = offset - 1;
    let offset_1 = offset + 1;
    let startW = toWorld(perpIdx, alongIdx, params.spacing);

    if (alongIdx % 2 == 0) {
      let nearAlong = alongIdx / 2;
      let farAlong = nearAlong + 1;

      let nearUp = readPrev(perpIdx, nearAlong, angleIdx * 2u, params.nextNumAngles);
      let nearLo = readPrev(perpIdx, nearAlong, angleIdx * 2u + 1u, params.nextNumAngles);

      let fPerpUp = perpIdx + offset_0 * 2;
      let fPerpLo = perpIdx + offset_1 * 2;
      let endUp = toWorld(fPerpUp, farAlong, params.nextSpacing);
      let endLo = toWorld(fPerpLo, farAlong, params.nextSpacing);

      let trUp = traceRay(startW, endUp);
      let trLo = traceRay(startW, endLo);

      let farUp = readPrev(fPerpUp, farAlong, angleIdx * 2u, params.nextNumAngles);
      let farLo = readPrev(fPerpLo, farAlong, angleIdx * 2u + 1u, params.nextNumAngles);

      let upper = (nearUp + overComp(trUp, farUp)) * 0.5;
      let lower = (nearLo + overComp(trLo, farLo)) * 0.5;
      result = (upper * uSize + lower * lSize) / (uSize + lSize);
    } else {
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
  }

  let outX = alongIdx * i32(params.numAngles) + i32(angleIdx);
  textureStore(currCascade, vec2i(outX, perpIdx), vec4f(result, 1.0));
}
`;

// ── Clear texture shader ──

const clearShader = /*wgsl*/ `
@group(0) @binding(0) var tex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(tex);
  if (gid.x < dims.x && gid.y < dims.y) {
    textureStore(tex, gid.xy, vec4f(0.0));
  }
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
    case 0u: { cc = vec2i(gid.xy); }
    case 1u: { cc = vec2i(i32(gid.y), i32(gid.x)); }
    case 2u: { cc = vec2i(i32(params.screenW) - 1 - i32(gid.x), i32(gid.y)); }
    case 3u: { cc = vec2i(i32(params.screenH) - 1 - i32(gid.y), i32(gid.x)); }
    default: { cc = vec2i(gid.xy); }
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

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  return vec4f(pos[i], 0, 1);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let fluence = textureLoad(fluenceTex, vec2u(pos.xy), 0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let lit = fluence * params.exposure;
  let emission = world.rgb * world.a * 0.15;
  return vec4f(lit + emission, 1.0);
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
    originFn: (w) => [w - 1, 0],
    perpSize: (_w, h) => h,
    alongBase: (w) => w,
  },
  {
    alongAxis: [0, -1],
    perpAxis: [1, 0],
    originFn: (_w, h) => [0, h - 1],
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
  #cascadeTexA!: GPUTexture;
  #cascadeTexAView!: GPUTextureView;
  #cascadeTexB!: GPUTexture;
  #cascadeTexBView!: GPUTextureView;

  // Fluence textures (ping-pong for directional accumulation)
  #fluenceTexA!: GPUTexture;
  #fluenceTexAView!: GPUTextureView;
  #fluenceTexB!: GPUTexture;
  #fluenceTexBView!: GPUTextureView;

  // Pipelines
  #cascadeMergePipeline!: GPUComputePipeline;
  #clearPipeline!: GPUComputePipeline;
  #fluenceAccumPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Uniform buffers
  #cascadeParamsBuffer!: GPUBuffer;
  #accumParamsBuffer!: GPUBuffer;
  #blitParamsBuffer!: GPUBuffer;

  // Computed
  #numCascades = 0;
  #maxCascadeDim = 0;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

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
  }

  #initResources() {
    const { width, height } = this.#canvas;
    const device = this.#device;

    this.#numCascades = Math.ceil(Math.log2(Math.max(width, height)));
    this.#maxCascadeDim = Math.max(width, height);

    this.#worldTexture = device.createTexture({
      label: 'HRC-World',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#worldTextureView = this.#worldTexture.createView();

    const cascadeSize = this.#maxCascadeDim;
    for (const label of ['A', 'B'] as const) {
      const tex = device.createTexture({
        label: `HRC-Cascade-${label}`,
        size: { width: cascadeSize, height: cascadeSize },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      if (label === 'A') {
        this.#cascadeTexA = tex;
        this.#cascadeTexAView = tex.createView();
      } else {
        this.#cascadeTexB = tex;
        this.#cascadeTexBView = tex.createView();
      }
    }

    for (const label of ['A', 'B'] as const) {
      const tex = device.createTexture({
        label: `HRC-Fluence-${label}`,
        size: { width, height },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      if (label === 'A') {
        this.#fluenceTexA = tex;
        this.#fluenceTexAView = tex.createView();
      } else {
        this.#fluenceTexB = tex;
        this.#fluenceTexBView = tex.createView();
      }
    }

    // Uniform buffers — cascade params (one slot per cascade per direction)
    const maxSlots = this.#numCascades * 4;
    this.#cascadeParamsBuffer = device.createBuffer({
      label: 'HRC-CascadeParams',
      size: maxSlots * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.#accumParamsBuffer = device.createBuffer({
      label: 'HRC-AccumParams',
      size: 4 * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.#blitParamsBuffer = device.createBuffer({
      label: 'HRC-BlitParams',
      size: 16,
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

    this.#cascadeMergePipeline = device.createComputePipeline({
      label: 'HRC-CascadeMerge',
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: cascadeMergeShader }), entryPoint: 'main' },
    });

    this.#clearPipeline = device.createComputePipeline({
      label: 'HRC-Clear',
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: clearShader }), entryPoint: 'main' },
    });

    this.#fluenceAccumPipeline = device.createComputePipeline({
      label: 'HRC-FluenceAccum',
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: fluenceAccumShader }), entryPoint: 'main' },
    });

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
    this.#cascadeTexA?.destroy();
    this.#cascadeTexB?.destroy();
    this.#fluenceTexA?.destroy();
    this.#fluenceTexB?.destroy();
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
    const render = () => {
      if (!this.#isRunning) return;
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

    // Upload blit params
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, new Float32Array([this.exposure, 0, 0, 0]));

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
    const cascadeDim = this.#maxCascadeDim;
    const clearWG = Math.ceil(cascadeDim / 16);

    // Track which fluence texture is the "current" output
    let fluenceReadView = this.#fluenceTexAView;
    let fluenceWriteView = this.#fluenceTexBView;
    let fluenceResultView = this.#fluenceTexAView;

    for (let dir = 0; dir < 4; dir++) {
      const cfg = DIRECTIONS[dir];
      const perpSize = cfg.perpSize(width, height);
      const alongBase = cfg.alongBase(width, height);

      // Clear both cascade textures
      for (const view of [this.#cascadeTexAView, this.#cascadeTexBView]) {
        const bg = device.createBindGroup({
          layout: this.#clearPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: view }],
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#clearPipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(clearWG, clearWG);
        pass.end();
      }

      // Process cascades from highest (numCascades-1) to 0
      for (let level = numCascades - 1; level >= 0; level--) {
        const k = numCascades - 1 - level;
        const readFromA = k % 2 !== 0;
        const readView = readFromA ? this.#cascadeTexAView : this.#cascadeTexBView;
        const writeView = readFromA ? this.#cascadeTexBView : this.#cascadeTexAView;

        const spacing = Math.pow(2, level);
        const alongSize = Math.max(Math.floor(alongBase / spacing), 1);
        const numAngles = Math.pow(2, level);

        const flatSize = alongSize * numAngles;
        const paramsOffset = (dir * numCascades + (numCascades - 1 - level)) * 256;

        const bg = device.createBindGroup({
          layout: this.#cascadeMergePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#worldTextureView },
            { binding: 1, resource: readView },
            { binding: 2, resource: writeView },
            { binding: 3, resource: { buffer: this.#cascadeParamsBuffer, offset: paramsOffset, size: 64 } },
          ],
        });

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#cascadeMergePipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(perpSize / 16), Math.ceil(flatSize / 16));
        pass.end();
      }

      // Determine which cascade texture has cascade-0 result
      const cascade0K = numCascades - 1;
      const cascade0InA = cascade0K % 2 !== 0;
      const cascade0View = cascade0InA ? this.#cascadeTexBView : this.#cascadeTexAView;

      // Upload accumulation params
      const accumOffset = dir * 256;
      device.queue.writeBuffer(
        this.#accumParamsBuffer,
        accumOffset,
        new Uint32Array([dir, dir === 0 ? 1 : 0, width, height]),
      );

      // Fluence accumulation ping-pong
      if (dir === 0) {
        fluenceWriteView = this.#fluenceTexAView;
        fluenceReadView = this.#fluenceTexBView;
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
      const alongBase = cfg.alongBase(width, height);
      const [originX, originY] = cfg.originFn(width, height);
      const [axX, axY] = cfg.alongAxis;
      const [pxX, pxY] = cfg.perpAxis;

      for (let level = numCascades - 1; level >= 0; level--) {
        const spacing = Math.pow(2, level);
        const alongSize = Math.max(Math.floor(alongBase / spacing), 1);
        const numAngles = Math.pow(2, level);

        const isLast = level === numCascades - 1 ? 1 : 0;
        const nextSpacing = Math.pow(2, level + 1);
        const nextNumAngles = Math.pow(2, level + 1);
        const nextAlongSize = Math.max(Math.floor(alongBase / nextSpacing), 1);

        const data = new ArrayBuffer(64);
        const u32 = new Uint32Array(data);
        const f32 = new Float32Array(data);

        u32[0] = perpSize;
        u32[1] = alongSize;
        u32[2] = numAngles;
        f32[3] = spacing;
        u32[4] = nextNumAngles;
        f32[5] = nextSpacing;
        u32[6] = nextAlongSize;
        u32[7] = isLast;
        f32[8] = width;
        f32[9] = height;
        f32[10] = originX;
        f32[11] = originY;
        f32[12] = axX;
        f32[13] = axY;
        f32[14] = pxX;
        f32[15] = pxY;

        const slotIndex = dir * numCascades + (numCascades - 1 - level);
        device.queue.writeBuffer(this.#cascadeParamsBuffer, slotIndex * 256, data);
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
}
