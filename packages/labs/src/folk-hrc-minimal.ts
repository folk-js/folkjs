// Minimal implementation of Holographic Radiance Cascades (HRC) for 2D global illumination.
// Based on "Holographic Radiance Cascades for 2D Global Illumination" (Freeman, Sannikov, Margel).
//
// The algorithm computes fluence F(p) — radiance integrated across all directions — at every
// pixel in a square grid. It splits the work into four 90° quadrants (rotations 0–3), handled
// identically by rotating the world coordinate system (§4.2, Algorithm 1 lines 17–24).
//
// Each quadrant runs three phases:
//   1. Merge Up (Seed → Extend)  — Build acceleration structure T_n from single-pixel seeds (§4.1, Eq. 18/20)
//   2. Merge Down (Cascade Merge) — Compute angular fluence R_n from R_{n+1} down to R_0 (§4.2, Eq. 14/15)
//   3. Accumulate — Write R_0 into the fluence buffer with a 1px offset (Alg. 1 line 20)
//
// After all four quadrants, a cross-blur (Eq. 21) fixes checkerboard artifacts from the
// even/odd probe structure, then the result is tonemapped and displayed.
//
// This implementation assumes probeCount (grid size) is always a power of 2, which greatly
// simplifies the math: levelProbes = ps >> level, mergeStride = ps, mergeInWidth = ps, etc.
//
// The world texture is populated entirely from a CPU-side composite canvas each frame.
// The scene canvas holds persistent user drawing; the composite canvas layers the ephemeral
// mouse light on top using 'copy' compositing (exact pixel values, no blending).

import { css, property, ReactiveElement, type CSSResultGroup, type PropertyValues } from '@folkjs/dom/ReactiveElement';

const TEX_RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

const WG = [16, 16] as const;

// ── WebGPU helpers ──

function tex(device: GPUDevice, label: string, size: number, format: GPUTextureFormat, usage: number) {
  const t = device.createTexture({ label, size: { width: size, height: size }, format, usage });
  return [t, t.createView()] as const;
}

function bg(device: GPUDevice, layout: GPUBindGroupLayout, ...resources: GPUBindingResource[]) {
  return device.createBindGroup({
    layout,
    entries: resources.map((resource, binding) => ({ binding, resource })),
  });
}

function computePipeline(device: GPUDevice, label: string, code: string) {
  return device.createComputePipeline({
    label,
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
}

function computePass(
  enc: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  wgX: number,
  wgY: number,
) {
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();
}

// ── Shared WGSL ──

const wgslPackF16 = /*wgsl*/ `
fn packF16(v: vec4f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(v.zw)); }
fn unpackF16(p: vec2u) -> vec4f { return vec4f(unpack2x16float(p.x), unpack2x16float(p.y)); }
`;

const wgslSrgb = /*wgsl*/ `
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
`;

// Computes the slice-axis offset for a ray direction within an interval.
// dirIdx is the ray index, intervalSize is the number of directions (2^level).
// Result is the perpendicular displacement: dirIdx * 2 - intervalSize.
const wgslSliceOffset = /*wgsl*/ `
fn dirToSliceOffset(dirIdx: i32, intervalSize: i32) -> i32 {
  return dirIdx * 2 - intervalSize;
}
`;

// Maps (probeIdx, sliceIdx) in the 1D cascade coordinate system to 2D world pixel coordinates.
// Each of the 4 rotations covers a 90° quadrant of angular fluence (§4.2, Algorithm 1).
const wgslRotate = /*wgsl*/ `
fn rotateCoord(pi: i32, si: i32, ps: i32, rot: u32) -> vec2i {
  switch (rot) {
    case 0u: { return vec2i(pi, si); }
    case 1u: { return vec2i(si, pi); }
    case 2u: { return vec2i(ps - 1 - pi, si); }
    case 3u: { return vec2i(si, ps - 1 - pi); }
    default: { return vec2i(pi, si); }
  }
}
`;

// Eq. 7: Composite ray — near segment absorbs/emits before far segment.
// Merge(⟨r_n, t_n⟩, ⟨r_f, t_f⟩) = ⟨r_n + t_n · r_f, t_n · t_f⟩
const wgslRayData = /*wgsl*/ `
struct RayData { rad: vec3f, trans: f32 }
fn compositeRay(near: RayData, far: RayData) -> RayData {
  return RayData(near.rad + far.rad * near.trans, near.trans * far.trans);
}
`;

// ── Phase 1a: Ray Seed — Initialize T_0 ──
// Seeds the base level of the acceleration structure (§4.1, Algorithm 1 lines 2–3).
// Since probe spacing = 1 pixel, T_0(p, k) = Trace(p, p + v_0(k)) is just a single-pixel
// lookup from the world texture. Each probe reads the (emissive radiance, transmittance)
// pair at its rotated world position.

const raySeedShader =
  wgslPackF16 +
  wgslSrgb +
  wgslRotate +
  /*wgsl*/ `
struct Params { ps: u32, rotation: u32, pad0: u32, pad1: u32 };

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> rayOut: array<vec2u>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pi = i32(gid.x);
  let si = i32(gid.y);
  let ps = i32(params.ps);
  if (pi >= ps || si >= ps) { return; }

  let px = rotateCoord(pi, si, ps, params.rotation);

  var rad = vec3f(0.0);
  var trans = 1.0;
  if (px.x >= 0 && px.y >= 0 && px.x < ps && px.y < ps) {
    let world = textureLoad(worldTex, px, 0);
    let rgb = srgbToLinear(world.rgb);
    trans = 1.0 - world.a;
    rad = rgb * world.a;
  }

  rayOut[si * ps + pi] = packF16(vec4f(rad, trans));
}
`;

// ── Phase 1b: Ray Extension — Build T_n from T_{n-1} ──
// Builds the acceleration structure by combining shorter rays into longer ones
// (§4.1, Algorithm 1 lines 4–10).
//
// For even ray index 2k: T_{n}(p, 2k) = Merge(T_{n-1}(p, k), T_{n-1}(p + v_{n-1}(k), k))  [Eq. 18]
// For odd ray index 2k+1: T_{n}(p, 2k+1) = average of two cross-composited paths            [Eq. 19/20]
//
// All layout parameters (levelProbes, numRays, row widths) are computed inline
// from ps and level since ps is always a power of 2.

const rayExtendShader =
  wgslPackF16 +
  wgslSliceOffset +
  wgslRayData +
  /*wgsl*/ `
struct Params { ps: u32, level: u32, pad0: u32, pad1: u32 };

@group(0) @binding(0) var<storage, read> prevRay: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> currRay: array<vec2u>;
@group(0) @binding(2) var<uniform> params: Params;

fn loadPrev(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let prevLevel = params.level - 1u;
  let prevProbes = i32(params.ps >> prevLevel);
  let prevNumRays = i32(1u << prevLevel) + 1;
  if (probeIdx < 0 || probeIdx >= prevProbes ||
      rayIdx < 0 || rayIdx >= prevNumRays ||
      sliceIdx < 0 || sliceIdx >= i32(params.ps)) {
    return RayData(vec3f(0.0), 1.0);
  }
  var idx: i32;
  if (prevLevel == 0u) {
    // T_0 has one value per probe, no angular interleaving
    idx = sliceIdx * i32(params.ps) + probeIdx;
  } else {
    let rowW = prevProbes * prevNumRays;
    idx = sliceIdx * rowW + probeIdx * prevNumRays + rayIdx;
  }
  let r = unpackF16(prevRay[idx]);
  return RayData(r.rgb, r.a);
}

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x);
  let sliceIdx = i32(gid.y);
  let ps = i32(params.ps);
  let level = params.level;
  let interval = i32(1u << level);
  let numRays = interval + 1;
  let levelProbes = i32(params.ps >> level);
  let probeIdx = texelX / numRays;
  let rayIdx = texelX - probeIdx * numRays;
  if (probeIdx >= levelProbes || sliceIdx >= ps) { return; }

  let prevInterval = interval / 2;
  let lower = rayIdx / 2;
  let upper = (rayIdx + 1) / 2;

  // Eq. 19/20: Cross-composite two paths and average for odd indices.
  // For even indices this is exact (Eq. 18) since lower == upper.
  let crossA = compositeRay(
    loadPrev(probeIdx * 2, lower, sliceIdx),
    loadPrev(probeIdx * 2 + 1, upper, sliceIdx + dirToSliceOffset(lower, prevInterval)),
  );
  let crossB = compositeRay(
    loadPrev(probeIdx * 2, upper, sliceIdx),
    loadPrev(probeIdx * 2 + 1, lower, sliceIdx + dirToSliceOffset(upper, prevInterval)),
  );

  let rowW = levelProbes * numRays;
  currRay[sliceIdx * rowW + texelX] = packF16(vec4f(
    (crossA.rad + crossB.rad) * 0.5,
    (crossA.trans + crossB.trans) * 0.5,
  ));
}
`;

// ── Phase 2: Cascade Merge — Compute R_n from R_{n+1} ──
// Computes angular fluence by merging rays with higher-cascade results, working from the
// top cascade (R_{N-1}, initialized to 0) down to R_0 (§4.2, Algorithm 1 lines 11–18).
//
// For odd probeIdx (x):  Eq. 14 — trace to the next probe and merge with R_{n+1} there
// For even probeIdx (x): Eq. 15 — interpolate near/far fluence to avoid center-bias artifacts
//
// At level 0 (single direction per probe), the result is accumulated into the fluence buffer
// with a 1-pixel offset: L([x,y]) += R_0([x+1, y], 0) (Algorithm 1 line 20).
//
// Cone arc weights A_n(i) are computed inline using Eq. 13.

const cascadeMergeShader =
  wgslPackF16 +
  wgslSliceOffset +
  wgslRotate +
  wgslRayData +
  /*wgsl*/ `
struct Params { ps: u32, level: u32, numCascades: u32, rotation: u32 };

@group(0) @binding(0) var<storage, read> rayBuf: array<vec2u>;
@group(0) @binding(1) var<storage, read> mergeInBuf: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> mergeOutBuf: array<vec4f>;
@group(0) @binding(3) var<uniform> params: Params;
@group(0) @binding(4) var<storage, read_write> fluenceBuf: array<vec4f>;

// Eq. 13: A_n(i) = angle(v_n(i + 1/2)) - angle(v_n(i - 1/2))
// where v_n(k) = (2^n, 2k - 2^n) and angle([x,y]) = atan2(y, x).
// s is the sub-bin index, N = 2^(level+1) is the total number of sub-bins.
fn coneArc(s: u32, level: u32) -> f32 {
  let N = i32(2u << level);
  let si = i32(s);
  return atan2(f32(2 * si - N + 2), f32(N)) - atan2(f32(2 * si - N), f32(N));
}

fn loadRay(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let ps = i32(params.ps);
  let levelProbes = i32(params.ps >> params.level);
  let numRays = i32(1u << params.level) + 1;
  if (probeIdx < 0 || probeIdx >= levelProbes ||
      rayIdx < 0 || rayIdx >= numRays ||
      sliceIdx < 0 || sliceIdx >= ps) {
    return RayData(vec3f(0.0), 1.0);
  }
  var texX: i32; var rowW: i32;
  if (params.level == 0u) {
    texX = probeIdx; rowW = ps;
  } else {
    rowW = levelProbes * numRays;
    texX = probeIdx * numRays + rayIdx;
  }
  let r = unpackF16(rayBuf[sliceIdx * rowW + texX]);
  return RayData(r.rgb, r.a);
}

fn loadMerge(texX: i32, sliceIdx: i32) -> vec3f {
  let ps = i32(params.ps);
  if (params.level >= params.numCascades - 1u ||
      texX < 0 || texX >= ps || sliceIdx < 0 || sliceIdx >= ps) {
    return vec3f(0.0);
  }
  return mergeInBuf[sliceIdx * ps + texX].rgb;
}

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeAngIdx = i32(gid.x);
  let sliceIdx = i32(gid.y);
  let ps = i32(params.ps);
  let level = params.level;
  let numDirections = i32(1u << level);
  let probeIdx = probeAngIdx >> level;
  let angBinIdx = probeAngIdx & (numDirections - 1);
  let levelProbes = i32(params.ps >> level);
  if (probeIdx >= levelProbes || sliceIdx >= ps) { return; }

  // Odd probes (Eq. 14) merge with nearest plane; even probes (Eq. 15) interpolate near/far.
  let isEven = (probeIdx % 2 == 0);
  let farStep = select(1, 2, isEven);
  var result = vec3f(0.0);

  for (var side = 0; side < 2; side++) {
    let subBin = u32(angBinIdx * 2 + side);
    let rayIdx = angBinIdx + side;
    let weight = coneArc(subBin, level);
    let ray = loadRay(probeIdx, rayIdx, sliceIdx);
    let sliceOff = dirToSliceOffset(rayIdx, numDirections);

    let farX = ((probeIdx + farStep) << level) + i32(subBin);
    let farSlice = sliceIdx + sliceOff * farStep;
    var farFluence: vec3f;
    if (level >= params.numCascades - 1u ||
        farX < 0 || farX >= ps || farSlice < 0 || farSlice >= ps) {
      farFluence = vec3f(0.0);
    } else {
      farFluence = mergeInBuf[farSlice * ps + farX].rgb;
    }

    if (isEven) {
      // Eq. 15: composite ray through both probes, then interpolate with near-plane estimate
      let ext = loadRay(probeIdx + 1, rayIdx, sliceIdx + sliceOff);
      let comp = compositeRay(ray, ext);
      let merged = comp.rad * weight + farFluence * comp.trans;
      result += (merged + loadMerge((probeIdx << level) + i32(subBin), sliceIdx)) * 0.5;
    } else {
      // Eq. 14: single probe, merge with far-cascade fluence
      result += ray.rad * weight + farFluence * ray.trans;
    }
  }

  if (numDirections > 1) {
    mergeOutBuf[sliceIdx * ps + (probeIdx << level) + angBinIdx] = vec4f(result, 0.0);
  }

  // At level 0: write fluence with 1px probe offset (Algorithm 1, line 20).
  if (numDirections == 1) {
    let fc = rotateCoord(probeIdx - 1, sliceIdx, ps, params.rotation);
    if (fc.x >= 0 && fc.x < ps && fc.y >= 0 && fc.y < ps) {
      let fi = fc.y * ps + fc.x;
      fluenceBuf[fi] = vec4f(fluenceBuf[fi].rgb + result, 0.0);
    }
  }
}
`;

// ── Blit shader ──

const blitShader = /*wgsl*/ `
struct Params { exposure: f32, ps: f32, falseColor: f32, pad0: f32 };
const TWO_PI = 6.2831853;

fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
fn acesTonemap(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn linearToSrgb(c: vec3f) -> vec3f { return pow(c, vec3f(1.0 / 2.2)); }
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn triangularDither(fc: vec2u) -> vec3f { let s = fc.x + fc.y * 8192u; return vec3f((f32(pcg(s)) + f32(pcg(s + 1u))) / 4294967295.0 - 1.0) / 255.0; }

const RAMP = array<vec3f, 10>(
  vec3f(0.0), vec3f(0.05,0.0,0.3), vec3f(0.0,0.2,1.0), vec3f(0.0,0.9,0.9), vec3f(0.1,0.9,0.1),
  vec3f(1.0,0.95,0.1), vec3f(1.0,0.5,0.0), vec3f(1.0,0.0,0.0), vec3f(1.0,0.5,0.8), vec3f(1.0),
);
fn spectrumRamp(t: f32) -> vec3f { let s = clamp(t, 0.0, 1.0) * 9.0; let i = min(u32(s), 8u); return mix(RAMP[i], RAMP[i+1u], fract(s)); }

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
  return vec4f(pos[i], 0, 1);
}

@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var linearSamp: sampler;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / params.ps;
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let rgb = srgbToLinear(world.rgb);
  let emissive = rgb * world.a;
  let indirect = fluence / TWO_PI * (1.0 - world.a);
  let hdr = emissive + indirect;
  if (params.falseColor > 0.5) {
    let mag = dot(fluence, vec3f(0.2126, 0.7152, 0.0722));
    return vec4f(spectrumRamp(clamp(log2(mag * 10000.0 + 1.0) / log2(10001.0), 0.0, 1.0)), 1.0);
  }
  return vec4f(linearToSrgb(acesTonemap(hdr * params.exposure)) + triangularDither(vec2u(pos.xy)), 1.0);
}
`;

// ── Fluence cross-blur (Eq. 21) ──
// Applies a 1px edge-aware cross blur [0 1 0; 1 4 1; 0 1 0] / 8 to fix checkerboard
// artifacts from the even/odd probe structure. Neighbors with significantly different
// opacity are excluded to preserve silhouettes.

const fluenceBlurShader = /*wgsl*/ `
struct Params { ps: u32, pad0: u32, pad1: u32, pad2: u32 };

@group(0) @binding(0) var<storage, read> src: array<vec4f>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var worldTex: texture_2d<f32>;

fn load(x: i32, y: i32) -> vec3f { return src[y * i32(params.ps) + x].rgb; }

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x); let y = i32(gid.y);
  let ps = i32(params.ps);
  if (x >= ps || y >= ps) { return; }

  let centerOpacity = textureLoad(worldTex, vec2i(x, y), 0).a;
  let center = load(x, y);
  var sum = center * 4.0;
  var wt = 4.0;

  let off = array<vec2i, 4>(vec2i(-1,0), vec2i(1,0), vec2i(0,-1), vec2i(0,1));
  for (var i = 0; i < 4; i++) {
    let nx = clamp(x + off[i].x, 0, ps - 1);
    let ny = clamp(y + off[i].y, 0, ps - 1);
    if (abs(textureLoad(worldTex, vec2i(nx, ny), 0).a - centerOpacity) < 0.5) {
      sum += load(nx, ny); wt += 1.0;
    }
  }
  textureStore(dst, vec2i(x, y), vec4f(sum / wt, 1.0));
}
`;

// ── Component ──

export class FolkHrcMinimal extends ReactiveElement {
  static override tagName = 'folk-hrc-minimal';

  static override styles: CSSResultGroup = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
    }
  `;

  @property({ type: Number, reflect: true }) exposure = 2.0;
  @property({ type: Number, reflect: true, attribute: 'probe-count' }) probeCount = 128;
  @property({ type: Boolean, reflect: true, attribute: 'false-color' }) falseColor = false;

  // Mouse light — set these from the outside. All colors are sRGB [0-1].
  // Position is in canvas-pixel coordinates (use mapToCanvas to convert).
  mouseX = 0;
  mouseY = 0;
  mouseLightColor: [number, number, number] = [0.8, 0.6, 0.3];
  mouseLightRadius = 10;
  mouseLightOpacity = 1;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;

  #sceneCanvas: HTMLCanvasElement | null = null;
  #sceneCtx: CanvasRenderingContext2D | null = null;
  #compositeCanvas: HTMLCanvasElement | null = null;
  #compositeCtx: CanvasRenderingContext2D | null = null;

  #rayBuffers!: GPUBuffer[];
  #mergeBuffers!: GPUBuffer[];
  #fluenceBuffer!: GPUBuffer;
  #fluenceTextureView!: GPUTextureView;

  #raySeedPipeline!: GPUComputePipeline;
  #rayExtendPipeline!: GPUComputePipeline;
  #cascadeMergePipeline!: GPUComputePipeline;
  #fluenceBlurPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][];
  #blitBindGroup!: GPUBindGroup;
  #fluenceBlurBindGroup!: GPUBindGroup;
  #linearSampler!: GPUSampler;

  #seedParamsBuffer!: GPUBuffer;
  #extendParamsBuffer!: GPUBuffer;
  #mergeParamsBuffer!: GPUBuffer;
  #blitParamsBuffer!: GPUBuffer;
  #fluenceBlurParamsBuffer!: GPUBuffer;

  #numCascades = 0; // N in the paper = log2(probeCount)
  #gpuResources: (GPUTexture | GPUBuffer)[] = [];
  #blitParamsData = new Float32Array(4);

  #animationFrame = 0;
  #isRunning = false;
  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

  // ── Public API ──

  get sceneCanvas(): HTMLCanvasElement | null {
    this.#ensureCanvases();
    return this.#sceneCanvas;
  }

  get sceneCtx(): CanvasRenderingContext2D | null {
    this.#ensureCanvases();
    return this.#sceneCtx;
  }

  get fps() {
    return this.#smoothedFrameTime > 0 ? Math.round(1000 / this.#smoothedFrameTime) : 0;
  }

  get size() {
    return this.probeCount;
  }

  mapToCanvas(clientX: number, clientY: number): [number, number] {
    if (!this.#canvas) return [0, 0];
    const rect = this.#canvas.getBoundingClientRect();
    const s = this.probeCount / rect.width;
    return [(clientX - rect.left) * s, (clientY - rect.top) * s];
  }

  scaleToCanvas(value: number): number {
    if (!this.#canvas) return value;
    return value * (this.probeCount / this.#canvas.getBoundingClientRect().width);
  }

  // ── Lifecycle ──

  override async connectedCallback() {
    super.connectedCallback();
    await this.#initWebGPU();
    this.#initResources();
    this.#initPipelines();
    this.#uploadStaticParams();
    this.#isRunning = true;
    this.#startAnimationLoop();
    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#isRunning = false;
    if (this.#animationFrame) cancelAnimationFrame(this.#animationFrame);
    this.#destroyResources();
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    if (changedProperties.has('probeCount') && changedProperties.get('probeCount') !== undefined) {
      const ps = this.probeCount;
      this.#canvas.width = ps;
      this.#canvas.height = ps;
      this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
      this.#destroyResources();
      this.#initResources();
      this.#createStaticBindGroups();
      this.#uploadStaticParams();
    }
  }

  // ── Internals ──

  #ensureCanvases() {
    const ps = this.probeCount;
    if (ps === 0) return;
    if (!this.#sceneCanvas || this.#sceneCanvas.width !== ps) {
      this.#sceneCanvas = document.createElement('canvas');
      this.#sceneCanvas.width = ps;
      this.#sceneCanvas.height = ps;
      this.#sceneCtx = this.#sceneCanvas.getContext('2d')!;
    }
    if (!this.#compositeCanvas || this.#compositeCanvas.width !== ps) {
      this.#compositeCanvas = document.createElement('canvas');
      this.#compositeCanvas.width = ps;
      this.#compositeCanvas.height = ps;
      this.#compositeCtx = this.#compositeCanvas.getContext('2d')!;
    }
  }

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    const canFloat32Filter = adapter.features.has('float32-filterable');
    this.#device = await adapter.requestDevice({
      requiredFeatures: canFloat32Filter ? ['float32-filterable' as GPUFeatureName] : [],
    });

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.probeCount;
    this.#canvas.height = this.probeCount;
    this.renderRoot.prepend(this.#canvas);

    const context = this.#canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU context');
    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
    this.#linearSampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  #initResources() {
    const device = this.#device;
    const ps = this.probeCount;
    const nc = Math.log2(ps);
    this.#numCascades = nc;
    this.#gpuResources = [];

    const track = <T extends GPUTexture | GPUBuffer>(r: T): T => {
      this.#gpuResources.push(r);
      return r;
    };
    const STORAGE = GPUBufferUsage.STORAGE;
    const UBO = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

    const [worldTex, worldView] = tex(
      device,
      'World',
      ps,
      'rgba16float',
      TEX_RENDER | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    );
    this.#worldTexture = track(worldTex);
    this.#worldTextureView = worldView;

    this.#rayBuffers = [];
    for (let n = 0; n < nc; n++) {
      const w = n === 0 ? ps : (ps >> n) * ((1 << n) + 1);
      this.#rayBuffers.push(
        track(
          device.createBuffer({
            label: `T${n}`,
            size: w * ps * 8,
            usage: STORAGE,
          }),
        ),
      );
    }

    this.#mergeBuffers = [0, 1].map((i) =>
      track(
        device.createBuffer({
          label: `R-${i}`,
          size: ps * ps * 16,
          usage: STORAGE,
        }),
      ),
    );
    this.#fluenceBuffer = track(
      device.createBuffer({
        label: 'Fluence',
        size: ps * ps * 16,
        usage: STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );

    const [ft, fv] = tex(
      device,
      'FluenceTex',
      ps,
      'rgba16float',
      GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    );
    track(ft);
    this.#fluenceTextureView = fv;

    this.#seedParamsBuffer = track(device.createBuffer({ label: 'SeedParams', size: 4 * 256, usage: UBO }));
    this.#extendParamsBuffer = track(
      device.createBuffer({ label: 'ExtendParams', size: Math.max(1, nc - 1) * 256, usage: UBO }),
    );
    this.#mergeParamsBuffer = track(device.createBuffer({ label: 'MergeParams', size: 4 * nc * 256, usage: UBO }));
    this.#blitParamsBuffer = track(device.createBuffer({ label: 'BlitParams', size: 16, usage: UBO }));
    this.#fluenceBlurParamsBuffer = track(device.createBuffer({ label: 'BlurParams', size: 16, usage: UBO }));
  }

  #initPipelines() {
    const device = this.#device;

    this.#raySeedPipeline = computePipeline(device, 'Seed', raySeedShader);
    this.#rayExtendPipeline = computePipeline(device, 'Extend', rayExtendShader);
    this.#cascadeMergePipeline = computePipeline(device, 'Merge', cascadeMergeShader);
    this.#fluenceBlurPipeline = computePipeline(device, 'Blur', fluenceBlurShader);

    const blitModule = device.createShaderModule({ code: blitShader });
    this.#renderPipeline = device.createRenderPipeline({
      label: 'Blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: this.#presentationFormat }] },
      primitive: { topology: 'triangle-strip' },
    });

    this.#createStaticBindGroups();
  }

  #createStaticBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;
    const seedLayout = this.#raySeedPipeline.getBindGroupLayout(0);
    const extLayout = this.#rayExtendPipeline.getBindGroupLayout(0);
    const mergeLayout = this.#cascadeMergePipeline.getBindGroupLayout(0);

    this.#seedBindGroups = [0, 1, 2, 3].map((rot) =>
      bg(
        device,
        seedLayout,
        this.#worldTextureView,
        { buffer: this.#rayBuffers[0] },
        { buffer: this.#seedParamsBuffer, offset: rot * 256, size: 16 },
      ),
    );

    this.#extendBindGroups = [];
    for (let n = 1; n < nc; n++) {
      this.#extendBindGroups.push(
        bg(
          device,
          extLayout,
          { buffer: this.#rayBuffers[n - 1] },
          { buffer: this.#rayBuffers[n] },
          { buffer: this.#extendParamsBuffer, offset: (n - 1) * 256, size: 16 },
        ),
      );
    }

    this.#mergeBindGroups = [];
    for (let rot = 0; rot < 4; rot++) {
      const rotBGs: GPUBindGroup[] = [];
      let readIdx = 1,
        writeIdx = 0;
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        rotBGs.push(
          bg(
            device,
            mergeLayout,
            { buffer: this.#rayBuffers[level] },
            { buffer: this.#mergeBuffers[readIdx] },
            { buffer: this.#mergeBuffers[writeIdx] },
            { buffer: this.#mergeParamsBuffer, offset: (rot * nc + level) * 256, size: 16 },
            { buffer: this.#fluenceBuffer },
          ),
        );
        [readIdx, writeIdx] = [writeIdx, readIdx];
      }
      this.#mergeBindGroups.push(rotBGs);
    }

    this.#fluenceBlurBindGroup = bg(
      device,
      this.#fluenceBlurPipeline.getBindGroupLayout(0),
      { buffer: this.#fluenceBuffer },
      this.#fluenceTextureView,
      { buffer: this.#fluenceBlurParamsBuffer },
      this.#worldTextureView,
    );

    this.#blitBindGroup = bg(
      device,
      this.#renderPipeline.getBindGroupLayout(0),
      this.#fluenceTextureView,
      this.#worldTextureView,
      { buffer: this.#blitParamsBuffer },
      this.#linearSampler,
    );
  }

  #uploadStaticParams() {
    const q = this.#device.queue;
    const ps = this.probeCount;
    const nc = this.#numCascades;

    const u4 = new Uint32Array(4);
    const write = (buffer: GPUBuffer, slot: number, v0: number, v1: number, v2: number, v3: number) => {
      u4[0] = v0;
      u4[1] = v1;
      u4[2] = v2;
      u4[3] = v3;
      q.writeBuffer(buffer, slot * 256, u4);
    };

    for (let rot = 0; rot < 4; rot++) write(this.#seedParamsBuffer, rot, ps, rot, 0, 0);
    for (let n = 1; n < nc; n++) write(this.#extendParamsBuffer, n - 1, ps, n, 0, 0);
    for (let rot = 0; rot < 4; rot++)
      for (let level = 0; level < nc; level++) write(this.#mergeParamsBuffer, rot * nc + level, ps, level, nc, rot);
    write(this.#fluenceBlurParamsBuffer, 0, ps, 0, 0, 0);
  }

  #destroyResources() {
    this.#gpuResources.forEach((r) => r.destroy());
    this.#gpuResources = [];
  }

  // Compose the world texture from scene canvas + ephemeral mouse light.
  // Uses 'copy' compositing so pixel values are set exactly, not blended.
  #compositeWorld() {
    this.#ensureCanvases();
    const ps = this.probeCount;
    const ctx = this.#compositeCtx!;

    ctx.clearRect(0, 0, ps, ps);
    if (this.#sceneCanvas) ctx.drawImage(this.#sceneCanvas, 0, 0);

    const {
      mouseX,
      mouseY,
      mouseLightColor: [r, g, b],
      mouseLightOpacity: op,
      mouseLightRadius,
    } = this;
    if (op > 0) {
      const bs = Math.max(1, mouseLightRadius * 2);
      const blo = -Math.floor((bs - 1) / 2);
      const mx = Math.floor(mouseX) + blo;
      const my = Math.floor(mouseY) + blo;
      ctx.clearRect(mx, my, bs, bs);
      ctx.fillStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${op})`;
      ctx.fillRect(mx, my, bs, bs);
    }
  }

  // ── Render loop ──

  #startAnimationLoop() {
    const render = (now: number) => {
      if (!this.#isRunning) return;
      if (this.#lastFrameTimestamp > 0) {
        const dt = now - this.#lastFrameTimestamp;
        this.#smoothedFrameTime =
          this.#smoothedFrameTime === 0 ? dt : this.#smoothedFrameTime + 0.05 * (dt - this.#smoothedFrameTime);
      }
      this.#lastFrameTimestamp = now;
      this.#renderFrame();
      this.#animationFrame = requestAnimationFrame(render);
    };
    this.#animationFrame = requestAnimationFrame(render);
  }

  #renderFrame() {
    const ps = this.probeCount;
    const device = this.#device;
    const wg = ps / WG[0];

    this.#compositeWorld();
    device.queue.copyExternalImageToTexture(
      { source: this.#compositeCanvas! },
      { texture: this.#worldTexture, premultipliedAlpha: false },
      { width: ps, height: ps },
    );

    const f = this.#blitParamsData;
    f[0] = this.exposure;
    f[1] = ps;
    f[2] = this.falseColor ? 1.0 : 0.0;
    f[3] = 0;
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, f);

    const encoder = device.createCommandEncoder();

    encoder.clearBuffer(this.#fluenceBuffer);
    for (let rot = 0; rot < 4; rot++) this.#runCascade(encoder, rot);

    // Cross-blur to fix checkerboard artifacts (Eq. 21)
    computePass(encoder, this.#fluenceBlurPipeline, this.#fluenceBlurBindGroup, wg, wg);

    // Blit to screen with tonemapping
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear' as const,
            storeOp: 'store' as const,
          },
        ],
      });
      pass.setPipeline(this.#renderPipeline);
      pass.setBindGroup(0, this.#blitBindGroup);
      pass.setViewport(0, 0, ps, ps, 0, 1);
      pass.draw(4);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
  }

  #runCascade(encoder: GPUCommandEncoder, rot: number) {
    const nc = this.#numCascades;
    const ps = this.probeCount;
    const wg = ps / WG[0];

    // Phase 1a: Seed T_0 — single-pixel radiance/transmittance lookup
    computePass(encoder, this.#raySeedPipeline, this.#seedBindGroups[rot], wg, wg);

    // Phase 1b: Extend T_1..T_{N-1} — combine shorter rays into longer ones (Eq. 18/20)
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#rayExtendPipeline);
      for (let n = 1; n < nc; n++) {
        const rayWidth = (ps >> n) * ((1 << n) + 1);
        pass.setBindGroup(0, this.#extendBindGroups[n - 1]);
        pass.dispatchWorkgroups(Math.ceil(rayWidth / WG[0]), wg);
      }
      pass.end();
    }

    // Phase 2: Merge R_{N-1}..R_0 — angular fluence from rays + higher cascade (Eq. 14/15)
    // Dispatch width is always ps (levelProbes × numDirections = (ps >> level) × (1 << level) = ps)
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#cascadeMergePipeline);
      for (let k = 0; k < nc; k++) {
        pass.setBindGroup(0, this.#mergeBindGroups[rot][k]);
        pass.dispatchWorkgroups(wg, wg);
      }
      pass.end();
    }
  }
}
