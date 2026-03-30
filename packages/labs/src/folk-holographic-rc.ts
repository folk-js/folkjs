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
  ar: number,
  ag: number,
  ab: number,
  albedo: number,
  scattering: number,
];

// Per-channel opacity for fully solid materials. 1.0 = completely opaque (zero transmittance).
// The world opacity texture stores per-channel opacity in [0,1] as rgba8unorm (linear).
// 256 levels is sufficient for practical opacity values. Linear encoding maximises
// precision near 0 and 1 (solid/transparent boundaries). A logarithmic or perceptual
// encoding could give finer control in mid-range opacities for participating media,
// but would complicate the seed shader's pow() transmittance calculation.
const SOLID_OPACITY = 1;

function nextPowerOf2(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 2)));
}

const TEX_RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
const TEX_STORAGE = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;

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

// ── World-render shaders (shapes, lines, mouse light → emission + opacity) ──
// MRT: location(0) = emission (rgb = emitted light, a = albedo for diffuse bounces)
//      location(1) = opacity (rgb = per-channel 0–1, a = scattering coefficient 0–1)
// Vertex data: position (vec2), color (vec3), opacity (vec3), albedo (f32), scattering (f32)

const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) opacity: vec3f,
  @location(3) albedo: f32,
  @location(4) scattering: f32,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) opacity: vec3f,
  @location(2) albedo: f32,
  @location(3) scattering: f32,
}
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  out.opacity = input.opacity;
  out.albedo = input.albedo;
  out.scattering = input.scattering;
  return out;
}
struct FragOut { @location(0) emission: vec4f, @location(1) opacity: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  var out: FragOut;
  out.emission = vec4f(srgbToLinear(in.color), in.albedo);
  out.opacity = vec4f(in.opacity, in.scattering);
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
  @location(4) opacity: vec3f,
  @location(5) albedo: f32,
  @location(6) scattering: f32,
}
struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }
@vertex fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f, @location(1) p2: vec2f,
  @location(2) color: vec3f, @location(3) thickness: f32,
  @location(4) opacity: vec3f, @location(5) albedo: f32,
  @location(6) scattering: f32,
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
  out.opacity = opacity; out.albedo = albedo; out.scattering = scattering;
  return out;
}
struct FragOut { @location(0) emission: vec4f, @location(1) opacity: vec4f }
@fragment fn fragment_main(in: VertexOutput) -> FragOut {
  let pos = in.position.xy;
  let ab = in.p2 - in.p1; let ap = pos - in.p1;
  let lenSq = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / lenSq, 0.0, 1.0), 0.0, lenSq < 0.001);
  let nearest = in.p1 + ab * t;
  let d = length(pos - nearest) - in.radius;
  if (d > 0.0) { discard; }
  var out: FragOut;
  out.emission = vec4f(srgbToLinear(in.color), in.albedo);
  out.opacity = vec4f(in.opacity, in.scattering);
  return out;
}
`;

// ── HRC Phase A: Ray Seed (cascade 0) ──
// Samples emission and opacity textures at each probe position. The opacity
// texture stores per-channel opacity in [0,1] (0 = transparent, 1 = solid).
// Transmittance = 1 - opacity. Radiance = emission * opacity (light produced
// by the material, weighted by its presence). Both ray indices per probe
// receive the same value (differentiation happens during extension).

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
@group(0) @binding(1) var opacityTex: texture_2d<f32>;
@group(0) @binding(2) var bounceTex: texture_2d<f32>;
@group(0) @binding(3) var rayOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var transOut: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(5) var<uniform> params: SeedParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeIdx = i32(gid.x);
  let perpIdx = i32(gid.y);
  let ps = i32(params.probeSize);
  if (probeIdx >= ps || perpIdx >= ps) { return; }

  let wp = vec2f(params.originX, params.originY)
         + vec2f(params.alongAxisX, params.alongAxisY) * (f32(probeIdx) + 0.5) * params.scaleAlong
         + vec2f(params.perpAxisX, params.perpAxisY) * (f32(perpIdx) + 0.5) * params.scalePerp;

  let px = vec2i(i32(floor(wp.x)), i32(floor(wp.y)));
  var rad = vec3f(0.0);
  var trans = vec3f(1.0);
  if (px.x >= 0 && px.y >= 0 && px.x < i32(params.screenW) && px.y < i32(params.screenH)) {
    let emission = textureLoad(emissionTex, px, 0).rgb;
    let opacity = textureLoad(opacityTex, px, 0).rgb;
    let bounce = textureLoad(bounceTex, px, 0).rgb;
    trans = pow(1.0 - opacity, vec3f(params.scaleAlong));
    rad = (emission + bounce) * (1.0 - trans);
  }

  let radV = vec4f(rad, 0.0);
  let transV = vec4f(trans, 1.0);
  textureStore(rayOut, vec2i(probeIdx * 2, perpIdx), radV);
  textureStore(rayOut, vec2i(probeIdx * 2 + 1, perpIdx), radV);
  textureStore(transOut, vec2i(probeIdx * 2, perpIdx), transV);
  textureStore(transOut, vec2i(probeIdx * 2 + 1, perpIdx), transV);
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
// Uses opacity texture to mask indirect light at solid/translucent surfaces.

const blitCommon = /*wgsl*/ `
struct BlitParams { exposure: f32, screenW: f32, screenH: f32, pad: f32 };
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
@group(0) @binding(1) var emissionTex: texture_2d<f32>;
@group(0) @binding(2) var opacityTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: BlitParams;
@group(0) @binding(4) var linearSamp: sampler;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(params.screenW, params.screenH);
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let emission = textureLoad(emissionTex, vec2u(pos.xy), 0).rgb;
  let opacity = textureLoad(opacityTex, vec2u(pos.xy), 0).rgb;
  let emissive = emission * opacity;
  let indirect = fluence / TWO_PI * (1.0 - opacity);
  return tonemapAndDither((emissive + indirect) * params.exposure, vec2u(pos.xy));
}
`;

// ── Bounce compute shader ──
// Runs at SCREEN resolution. For each pixel, bilinearly samples the previous
// frame's fluence (at probe resolution), reads albedo from the emission texture,
// and writes bounce = fluence * albedo. This bounce texture is then read by the
// seed shader at each probe's world position, adding bounced light as emission.
// Each frame recomputes bounce from scratch — convergence happens naturally as
// the fluence already includes all previous bounces' contributions via the HRC
// pipeline.

const bounceComputeShader = /*wgsl*/ `
struct BounceParams {
  screenW: u32,
  screenH: u32,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var prevFluence: texture_2d<f32>;
@group(0) @binding(1) var fluenceSampler: sampler;
@group(0) @binding(2) var emissionTex: texture_2d<f32>;
@group(0) @binding(3) var opacityTex: texture_2d<f32>;
@group(0) @binding(4) var bounceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> params: BounceParams;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = i32(gid.x);
  let py = i32(gid.y);
  if (px >= i32(params.screenW) || py >= i32(params.screenH)) { return; }

  let screenSize = vec2f(f32(params.screenW), f32(params.screenH));
  let uv = (vec2f(f32(px), f32(py)) + 0.5) / screenSize;

  let albedo = textureLoad(emissionTex, vec2i(px, py), 0).a;
  let opacityVal = textureLoad(opacityTex, vec2i(px, py), 0);
  let scattering = opacityVal.a;
  let avgOpacity = (opacityVal.r + opacityVal.g + opacityVal.b) / 3.0;

  // For surface pixels (albedo > 0), the fluence AT the surface is ~0 because
  // probes inside solid geometry have no incoming light. Sample from the nearest
  // air pixel by checking cardinal neighbors and taking the max.
  var fluence: vec3f;
  if (albedo > 0.001 && avgOpacity > 0.5) {
    let step = 1.0 / screenSize;
    let f0 = textureSampleLevel(prevFluence, fluenceSampler, uv + vec2f(step.x, 0.0), 0.0).rgb;
    let f1 = textureSampleLevel(prevFluence, fluenceSampler, uv - vec2f(step.x, 0.0), 0.0).rgb;
    let f2 = textureSampleLevel(prevFluence, fluenceSampler, uv + vec2f(0.0, step.y), 0.0).rgb;
    let f3 = textureSampleLevel(prevFluence, fluenceSampler, uv - vec2f(0.0, step.y), 0.0).rgb;
    fluence = max(max(f0, f1), max(f2, f3));
  } else {
    fluence = textureSampleLevel(prevFluence, fluenceSampler, uv, 0.0).rgb;
  }

  const TWO_PI = 6.2831853;
  let surfaceBounce = fluence * albedo;
  let volumeScatter = fluence * avgOpacity * scattering;
  let bounce = (surfaceBounce + volumeScatter) / TWO_PI;
  textureStore(bounceOut, vec2i(px, py), vec4f(bounce, 0.0));
}
`;

// ── 2D Path Tracer (ground truth reference) ──
// Progressive Monte Carlo path tracer operating at screen resolution.
// Shares the emission + opacity world textures with HRC. Each frame adds
// N samples per pixel and blends with the accumulation buffer. Supports
// volumetric transport, diffuse bounces (albedo), and scattering.

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

@group(0) @binding(0) var emissionTex: texture_2d<f32>;
@group(0) @binding(1) var opacityTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba32float, write>;
@group(0) @binding(4) var<uniform> params: PTParams;

fn pcgHash(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn randomFloat(seed: ptr<function, u32>) -> f32 {
  *seed = pcgHash(*seed);
  return f32(*seed) / 4294967295.0;
}

fn sampleScene(pos: vec2f) -> vec4f {
  let px = vec2i(i32(floor(pos.x)), i32(floor(pos.y)));
  if (px.x < 0 || px.y < 0 || px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) {
    return vec4f(0.0);
  }
  return textureLoad(emissionTex, px, 0);
}

fn sampleOpacity(pos: vec2f) -> vec4f {
  let px = vec2i(i32(floor(pos.x)), i32(floor(pos.y)));
  if (px.x < 0 || px.y < 0 || px.x >= i32(params.screenW) || px.y >= i32(params.screenH)) {
    return vec4f(0.0);
  }
  return textureLoad(opacityTex, px, 0);
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
    var throughput = vec3f(1.0);
    var radiance = vec3f(0.0);
    var lastAirPos = rayPos;

    // Sample the starting pixel (the camera's own position in 2D)
    {
      let em0 = sampleScene(rayPos);
      let op0 = sampleOpacity(rayPos);
      let opacity0 = op0.rgb;
      radiance += throughput * em0.rgb * opacity0;
      throughput *= (1.0 - opacity0);
    }

    for (var step = 0u; step < 4096u; step++) {
      rayPos += rayDir;
      let em = sampleScene(rayPos);
      let op = sampleOpacity(rayPos);
      let opacity = op.rgb;
      let avgOpacity = (opacity.r + opacity.g + opacity.b) / 3.0;

      if (avgOpacity < 0.001) {
        lastAirPos = rayPos;
        continue;
      }

      // Accumulate emission and attenuate (standard volumetric transport)
      radiance += throughput * em.rgb * opacity;
      throughput *= (1.0 - opacity);

      // If throughput is near zero, the ray is fully absorbed.
      // Try diffuse bounce via Russian roulette with albedo.
      if (all(throughput < vec3f(0.001))) {
        let albedo = em.a;
        if (albedo > 0.001 && randomFloat(&seed) < albedo) {
          // Bounce: move back to last air position, pick new direction.
          // Throughput restored to pre-absorption level (albedo / probability = 1).
          throughput = vec3f(1.0);
          rayPos = lastAirPos;
          let newAngle = randomFloat(&seed) * 6.2831853;
          rayDir = vec2f(cos(newAngle), sin(newAngle));
          continue;
        }
        break;
      }

      // Volumetric scattering
      let scatterCoeff = op.a;
      if (scatterCoeff > 0.001) {
        let scatterProb = avgOpacity * scatterCoeff;
        if (randomFloat(&seed) < scatterProb) {
          let newAngle = randomFloat(&seed) * 6.2831853;
          rayDir = vec2f(cos(newAngle), sin(newAngle));
        }
      }
    }

    sampleSum += radiance;
  }

  let newSample = sampleSum / f32(params.samplesPerPixel);

  // Progressive accumulation: blend with previous frames
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
  @property({ type: Boolean, reflect: true }) bounces = true;
  @property({ type: Boolean, reflect: true, attribute: 'path-tracing' }) pathTracing = false;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World textures (emission + opacity, MRT)
  #emissionTexture!: GPUTexture;
  #emissionTextureView!: GPUTextureView;
  #opacityTexture!: GPUTexture;
  #opacityTextureView!: GPUTextureView;
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

  // Bounce texture (screen resolution) for diffuse light bounces
  #bounceTexture!: GPUTexture;
  #bounceTextureView!: GPUTextureView;
  #lastFluenceResultIdx = -1;

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
  #fluenceAccumPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Pre-created bind groups (recreated on resize)
  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][]; // [dir][mergeStep k]
  #mergeResultIdx!: number; // which merge texture holds level-0 result at full cascade count
  #accumBindGroups!: GPUBindGroup[]; // [dir] for standard 4-dir case
  #blitBindGroups!: GPUBindGroup[]; // [fluenceIdx] for final blit
  #bounceBindGroups!: GPUBindGroup[]; // [fluenceIdx] for bounce compute

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
  #bounceParamsBuffer!: GPUBuffer;
  #bounceParamsView!: StructuredView;

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
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    colorIndex: number,
    thickness = 20,
    opacity: [number, number, number] = [SOLID_OPACITY, SOLID_OPACITY, SOLID_OPACITY],
    albedo = 0,
    scattering = 0,
  ) {
    const [r, g, b] = FolkHolographicRC.#colors[colorIndex] ?? FolkHolographicRC.#colors[1];
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness, opacity[0], opacity[1], opacity[2], albedo, scattering]);
    this.#lineBufferDirty = true;
  }

  clearLines() {
    this.#lines = [];
    this.#lineBufferDirty = true;
  }

  setMouseLightColor(r: number, g: number, b: number) {
    this.#mouseLightColor = { r, g, b };
    this.#mouseDirty = true;
  }

  setMouseLightRadius(radius: number) {
    this.#mouseLightRadius = radius;
    this.#mouseDirty = true;
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
    if (changedProperties.has('probeSize') && changedProperties.get('probeSize') !== undefined) {
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
    this.#device = await adapter.requestDevice();

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    Object.assign(this.#canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
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

    const ubo = (label: string, size: number) =>
      device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    [this.#emissionTexture, this.#emissionTextureView] = tex(
      device,
      'Emission',
      width,
      height,
      'rgba16float',
      TEX_RENDER,
    );
    [this.#opacityTexture, this.#opacityTextureView] = tex(device, 'Opacity', width, height, 'rgba8unorm', TEX_RENDER);

    this.#rayTextures = [];
    this.#rayTextureViews = [];
    this.#transTextures = [];
    this.#transTextureViews = [];
    for (let i = 0; i < this.#numCascades; i++) {
      const w = (ps >> i) * ((1 << i) + 1);
      const [rt, rv] = tex(device, `Ray-${i}`, w, ps, 'rgba16float', TEX_STORAGE);
      const [tt, tv] = tex(device, `Trans-${i}`, w, ps, 'rgba8unorm', TEX_STORAGE);
      this.#rayTextures.push(rt);
      this.#rayTextureViews.push(rv);
      this.#transTextures.push(tt);
      this.#transTextureViews.push(tv);
    }

    const texPair = (label: string, w: number, h: number, fmt: GPUTextureFormat): [GPUTexture[], GPUTextureView[]] => {
      const [t0, v0] = tex(device, `${label}-0`, w, h, fmt, TEX_STORAGE);
      const [t1, v1] = tex(device, `${label}-1`, w, h, fmt, TEX_STORAGE);
      return [
        [t0, t1],
        [v0, v1],
      ];
    };
    [this.#mergeTextures, this.#mergeTextureViews] = texPair('Merge', ps, ps, 'rgba16float');
    [this.#fluenceTextures, this.#fluenceTextureViews] = texPair('Fluence', ps, ps, 'rgba16float');

    [this.#bounceTexture, this.#bounceTextureView] = tex(
      device,
      'Bounce',
      width,
      height,
      'rgba16float',
      TEX_STORAGE | GPUTextureUsage.COPY_DST,
    );
    device.queue.writeTexture(
      { texture: this.#bounceTexture },
      new Uint8Array(width * height * 8),
      { bytesPerRow: width * 8, rowsPerImage: height },
      { width, height },
    );
    this.#lastFluenceResultIdx = -1;

    this.#seedParamsView = uboView(raySeedShader, 'params');
    this.#extendParamsView = uboView(rayExtendShader, 'params');
    this.#mergeParamsView = uboView(coneMergeShader, 'params');
    this.#accumParamsView = uboView(fluenceAccumShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');
    this.#bounceParamsView = uboView(bounceComputeShader, 'params');

    this.#seedParamsBuffer = ubo('SeedParams', 4 * 256);
    this.#extendParamsBuffer = ubo('ExtendParams', Math.max(1, this.#numCascades - 1) * 256);
    this.#mergeParamsBuffer = ubo('MergeParams', 4 * this.#numCascades * 256);
    this.#accumParamsBuffer = ubo('AccumParams', 4 * 256);
    this.#blitParamsBuffer = ubo('BlitParams', this.#blitParamsView.arrayBuffer.byteLength);
    this.#bounceParamsBuffer = ubo('BounceParams', this.#bounceParamsView.arrayBuffer.byteLength);

    const [ptA0, ptV0] = tex(device, 'PT-Accum-0', width, height, 'rgba32float', TEX_STORAGE);
    const [ptA1, ptV1] = tex(device, 'PT-Accum-1', width, height, 'rgba32float', TEX_STORAGE);
    this.#ptAccumTextures = [ptA0, ptA1];
    this.#ptAccumTextureViews = [ptV0, ptV1];
    this.#ptParamsView = uboView(pathTraceShader, 'params');
    this.#ptParamsBuffer = ubo('PT-Params', this.#ptParamsView.arrayBuffer.byteLength);
  }

  #initPipelines() {
    const device = this.#device;
    const MRT_TARGETS: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: 'rgba8unorm' }];

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
            arrayStride: 40,
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x3'),
              attr(2, 20, 'float32x3'),
              attr(3, 32, 'float32'),
              attr(4, 36, 'float32'),
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
            arrayStride: 52,
            stepMode: 'instance',
            attributes: [
              attr(0, 0, 'float32x2'),
              attr(1, 8, 'float32x2'),
              attr(2, 16, 'float32x3'),
              attr(3, 28, 'float32'),
              attr(4, 32, 'float32x3'),
              attr(5, 44, 'float32'),
              attr(6, 48, 'float32'),
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
    this.#fluenceAccumPipeline = computePipeline(device, 'HRC-FluenceAccum', fluenceAccumShader);
    this.#renderPipeline = fullscreenBlit('HRC-Blit', blitShader, this.#presentationFormat);
    this.#ptPipeline = computePipeline(device, 'PT-PathTrace', pathTraceShader);
    this.#ptBlitPipeline = fullscreenBlit('PT-Blit', ptBlitShader, this.#presentationFormat);

    this.#createStaticBindGroups();
  }

  #createStaticBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;
    const seedLayout = this.#raySeedPipeline.getBindGroupLayout(0);
    const extLayout = this.#rayExtendPipeline.getBindGroupLayout(0);
    const mergeLayout = this.#coneMergePipeline.getBindGroupLayout(0);
    const accumLayout = this.#fluenceAccumPipeline.getBindGroupLayout(0);
    const seedPS = this.#seedParamsView.arrayBuffer.byteLength;
    const extPS = this.#extendParamsView.arrayBuffer.byteLength;
    const mergePS = this.#mergeParamsView.arrayBuffer.byteLength;
    const accumPS = this.#accumParamsView.arrayBuffer.byteLength;

    this.#seedBindGroups = [0, 1, 2, 3].map((dir) =>
      bg(
        device,
        seedLayout,
        this.#emissionTextureView,
        this.#opacityTextureView,
        this.#bounceTextureView,
        this.#rayTextureViews[0],
        this.#transTextureViews[0],
        { buffer: this.#seedParamsBuffer, offset: dir * 256, size: seedPS },
      ),
    );

    this.#extendBindGroups = [];
    for (let level = 1; level < nc; level++) {
      this.#extendBindGroups.push(
        bg(
          device,
          extLayout,
          this.#rayTextureViews[level - 1],
          this.#transTextureViews[level - 1],
          this.#rayTextureViews[level],
          this.#transTextureViews[level],
          { buffer: this.#extendParamsBuffer, offset: (level - 1) * 256, size: extPS },
        ),
      );
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
            this.#rayTextureViews[level],
            this.#transTextureViews[level],
            this.#mergeTextureViews[readIdx],
            this.#mergeTextureViews[writeIdx],
            { buffer: this.#mergeParamsBuffer, offset: (dir * nc + level) * 256, size: mergePS },
          ),
        );
        [readIdx, writeIdx] = [writeIdx, readIdx];
      }
      this.#mergeBindGroups.push(dirBGs);
    }
    this.#mergeResultIdx = (nc - 1) % 2 === 0 ? 0 : 1;

    const mergeResultView = this.#mergeTextureViews[this.#mergeResultIdx];
    this.#accumBindGroups = [0, 1, 2, 3].map((dir) =>
      bg(
        device,
        accumLayout,
        mergeResultView,
        this.#fluenceTextureViews[dir % 2 === 0 ? 1 : 0],
        this.#fluenceTextureViews[dir % 2 === 0 ? 0 : 1],
        { buffer: this.#accumParamsBuffer, offset: dir * 256, size: accumPS },
      ),
    );

    this.#blitBindGroups = [0, 1].map((idx) =>
      bg(
        device,
        this.#renderPipeline.getBindGroupLayout(0),
        this.#fluenceTextureViews[idx],
        this.#emissionTextureView,
        this.#opacityTextureView,
        { buffer: this.#blitParamsBuffer },
        this.#linearSampler,
      ),
    );

    this.#bounceBindGroups = [0, 1].map((idx) =>
      bg(
        device,
        this.#bounceComputePipeline.getBindGroupLayout(0),
        this.#fluenceTextureViews[idx],
        this.#linearSampler,
        this.#emissionTextureView,
        this.#opacityTextureView,
        this.#bounceTextureView,
        { buffer: this.#bounceParamsBuffer },
      ),
    );
  }

  #destroyResources() {
    this.#emissionTexture?.destroy();
    this.#opacityTexture?.destroy();
    this.#rayTextures?.forEach((t) => t.destroy());
    this.#transTextures?.forEach((t) => t.destroy());
    this.#mergeTextures?.forEach((t) => t.destroy());
    this.#fluenceTextures?.forEach((t) => t.destroy());
    this.#bounceTexture?.destroy();
    this.#ptAccumTextures?.forEach((t) => t.destroy());
    this.#ptParamsBuffer?.destroy();
    this.#seedParamsBuffer?.destroy();
    this.#extendParamsBuffer?.destroy();
    this.#mergeParamsBuffer?.destroy();
    this.#accumParamsBuffer?.destroy();
    this.#blitParamsBuffer?.destroy();
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
      const sx = shape.x ?? 0;
      const sy = shape.y ?? 0;
      const sw = shape.width ?? 0;
      const sh = shape.height ?? 0;
      const rot = shape.rotation ?? 0;

      const colorAttr = element.getAttribute('data-color');
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
      const attenAttr = element.getAttribute('data-opacity');
      let ar: number, ag: number, ab: number;
      if (attenAttr !== null) {
        const parts = attenAttr.split(',').map(Number);
        ar = parts[0] ?? SOLID_OPACITY;
        ag = parts[1] ?? ar;
        ab = parts[2] ?? ar;
      } else {
        ar = SOLID_OPACITY;
        ag = SOLID_OPACITY;
        ab = SOLID_OPACITY;
      }
      const albedoAttr = element.getAttribute('data-albedo');
      const albedo = albedoAttr !== null ? Number(albedoAttr) : 0;
      const scatterAttr = element.getAttribute('data-scattering');
      const scatter = scatterAttr !== null ? Number(scatterAttr) : 0;

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
        vertices.push(vx, vy, r, g, b, ar, ag, ab, albedo, scatter);
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

  #updateLineBuffer() {
    if (!this.#device || this.#lines.length === 0) {
      this.#lineCount = 0;
      return;
    }
    const count = this.#lines.length;
    const FPL = 13;
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
      const sa = SOLID_OPACITY;
      verts.push(cx, cy, r, g, b, sa, sa, sa, 0, 0);
      verts.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b, sa, sa, sa, 0, 0);
      verts.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b, sa, sa, sa, 0, 0);
    }
    this.#mouseLightVertexCount = verts.length / 10;
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
    if (this.#mouseDirty) {
      this.#mouseDirty = false;
      this.#updateMouseLightBuffer();
    }

    const { width, height } = this.#canvas;
    const device = this.#device;
    const ps = this.#ps;
    const nc = this.#numCascades;
    const wg = Math.ceil(ps / 16);

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    const encoder = device.createCommandEncoder();

    // ── Step 1: Render world textures (emission + opacity) ──
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#emissionTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
          { view: this.#opacityTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
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

    // ── Step 1.5: Bounce compute (reads previous frame's fluence at screen resolution) ──
    if (!this.bounces && this.#lastFluenceResultIdx >= 0) {
      this.#lastFluenceResultIdx = -1;
      device.queue.writeTexture(
        { texture: this.#bounceTexture },
        new Uint8Array(width * height * 8),
        { bytesPerRow: width * 8, rowsPerImage: height },
        { width, height },
      );
    }
    if (this.bounces && this.#lastFluenceResultIdx >= 0) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#bounceComputePipeline);
      pass.setBindGroup(0, this.#bounceBindGroups[this.#lastFluenceResultIdx]);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }

    // ── Step 2: HRC cascade processing per direction ──
    const isDebugMode = this.#debugDir > 0 || this.#debugCascadeCount > 0;
    let fluenceResultIdx = 0;

    if (!isDebugMode) {
      for (let dir = 0; dir < 4; dir++) {
        // Phase A: Ray Seed
        {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#raySeedPipeline);
          pass.setBindGroup(0, this.#seedBindGroups[dir]);
          pass.dispatchWorkgroups(wg, wg);
          pass.end();
        }
        // Phase B: Ray Extension (bottom-up)
        for (let level = 1; level < nc; level++) {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#rayExtendPipeline);
          pass.setBindGroup(0, this.#extendBindGroups[level - 1]);
          pass.dispatchWorkgroups(Math.ceil(((ps >> level) * ((1 << level) + 1)) / 16), wg);
          pass.end();
        }
        // Phase C: Cone Merge (top-down)
        for (let k = 0; k < nc; k++) {
          const level = nc - 1 - k;
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#coneMergePipeline);
          pass.setBindGroup(0, this.#mergeBindGroups[dir][k]);
          pass.dispatchWorkgroups(wg, Math.ceil(((ps >> level) * (1 << level)) / 16));
          pass.end();
        }
        // Phase D: Fluence Accumulation
        {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#fluenceAccumPipeline);
          pass.setBindGroup(0, this.#accumBindGroups[dir]);
          pass.dispatchWorkgroups(wg, wg);
          pass.end();
        }
      }
      fluenceResultIdx = 1;
    } else {
      // Debug path: subset of directions/cascades, per-frame bind groups
      let fluenceReadIdx = 0;
      let fluenceWriteIdx = 1;
      let isFirstDir = true;

      for (let dir = 0; dir < 4; dir++) {
        if (this.#debugDir > 0 && dir !== this.#debugDir - 1) continue;
        const ec = this.#debugCascadeCount > 0 ? Math.min(this.#debugCascadeCount, nc) : nc;

        {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#raySeedPipeline);
          pass.setBindGroup(0, this.#seedBindGroups[dir]);
          pass.dispatchWorkgroups(wg, wg);
          pass.end();
        }

        for (let level = 1; level < ec; level++) {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#rayExtendPipeline);
          pass.setBindGroup(0, this.#extendBindGroups[level - 1]);
          pass.dispatchWorkgroups(Math.ceil(((ps >> level) * ((1 << level) + 1)) / 16), wg);
          pass.end();
        }

        const usePrebuiltMerge = ec === nc;
        let mergeReadIdx = 1,
          mergeWriteIdx = 0;
        for (let k = 0; k < ec; k++) {
          const level = ec - 1 - k;
          const mergeBG = usePrebuiltMerge
            ? this.#mergeBindGroups[dir][k]
            : bg(
                device,
                this.#coneMergePipeline.getBindGroupLayout(0),
                this.#rayTextureViews[level],
                this.#transTextureViews[level],
                this.#mergeTextureViews[mergeReadIdx],
                this.#mergeTextureViews[mergeWriteIdx],
                {
                  buffer: this.#mergeParamsBuffer,
                  offset: (dir * nc + level) * 256,
                  size: this.#mergeParamsView.arrayBuffer.byteLength,
                },
              );
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#coneMergePipeline);
          pass.setBindGroup(0, mergeBG);
          pass.dispatchWorkgroups(wg, Math.ceil(((ps >> level) * (1 << level)) / 16));
          pass.end();
          [mergeReadIdx, mergeWriteIdx] = [mergeWriteIdx, mergeReadIdx];
        }

        const mergeResultView = usePrebuiltMerge
          ? this.#mergeTextureViews[this.#mergeResultIdx]
          : this.#mergeTextureViews[mergeReadIdx];

        this.#accumParamsView.set({ direction: dir, isFirstDir: isFirstDir ? 1 : 0, probeSize: ps, pad: 0 });
        device.queue.writeBuffer(this.#accumParamsBuffer, dir * 256, this.#accumParamsView.arrayBuffer);

        if (isFirstDir) {
          isFirstDir = false;
          fluenceWriteIdx = 0;
          fluenceReadIdx = 1;
        } else {
          [fluenceWriteIdx, fluenceReadIdx] = [fluenceReadIdx, fluenceWriteIdx];
        }

        const accumBG = bg(
          device,
          this.#fluenceAccumPipeline.getBindGroupLayout(0),
          mergeResultView,
          this.#fluenceTextureViews[fluenceReadIdx],
          this.#fluenceTextureViews[fluenceWriteIdx],
          { buffer: this.#accumParamsBuffer, offset: dir * 256, size: this.#accumParamsView.arrayBuffer.byteLength },
        );
        const accumPass = encoder.beginComputePass();
        accumPass.setPipeline(this.#fluenceAccumPipeline);
        accumPass.setBindGroup(0, accumBG);
        accumPass.dispatchWorkgroups(wg, wg);
        accumPass.end();

        fluenceResultIdx = fluenceWriteIdx;
      }
    }

    this.#lastFluenceResultIdx = fluenceResultIdx;

    // ── Step 3: Final blit ──
    this.#blitToScreen(encoder, this.#renderPipeline, this.#blitBindGroups[fluenceResultIdx]);

    this.#submitAndCapture(device, encoder);
  }

  #blitToScreen(encoder: GPUCommandEncoder, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup) {
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
      maxBounces: 8,
      pad0: 0,
      pad1: 0,
      pad2: 0,
    });
    device.queue.writeBuffer(this.#ptParamsBuffer, 0, this.#ptParamsView.arrayBuffer);

    const ptBG = bg(
      device,
      this.#ptPipeline.getBindGroupLayout(0),
      this.#emissionTextureView,
      this.#opacityTextureView,
      this.#ptAccumTextureViews[readIdx],
      this.#ptAccumTextureViews[writeIdx],
      { buffer: this.#ptParamsBuffer },
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

    for (let dir = 0; dir < 4; dir++) {
      this.#accumParamsView.set({ direction: dir, isFirstDir: dir === 0 ? 1 : 0, probeSize: ps, pad: 0 });
      device.queue.writeBuffer(this.#accumParamsBuffer, dir * 256, this.#accumParamsView.arrayBuffer);
    }

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    this.#bounceParamsView.set({ screenW: width, screenH: height, pad0: 0, pad1: 0 });
    device.queue.writeBuffer(this.#bounceParamsBuffer, 0, this.#bounceParamsView.arrayBuffer);
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
    this.#mouseDirty = true;
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

  get debugInfo() {
    if (this.pathTracing || this.#ptShowResult) {
      const spp = this.#ptFrameIndex * 16;
      const elapsed = this.#ptFrameIndex > 0 ? ((performance.now() - this.#ptStartTime) / 1000).toFixed(1) : '0.0';
      const label = this.pathTracing ? 'PT' : 'PT (frozen)';
      return ` ${label} f${this.#ptFrameIndex} ${spp}spp ${elapsed}s`;
    }
    const dirNames = ['All', 'E', 'S', 'W', 'N'];
    const dirLabel = this.#debugDir > 0 ? ` [${dirNames[this.#debugDir]}]` : '';
    const ccLabel = this.#debugCascadeCount > 0 ? ` C${this.#debugCascadeCount}/${this.#numCascades}` : '';
    return `${dirLabel}${ccLabel}`;
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
