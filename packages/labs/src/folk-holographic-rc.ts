import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

type Line = [
  x1: number, y1: number, x2: number, y2: number,
  r: number, g: number, b: number, thickness: number,
  ar: number, ag: number, ab: number,
];

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

// ── World-render shaders (shapes, lines, mouse light → emission + attenuation) ──
// MRT: location(0) = emission (rgb = emitted light), location(1) = attenuation (rgb = per-channel absorption)
// Vertex data carries: position (vec2), color (vec3), attenuation (vec3)

const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) attenuation: vec3f,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) attenuation: vec3f,
}
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  out.attenuation = input.attenuation;
  return out;
}
struct FragOut { @location(0) emission: vec4f, @location(1) attenuation: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  var out: FragOut;
  out.emission = vec4f(srgbToLinear(in.color), 1.0);
  out.attenuation = vec4f(in.attenuation, 1.0);
  return out;
}
`;

const lineRenderShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) p1: vec2f,
  @location(2) p2: vec2f,
  @location(3) radius: f32,
  @location(4) attenuation: vec3f,
}
struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f, @location(1) p2: vec2f,
  @location(2) color: vec3f, @location(3) thickness: f32,
  @location(4) attenuation: vec3f,
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
  out.attenuation = attenuation;
  return out;
}
struct FragOut { @location(0) emission: vec4f, @location(1) attenuation: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  let pos = in.position.xy;
  let ab = in.p2 - in.p1; let ap = pos - in.p1;
  let lenSq = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / lenSq, 0.0, 1.0), 0.0, lenSq < 0.001);
  let nearest = in.p1 + ab * t;
  let d = length(pos - nearest) - in.radius;
  if (d > 0.0) { discard; }
  var out: FragOut;
  out.emission = vec4f(srgbToLinear(in.color), 1.0);
  out.attenuation = vec4f(in.attenuation, 1.0);
  return out;
}
`;

// ── HRC Phase A: Ray Seed (cascade 0) ──
// Samples emission and attenuation textures at each probe position using
// volumetric transport: T = exp(-sigma * d), L += T * emission * (1-T_step)/sigma.
// Both ray indices per probe receive the same value (differentiation happens
// during extension). Writes radiance to rayOut and per-channel transmittance
// to transOut (rgba8unorm, rgb = per-channel transmittance).

const raySeedShader = /*wgsl*/ `
struct SeedParams {
  probeSize: u32,
  screenW: f32,
  screenH: f32,
  pad0: u32,
  originX: f32,
  originY: f32,
  alongAxisX: f32,
  alongAxisY: f32,
  perpAxisX: f32,
  perpAxisY: f32,
  scaleAlong: f32,
  scalePerp: f32,
};

@group(0) @binding(0) var emissionTex: texture_2d<f32>;
@group(0) @binding(1) var attenuationTex: texture_2d<f32>;
@group(0) @binding(2) var rayOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var transOut: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: SeedParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x);
  let perpIdx = i32(gid.y);
  let ps = i32(params.probeSize);
  let probeIdx = texelX / 2;
  if (probeIdx >= ps || perpIdx >= ps) { return; }

  let wp = vec2f(params.originX, params.originY)
         + vec2f(params.alongAxisX, params.alongAxisY) * (f32(probeIdx) + 0.5) * params.scaleAlong
         + vec2f(params.perpAxisX, params.perpAxisY) * (f32(perpIdx) + 0.5) * params.scalePerp;

  let px = vec2i(i32(floor(wp.x)), i32(floor(wp.y)));
  var rad = vec3f(0.0);
  var trans = vec3f(1.0);
  if (px.x >= 0 && px.y >= 0 && px.x < i32(params.screenW) && px.y < i32(params.screenH)) {
    let emission = textureLoad(emissionTex, px, 0).rgb;
    let sigma = textureLoad(attenuationTex, px, 0).rgb;
    let tStep = exp(-sigma);
    let f = select((1.0 - tStep) / max(sigma, vec3f(1e-6)), vec3f(1.0), sigma < vec3f(1e-4));
    rad = trans * emission * f;
    trans *= tStep;
  }

  let coord = vec2i(texelX, perpIdx);
  textureStore(rayOut, coord, vec4f(rad, 0.0));
  textureStore(transOut, coord, vec4f(trans, 1.0));
}
`;

// ── HRC Phase B: Ray Extension (bottom-up, levels 1..N-1) ──
// Composes two shorter rays from the previous level into one longer ray.
// For each output ray, builds two crossed extensions (L→R, R→L) and averages.
// Follows Yaazarai Shd_Extensions and Amitabha merge_up.

const rayExtendShader = /*wgsl*/ `
struct ExtendParams {
  probeSize: u32,
  level: u32,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var prevRayTex: texture_2d<f32>;
@group(0) @binding(1) var prevTransTex: texture_2d<f32>;
@group(0) @binding(2) var currRayTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var currTransTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(4) var<uniform> params: ExtendParams;

struct RayData { rad: vec3f, trans: vec3f }

fn loadPrev(probeIdx: i32, rayIdx: i32, perpIdx: i32) -> RayData {
  let prevLevel = params.level - 1u;
  let prevInterval = i32(1u << prevLevel);
  let prevNumRays = prevInterval + 1;
  let prevNumProbes = i32(params.probeSize >> prevLevel);
  if (probeIdx < 0 || probeIdx >= prevNumProbes ||
      rayIdx < 0 || rayIdx >= prevNumRays ||
      perpIdx < 0 || perpIdx >= i32(params.probeSize)) {
    return RayData(vec3f(0.0), vec3f(1.0));
  }
  let coord = vec2i(probeIdx * prevNumRays + rayIdx, perpIdx);
  let r = textureLoad(prevRayTex, coord, 0).rgb;
  let t = textureLoad(prevTransTex, coord, 0).rgb;
  return RayData(r, t);
}

fn overComp(near: RayData, far: RayData) -> RayData {
  return RayData(near.rad + far.rad * near.trans, near.trans * far.trans);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x);
  let perpIdx = i32(gid.y);

  let interval = i32(1u << params.level);
  let numRays = interval + 1;
  let numProbes = i32(params.probeSize >> params.level);
  let probeIdx = texelX / numRays;
  let rayIdx = texelX - probeIdx * numRays;

  if (probeIdx >= numProbes || perpIdx >= i32(params.probeSize)) { return; }

  let prevInterval = interval / 2;
  let lower = rayIdx / 2;
  let upper = (rayIdx + 1) / 2;

  let perpOffL = -prevInterval + lower * 2;
  let extL = overComp(
    loadPrev(probeIdx * 2, lower, perpIdx),
    loadPrev(probeIdx * 2 + 1, upper, perpIdx + perpOffL),
  );

  let perpOffR = -prevInterval + upper * 2;
  let extR = overComp(
    loadPrev(probeIdx * 2, upper, perpIdx),
    loadPrev(probeIdx * 2 + 1, lower, perpIdx + perpOffR),
  );

  let coord = vec2i(texelX, perpIdx);
  textureStore(currRayTex, coord, vec4f((extL.rad + extR.rad) * 0.5, 0.0));
  textureStore(currTransTex, coord, vec4f((extL.trans + extR.trans) * 0.5, 1.0));
}
`;

// ── HRC Phase C: Cone Merge (top-down, levels N-1..0) ──
// Reads pre-computed ray data from the ray texture and merges with previously
// merged cones from the coarser level. Even/odd probe parity is handled as in
// the Amitabha reference: even probes compose two rays and average with the
// near-probe cone; odd probes do a direct over-composite.

const coneMergeShader = /*wgsl*/ `
struct MergeParams {
  probeSize: u32,
  numCones: u32,
  numProbes: u32,
  numRays: u32,
  nextNumCones: u32,
  isLastLevel: u32,
  aspect: f32,
  pad0: u32,
};

@group(0) @binding(0) var rayTex: texture_2d<f32>;
@group(0) @binding(1) var rayTransTex: texture_2d<f32>;
@group(0) @binding(2) var mergeIn: texture_2d<f32>;
@group(0) @binding(3) var mergeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: MergeParams;

struct RayData { rad: vec3f, trans: vec3f }

fn loadRay(probeIdx: i32, rayIdx: i32, perpIdx: i32) -> RayData {
  if (probeIdx < 0 || probeIdx >= i32(params.numProbes) ||
      rayIdx < 0 || rayIdx >= i32(params.numRays) ||
      perpIdx < 0 || perpIdx >= i32(params.probeSize)) {
    return RayData(vec3f(0.0), vec3f(1.0));
  }
  let coord = vec2i(probeIdx * i32(params.numRays) + rayIdx, perpIdx);
  return RayData(
    textureLoad(rayTex, coord, 0).rgb,
    textureLoad(rayTransTex, coord, 0).rgb,
  );
}

fn loadMerge(texX: i32, perpIdx: i32) -> vec3f {
  if (params.isLastLevel == 1u ||
      texX < 0 || texX >= i32(params.probeSize) ||
      perpIdx < 0 || perpIdx >= i32(params.probeSize)) {
    return vec3f(0.0);
  }
  return textureLoad(mergeIn, vec2i(texX, perpIdx), 0).rgb;
}

fn angWeight(subCone: u32, numAng: u32) -> f32 {
  let N = f32(numAng);
  let s = f32(subCone);
  let a = params.aspect;
  return atan2((2.0 * s - N + 2.0) * a, N) - atan2((2.0 * s - N) * a, N);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let perpIdx = i32(gid.x);
  let flatIdx = i32(gid.y);
  let nc = i32(params.numCones);
  let probeIdx = flatIdx / nc;
  let coneIdx = flatIdx - probeIdx * nc;

  if (probeIdx >= i32(params.numProbes) || perpIdx >= i32(params.probeSize)) { return; }

  var result = vec3f(0.0);

  for (var side = 0; side < 2; side++) {
    let subCone = u32(coneIdx * 2 + side);
    let vrayI = coneIdx + side;
    let cW = angWeight(subCone, params.nextNumCones);

    let ray = loadRay(probeIdx, vrayI, perpIdx);
    let perpOff = -nc + vrayI * 2;
    let isEven = (probeIdx % 2 == 0);
    let align = select(1, 2, isEven);

    let farX = (probeIdx + align) * nc + i32(subCone);
    let farCone = loadMerge(farX, perpIdx + perpOff * align);

    if (isEven) {
      let ext = loadRay(probeIdx + 1, vrayI, perpIdx + perpOff);
      let cRad = ray.rad + ext.rad * ray.trans;
      let cTrans = ray.trans * ext.trans;
      let merged = cRad * cW + farCone * cTrans;
      let nearCone = loadMerge(probeIdx * nc + i32(subCone), perpIdx);
      result += (merged + nearCone) * 0.5;
    } else {
      result += ray.rad * cW + farCone * ray.trans;
    }
  }

  let outX = probeIdx * nc + coneIdx;
  textureStore(mergeOut, vec2i(outX, perpIdx), vec4f(result, 1.0));
}
`;

// ── Fluence accumulation shader ──
// Reads the level-0 merge result and adds it to the running fluence total.
// Operates at probe resolution. Direction determines coordinate mapping.
// The 1-pixel offset prevents diagonal sampling overlap between frustums.

const fluenceAccumShader = /*wgsl*/ `
struct AccumParams {
  direction: u32,
  isFirstDir: u32,
  probeSize: u32,
  pad: u32,
};
@group(0) @binding(0) var cascadeTex: texture_2d<f32>;
@group(0) @binding(1) var prevFluence: texture_2d<f32>;
@group(0) @binding(2) var currFluence: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: AccumParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let ps = params.probeSize;
  if (gid.x >= ps || gid.y >= ps) { return; }
  var cc: vec2i;
  switch (params.direction) {
    case 0u: { cc = vec2i(i32(gid.x) + 1, i32(gid.y)); }
    case 1u: { cc = vec2i(i32(gid.y) + 1, i32(gid.x)); }
    case 2u: { cc = vec2i(i32(ps) - i32(gid.x), i32(gid.y)); }
    case 3u: { cc = vec2i(i32(ps) - i32(gid.y), i32(gid.x)); }
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
// Bilinearly upscales fluence from probe resolution to screen resolution.
// Uses attenuation texture to compute per-channel opacity for masking indirect light.

const blitShader = /*wgsl*/ `
struct BlitParams { exposure: f32, screenW: f32, screenH: f32, pad: f32 };
@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var attenuationTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: BlitParams;
@group(0) @binding(4) var linearSamp: sampler;

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
  let uv = pos.xy / vec2f(params.screenW, params.screenH);
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let emission = textureLoad(emissionTex, vec2u(pos.xy), 0).rgb;
  let sigma = textureLoad(attenuationTex, vec2u(pos.xy), 0).rgb;
  let opacity = 1.0 - exp(-sigma);
  let emissive = emission * opacity;
  let indirect = fluence * (1.0 - opacity);
  let hdr = (emissive + indirect) * params.exposure;
  let mapped = acesTonemap(hdr);
  let srgb = linearToSrgb(mapped) + triangularDither(vec2u(pos.xy));
  return vec4f(srgb, 1.0);
}
`;

// ── Direction definitions (simplified for square probe grid) ──

const DIR_ALONG: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const DIR_PERP: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, 1],
  [1, 0],
];

function dirOrigin(dir: number, w: number, h: number): [number, number] {
  if (dir === 2) return [w, 0];
  if (dir === 3) return [0, h];
  return [0, 0];
}

function dirScales(dir: number, w: number, h: number, ps: number): [number, number] {
  const horiz = dir === 0 || dir === 2;
  return horiz ? [w / ps, h / ps] : [h / ps, w / ps];
}

// ── Component ──

export class FolkHolographicRC extends FolkBaseSet {
  static override tagName = 'folk-holographic-rc';

  @property({ type: Number, reflect: true }) exposure = 2.0;
  @property({ type: Number, reflect: true }) probeSize = 1024;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World textures (emission + attenuation, MRT)
  #emissionTexture!: GPUTexture;
  #emissionTextureView!: GPUTextureView;
  #attenuationTexture!: GPUTexture;
  #attenuationTextureView!: GPUTextureView;
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

  // Per-level ray textures: radiance (rgba16float) + transmittance (rgba8unorm)
  #rayTextures!: GPUTexture[];
  #rayTextureViews!: GPUTextureView[];
  #transTextures!: GPUTexture[];
  #transTextureViews!: GPUTextureView[];

  // Merge ping-pong pair (probeSize x probeSize)
  #mergeTextures!: GPUTexture[];
  #mergeTextureViews!: GPUTextureView[];

  // Fluence ping-pong pair (probeSize x probeSize)
  #fluenceTextures!: GPUTexture[];
  #fluenceTextureViews!: GPUTextureView[];

  // Pipelines
  #raySeedPipeline!: GPUComputePipeline;
  #rayExtendPipeline!: GPUComputePipeline;
  #coneMergePipeline!: GPUComputePipeline;
  #fluenceAccumPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Pre-created bind groups (recreated on resize)
  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][]; // [dir][mergeStep k]
  #mergeResultIdx!: number; // which merge texture holds level-0 result at full cascade count

  // Sampler
  #linearSampler!: GPUSampler;

  // Uniform buffers + structured views
  #seedParamsBuffer!: GPUBuffer;
  #seedParamsView!: StructuredView;
  #extendParamsBuffer!: GPUBuffer;
  #extendParamsView!: StructuredView;
  #mergeParamsBuffer!: GPUBuffer;
  #mergeParamsView!: StructuredView;
  #accumParamsBuffer!: GPUBuffer;
  #accumParamsView!: StructuredView;
  #blitParamsBuffer!: GPUBuffer;
  #blitParamsView!: StructuredView;

  // Computed
  #numCascades = 0;
  #ps = 0;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  #debugDir = 0;
  #debugCascadeCount = 0;

  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

  static readonly #colors: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, 0],
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
    this.#uploadStaticParams(this.#canvas.width, this.#canvas.height);
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

  addLine(
    x1: number, y1: number, x2: number, y2: number,
    colorIndex: number, thickness = 20, attenuation: [number, number, number] = [5, 5, 5],
  ) {
    const [r, g, b] = FolkHolographicRC.#colors[colorIndex] ?? FolkHolographicRC.#colors[1];
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness, attenuation[0], attenuation[1], attenuation[2]]);
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
    const ps = nextPowerOf2(this.probeSize);
    this.#ps = ps;
    this.#numCascades = Math.log2(ps);

    this.#emissionTexture = device.createTexture({
      label: 'HRC-Emission',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#emissionTextureView = this.#emissionTexture.createView();

    this.#attenuationTexture = device.createTexture({
      label: 'HRC-Attenuation',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#attenuationTextureView = this.#attenuationTexture.createView();

    this.#rayTextures = [];
    this.#rayTextureViews = [];
    this.#transTextures = [];
    this.#transTextureViews = [];
    for (let i = 0; i < this.#numCascades; i++) {
      const interval = 1 << i;
      const numRays = interval + 1;
      const numProbes = ps >> i;
      const w = numProbes * numRays;
      const rayTex = device.createTexture({
        label: `HRC-Ray-${i}`,
        size: { width: w, height: ps },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.#rayTextures.push(rayTex);
      this.#rayTextureViews.push(rayTex.createView());
      const transTex = device.createTexture({
        label: `HRC-Trans-${i}`,
        size: { width: w, height: ps },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.#transTextures.push(transTex);
      this.#transTextureViews.push(transTex.createView());
    }

    this.#mergeTextures = [0, 1].map((i) =>
      device.createTexture({
        label: `HRC-Merge-${i}`,
        size: { width: ps, height: ps },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#mergeTextureViews = this.#mergeTextures.map((t) => t.createView());

    this.#fluenceTextures = [0, 1].map((i) =>
      device.createTexture({
        label: `HRC-Fluence-${i}`,
        size: { width: ps, height: ps },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#fluenceTextureViews = this.#fluenceTextures.map((t) => t.createView());

    this.#seedParamsView = uboView(raySeedShader, 'params');
    this.#extendParamsView = uboView(rayExtendShader, 'params');
    this.#mergeParamsView = uboView(coneMergeShader, 'params');
    this.#accumParamsView = uboView(fluenceAccumShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');

    this.#seedParamsBuffer = device.createBuffer({
      label: 'HRC-SeedParams',
      size: 4 * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#extendParamsBuffer = device.createBuffer({
      label: 'HRC-ExtendParams',
      size: Math.max(1, this.#numCascades - 1) * 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#mergeParamsBuffer = device.createBuffer({
      label: 'HRC-MergeParams',
      size: 4 * this.#numCascades * 256,
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
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x3' as GPUVertexFormat },
              { shaderLocation: 2, offset: 20, format: 'float32x3' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: worldModule,
        entryPoint: 'fragment_main',
        targets: [
          { format: 'rgba16float' as GPUTextureFormat },
          { format: 'rgba16float' as GPUTextureFormat },
        ],
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
            arrayStride: 44,
            stepMode: 'instance' as GPUVertexStepMode,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 2, offset: 16, format: 'float32x3' as GPUVertexFormat },
              { shaderLocation: 3, offset: 28, format: 'float32' as GPUVertexFormat },
              { shaderLocation: 4, offset: 32, format: 'float32x3' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fragment_main',
        targets: [
          { format: 'rgba16float' as GPUTextureFormat },
          { format: 'rgba16float' as GPUTextureFormat },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.#raySeedPipeline = createComputePipeline(device, 'HRC-RaySeed', raySeedShader);
    this.#rayExtendPipeline = createComputePipeline(device, 'HRC-RayExtend', rayExtendShader);
    this.#coneMergePipeline = createComputePipeline(device, 'HRC-ConeMerge', coneMergeShader);
    this.#fluenceAccumPipeline = createComputePipeline(device, 'HRC-FluenceAccum', fluenceAccumShader);

    this.#createStaticBindGroups();

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

  #createStaticBindGroups() {
    const device = this.#device;

    this.#seedBindGroups = [];
    for (let dir = 0; dir < 4; dir++) {
      this.#seedBindGroups.push(
        device.createBindGroup({
          layout: this.#raySeedPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#emissionTextureView },
            { binding: 1, resource: this.#attenuationTextureView },
            { binding: 2, resource: this.#rayTextureViews[0] },
            { binding: 3, resource: this.#transTextureViews[0] },
            {
              binding: 4,
              resource: {
                buffer: this.#seedParamsBuffer,
                offset: dir * 256,
                size: this.#seedParamsView.arrayBuffer.byteLength,
              },
            },
          ],
        }),
      );
    }

    this.#extendBindGroups = [];
    for (let level = 1; level < this.#numCascades; level++) {
      this.#extendBindGroups.push(
        device.createBindGroup({
          layout: this.#rayExtendPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#rayTextureViews[level - 1] },
            { binding: 1, resource: this.#transTextureViews[level - 1] },
            { binding: 2, resource: this.#rayTextureViews[level] },
            { binding: 3, resource: this.#transTextureViews[level] },
            {
              binding: 4,
              resource: {
                buffer: this.#extendParamsBuffer,
                offset: (level - 1) * 256,
                size: this.#extendParamsView.arrayBuffer.byteLength,
              },
            },
          ],
        }),
      );
    }

    const nc = this.#numCascades;
    const mergeParamSize = this.#mergeParamsView.arrayBuffer.byteLength;
    this.#mergeBindGroups = [];
    for (let dir = 0; dir < 4; dir++) {
      const dirBGs: GPUBindGroup[] = [];
      let readIdx = 1;
      let writeIdx = 0;
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        dirBGs.push(
          device.createBindGroup({
            layout: this.#coneMergePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: this.#rayTextureViews[level] },
              { binding: 1, resource: this.#transTextureViews[level] },
              { binding: 2, resource: this.#mergeTextureViews[readIdx] },
              { binding: 3, resource: this.#mergeTextureViews[writeIdx] },
              {
                binding: 4,
                resource: { buffer: this.#mergeParamsBuffer, offset: (dir * nc + level) * 256, size: mergeParamSize },
              },
            ],
          }),
        );
        const tmp = readIdx;
        readIdx = writeIdx;
        writeIdx = tmp;
      }
      this.#mergeBindGroups.push(dirBGs);
    }
    this.#mergeResultIdx = (nc - 1) % 2 === 0 ? 0 : 1;
  }

  #destroyResources() {
    this.#emissionTexture?.destroy();
    this.#attenuationTexture?.destroy();
    this.#rayTextures?.forEach((t) => t.destroy());
    this.#transTextures?.forEach((t) => t.destroy());
    this.#mergeTextures?.forEach((t) => t.destroy());
    this.#fluenceTextures?.forEach((t) => t.destroy());
    this.#seedParamsBuffer?.destroy();
    this.#extendParamsBuffer?.destroy();
    this.#mergeParamsBuffer?.destroy();
    this.#accumParamsBuffer?.destroy();
    this.#blitParamsBuffer?.destroy();
  }

  // ── Shape / line data ──

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
      const attenAttr = element?.getAttribute('data-attenuation');
      let ar: number, ag: number, ab: number;
      if (attenAttr !== null) {
        const parts = attenAttr.split(',').map(Number);
        ar = parts[0] ?? 5;
        ag = parts[1] ?? ar;
        ab = parts[2] ?? ar;
      } else {
        ar = 5; ag = 5; ab = 5;
      }
      const v = (px: number, py: number) => { vertices.push(px, py, r, g, b, ar, ag, ab); };
      v(x0, y0); v(x1, y0); v(x0, y1);
      v(x1, y0); v(x1, y1); v(x0, y1);
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
    const FPL = 11;
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
      const [x1, y1, x2, y2, r, g, b, th, ar, ag, ab] = this.#lines[i];
      const off = i * FPL;
      data[off] = x1; data[off + 1] = y1; data[off + 2] = x2; data[off + 3] = y2;
      data[off + 4] = r; data[off + 5] = g; data[off + 6] = b; data[off + 7] = th;
      data[off + 8] = ar; data[off + 9] = ag; data[off + 10] = ab;
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
      verts.push(cx, cy, r, g, b, 0, 0, 0);
      verts.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b, 0, 0, 0);
      verts.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b, 0, 0, 0);
    }
    this.#mouseLightVertexCount = verts.length / 8;
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
    const ps = this.#ps;
    const nc = this.#numCascades;

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    const encoder = device.createCommandEncoder();

    // ── Step 1: Render world textures (emission + attenuation) ──
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: this.#emissionTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          { view: this.#attenuationTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
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

    // ── Step 2: HRC cascade processing per direction ──
    let fluenceReadIdx = 0;
    let fluenceWriteIdx = 1;
    let fluenceResultIdx = 0;
    let isFirstDir = true;

    for (let dir = 0; dir < 4; dir++) {
      if (this.#debugDir > 0 && dir !== this.#debugDir - 1) continue;

      const ec = this.#debugCascadeCount > 0 ? Math.min(this.#debugCascadeCount, nc) : nc;

      // Phase A: Ray Seed
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#raySeedPipeline);
        pass.setBindGroup(0, this.#seedBindGroups[dir]);
        pass.dispatchWorkgroups(Math.ceil((ps * 2) / 16), Math.ceil(ps / 16));
        pass.end();
      }

      // Phase B: Ray Extension (bottom-up)
      for (let level = 1; level < ec; level++) {
        const interval = 1 << level;
        const numRays = interval + 1;
        const numProbes = ps >> level;
        const rayWidth = numProbes * numRays;

        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#rayExtendPipeline);
        pass.setBindGroup(0, this.#extendBindGroups[level - 1]);
        pass.dispatchWorkgroups(Math.ceil(rayWidth / 16), Math.ceil(ps / 16));
        pass.end();
      }

      // Phase C: Cone Merge (top-down)
      const usePrebuiltMerge = ec === nc;
      let mergeReadIdx = 1;
      let mergeWriteIdx = 0;
      for (let k = 0; k < ec; k++) {
        const level = ec - 1 - k;
        const numCones = 1 << level;
        const numProbes = ps >> level;
        const flatSize = numProbes * numCones;

        const bg = usePrebuiltMerge
          ? this.#mergeBindGroups[dir][k]
          : device.createBindGroup({
              layout: this.#coneMergePipeline.getBindGroupLayout(0),
              entries: [
                { binding: 0, resource: this.#rayTextureViews[level] },
                { binding: 1, resource: this.#transTextureViews[level] },
                { binding: 2, resource: this.#mergeTextureViews[mergeReadIdx] },
                { binding: 3, resource: this.#mergeTextureViews[mergeWriteIdx] },
                {
                  binding: 4,
                  resource: {
                    buffer: this.#mergeParamsBuffer,
                    offset: (dir * nc + level) * 256,
                    size: this.#mergeParamsView.arrayBuffer.byteLength,
                  },
                },
              ],
            });
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.#coneMergePipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(ps / 16), Math.ceil(flatSize / 16));
        pass.end();

        const tmp = mergeReadIdx;
        mergeReadIdx = mergeWriteIdx;
        mergeWriteIdx = tmp;
      }

      const mergeResultView = usePrebuiltMerge
        ? this.#mergeTextureViews[this.#mergeResultIdx]
        : this.#mergeTextureViews[mergeReadIdx];

      // Phase D: Fluence Accumulation
      this.#accumParamsView.set({ direction: dir, isFirstDir: isFirstDir ? 1 : 0, probeSize: ps });
      device.queue.writeBuffer(this.#accumParamsBuffer, dir * 256, this.#accumParamsView.arrayBuffer);

      if (isFirstDir) {
        isFirstDir = false;
        fluenceWriteIdx = 0;
        fluenceReadIdx = 1;
      } else {
        const tmp2 = fluenceWriteIdx;
        fluenceWriteIdx = fluenceReadIdx;
        fluenceReadIdx = tmp2;
      }

      const accumBG = device.createBindGroup({
        layout: this.#fluenceAccumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: mergeResultView },
          { binding: 1, resource: this.#fluenceTextureViews[fluenceReadIdx] },
          { binding: 2, resource: this.#fluenceTextureViews[fluenceWriteIdx] },
          {
            binding: 3,
            resource: {
              buffer: this.#accumParamsBuffer,
              offset: dir * 256,
              size: this.#accumParamsView.arrayBuffer.byteLength,
            },
          },
        ],
      });
      const accumPass = encoder.beginComputePass();
      accumPass.setPipeline(this.#fluenceAccumPipeline);
      accumPass.setBindGroup(0, accumBG);
      accumPass.dispatchWorkgroups(Math.ceil(ps / 16), Math.ceil(ps / 16));
      accumPass.end();

      fluenceResultIdx = fluenceWriteIdx;
    }

    // ── Step 3: Final blit ──
    {
      const blitBG = device.createBindGroup({
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#fluenceTextureViews[fluenceResultIdx] },
          { binding: 1, resource: this.#emissionTextureView },
          { binding: 2, resource: this.#attenuationTextureView },
          { binding: 3, resource: { buffer: this.#blitParamsBuffer } },
          { binding: 4, resource: this.#linearSampler },
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

  #uploadStaticParams(width: number, height: number) {
    const device = this.#device;
    const ps = this.#ps;
    const nc = this.#numCascades;

    for (let dir = 0; dir < 4; dir++) {
      const [ox, oy] = dirOrigin(dir, width, height);
      const [ax, ay] = DIR_ALONG[dir];
      const [px, py] = DIR_PERP[dir];
      const [sa, sp] = dirScales(dir, width, height, ps);
      this.#seedParamsView.set({
        probeSize: ps,
        screenW: width,
        screenH: height,
        pad0: 0,
        originX: ox,
        originY: oy,
        alongAxisX: ax,
        alongAxisY: ay,
        perpAxisX: px,
        perpAxisY: py,
        scaleAlong: sa,
        scalePerp: sp,
      });
      device.queue.writeBuffer(this.#seedParamsBuffer, dir * 256, this.#seedParamsView.arrayBuffer);
    }

    for (let level = 1; level < nc; level++) {
      this.#extendParamsView.set({ probeSize: ps, level, pad0: 0, pad1: 0 });
      device.queue.writeBuffer(this.#extendParamsBuffer, (level - 1) * 256, this.#extendParamsView.arrayBuffer);
    }

    for (let dir = 0; dir < 4; dir++) {
      const [sa, sp] = dirScales(dir, width, height, ps);
      const aspect = sp / sa;
      for (let level = 0; level < nc; level++) {
        const numCones = 1 << level;
        const numProbes = ps >> level;
        const numRays = numCones + 1;
        const nextNumCones = numCones * 2;
        this.#mergeParamsView.set({
          probeSize: ps,
          numCones,
          numProbes,
          numRays,
          nextNumCones,
          isLastLevel: level === nc - 1 ? 1 : 0,
          aspect,
          pad0: 0,
        });
        device.queue.writeBuffer(this.#mergeParamsBuffer, (dir * nc + level) * 256, this.#mergeParamsView.arrayBuffer);
      }
    }

    this.#accumParamsView.set({ direction: 0, isFirstDir: 0, probeSize: ps, pad: 0 });
    for (let dir = 0; dir < 4; dir++) {
      this.#accumParamsView.set({ direction: dir });
      device.queue.writeBuffer(this.#accumParamsBuffer, dir * 256, this.#accumParamsView.arrayBuffer);
    }

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);
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
    this.#createStaticBindGroups();
    this.#uploadStaticParams(this.#canvas.width, this.#canvas.height);
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
      this.#debugCascadeCount =
        (((this.#debugCascadeCount + delta) % (this.#numCascades + 1)) + this.#numCascades + 1) %
        (this.#numCascades + 1);
      const maxSpacing =
        this.#debugCascadeCount > 0 ? Math.pow(2, this.#debugCascadeCount - 1) : Math.pow(2, this.#numCascades - 1);
      const label =
        this.#debugCascadeCount === 0
          ? `all (max spacing ${maxSpacing})`
          : `${this.#debugCascadeCount} (max spacing ${maxSpacing})`;
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
    return `p${this.#ps}${dirLabel}${ccLabel} sp${Math.pow(2, ec - 1)}`;
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
