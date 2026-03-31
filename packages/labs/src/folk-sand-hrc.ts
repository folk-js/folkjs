import { css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

const SAND_WORKGROUP = 8;
const PIXELS_PER_PARTICLE = 2;

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

// ── Sand simulation WGSL fragments ──

const sandParamsStruct = /*wgsl*/ `
struct SandParams {
  width: u32,
  height: u32,
  frame: u32,
  materialType: u32,
  brushRadius: f32,
  initialSand: f32,
}`;

const mouseStruct = /*wgsl*/ `
struct Mouse {
  x: f32,
  y: f32,
  prevX: f32,
  prevY: f32,
}`;

const hashFunctions = /*wgsl*/ `
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash14(p: vec4f) -> f32 {
  var p4 = fract(p * vec4f(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.x + p4.y) * (p4.z + p4.w));
}
fn hash44(p: vec4f) -> vec4f {
  var p4 = fract(p * vec4f(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}`;

const sandUtils = /*wgsl*/ `
fn getIndex(x: u32, y: u32, width: u32) -> u32 { return y * width + x; }
fn getIndexI(p: vec2i, width: u32) -> u32 { return u32(p.y) * width + u32(p.x); }
fn inBounds(p: vec2i, width: u32, height: u32) -> bool {
  return p.x >= 0 && p.y >= 0 && p.x < i32(width) && p.y < i32(height);
}`;

const particleDefs = /*wgsl*/ `
const AIR: u32 = 0u;
const SMOKE: u32 = 1u;
const WATER: u32 = 2u;
const LAVA: u32 = 3u;
const SAND: u32 = 4u;
const STONE: u32 = 5u;
const WALL: u32 = 6u;
const COLLISION: u32 = 99u;

struct Particle { ptype: u32, rand: u32, }
fn particle(ptype: u32, rand: u32) -> Particle { return Particle(ptype, rand); }`;

const sandInitShader = /*wgsl*/ `
${sandParamsStruct}
${particleDefs}
${hashFunctions}
${sandUtils}
@group(0) @binding(0) var<storage, read_write> output: array<Particle>;
@group(0) @binding(1) var<uniform> params: SandParams;
@compute @workgroup_size(${SAND_WORKGROUP}, ${SAND_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let r = hash12(vec2f(gid.xy));
  let ptype = select(AIR, SAND, r < params.initialSand);
  let rand = u32(hash12(vec2f(gid.xy) + 0.5) * 255.0);
  output[getIndex(gid.x, gid.y, params.width)] = particle(ptype, rand);
}`;

const sandCollisionShader = /*wgsl*/ `
struct CollisionParams { width: u32, height: u32, shapeCount: u32, padding: u32, }
struct Shape { minX: f32, minY: f32, maxX: f32, maxY: f32, }
@group(0) @binding(0) var<storage, read_write> collision: array<u32>;
@group(0) @binding(1) var<uniform> params: CollisionParams;
@group(0) @binding(2) var<storage, read> shapes: array<Shape>;
@compute @workgroup_size(${SAND_WORKGROUP}, ${SAND_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  let pixel = vec2f(gid.xy) / vec2f(f32(params.width), f32(params.height));
  var isCollision = 0u;
  for (var i = 0u; i < params.shapeCount; i++) {
    let s = shapes[i];
    if (pixel.x >= s.minX && pixel.x <= s.maxX && pixel.y >= s.minY && pixel.y <= s.maxY) {
      isCollision = 1u; break;
    }
  }
  collision[gid.y * params.width + gid.x] = isCollision;
}`;

const sandSimulationShader = /*wgsl*/ `
${sandParamsStruct}
${mouseStruct}
${particleDefs}
${hashFunctions}
${sandUtils}
@group(0) @binding(0) var<storage, read> input: array<Particle>;
@group(0) @binding(1) var<storage, read_write> output: array<Particle>;
@group(0) @binding(2) var<storage, read> collision: array<u32>;
@group(0) @binding(3) var<uniform> params: SandParams;
@group(0) @binding(4) var<uniform> mouse: Mouse;

fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
fn getOffset(frame: u32) -> vec2i {
  let i = frame % 4u;
  if (i == 0u) { return vec2i(0, 0); }
  if (i == 1u) { return vec2i(1, 1); }
  if (i == 2u) { return vec2i(0, 1); }
  return vec2i(1, 0);
}
fn getData(p: vec2i) -> Particle {
  if (!inBounds(p, params.width, params.height)) { return particle(WALL, 0u); }
  let idx = getIndexI(p, params.width);
  if (collision[idx] > 0u) { return particle(COLLISION, 0u); }
  return input[idx];
}
fn newParticle(ptype: u32, coord: vec2i, frame: u32) -> Particle {
  let rand = u32(hash14(vec4f(vec2f(coord), f32(frame), f32(ptype))) * 255.0);
  return particle(ptype, rand);
}
fn isCollisionAt(p: vec2i) -> bool {
  if (!inBounds(p, params.width, params.height)) { return false; }
  return collision[getIndexI(p, params.width)] > 0u;
}
fn swap(a: ptr<function, Particle>, b: ptr<function, Particle>) { let tmp = *a; *a = *b; *b = tmp; }
fn writeIfInBounds(p: vec2i, val: Particle) {
  if (inBounds(p, params.width, params.height)) { output[getIndexI(p, params.width)] = val; }
}

@compute @workgroup_size(${SAND_WORKGROUP}, ${SAND_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let offset = getOffset(params.frame);
  let p = vec2i(gid.xy) * 2 - offset;
  var t00 = getData(p);
  var t10 = getData(p + vec2i(1, 0));
  var t01 = getData(p + vec2i(0, 1));
  var t11 = getData(p + vec2i(1, 1));
  let tn00 = getData(p + vec2i(0, -1));
  let tn10 = getData(p + vec2i(1, -1));

  if (mouse.x > 0.0) {
    let m = vec2f(mouse.x, mouse.y);
    let mp = vec2f(mouse.prevX, mouse.prevY);
    if (sdSegment(vec2f(p), m, mp) < params.brushRadius) { t00 = newParticle(params.materialType, p, params.frame); }
    if (sdSegment(vec2f(p + vec2i(1, 0)), m, mp) < params.brushRadius) { t10 = newParticle(params.materialType, p + vec2i(1, 0), params.frame); }
    if (sdSegment(vec2f(p + vec2i(0, 1)), m, mp) < params.brushRadius) { t01 = newParticle(params.materialType, p + vec2i(0, 1), params.frame); }
    if (sdSegment(vec2f(p + vec2i(1, 1)), m, mp) < params.brushRadius) { t11 = newParticle(params.materialType, p + vec2i(1, 1), params.frame); }
  }

  if (!(t00.ptype == t10.ptype && t01.ptype == t11.ptype && t00.ptype == t01.ptype)) {
    let r = hash44(vec4f(vec2f(p), f32(params.frame), 0.0));
    if (t00.ptype == SMOKE) { if (t01.ptype < SMOKE && r.y < 0.25) { swap(&t00, &t01); } else if (r.z < 0.003) { t00 = newParticle(AIR, p, params.frame); } }
    if (t10.ptype == SMOKE) { if (t11.ptype < SMOKE && r.y < 0.25) { swap(&t10, &t11); } else if (r.z < 0.003) { t10 = newParticle(AIR, p + vec2i(1, 0), params.frame); } }
    if ((t01.ptype == SMOKE && t11.ptype < SMOKE) || (t01.ptype < SMOKE && t11.ptype == SMOKE)) { if (r.x < 0.25) { swap(&t01, &t11); } }
    if (((t01.ptype == SAND && t11.ptype < SAND) || (t01.ptype < SAND && t11.ptype == SAND)) && t00.ptype < SAND && t10.ptype < SAND && r.x < 0.4) { swap(&t01, &t11); }
    if (t01.ptype == SAND || t01.ptype == STONE) {
      if (t00.ptype < SAND && t00.ptype != WATER && t00.ptype != LAVA && r.y < 0.9) { swap(&t01, &t00); }
      else if (t00.ptype == WATER && r.y < 0.3) { swap(&t01, &t00); }
      else if (t00.ptype == LAVA && r.y < 0.15) { swap(&t01, &t00); }
      else if (t11.ptype < SAND && t10.ptype < SAND) { swap(&t01, &t10); }
    }
    if (t11.ptype == SAND || t11.ptype == STONE) {
      if (t10.ptype < SAND && t10.ptype != WATER && t10.ptype != LAVA && r.y < 0.9) { swap(&t11, &t10); }
      else if (t10.ptype == WATER && r.y < 0.3) { swap(&t11, &t10); }
      else if (t10.ptype == LAVA && r.y < 0.15) { swap(&t11, &t10); }
      else if (t01.ptype < SAND && t00.ptype < SAND) { swap(&t11, &t00); }
    }
    var drop = false;
    if (t01.ptype == WATER) {
      if (t00.ptype < WATER && r.y < 0.95) { swap(&t01, &t00); drop = true; }
      else if (t11.ptype < WATER && t10.ptype < WATER && r.z < 0.3) { swap(&t01, &t10); drop = true; }
    }
    if (t11.ptype == WATER) {
      if (t10.ptype < WATER && r.y < 0.95) { swap(&t11, &t10); drop = true; }
      else if (t01.ptype < WATER && t00.ptype < WATER && r.z < 0.3) { swap(&t11, &t00); drop = true; }
    }
    if (!drop) {
      if ((t01.ptype == WATER && t11.ptype < WATER) || (t01.ptype < WATER && t11.ptype == WATER)) {
        if ((t00.ptype >= WATER && t10.ptype >= WATER) || r.w < 0.8) { swap(&t01, &t11); }
      }
      if ((t00.ptype == WATER && t10.ptype < WATER) || (t00.ptype < WATER && t10.ptype == WATER)) {
        if ((tn00.ptype >= WATER && tn10.ptype >= WATER) || r.w < 0.8) { swap(&t00, &t10); }
      }
    }
    if (t01.ptype == LAVA) {
      if (t00.ptype < LAVA && r.y < 0.8) { swap(&t01, &t00); }
      else if (t11.ptype < LAVA && t10.ptype < LAVA && r.z < 0.2) { swap(&t01, &t10); }
    }
    if (t11.ptype == LAVA) {
      if (t10.ptype < LAVA && r.y < 0.8) { swap(&t11, &t10); }
      else if (t01.ptype < LAVA && t00.ptype < LAVA && r.z < 0.2) { swap(&t11, &t00); }
    }
    if (t00.ptype == LAVA) {
      if (t01.ptype == WATER) { t00 = newParticle(STONE, p, params.frame); t01 = newParticle(SMOKE, p + vec2i(0, 1), params.frame); }
      else if (t10.ptype == WATER) { t00 = newParticle(STONE, p, params.frame); t10 = newParticle(SMOKE, p + vec2i(1, 0), params.frame); }
    }
    if (t10.ptype == LAVA) {
      if (t11.ptype == WATER) { t10 = newParticle(STONE, p + vec2i(1, 0), params.frame); t11 = newParticle(SMOKE, p + vec2i(1, 1), params.frame); }
      else if (t00.ptype == WATER) { t10 = newParticle(STONE, p + vec2i(1, 0), params.frame); t00 = newParticle(SMOKE, p, params.frame); }
    }
    if ((t01.ptype == LAVA && t11.ptype < LAVA) || (t01.ptype < LAVA && t11.ptype == LAVA)) { if (r.x < 0.6) { swap(&t01, &t11); } }
  }

  if (t00.ptype == COLLISION && !isCollisionAt(p)) { t00 = newParticle(AIR, p, params.frame); }
  if (t10.ptype == COLLISION && !isCollisionAt(p + vec2i(1, 0))) { t10 = newParticle(AIR, p + vec2i(1, 0), params.frame); }
  if (t01.ptype == COLLISION && !isCollisionAt(p + vec2i(0, 1))) { t01 = newParticle(AIR, p + vec2i(0, 1), params.frame); }
  if (t11.ptype == COLLISION && !isCollisionAt(p + vec2i(1, 1))) { t11 = newParticle(AIR, p + vec2i(1, 1), params.frame); }

  writeIfInBounds(p, t00);
  writeIfInBounds(p + vec2i(1, 0), t10);
  writeIfInBounds(p + vec2i(0, 1), t01);
  writeIfInBounds(p + vec2i(1, 1), t11);
}`;

// ── Sand decode shader: state buffer → world + material MRT ──

const sandDecodeShader = /*wgsl*/ `
${sandParamsStruct}
${particleDefs}
${sandUtils}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}
@vertex fn vs(@builtin(vertex_index) i: u32) -> VertexOutput {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  var out: VertexOutput;
  out.position = vec4f(pos[i], 0.0, 1.0);
  out.texCoord = pos[i] * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var<storage, read> state: array<Particle>;
@group(0) @binding(1) var<uniform> params: SandParams;

struct FragOut { @location(0) world: vec4f, @location(1) material: vec4f }

@fragment fn fs(@builtin(position) pos: vec4f, @location(0) texCoord: vec2f) -> FragOut {
  let simCoord = vec2u(texCoord * vec2f(f32(params.width), f32(params.height)));
  let p = state[getIndex(simCoord.x, simCoord.y, params.width)];
  let r = f32(p.rand) / 255.0;
  var out: FragOut;

  // world: rgb=emission, a=opacity
  // material: rgb=albedo color, a=scattering
  switch p.ptype {
    case AIR: {
      out.world = vec4f(0.0);
      out.material = vec4f(0.0);
    }
    case SMOKE: {
      out.world = vec4f(0.0, 0.0, 0.0, 0.02 + r * 0.02);
      out.material = vec4f(0.4, 0.4, 0.45, 0.7 + r * 0.2);
    }
    case WATER: {
      out.world = vec4f(0.0, 0.0, 0.0, 0.12 + r * 0.06);
      out.material = vec4f(0.15, 0.3, 0.6, 0.2 + r * 0.15);
    }
    case LAVA: {
      let intensity = 0.6 + r * 0.4;
      out.world = vec4f(intensity * 0.95, intensity * 0.35, intensity * 0.08, 1.0);
      out.material = vec4f(0.0, 0.0, 0.0, 0.0);
    }
    case SAND: {
      let col = mix(vec3f(0.76, 0.56, 0.24), vec3f(0.72, 0.52, 0.20), r) * (0.85 + r * 0.15);
      out.world = vec4f(0.0, 0.0, 0.0, 0.8);
      out.material = vec4f(col, 0.0);
    }
    case STONE: {
      let col = mix(vec3f(0.15, 0.17, 0.19), vec3f(0.22, 0.24, 0.26), r);
      out.world = vec4f(0.0, 0.0, 0.0, 0.85);
      out.material = vec4f(col, 0.0);
    }
    case WALL, COLLISION: {
      out.world = vec4f(0.0, 0.0, 0.0, 0.85);
      out.material = vec4f(0.05, 0.05, 0.05, 0.0);
    }
    default: {
      out.world = vec4f(0.0);
      out.material = vec4f(0.0);
    }
  }
  return out;
}`;

// ── HRC shaders (cascade, bounce, blit) ──

const raySeedShader = /*wgsl*/ `
struct SeedParams {
  probeSize: u32, screenW: f32, screenH: f32, pad0: u32,
  originX: f32, originY: f32, alongAxisX: f32, alongAxisY: f32,
  perpAxisX: f32, perpAxisY: f32, scaleAlong: f32, scalePerp: f32,
};
@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var bounceTex: texture_2d<f32>;
@group(0) @binding(2) var rayOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: SeedParams;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let probeIdx = i32(gid.x); let perpIdx = i32(gid.y);
  let ps = i32(params.probeSize);
  if (probeIdx >= ps || perpIdx >= ps) { return; }
  let wp = vec2f(params.originX, params.originY)
         + vec2f(params.alongAxisX, params.alongAxisY) * (f32(probeIdx) + 0.5) * params.scaleAlong
         + vec2f(params.perpAxisX, params.perpAxisY) * (f32(perpIdx) + 0.5) * params.scalePerp;
  let px = vec2i(i32(floor(wp.x)), i32(floor(wp.y)));
  var rad = vec3f(0.0); var trans = 1.0;
  if (px.x >= 0 && px.y >= 0 && px.x < i32(params.screenW) && px.y < i32(params.screenH)) {
    let world = textureLoad(worldTex, px, 0);
    let bounce = textureLoad(bounceTex, px, 0).rgb;
    trans = pow(1.0 - world.a, params.scaleAlong);
    rad = (world.rgb + bounce) * (1.0 - trans);
  }
  let v = vec4f(rad, trans);
  textureStore(rayOut, vec2i(probeIdx * 2, perpIdx), v);
  textureStore(rayOut, vec2i(probeIdx * 2 + 1, perpIdx), v);
}`;

const rayExtendShader = /*wgsl*/ `
struct ExtendParams { probeSize: u32, level: u32, pad0: u32, pad1: u32, };
@group(0) @binding(0) var prevRayTex: texture_2d<f32>;
@group(0) @binding(1) var currRayTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: ExtendParams;
struct RayData { rad: vec3f, trans: f32 }
fn loadPrev(probeIdx: i32, rayIdx: i32, perpIdx: i32) -> RayData {
  let prevLevel = params.level - 1u;
  let prevInterval = i32(1u << prevLevel);
  let prevNumRays = prevInterval + 1;
  let prevNumProbes = i32(params.probeSize >> prevLevel);
  if (probeIdx < 0 || probeIdx >= prevNumProbes || rayIdx < 0 || rayIdx >= prevNumRays || perpIdx < 0 || perpIdx >= i32(params.probeSize)) { return RayData(vec3f(0.0), 1.0); }
  let coord = vec2i(probeIdx * prevNumRays + rayIdx, perpIdx);
  let r = textureLoad(prevRayTex, coord, 0);
  return RayData(r.rgb, r.a);
}
fn overComp(near: RayData, far: RayData) -> RayData { return RayData(near.rad + far.rad * near.trans, near.trans * far.trans); }
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let texelX = i32(gid.x); let perpIdx = i32(gid.y);
  let interval = i32(1u << params.level); let numRays = interval + 1;
  let numProbes = i32(params.probeSize >> params.level);
  let probeIdx = texelX / numRays; let rayIdx = texelX - probeIdx * numRays;
  if (probeIdx >= numProbes || perpIdx >= i32(params.probeSize)) { return; }
  let prevInterval = interval / 2; let lower = rayIdx / 2; let upper = (rayIdx + 1) / 2;
  let perpOffL = -prevInterval + lower * 2;
  let extL = overComp(loadPrev(probeIdx*2, lower, perpIdx), loadPrev(probeIdx*2+1, upper, perpIdx+perpOffL));
  let perpOffR = -prevInterval + upper * 2;
  let extR = overComp(loadPrev(probeIdx*2, upper, perpIdx), loadPrev(probeIdx*2+1, lower, perpIdx+perpOffR));
  textureStore(currRayTex, vec2i(texelX, perpIdx), vec4f((extL.rad+extR.rad)*0.5, (extL.trans+extR.trans)*0.5));
}`;

const coneMergeShader = /*wgsl*/ `
struct MergeParams {
  probeSize: u32, numCones: u32, numProbes: u32, numRays: u32,
  nextNumCones: u32, isLastLevel: u32, aspect: f32, direction: u32,
  isFirstDir: u32, skyR: f32, skyG: f32, skyB: f32,
};
@group(0) @binding(0) var rayTex: texture_2d<f32>;
@group(0) @binding(1) var mergeIn: texture_2d<f32>;
@group(0) @binding(2) var mergeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: MergeParams;
@group(0) @binding(4) var fluencePrev: texture_2d<f32>;
@group(0) @binding(5) var fluenceCurr: texture_storage_2d<rgba16float, write>;
struct RayData { rad: vec3f, trans: f32 }
fn loadRay(probeIdx: i32, rayIdx: i32, perpIdx: i32) -> RayData {
  if (probeIdx < 0 || probeIdx >= i32(params.numProbes) || rayIdx < 0 || rayIdx >= i32(params.numRays) || perpIdx < 0 || perpIdx >= i32(params.probeSize)) { return RayData(vec3f(0.0), 1.0); }
  let r = textureLoad(rayTex, vec2i(probeIdx * i32(params.numRays) + rayIdx, perpIdx), 0);
  return RayData(r.rgb, r.a);
}
fn loadMerge(texX: i32, perpIdx: i32) -> vec3f {
  if (params.isLastLevel == 1u || texX < 0 || texX >= i32(params.probeSize) || perpIdx < 0 || perpIdx >= i32(params.probeSize)) { return vec3f(0.0); }
  return textureLoad(mergeIn, vec2i(texX, perpIdx), 0).rgb;
}
fn angWeight(subCone: u32, numAng: u32) -> f32 {
  let N = f32(numAng); let s = f32(subCone); let a = params.aspect;
  return atan2((2.0*s - N + 2.0)*a, N) - atan2((2.0*s - N)*a, N);
}
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let perpIdx = i32(gid.x); let flatIdx = i32(gid.y);
  let nc = i32(params.numCones); let probeIdx = flatIdx / nc; let coneIdx = flatIdx - probeIdx * nc;
  if (probeIdx >= i32(params.numProbes) || perpIdx >= i32(params.probeSize)) { return; }
  var result = vec3f(0.0);
  for (var side = 0; side < 2; side++) {
    let subCone = u32(coneIdx * 2 + side); let vrayI = coneIdx + side;
    let cW = angWeight(subCone, params.nextNumCones);
    let ray = loadRay(probeIdx, vrayI, perpIdx);
    let perpOff = -nc + vrayI * 2; let isEven = (probeIdx % 2 == 0); let align = select(1, 2, isEven);
    let farX = (probeIdx + align) * nc + i32(subCone);
    var farCone = loadMerge(farX, perpIdx + perpOff * align);
    if (params.isLastLevel == 1u) { farCone = vec3f(params.skyR, params.skyG, params.skyB); }
    if (isEven) {
      let ext = loadRay(probeIdx + 1, vrayI, perpIdx + perpOff);
      let cRad = ray.rad + ext.rad * ray.trans; let cTrans = ray.trans * ext.trans;
      let nearCone = loadMerge(probeIdx * nc + i32(subCone), perpIdx);
      result += (cRad * cW + farCone * cTrans + nearCone) * 0.5;
    } else {
      result += ray.rad * cW + farCone * ray.trans;
    }
  }
  textureStore(mergeOut, vec2i(probeIdx * nc + coneIdx, perpIdx), vec4f(result, 1.0));
  if (params.numCones == 1u) {
    let ps = i32(params.probeSize); var fc: vec2i;
    switch (params.direction) {
      case 0u: { fc = vec2i(probeIdx - 1, perpIdx); }
      case 1u: { fc = vec2i(perpIdx, probeIdx - 1); }
      case 2u: { fc = vec2i(ps - probeIdx, perpIdx); }
      case 3u: { fc = vec2i(perpIdx, ps - probeIdx); }
      default: { fc = vec2i(probeIdx - 1, perpIdx); }
    }
    if (fc.x >= 0 && fc.x < ps && fc.y >= 0 && fc.y < ps) {
      if (params.isFirstDir == 1u) { textureStore(fluenceCurr, fc, vec4f(result, 1.0)); }
      else { textureStore(fluenceCurr, fc, vec4f(textureLoad(fluencePrev, fc, 0).rgb + result, 1.0)); }
    }
  }
}`;

const blitCommon = /*wgsl*/ `
const TWO_PI = 6.2831853;
fn acesTonemap(x: vec3f) -> vec3f { return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), vec3f(0.0), vec3f(1.0)); }
fn linearToSrgb(c: vec3f) -> vec3f { return pow(c, vec3f(1.0/2.2)); }
fn pcg(v: u32) -> u32 { let s = v*747796405u+2891336453u; let w = ((s>>(( s>>28u)+4u))^s)*277803737u; return (w>>22u)^w; }
fn triangularDither(fragCoord: vec2u) -> vec3f { let seed = fragCoord.x+fragCoord.y*8192u; return vec3f((f32(pcg(seed))/4294967295.0 + f32(pcg(seed+1u))/4294967295.0 - 1.0)/255.0); }
fn tonemapAndDither(hdr: vec3f, fragCoord: vec2u) -> vec4f { return vec4f(linearToSrgb(acesTonemap(hdr))+triangularDither(fragCoord), 1.0); }
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let pos = array(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1)); return vec4f(pos[i],0,1); }
`;

const blitShader = blitCommon + /*wgsl*/ `
struct BlitParams { exposure: f32, screenW: f32, screenH: f32, pad: f32 };
@group(0) @binding(0) var fluenceTex: texture_2d<f32>;
@group(0) @binding(1) var worldTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: BlitParams;
@group(0) @binding(3) var linearSamp: sampler;
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(params.screenW, params.screenH);
  let fluence = textureSampleLevel(fluenceTex, linearSamp, uv, 0.0).rgb;
  let world = textureLoad(worldTex, vec2u(pos.xy), 0);
  let emissive = world.rgb * world.a;
  let indirect = fluence / TWO_PI * (1.0 - world.a);
  return tonemapAndDither((emissive + indirect) * params.exposure, vec2u(pos.xy));
}`;

const bounceComputeShader = /*wgsl*/ `
struct BounceParams { screenW: u32, screenH: u32, pad0: u32, pad1: u32, };
@group(0) @binding(0) var prevFluence: texture_2d<f32>;
@group(0) @binding(1) var fluenceSampler: sampler;
@group(0) @binding(2) var worldTex: texture_2d<f32>;
@group(0) @binding(3) var materialTex: texture_2d<f32>;
@group(0) @binding(4) var bounceOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> params: BounceParams;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let px = i32(gid.x); let py = i32(gid.y);
  if (px >= i32(params.screenW) || py >= i32(params.screenH)) { return; }
  let screenSize = vec2f(f32(params.screenW), f32(params.screenH));
  let uv = (vec2f(f32(px), f32(py)) + 0.5) / screenSize;
  let opacity = textureLoad(worldTex, vec2i(px, py), 0).a;
  let mat = textureLoad(materialTex, vec2i(px, py), 0);
  let albedoColor = mat.rgb;
  let scattering = mat.a;
  var fluence = textureSampleLevel(prevFluence, fluenceSampler, uv, 0.0).rgb;
  let albedoLum = dot(albedoColor, vec3f(0.333));
  if (albedoLum > 0.001) {
    let step = 1.0 / screenSize;
    let offsets = array<vec2f, 4>(vec2f(1,0), vec2f(-1,0), vec2f(0,1), vec2f(0,-1));
    var sum = vec3f(0.0); var weight = 0.0;
    for (var d = 0; d < 4; d++) {
      let npos = vec2i(px + i32(offsets[d].x), py + i32(offsets[d].y));
      let ntrans = 1.0 - textureLoad(worldTex, npos, 0).a;
      let nf = textureSampleLevel(prevFluence, fluenceSampler, uv + offsets[d]*step, 0.0).rgb * ntrans;
      if (dot(nf, vec3f(0.2126,0.7152,0.0722)) > 0.001) { sum += nf; weight += 1.0; }
    }
    if (weight > 0.0) { fluence = sum / weight; }
  }
  const TWO_PI = 6.2831853;
  let reemission = vec3f(scattering) + (1.0 - scattering) * albedoColor;
  textureStore(bounceOut, vec2i(px, py), vec4f(fluence * reemission / TWO_PI, 0.0));
}`;

// ── Direction definitions ──

const DIR_ALONG: [number, number][] = [[1,0],[0,1],[-1,0],[0,-1]];
const DIR_PERP: [number, number][] = [[0,1],[1,0],[0,1],[1,0]];

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

export class FolkSandHRC extends FolkBaseSet {
  static override tagName = 'folk-sand-hrc';

  static override styles = [
    FolkBaseSet.styles,
    css`
      canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: auto;
      }
    `,
  ];

  @property({ type: Number, reflect: true }) exposure = 1.5;
  @property({ type: Number, reflect: true }) probeSize = 1024;
  @property({ type: Boolean, reflect: true }) bounces = true;
  @property({ type: Number, attribute: 'initial-sand' }) initialSand = 0.15;

  @property({ type: Number, attribute: 'sky-r' }) skyR = 0;
  @property({ type: Number, attribute: 'sky-g' }) skyG = 0;
  @property({ type: Number, attribute: 'sky-b' }) skyB = 0;

  onMaterialChange?: (type: number) => void;

  setMaterial(type: number) {
    this.#materialType = type;
    this.onMaterialChange?.(type);
  }

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // Sand sim state
  #sandInitPipeline!: GPUComputePipeline;
  #sandCollisionPipeline!: GPUComputePipeline;
  #sandSimPipeline!: GPUComputePipeline;
  #stateBuffers: GPUBuffer[] = [];
  #collisionBuffer!: GPUBuffer;
  #currentStateIndex = 0;
  #sandParamsBuffer!: GPUBuffer;
  #mouseBuffer!: GPUBuffer;
  #collisionParamsBuffer!: GPUBuffer;
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;
  #sandParamsData = new ArrayBuffer(32);
  #sandParamsView = new DataView(this.#sandParamsData);
  #mouseData = new Float32Array(4);
  #collisionParams = new Uint32Array(4);
  #sandInitBindGroup!: GPUBindGroup;
  #sandSimBindGroups!: [GPUBindGroup, GPUBindGroup];
  #sandCollisionBindGroup?: GPUBindGroup;
  #simW = 0;
  #simH = 0;

  // Sand decode pass
  #decodePipeline!: GPURenderPipeline;
  #decodeBindGroups!: [GPUBindGroup, GPUBindGroup];

  // World textures (written by decode pass, read by HRC)
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;
  #materialTexture!: GPUTexture;
  #materialTextureView!: GPUTextureView;

  // HRC cascade
  #rayTextures!: GPUTexture[];
  #rayTextureViews!: GPUTextureView[];
  #mergeTextures!: GPUTexture[];
  #mergeTextureViews!: GPUTextureView[];
  #fluenceTextures!: GPUTexture[];
  #fluenceTextureViews!: GPUTextureView[];
  #bounceTexture!: GPUTexture;
  #bounceTextureView!: GPUTextureView;
  #lastFluenceResultIdx = -1;
  #fluenceZeroBuffer!: GPUBuffer;

  #bounceComputePipeline!: GPUComputePipeline;
  #raySeedPipeline!: GPUComputePipeline;
  #rayExtendPipeline!: GPUComputePipeline;
  #coneMergePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #mergeBindGroups!: GPUBindGroup[][];
  #blitBindGroups!: GPUBindGroup[];
  #bounceBindGroups!: GPUBindGroup[];

  #linearSampler!: GPUSampler;
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

  #numCascades = 0;
  #ps = 0;
  #pointer = { x: -1, y: -1, prevX: -1, prevY: -1, down: false };
  #materialType = 4;
  #brushRadius = 5;
  #frame = 0;
  #animationFrame = 0;
  #isRunning = false;

  override async connectedCallback() {
    super.connectedCallback();
    this.#canvas = document.createElement('canvas');
    this.renderRoot.prepend(this.#canvas);

    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');
    this.#device = await adapter.requestDevice();

    const context = this.#canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to get WebGPU context');
    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.#linearSampler = this.#device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });

    this.#initAll();
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointerleave', this.#onPointerUp);
    document.addEventListener('keydown', this.#onKeyDown);
    window.addEventListener('resize', this.#handleResize);
    this.#isRunning = true;
    this.#startLoop();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);
    this.#canvas.removeEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.removeEventListener('pointermove', this.#onPointerMove);
    this.#canvas.removeEventListener('pointerup', this.#onPointerUp);
    this.#canvas.removeEventListener('pointerleave', this.#onPointerUp);
    document.removeEventListener('keydown', this.#onKeyDown);
    window.removeEventListener('resize', this.#handleResize);
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;
    this.#updateCollisionTexture();
  }

  #initAll() {
    const { width, height } = this.#canvas;
    const device = this.#device;
    const ps = nextPowerOf2(this.probeSize);
    this.#ps = ps;
    this.#numCascades = Math.log2(ps);
    this.#simW = Math.ceil(width / PIXELS_PER_PARTICLE);
    this.#simH = Math.ceil(height / PIXELS_PER_PARTICLE);

    const ubo = (label: string, size: number) =>
      device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const storBuf = (size: number) =>
      device.createBuffer({ size, usage: GPUBufferUsage.STORAGE });
    const storBufRW = (size: number) =>
      device.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    // Sand resources
    this.#sandParamsBuffer = ubo('SandParams', 32);
    this.#mouseBuffer = ubo('Mouse', 16);
    this.#collisionParamsBuffer = ubo('CollisionParams', 16);
    const stateSize = this.#simW * this.#simH * 8;
    this.#stateBuffers = [storBuf(stateSize), storBuf(stateSize)];
    this.#collisionBuffer = storBuf(stateSize);

    // Sand pipelines
    this.#sandInitPipeline = computePipeline(device, 'SandInit', sandInitShader);
    this.#sandCollisionPipeline = computePipeline(device, 'SandCollision', sandCollisionShader);
    this.#sandSimPipeline = computePipeline(device, 'SandSim', sandSimulationShader);

    // Sand bind groups
    this.#sandInitBindGroup = bg(device, this.#sandInitPipeline.getBindGroupLayout(0),
      { buffer: this.#stateBuffers[0] }, { buffer: this.#sandParamsBuffer });
    this.#sandSimBindGroups = [0, 1].map(i =>
      bg(device, this.#sandSimPipeline.getBindGroupLayout(0),
        { buffer: this.#stateBuffers[i] }, { buffer: this.#stateBuffers[1 - i] },
        { buffer: this.#collisionBuffer }, { buffer: this.#sandParamsBuffer }, { buffer: this.#mouseBuffer }),
    ) as [GPUBindGroup, GPUBindGroup];

    // World + material textures
    [this.#worldTexture, this.#worldTextureView] = tex(device, 'World', width, height, 'rgba16float', TEX_RENDER);
    [this.#materialTexture, this.#materialTextureView] = tex(device, 'Material', width, height, 'rgba8unorm', TEX_RENDER);

    // Decode pipeline (sand state → MRT)
    const MRT_TARGETS: GPUColorTargetState[] = [{ format: 'rgba16float' }, { format: 'rgba8unorm' }];
    const decodeModule = device.createShaderModule({ code: sandDecodeShader });
    this.#decodePipeline = device.createRenderPipeline({
      label: 'SandDecode',
      layout: 'auto',
      vertex: { module: decodeModule, entryPoint: 'vs' },
      fragment: { module: decodeModule, entryPoint: 'fs', targets: MRT_TARGETS },
      primitive: { topology: 'triangle-strip' },
    });
    this.#decodeBindGroups = [0, 1].map(i =>
      bg(device, this.#decodePipeline.getBindGroupLayout(0),
        { buffer: this.#stateBuffers[i] }, { buffer: this.#sandParamsBuffer }),
    ) as [GPUBindGroup, GPUBindGroup];

    // HRC cascade resources
    this.#rayTextures = [];
    this.#rayTextureViews = [];
    for (let i = 0; i < this.#numCascades; i++) {
      const w = (ps >> i) * ((1 << i) + 1);
      const [rt, rv] = tex(device, `Ray-${i}`, w, ps, 'rgba16float', TEX_STORAGE);
      this.#rayTextures.push(rt);
      this.#rayTextureViews.push(rv);
    }
    const [mt0, mv0] = tex(device, 'Merge-0', ps, ps, 'rgba16float', TEX_STORAGE);
    const [mt1, mv1] = tex(device, 'Merge-1', ps, ps, 'rgba16float', TEX_STORAGE);
    this.#mergeTextures = [mt0, mt1];
    this.#mergeTextureViews = [mv0, mv1];
    const [ft0, fv0] = tex(device, 'Fluence-0', ps, ps, 'rgba16float', TEX_STORAGE | GPUTextureUsage.COPY_DST);
    const [ft1, fv1] = tex(device, 'Fluence-1', ps, ps, 'rgba16float', TEX_STORAGE | GPUTextureUsage.COPY_DST);
    this.#fluenceTextures = [ft0, ft1];
    this.#fluenceTextureViews = [fv0, fv1];
    [this.#bounceTexture, this.#bounceTextureView] = tex(device, 'Bounce', width, height, 'rgba16float', TEX_STORAGE | GPUTextureUsage.COPY_DST);
    device.queue.writeTexture({ texture: this.#bounceTexture }, new Uint8Array(width * height * 8), { bytesPerRow: width * 8, rowsPerImage: height }, { width, height });
    this.#lastFluenceResultIdx = -1;
    this.#fluenceZeroBuffer = device.createBuffer({ size: ps * ps * 8, usage: GPUBufferUsage.COPY_SRC });

    // HRC pipelines
    this.#bounceComputePipeline = computePipeline(device, 'Bounce', bounceComputeShader);
    this.#raySeedPipeline = computePipeline(device, 'RaySeed', raySeedShader);
    this.#rayExtendPipeline = computePipeline(device, 'RayExtend', rayExtendShader);
    this.#coneMergePipeline = computePipeline(device, 'ConeMerge', coneMergeShader);
    this.#renderPipeline = device.createRenderPipeline({
      label: 'Blit', layout: 'auto',
      vertex: { module: device.createShaderModule({ code: blitShader }), entryPoint: 'vs' },
      fragment: { module: device.createShaderModule({ code: blitShader }), entryPoint: 'fs', targets: [{ format: this.#presentationFormat }] },
      primitive: { topology: 'triangle-strip' },
    });

    // HRC UBOs
    this.#seedParamsView = uboView(raySeedShader, 'params');
    this.#extendParamsView = uboView(rayExtendShader, 'params');
    this.#mergeParamsView = uboView(coneMergeShader, 'params');
    this.#blitParamsView = uboView(blitShader, 'params');
    this.#bounceParamsView = uboView(bounceComputeShader, 'params');
    const nc = this.#numCascades;
    this.#seedParamsBuffer = ubo('SeedParams', 4 * 256);
    this.#extendParamsBuffer = ubo('ExtendParams', Math.max(1, nc - 1) * 256);
    this.#mergeParamsBuffer = ubo('MergeParams', 4 * nc * 256);
    this.#blitParamsBuffer = ubo('BlitParams', this.#blitParamsView.arrayBuffer.byteLength);
    this.#bounceParamsBuffer = ubo('BounceParams', this.#bounceParamsView.arrayBuffer.byteLength);

    this.#createHRCBindGroups();
    this.#uploadStaticParams(width, height);

    // Init sand
    this.#updateSandUniforms(0);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.#sandInitPipeline);
    pass.setBindGroup(0, this.#sandInitBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.#simW / SAND_WORKGROUP), Math.ceil(this.#simH / SAND_WORKGROUP));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  #createHRCBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;
    const seedLayout = this.#raySeedPipeline.getBindGroupLayout(0);
    const extLayout = this.#rayExtendPipeline.getBindGroupLayout(0);
    const mergeLayout = this.#coneMergePipeline.getBindGroupLayout(0);
    const seedPS = this.#seedParamsView.arrayBuffer.byteLength;
    const extPS = this.#extendParamsView.arrayBuffer.byteLength;
    const mergePS = this.#mergeParamsView.arrayBuffer.byteLength;

    this.#seedBindGroups = [0,1,2,3].map(dir =>
      bg(device, seedLayout, this.#worldTextureView, this.#bounceTextureView, this.#rayTextureViews[0],
        { buffer: this.#seedParamsBuffer, offset: dir * 256, size: seedPS }));

    this.#extendBindGroups = [];
    for (let level = 1; level < nc; level++) {
      this.#extendBindGroups.push(bg(device, extLayout,
        this.#rayTextureViews[level - 1], this.#rayTextureViews[level],
        { buffer: this.#extendParamsBuffer, offset: (level - 1) * 256, size: extPS }));
    }

    this.#mergeBindGroups = [];
    for (let dir = 0; dir < 4; dir++) {
      const dirBGs: GPUBindGroup[] = [];
      let readIdx = 1, writeIdx = 0;
      const fReadIdx = dir % 2 === 0 ? 1 : 0;
      const fWriteIdx = dir % 2 === 0 ? 0 : 1;
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        dirBGs.push(bg(device, mergeLayout,
          this.#rayTextureViews[level], this.#mergeTextureViews[readIdx], this.#mergeTextureViews[writeIdx],
          { buffer: this.#mergeParamsBuffer, offset: (dir * nc + level) * 256, size: mergePS },
          this.#fluenceTextureViews[fReadIdx], this.#fluenceTextureViews[fWriteIdx]));
        [readIdx, writeIdx] = [writeIdx, readIdx];
      }
      this.#mergeBindGroups.push(dirBGs);
    }

    this.#blitBindGroups = [0, 1].map(idx =>
      bg(device, this.#renderPipeline.getBindGroupLayout(0),
        this.#fluenceTextureViews[idx], this.#worldTextureView,
        { buffer: this.#blitParamsBuffer }, this.#linearSampler));

    this.#bounceBindGroups = [0, 1].map(idx =>
      bg(device, this.#bounceComputePipeline.getBindGroupLayout(0),
        this.#fluenceTextureViews[idx], this.#linearSampler, this.#worldTextureView, this.#materialTextureView,
        this.#bounceTextureView, { buffer: this.#bounceParamsBuffer }));
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
      this.#seedParamsView.set({ probeSize: ps, screenW: width, screenH: height, pad0: 0, originX: ox, originY: oy, alongAxisX: ax, alongAxisY: ay, perpAxisX: px, perpAxisY: py, scaleAlong: sa, scalePerp: sp });
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
        this.#mergeParamsView.set({ probeSize: ps, numCones, numProbes: ps >> level, numRays: numCones + 1, nextNumCones: numCones * 2, isLastLevel: level === nc - 1 ? 1 : 0, aspect, direction: dir, isFirstDir: dir === 0 ? 1 : 0, skyR: this.skyR, skyG: this.skyG, skyB: this.skyB });
        device.queue.writeBuffer(this.#mergeParamsBuffer, (dir * nc + level) * 256, this.#mergeParamsView.arrayBuffer);
      }
    }
    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);
    this.#bounceParamsView.set({ screenW: width, screenH: height, pad0: 0, pad1: 0 });
    device.queue.writeBuffer(this.#bounceParamsBuffer, 0, this.#bounceParamsView.arrayBuffer);
  }

  #updateSandUniforms(frame: number) {
    const v = this.#sandParamsView;
    v.setUint32(0, this.#simW, true);
    v.setUint32(4, this.#simH, true);
    v.setUint32(8, frame, true);
    v.setUint32(12, this.#materialType, true);
    v.setFloat32(16, this.#brushRadius, true);
    v.setFloat32(20, this.initialSand, true);
    this.#device.queue.writeBuffer(this.#sandParamsBuffer, 0, this.#sandParamsData);

    const { x, y, prevX, prevY, down } = this.#pointer;
    const mx = (x / this.#canvas.width) * this.#simW;
    const my = (1 - y / this.#canvas.height) * this.#simH;
    const mpx = (prevX / this.#canvas.width) * this.#simW;
    const mpy = (1 - prevY / this.#canvas.height) * this.#simH;
    this.#mouseData[0] = down ? mx : -1;
    this.#mouseData[1] = down ? my : -1;
    this.#mouseData[2] = down ? mpx : -1;
    this.#mouseData[3] = down ? mpy : -1;
    this.#device.queue.writeBuffer(this.#mouseBuffer, 0, this.#mouseData);
  }

  #updateCollisionTexture() {
    if (!this.#device) return;
    const shapeData: number[] = [];
    this.sourceRects.forEach(rect => {
      shapeData.push(rect.left / this.clientWidth, 1 - rect.bottom / this.clientHeight, rect.right / this.clientWidth, 1 - rect.top / this.clientHeight);
    });
    this.#shapeCount = this.sourceRects.length;
    if (shapeData.length === 0) { this.#shapeDataBuffer = undefined; this.#sandCollisionBindGroup = undefined; return; }
    const requiredSize = shapeData.length * 4;
    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer = this.#device.createBuffer({ size: Math.max(requiredSize, 64), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      this.#sandCollisionBindGroup = bg(this.#device, this.#sandCollisionPipeline.getBindGroupLayout(0),
        { buffer: this.#collisionBuffer }, { buffer: this.#collisionParamsBuffer }, { buffer: this.#shapeDataBuffer });
    }
    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));
    if (this.#sandCollisionBindGroup) {
      this.#collisionParams.set([this.#simW, this.#simH, this.#shapeCount, 0]);
      this.#device.queue.writeBuffer(this.#collisionParamsBuffer, 0, this.#collisionParams);
      const encoder = this.#device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#sandCollisionPipeline);
      pass.setBindGroup(0, this.#sandCollisionBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.#simW / SAND_WORKGROUP), Math.ceil(this.#simH / SAND_WORKGROUP));
      pass.end();
      this.#device.queue.submit([encoder.finish()]);
    }
  }

  #startLoop() {
    const render = () => {
      if (!this.#isRunning) return;
      this.#renderFrame();
      this.#animationFrame = requestAnimationFrame(render);
    };
    this.#animationFrame = requestAnimationFrame(render);
  }

  #renderFrame() {
    const { width, height } = this.#canvas;
    const device = this.#device;
    const ps = this.#ps;
    const nc = this.#numCascades;
    const wg = Math.ceil(ps / 16);

    // Sand simulation (3 sub-steps)
    for (let i = 0; i < 3; i++) {
      this.#updateSandUniforms(this.#frame * 3 + i);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#sandSimPipeline);
      pass.setBindGroup(0, this.#sandSimBindGroups[this.#currentStateIndex]);
      pass.dispatchWorkgroups(Math.ceil((this.#simW + 1) / 2 / SAND_WORKGROUP), Math.ceil((this.#simH + 1) / 2 / SAND_WORKGROUP));
      pass.end();
      device.queue.submit([encoder.finish()]);
      this.#currentStateIndex = 1 - this.#currentStateIndex;
    }
    this.#frame++;

    this.#blitParamsView.set({ exposure: this.exposure, screenW: width, screenH: height });
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, this.#blitParamsView.arrayBuffer);

    // Re-upload merge params so sky color changes take effect immediately
    for (let dir = 0; dir < 4; dir++) {
      const [sa, sp] = dirScales(dir, width, height, ps);
      const aspect = sp / sa;
      for (let level = 0; level < nc; level++) {
        const numCones = 1 << level;
        this.#mergeParamsView.set({ probeSize: ps, numCones, numProbes: ps >> level, numRays: numCones + 1, nextNumCones: numCones * 2, isLastLevel: level === nc - 1 ? 1 : 0, aspect, direction: dir, isFirstDir: dir === 0 ? 1 : 0, skyR: this.skyR, skyG: this.skyG, skyB: this.skyB });
        device.queue.writeBuffer(this.#mergeParamsBuffer, (dir * nc + level) * 256, this.#mergeParamsView.arrayBuffer);
      }
    }

    const encoder = device.createCommandEncoder();

    // Decode sand state → world + material MRT
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: this.#worldTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
          { view: this.#materialTextureView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      pass.setPipeline(this.#decodePipeline);
      pass.setBindGroup(0, this.#decodeBindGroups[this.#currentStateIndex]);
      pass.draw(4);
      pass.end();
    }

    // Bounce compute
    if (!this.bounces && this.#lastFluenceResultIdx >= 0) {
      this.#lastFluenceResultIdx = -1;
      device.queue.writeTexture({ texture: this.#bounceTexture }, new Uint8Array(width * height * 8), { bytesPerRow: width * 8, rowsPerImage: height }, { width, height });
    }
    if (this.bounces && this.#lastFluenceResultIdx >= 0) {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#bounceComputePipeline);
      pass.setBindGroup(0, this.#bounceBindGroups[this.#lastFluenceResultIdx]);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }

    // Clear fluence
    for (const ft of this.#fluenceTextures) {
      encoder.copyBufferToTexture({ buffer: this.#fluenceZeroBuffer, bytesPerRow: ps * 8, rowsPerImage: ps }, { texture: ft }, { width: ps, height: ps });
    }

    // HRC cascade (4 directions)
    for (let dir = 0; dir < 4; dir++) {
      { const pass = encoder.beginComputePass(); pass.setPipeline(this.#raySeedPipeline); pass.setBindGroup(0, this.#seedBindGroups[dir]); pass.dispatchWorkgroups(wg, wg); pass.end(); }
      for (let level = 1; level < nc; level++) {
        const pass = encoder.beginComputePass(); pass.setPipeline(this.#rayExtendPipeline); pass.setBindGroup(0, this.#extendBindGroups[level - 1]);
        pass.dispatchWorkgroups(Math.ceil(((ps >> level) * ((1 << level) + 1)) / 16), wg); pass.end();
      }
      for (let k = 0; k < nc; k++) {
        const level = nc - 1 - k;
        const pass = encoder.beginComputePass(); pass.setPipeline(this.#coneMergePipeline); pass.setBindGroup(0, this.#mergeBindGroups[dir][k]);
        pass.dispatchWorkgroups(wg, Math.ceil(((ps >> level) * (1 << level)) / 16)); pass.end();
      }
    }
    this.#lastFluenceResultIdx = 1;

    // Blit
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.#context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(this.#renderPipeline);
      pass.setBindGroup(0, this.#blitBindGroups[1]);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.draw(4);
      pass.end();
    }

    device.queue.submit([encoder.finish()]);
    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
  }

  #handleResize = async () => {
    if (!this.#isRunning) return;
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);
    await this.#device.queue.onSubmittedWorkDone();
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#context.configure({ device: this.#device, format: this.#presentationFormat, alphaMode: 'premultiplied' });
    this.#initAll();
    this.#isRunning = true;
    this.#startLoop();
  };

  #onPointerDown = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.#canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.#canvas.height;
    this.#pointer = { x, y, prevX: x, prevY: y, down: true };
  };
  #onPointerMove = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
    this.#pointer.x = ((e.clientX - rect.left) / rect.width) * this.#canvas.width;
    this.#pointer.y = ((e.clientY - rect.top) / rect.height) * this.#canvas.height;
  };
  #onPointerUp = () => { this.#pointer.down = false; };
  #onKeyDown = (e: KeyboardEvent) => {
    const key = parseInt(e.key);
    if (!isNaN(key) && key >= 0 && key <= 9) {
      this.#materialType = key;
      this.onMaterialChange?.(this.#materialType);
    }
  };

  get fps() { return 0; }
  get resolution() { return { width: this.#canvas?.width ?? 0, height: this.#canvas?.height ?? 0 }; }
}
