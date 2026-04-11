// Dual Polygonal HRC — custom element for 2D global illumination.
//
// Implements Alexander Sannikov's dual polygonal radiance cascade layout:
//   1. Seed C0 from world texture (per polygon, read emissive at probe position)
//   2. Extend C0→C1→...→C_{N-1} (each polygon reads 2 source polygons)
//   3. Gather all cascades into fluence (efficient per-pixel lookup)
//   4. Cross-blur + tonemap
//
// Key differences from vanilla HRC (FolkHrcMinimal):
//   - Polygonal frustums (1:1 bands + 1:2/1:3 frustums) tile radiance field gaplessly
//   - Extensions propagate radiance through polygon connectivity, not ray compositing
//   - Gather sums polygon contributions with Chebyshev-distance falloff
//   - No occlusion in this version (radiance only, no transmittance)
//
// Polygon layout (per cascade n, in rotated coordinates):
//   - line_spacing = 1 << n, dirs_count = 1 << n
//   - Lines at pi = 0, ls, 2*ls, ...
//   - Even lines: "extended" (stride=2), odd lines: stride=1
//   - Each polygon indexed by (line_idx, probe_idx, dir_idx, is_frustum)
//   - Atlas: width = probeCount * 2, height = probeCount (constant across cascades)
//   - Two types per direction: frustum (expanding 1→2 or 1→3) and band (constant 1→1)

import { css, property, ReactiveElement, type CSSResultGroup, type PropertyValues } from '@folkjs/dom/ReactiveElement';

const WG = [16, 16] as const;

// ── Shared WGSL ──

const wgslCommon = (ps: number) => /* wgsl */ `
const PS: u32 = ${ps}u;
const PS2: u32 = ${ps * 2}u;  // atlas width = probeCount * 2
const PSf: f32 = ${ps}.0;

struct Params { ps: u32, rotation: u32, cascade_idx: u32, num_cascades: u32 };

fn rotateCoord(pi: i32, si: i32, ps: i32, rot: u32) -> vec2i {
  // Rotations 0-3: polygons fan in +si direction (covers 0° to 45° of each quadrant)
  // Rotations 4-7: mirror si (covers -45° to 0° of each quadrant)
  switch (rot) {
    case 0u: { return vec2i(pi, si); }
    case 1u: { return vec2i(si, pi); }
    case 2u: { return vec2i(ps - 1 - pi, si); }
    case 3u: { return vec2i(si, ps - 1 - pi); }
    case 4u: { return vec2i(pi, ps - 1 - si); }
    case 5u: { return vec2i(ps - 1 - si, pi); }
    case 6u: { return vec2i(ps - 1 - pi, ps - 1 - si); }
    case 7u: { return vec2i(ps - 1 - si, ps - 1 - pi); }
    default: { return vec2i(pi, si); }
  }
}

fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

// Polygon coverage: returns x_ratio in [0,1] if pos is inside, -1 otherwise
fn polyFunc(pos: vec2f, lx: f32, ly: vec2f, rx: f32, ry: vec2f) -> f32 {
  if (pos.x >= lx && pos.x < rx) {
    let t = (pos.x - lx) / (rx - lx);
    let yr = mix(ly, ry, vec2f(t));
    if (pos.y >= yr.x && pos.y < yr.y) { return t; }
  }
  return -1.0;
}

fn probeFunc(pos: vec2f, line_idx: i32, probe_idx: i32, dir_idx: i32,
             is_frustum: bool, line_spacing: u32) -> f32 {
  let ls = f32(line_spacing);
  let pf = f32(probe_idx);
  let df = f32(dir_idx);
  let lx = f32(line_idx) * ls;
  let ly = vec2f(pf, pf + 1.0);
  let ext = (line_idx & 1) == 0;
  let stride = select(1, 2, ext);
  let sf = f32(stride);
  let rx = f32(line_idx + stride) * ls;
  var wmax: f32;
  if (is_frustum) { wmax = select(2.0, 3.0, ext); } else { wmax = 1.0; }
  let ry = vec2f(pf + df * sf, pf + df * sf + wmax);
  return polyFunc(pos, lx, ly, rx, ry);
}

fn atlasIdx(line_idx: i32, probe_idx: i32, dir_idx: i32, is_frustum: bool, dirs_count: u32) -> i32 {
  let x = line_idx * i32(dirs_count * 2u) + select(i32(dirs_count), 0, is_frustum) + dir_idx;
  let y = probe_idx;
  if (x < 0 || x >= i32(PS2) || y < 0 || y >= i32(PS)) { return -1; }
  return y * i32(PS2) + x;
}

fn falloffRange(n: u32) -> vec2f {
  return vec2f(1.0) / vec2f(f32(1u << n), f32(1u << (n + 1u)));
}
`;

// ── Seed Shader ──
// For each C0 polygon, read world texture at the probe's rotated position.
const seedShader = (ps: number) =>
  wgslCommon(ps) +
  /* wgsl */ `
@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> cascade: array<vec4f>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let tx = i32(gid.x); let ty = i32(gid.y);
  if (tx >= i32(PS2) || ty >= i32(PS)) { return; }

  // C0: line_spacing=1, dirs_count=1
  let dc = 1u;
  let line_idx = tx / i32(dc * 2u);
  let rem = tx % i32(dc * 2u);
  let is_frustum = rem < i32(dc);
  let probe_idx = ty;
  let pi = line_idx;  // in rotated coords, pi = line_idx for C0 (ls=1)
  let si = probe_idx;

  let px = rotateCoord(pi, si, i32(PS), params.rotation);
  var rad = vec3f(0.0);
  if (px.x >= 0 && px.y >= 0 && px.x < i32(PS) && px.y < i32(PS)) {
    let world = textureLoad(worldTex, px, 0);
    let rgb = srgbToLinear(world.rgb);
    rad = rgb * world.a;
  }

  cascade[ty * i32(PS2) + tx] = vec4f(rad, 0.0);
}
`;

// ── Extend Shader ──
// Each polygon at cascade n+1 reads 2 polygons from cascade n.
// Connectivity from Alexander's PolygonalHRC45 ExtendCascade.
const extendShader = (ps: number) =>
  wgslCommon(ps) +
  /* wgsl */ `
@group(0) @binding(0) var<storage, read> src: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec4f>;
@group(0) @binding(2) var<uniform> params: Params;

fn readSrc(li: i32, pi: i32, di: i32, is_f: bool, dc: u32) -> vec4f {
  let i = atlasIdx(li, pi, di, is_f, dc);
  if (i < 0 || i >= i32(PS * PS2)) { return vec4f(0.0); }
  return src[i];
}

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let tx = i32(gid.x); let ty = i32(gid.y);
  if (tx >= i32(PS2) || ty >= i32(PS)) { return; }

  let dst_n = params.cascade_idx;
  let dst_dc = 1u << dst_n;
  let src_dc = 1u << (dst_n - 1u);

  let line_idx = tx / i32(dst_dc * 2u);
  let rem = tx % i32(dst_dc * 2u);
  let is_f = rem < i32(dst_dc);
  let dir_idx = rem % i32(dst_dc);
  let pi = ty;

  var res = vec4f(0.0);

  if (is_f) {
    // Frustum: read from 2 src lines
    {
      let sl = line_idx * 2 - 2;
      let sd = dir_idx / 2;
      if ((dir_idx & 1) == 0) {
        res += readSrc(sl, pi - dir_idx, sd, true, src_dc);
      } else {
        res += readSrc(sl, pi - dir_idx - 1, sd, true, src_dc);
      }
    }
    {
      let sl = line_idx * 2 - 1;
      let sd = dir_idx / 2;
      res += readSrc(sl, pi - sd, sd, true, src_dc);
    }
  } else {
    // Band: read from 2 src lines (asymmetric)
    {
      let sl = line_idx * 2 - 2;
      let sd = dir_idx / 2;
      if ((dir_idx & 1) == 1) {
        res += readSrc(sl, pi - dir_idx, sd, true, src_dc);
      } else {
        res += readSrc(sl, pi - dir_idx, sd, false, src_dc);
      }
    }
    if ((dir_idx & 1) == 0) {
      let sl = line_idx * 2 - 1;
      let sd = dir_idx / 2;
      res += readSrc(sl, pi - sd, sd, false, src_dc);
    }
  }

  dst[ty * i32(PS2) + tx] = res;
}
`;

// ── Gather Shader ──
// Efficient per-pixel: for each cascade, compute covering line, then iterate
// over directions and find the covering probe. O(dirs_count) per cascade.
// Accumulates into fluence with 1px offset (matching vanilla HRC).
const gatherShader = (ps: number, nc: number) =>
  wgslCommon(ps) +
  /* wgsl */ `
${Array.from({ length: nc }, (_, i) => `@group(0) @binding(${i}) var<storage, read> c${i}: array<vec4f>;`).join('\n')}
@group(0) @binding(${nc}) var<storage, read_write> fluence: array<vec4f>;
@group(0) @binding(${nc + 1}) var<uniform> params: Params;

fn readC(n: u32, i: i32) -> vec4f {
  if (i < 0 || i >= i32(PS * PS2)) { return vec4f(0.0); }
  ${Array.from({ length: nc }, (_, i) => `if (n == ${i}u) { return c${i}[i]; }`).join('\n  ')}
  return vec4f(0.0);
}

fn gatherLine(pos: vec2f, si: f32, line_idx: i32, n: u32, dc: u32, ls: u32) -> vec3f {
  let ext = (line_idx & 1) == 0;
  let stride = select(1, 2, ext);
  let left_x = f32(line_idx * i32(ls));
  let right_x = f32((line_idx + stride) * i32(ls));
  if (pos.x < left_x || pos.x >= right_x) { return vec3f(0.0); }
  let t = (pos.x - left_x) / (right_x - left_x);
  let fo = falloffRange(n);

  var result = vec3f(0.0);
  for (var d = 0; d < i32(dc); d++) {
    let sf = f32(select(1, 2, ext));
    // Frustum
    {
      let wmax = select(2.0, 3.0, ext);
      let shifted = si - f32(d) * sf * t;
      let p = i32(floor(shifted));
      for (var pp = p; pp <= p + 1; pp++) {
        let cov = probeFunc(pos, line_idx, pp, d, true, ls);
        if (cov >= 0.0) {
          let ai = atlasIdx(line_idx, pp, d, true, dc);
          let val = readC(n, ai);
          result += val.rgb * mix(fo.x, fo.y, cov);
        }
      }
    }
    // Band
    {
      let shifted = si - f32(d) * sf * t;
      let p = i32(floor(shifted));
      for (var pp = p; pp <= p + 1; pp++) {
        let cov = probeFunc(pos, line_idx, pp, d, false, ls);
        if (cov >= 0.0) {
          let ai = atlasIdx(line_idx, pp, d, false, dc);
          let val = readC(n, ai);
          result += val.rgb * mix(fo.x, fo.y, cov);
        }
      }
    }
  }
  return result;
}

@compute @workgroup_size(${WG[0]}, ${WG[1]})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let pi = i32(gid.x); let si = i32(gid.y);
  if (pi >= i32(PS) || si >= i32(PS)) { return; }

  let pos = vec2f(f32(pi) + 0.5, f32(si) + 0.5);
  var total = vec3f(0.0);

  for (var n = 0u; n < ${nc}u; n++) {
    let ls = 1u << n;
    let dc = 1u << n;
    let line_idx = pi / i32(ls);

    total += gatherLine(pos, f32(si) + 0.5, line_idx, n, dc, ls);

    // If odd line, also check the even (extended) line
    if ((line_idx & 1) == 1) {
      total += gatherLine(pos, f32(si) + 0.5, line_idx - 1, n, dc, ls);
    }
  }

  // Write to fluence with 1px offset (Algorithm 1 line 20)
  let fc = rotateCoord(pi - 1, si, i32(PS), params.rotation);
  if (fc.x >= 0 && fc.x < i32(PS) && fc.y >= 0 && fc.y < i32(PS)) {
    let fi = fc.y * i32(PS) + fc.x;
    fluence[fi] = vec4f(fluence[fi].rgb + total, 0.0);
  }
}
`;

// ── Fluence blur (same as vanilla HRC, Eq. 21) ──
const fluenceBlurShader = (ps: number) => /* wgsl */ `
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

// ── Blit (same as vanilla HRC) ──
const blitShader = /* wgsl */ `
struct Params { exposure: f32, ps: f32, falseColor: f32, pad0: f32 };
fn acesTonemap(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn linearToSrgb(c: vec3f) -> vec3f { return pow(c, vec3f(1.0 / 2.2)); }
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

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
  let indirect = fluence / 6.2831853 * (1.0 - world.a);
  let hdr = emissive + indirect;
  return vec4f(linearToSrgb(acesTonemap(hdr * params.exposure)), 1.0);
}
`;

// ── WebGPU helpers ──
const TEX_RENDER = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

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
  @property({ type: Number, reflect: true, attribute: 'probe-count' }) probeCount = 64;
  @property({ type: Boolean, reflect: true, attribute: 'false-color' }) falseColor = false;

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

  // Polygonal cascade buffers (reused across rotations)
  #cascadeBuffers!: GPUBuffer[];
  #fluenceBuffer!: GPUBuffer;
  #fluenceTextureView!: GPUTextureView;

  // Pipelines
  #seedPipeline!: GPUComputePipeline;
  #extendPipeline!: GPUComputePipeline;
  #gatherPipeline!: GPUComputePipeline;
  #fluenceBlurPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Bind groups (per rotation for seed/gather, per cascade transition for extend)
  #seedBindGroups!: GPUBindGroup[];
  #extendBindGroups!: GPUBindGroup[];
  #gatherBindGroups!: GPUBindGroup[];
  #fluenceBlurBindGroup!: GPUBindGroup;
  #blitBindGroup!: GPUBindGroup;
  #linearSampler!: GPUSampler;

  // Uniform buffers
  #seedParamsBuffer!: GPUBuffer;
  #extendParamsBuffers!: GPUBuffer[];
  #gatherParamsBuffer!: GPUBuffer;
  #blitParamsBuffer!: GPUBuffer;
  #fluenceBlurParamsBuffer!: GPUBuffer;

  #numCascades = 0;
  #gpuResources: (GPUTexture | GPUBuffer)[] = [];
  #blitParamsData = new Float32Array(4);
  #animationFrame = 0;
  #isRunning = false;
  #smoothedFrameTime = 0;
  #lastFrameTimestamp = 0;

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

  override async connectedCallback() {
    super.connectedCallback();
    await this.#initWebGPU();
    this.#initResources();
    this.#initPipelines();
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
      this.#initPipelines();
    }
  }

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

    // World texture
    const [worldTex, worldView] = tex(
      device,
      'World',
      ps,
      'rgba16float',
      TEX_RENDER | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    );
    this.#worldTexture = track(worldTex);
    this.#worldTextureView = worldView;

    // Cascade buffers: all same size = ps*2 * ps * 16 bytes
    const cascadeBufSize = ps * 2 * ps * 16;
    this.#cascadeBuffers = [];
    for (let n = 0; n < nc; n++) {
      this.#cascadeBuffers.push(
        track(
          device.createBuffer({
            label: `C${n}`,
            size: cascadeBufSize,
            usage: STORAGE | GPUBufferUsage.COPY_DST,
          }),
        ),
      );
    }

    // Fluence buffer
    this.#fluenceBuffer = track(
      device.createBuffer({
        label: 'Fluence',
        size: ps * ps * 16,
        usage: STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );

    // Fluence texture (for blur output + blit)
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

    // Uniform buffers
    this.#seedParamsBuffer = track(device.createBuffer({ label: 'SeedParams', size: 8 * 256, usage: UBO }));
    this.#extendParamsBuffers = [];
    for (let n = 1; n < nc; n++) {
      this.#extendParamsBuffers.push(track(device.createBuffer({ label: `ExtParams${n}`, size: 16, usage: UBO })));
    }
    this.#gatherParamsBuffer = track(device.createBuffer({ label: 'GatherParams', size: 8 * 256, usage: UBO }));
    this.#blitParamsBuffer = track(device.createBuffer({ label: 'BlitParams', size: 16, usage: UBO }));
    this.#fluenceBlurParamsBuffer = track(device.createBuffer({ label: 'BlurParams', size: 16, usage: UBO }));
  }

  #initPipelines() {
    const device = this.#device;
    const ps = this.probeCount;
    const nc = this.#numCascades;

    this.#seedPipeline = computePipeline(device, 'Seed', seedShader(ps));
    this.#extendPipeline = computePipeline(device, 'Extend', extendShader(ps));
    this.#gatherPipeline = computePipeline(device, 'Gather', gatherShader(ps, nc));
    this.#fluenceBlurPipeline = computePipeline(device, 'Blur', fluenceBlurShader(ps));

    const blitModule = device.createShaderModule({ code: blitShader });
    this.#renderPipeline = device.createRenderPipeline({
      label: 'Blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: { module: blitModule, entryPoint: 'fs', targets: [{ format: this.#presentationFormat }] },
      primitive: { topology: 'triangle-strip' },
    });

    this.#createBindGroups();
    this.#uploadStaticParams();
  }

  #createBindGroups() {
    const device = this.#device;
    const nc = this.#numCascades;

    // Seed: per rotation (4 bind groups, different params offset)
    const seedLayout = this.#seedPipeline.getBindGroupLayout(0);
    this.#seedBindGroups = [0, 1, 2, 3, 4, 5, 6, 7].map((rot) =>
      bg(
        device,
        seedLayout,
        this.#worldTextureView,
        { buffer: this.#cascadeBuffers[0] },
        { buffer: this.#seedParamsBuffer, offset: rot * 256, size: 16 },
      ),
    );

    // Extend: per cascade transition
    const extLayout = this.#extendPipeline.getBindGroupLayout(0);
    this.#extendBindGroups = [];
    for (let n = 1; n < nc; n++) {
      this.#extendBindGroups.push(
        bg(
          device,
          extLayout,
          { buffer: this.#cascadeBuffers[n - 1] },
          { buffer: this.#cascadeBuffers[n] },
          { buffer: this.#extendParamsBuffers[n - 1] },
        ),
      );
    }

    // Gather: per rotation
    const gatherLayout = this.#gatherPipeline.getBindGroupLayout(0);
    this.#gatherBindGroups = [0, 1, 2, 3, 4, 5, 6, 7].map((rot) => {
      const resources: GPUBindingResource[] = [
        ...this.#cascadeBuffers.map((b) => ({ buffer: b })),
        { buffer: this.#fluenceBuffer },
        { buffer: this.#gatherParamsBuffer, offset: rot * 256, size: 16 },
      ];
      return bg(device, gatherLayout, ...resources);
    });

    // Blur
    this.#fluenceBlurBindGroup = bg(
      device,
      this.#fluenceBlurPipeline.getBindGroupLayout(0),
      { buffer: this.#fluenceBuffer },
      this.#fluenceTextureView,
      { buffer: this.#fluenceBlurParamsBuffer },
      this.#worldTextureView,
    );

    // Blit
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

    // Seed params: per rotation (8 rotations for full 360° coverage)
    for (let rot = 0; rot < 8; rot++) {
      u4[0] = ps;
      u4[1] = rot;
      u4[2] = 0;
      u4[3] = nc;
      q.writeBuffer(this.#seedParamsBuffer, rot * 256, u4);
    }

    // Extend params: per cascade
    for (let n = 1; n < nc; n++) {
      u4[0] = ps;
      u4[1] = 0;
      u4[2] = n;
      u4[3] = nc;
      q.writeBuffer(this.#extendParamsBuffers[n - 1], 0, u4);
    }

    // Gather params: per rotation (8 rotations)
    for (let rot = 0; rot < 8; rot++) {
      u4[0] = ps;
      u4[1] = rot;
      u4[2] = 0;
      u4[3] = nc;
      q.writeBuffer(this.#gatherParamsBuffer, rot * 256, u4);
    }

    // Blur params
    u4[0] = ps;
    u4[1] = 0;
    u4[2] = 0;
    u4[3] = 0;
    q.writeBuffer(this.#fluenceBlurParamsBuffer, 0, u4);
  }

  #destroyResources() {
    this.#gpuResources.forEach((r) => r.destroy());
    this.#gpuResources = [];
  }

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
    const wgA = Math.ceil((ps * 2) / WG[0]); // atlas width = ps*2
    const wgH = Math.ceil(ps / WG[1]); // atlas/viewport height = ps
    const wgS = Math.ceil(ps / WG[0]); // viewport width = ps

    // Upload world texture
    this.#compositeWorld();
    device.queue.copyExternalImageToTexture(
      { source: this.#compositeCanvas! },
      { texture: this.#worldTexture, premultipliedAlpha: false },
      { width: ps, height: ps },
    );

    // Update blit params
    const f = this.#blitParamsData;
    f[0] = this.exposure;
    f[1] = ps;
    f[2] = this.falseColor ? 1.0 : 0.0;
    f[3] = 0;
    device.queue.writeBuffer(this.#blitParamsBuffer, 0, f);

    const encoder = device.createCommandEncoder();

    // Clear fluence
    encoder.clearBuffer(this.#fluenceBuffer);

    // Process 8 rotations (4 quadrants × 2 halves for full 360°)
    for (let rot = 0; rot < 8; rot++) {
      this.#runCascade(encoder, rot, wgA, wgH, wgS);
    }

    // Cross-blur
    computePass(encoder, this.#fluenceBlurPipeline, this.#fluenceBlurBindGroup, wgS, wgH);

    // Blit
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

  #runCascade(encoder: GPUCommandEncoder, rot: number, wgA: number, wgH: number, wgS: number) {
    const nc = this.#numCascades;

    // Clear all cascade buffers
    for (const buf of this.#cascadeBuffers) encoder.clearBuffer(buf);

    // Phase 1: Seed C0
    computePass(encoder, this.#seedPipeline, this.#seedBindGroups[rot], wgA, wgH);

    // Phase 2: Extend C0→C1→...→C_{N-1}
    for (let n = 0; n < nc - 1; n++) {
      computePass(encoder, this.#extendPipeline, this.#extendBindGroups[n], wgA, wgH);
    }

    // Phase 3: Gather all cascades into fluence
    computePass(encoder, this.#gatherPipeline, this.#gatherBindGroups[rot], wgS, wgH);
  }
}
