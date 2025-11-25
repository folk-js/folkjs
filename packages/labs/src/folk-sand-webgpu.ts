import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const WORKGROUP_SIZE = 8;

/**
 * WebGPU-based falling sand simulation using block cellular automata with Margolus offsets.
 * Based on "Probabilistic Cellular Automata for Granular Media in Video Games" (https://arxiv.org/abs/2008.06341)
 */
export class FolkSandWebGPU extends FolkBaseSet {
  static override tagName = 'folk-sand-webgpu';

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

  static override properties = {
    initialSand: { type: Number, attribute: 'initial-sand' },
  };

  initialSand = 0.15;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #format!: GPUTextureFormat;

  #PIXELS_PER_PARTICLE = 4;
  #bufferWidth = 0;
  #bufferHeight = 0;

  // Pipelines
  #initPipeline!: GPUComputePipeline;
  #collisionPipeline!: GPUComputePipeline;
  #simulationPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Textures (views created on demand via getter-like access in bind groups)
  #stateTextures: GPUTexture[] = [];
  #collisionTexture!: GPUTexture;
  #currentStateIndex = 0;

  // Cached bind groups
  #initBindGroup!: GPUBindGroup;
  #simBindGroups!: [GPUBindGroup, GPUBindGroup];
  #renderBindGroups!: [GPUBindGroup, GPUBindGroup];
  #collisionBindGroup?: GPUBindGroup;
  #bindGroupsDirty = true;

  // Buffers
  #paramsBuffer!: GPUBuffer;
  #mouseBuffer!: GPUBuffer;
  #collisionParamsBuffer!: GPUBuffer;
  #shapeDataBuffer?: GPUBuffer;

  // Pre-allocated uniform data
  #paramsData = new ArrayBuffer(32);
  #paramsView = new DataView(this.#paramsData);
  #mouseData = new Float32Array(4);
  #collisionParams = new Uint32Array(4);

  // Resources to destroy on cleanup
  #resources: { destroy(): void }[] = [];

  #shapeCount = 0;

  // Input state
  #pointer = { x: -1, y: -1, prevX: -1, prevY: -1, down: false };
  #materialType = 4; // SAND
  #brushRadius = 5;
  #frame = 0;
  #animationId = 0;

  onMaterialChange?: (type: number) => void;

  override async connectedCallback() {
    super.connectedCallback();

    this.#canvas = document.createElement('canvas');
    this.renderRoot.appendChild(this.#canvas);

    try {
      await this.#initWebGPU();
      this.#attachEventListeners();
      this.#render();
    } catch (e) {
      console.error('WebGPU initialization failed:', e);
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#detachEventListeners();
    cancelAnimationFrame(this.#animationId);
    this.#resources.forEach((r) => r.destroy());
  }

  // === Helpers ===

  #createComputePipeline(code: string): GPUComputePipeline {
    return this.#device.createComputePipeline({
      layout: 'auto',
      compute: { module: this.#device.createShaderModule({ code }), entryPoint: 'main' },
    });
  }

  #createBuffer(size: number, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.#device.createBuffer({ size, usage });
    this.#resources.push(buffer);
    return buffer;
  }

  #createTexture(format: GPUTextureFormat): GPUTexture {
    const texture = this.#device.createTexture({
      size: { width: this.#bufferWidth, height: this.#bufferHeight },
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#resources.push(texture);
    return texture;
  }

  #runCompute(pipeline: GPUComputePipeline, bindGroup: GPUBindGroup) {
    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.#bufferWidth / WORKGROUP_SIZE),
      Math.ceil(this.#bufferHeight / WORKGROUP_SIZE),
    );
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
  }

  // === Initialization ===

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');

    this.#device = await adapter.requestDevice();
    this.#context = this.#canvas.getContext('webgpu')!;
    this.#format = navigator.gpu.getPreferredCanvasFormat();

    this.#canvas.width = this.clientWidth * devicePixelRatio;
    this.#canvas.height = this.clientHeight * devicePixelRatio;
    this.#context.configure({ device: this.#device, format: this.#format, alphaMode: 'premultiplied' });

    this.#bufferWidth = Math.ceil(this.#canvas.width / this.#PIXELS_PER_PARTICLE);
    this.#bufferHeight = Math.ceil(this.#canvas.height / this.#PIXELS_PER_PARTICLE);

    this.#createPipelines();
    this.#createResources();
    this.#createBindGroups();

    this.#updateUniforms(0);
    this.#runCompute(this.#initPipeline, this.#initBindGroup);
  }

  #createPipelines() {
    this.#initPipeline = this.#createComputePipeline(initShader);
    this.#collisionPipeline = this.#createComputePipeline(collisionShader);
    this.#simulationPipeline = this.#createComputePipeline(simulationShader);

    this.#renderPipeline = this.#device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.#device.createShaderModule({ code: renderShader }), entryPoint: 'vertex_main' },
      fragment: {
        module: this.#device.createShaderModule({ code: renderShader }),
        entryPoint: 'fragment_main',
        targets: [{ format: this.#format }],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  #createResources() {
    this.#paramsBuffer = this.#createBuffer(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.#mouseBuffer = this.#createBuffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.#collisionParamsBuffer = this.#createBuffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

    this.#stateTextures = [this.#createTexture('rgba8uint'), this.#createTexture('rgba8uint')];
    this.#collisionTexture = this.#createTexture('r32uint');
  }

  #createBindGroups() {
    const stateViews = this.#stateTextures.map((t) => t.createView());
    const collisionView = this.#collisionTexture.createView();

    this.#initBindGroup = this.#device.createBindGroup({
      layout: this.#initPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: stateViews[0] },
        { binding: 1, resource: { buffer: this.#paramsBuffer } },
      ],
    });

    this.#simBindGroups = [0, 1].map((i) =>
      this.#device.createBindGroup({
        layout: this.#simulationPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: stateViews[i] },
          { binding: 1, resource: stateViews[1 - i] },
          { binding: 2, resource: collisionView },
          { binding: 3, resource: { buffer: this.#paramsBuffer } },
          { binding: 4, resource: { buffer: this.#mouseBuffer } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];

    this.#renderBindGroups = [0, 1].map((i) =>
      this.#device.createBindGroup({
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: stateViews[i] },
          { binding: 1, resource: { buffer: this.#paramsBuffer } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];

    if (this.#shapeDataBuffer) {
      this.#collisionBindGroup = this.#device.createBindGroup({
        layout: this.#collisionPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: collisionView },
          { binding: 1, resource: { buffer: this.#collisionParamsBuffer } },
          { binding: 2, resource: { buffer: this.#shapeDataBuffer } },
        ],
      });
    }

    this.#bindGroupsDirty = false;
  }

  // === Uniform Updates ===

  #updateUniforms(frame: number) {
    const v = this.#paramsView;
    const { x, y, prevX, prevY, down } = this.#pointer;

    // Params
    v.setUint32(0, this.#bufferWidth, true);
    v.setUint32(4, this.#bufferHeight, true);
    v.setUint32(8, frame, true);
    v.setUint32(12, this.#materialType, true);
    v.setFloat32(16, this.#brushRadius, true);
    v.setFloat32(20, this.initialSand, true);
    this.#device.queue.writeBuffer(this.#paramsBuffer, 0, this.#paramsData);

    // Mouse
    const mx = (x / this.#canvas.width) * this.#bufferWidth;
    const my = (1 - y / this.#canvas.height) * this.#bufferHeight;
    const mpx = (prevX / this.#canvas.width) * this.#bufferWidth;
    const mpy = (1 - prevY / this.#canvas.height) * this.#bufferHeight;
    this.#mouseData[0] = down ? mx : -1;
    this.#mouseData[1] = down ? my : -1;
    this.#mouseData[2] = down ? mpx : -1;
    this.#mouseData[3] = down ? mpy : -1;
    this.#device.queue.writeBuffer(this.#mouseBuffer, 0, this.#mouseData);
  }

  // === Render Loop ===

  #render = () => {
    this.#animationId = requestAnimationFrame(this.#render);

    // Handle resize
    const width = this.clientWidth * devicePixelRatio;
    const height = this.clientHeight * devicePixelRatio;
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#handleResize(width, height);
    }

    if (this.#bindGroupsDirty) this.#createBindGroups();

    // Run 3 simulation passes per frame (each needs separate submit for uniform sync)
    for (let i = 0; i < 3; i++) {
      this.#updateUniforms(this.#frame * 3 + i);
      this.#runCompute(this.#simulationPipeline, this.#simBindGroups[this.#currentStateIndex]);
      this.#currentStateIndex = 1 - this.#currentStateIndex;
    }
    this.#frame++;

    // Render
    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          clearValue: { r: 0.12, g: 0.13, b: 0.14, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(this.#renderPipeline);
    pass.setBindGroup(0, this.#renderBindGroups[this.#currentStateIndex]);
    pass.draw(4);
    pass.end();
    this.#device.queue.submit([encoder.finish()]);

    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
  };

  #handleResize(width: number, height: number) {
    this.#canvas.width = width;
    this.#canvas.height = height;
    this.#context.configure({ device: this.#device, format: this.#format, alphaMode: 'premultiplied' });

    const newW = Math.ceil(width / this.#PIXELS_PER_PARTICLE);
    const newH = Math.ceil(height / this.#PIXELS_PER_PARTICLE);

    if (newW !== this.#bufferWidth || newH !== this.#bufferHeight) {
      this.#bufferWidth = newW;
      this.#bufferHeight = newH;

      // Recreate textures (old ones stay in #resources for cleanup)
      this.#stateTextures = [this.#createTexture('rgba8uint'), this.#createTexture('rgba8uint')];
      this.#collisionTexture = this.#createTexture('r32uint');
      this.#currentStateIndex = 0;

      this.#createBindGroups();
      this.#updateUniforms(0);
      this.#runCompute(this.#initPipeline, this.#initBindGroup);
      this.#updateCollisionTexture();
    }
  }

  // === Collision Detection ===

  #updateCollisionTexture() {
    if (!this.#device) return;

    // Collect shape data
    const shapeData: number[] = [];
    this.sourceRects.forEach((rect) => {
      shapeData.push(
        rect.left / this.clientWidth,
        1 - rect.bottom / this.clientHeight,
        rect.right / this.clientWidth,
        1 - rect.top / this.clientHeight,
      );
    });
    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      this.#shapeDataBuffer = undefined;
      this.#collisionBindGroup = undefined;
      return;
    }

    // Resize buffer if needed
    const requiredSize = shapeData.length * 4;
    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer = this.#createBuffer(
        Math.max(requiredSize, 64),
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
      this.#bindGroupsDirty = true;
    }

    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));

    if (this.#bindGroupsDirty) this.#createBindGroups();

    if (this.#collisionBindGroup) {
      this.#collisionParams.set([this.#bufferWidth, this.#bufferHeight, this.#shapeCount, 0]);
      this.#device.queue.writeBuffer(this.#collisionParamsBuffer, 0, this.#collisionParams);
      this.#runCompute(this.#collisionPipeline, this.#collisionBindGroup);
    }
  }

  // === Event Handlers ===

  #attachEventListeners() {
    this.#canvas.addEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.addEventListener('pointermove', this.#onPointerMove);
    this.#canvas.addEventListener('pointerup', this.#onPointerUp);
    this.#canvas.addEventListener('pointerleave', this.#onPointerUp);
    document.addEventListener('keydown', this.#onKeyDown);
  }

  #detachEventListeners() {
    this.#canvas.removeEventListener('pointerdown', this.#onPointerDown);
    this.#canvas.removeEventListener('pointermove', this.#onPointerMove);
    this.#canvas.removeEventListener('pointerup', this.#onPointerUp);
    this.#canvas.removeEventListener('pointerleave', this.#onPointerUp);
    document.removeEventListener('keydown', this.#onKeyDown);
  }

  #onPointerDown = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * devicePixelRatio;
    const y = (e.clientY - rect.top) * devicePixelRatio;
    this.#pointer = { x, y, prevX: x, prevY: y, down: true };
  };

  #onPointerMove = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
    this.#pointer.x = (e.clientX - rect.left) * devicePixelRatio;
    this.#pointer.y = (e.clientY - rect.top) * devicePixelRatio;
  };

  #onPointerUp = () => {
    this.#pointer.down = false;
  };

  #onKeyDown = (e: KeyboardEvent) => {
    const key = parseInt(e.key);
    if (!isNaN(key) && key >= 0 && key <= 9) {
      this.#materialType = key;
      this.onMaterialChange?.(this.#materialType);
    }
  };

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;
    this.#updateCollisionTexture();
  }
}

// === WGSL Shaders ===

const paramsStruct = /*wgsl*/ `
struct Params {
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

const particleTypes = /*wgsl*/ `
const AIR: u32 = 0u;
const SMOKE: u32 = 1u;
const WATER: u32 = 2u;
const LAVA: u32 = 3u;
const SAND: u32 = 4u;
const STONE: u32 = 5u;
const WALL: u32 = 6u;
const COLLISION: u32 = 99u;
`;

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
}
`;

const initShader = /*wgsl*/ `
${paramsStruct}
${particleTypes}
${hashFunctions}

@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8uint, write>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  
  let r = hash12(vec2f(gid.xy));
  let particleType = select(AIR, SAND, r < params.initialSand);
  let randByte = u32(hash12(vec2f(gid.xy) + 0.5) * 255.0);
  
  textureStore(outputTex, gid.xy, vec4u(randByte, 0u, 0u, particleType));
}
`;

const collisionShader = /*wgsl*/ `
struct CollisionParams {
  width: u32,
  height: u32,
  shapeCount: u32,
  padding: u32,
}

struct Shape { minX: f32, minY: f32, maxX: f32, maxY: f32, }

@group(0) @binding(0) var collisionTex: texture_storage_2d<r32uint, write>;
@group(0) @binding(1) var<uniform> params: CollisionParams;
@group(0) @binding(2) var<storage, read> shapes: array<Shape>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  
  let pixel = vec2f(gid.xy) / vec2f(f32(params.width), f32(params.height));
  var isCollision = 0u;
  
  for (var i = 0u; i < params.shapeCount; i++) {
    let s = shapes[i];
    if (pixel.x >= s.minX && pixel.x <= s.maxX && pixel.y >= s.minY && pixel.y <= s.maxY) {
      isCollision = 1u;
      break;
    }
  }
  
  textureStore(collisionTex, gid.xy, vec4u(isCollision, 0u, 0u, 0u));
}
`;

const simulationShader = /*wgsl*/ `
${paramsStruct}
${mouseStruct}
${particleTypes}
${hashFunctions}

@group(0) @binding(0) var inputTex: texture_2d<u32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8uint, write>;
@group(0) @binding(2) var collisionTex: texture_2d<u32>;
@group(0) @binding(3) var<uniform> params: Params;
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

fn getData(p: vec2i) -> vec4u {
  if (p.x < 0 || p.y < 0 || p.x >= i32(params.width) || p.y >= i32(params.height)) {
    return vec4u(0u, 0u, 0u, WALL);
  }
  if (textureLoad(collisionTex, vec2u(p), 0).r > 0u) {
    return vec4u(0u, 0u, 0u, COLLISION);
  }
  return textureLoad(inputTex, vec2u(p), 0);
}

fn createParticle(ptype: u32, coord: vec2i, frame: u32) -> vec4u {
  let randByte = u32(hash14(vec4f(vec2f(coord), f32(frame), f32(ptype))) * 255.0);
  return vec4u(randByte, 0u, 0u, ptype);
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let coord = vec2i(gid.xy);
  if (coord.x >= i32(params.width) || coord.y >= i32(params.height)) { return; }
  
  // Mouse input
  if (mouse.x > 0.0 && sdSegment(vec2f(coord), vec2f(mouse.x, mouse.y), vec2f(mouse.prevX, mouse.prevY)) < params.brushRadius) {
    textureStore(outputTex, vec2u(coord), createParticle(params.materialType, coord, params.frame));
    return;
  }
  
  // Margolus neighborhood
  let offset = getOffset(params.frame);
  let fc = coord + offset;
  let p = (fc / 2) * 2 - offset;
  let xy = fc % 2;
  let i = xy.x + xy.y * 2;
  
  var t00 = getData(p);
  var t10 = getData(p + vec2i(1, 0));
  var t01 = getData(p + vec2i(0, 1));
  var t11 = getData(p + vec2i(1, 1));
  let tn00 = getData(p + vec2i(0, -1));
  let tn10 = getData(p + vec2i(1, -1));
  
  // Early exit if uniform
  if (t00.a == t10.a && t01.a == t11.a && t00.a == t01.a) {
    textureStore(outputTex, vec2u(coord), select(select(select(t00, t10, i == 1), t01, i == 2), t11, i == 3));
    return;
  }
  
  let r = hash44(vec4f(vec2f(p), f32(params.frame), 0.0));
  
  // SMOKE
  if (t00.a == SMOKE) {
    if (t01.a < SMOKE && r.y < 0.25) { let tmp = t00; t00 = t01; t01 = tmp; }
    else if (r.z < 0.003) { t00 = createParticle(AIR, p, params.frame); }
  }
  if (t10.a == SMOKE) {
    if (t11.a < SMOKE && r.y < 0.25) { let tmp = t10; t10 = t11; t11 = tmp; }
    else if (r.z < 0.003) { t10 = createParticle(AIR, p + vec2i(1, 0), params.frame); }
  }
  if ((t01.a == SMOKE && t11.a < SMOKE) || (t01.a < SMOKE && t11.a == SMOKE)) {
    if (r.x < 0.25) { let tmp = t01; t01 = t11; t11 = tmp; }
  }
  
  // SAND
  if (((t01.a == SAND && t11.a < SAND) || (t01.a < SAND && t11.a == SAND)) && t00.a < SAND && t10.a < SAND && r.x < 0.4) {
    let tmp = t01; t01 = t11; t11 = tmp;
  }
  if (t01.a == SAND || t01.a == STONE) {
    if (t00.a < SAND && t00.a != WATER && t00.a != LAVA && r.y < 0.9) { let tmp = t01; t01 = t00; t00 = tmp; }
    else if (t00.a == WATER && r.y < 0.3) { let tmp = t01; t01 = t00; t00 = tmp; }
    else if (t00.a == LAVA && r.y < 0.15) { let tmp = t01; t01 = t00; t00 = tmp; }
    else if (t11.a < SAND && t10.a < SAND) { let tmp = t01; t01 = t10; t10 = tmp; }
  }
  if (t11.a == SAND || t11.a == STONE) {
    if (t10.a < SAND && t10.a != WATER && t10.a != LAVA && r.y < 0.9) { let tmp = t11; t11 = t10; t10 = tmp; }
    else if (t10.a == WATER && r.y < 0.3) { let tmp = t11; t11 = t10; t10 = tmp; }
    else if (t10.a == LAVA && r.y < 0.15) { let tmp = t11; t11 = t10; t10 = tmp; }
    else if (t01.a < SAND && t00.a < SAND) { let tmp = t11; t11 = t00; t00 = tmp; }
  }
  
  // WATER
  var drop = false;
  if (t01.a == WATER) {
    if (t00.a < WATER && r.y < 0.95) { let tmp = t01; t01 = t00; t00 = tmp; drop = true; }
    else if (t11.a < WATER && t10.a < WATER && r.z < 0.3) { let tmp = t01; t01 = t10; t10 = tmp; drop = true; }
  }
  if (t11.a == WATER) {
    if (t10.a < WATER && r.y < 0.95) { let tmp = t11; t11 = t10; t10 = tmp; drop = true; }
    else if (t01.a < WATER && t00.a < WATER && r.z < 0.3) { let tmp = t11; t11 = t00; t00 = tmp; drop = true; }
  }
  if (!drop) {
    if ((t01.a == WATER && t11.a < WATER) || (t01.a < WATER && t11.a == WATER)) {
      if ((t00.a >= WATER && t10.a >= WATER) || r.w < 0.8) { let tmp = t01; t01 = t11; t11 = tmp; }
    }
    if ((t00.a == WATER && t10.a < WATER) || (t00.a < WATER && t10.a == WATER)) {
      if ((tn00.a >= WATER && tn10.a >= WATER) || r.w < 0.8) { let tmp = t00; t00 = t10; t10 = tmp; }
    }
  }
  
  // LAVA
  if (t01.a == LAVA) {
    if (t00.a < LAVA && r.y < 0.8) { let tmp = t01; t01 = t00; t00 = tmp; }
    else if (t11.a < LAVA && t10.a < LAVA && r.z < 0.2) { let tmp = t01; t01 = t10; t10 = tmp; }
  }
  if (t11.a == LAVA) {
    if (t10.a < LAVA && r.y < 0.8) { let tmp = t11; t11 = t10; t10 = tmp; }
    else if (t01.a < LAVA && t00.a < LAVA && r.z < 0.2) { let tmp = t11; t11 = t00; t00 = tmp; }
  }
  
  // Lava + Water reactions
  if (t00.a == LAVA) {
    if (t01.a == WATER) { t00 = createParticle(STONE, p, params.frame); t01 = createParticle(SMOKE, p + vec2i(0, 1), params.frame); }
    else if (t10.a == WATER) { t00 = createParticle(STONE, p, params.frame); t10 = createParticle(SMOKE, p + vec2i(1, 0), params.frame); }
  }
  if (t10.a == LAVA) {
    if (t11.a == WATER) { t10 = createParticle(STONE, p + vec2i(1, 0), params.frame); t11 = createParticle(SMOKE, p + vec2i(1, 1), params.frame); }
    else if (t00.a == WATER) { t10 = createParticle(STONE, p + vec2i(1, 0), params.frame); t00 = createParticle(SMOKE, p, params.frame); }
  }
  if ((t01.a == LAVA && t11.a < LAVA) || (t01.a < LAVA && t11.a == LAVA)) {
    if (r.x < 0.6) { let tmp = t01; t01 = t11; t11 = tmp; }
  }
  
  // Output
  var result = t00;
  if (i == 1) { result = t10; }
  else if (i == 2) { result = t01; }
  else if (i == 3) { result = t11; }
  
  if (result.a == COLLISION && textureLoad(collisionTex, vec2u(coord), 0).r == 0u) {
    result = createParticle(AIR, coord, params.frame);
  }
  
  textureStore(outputTex, vec2u(coord), result);
}
`;

const renderShader = /*wgsl*/ `
${paramsStruct}
${particleTypes}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  let pos = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  var out: VertexOutput;
  out.position = vec4f(pos, 0.0, 1.0);
  out.texCoord = pos * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var stateTex: texture_2d<u32>;
@group(0) @binding(1) var<uniform> params: Params;

const bgColor = vec3f(0.12, 0.133, 0.141);

fn getParticleColor(data: vec4u) -> vec3f {
  let rand = f32(data.r) / 255.0;
  let t = data.a;
  
  if (t == AIR) { return bgColor; }
  if (t == SMOKE) { return mix(bgColor, vec3f(0.15), 0.4 + rand * 0.2); }
  if (t == WATER) { return mix(bgColor, vec3f(0.2, 0.4, 0.8), 0.6 + rand * 0.2); }
  if (t == LAVA) { return mix(vec3f(0.9, 0.3, 0.1), vec3f(1.0, 0.6, 0.2), rand); }
  if (t == SAND) { return mix(vec3f(0.86, 0.62, 0.27), vec3f(0.82, 0.58, 0.23), rand) * (0.8 + rand * 0.3); }
  if (t == STONE) { return mix(vec3f(0.08, 0.1, 0.12), vec3f(0.12, 0.14, 0.16), rand) * (0.7 + rand * 0.3); }
  if (t == WALL || t == COLLISION) { return bgColor * 0.5 * (rand * 0.4 + 0.6); }
  return bgColor;
}

fn linearTosRGB(col: vec3f) -> vec3f {
  let cutoff = col < vec3f(0.0031308);
  return select(1.055 * pow(col, vec3f(1.0 / 2.4)) - 0.055, col * 12.92, cutoff);
}

@fragment
fn fragment_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let coord = vec2u(texCoord * vec2f(f32(params.width), f32(params.height)));
  let data = textureLoad(stateTex, coord, 0);
  return vec4f(linearTosRGB(getParticleColor(data)), 1.0);
}
`;
