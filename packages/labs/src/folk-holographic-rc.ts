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
  channelId: number,
];

const SOLID_OPACITY = 1;

const DEBUG_CANVAS: number | null = null;

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

const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) opacity: f32,
  @location(3) albedo: f32,
  @location(4) channelId: f32,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) opacity: f32,
  @location(2) albedo: f32,
  @location(3) channelId: f32,
}
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  out.opacity = input.opacity;
  out.albedo = input.albedo;
  out.channelId = input.channelId;
  return out;
}
struct FragOut { @location(0) world: vec4f, @location(1) material: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  var out: FragOut;
  out.world = vec4f(srgbToLinear(in.color), in.opacity);
  out.material = vec4f(in.albedo, in.channelId / 255.0, 0.0, 0.0);
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
  @location(4) opacity: f32,
  @location(5) albedo: f32,
  @location(6) channelId: f32,
}
struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f, @location(1) p2: vec2f,
  @location(2) color: vec3f, @location(3) thickness: f32,
  @location(4) opacity: f32, @location(5) albedo: f32,
  @location(6) channelId: f32,
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
  out.opacity = opacity; out.albedo = albedo; out.channelId = channelId;
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
  out.material = vec4f(in.albedo, in.channelId / 255.0, 0.0, 0.0);
  return out;
}
`;

// ── HRC Phase A: Ray Seed (cascade 0) ──
// Samples world + bounce textures at each probe position. Computes per-cell
// radiance and transmittance using discrete Beer-Lambert: T = (1−α)^spacing.
// The bounce texture (at probe resolution) provides the diffuse re-emission
// from the previous frame's fluence, enabling multi-bounce GI over time.

const raySeedShader = /*wgsl*/ `
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
@group(0) @binding(2) var<storage, read_write> rayOut: array<vec3u>;
@group(0) @binding(3) var<uniform> params: SeedParams;
@group(0) @binding(4) var materialTex: texture_2d<f32>;

fn packF16(v: vec4f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(v.zw)); }
fn unpackF16(p: vec2u) -> vec4f { return vec4f(unpack2x16float(p.x), unpack2x16float(p.y)); }

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
  var slope = 0.0;
  var acoustic_rad = 0.0;
  if (px.x >= 0 && px.y >= 0 && px.x < i32(params.screenW) && px.y < i32(params.screenH)) {
    let world = textureLoad(worldTex, px, 0);
    let bdim = vec2i(textureDimensions(bounceTex, 0));
    let bounce = textureLoad(bounceTex, clamp(vec2i(wp / vec2f(params.screenW, params.screenH) * vec2f(bdim)), vec2i(0), bdim - 1), 0).rgb;
    trans = pow(1.0 - world.a, params.probeSpacing);
    rad = (world.rgb + bounce) * (1.0 - trans);
    if (world.a > 0.0 && world.a < 1.0) {
      slope = -2.0 * world.a * params.probeSpacing;
    }
    let material = textureLoad(materialTex, px, 0);
    let audioChannel = u32(material.g * 255.0 + 0.5);
    if (audioChannel == 1u) {
      acoustic_rad = 1.0 - trans;
    }
  }

  let packed_visual = packF16(vec4f(rad, trans));
  let packed_acoustic = pack2x16float(vec2f(acoustic_rad, slope));
  let entry = vec3u(packed_visual, packed_acoustic);
  let rayW = i32(params.probeCount) * 2;
  rayOut[sliceIdx * rayW + probeIdx * 2] = entry;
  rayOut[sliceIdx * rayW + probeIdx * 2 + 1] = entry;
}
`;

// ── HRC Phase B: Ray Extension (bottom-up, levels 1..N-1) ──
// Composes two shorter rays from the previous level into one longer ray.
// For each output ray, builds two crossed extensions (L→R, R→L) and averages.
// Transmittance is scalar, packed in the ray texture alpha channel.

const rayExtendShader = /*wgsl*/ `
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

@group(0) @binding(0) var<storage, read> prevRay: array<vec3u>;
@group(0) @binding(1) var<storage, read_write> currRay: array<vec3u>;
@group(0) @binding(2) var<uniform> params: ExtendParams;

fn packF16(v: vec4f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(v.zw)); }
fn unpackF16(p: vec2u) -> vec4f { return vec4f(unpack2x16float(p.x), unpack2x16float(p.y)); }

struct RayData { rad: vec3f, trans: f32, acoustic: f32, slope: f32 }

fn loadPrev(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let prevLevel = params.level - 1u;
  let prevNumProbes = i32((params.probeCount + (1u << prevLevel) - 1u) >> prevLevel);
  let prevNumRays = i32(1u << prevLevel) + 1;
  if (probeIdx < 0 || probeIdx >= prevNumProbes ||
      rayIdx < 0 || rayIdx >= prevNumRays ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return RayData(vec3f(0.0), 1.0, 0.0, 0.0);
  }
  let idx = sliceIdx * i32(params.prevRayW) + (probeIdx << prevLevel) + probeIdx + rayIdx;
  let entry = prevRay[idx];
  let r = unpackF16(vec2u(entry.x, entry.y));
  let a = unpack2x16float(entry.z);
  return RayData(r.rgb, r.a, a.x, a.y);
}

fn compositeRay(near: RayData, far: RayData) -> RayData {
  return RayData(
    near.rad + far.rad * near.trans,
    near.trans * far.trans,
    near.acoustic + far.acoustic * near.trans,
    near.slope + far.slope,
  );
}

@compute @workgroup_size(${WG_EXTEND[0]}, ${WG_EXTEND[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x);
  let sliceIdx = i32(gid.y);

  let interval = i32(1u << params.level);
  let numRays = interval + 1;
  let numProbes = i32((params.probeCount + (1u << params.level) - 1u) >> params.level);
  let probeIdx = i32(floor(f32(texelX) * params.invNumRays));
  let rayIdx = texelX - probeIdx * numRays;

  if (probeIdx >= numProbes || sliceIdx >= i32(params.sliceCount)) { return; }

  let prevInterval = interval / 2;
  let lower = rayIdx / 2;
  let upper = (rayIdx + 1) / 2;

  let sliceOffA = -prevInterval + lower * 2;
  let crossA = compositeRay(
    loadPrev(probeIdx * 2, lower, sliceIdx),
    loadPrev(probeIdx * 2 + 1, upper, sliceIdx + sliceOffA),
  );

  let sliceOffB = -prevInterval + upper * 2;
  let crossB = compositeRay(
    loadPrev(probeIdx * 2, upper, sliceIdx),
    loadPrev(probeIdx * 2 + 1, lower, sliceIdx + sliceOffB),
  );

  let avgRad = (crossA.rad + crossB.rad) * 0.5;
  let avgTrans = (crossA.trans + crossB.trans) * 0.5;
  let avgAcoustic = (crossA.acoustic + crossB.acoustic) * 0.5;
  let avgSlope = (crossA.slope + crossB.slope) * 0.5;
  let packed_visual = packF16(vec4f(avgRad, avgTrans));
  let packed_acoustic = pack2x16float(vec2f(avgAcoustic, avgSlope));
  currRay[sliceIdx * i32(params.currRayW) + texelX] = vec3u(packed_visual, packed_acoustic);
}
`;

// ── HRC Phase C: Cone Merge (top-down, levels N-1..0) ──
// Reads pre-computed ray data from the ray texture and merges with previously
// merged cones from the coarser level. Even/odd probe parity is handled as in
// the Amitabha reference: even probes compose two rays and average with the
// near-probe cone; odd probes do a direct over-composite.

const coneMergeShader = /*wgsl*/ `
struct MergeParams {
  probeCount: u32,
  numCones: u32,
  numProbes: u32,
  numRays: u32,
  nextNumCones: u32,
  isLastLevel: u32,
  fluenceW: u32,
  fluenceStride: u32,
  skyRow: u32,
  skyShift: u32,
  conesShift: u32,
  angWeightBase: u32,
  sliceCount: u32,
  mergeStride: u32,
  mergeInWidth: u32,
  fxProbe: i32,
  fxSlice: i32,
  fxOff: i32,
  fyProbe: i32,
  fySlice: i32,
  fyOff: i32,
};

@group(0) @binding(0) var<storage, read> rayBuf: array<vec3u>;
@group(0) @binding(1) var<storage, read> mergeInBuf: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> mergeOutBuf: array<vec2u>;

fn packF16(v: vec4f) -> vec2u { return vec2u(pack2x16float(v.xy), pack2x16float(v.zw)); }
fn unpackF16(p: vec2u) -> vec4f { return vec4f(unpack2x16float(p.x), unpack2x16float(p.y)); }

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
@group(0) @binding(3) var<uniform> params: MergeParams;
@group(0) @binding(4) var<storage, read_write> fluenceBuf: array<vec2u>;
@group(0) @binding(5) var skyPrefixTex: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> angWeights: array<f32>;

struct RayData { rad: vec3f, trans: f32, acoustic: f32, slope: f32 }
struct MergeEntry { visual: vec3f, acoustic: f32 }

fn loadRay(probeIdx: i32, rayIdx: i32, sliceIdx: i32) -> RayData {
  let effProbes = i32(params.numProbes);
  if (probeIdx < 0 || probeIdx >= effProbes ||
      rayIdx < 0 || rayIdx >= i32(params.numRays) ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return RayData(vec3f(0.0), 1.0, 0.0, 0.0);
  }
  let texX = (probeIdx << params.conesShift) + probeIdx + rayIdx;
  let entry = rayBuf[sliceIdx * i32(params.numProbes * params.numRays) + texX];
  let r = unpackF16(vec2u(entry.x, entry.y));
  let a = unpack2x16float(entry.z);
  return RayData(r.rgb, r.a, a.x, a.y);
}

fn loadMerge(texX: i32, sliceIdx: i32) -> MergeEntry {
  if (params.isLastLevel == 1u ||
      texX < 0 || texX >= i32(params.mergeInWidth) ||
      sliceIdx < 0 || sliceIdx >= i32(params.sliceCount)) {
    return MergeEntry(vec3f(0.0), 0.0);
  }
  let entry = mergeInBuf[sliceIdx * i32(params.mergeStride) + texX];
  return MergeEntry(unpackRGB9E5(entry.x), unpack2x16float(entry.y).x);
}

fn getAngularWeight(subCone: u32) -> f32 {
  return angWeights[params.angWeightBase + subCone];
}

fn loadSkyFluence(subCone: u32) -> vec3f {
  let base = subCone << params.skyShift;
  let end = base + (1u << params.skyShift);
  let row = i32(params.skyRow);
  return textureLoad(skyPrefixTex, vec2i(i32(end), row), 0).rgb
       - textureLoad(skyPrefixTex, vec2i(i32(base), row), 0).rgb;
}

@compute @workgroup_size(${WG_MERGE[0]}, ${WG_MERGE[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeConeIdx = i32(gid.x);
  let sliceIdx = i32(gid.y);
  let conesShift = params.conesShift;
  let numCones = i32(1u << conesShift);
  let probeIdx = probeConeIdx >> conesShift;
  let coneIdx = probeConeIdx & (numCones - 1);

  if (probeIdx >= i32(params.numProbes) || sliceIdx >= i32(params.sliceCount)) { return; }

  let isEven = (probeIdx % 2 == 0);
  let farStep = select(1, 2, isEven);

  var result = vec3f(0.0);
  var result_acoustic = 0.0;

  for (var side = 0; side < 2; side++) {
    let subCone = u32(coneIdx * 2 + side);
    let rayIdx = coneIdx + side;
    let weight = getAngularWeight(subCone);

    let ray = loadRay(probeIdx, rayIdx, sliceIdx);
    let sliceOff = -numCones + rayIdx * 2;

    let farX = ((probeIdx + farStep) << conesShift) + i32(subCone);
    let farSlice = sliceIdx + sliceOff * farStep;
    var farCone = vec3f(0.0);
    var farConeAcoustic = 0.0;
    if (params.isLastLevel == 1u ||
        farX < 0 || farX >= i32(params.mergeInWidth) ||
        farSlice < 0 || farSlice >= i32(params.sliceCount)) {
      farCone = loadSkyFluence(subCone);
    } else {
      let farEntry = mergeInBuf[farSlice * i32(params.mergeStride) + farX];
      farCone = unpackRGB9E5(farEntry.x);
      farConeAcoustic = unpack2x16float(farEntry.y).x;
    }

    if (isEven) {
      let ext = loadRay(probeIdx + 1, rayIdx, sliceIdx + sliceOff);
      let cRad = ray.rad + ext.rad * ray.trans;
      let cTrans = ray.trans * ext.trans;
      let merged = cRad * weight + farCone * cTrans;
      let nearCone = loadMerge((probeIdx << conesShift) + i32(subCone), sliceIdx);
      result += (merged + nearCone.visual) * 0.5;

      let cAcoustic = ray.acoustic + ext.acoustic * ray.trans;
      let mergedAcoustic = cAcoustic * weight + farConeAcoustic * cTrans;
      result_acoustic += (mergedAcoustic + nearCone.acoustic) * 0.5;
    } else {
      result += ray.rad * weight + farCone * ray.trans;
      result_acoustic += ray.acoustic * weight + farConeAcoustic * ray.trans;
    }
  }

  let outX = (probeIdx << conesShift) + coneIdx;
  mergeOutBuf[sliceIdx * i32(params.mergeStride) + outX] = vec2u(
    packRGB9E5(result),
    pack2x16float(vec2f(result_acoustic, 0.0)),
  );

  if (params.numCones == 1u) {
    let fc = vec2i(
      params.fxProbe * probeIdx + params.fxSlice * sliceIdx + params.fxOff,
      params.fyProbe * probeIdx + params.fySlice * sliceIdx + params.fyOff,
    );
    let fw = i32(params.fluenceW);
    let fStride = i32(params.fluenceStride);
    let fh = i32(arrayLength(&fluenceBuf)) / fStride;
    if (fc.x >= 0 && fc.x < fw && fc.y >= 0 && fc.y < fh) {
      let fi = fc.y * fStride + fc.x;
      let prev = unpackF16(fluenceBuf[fi]);
      fluenceBuf[fi] = packF16(vec4f(prev.rgb + result, prev.a + result_acoustic));
    }
  }
}
`;

// ── Final blit shader ──
// Bilinearly upscales fluence from probe resolution to screen resolution.
// Uses world texture alpha (opacity) to mask indirect light at surfaces.

const blitCommon = /*wgsl*/ `
struct BlitParams { exposure: f32, screenW: f32, screenH: f32, debugMode: f32 };
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

@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  return vec4f(pos[i], 0, 1);
}
`;

const blitShader =
  blitCommon +
  /*wgsl*/ `
@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlitParams;
@group(0) @binding(3) var linearSamp: sampler;
@group(0) @binding(4) var materialTex: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(params.screenW, params.screenH);
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let emissive = world.rgb * world.a;
  let indirect = fluence / TWO_PI * (1.0 - world.a);
  var color = tonemapAndDither((emissive + indirect) * params.exposure, vec2u(pos.xy));
  let dm = i32(params.debugMode);
  if (dm == 1) {
    let probeCoord = uv * vec2f(textureDimensions(fluenceTex, 0));
    if (length(fract(probeCoord) - 0.5) < 0.15) {
      color = vec4f(1.0, 0.3, 0.1, 1.0);
    }
  } else if (dm == 2) {
    let mag = dot(fluence, vec3f(0.2126, 0.7152, 0.0722));
    let t = clamp(log2(mag + 1.0) * 0.3, 0.0, 1.0);
    let cool = vec3f(0.0, 0.1, 0.3);
    let hot = vec3f(1.0, 0.8, 0.2);
    color = vec4f(mix(cool, hot, t), 1.0);
  } else if (dm == 3) {
    let gain = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).a;
    let mat = textureLoad(materialTex, vec2u(pos.xy), 0);
    let ch = u32(mat.g * 255.0 + 0.5);
    if (ch == 1u) {
      color = vec4f(0.1, 0.9, 0.7, 1.0);
    } else if (ch >= 2u) {
      let g = clamp(gain * 3.0, 0.15, 1.0);
      color = vec4f(g, g * 0.8, 0.1, 1.0);
    } else {
      let at = clamp(gain * 2.0, 0.0, 1.0);
      let cold = vec3f(0.0, 0.05, 0.2);
      let hot = vec3f(1.0, 0.3, 0.05);
      color = vec4f(linearToSrgb(mix(cold, hot, at)), 1.0);
    }
  }
  return color;
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
// The exterior neighbor fluence is averaged with the probe one step further
// out (ni + ni2) to cancel the cascade's period-2 checkerboard artifact,
// preventing the bounce feedback loop from amplifying it.
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

  // Exterior neighbor fluence, averaged with the probe one step further
  // out to cancel the cascade's period-2 checkerboard: (F+δ + F-δ)/2 = F.
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

// ── Acoustic gather pass ──
// For each screen pixel with a source channel ID (>=2), reads the acoustic
// fluence at that position, multiplies by (1-trans) to get the surface
// absorption, and atomically accumulates into a per-channel gain buffer.
// This correctly models sound reception at the shape's surface rather than
// its center -- identical to how shapes absorb light.

const acousticGatherShader = /*wgsl*/ `
struct GatherParams {
  screenW: u32,
  screenH: u32,
  probeSpacing: f32,
  pad: u32,
};

@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var materialTex: texture_2d<f32>;
@group(0) @binding(2) var fluenceTex: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> channelGains: array<atomic<u32>, 256>;
@group(0) @binding(4) var<uniform> params: GatherParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = vec2i(i32(gid.x), i32(gid.y));
  if (px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) { return; }

  let mat = textureLoad(materialTex, px, 0);
  let ch = u32(mat.g * 255.0 + 0.5);
  if (ch < 2u) { return; }

  let world = textureLoad(worldTex, px, 0);
  let trans = pow(1.0 - world.a, params.probeSpacing);
  let absorption = 1.0 - trans;
  if (absorption < 0.001) { return; }

  let fdim = vec2f(textureDimensions(fluenceTex, 0));
  let uv = (vec2f(px) + 0.5) / vec2f(f32(params.screenW), f32(params.screenH));
  let fcoord = clamp(vec2i(uv * fdim), vec2i(0), vec2i(fdim) - 1);
  let fluence = textureLoad(fluenceTex, fcoord, 0);
  let acousticGain = fluence.a;

  let contribution = acousticGain * absorption;
  if (contribution > 0.0) {
    let fixed = u32(clamp(contribution * 65536.0, 0.0, 4294967295.0));
    atomicAdd(&channelGains[ch], fixed);
  }
}
`;

// ── 2D Path Tracer (ground truth reference) ──
//
// Progressive Monte Carlo path tracer at screen resolution. Each frame adds
// N stratified samples per pixel, blended into the accumulation buffer.
//
// Transport model:
//   - Emission: radiance += throughput × emission × opacity
//   - Extinction (bounces off): throughput *= (1 − opacity)
//   - Extinction (bounces on):  throughput *= (1 − opacity × (1 − ω_vol))
//     where ω_vol = albedo × (1 − opacity) smoothly transitions from
//     energy-preserving scatter in volumes to full extinction at surfaces.
//   - Surface bounce: when throughput < 0.001 (opaque hit), re-emit from
//     surfaceEntry with probability = albedo (Russian roulette for albedo).
//   - Volume scatter: redirect ray with probability opacity × albedo.
//     Only active when bounces are enabled (matches HRC behavior where
//     scatter requires the frame-to-frame bounce feedback loop).
//   - Russian roulette: stochastic termination below throughput 0.2 to
//     prevent deterministic banding in volumes.

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

// Surface bounce fires when throughput falls below this (opaque surface hit).
const BOUNCE_THRESHOLD = 0.001;
// Russian roulette starts below this throughput to stochastically terminate
// low-energy volume rays (prevents deterministic banding).
const RR_THRESHOLD = 0.2;
const RR_BOOST = 1.0 / RR_THRESHOLD;

fn pcgHash(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn randomFloat(seed: ptr<function, u32>) -> f32 {
  *seed = pcgHash(*seed);
  return f32(*seed) / 4294967295.0;
}

fn loadWorld(pos: vec2f) -> vec4f {
  let px = vec2i(i32(floor(pos.x)), i32(floor(pos.y)));
  if (px.x < 0 || px.y < 0 || px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) {
    return vec4f(0.0);
  }
  return textureLoad(worldTex, px, 0);
}

fn loadAlbedo(pos: vec2f) -> f32 {
  let px = vec2i(i32(floor(pos.x)), i32(floor(pos.y)));
  if (px.x < 0 || px.y < 0 || px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) {
    return 0.0;
  }
  return textureLoad(materialTex, px, 0).r;
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

    // Camera pixel: accumulate emission, reduce throughput by opacity.
    {
      let w0 = loadWorld(rayPos);
      radiance += throughput * w0.rgb * w0.a;
      throughput *= (1.0 - w0.a);
    }

    for (var step = 0u; step < 4096u; step++) {
      // Opaque camera pixels (throughput≈0 before entering any surface)
      // show emission only, matching HRC blit: emission×α + fluence×(1−α).
      if (throughput < 1e-6 && !inSurface) { break; }

      rayPos += rayDir;
      let w = loadWorld(rayPos);
      let opacity = w.a;

      if (opacity < 1e-6) {
        let rpx = vec2i(i32(floor(rayPos.x)), i32(floor(rayPos.y)));
        if (rpx.x < 0 || rpx.y < 0 || rpx.x >= i32(params.screenW) || rpx.y >= i32(params.screenH)) {
          radiance += throughput * sampleSky(rayDir);
          break;
        }
        inSurface = false;
        continue;
      }

      if (!inSurface) {
        surfaceEntry = rayPos - rayDir;
        inSurface = true;
      }

      let albedo = loadAlbedo(rayPos);
      radiance += throughput * w.rgb * opacity;

      // Extinction model branches on bounce mode:
      if (params.maxBounces > 0u) {
        // ω_vol = albedo×(1−opacity): smoothly 0 at surfaces, ≈albedo in
        // volumes. Throughput drops by absorption only; scatter preserves
        // energy. Surfaces still fully block (ω_vol=0 → extinction=opacity).
        let wVol = albedo * (1.0 - opacity);
        throughput *= (1.0 - opacity * (1.0 - wVol));
      } else {
        // Full extinction — matches HRC without bounce feedback.
        throughput *= (1.0 - opacity);
      }

      // Surface bounce (throughput≈0 at opaque surfaces).
      if (throughput < BOUNCE_THRESHOLD) {
        if (bounceCount < params.maxBounces
            && albedo > 0.0 && randomFloat(&seed) < albedo) {
          throughput = 1.0;
          bounceCount++;
          rayPos = surfaceEntry;
          inSurface = false;
          let newAngle = randomFloat(&seed) * 6.2831853;
          rayDir = vec2f(cos(newAngle), sin(newAngle));
          continue;
        }
        break;
      }

      // Russian roulette for low-throughput volume rays (prevents banding).
      if (throughput < RR_THRESHOLD) {
        if (randomFloat(&seed) > throughput * RR_BOOST) { break; }
        throughput = RR_THRESHOLD;
      }

      // Volume scatter (only with bounces — HRC needs the feedback loop).
      if (params.maxBounces > 0u && albedo > 0.0 && opacity < 1.0) {
        if (randomFloat(&seed) < opacity * albedo) {
          let newAngle = randomFloat(&seed) * 6.2831853;
          rayDir = vec2f(cos(newAngle), sin(newAngle));
        }
      }
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

const ptBlitShader =
  blitCommon +
  /*wgsl*/ `
@group(0) @binding(0) var ptAccum: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: BlitParams;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  return tonemapAndDither(textureLoad(ptAccum, vec2i(pos.xy), 0).rgb * params.exposure, vec2u(pos.xy));
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
  @property({ type: Boolean, reflect: true, attribute: 'path-tracing' }) pathTracing = false;

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
  #mouseLightOpacity = SOLID_OPACITY;
  #mouseLightAlbedo = 0;
  #mouseLightBuffer?: GPUBuffer;
  #mouseLightVertexCount = 0;

  // Pixel-based drawing for DEBUG_CANVAS (Bresenham lines + square brush)
  #debugPixels: [x: number, y: number, r: number, g: number, b: number, opacity: number, albedo: number][] = [];
  #debugPixelBuffer?: GPUBuffer;
  #debugPixelVertexCount = 0;
  #debugPixelsDirty = false;

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

  #angWeightBuffer!: GPUBuffer;

  // Path tracer accumulation (screen resolution, rgba32float for precision)
  #ptAccumTextures!: GPUTexture[];
  #ptAccumTextureViews!: GPUTextureView[];
  #ptFrameIndex = 0;
  #ptStartTime = 0;
  #ptShowResult = false;
  #ptPipeline!: GPUComputePipeline;
  #ptBlitPipeline!: GPURenderPipeline;
  #ptParamsBuffer!: GPUBuffer;
  #ptParamsView!: StructuredView;

  // Pipelines
  #bounceComputePipeline!: GPUComputePipeline;
  #raySeedPipeline!: GPUComputePipeline;
  #rayExtendPipeline!: GPUComputePipeline;
  #coneMergePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Pre-created bind groups
  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][];
  #blitBindGroup!: GPUBindGroup;
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

  // Computed
  #numCascades = 0;
  #psX = 0;
  #psY = 0;
  #mergeStride = 0;
  #fluenceStride = 0;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

  // Acoustic gather
  #gatherPipeline!: GPUComputePipeline;
  #gatherBindGroup!: GPUBindGroup;
  #gatherParamsBuffer!: GPUBuffer;
  #gatherParamsView!: StructuredView;
  #channelGainsBuffer!: GPUBuffer;
  #channelGainsReadback!: GPUBuffer;
  #channelGains = new Float32Array(256);

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
        const passTimings: { label: string; ms: number }[] = [];
        for (let i = 0; i < passCount; i++) {
          const start = Number(times[i * 2]);
          const end = Number(times[i * 2 + 1]);
          passTimings.push({ label: labels[i] || `pass${i}`, ms: (end - start) / 1e6 });
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

  #mapToCanvas(x: number, y: number): [number, number] {
    const rect = this.#canvas.getBoundingClientRect();
    if (!DEBUG_CANVAS) return [x - rect.left, y - rect.top];
    return [(x - rect.left) * (this.#canvas.width / rect.width), (y - rect.top) * (this.#canvas.height / rect.height)];
  }

  #scaleToCanvas(v: number): number {
    if (!DEBUG_CANVAS) return v;
    const rect = this.#canvas.getBoundingClientRect();
    return v * (this.#canvas.width / rect.width);
  }

  addLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: [number, number, number] = [0, 0, 0],
    thickness = 20,
    opacity = SOLID_OPACITY,
    albedo = 0,
  ) {
    if (DEBUG_CANVAS) {
      [x1, y1] = this.#mapToCanvas(x1, y1);
      [x2, y2] = this.#mapToCanvas(x2, y2);
      this.#stampLine(
        Math.floor(x1),
        Math.floor(y1),
        Math.floor(x2),
        Math.floor(y2),
        color,
        thickness,
        opacity,
        albedo,
      );
      return;
    }
    const [r, g, b] = color;
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness, opacity, albedo, 0]);
    this.#lineBufferDirty = true;
  }

  #stampLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: [number, number, number],
    brushSize: number,
    opacity: number,
    albedo: number,
  ) {
    const [r, g, b] = color;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0,
      y = y0;
    const size = DEBUG_CANVAS!;
    const blo = -Math.floor((brushSize - 1) / 2);
    const bhi = Math.floor(brushSize / 2);
    for (;;) {
      for (let by = blo; by <= bhi; by++) {
        for (let bx = blo; bx <= bhi; bx++) {
          const px = x + bx;
          const py = y + by;
          if (px >= 0 && py >= 0 && px < size && py < size) {
            this.#debugPixels.push([px, py, r, g, b, opacity, albedo]);
          }
        }
      }
      if (x === x1 && y === y1) break;
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
    this.#debugPixelsDirty = true;
  }

  clearLines() {
    this.#lines = [];
    this.#lineBufferDirty = true;
    this.#debugPixels = [];
    this.#debugPixelsDirty = true;
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
    if (DEBUG_CANVAS) {
      [x, y] = this.#mapToCanvas(x, y);
      radius = this.#scaleToCanvas(radius);
      const r2 = radius * radius;
      this.#debugPixels = this.#debugPixels.filter(([px, py]) => {
        const dx = px + 0.5 - x;
        const dy = py + 0.5 - y;
        return dx * dx + dy * dy > r2;
      });
      this.#debugPixelsDirty = true;
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

  setSkyGradient(topColor: [number, number, number], bottomColor: [number, number, number]) {
    for (let i = 0; i < SKY_CIRCLE_SIZE; i++) {
      const angle = (i / SKY_CIRCLE_SIZE) * Math.PI * 2 - Math.PI;
      const t = Math.sin(angle) * 0.5 + 0.5;
      this.#skyCircleData[i * 4] = topColor[0] * (1 - t) + bottomColor[0] * t;
      this.#skyCircleData[i * 4 + 1] = topColor[1] * (1 - t) + bottomColor[1] * t;
      this.#skyCircleData[i * 4 + 2] = topColor[2] * (1 - t) + bottomColor[2] * t;
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

  setSkyDirectional(angle: number, color: [number, number, number], angularRadius = 0.05) {
    const invTwoSigmaSq = 1 / (2 * angularRadius * angularRadius);
    for (let i = 0; i < SKY_CIRCLE_SIZE; i++) {
      const texAngle = (i / SKY_CIRCLE_SIZE) * Math.PI * 2 - Math.PI;
      let delta = texAngle - angle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      const intensity = Math.exp(-delta * delta * invTwoSigmaSq);
      this.#skyCircleData[i * 4] = color[0] * intensity;
      this.#skyCircleData[i * 4 + 1] = color[1] * intensity;
      this.#skyCircleData[i * 4 + 2] = color[2] * intensity;
      this.#skyCircleData[i * 4 + 3] = 1;
    }
    this.#uploadSkyCircle();
  }

  clearSky() {
    this.#skyCircleData.fill(0);
    this.#uploadSkyCircle();
  }

  getChannelGain(channelId: number): number {
    if (channelId < 2 || channelId > 255) return 0;
    return this.#channelGains[channelId];
  }

  get channelGains(): Float32Array {
    return this.#channelGains;
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
    const ps = this.#psX;
    const { width, height } = this.#canvas;
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
    if (changedProperties.has('probeCount') && changedProperties.get('probeCount') !== undefined) {
      this.#destroyResources();
      this.#initResources();
      this.#createStaticBindGroups();
      this.#uploadStaticParams(this.#canvas.width, this.#canvas.height);
      this.#lineBindGroup = undefined;
    }
    if (this.sourcesMap.size !== this.sourceElements.size) return;
    this.#updateShapeData();
    this.#ptFrameIndex = 0;
    this.#ptShowResult = false;
  }

  // ── WebGPU init ──

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    const canTimestamp = adapter.features.has('timestamp-query');
    this.#device = await adapter.requestDevice({
      requiredFeatures: canTimestamp ? ['timestamp-query' as GPUFeatureName] : [],
    });
    if (canTimestamp) {
      this.#initTimestampQueries();
    }

    this.#canvas = document.createElement('canvas');
    if (DEBUG_CANVAS) {
      this.#canvas.width = DEBUG_CANVAS;
      this.#canvas.height = DEBUG_CANVAS;
    } else {
      this.#canvas.width = this.clientWidth || 800;
      this.#canvas.height = this.clientHeight || 600;
    }
    if (DEBUG_CANVAS) {
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
      Object.assign(this.#canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      });
    }
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
    const { width, height } = this.#canvas;
    const device = this.#device;
    const { width: cw, height: ch } = this.#canvas;
    const maxDim = Math.max(cw, ch);
    const ps = Math.max(2, this.probeCount);
    const psX = DEBUG_CANVAS ? DEBUG_CANVAS : Math.max(2, ceilDiv(cw * ps, maxDim));
    const psY = DEBUG_CANVAS ? DEBUG_CANVAS : Math.max(2, ceilDiv(ch * ps, maxDim));
    const psMax = Math.max(psX, psY);
    this.#psX = psX;
    this.#psY = psY;
    this.#numCascades = ceilLog2(psMax);
    const mergeStride = nextPow2(psMax);
    this.#mergeStride = mergeStride;

    const ubo = (label: string, size: number) =>
      device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    [this.#worldTexture, this.#worldTextureView] = tex(device, 'World', width, height, 'rgba16float', TEX_RENDER);
    [this.#materialTexture, this.#materialTextureView] = tex(device, 'Material', width, height, 'rg8unorm', TEX_RENDER);

    // Ray/merge buffers are shared across all 4 directions, sized for worst case.
    this.#rayBuffers = [];
    for (let i = 0; i < this.#numCascades; i++) {
      const w = ceilDiv(psMax, 1 << i) * ((1 << i) + 1);
      this.#rayBuffers.push(
        device.createBuffer({ label: `Ray-${i}`, size: w * psMax * 16, usage: GPUBufferUsage.STORAGE }),
      );
    }

    this.#mergeBuffers = [0, 1].map((i) =>
      device.createBuffer({ label: `Merge-${i}`, size: mergeStride * psMax * 8, usage: GPUBufferUsage.STORAGE }),
    );
    const alignedFluenceRow = Math.ceil((psX * 8) / 256) * 256;
    this.#fluenceBuffer = device.createBuffer({
      label: 'Fluence-SSBO',
      size: alignedFluenceRow * psY,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.#fluenceStride = alignedFluenceRow / 8;
    const [ft, fv] = tex(
      device,
      'Fluence',
      psX,
      psY,
      'rgba16float',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    );
    this.#fluenceTexture = ft;
    this.#fluenceTextureView = fv;

    this.#channelGainsBuffer = device.createBuffer({
      label: 'ChannelGains',
      size: 256 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.#channelGainsReadback = device.createBuffer({
      label: 'ChannelGains-Readback',
      size: 256 * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    [this.#bounceTexture, this.#bounceTextureView] = tex(
      device,
      'Bounce',
      psX,
      psY,
      'rgba16float',
      TEX_STORAGE | GPUTextureUsage.COPY_DST,
    );
    // bytesPerRow must be 256-aligned for WebGPU copy operations.
    const alignedBounceRow = Math.ceil((psX * 8) / 256) * 256;
    const bounceZeroSize = alignedBounceRow * psY;
    this.#bounceZeroBuffer = device.createBuffer({ size: bounceZeroSize, usage: GPUBufferUsage.COPY_SRC });
    device.queue.writeTexture(
      { texture: this.#bounceTexture },
      new Uint8Array(bounceZeroSize),
      { bytesPerRow: alignedBounceRow, rowsPerImage: psY },
      { width: psX, height: psY },
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

    const totalAngWeights = 4 * (2 * (1 << this.#numCascades) - 2);
    this.#angWeightBuffer = device.createBuffer({
      size: totalAngWeights * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // GPU buffers are zero-initialized by default in WebGPU

    this.#seedParamsView = uboView(raySeedShader, 'params');
    this.#extendParamsView = uboView(rayExtendShader, 'params');
    this.#mergeParamsView = uboView(coneMergeShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');
    this.#bounceParamsView = uboView(bounceComputeShader, 'params');
    this.#gatherParamsView = uboView(acousticGatherShader, 'params');

    this.#seedParamsBuffer = ubo('SeedParams', 4 * 256);
    this.#extendParamsBuffer = ubo('ExtendParams', 2 * Math.max(1, this.#numCascades - 1) * 256);
    this.#mergeParamsBuffer = ubo('MergeParams', 4 * this.#numCascades * 256);
    this.#blitParamsBuffer = ubo('BlitParams', this.#blitParamsView.arrayBuffer.byteLength);
    this.#bounceParamsBuffer = ubo('BounceParams', this.#bounceParamsView.arrayBuffer.byteLength);
    this.#gatherParamsBuffer = ubo('GatherParams', this.#gatherParamsView.arrayBuffer.byteLength);

    const [ptA0, ptV0] = tex(device, 'PT-Accum-0', width, height, 'rgba32float', TEX_STORAGE);
    const [ptA1, ptV1] = tex(device, 'PT-Accum-1', width, height, 'rgba32float', TEX_STORAGE);
    this.#ptAccumTextures = [ptA0, ptA1];
    this.#ptAccumTextureViews = [ptV0, ptV1];
    this.#ptParamsView = uboView(pathTraceShader, 'params');
    this.#ptParamsBuffer = ubo('PT-Params', this.#ptParamsView.arrayBuffer.byteLength);
  }

  #initPipelines() {
    const device = this.#device;
    const MRT_TARGETS: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: 'rg8unorm' }];

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
            arrayStride: 32,
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x3'),
              attr(2, 20, 'float32'),
              attr(3, 24, 'float32'),
              attr(4, 28, 'float32'),
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
            arrayStride: 44,
            stepMode: 'instance',
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x2'),
              attr(2, 16, 'float32x3'),
              attr(3, 28, 'float32'),
              attr(4, 32, 'float32'),
              attr(5, 36, 'float32'),
              attr(6, 40, 'float32'),
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
    this.#coneMergePipeline = computePipeline(device, 'HRC-ConeMerge', coneMergeShader);
    this.#renderPipeline = fullscreenBlit('HRC-Blit', blitShader, this.#presentationFormat);
    this.#ptPipeline = computePipeline(device, 'PT-PathTrace', pathTraceShader);
    this.#ptBlitPipeline = fullscreenBlit('PT-Blit', ptBlitShader, this.#presentationFormat);
    this.#gatherPipeline = computePipeline(device, 'AcousticGather', acousticGatherShader);

    this.#createStaticBindGroups();
  }

  #createStaticBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;
    const seedLayout = this.#raySeedPipeline.getBindGroupLayout(0);
    const extLayout = this.#rayExtendPipeline.getBindGroupLayout(0);
    const mergeLayout = this.#coneMergePipeline.getBindGroupLayout(0);
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
        this.#materialTextureView,
      ),
    );

    // Two cascade configs: H (E/W) and V (N/S). Extend params are
    // identical within each pair, so only 2 × (nc-1) bind groups needed.
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
            { buffer: this.#angWeightBuffer },
          ),
        );
        [readIdx, writeIdx] = [writeIdx, readIdx];
      }
      this.#mergeBindGroups.push(dirBGs);
    }

    this.#blitBindGroup = bg(
      device,
      this.#renderPipeline.getBindGroupLayout(0),
      this.#fluenceTextureView,
      this.#worldTextureView,
      { buffer: this.#blitParamsBuffer },
      this.#linearSampler,
      this.#materialTextureView,
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

    this.#gatherBindGroup = bg(
      device,
      this.#gatherPipeline.getBindGroupLayout(0),
      this.#worldTextureView,
      this.#materialTextureView,
      this.#fluenceTextureView,
      { buffer: this.#channelGainsBuffer },
      { buffer: this.#gatherParamsBuffer },
    );
  }

  #destroyResources() {
    this.#worldTexture?.destroy();
    this.#materialTexture?.destroy();
    this.#rayBuffers?.forEach((b) => b.destroy());
    this.#mergeBuffers?.forEach((b) => b.destroy());
    this.#fluenceBuffer?.destroy();
    this.#fluenceTexture?.destroy();
    this.#channelGainsBuffer?.destroy();
    this.#channelGainsReadback?.destroy();
    this.#angWeightBuffer?.destroy();
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
    this.#gatherParamsBuffer?.destroy();
    this.#bounceParamsBuffer?.destroy();
  }

  // ── Shape / line data ──

  #updateShapeData() {
    const vertices: number[] = [];
    const elements = Array.from(this.sourceElements);
    const cw = this.#canvas.width;
    const ch = this.#canvas.height;

    elements.forEach((element, index) => {
      const shape = element as HTMLElement & { x: number; y: number; width: number; height: number; rotation: number };
      let sx = shape.x ?? 0;
      let sy = shape.y ?? 0;
      let sw = shape.width ?? 0;
      let sh = shape.height ?? 0;
      const rot = shape.rotation ?? 0;

      if (DEBUG_CANVAS) {
        const rect = this.#canvas.getBoundingClientRect();
        const scale = this.#canvas.width / rect.width;
        sx = (sx - rect.left) * scale;
        sy = (sy - rect.top) * scale;
        sw = sw * scale;
        sh = sh * scale;
      }

      const rgbAttr = element.getAttribute('data-rgb');
      const parts = rgbAttr ? rgbAttr.split(',').map(Number) : [0, 0, 0];
      const [r, g, b] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
      const opacityAttr = element.getAttribute('data-opacity');
      const opacity = opacityAttr !== null ? Number(opacityAttr) : SOLID_OPACITY;
      const albedoAttr = element.getAttribute('data-albedo');
      const albedo = albedoAttr !== null ? Number(albedoAttr) : 0;
      const channelAttr = element.getAttribute('data-audio-channel');
      const channelId = channelAttr !== null ? Number(channelAttr) : 0;
      // Compute rotated corners around shape center
      const cx = sx + sw / 2;
      const cy = sy + sh / 2;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const corners: [number, number][] = [
        [sx - cx, sy - cy], // top-left
        [sx + sw - cx, sy - cy], // top-right
        [sx - cx, sy + sh - cy], // bottom-left
        [sx + sw - cx, sy + sh - cy], // bottom-right
      ].map(([lx, ly]) => [((cx + lx * cos - ly * sin) / cw) * 2 - 1, 1 - ((cy + lx * sin + ly * cos) / ch) * 2]);

      const v = (vx: number, vy: number) => {
        vertices.push(vx, vy, r, g, b, opacity, albedo, channelId);
      };
      v(corners[0][0], corners[0][1]); // TL
      v(corners[1][0], corners[1][1]); // TR
      v(corners[2][0], corners[2][1]); // BL
      v(corners[1][0], corners[1][1]); // TR
      v(corners[3][0], corners[3][1]); // BR
      v(corners[2][0], corners[2][1]); // BL
    });
    this.#shapeCount = elements.length;
    if (vertices.length === 0) return;
    this.#shapeDataBuffer = uploadVertexData(this.#device, this.#shapeDataBuffer, new Float32Array(vertices));
  }

  #pixelQuadVerts(px: number, py: number, r: number, g: number, b: number, op: number, al: number, ch: number, out: number[]) {
    const w = this.#canvas.width;
    const h = this.#canvas.height;
    const x0 = (px / w) * 2 - 1;
    const y0 = 1 - (py / h) * 2;
    const x1 = ((px + 1) / w) * 2 - 1;
    const y1 = 1 - ((py + 1) / h) * 2;
    out.push(x0, y0, r, g, b, op, al, ch);
    out.push(x1, y0, r, g, b, op, al, ch);
    out.push(x0, y1, r, g, b, op, al, ch);
    out.push(x1, y0, r, g, b, op, al, ch);
    out.push(x1, y1, r, g, b, op, al, ch);
    out.push(x0, y1, r, g, b, op, al, ch);
  }

  #updateDebugPixelBuffer() {
    if (!this.#device || this.#debugPixels.length === 0) {
      this.#debugPixelVertexCount = 0;
      return;
    }
    const verts: number[] = [];
    for (const [px, py, r, g, b, op, al] of this.#debugPixels) {
      this.#pixelQuadVerts(px, py, r, g, b, op, al, 0, verts);
    }
    this.#debugPixelVertexCount = verts.length / 8;
    this.#debugPixelBuffer = uploadVertexData(this.#device, this.#debugPixelBuffer, new Float32Array(verts));
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

    const ch = 1;
    if (DEBUG_CANVAS) {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      const bs = Math.max(1, this.#mouseLightRadius * 2);
      const blo = -Math.floor((bs - 1) / 2);
      const bhi = Math.floor(bs / 2);
      const size = DEBUG_CANVAS;
      for (let by = blo; by <= bhi; by++) {
        for (let bx = blo; bx <= bhi; bx++) {
          const px = cx + bx;
          const py = cy + by;
          if (px >= 0 && py >= 0 && px < size && py < size) {
            this.#pixelQuadVerts(px, py, r, g, b, op, al, ch, verts);
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
        verts.push(cx, cy, r, g, b, op, al, ch);
        verts.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b, op, al, ch);
        verts.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b, op, al, ch);
      }
    }

    this.#mouseLightVertexCount = verts.length / 8;
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
    if (this.#debugPixelsDirty) {
      this.#debugPixelsDirty = false;
      this.#updateDebugPixelBuffer();
    }
    if (this.#mouseDirty) {
      this.#mouseDirty = false;
      this.#updateMouseLightBuffer();
    }

    const { width, height } = this.#canvas;
    const device = this.#device;
    const nc = this.#numCascades;

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height, debugMode: this.debugMode });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    const encoder = device.createCommandEncoder();
    this.#tsBeginFrame();

    // ── Step 1: Render world textures (world + material) ──
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#worldTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
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
      if (this.#debugPixelBuffer && this.#debugPixelVertexCount > 0) {
        pass.setVertexBuffer(0, this.#debugPixelBuffer);
        pass.draw(this.#debugPixelVertexCount);
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
      if (this.#mouseLightBuffer && this.#mouseLightVertexCount > 0 && (mr > 0 || mg > 0 || mb > 0)) {
        pass.setVertexBuffer(0, this.#mouseLightBuffer);
        pass.draw(this.#mouseLightVertexCount);
      }
      pass.end();
    }

    if (this.pathTracing) {
      if (this.#ptFrameIndex === 0) {
        this.#ptStartTime = performance.now();
      }
      this.#ptShowResult = true;
      this.#renderPathTraced(encoder, width, height);
      this.#submitAndCapture(device, encoder);
      return;
    }

    if (this.#ptShowResult) {
      this.#renderPTBlit(encoder);
      this.#submitAndCapture(device, encoder);
      return;
    }

    // ── Step 1.5: Bounce compute (reads previous frame's fluence at probe resolution) ──
    if (!this.bounces && this.#lastFluenceReady) {
      this.#lastFluenceReady = false;
      encoder.copyBufferToTexture(
        {
          buffer: this.#bounceZeroBuffer,
          bytesPerRow: Math.ceil((this.#psX * 8) / 256) * 256,
          rowsPerImage: this.#psY,
        },
        { texture: this.#bounceTexture },
        { width: this.#psX, height: this.#psY },
      );
    }
    if (this.bounces && this.#lastFluenceReady) {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass('bounce') });
      pass.setPipeline(this.#bounceComputePipeline);
      pass.setBindGroup(0, this.#bounceBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.#psX / WG_BOUNCE[0]), Math.ceil(this.#psY / WG_BOUNCE[1]));
      pass.end();
    }

    // ── Step 2: HRC cascade processing per direction ──
    // Zero the fluence SSBO. All 4 directions accumulate into it additively.
    encoder.clearBuffer(this.#fluenceBuffer);

    // Two frustum configs: H (E/W) and V (N/S). Each direction uses its
    // frustum's probe/slice counts for dispatch. Zero waste.
    const frustums = [
      { pc: this.#psX, sc: this.#psY },
      { pc: this.#psY, sc: this.#psX },
    ];
    const dirCfg = [0, 1, 0, 1]; // E→H, N→V, W→H, S→V

    for (let dir = 0; dir < 4; dir++) {
      const dn = ['E', 'N', 'W', 'S'][dir];
      const cfg = dirCfg[dir];
      const { pc, sc } = frustums[cfg];
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass(dn) });

      pass.setPipeline(this.#raySeedPipeline);
      pass.setBindGroup(0, this.#seedBindGroups[dir]);
      pass.dispatchWorkgroups(Math.ceil(pc / WG_SEED[0]), Math.ceil(sc / WG_SEED[1]));

      pass.setPipeline(this.#rayExtendPipeline);
      for (let level = 1; level < nc; level++) {
        pass.setBindGroup(0, this.#extendBindGroups[cfg * (nc - 1) + (level - 1)]);
        pass.dispatchWorkgroups(
          Math.ceil((ceilDiv(pc, 1 << level) * ((1 << level) + 1)) / WG_EXTEND[0]),
          Math.ceil(sc / WG_EXTEND[1]),
        );
      }

      pass.setPipeline(this.#coneMergePipeline);
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        pass.setBindGroup(0, this.#mergeBindGroups[dir][k]);
        pass.dispatchWorkgroups(
          Math.ceil((ceilDiv(pc, 1 << level) * (1 << level)) / WG_MERGE[0]),
          Math.ceil(sc / WG_MERGE[1]),
        );
      }

      pass.end();
    }

    this.#lastFluenceReady = true;

    // ── Step 2.5: Copy fluence SSBO → texture for blit (bilinear sampling) and bounce ──
    encoder.copyBufferToTexture(
      {
        buffer: this.#fluenceBuffer,
        bytesPerRow: this.#fluenceStride * 8,
        rowsPerImage: this.#psY,
      },
      { texture: this.#fluenceTexture },
      { width: this.#psX, height: this.#psY },
    );

    // ── Step 2.75: Acoustic gather pass ──
    encoder.clearBuffer(this.#channelGainsBuffer);
    {
      const pass = encoder.beginComputePass({ timestampWrites: this.#tsPass('gather') });
      pass.setPipeline(this.#gatherPipeline);
      pass.setBindGroup(0, this.#gatherBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }
    if (this.#channelGainsReadback.mapState === 'unmapped') {
      encoder.copyBufferToBuffer(this.#channelGainsBuffer, 0, this.#channelGainsReadback, 0, 256 * 4);
    }

    // ── Step 3: Final blit ──
    this.#blitToScreen(encoder, this.#renderPipeline, this.#blitBindGroup, 'blit');

    this.#resolveTimestamps(encoder);
    this.#submitAndCapture(device, encoder);
    this.#readTimestamps();

    if (this.#channelGainsReadback.mapState === 'unmapped') {
      this.#channelGainsReadback
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const raw = new Uint32Array(this.#channelGainsReadback.getMappedRange());
          for (let i = 0; i < 256; i++) this.#channelGains[i] = raw[i] / 65536.0;
          this.#channelGainsReadback.unmap();
        })
        .catch(() => {});
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

  #renderPathTraced(encoder: GPUCommandEncoder, width: number, height: number) {
    const device = this.#device;
    const readIdx = this.#ptFrameIndex % 2;
    const writeIdx = 1 - readIdx;

    this.#ptParamsView.set({
      screenW: width,
      screenH: height,
      frameIndex: this.#ptFrameIndex,
      samplesPerPixel: 16,
      maxBounces: this.bounces ? 8 : 0,
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

    this.#blitToScreen(
      encoder,
      this.#ptBlitPipeline,
      bg(device, this.#ptBlitPipeline.getBindGroupLayout(0), this.#ptAccumTextureViews[writeIdx], {
        buffer: this.#blitParamsBuffer,
      }),
    );
    this.#ptFrameIndex++;
  }

  #renderPTBlit(encoder: GPUCommandEncoder) {
    const lastWriteIdx = (this.#ptFrameIndex + 1) % 2;
    this.#blitToScreen(
      encoder,
      this.#ptBlitPipeline,
      bg(this.#device, this.#ptBlitPipeline.getBindGroupLayout(0), this.#ptAccumTextureViews[lastWriteIdx], {
        buffer: this.#blitParamsBuffer,
      }),
    );
  }

  #uploadStaticParams(width: number, height: number) {
    const device = this.#device;
    const psX = this.#psX;
    const psY = this.#psY;
    const nc = this.#numCascades;

    // Per-direction probe/slice counts:
    // E/W: probes along X (psX), slices along Y (psY)
    // N/S: probes along Y (psY), slices along X (psX)
    // Two frustum configurations: Horizontal (E/W) and Vertical (N/S).
    // Each defines the cascade's active-axis probe count and cross-axis slice count.
    const frustums = [
      { pc: psX, sc: psY, nc: ceilLog2(psX), ms: nextPow2(psX) }, // H
      { pc: psY, sc: psX, nc: ceilLog2(psY), ms: nextPow2(psY) }, // V
    ];
    const dirCfg = [0, 1, 0, 1]; // E→H, N→V, W→H, S→V

    // Seed params: per direction (4) — includes transform matrix
    for (let dir = 0; dir < 4; dir++) {
      const f = frustums[dirCfg[dir]];
      const dt = dirTransform(dir, width, height, Math.max(psX, psY));
      this.#seedParamsView.set({
        probeCount: f.pc,
        sliceCount: f.sc,
        screenW: width,
        screenH: height,
        probeSpacing: dt.probeSpacing,
        pad: 0,
        transformX: [...dt.transformX, 0],
        transformY: [...dt.transformY, 0],
      });
      device.queue.writeBuffer(this.#seedParamsBuffer, dir * 256, this.#seedParamsView.arrayBuffer);
    }

    // Extend params: per frustum (2) — cascade structure is identical within H/V pair
    for (let cfg = 0; cfg < 2; cfg++) {
      const f = frustums[cfg];
      for (let level = 1; level < nc; level++) {
        const numRays = (1 << level) + 1;
        this.#extendParamsView.set({
          probeCount: f.pc,
          level,
          invNumRays: 1.0 / numRays,
          prevRayW: ceilDiv(f.pc, 1 << (level - 1)) * ((1 << (level - 1)) + 1),
          currRayW: ceilDiv(f.pc, 1 << level) * numRays,
          sliceCount: f.sc,
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

    // Merge params: per direction (4) — fluence coordinate transform differs per direction
    // fc = (fxProbe*probeIdx + fxSlice*sliceIdx + fxOff,
    //        fyProbe*probeIdx + fySlice*sliceIdx + fyOff)
    const dirFluence = [
      { fxProbe: 1, fxSlice: 0, fxOff: -1, fyProbe: 0, fySlice: 1, fyOff: 0 }, // E
      { fxProbe: 0, fxSlice: 1, fxOff: 0, fyProbe: 1, fySlice: 0, fyOff: -1 }, // N
      { fxProbe: -1, fxSlice: 0, fxOff: psX, fyProbe: 0, fySlice: 1, fyOff: 0 }, // W
      { fxProbe: 0, fxSlice: 1, fxOff: 0, fyProbe: -1, fySlice: 0, fyOff: psY }, // S
    ];
    const perDir = 2 * (1 << nc) - 2;
    const angData = new Float32Array(4 * perDir);
    for (let dir = 0; dir < 4; dir++) {
      const f = frustums[dirCfg[dir]];
      const fl = dirFluence[dir];
      let angOff = dir * perDir;
      for (let level = 0; level < nc; level++) {
        const numCones = 1 << level;
        const nextNumCones = numCones * 2;
        const angBase = angOff;
        for (let s = 0; s < nextNumCones; s++) {
          const N = nextNumCones;
          angData[angOff + s] = Math.atan2(2 * s - N + 2, N) - Math.atan2(2 * s - N, N);
        }
        this.#mergeParamsView.set({
          probeCount: f.pc,
          numCones,
          numProbes: ceilDiv(f.pc, 1 << level),
          numRays: numCones + 1,
          nextNumCones,
          isLastLevel: level === f.nc - 1 ? 1 : 0,
          fluenceW: psX,
          fluenceStride: this.#fluenceStride,
          skyShift: Math.log2(f.ms) - Math.log2(nextNumCones),
          conesShift: level,
          angWeightBase: angBase,
          skyRow: dir,
          sliceCount: f.sc,
          mergeStride: f.ms,
          mergeInWidth: level < f.nc - 1 ? ceilDiv(f.pc, 1 << (level + 1)) * (1 << (level + 1)) : 0,
          ...fl,
        });
        device.queue.writeBuffer(this.#mergeParamsBuffer, (dir * nc + level) * 256, this.#mergeParamsView.arrayBuffer);
        angOff += nextNumCones;
      }
    }
    device.queue.writeBuffer(this.#angWeightBuffer, 0, angData);

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height, debugMode: this.debugMode });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    this.#bounceParamsView.set({ screenW: width, screenH: height, pad0: 0, pad1: 0 });
    device.queue.writeBuffer(this.#bounceParamsBuffer, 0, this.#bounceParamsView.arrayBuffer);

    const spacing = Math.max(width, height) / Math.max(psX, psY);
    this.#gatherParamsView.set({ screenW: width, screenH: height, probeSpacing: spacing, pad: 0 });
    device.queue.writeBuffer(this.#gatherParamsBuffer, 0, this.#gatherParamsView.arrayBuffer);

    this.#computeSkyPrefixSums();
  }

  // ── Event handlers ──

  #handleResize = async () => {
    if (DEBUG_CANVAS) return;
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
    if (this.pathTracing || this.#ptShowResult) {
      const spp = this.#ptFrameIndex * 16;
      const elapsed = this.#ptFrameIndex > 0 ? ((performance.now() - this.#ptStartTime) / 1000).toFixed(1) : '0.0';
      const label = this.pathTracing ? 'PT' : 'PT (frozen)';
      return ` ${label} f${this.#ptFrameIndex} ${spp}spp ${elapsed}s`;
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
