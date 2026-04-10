import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

type Line = [
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number,
  thickness: number,
  opacity: number,
  albedo: number,
];

function nextPow2(n: number): number {
  let v = 1;
  while (v < n) v *= 2;
  return v;
}

function ceilLog2(n: number): number {
  let levels = 0;
  let v = 1;
  while (v < n) {
    v *= 2;
    levels++;
  }
  return levels;
}

function ceilDiv(n: number, d: number): number {
  return Math.ceil(n / d);
}

const TEX_RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
const TEX_STORAGE = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
const SKY_CIRCLE_SIZE = 256;

const WG_SEED = [16, 16] as const;
const WG_EXTEND = [16, 16] as const;
const WG_MERGE = [16, 16] as const;
const WG_BOUNCE = [16, 16] as const;

function uboView(shader: string, name: string): StructuredView {
  return makeStructuredView(makeShaderDataDefinitions(shader).uniforms[name]);
}

function tex(device: GPUDevice, label: string, w: number, h: number, format: GPUTextureFormat, usage: number) {
  const t = device.createTexture({ label, size: { width: w, height: h }, format, usage });
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

function uploadVertexData(
  device: GPUDevice,
  existing: GPUBuffer | undefined,
  data: Float32Array<ArrayBuffer>,
  count?: number,
): GPUBuffer {
  const bytes = (count ?? data.length) * 4;
  if (!existing || existing.size < bytes) {
    existing?.destroy();
    existing = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  device.queue.writeBuffer(existing, 0, data, 0, count);
  return existing;
}

// ── Shared WGSL functions ──

const wgslPackF16 = /*wgsl*/ `
fn packF16(v: vec4f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(v.zw)); }
fn unpackF16(p: vec2u) -> vec4f { return vec4f(unpack2x16float(p.x), unpack2x16float(p.y)); }
`;

const wgslSrgb = /*wgsl*/ `
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
`;

const wgslSliceOffset = /*wgsl*/ `
fn dirToSliceOffset(dirIdx: i32, intervalSize: i32) -> i32 {
  return dirIdx * 2 - intervalSize;
}
`;

const wgslRGB9E5 = /*wgsl*/ `
fn packRGB9E5(c: vec3f) -> u32 {
  let maxC = max(c.r, max(c.g, c.b));
  var exp_shared: i32;
  var scale: f32;
  if (maxC < 6.10352e-5) {
    exp_shared = 0;
    scale = 0.0;
  } else {
    let e = clamp(i32(ceil(log2(maxC))) + 15, 0, 31);
    exp_shared = e;
    scale = exp2(f32(-e + 15 + 9));
  }
  let r = u32(clamp(c.r * scale, 0.0, 511.0));
  let g = u32(clamp(c.g * scale, 0.0, 511.0));
  let b = u32(clamp(c.b * scale, 0.0, 511.0));
  return r | (g << 9u) | (b << 18u) | (u32(exp_shared) << 27u);
}

fn unpackRGB9E5(p: u32) -> vec3f {
  let r = f32(p & 0x1FFu);
  let g = f32((p >> 9u) & 0x1FFu);
  let b = f32((p >> 18u) & 0x1FFu);
  let e = f32((p >> 27u) & 0x1Fu) - 15.0 - 9.0;
  return vec3f(r, g, b) * exp2(e);
}
`;

// ── World-render shaders (shapes, lines, mouse light → world + material) ──
//
// Two render targets (MRT):
//   location(0) = world    — rgb: emitted radiance, a: opacity (0–1)
//   location(1) = material — r: albedo (0–1)
//
// Opacity is the per-pixel extinction: fraction of light absorbed or scattered
// per unit traversal. opacity=1 is a fully opaque solid, opacity=0 is vacuum.
//
// Albedo is the single-scattering albedo (ω₀): the fraction of interacted
// light that is re-emitted rather than absorbed. It unifies surface
// reflectance and volume scattering into one parameter:
//   - Opaque surface (opacity=1, albedo=0.8): 80% of light reflects diffusely
//   - Volume (opacity=0.03, albedo=0.5): each step scatters 1.5% of light
//   - Absorber (albedo=0): all interacted light is destroyed

const worldRenderShader =
  wgslSrgb +
  /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) opacity: f32,
  @location(3) albedo: f32,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) opacity: f32,
  @location(2) albedo: f32,
}
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  out.opacity = input.opacity;
  out.albedo = input.albedo;
  return out;
}
struct FragOut { @location(0) world: vec4f, @location(1) material: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  var out: FragOut;
  out.world = vec4f(srgbToLinear(in.color), in.opacity);
  out.material = vec4f(in.albedo, 0.0, 0.0, 0.0);
  return out;
}
`;

const lineRenderShader =
  wgslSrgb +
  /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) p1: vec2f,
  @location(2) p2: vec2f,
  @location(3) radius: f32,
  @location(4) opacity: f32,
  @location(5) albedo: f32,
}
struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;
@vertex fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f, @location(1) p2: vec2f,
  @location(2) color: vec3f, @location(3) thickness: f32,
  @location(4) opacity: f32, @location(5) albedo: f32,
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
  out.opacity = opacity; out.albedo = albedo;
  return out;
}
struct FragOut { @location(0) world: vec4f, @location(1) material: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  let pos = in.position.xy;
  let ab = in.p2 - in.p1; let ap = pos - in.p1;
  let lenSq = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / lenSq, 0.0, 1.0), 0.0, lenSq < 0.001);
  let nearest = in.p1 + ab * t;
  let d = length(pos - nearest) - in.radius;
  if (d > 0.0) { discard; }
  var out: FragOut;
  out.world = vec4f(srgbToLinear(in.color), in.opacity);
  out.material = vec4f(in.albedo, 0.0, 0.0, 0.0);
  return out;
}
`;

// ── HRC Phase A: Ray Seed — direct ray tracing for T_0 (paper §4.2, Alg. 1) ──
// Samples world + bounce textures at each probe position. Computes per-cell
// radiance and transmittance using discrete Beer-Lambert: T = (1−α)^spacing.
// Emission is multiplied by (1 - T) because emission and absorption are coupled
// through the extinction coefficient: a cell that absorbs fraction (1-T) of
// passing light also converts fraction (1-T) of its own emission into the ray.
// This is the source function integral over the cell thickness (paper Eq. 4).
// The bounce texture (at probe resolution) provides the diffuse re-emission
// from the previous frame's fluence, enabling multi-bounce GI over time.

const raySeedShader =
  wgslPackF16 +
  /*wgsl*/ `
struct SeedParams {
  probeCount: u32,
  sliceCount: u32,
  screenW: f32,
  screenH: f32,
  probeSpacing: f32,
  pad: u32,
  transformX: vec4f,
  transformY: vec4f,
};

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var bounceTex: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> rayOut: array<vec2u>;
@group(0) @binding(3) var<uniform> params: SeedParams;

@compute @workgroup_size(${WG_SEED[0]}, ${WG_SEED[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeIdx = i32(gid.x);
  let sliceIdx = i32(gid.y);
  if (probeIdx >= i32(params.probeCount) || sliceIdx >= i32(params.sliceCount)) { return; }

  let p = vec3f(f32(probeIdx) + 0.5, f32(sliceIdx) + 0.5, 1.0);
  let wp = vec2f(dot(params.transformX.xyz, p), dot(params.transformY.xyz, p));

  let px = vec2i(i32(floor(wp.x)), i32(floor(wp.y)));
  var rad = vec3f(0.0);
  var trans = 1.0;
  if (px.x >= 0 && px.y >= 0 && px.x < i32(params.screenW) && px.y < i32(params.screenH)) {
    let world = textureLoad(worldTex, px, 0);
    let bdim = vec2i(textureDimensions(bounceTex, 0));
    let bounce = textureLoad(bounceTex, clamp(vec2i(wp / vec2f(params.screenW, params.screenH) * vec2f(bdim)), vec2i(0), bdim - 1), 0).rgb;
    trans = pow(1.0 - world.a, params.probeSpacing);
    rad = (world.rgb + bounce) * (1.0 - trans);
  }

  let packed = packF16(vec4f(rad, trans));
  rayOut[sliceIdx * i32(params.probeCount) + probeIdx] = packed;
}
`;

// ── HRC Phase B: Ray Extension — "Merge Up", building T_1..T_N (paper §4.1) ──
// Composes two shorter rays from the previous level into one longer ray.
// Even k: exact composition via Eq. 18: T_{n+1}(p,2k) = Merge(T_n(p,k), T_n(p+v_n(k),k))
// Odd k: averaged cross-composition via Eq. 19-20, interpolating between the
// two nearest finer-level directions.
// Transmittance is scalar, packed in the ray texture alpha channel.

const rayExtendShader =
  wgslPackF16 +
  wgslSliceOffset +
  /*wgsl*/ `
struct ExtendParams {
  probeCount: u32,
  level: u32,
  invNumRays: f32,
  prevRayW: u32,
  currRayW: u32,
  sliceCount: u32,
  pad2: u32,
  pad3: u32,
};

@group(0) @binding(0) var<storage, read> prevRay: array<vec2u>;
@group(0) @binding(1) var<storage, read_write> currRay: array<vec2u>;
@group(0) @binding(2) var<uniform> params: ExtendParams;

struct RayData { rad: vec3f, trans: f32 }

fn loadPrev(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let prevLevel = params.level - 1u;
  let prevNumProbes = i32((params.probeCount + (1u << prevLevel) - 1u) >> prevLevel);
  let prevNumRays = i32(1u << prevLevel) + 1;
  if (probeIdx < 0 || probeIdx >= prevNumProbes ||
      rayIdx < 0 || rayIdx >= prevNumRays ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return RayData(vec3f(0.0), 1.0);
  }
  var idx: i32;
  if (prevLevel == 0u) {
    idx = sliceIdx * i32(params.prevRayW) + probeIdx;
  } else {
    idx = sliceIdx * i32(params.prevRayW) + (probeIdx << prevLevel) + probeIdx + rayIdx;
  }
  let r = unpackF16(prevRay[idx]);
  return RayData(r.rgb, r.a);
}

// Paper Eq. 7: Merge(⟨r_n, t_n⟩, ⟨r_f, t_f⟩) = ⟨r_n + t_n·r_f, t_n·t_f⟩
fn compositeRay(near: RayData, far: RayData) -> RayData {
  return RayData(near.rad + far.rad * near.trans, near.trans * far.trans);
}

@compute @workgroup_size(${WG_EXTEND[0]}, ${WG_EXTEND[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x);
  let sliceIdx = i32(gid.y);

  let interval = i32(1u << params.level);
  let numRays = interval + 1;
  let levelProbes = i32((params.probeCount + (1u << params.level) - 1u) >> params.level);
  let probeIdx = i32(floor(f32(texelX) * params.invNumRays));
  let rayIdx = texelX - probeIdx * numRays;

  if (probeIdx >= levelProbes || sliceIdx >= i32(params.sliceCount)) { return; }

  let prevInterval = interval / 2;
  let lower = rayIdx / 2;
  let upper = (rayIdx + 1) / 2;

  let sliceOffA = dirToSliceOffset(lower, prevInterval);
  let crossA = compositeRay(
    loadPrev(probeIdx * 2, lower, sliceIdx),
    loadPrev(probeIdx * 2 + 1, upper, sliceIdx + sliceOffA),
  );

    let sliceOffB = dirToSliceOffset(upper, prevInterval);
    let crossB = compositeRay(
      loadPrev(probeIdx * 2, upper, sliceIdx),
      loadPrev(probeIdx * 2 + 1, lower, sliceIdx + sliceOffB),
    );

  let avgRad = (crossA.rad + crossB.rad) * 0.5;
  let avgTrans = (crossA.trans + crossB.trans) * 0.5;
  currRay[sliceIdx * i32(params.currRayW) + texelX] = packF16(vec4f(avgRad, avgTrans));
}
`;

// ── HRC Phase C: Cascade Merge — "Merge Down", computing R_{N-1}..R_0 (paper §4.2) ──
// Reads pre-computed ray data and merges with far-field fluence from higher levels.
// Parity-dependent cascade connection:
//   Odd probes (Eq. 14): Merge_r(A_{n+1}(j) × Trace(p,q), R_{n+1}(q,j))
//   Even probes (Eq. 15-17): Richardson-average of local composite with
//     coarser level's result to cancel first-order spatial interpolation error.

const cascadeMergeShader =
  wgslPackF16 +
  wgslSliceOffset +
  wgslRGB9E5 +
  /*wgsl*/ `
struct MergeParams {
  probeCount: u32,
  numDirections: u32,
  levelProbes: u32,
  numRays: u32,
  nextNumDirections: u32,
  isTopCascade: u32,
  fluenceW: u32,
  fluenceStride: u32,
  skyRow: u32,
  skyShift: u32,
  level: u32,
  coneArcBase: u32,
  sliceCount: u32,
  mergeStride: u32,
  mergeInWidth: u32,
  direction: u32,
  fluenceH: u32,
};

@group(0) @binding(0) var<storage, read> rayBuf: array<vec2u>;
@group(0) @binding(1) var<storage, read> mergeInBuf: array<u32>;
@group(0) @binding(2) var<storage, read_write> mergeOutBuf: array<u32>;

@group(0) @binding(3) var<uniform> params: MergeParams;
@group(0) @binding(4) var<storage, read_write> fluenceBuf: array<u32>;
@group(0) @binding(5) var skyPrefixTex: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> coneArcs: array<f32>;

struct RayData { rad: vec3f, trans: f32 }

fn loadRay(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let effProbes = i32(params.levelProbes);
  if (probeIdx < 0 || probeIdx >= effProbes ||
      rayIdx < 0 || rayIdx >= i32(params.numRays) ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return RayData(vec3f(0.0), 1.0);
  }
  var texX: i32;
  var rowW: i32;
  if (params.level == 0u) {
    texX = probeIdx;
    rowW = i32(params.levelProbes);
  } else {
    texX = (probeIdx << params.level) + probeIdx + rayIdx;
    rowW = i32(params.levelProbes * params.numRays);
  }
  let r = unpackF16(rayBuf[sliceIdx * rowW + texX]);
  return RayData(r.rgb, r.a);
}

fn loadMerge(texX: i32, sliceIdx: i32) -> vec3f {
  if (params.isTopCascade == 1u ||
      texX < 0 || texX >= i32(params.mergeInWidth) ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return vec3f(0.0);
  }
  return unpackRGB9E5(mergeInBuf[sliceIdx * i32(params.mergeStride) + texX]);
}

// Paper Eq. 13: A_n(i) = angle(v_n(i+½)) - angle(v_n(i-½))
fn getConeArc(subBin: u32) -> f32 {
  return coneArcs[params.coneArcBase + subBin];
}

fn loadSkyFluence(subBin: u32) -> vec3f {
  let base = subBin << params.skyShift;
  let end = base + (1u << params.skyShift);
  let row = i32(params.skyRow);
  return textureLoad(skyPrefixTex, vec2i(i32(end), row), 0).rgb
       - textureLoad(skyPrefixTex, vec2i(i32(base), row), 0).rgb;
}

@compute @workgroup_size(${WG_MERGE[0]}, ${WG_MERGE[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeAngIdx = i32(gid.x);
  let sliceIdx = i32(gid.y);
  let level = params.level;
  let numDirections = i32(1u << level);
  let probeIdx = probeAngIdx >> level;
  let angBinIdx = probeAngIdx & (numDirections - 1);

  if (probeIdx >= i32(params.levelProbes) || sliceIdx >= i32(params.sliceCount)) { return; }

  // Parity-dependent cascade connection:
  // Even probes composite two adjacent fine intervals and Richardson-average
  // with the coarser level; odd probes do direct single-interval compositing.
  // farStep=2 for even probes because they've already composited the adjacent
  // probe's interval locally, so the continuation comes from 2 probes ahead.
  let isEven = (probeIdx % 2 == 0);
  let farStep = select(1, 2, isEven);

  var result = vec3f(0.0);

  for (var side = 0; side < 2; side++) {
    let subBin = u32(angBinIdx * 2 + side);
    let rayIdx = angBinIdx + side;
    let weight = getConeArc(subBin);

    let ray = loadRay(probeIdx, rayIdx, sliceIdx);
    let sliceOff = dirToSliceOffset(rayIdx, numDirections);

    let farX = ((probeIdx + farStep) << level) + i32(subBin);
    let farSlice = sliceIdx + sliceOff * farStep;
    // Top cascade level has no coarser merge result — fluence beyond its
    // interval comes from the sky. Out-of-bounds probes also fall back to sky.
    var farFluence: vec3f;
    if (params.isTopCascade == 1u ||
        farX < 0 || farX >= i32(params.mergeInWidth) ||
        farSlice < 0 || farSlice >= i32(params.sliceCount)) {
      farFluence = loadSkyFluence(subBin);
    } else {
      farFluence = unpackRGB9E5(mergeInBuf[farSlice * i32(params.mergeStride) + farX]);
    }

    if (isEven) {
      let ext = loadRay(probeIdx + 1, rayIdx, sliceIdx + sliceOff);
      let cRad = ray.rad + ext.rad * ray.trans;
      let cTrans = ray.trans * ext.trans;
      let merged = cRad * weight + farFluence * cTrans;
      let coarseFluence = loadMerge((probeIdx << level) + i32(subBin), sliceIdx);
      result += (merged + coarseFluence) * 0.5;
    } else {
      result += ray.rad * weight + farFluence * ray.trans;
    }
  }

  let outX = (probeIdx << level) + angBinIdx;
  if (params.numDirections > 1u) {
    mergeOutBuf[sliceIdx * i32(params.mergeStride) + outX] = packRGB9E5(result);
  }

  if (params.numDirections == 1u) {
    var fc: vec2i;
    switch (params.direction) {
      case 0u: { fc = vec2i(probeIdx - 1, sliceIdx); }
      case 1u: { fc = vec2i(sliceIdx, probeIdx - 1); }
      case 2u: { fc = vec2i(i32(params.fluenceW) - probeIdx, sliceIdx); }
      case 3u: { fc = vec2i(sliceIdx, i32(params.fluenceH) - probeIdx); }
      default: { fc = vec2i(probeIdx - 1, sliceIdx); }
    }
    let fw = i32(params.fluenceW);
    let fh = i32(params.fluenceH);
    let fStride = i32(params.fluenceStride);
    if (fc.x >= 0 && fc.x < fw && fc.y >= 0 && fc.y < fh) {
      let fi = fc.y * fStride + fc.x;
      let prev = unpackRGB9E5(fluenceBuf[fi]);
      fluenceBuf[fi] = packRGB9E5(prev + result);
    }
  }
}
`;

// ── Final blit shader ──
// Bilinearly upscales fluence from probe resolution to screen resolution.
// Uses world texture alpha (opacity) to mask indirect light at surfaces.

const blitShader = /*wgsl*/ `
struct BlitParams { exposure: f32, screenW: f32, screenH: f32, debugMode: f32, falseColor: f32, pad0: f32, pad1: f32, pad2: f32 };
const TWO_PI = 6.2831853;

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

fn tonemapAndDither(hdr: vec3f, fragCoord: vec2u) -> vec4f {
  return vec4f(linearToSrgb(acesTonemap(hdr)) + triangularDither(fragCoord), 1.0);
}

const RAMP = array<vec3f, 10>(
  vec3f(0.0),              // black
  vec3f(0.05, 0.0,  0.3),  // deep blue
  vec3f(0.0,  0.2,  1.0),  // blue
  vec3f(0.0,  0.9,  0.9),  // cyan
  vec3f(0.1,  0.9,  0.1),  // green
  vec3f(1.0,  0.95, 0.1),  // yellow
  vec3f(1.0,  0.5,  0.0),  // orange
  vec3f(1.0,  0.0,  0.0),  // red
  vec3f(1.0,  0.5,  0.8),  // pink
  vec3f(1.0),              // white
);

fn spectrumRamp(t: f32) -> vec3f {
  let s = clamp(t, 0.0, 1.0) * 9.0;
  let i = min(u32(s), 8u);
  return mix(RAMP[i], RAMP[i + 1u], fract(s));
}

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  return vec4f(pos[i], 0, 1);
}

@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlitParams;
@group(0) @binding(3) var linearSamp: sampler;
@group(0) @binding(4) var ptAccumTex: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(params.screenW, params.screenH);
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let emissive = world.rgb * world.a;
  let indirect = fluence / TWO_PI * (1.0 - world.a);
  let dm = i32(params.debugMode);
  let fc = params.falseColor > 0.5;

  var hdr: vec3f;
  var fcSource: vec3f;
  var forceFc = false;

  if (dm == 1) {
    let ptRad = textureLoad(ptAccumTex, vec2i(pos.xy), 0).rgb;
    hdr = ptRad;
    fcSource = ptRad;
  } else if (dm == 2) {
    let ptRad = textureLoad(ptAccumTex, vec2i(pos.xy), 0).rgb;
    hdr = abs((emissive + indirect) - ptRad);
    fcSource = hdr;
    forceFc = true;
  } else {
    hdr = emissive + indirect;
    fcSource = fluence;
  }

  if (fc || forceFc) {
    let mag = dot(fcSource, vec3f(0.2126, 0.7152, 0.0722));
    let t = clamp(log2(mag * 10000.0 + 1.0) / log2(10001.0), 0.0, 1.0);
    return vec4f(spectrumRamp(t), 1.0);
  }
  return tonemapAndDither(hdr * params.exposure, vec2u(pos.xy));
}
`;

// ── Fluence cross-blur compute shader (HRC paper Eq. 21) ──
// Opacity-aware 1px cross blur on fluence at probe resolution.
// Kernel [0,1,0; 1,4,1; 0,1,0] / 8, skipping neighbors whose
// opacity differs significantly from the center probe's opacity.
// This cancels the period-2 checkerboard from even/odd merge
// parity without leaking light across surface boundaries.

const WG_BLUR = [16, 16] as const;

const fluenceBlurShader =
  wgslRGB9E5 +
  /*wgsl*/ `
struct BlurParams { w: u32, h: u32, stride: u32, screenW: u32, screenH: u32, pad0: u32, pad1: u32, pad2: u32 };

@group(0) @binding(0) var<storage, read> src: array<u32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: BlurParams;
@group(0) @binding(3) var worldTex: texture_2d<f32>;

fn load(x: i32, y: i32) -> vec3f {
  return unpackRGB9E5(src[y * i32(params.stride) + x]);
}

fn probeOpacity(px: i32, py: i32, spacing: f32) -> f32 {
  let wp = vec2i(vec2f(f32(px) + 0.5, f32(py) + 0.5) * spacing);
  return textureLoad(worldTex, wp, 0).a;
}

@compute @workgroup_size(${WG_BLUR[0]}, ${WG_BLUR[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  let w = i32(params.w);
  let h = i32(params.h);
  if (x >= w || y >= h) { return; }

  let spacing = f32(params.screenW) / f32(w);
  let centerOpacity = probeOpacity(x, y, spacing);
  let center = load(x, y);

  var sum = center * 4.0;
  var wt = 4.0;

  let off = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
  for (var i = 0; i < 4; i++) {
    let nx = clamp(x + off[i].x, 0, w - 1);
    let ny = clamp(y + off[i].y, 0, h - 1);
    let nOpacity = probeOpacity(nx, ny, spacing);
    if (abs(nOpacity - centerOpacity) < 0.5) {
      sum += load(nx, ny);
      wt += 1.0;
    }
  }

  textureStore(dst, vec2i(x, y), vec4f(sum / wt, 1.0));
}
`;

// ── Bounce compute shader ──
//
// Computes diffuse re-emission at probe resolution (ps × ps). Each frame,
// the previous frame's fluence is read and converted to bounce emission
// that feeds back into the cascade via the seed shaders.
//
// Key design: wall probes (opacity≈1) sample fluence from exterior cardinal
// neighbors rather than their own position, because the cascade's fluence
// inside solid objects is zero. This solves the probe-surface misalignment
// problem where some of the probes used for the interpolation will likely
// be inside the object, where no light arrives.
//
// The blend `ownFluence * (1-opacity) + exteriorFluence * opacity` is
// continuous: vacuum probes use their own fluence, wall probes use exterior
// neighbors', and deep interior probes (no exterior neighbors) get zero.

const bounceComputeShader = /*wgsl*/ `
struct BounceParams {
  screenW: u32,
  screenH: u32,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var prevFluence: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var materialTex: texture_2d<f32>;
@group(0) @binding(3) var bounceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: BounceParams;

@compute @workgroup_size(${WG_BOUNCE[0]}, ${WG_BOUNCE[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probe = vec2i(i32(gid.x), i32(gid.y));
  let pdim = vec2i(textureDimensions(bounceOut));
  if (probe.x >= pdim.x || probe.y >= pdim.y) { return; }

  let spacing = f32(params.screenW) / f32(pdim.x);
  let worldPos = vec2i((vec2f(probe) + 0.5) * spacing);

  let opacity = textureLoad(worldTex, worldPos, 0).a;
  let albedo = textureLoad(materialTex, worldPos, 0).r;
  if (albedo == 0.0) {
    textureStore(bounceOut, probe, vec4f(0.0));
    return;
  }

  let ownFluence = textureLoad(prevFluence, probe, 0).rgb;

  var extFluence = vec3f(0.0);
  var extWeight = 0.0;
  let pMax = pdim - 1;
  let off = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
  for (var i = 0; i < 4; i++) {
    let d = off[i];
    let ni = clamp(probe + d, vec2i(0), pMax);
    let ni2 = clamp(probe + d * 2, vec2i(0), pMax);
    let nOpacity = textureLoad(worldTex, vec2i((vec2f(ni) + 0.5) * spacing), 0).a;
    let nFluence = (textureLoad(prevFluence, ni, 0).rgb
                  + textureLoad(prevFluence, ni2, 0).rgb) * 0.5;
    let w = 1.0 - nOpacity;
    extFluence += nFluence * w;
    extWeight += w;
  }
  if (extWeight > 0.001) {
    extFluence /= extWeight;
  }

  // Bounce emission = fluence × ω₀ / 2π (isotropic re-emission).
  let fluence = ownFluence * (1.0 - opacity) + extFluence * opacity;
  const TWO_PI = 6.2831853;
  textureStore(bounceOut, probe, vec4f(fluence * albedo / TWO_PI, 0.0));
}
`;

// ── 2D Path Tracer (ground truth reference) ──
//
// Progressive Monte Carlo path tracer at screen resolution. Each frame adds
// N stratified samples per pixel, blended into the accumulation buffer.
//
// Uses Amanatides & Woo DDA to walk every grid cell the ray crosses,
// computing Beer-Lambert with the exact Euclidean path length through
// each cell. This eliminates the directional bias of unit-step marching
// where diagonal rays traversed more cells than axis-aligned ones.
//
// Transport model — deterministic emission + stochastic interaction:
//   At each pixel:
//     1. Deterministic emission: radiance += throughput × emission × interactProb
//        where interactProb = 1 − pow(1−opacity, pathLen)
//     2. Stochastic interaction (three-way, bounces on):
//        - pass-through (prob 1−interactProb): continue, throughput unchanged
//        - scatter (prob interactProb×albedo): new direction, throughput unchanged
//        - absorb (prob interactProb×(1−albedo)): ray terminates
//     3. Deterministic extinction (bounces off):
//        throughput *= pow(1 − opacity, pathLen)

const pathTraceShader = /*wgsl*/ `
struct PTParams {
  screenW: u32,
  screenH: u32,
  frameIndex: u32,
  samplesPerPixel: u32,
  maxBounces: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
};

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var materialTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var<uniform> params: PTParams;
@group(0) @binding(5) var skyTex: texture_2d<f32>;

fn sampleSky(dir: vec2f) -> vec3f {
  let angle = atan2(dir.y, dir.x);
  let u = (angle + 3.14159265) / 6.28318530;
  let skyW = f32(textureDimensions(skyTex, 0).x);
  let skyI = clamp(i32(u * skyW), 0, i32(skyW) - 1);
  return textureLoad(skyTex, vec2i(skyI, 0), 0).rgb;
}

fn pcgHash(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn randomFloat(seed: ptr<function, u32>) -> f32 {
  *seed = pcgHash(*seed);
  return f32(*seed) / 4294967295.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = i32(gid.x);
  let py = i32(gid.y);
  if (px >= i32(params.screenW) || py >= i32(params.screenH)) { return; }

  var seed = (u32(px) + u32(py) * params.screenW) * 1099u + params.frameIndex * 6971u;

  var sampleSum = vec3f(0.0);

  for (var s = 0u; s < params.samplesPerPixel; s++) {
    var rayPos = vec2f(f32(px) + 0.5, f32(py) + 0.5);
    let sectorSize = 6.2831853 / f32(params.samplesPerPixel);
    let angle = (f32(s) + randomFloat(&seed)) * sectorSize;
    var rayDir = vec2f(cos(angle), sin(angle));
    var throughput = 1.0;
    var radiance = vec3f(0.0);
    var surfaceEntry = rayPos;
    var inSurface = false;
    var bounceCount = 0u;

    // Camera pixel: deterministic emission + extinction to match HRC blit
    {
      let w0 = textureLoad(worldTex, vec2i(px, py), 0);
      radiance += throughput * w0.rgb * w0.a;
      throughput *= (1.0 - w0.a);
    }

    let sw = i32(params.screenW);
    let sh = i32(params.screenH);

    var rayOrigin = rayPos;
    var cell = vec2i(i32(floor(rayPos.x)), i32(floor(rayPos.y)));
    var absDX = abs(rayDir.x);
    var absDY = abs(rayDir.y);
    var sX = select(-1, 1, rayDir.x >= 0.0);
    var sY = select(-1, 1, rayDir.y >= 0.0);
    var tDX = select(1e20, 1.0 / absDX, absDX > 1e-12);
    var tDY = select(1e20, 1.0 / absDY, absDY > 1e-12);
    var tMX: f32; var tMY: f32;
    if (absDX > 1e-12) { tMX = (select(f32(cell.x), f32(cell.x + 1), rayDir.x >= 0.0) - rayOrigin.x) / rayDir.x; } else { tMX = 1e20; }
    if (absDY > 1e-12) { tMY = (select(f32(cell.y), f32(cell.y + 1), rayDir.y >= 0.0) - rayOrigin.y) / rayDir.y; } else { tMY = 1e20; }
    var tPrev = 0.0;

    // Advance past camera pixel (already handled above)
    tPrev = min(tMX, tMY);
    if (tMX < tMY) { cell.x += sX; tMX += tDX; } else { cell.y += sY; tMY += tDY; }

    for (var step = 0u; step < 8192u; step++) {
      if (throughput < 1e-6) { break; }
      if (cell.x < 0 || cell.y < 0 || cell.x >= sw || cell.y >= sh) {
        radiance += throughput * sampleSky(rayDir);
        break;
      }

      let tExit = min(tMX, tMY);
      let pathLen = tExit - tPrev;
      let w = textureLoad(worldTex, cell, 0);
      let opacity = w.a;

      if (opacity < 1e-6 || pathLen <= 0.0) {
        inSurface = false;
      } else {
        if (!inSurface) {
          surfaceEntry = rayOrigin + rayDir * tPrev;
          inSurface = true;
        }

        let stepTrans = pow(1.0 - opacity, pathLen);
        let interactProb = 1.0 - stepTrans;

        radiance += throughput * w.rgb * interactProb;

        if (params.maxBounces > 0u) {
          let albedo = textureLoad(materialTex, cell, 0).r;
          let r = randomFloat(&seed);
          if (r < interactProb * (1.0 - albedo)) {
            break;
          } else if (r < interactProb) {
            if (bounceCount >= params.maxBounces) { break; }
            bounceCount++;
            if (opacity > 0.9) {
              rayPos = surfaceEntry;
              inSurface = false;
            } else {
              rayPos = rayOrigin + rayDir * tPrev;
            }
            let newAngle = randomFloat(&seed) * 6.2831853;
            rayDir = vec2f(cos(newAngle), sin(newAngle));

            rayOrigin = rayPos;
            cell = vec2i(i32(floor(rayPos.x)), i32(floor(rayPos.y)));
            absDX = abs(rayDir.x); absDY = abs(rayDir.y);
            sX = select(-1, 1, rayDir.x >= 0.0); sY = select(-1, 1, rayDir.y >= 0.0);
            tDX = select(1e20, 1.0 / absDX, absDX > 1e-12);
            tDY = select(1e20, 1.0 / absDY, absDY > 1e-12);
            if (absDX > 1e-12) { tMX = (select(f32(cell.x), f32(cell.x + 1), rayDir.x >= 0.0) - rayOrigin.x) / rayDir.x; } else { tMX = 1e20; }
            if (absDY > 1e-12) { tMY = (select(f32(cell.y), f32(cell.y + 1), rayDir.y >= 0.0) - rayOrigin.y) / rayDir.y; } else { tMY = 1e20; }
            tPrev = min(tMX, tMY);
            if (tMX < tMY) { cell.x += sX; tMX += tDX; } else { cell.y += sY; tMY += tDY; }
            continue;
          }
        } else {
          throughput *= stepTrans;
          if (throughput < 1e-6) { break; }
        }
      }

      tPrev = tExit;
      if (tMX < tMY) { cell.x += sX; tMX += tDX; } else { cell.y += sY; tMY += tDY; }
    }

    sampleSum += radiance;
  }

  let newSample = sampleSum / f32(params.samplesPerPixel);

  let coord = vec2i(px, py);
  if (params.frameIndex == 0u) {
    textureStore(outTex, coord, vec4f(newSample, 1.0));
  } else {
    let prev = textureLoad(accumTex, coord, 0).rgb;
    let weight = 1.0 / f32(params.frameIndex + 1u);
    let blended = mix(prev, newSample, weight);
    textureStore(outTex, coord, vec4f(blended, 1.0));
  }
}
`;

// ── Direction definitions ──
// Each direction is a 2×3 transform matrix mapping (probeIdx, sliceIdx) → world.
// Isotropic probes: spacing = max(W,H)/ps for both axes, so the probe grid
// covers a square region. The shorter screen axis is oversampled (probes
// outside the screen see vacuum). This eliminates all aspect-ratio math.

function dirTransform(
  dir: number,
  w: number,
  h: number,
  ps: number,
): { transformX: [number, number, number]; transformY: [number, number, number]; probeSpacing: number } {
  const s = Math.max(w, h) / ps;
  switch (dir) {
    case 0: // East: probeIdx→X, sliceIdx→Y
      return { transformX: [s, 0, 0], transformY: [0, s, 0], probeSpacing: s };
    case 1: // North: probeIdx→Y, sliceIdx→X
      return { transformX: [0, s, 0], transformY: [s, 0, 0], probeSpacing: s };
    case 2: // West: probeIdx→X reversed, sliceIdx→Y
      return { transformX: [-s, 0, w], transformY: [0, s, 0], probeSpacing: s };
    case 3: // South: probeIdx→Y reversed, sliceIdx→X
      return { transformX: [0, s, 0], transformY: [-s, 0, h], probeSpacing: s };
    default:
      return dirTransform(0, w, h, ps);
  }
}

// ── Component ──

export class FolkHolographicRC extends FolkBaseSet {
  static override tagName = 'folk-holographic-rc';

  @property({ type: Number, reflect: true }) exposure = 2.0;
  @property({ type: Number, reflect: true }) probeCount = 1024;
  @property({ type: Boolean, reflect: true }) bounces = true;
  @property({ type: Number, reflect: true, attribute: 'debug-mode' }) debugMode = 0;
  @property({ type: Boolean, reflect: true, attribute: 'false-color' }) falseColor = false;
  @property({ type: Number, reflect: true, attribute: 'pixel-perfect' }) pixelPerfect = 0;

  get #pp(): number | null {
    return this.pixelPerfect > 0 ? this.pixelPerfect : null;
  }

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World textures (world + material, MRT)
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;
  #materialTexture!: GPUTexture;
  #materialTextureView!: GPUTextureView;
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
  #mouseDirty = true;
  #mouseLightColor = { r: 0.8, g: 0.6, b: 0.3 };
  #mouseLightRadius = 10;
  #mouseLightOpacity = 1;
  #mouseLightAlbedo = 0;
  #mouseLightBuffer?: GPUBuffer;
  #mouseLightVertexCount = 0;

  // Scene canvas (pixel-perfect mode): 2D canvas used as CPU-side scene buffer.
  // Uploaded to world texture via copyExternalImageToTexture when dirty.
  #sceneCanvas: HTMLCanvasElement | null = null;
  #sceneCtx: CanvasRenderingContext2D | null = null;

  // Per-level ray storage buffers: vec4f (rad.rgb + transmittance)
  #rayBuffers!: GPUBuffer[];

  // Merge ping-pong storage buffers (probeCount x probeCount)
  #mergeBuffers!: GPUBuffer[];

  // Fluence SSBO: all 4 directions accumulate into this buffer (no ping-pong).
  // Copied to a texture after cascade processing for blit/bounce reads.
  #fluenceBuffer!: GPUBuffer;
  #fluenceTexture!: GPUTexture;
  #fluenceTextureView!: GPUTextureView;

  // Bounce texture (screen resolution) for diffuse light bounces
  #bounceTexture!: GPUTexture;
  #bounceTextureView!: GPUTextureView;
  #lastFluenceReady = false;
  #bounceZeroBuffer!: GPUBuffer;

  // Sky circle texture (1D radiance from every angle, stored as 2D with height=1)
  #skyTexture!: GPUTexture;
  #skyTextureView!: GPUTextureView;
  #skyCircleData = new Float32Array(SKY_CIRCLE_SIZE * 4);

  // Sky prefix sum texture for O(1) sky integration at any cascade level.
  // Width = probeCount+1 (prefix sum entries), Height = 4 (one row per direction).
  #skyPrefixSumTexture!: GPUTexture;
  #skyPrefixSumTextureView!: GPUTextureView;

  #coneArcBuffer!: GPUBuffer;

  // Path tracer accumulation (screen resolution, rgba32float for precision)
  #ptAccumTextures!: GPUTexture[];
  #ptAccumTextureViews!: GPUTextureView[];
  #ptFrameIndex = 0;
  #ptPipeline!: GPUComputePipeline;
  #ptParamsBuffer!: GPUBuffer;
  #ptParamsView!: StructuredView;

  // Pipelines
  #bounceComputePipeline!: GPUComputePipeline;
  #raySeedPipeline!: GPUComputePipeline;
  #rayExtendPipeline!: GPUComputePipeline;
  #cascadeMergePipeline!: GPUComputePipeline;
  #fluenceBlurPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Pre-created bind groups
  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][];
  #blitBindGroup!: GPUBindGroup;
  #fluenceBlurBindGroup!: GPUBindGroup;
  #bounceBindGroup!: GPUBindGroup;

  // Sampler
  #linearSampler!: GPUSampler;

  // Uniform buffers + structured views
  #seedParamsBuffer!: GPUBuffer;
  #seedParamsView!: StructuredView;
  #extendParamsBuffer!: GPUBuffer;
  #extendParamsView!: StructuredView;
  #mergeParamsBuffer!: GPUBuffer;
  #mergeParamsView!: StructuredView;
  #blitParamsBuffer!: GPUBuffer;
  #blitParamsView!: StructuredView;
  #bounceParamsBuffer!: GPUBuffer;
  #bounceParamsView!: StructuredView;
  #fluenceBlurParamsBuffer!: GPUBuffer;

  // Computed
  #numCascades = 0;
  #probesX = 0;
  #probesY = 0;
  #mergeStride = 0;
  #fluenceStride = 0;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

  // GPU timestamp profiling (null when timestamp-query unavailable)
  #tsQuerySet: GPUQuerySet | null = null;
  #tsResolveBuffer: GPUBuffer | null = null;
  #tsResultBuffer: GPUBuffer | null = null;
  #tsNextIdx = 0;
  #tsPassCount = 0;
  #gpuTimeMs = 0;
  #jsTimeMs = 0;
  #gpuPassTimings: { label: string; ms: number }[] = [];

  static readonly TS_MAX_PASSES = 96;

  #initTimestampQueries() {
    const device = this.#device;
    const count = FolkHolographicRC.TS_MAX_PASSES * 2;
    this.#tsQuerySet = device.createQuerySet({ type: 'timestamp', count });
    this.#tsResolveBuffer = device.createBuffer({
      size: count * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.#tsResultBuffer = device.createBuffer({
      size: count * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  #tsLabels: string[] = [];

  #tsBeginFrame() {
    this.#tsNextIdx = 0;
    this.#tsLabels = [];
  }

  #tsPass(label = ''): GPUComputePassTimestampWrites | GPURenderPassTimestampWrites | undefined {
    if (!this.#tsQuerySet) return undefined;
    const idx = this.#tsNextIdx;
    if (idx + 1 >= FolkHolographicRC.TS_MAX_PASSES * 2) return undefined;
    this.#tsNextIdx = idx + 2;
    this.#tsLabels.push(label);
    return { querySet: this.#tsQuerySet, beginningOfPassWriteIndex: idx, endOfPassWriteIndex: idx + 1 };
  }

  #resolveTimestamps(encoder: GPUCommandEncoder) {
    if (!this.#tsQuerySet || !this.#tsResultBuffer) return;
    this.#tsPassCount = this.#tsNextIdx / 2;
    encoder.resolveQuerySet(this.#tsQuerySet, 0, this.#tsNextIdx, this.#tsResolveBuffer!, 0);
    if (this.#tsResultBuffer.mapState === 'unmapped') {
      encoder.copyBufferToBuffer(this.#tsResolveBuffer!, 0, this.#tsResultBuffer, 0, this.#tsNextIdx * 8);
    }
  }

  #readTimestamps() {
    if (!this.#tsResultBuffer || this.#tsResultBuffer.mapState !== 'unmapped') return;
    const passCount = this.#tsPassCount;
    const labels = [...this.#tsLabels];
    this.#tsResultBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const times = new BigInt64Array(this.#tsResultBuffer!.getMappedRange());
        if (passCount > 0) {
          this.#gpuTimeMs = Number(times[passCount * 2 - 1] - times[0]) / 1e6;
        }
        const aggregated = new Map<string, number>();
        let totalGpu = 0;
        for (let i = 0; i < passCount; i++) {
          const ms = (Number(times[i * 2 + 1]) - Number(times[i * 2])) / 1e6;
          const raw = labels[i] || `pass${i}`;
          const dashIdx = raw.indexOf('-');
          const key = dashIdx >= 0 && /^[ENSW]$/.test(raw.substring(0, dashIdx)) ? raw.substring(dashIdx + 1) : raw;
          aggregated.set(key, (aggregated.get(key) ?? 0) + ms);
          totalGpu += ms;
        }
        this.#gpuTimeMs = totalGpu;
        const passTimings: { label: string; ms: number }[] = [];
        for (const [label, ms] of aggregated) {
          passTimings.push({ label, ms });
        }
        this.#gpuPassTimings = passTimings;
        this.#tsResultBuffer!.unmap();
      })
      .catch(() => {});
  }

  override async connectedCallback() {
    super.connectedCallback();
    await this.#initWebGPU();
    this.#initResources();
    this.#initPipelines();
    this.#uploadStaticParams(this.#canvas.width, this.#canvas.height);
    this.#lineBindGroup = undefined;
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

  #updateCanvasLayout() {
    const pp = this.#pp;
    if (pp) {
      this.#canvas.width = pp;
      this.#canvas.height = pp;
      const containerW = this.clientWidth || 800;
      const containerH = this.clientHeight || 600;
      const displaySize = Math.min(containerW - 64, containerH - 64);
      Object.assign(this.#canvas.style, {
        position: 'absolute',
        left: `${(containerW - displaySize) / 2}px`,
        top: `${(containerH - displaySize) / 2}px`,
        width: `${displaySize}px`,
        height: `${displaySize}px`,
        pointerEvents: 'none',
        imageRendering: 'pixelated',
      });
    } else {
      this.#canvas.width = this.clientWidth || 800;
      this.#canvas.height = this.clientHeight || 600;
      Object.assign(this.#canvas.style, {
        position: 'absolute',
        inset: '0',
        left: '',
        top: '',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        imageRendering: '',
      });
    }
  }

  #rebuild() {
    this.#destroyResources();
    this.#initResources();
    this.#createStaticBindGroups();
    this.#uploadStaticParams(this.#canvas.width, this.#canvas.height);
    this.#lineBindGroup = undefined;
  }

  #mapToCanvas(x: number, y: number): [number, number] {
    const rect = this.#canvas.getBoundingClientRect();
    if (!this.#pp) return [x - rect.left, y - rect.top];
    return [(x - rect.left) * (this.#canvas.width / rect.width), (y - rect.top) * (this.#canvas.height / rect.height)];
  }

  #scaleToCanvas(v: number): number {
    if (!this.#pp) return v;
    const rect = this.#canvas.getBoundingClientRect();
    return v * (this.#canvas.width / rect.width);
  }

  #ensureSceneCanvas() {
    const pp = this.#pp;
    if (!pp) return;
    if (!this.#sceneCanvas || this.#sceneCanvas.width !== pp) {
      this.#sceneCanvas = document.createElement('canvas');
      this.#sceneCanvas.width = pp;
      this.#sceneCanvas.height = pp;
      this.#sceneCtx = this.#sceneCanvas.getContext('2d')!;
    }
  }

  #sceneColor(r: number, g: number, b: number, a: number): string {
    const u = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgba(${u(r)},${u(g)},${u(b)},${a})`;
  }

  addLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: [number, number, number] = [0, 0, 0],
    thickness = 20,
    opacity = 1,
    albedo = 0,
  ) {
    if (this.#pp) {
      this.#ensureSceneCanvas();
      [x1, y1] = this.#mapToCanvas(x1, y1);
      [x2, y2] = this.#mapToCanvas(x2, y2);
      const ctx = this.#sceneCtx!;
      ctx.fillStyle = this.#sceneColor(color[0], color[1], color[2], opacity);
      const bs = Math.max(1, thickness);
      const blo = -Math.floor((bs - 1) / 2);
      const dx = Math.abs(Math.floor(x2) - Math.floor(x1));
      const dy = Math.abs(Math.floor(y2) - Math.floor(y1));
      const sx = x1 < x2 ? 1 : -1;
      const sy = y1 < y2 ? 1 : -1;
      let err = dx - dy;
      let x = Math.floor(x1),
        y = Math.floor(y1);
      const ex = Math.floor(x2),
        ey = Math.floor(y2);
      for (;;) {
        ctx.fillRect(x + blo, y + blo, bs, bs);
        if (x === ex && y === ey) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
      return;
    }
    const [r, g, b] = color;
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness, opacity, albedo]);
    this.#lineBufferDirty = true;
  }

  clearLines() {
    this.#lines = [];
    this.#lineBufferDirty = true;
    if (this.#sceneCanvas && this.#sceneCtx) {
      this.#sceneCtx.clearRect(0, 0, this.#sceneCanvas.width, this.#sceneCanvas.height);
    }
  }

  loadSceneImage(img: HTMLImageElement) {
    const size = img.width;
    if (img.width !== img.height) {
      console.warn('Scene PNG must be square, got', img.width, 'x', img.height);
      return;
    }
    this.pixelPerfect = size;
    this.clearLines();
    this.#ensureSceneCanvas();
    this.#sceneCtx!.drawImage(img, 0, 0);
  }

  saveScenePNG(filename = 'scene.png') {
    if (!this.#sceneCanvas) {
      console.warn('saveScenePNG only works in pixel-perfect mode');
      return;
    }
    const a = document.createElement('a');
    a.href = this.#sceneCanvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  }

  setMouseLightColor(r: number, g: number, b: number) {
    this.#mouseLightColor = { r, g, b };
    this.#mouseDirty = true;
  }

  setMouseLightRadius(radius: number) {
    this.#mouseLightRadius = radius;
    this.#mouseDirty = true;
  }

  setMouseLightMaterial(opacity: number, albedo: number) {
    this.#mouseLightOpacity = opacity;
    this.#mouseLightAlbedo = albedo;
    this.#mouseDirty = true;
  }

  eraseAt(x: number, y: number, radius: number) {
    if (this.#pp && this.#sceneCtx) {
      [x, y] = this.#mapToCanvas(x, y);
      radius = this.#scaleToCanvas(radius);
      const ctx = this.#sceneCtx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.clearRect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
      return;
    }
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

  setSkyColor(r: number, g: number, b: number) {
    for (let i = 0; i < SKY_CIRCLE_SIZE; i++) {
      this.#skyCircleData[i * 4] = r;
      this.#skyCircleData[i * 4 + 1] = g;
      this.#skyCircleData[i * 4 + 2] = b;
      this.#skyCircleData[i * 4 + 3] = 1;
    }
    this.#uploadSkyCircle();
  }

  setSkyCircle(data: Float32Array) {
    if (data.length !== SKY_CIRCLE_SIZE * 4) {
      throw new Error(`Sky circle data must have ${SKY_CIRCLE_SIZE * 4} elements (${SKY_CIRCLE_SIZE} RGBA texels)`);
    }
    this.#skyCircleData.set(data);
    this.#uploadSkyCircle();
  }

  clearSky() {
    this.#skyCircleData.fill(0);
    this.#uploadSkyCircle();
  }

  #uploadSkyCircle() {
    if (!this.#device || !this.#skyTexture) return;
    this.#device.queue.writeTexture(
      { texture: this.#skyTexture },
      this.#skyCircleData,
      { bytesPerRow: SKY_CIRCLE_SIZE * 16 },
      { width: SKY_CIRCLE_SIZE, height: 1 },
    );
    this.#computeSkyPrefixSums();
  }

  #computeSkyPrefixSums() {
    if (!this.#device || !this.#skyPrefixSumTexture || !this.#canvas) return;
    const ms = this.#mergeStride;
    const rowLen = ms + 1;
    const data = new Float32Array(rowLen * 4 * 4);

    for (let dir = 0; dir < 4; dir++) {
      const rowOff = dir * rowLen * 4;

      data[rowOff] = 0;
      data[rowOff + 1] = 0;
      data[rowOff + 2] = 0;
      data[rowOff + 3] = 0;

      for (let s = 0; s < ms; s++) {
        const N = ms;
        const slope = (2 * s - N + 1) / N;
        let angle: number;
        switch (dir) {
          case 0:
            angle = Math.atan2(slope, 1);
            break;
          case 1:
            angle = Math.atan2(1, slope);
            break;
          case 2:
            angle = Math.atan2(slope, -1);
            break;
          default:
            angle = Math.atan2(-1, slope);
            break;
        }
        const u = (angle + Math.PI) / (Math.PI * 2);
        const skyIdx = Math.max(0, Math.min(SKY_CIRCLE_SIZE - 1, Math.floor(u * SKY_CIRCLE_SIZE)));
        const skyR = this.#skyCircleData[skyIdx * 4];
        const skyG = this.#skyCircleData[skyIdx * 4 + 1];
        const skyB = this.#skyCircleData[skyIdx * 4 + 2];

        const cW = Math.atan2(2 * s - N + 2, N) - Math.atan2(2 * s - N, N);

        const prevOff = rowOff + s * 4;
        const currOff = rowOff + (s + 1) * 4;
        data[currOff] = data[prevOff] + skyR * cW;
        data[currOff + 1] = data[prevOff + 1] + skyG * cW;
        data[currOff + 2] = data[prevOff + 2] + skyB * cW;
        data[currOff + 3] = 0;
      }
    }

    const bytesPerRow = rowLen * 16;
    const alignedBytesPerRow = Math.ceil(bytesPerRow / 256) * 256;
    const padded = new Float32Array((alignedBytesPerRow / 4) * 4);
    for (let dir = 0; dir < 4; dir++) {
      const srcOff = dir * rowLen * 4;
      const dstOff = dir * (alignedBytesPerRow / 4);
      padded.set(data.subarray(srcOff, srcOff + rowLen * 4), dstOff);
    }

    this.#device.queue.writeTexture(
      { texture: this.#skyPrefixSumTexture },
      padded,
      { bytesPerRow: alignedBytesPerRow, rowsPerImage: 4 },
      { width: rowLen, height: 4 },
    );
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    const probeChanged = changedProperties.has('probeCount') && changedProperties.get('probeCount') !== undefined;
    const ppChanged = changedProperties.has('pixelPerfect') && changedProperties.get('pixelPerfect') !== undefined;
    if (probeChanged || ppChanged) {
      if (ppChanged) {
        this.#updateCanvasLayout();
        this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
      }
      this.#rebuild();
    }
    if (
      probeChanged ||
      ppChanged ||
      changedProperties.has('exposure') ||
      changedProperties.has('bounces') ||
      changedProperties.has('debugMode') ||
      changedProperties.has('falseColor')
    ) {
      this.#ptFrameIndex = 0;
    }
  }

  // ── WebGPU init ──

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    const canTimestamp = adapter.features.has('timestamp-query');
    const canFloat32Filter = adapter.features.has('float32-filterable');
    const features: GPUFeatureName[] = [];
    if (canTimestamp) features.push('timestamp-query' as GPUFeatureName);
    if (canFloat32Filter) features.push('float32-filterable' as GPUFeatureName);
    this.#device = await adapter.requestDevice({ requiredFeatures: features });
    if (canTimestamp) {
      this.#initTimestampQueries();
    }

    this.#canvas = document.createElement('canvas');
    this.#updateCanvasLayout();
    this.renderRoot.prepend(this.#canvas);

    const context = this.#canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to get WebGPU context.');
    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    // Chrome adds 1-2 frames of input lag because WebGPU doesn't support
    // desynchronized canvas contexts yet (gpuweb/gpuweb#1224, Milestone 4+).
    // WebGL can bypass the compositor with desynchronized:true, WebGPU can't.
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
    this.#linearSampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  #initResources() {
    const device = this.#device;
    const { width, height } = this.#canvas;
    const maxDim = Math.max(width, height);
    const ps = Math.max(2, this.probeCount);
    const pp = this.#pp;
    const probesX = pp ? pp : Math.max(2, ceilDiv(width * ps, maxDim));
    const probesY = pp ? pp : Math.max(2, ceilDiv(height * ps, maxDim));
    const probesMax = Math.max(probesX, probesY);
    this.#probesX = probesX;
    this.#probesY = probesY;
    this.#numCascades = ceilLog2(probesMax);
    const mergeStride = nextPow2(probesMax);
    this.#mergeStride = mergeStride;

    const ubo = (label: string, size: number) =>
      device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    [this.#worldTexture, this.#worldTextureView] = tex(
      device,
      'World',
      width,
      height,
      'rgba16float',
      TEX_RENDER | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    );
    [this.#materialTexture, this.#materialTextureView] = tex(device, 'Material', width, height, 'r8unorm', TEX_RENDER);

    // Ray/merge buffers are shared across all 4 directions, sized for worst case.
    // Level 0 stores one entry per probe (no sub-probe duplication).
    this.#rayBuffers = [];
    for (let i = 0; i < this.#numCascades; i++) {
      const w = i === 0 ? probesMax : ceilDiv(probesMax, 1 << i) * ((1 << i) + 1);
      this.#rayBuffers.push(
        device.createBuffer({ label: `Ray-${i}`, size: w * probesMax * 8, usage: GPUBufferUsage.STORAGE }),
      );
    }

    this.#mergeBuffers = [0, 1].map((i) =>
      device.createBuffer({ label: `Merge-${i}`, size: mergeStride * probesMax * 4, usage: GPUBufferUsage.STORAGE }),
    );
    const alignedFluenceRow = Math.ceil((probesX * 4) / 256) * 256;
    this.#fluenceBuffer = device.createBuffer({
      label: 'Fluence-SSBO',
      size: alignedFluenceRow * probesY,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#fluenceStride = alignedFluenceRow / 4;
    const [ft, fv] = tex(
      device,
      'Fluence',
      probesX,
      probesY,
      'rgba16float',
      GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.COPY_SRC,
    );
    this.#fluenceTexture = ft;
    this.#fluenceTextureView = fv;

    [this.#bounceTexture, this.#bounceTextureView] = tex(
      device,
      'Bounce',
      probesX,
      probesY,
      'rgba16float',
      TEX_STORAGE | GPUTextureUsage.COPY_DST,
    );
    // bytesPerRow must be 256-aligned for WebGPU copy operations.
    const alignedBounceRow = Math.ceil((probesX * 8) / 256) * 256;
    const bounceZeroSize = alignedBounceRow * probesY;
    this.#bounceZeroBuffer = device.createBuffer({ size: bounceZeroSize, usage: GPUBufferUsage.COPY_SRC });
    device.queue.writeTexture(
      { texture: this.#bounceTexture },
      new Uint8Array(bounceZeroSize),
      { bytesPerRow: alignedBounceRow, rowsPerImage: probesY },
      { width: probesX, height: probesY },
    );
    [this.#skyTexture, this.#skyTextureView] = tex(
      device,
      'Sky',
      SKY_CIRCLE_SIZE,
      1,
      'rgba32float',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    );
    this.#uploadSkyCircle();

    [this.#skyPrefixSumTexture, this.#skyPrefixSumTextureView] = tex(
      device,
      'SkyPrefixSum',
      mergeStride + 1,
      4,
      'rgba32float',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    );

    this.#lastFluenceReady = false;

    const totalConeArcs = 2 * (1 << this.#numCascades) - 2;
    this.#coneArcBuffer = device.createBuffer({
      size: Math.max(4, totalConeArcs * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // GPU buffers are zero-initialized by default in WebGPU

    this.#seedParamsView = uboView(raySeedShader, 'params');
    this.#extendParamsView = uboView(rayExtendShader, 'params');
    this.#mergeParamsView = uboView(cascadeMergeShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');
    this.#bounceParamsView = uboView(bounceComputeShader, 'params');

    this.#seedParamsBuffer = ubo('SeedParams', 4 * 256);
    this.#extendParamsBuffer = ubo('ExtendParams', 2 * Math.max(1, this.#numCascades - 1) * 256);
    this.#mergeParamsBuffer = ubo('MergeParams', 4 * this.#numCascades * 256);
    this.#blitParamsBuffer = ubo('BlitParams', this.#blitParamsView.arrayBuffer.byteLength);
    this.#bounceParamsBuffer = ubo('BounceParams', this.#bounceParamsView.arrayBuffer.byteLength);

    this.#fluenceBlurParamsBuffer = ubo('FluenceBlurParams', 32);
    device.queue.writeBuffer(
      this.#fluenceBlurParamsBuffer,
      0,
      new Uint32Array([probesX, probesY, this.#fluenceStride, width, height, 0, 0, 0]),
    );

    const ptUsage = TEX_STORAGE | GPUTextureUsage.COPY_SRC;
    const [ptA0, ptV0] = tex(device, 'PT-Accum-0', width, height, 'rgba32float', ptUsage);
    const [ptA1, ptV1] = tex(device, 'PT-Accum-1', width, height, 'rgba32float', ptUsage);
    this.#ptAccumTextures = [ptA0, ptA1];
    this.#ptAccumTextureViews = [ptV0, ptV1];
    this.#ptParamsView = uboView(pathTraceShader, 'params');
    this.#ptParamsBuffer = ubo('PT-Params', this.#ptParamsView.arrayBuffer.byteLength);
  }

  #initPipelines() {
    const device = this.#device;
    const MRT_TARGETS: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: 'r8unorm' }];

    const attr = (loc: number, off: number, fmt: GPUVertexFormat): GPUVertexAttribute => ({
      shaderLocation: loc,
      offset: off,
      format: fmt,
    });

    const fullscreenBlit = (label: string, code: string, format: GPUTextureFormat) => {
      const module = device.createShaderModule({ code });
      return device.createRenderPipeline({
        label,
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-strip' },
      });
    };

    const worldModule = device.createShaderModule({ code: worldRenderShader });
    this.#worldRenderPipeline = device.createRenderPipeline({
      label: 'HRC-WorldRender',
      layout: 'auto',
      vertex: {
        module: worldModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 28,
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x3'),
              attr(2, 20, 'float32'),
              attr(3, 24, 'float32'),
            ],
          },
        ],
      },
      fragment: { module: worldModule, entryPoint: 'fragment_main', targets: MRT_TARGETS },
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
            arrayStride: 40,
            stepMode: 'instance',
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x2'),
              attr(2, 16, 'float32x3'),
              attr(3, 28, 'float32'),
              attr(4, 32, 'float32'),
              attr(5, 36, 'float32'),
            ],
          },
        ],
      },
      fragment: { module: lineModule, entryPoint: 'fragment_main', targets: MRT_TARGETS },
      primitive: { topology: 'triangle-list' },
    });

    this.#bounceComputePipeline = computePipeline(device, 'HRC-BounceCompute', bounceComputeShader);
    this.#raySeedPipeline = computePipeline(device, 'HRC-RaySeed', raySeedShader);
    this.#rayExtendPipeline = computePipeline(device, 'HRC-RayExtend', rayExtendShader);
    this.#cascadeMergePipeline = computePipeline(device, 'HRC-CascadeMerge', cascadeMergeShader);
    this.#fluenceBlurPipeline = computePipeline(device, 'HRC-FluenceBlur', fluenceBlurShader);
    this.#renderPipeline = fullscreenBlit('HRC-Blit', blitShader, this.#presentationFormat);
    this.#ptPipeline = computePipeline(device, 'PT-PathTrace', pathTraceShader);

    this.#createStaticBindGroups();
  }

  #createStaticBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;
    const seedLayout = this.#raySeedPipeline.getBindGroupLayout(0);
    const extLayout = this.#rayExtendPipeline.getBindGroupLayout(0);
    const mergeLayout = this.#cascadeMergePipeline.getBindGroupLayout(0);
    const seedPS = this.#seedParamsView.arrayBuffer.byteLength;
    const extPS = this.#extendParamsView.arrayBuffer.byteLength;
    const mergePS = this.#mergeParamsView.arrayBuffer.byteLength;

    this.#seedBindGroups = [0, 1, 2, 3].map((dir) =>
      bg(
        device,
        seedLayout,
        this.#worldTextureView,
        this.#bounceTextureView,
        { buffer: this.#rayBuffers[0] },
        {
          buffer: this.#seedParamsBuffer,
          offset: dir * 256,
          size: seedPS,
        },
      ),
    );

    // Extend params depend only on the frustum shape (pc, sc), not the direction.
    // cfg 0 = E/W (probesX, probesY), cfg 1 = N/S (probesY, probesX). Indexed in #runCascade as dir & 1.
    this.#extendBindGroups = [];
    for (let cfg = 0; cfg < 2; cfg++) {
      for (let level = 1; level < nc; level++) {
        this.#extendBindGroups.push(
          bg(
            device,
            extLayout,
            { buffer: this.#rayBuffers[level - 1] },
            { buffer: this.#rayBuffers[level] },
            {
              buffer: this.#extendParamsBuffer,
              offset: (cfg * (nc - 1) + (level - 1)) * 256,
              size: extPS,
            },
          ),
        );
      }
    }

    this.#mergeBindGroups = [];
    for (let dir = 0; dir < 4; dir++) {
      const dirBGs: GPUBindGroup[] = [];
      let readIdx = 1,
        writeIdx = 0;
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        dirBGs.push(
          bg(
            device,
            mergeLayout,
            { buffer: this.#rayBuffers[level] },
            { buffer: this.#mergeBuffers[readIdx] },
            { buffer: this.#mergeBuffers[writeIdx] },
            { buffer: this.#mergeParamsBuffer, offset: (dir * nc + level) * 256, size: mergePS },
            { buffer: this.#fluenceBuffer },
            this.#skyPrefixSumTextureView,
            { buffer: this.#coneArcBuffer },
          ),
        );
        [readIdx, writeIdx] = [writeIdx, readIdx];
      }
      this.#mergeBindGroups.push(dirBGs);
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
      this.#ptAccumTextureViews[0],
    );

    this.#bounceBindGroup = bg(
      device,
      this.#bounceComputePipeline.getBindGroupLayout(0),
      this.#fluenceTextureView,
      this.#worldTextureView,
      this.#materialTextureView,
      this.#bounceTextureView,
      { buffer: this.#bounceParamsBuffer },
    );
  }

  #destroyResources() {
    this.#worldTexture?.destroy();
    this.#materialTexture?.destroy();
    this.#rayBuffers?.forEach((b) => b.destroy());
    this.#mergeBuffers?.forEach((b) => b.destroy());
    this.#fluenceBuffer?.destroy();
    this.#fluenceTexture?.destroy();
    this.#coneArcBuffer?.destroy();
    this.#bounceZeroBuffer?.destroy();
    this.#bounceTexture?.destroy();
    this.#skyTexture?.destroy();
    this.#skyPrefixSumTexture?.destroy();
    this.#ptAccumTextures?.forEach((t) => t.destroy());
    this.#ptParamsBuffer?.destroy();
    this.#seedParamsBuffer?.destroy();
    this.#extendParamsBuffer?.destroy();
    this.#mergeParamsBuffer?.destroy();
    this.#blitParamsBuffer?.destroy();
    this.#bounceParamsBuffer?.destroy();
    this.#fluenceBlurParamsBuffer?.destroy();
  }

  // ── Shape / line data ──

  #shapeVertexData?: Float32Array<ArrayBuffer>;

  #updateShapeData() {
    const count = this.sourceElements.size;
    this.#shapeCount = count;
    if (count === 0) return;

    const FLOATS_PER_VERTEX = 7;
    const VERTICES_PER_SHAPE = 6;
    const STRIDE = FLOATS_PER_VERTEX * VERTICES_PER_SHAPE;
    const needed = count * STRIDE;
    if (!this.#shapeVertexData || this.#shapeVertexData.length < needed) {
      this.#shapeVertexData = new Float32Array(needed);
    }
    const verts = this.#shapeVertexData;

    const cw = this.#canvas.width;
    const ch = this.#canvas.height;
    const invCw2 = 2 / cw;
    const invCh2 = 2 / ch;
    const pp = this.#pp;
    let ppScale = 0,
      ppOffX = 0,
      ppOffY = 0;
    if (pp) {
      const rect = this.#canvas.getBoundingClientRect();
      ppScale = this.#canvas.width / rect.width;
      ppOffX = rect.left;
      ppOffY = rect.top;
    }

    let i = 0;
    for (const element of this.sourceElements) {
      const shape = element as HTMLElement & { x: number; y: number; width: number; height: number; rotation: number };
      let sx = shape.x ?? 0;
      let sy = shape.y ?? 0;
      let sw = shape.width ?? 0;
      let sh = shape.height ?? 0;
      const rot = shape.rotation ?? 0;

      if (pp) {
        sx = (sx - ppOffX) * ppScale;
        sy = (sy - ppOffY) * ppScale;
        sw = sw * ppScale;
        sh = sh * ppScale;
      }

      const rgbAttr = element.getAttribute('data-rgb');
      let r = 0,
        g = 0,
        b = 0;
      if (rgbAttr) {
        const c1 = rgbAttr.indexOf(',');
        const c2 = rgbAttr.indexOf(',', c1 + 1);
        r = +rgbAttr.substring(0, c1) || 0;
        g = +rgbAttr.substring(c1 + 1, c2) || 0;
        b = +rgbAttr.substring(c2 + 1) || 0;
      }
      const opacityAttr = element.getAttribute('data-opacity');
      const opacity = opacityAttr !== null ? +opacityAttr : 1;
      const albedoAttr = element.getAttribute('data-albedo');
      const albedo = albedoAttr !== null ? +albedoAttr : 0;

      const mx = sx + sw * 0.5;
      const my = sy + sh * 0.5;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);

      const hlx = -sw * 0.5,
        hly = -sh * 0.5;
      const hrx = sw * 0.5,
        hry = -sh * 0.5;
      const blx = -sw * 0.5,
        bly = sh * 0.5;
      const brx = sw * 0.5,
        bry = sh * 0.5;

      const tlX = (mx + hlx * cos - hly * sin) * invCw2 - 1;
      const tlY = 1 - (my + hlx * sin + hly * cos) * invCh2;
      const trX = (mx + hrx * cos - hry * sin) * invCw2 - 1;
      const trY = 1 - (my + hrx * sin + hry * cos) * invCh2;
      const blX = (mx + blx * cos - bly * sin) * invCw2 - 1;
      const blY = 1 - (my + blx * sin + bly * cos) * invCh2;
      const brX = (mx + brx * cos - bry * sin) * invCw2 - 1;
      const brY = 1 - (my + brx * sin + bry * cos) * invCh2;

      const off = i * STRIDE;
      verts[off] = tlX;
      verts[off + 1] = tlY;
      verts[off + 2] = r;
      verts[off + 3] = g;
      verts[off + 4] = b;
      verts[off + 5] = opacity;
      verts[off + 6] = albedo;
      verts[off + 7] = trX;
      verts[off + 8] = trY;
      verts[off + 9] = r;
      verts[off + 10] = g;
      verts[off + 11] = b;
      verts[off + 12] = opacity;
      verts[off + 13] = albedo;
      verts[off + 14] = blX;
      verts[off + 15] = blY;
      verts[off + 16] = r;
      verts[off + 17] = g;
      verts[off + 18] = b;
      verts[off + 19] = opacity;
      verts[off + 20] = albedo;
      verts[off + 21] = trX;
      verts[off + 22] = trY;
      verts[off + 23] = r;
      verts[off + 24] = g;
      verts[off + 25] = b;
      verts[off + 26] = opacity;
      verts[off + 27] = albedo;
      verts[off + 28] = brX;
      verts[off + 29] = brY;
      verts[off + 30] = r;
      verts[off + 31] = g;
      verts[off + 32] = b;
      verts[off + 33] = opacity;
      verts[off + 34] = albedo;
      verts[off + 35] = blX;
      verts[off + 36] = blY;
      verts[off + 37] = r;
      verts[off + 38] = g;
      verts[off + 39] = b;
      verts[off + 40] = opacity;
      verts[off + 41] = albedo;
      i++;
    }

    this.#shapeDataBuffer = uploadVertexData(this.#device, this.#shapeDataBuffer, verts, needed);
  }

  #updateLineBuffer() {
    if (!this.#device || this.#lines.length === 0) {
      this.#lineCount = 0;
      return;
    }
    const count = this.#lines.length;
    const FPL = 10;
    if (!this.#lineInstanceBuffer || this.#lineInstanceCapacity < count) {
      this.#lineInstanceBuffer?.destroy();
      this.#lineInstanceCapacity = Math.max(count, 256);
      this.#lineInstanceBuffer = this.#device.createBuffer({
        size: this.#lineInstanceCapacity * FPL * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }
    const data = new Float32Array(count * FPL);
    for (let i = 0; i < count; i++) data.set(this.#lines[i], i * FPL);
    this.#device.queue.writeBuffer(this.#lineInstanceBuffer, 0, data);
    this.#lineCount = count;
  }

  #updateMouseLightBuffer() {
    if (!this.#device) return;
    let { x, y } = this.#mousePosition;
    const { r, g, b } = this.#mouseLightColor;
    const op = this.#mouseLightOpacity;
    const al = this.#mouseLightAlbedo;
    const verts: number[] = [];

    const pp = this.#pp;
    if (pp) {
      const cw = this.#canvas.width,
        ch = this.#canvas.height;
      const cx = Math.floor(x),
        cy = Math.floor(y);
      const bs = Math.max(1, this.#mouseLightRadius * 2);
      const blo = -Math.floor((bs - 1) / 2),
        bhi = Math.floor(bs / 2);
      for (let by = blo; by <= bhi; by++) {
        for (let bx = blo; bx <= bhi; bx++) {
          const px = cx + bx,
            py = cy + by;
          if (px >= 0 && py >= 0 && px < pp && py < pp) {
            const x0 = (px / cw) * 2 - 1,
              y0 = 1 - (py / ch) * 2;
            const x1 = ((px + 1) / cw) * 2 - 1,
              y1 = 1 - ((py + 1) / ch) * 2;
            verts.push(x0, y0, r, g, b, op, al, x1, y0, r, g, b, op, al, x0, y1, r, g, b, op, al);
            verts.push(x1, y0, r, g, b, op, al, x1, y1, r, g, b, op, al, x0, y1, r, g, b, op, al);
          }
        }
      }
    } else {
      const SEGS = 12;
      const rad = this.#mouseLightRadius;
      const toClipX = (px: number) => (px / this.#canvas.width) * 2 - 1;
      const toClipY = (py: number) => 1 - (py / this.#canvas.height) * 2;
      const rx = (rad / this.#canvas.width) * 2;
      const ry = (rad / this.#canvas.height) * 2;
      const cx = toClipX(x);
      const cy = toClipY(y);
      for (let i = 0; i < SEGS; i++) {
        const a0 = (i / SEGS) * Math.PI * 2;
        const a1 = ((i + 1) / SEGS) * Math.PI * 2;
        verts.push(cx, cy, r, g, b, op, al);
        verts.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b, op, al);
        verts.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b, op, al);
      }
    }

    this.#mouseLightVertexCount = verts.length / 7;
    this.#mouseLightBuffer = uploadVertexData(this.#device, this.#mouseLightBuffer, new Float32Array(verts));
  }

  // ── Render loop ──

  #startAnimationLoop() {
    const render = (now: number) => {
      if (!this.#isRunning) return;
      this.#updateFrameTiming(now);
      const jsStart = performance.now();
      this.#renderFrame();
      this.#jsTimeMs = performance.now() - jsStart;
      this.#animationFrame = requestAnimationFrame(render);
    };
    this.#animationFrame = requestAnimationFrame(render);
  }

  #renderFrame() {
    this.#updateShapeData();
    if (this.#lineBufferDirty) {
      this.#lineBufferDirty = false;
      this.#updateLineBuffer();
    }
    if (this.#mouseDirty) {
      this.#mouseDirty = false;
      this.#updateMouseLightBuffer();
    }

    const { width, height } = this.#canvas;
    const device = this.#device;

    this.#blitParamsView.set({
      exposure: this.exposure,
      screenW: width,
      screenH: height,
      debugMode: this.debugMode,
      falseColor: this.falseColor ? 1.0 : 0.0,
      pad0: 0,
      pad1: 0,
      pad2: 0,
    });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    const encoder = device.createCommandEncoder();
    this.#tsBeginFrame();

    // ── Step 1: Render world textures (world + material) ──
    const hasScene = this.#sceneCanvas && this.#sceneCanvas.width === width;
    if (hasScene) {
      device.queue.copyExternalImageToTexture(
        { source: this.#sceneCanvas!, flipY: false },
        { texture: this.#worldTexture, premultipliedAlpha: false },
        { width, height },
      );
    }
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#worldTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: hasScene ? 'load' : 'clear',
            storeOp: 'store',
          },
          {
            view: this.#materialTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        timestampWrites: this.#tsPass('world'),
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
          this.#lineBindGroup = bg(device, this.#lineRenderPipeline.getBindGroupLayout(0), { buffer: this.#lineUBO });
        }
        pass.setBindGroup(0, this.#lineBindGroup);
        pass.setVertexBuffer(0, this.#lineInstanceBuffer);
        pass.draw(6, this.#lineCount);
        pass.setPipeline(this.#worldRenderPipeline);
      }
      const { r: mr, g: mg, b: mb } = this.#mouseLightColor;
      if (
        this.#mouseLightBuffer &&
        this.#mouseLightVertexCount > 0 &&
        (mr > 0 || mg > 0 || mb > 0 || this.#mouseLightOpacity > 0)
      ) {
        pass.setVertexBuffer(0, this.#mouseLightBuffer);
        pass.draw(this.#mouseLightVertexCount);
      }
      pass.end();
    }

    // ── Step 1.5: Bounce compute (reads previous frame's fluence at probe resolution) ──
    if (!this.bounces && this.#lastFluenceReady) {
      this.#lastFluenceReady = false;
      encoder.copyBufferToTexture(
        {
          buffer: this.#bounceZeroBuffer,
          bytesPerRow: Math.ceil((this.#probesX * 8) / 256) * 256,
          rowsPerImage: this.#probesY,
        },
        { texture: this.#bounceTexture },
        { width: this.#probesX, height: this.#probesY },
      );
    }
    if (this.bounces && this.#lastFluenceReady) {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass('bounce') });
      pass.setPipeline(this.#bounceComputePipeline);
      pass.setBindGroup(0, this.#bounceBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.#probesX / WG_BOUNCE[0]), Math.ceil(this.#probesY / WG_BOUNCE[1]));
      pass.end();
    }

    // ── Step 2: HRC cascade processing ──
    // Run the per-frustum algorithm once per cardinal direction.
    // E/W share frustum shape (probesX × probesY), N/S share (probesY × probesX).
    encoder.clearBuffer(this.#fluenceBuffer);

    for (let dir = 0; dir < 4; dir++) {
      const pc = dir & 1 ? this.#probesY : this.#probesX;
      const sc = dir & 1 ? this.#probesX : this.#probesY;
      this.#runCascade(encoder, dir, pc, sc);
    }

    this.#lastFluenceReady = true;

    // ── Step 2.5: Fluence SSBO → texture (cross-blur + RGB9E5→f16 conversion) ──
    {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass('blur') });
      pass.setPipeline(this.#fluenceBlurPipeline);
      pass.setBindGroup(0, this.#fluenceBlurBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.#probesX / WG_BLUR[0]), Math.ceil(this.#probesY / WG_BLUR[1]));
      pass.end();
    }

    // ── Step 2.75: Run PT alongside HRC for PT or PT-diff modes ──
    if (this.debugMode === 1 || this.debugMode === 2) {
      this.#runPathTraceCompute(encoder, width, height);
    }

    // ── Step 3: Final blit ──
    let blitBG = this.#blitBindGroup;
    if (this.debugMode === 1 || this.debugMode === 2) {
      const ptWriteIdx = this.#ptFrameIndex % 2;
      blitBG = bg(
        device,
        this.#renderPipeline.getBindGroupLayout(0),
        this.#fluenceTextureView,
        this.#worldTextureView,
        { buffer: this.#blitParamsBuffer },
        this.#linearSampler,
        this.#ptAccumTextureViews[ptWriteIdx],
      );
    }
    this.#blitToScreen(encoder, this.#renderPipeline, blitBG);

    this.#resolveTimestamps(encoder);
    this.#submitAndCapture(device, encoder);
    this.#readTimestamps();
  }

  // HRC is a per-frustum algorithm: given (probeCount × sliceCount), run
  // seed → extend → merge to produce fluence contributions. The `dir`
  // parameter (0=E, 1=N, 2=W, 3=S) selects pre-built bind groups but
  // does not affect the algorithm structure.
  #runCascade(encoder: GPUCommandEncoder, dir: number, pc: number, sc: number) {
    const nc = this.#numCascades;
    const dn = ['E', 'N', 'W', 'S'][dir];
    const cfg = dir & 1;

    // Phase A: Seed — trace T_0 directly (paper §4.2, Alg. 1 line 3)
    {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass(`${dn}-seed`) });
      pass.setPipeline(this.#raySeedPipeline);
      pass.setBindGroup(0, this.#seedBindGroups[dir]);
      pass.dispatchWorkgroups(Math.ceil(pc / WG_SEED[0]), Math.ceil(sc / WG_SEED[1]));
      pass.end();
    }

    // Phase B: Extend / "Merge Up" — build T_1..T_{N-1} bottom-up (Eq. 18, 20)
    {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass(`${dn}-extend`) });
      pass.setPipeline(this.#rayExtendPipeline);
      for (let level = 1; level < nc; level++) {
        const rayWidth = ceilDiv(pc, 1 << level) * ((1 << level) + 1);
        pass.setBindGroup(0, this.#extendBindGroups[cfg * (nc - 1) + (level - 1)]);
        pass.dispatchWorkgroups(Math.ceil(rayWidth / WG_EXTEND[0]), Math.ceil(sc / WG_EXTEND[1]));
      }
      pass.end();
    }

    // Phase C: "Merge Down" — resolve R_{N-1}..R_0 top-down (Eq. 14-15), write fluence at level 0
    {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass(`${dn}-merge`) });
      pass.setPipeline(this.#cascadeMergePipeline);
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        const levelProbes = ceilDiv(pc, 1 << level);
        pass.setBindGroup(0, this.#mergeBindGroups[dir][k]);
        pass.dispatchWorkgroups(Math.ceil((levelProbes * (1 << level)) / WG_MERGE[0]), Math.ceil(sc / WG_MERGE[1]));
      }
      pass.end();
    }
  }

  #blitToScreen(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, tsLabel = '') {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear' as const,
          storeOp: 'store' as const,
        },
      ],
      ...(tsLabel ? { timestampWrites: this.#tsPass(tsLabel) } : {}),
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setViewport(0, 0, this.#canvas.width, this.#canvas.height, 0, 1);
    pass.draw(4);
    pass.end();
  }

  #submitAndCapture(device: GPUDevice, encoder: GPUCommandEncoder) {
    device.queue.submit([encoder.finish()]);

    if (this.#pendingScreenshot) {
      const filename = this.#pendingScreenshot;
      this.#pendingScreenshot = '';
      const tmp = document.createElement('canvas');
      tmp.width = this.#canvas.width;
      tmp.height = this.#canvas.height;
      const ctx2d = tmp.getContext('2d')!;
      ctx2d.drawImage(this.#canvas, 0, 0);
      tmp.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
  }

  #runPathTraceCompute(encoder: GPUCommandEncoder, width: number, height: number) {
    const device = this.#device;
    const readIdx = this.#ptFrameIndex % 2;
    const writeIdx = 1 - readIdx;

    this.#ptParamsView.set({
      screenW: width,
      screenH: height,
      frameIndex: this.#ptFrameIndex,
      samplesPerPixel: 16,
      maxBounces: this.bounces ? 2000 : 0,
      pad0: 0,
      pad1: 0,
      pad2: 0,
    });
    device.queue.writeBuffer(this.#ptParamsBuffer, 0, this.#ptParamsView.arrayBuffer);

    const ptBG = bg(
      device,
      this.#ptPipeline.getBindGroupLayout(0),
      this.#worldTextureView,
      this.#materialTextureView,
      this.#ptAccumTextureViews[readIdx],
      this.#ptAccumTextureViews[writeIdx],
      { buffer: this.#ptParamsBuffer },
      this.#skyTextureView,
    );

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.#ptPipeline);
    pass.setBindGroup(0, ptBG);
    pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    pass.end();
    this.#ptFrameIndex++;
  }

  // TS/shader coupling: the direction-to-slope formula (2s - N + 1) / N in
  // #computeSkyPrefixSums and the angular weight formula atan2(2s-N+2, N) -
  // atan2(2s-N, N) below must stay in sync with the extend/merge shaders'
  // dirToSliceOffset mapping. If direction indexing changes in a shader,
  // both this method and #computeSkyPrefixSums must be updated to match.
  #uploadStaticParams(width: number, height: number) {
    const device = this.#device;
    const probesX = this.#probesX;
    const probesY = this.#probesY;
    const nc = this.#numCascades;

    // Seed params: per direction (4) — includes transform matrix
    for (let dir = 0; dir < 4; dir++) {
      const pc = dir & 1 ? probesY : probesX;
      const sc = dir & 1 ? probesX : probesY;
      const dt = dirTransform(dir, width, height, Math.max(probesX, probesY));
      this.#seedParamsView.set({
        probeCount: pc,
        sliceCount: sc,
        screenW: width,
        screenH: height,
        probeSpacing: dt.probeSpacing,
        pad: 0,
        transformX: [...dt.transformX, 0],
        transformY: [...dt.transformY, 0],
      });
      device.queue.writeBuffer(this.#seedParamsBuffer, dir * 256, this.#seedParamsView.arrayBuffer);
    }

    // Extend params: per frustum config (2) — E/W share (probesX, probesY), N/S share (probesY, probesX)
    for (let cfg = 0; cfg < 2; cfg++) {
      const pc = cfg === 0 ? probesX : probesY;
      const sc = cfg === 0 ? probesY : probesX;
      for (let level = 1; level < nc; level++) {
        const numRays = (1 << level) + 1;
        this.#extendParamsView.set({
          probeCount: pc,
          level,
          invNumRays: 1.0 / numRays,
          prevRayW: level === 1 ? pc : ceilDiv(pc, 1 << (level - 1)) * ((1 << (level - 1)) + 1),
          currRayW: ceilDiv(pc, 1 << level) * numRays,
          sliceCount: sc,
          pad2: 0,
          pad3: 0,
        });
        device.queue.writeBuffer(
          this.#extendParamsBuffer,
          (cfg * (nc - 1) + (level - 1)) * 256,
          this.#extendParamsView.arrayBuffer,
        );
      }
    }

    // Cone arc sizes A_n(i) (paper Eq. 13): shared across all directions.
    // coneArcBase for level l = 2^(l+1) - 2.
    const totalConeArcs = 2 * (1 << nc) - 2;
    const arcData = new Float32Array(totalConeArcs);
    {
      let off = 0;
      for (let level = 0; level < nc; level++) {
        const N = 2 << level;
        for (let s = 0; s < N; s++) {
          arcData[off + s] = Math.atan2(2 * s - N + 2, N) - Math.atan2(2 * s - N, N);
        }
        off += N;
      }
    }
    device.queue.writeBuffer(this.#coneArcBuffer, 0, arcData);

    // Merge params: per direction (4) × per level
    for (let dir = 0; dir < 4; dir++) {
      const pc = dir & 1 ? probesY : probesX;
      const sc = dir & 1 ? probesX : probesY;
      const fNc = ceilLog2(pc);
      const fMs = nextPow2(pc);
      for (let level = 0; level < nc; level++) {
        const numDirections = 1 << level;
        const nextNumDirections = numDirections * 2;
        this.#mergeParamsView.set({
          probeCount: pc,
          numDirections,
          levelProbes: ceilDiv(pc, 1 << level),
          numRays: numDirections + 1,
          nextNumDirections,
          isTopCascade: level === fNc - 1 ? 1 : 0,
          fluenceW: probesX,
          fluenceStride: this.#fluenceStride,
          skyShift: Math.log2(fMs) - Math.log2(nextNumDirections),
          level,
          coneArcBase: (1 << (level + 1)) - 2,
          skyRow: dir,
          sliceCount: sc,
          mergeStride: fMs,
          mergeInWidth: level < fNc - 1 ? ceilDiv(pc, 1 << (level + 1)) * (1 << (level + 1)) : 0,
          direction: dir,
          fluenceH: probesY,
        });
        device.queue.writeBuffer(this.#mergeParamsBuffer, (dir * nc + level) * 256, this.#mergeParamsView.arrayBuffer);
      }
    }

    this.#bounceParamsView.set({ screenW: width, screenH: height, pad0: 0, pad1: 0 });
    device.queue.writeBuffer(this.#bounceParamsBuffer, 0, this.#bounceParamsView.arrayBuffer);

    this.#computeSkyPrefixSums();
  }

  // ── Event handlers ──

  #handleResize = async () => {
    if (this.#pp) return;
    if (this.#resizing) return;
    this.#resizing = true;
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);
    await this.#device.queue.onSubmittedWorkDone();

    this.#updateCanvasLayout();
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
    this.#rebuild();
    this.#updateShapeData();

    this.#resizing = false;
    this.#isRunning = true;
    this.#startAnimationLoop();
  };

  #handleMouseMove = (e: MouseEvent) => {
    const [mx, my] = this.#mapToCanvas(e.clientX, e.clientY);
    this.#mousePosition.x = mx;
    this.#mousePosition.y = my;
    this.#mouseDirty = true;
  };

  #pendingScreenshot = '';

  saveScreenshot(filename = 'hrc-screenshot.png') {
    this.#pendingScreenshot = filename;
  }

  get fps() {
    return this.#smoothedFrameTime > 0 ? Math.round(1000 / this.#smoothedFrameTime) : 0;
  }

  get frameTimeMs() {
    return this.#smoothedFrameTime;
  }

  get resolution() {
    return { width: this.#canvas?.width ?? 0, height: this.#canvas?.height ?? 0 };
  }

  get gpuTimeMs() {
    return this.#gpuTimeMs;
  }

  get jsTimeMs() {
    return this.#jsTimeMs;
  }

  get gpuPassTimings() {
    return this.#gpuPassTimings;
  }

  get debugInfo() {
    if ((this.debugMode === 1 || this.debugMode === 2) && this.#ptFrameIndex > 0) {
      return ` PT f${this.#ptFrameIndex} ${this.#ptFrameIndex * 16}spp`;
    }
    if (!this.#tsQuerySet) return '';
    if (this.#gpuTimeMs <= 0) return ' gpu:...';
    return ` gpu:${this.#gpuTimeMs.toFixed(1)}ms`;
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
