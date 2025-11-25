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

  // State storage buffers (ping-pong) and collision buffer
  #stateBuffers: GPUBuffer[] = [];
  #collisionBuffer!: GPUBuffer;
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

  #createBuffer(size: number, type: 'uniform' | 'storage' | 'storage-rw'): GPUBuffer {
    const usage = {
      uniform: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      storage: GPUBufferUsage.STORAGE,
      'storage-rw': GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }[type];
    const buffer = this.#device.createBuffer({ size, usage });
    this.#resources.push(buffer);
    return buffer;
  }

  #createBindGroup(pipeline: GPUComputePipeline | GPURenderPipeline, buffers: GPUBuffer[]): GPUBindGroup {
    return this.#device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map((buffer, i) => ({ binding: i, resource: { buffer } })),
    });
  }

  #stateBufferSize() {
    return this.#bufferWidth * this.#bufferHeight * 8; // Particle struct: 2 x u32
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

  // Block-based dispatch: each thread processes one 2x2 Margolus block
  // +1 ensures coverage when offset is (1,1) - rightmost/bottommost pixels still get processed
  #runSimulation(bindGroup: GPUBindGroup) {
    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.#simulationPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil((this.#bufferWidth + 1) / 2 / WORKGROUP_SIZE),
      Math.ceil((this.#bufferHeight + 1) / 2 / WORKGROUP_SIZE),
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
    this.#paramsBuffer = this.#createBuffer(32, 'uniform');
    this.#mouseBuffer = this.#createBuffer(16, 'uniform');
    this.#collisionParamsBuffer = this.#createBuffer(16, 'uniform');

    const stateSize = this.#stateBufferSize();
    this.#stateBuffers = [this.#createBuffer(stateSize, 'storage'), this.#createBuffer(stateSize, 'storage')];
    this.#collisionBuffer = this.#createBuffer(stateSize, 'storage');
  }

  #createBindGroups() {
    this.#initBindGroup = this.#createBindGroup(this.#initPipeline, [this.#stateBuffers[0], this.#paramsBuffer]);

    this.#simBindGroups = [0, 1].map((i) =>
      this.#createBindGroup(this.#simulationPipeline, [
        this.#stateBuffers[i],
        this.#stateBuffers[1 - i],
        this.#collisionBuffer,
        this.#paramsBuffer,
        this.#mouseBuffer,
      ]),
    ) as [GPUBindGroup, GPUBindGroup];

    this.#renderBindGroups = [0, 1].map((i) =>
      this.#createBindGroup(this.#renderPipeline, [this.#stateBuffers[i], this.#paramsBuffer]),
    ) as [GPUBindGroup, GPUBindGroup];

    this.#updateCollisionBindGroup();
    this.#bindGroupsDirty = false;
  }

  #updateCollisionBindGroup() {
    if (!this.#shapeDataBuffer) {
      this.#collisionBindGroup = undefined;
      return;
    }
    this.#collisionBindGroup = this.#createBindGroup(this.#collisionPipeline, [
      this.#collisionBuffer,
      this.#collisionParamsBuffer,
      this.#shapeDataBuffer,
    ]);
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
      this.#runSimulation(this.#simBindGroups[this.#currentStateIndex]);
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

      // Recreate buffers (old ones stay in #resources for cleanup)
      const stateSize = this.#stateBufferSize();
      this.#stateBuffers = [this.#createBuffer(stateSize, 'storage'), this.#createBuffer(stateSize, 'storage')];
      this.#collisionBuffer = this.#createBuffer(stateSize, 'storage');
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

    // Resize buffer if needed, and update collision bind group
    const requiredSize = shapeData.length * 4;
    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer = this.#createBuffer(Math.max(requiredSize, 64), 'storage-rw');
      this.#updateCollisionBindGroup();
    }

    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));

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

const wgslUtils = /*wgsl*/ `
fn getIndex(x: u32, y: u32, width: u32) -> u32 {
  return y * width + x;
}

fn getIndexI(p: vec2i, width: u32) -> u32 {
  return u32(p.y) * width + u32(p.x);
}

fn inBounds(p: vec2i, width: u32, height: u32) -> bool {
  return p.x >= 0 && p.y >= 0 && p.x < i32(width) && p.y < i32(height);
}
`;

const particleDefs = /*wgsl*/ `
const AIR: u32 = 0u;
const SMOKE: u32 = 1u;
const WATER: u32 = 2u;
const LAVA: u32 = 3u;
const SAND: u32 = 4u;
const STONE: u32 = 5u;
const WALL: u32 = 6u;
const COLLISION: u32 = 99u;

struct Particle {
  ptype: u32,
  rand: u32,
}

fn particle(ptype: u32, rand: u32) -> Particle {
  return Particle(ptype, rand);
}
`;

const initShader = /*wgsl*/ `
${paramsStruct}
${particleDefs}
${hashFunctions}
${wgslUtils}

@group(0) @binding(0) var<storage, read_write> output: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= params.width || gid.y >= params.height) { return; }
  
  let r = hash12(vec2f(gid.xy));
  let ptype = select(AIR, SAND, r < params.initialSand);
  let rand = u32(hash12(vec2f(gid.xy) + 0.5) * 255.0);
  
  output[getIndex(gid.x, gid.y, params.width)] = particle(ptype, rand);
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

@group(0) @binding(0) var<storage, read_write> collision: array<u32>;
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
  
  collision[gid.y * params.width + gid.x] = isCollision;
}
`;

const simulationShader = /*wgsl*/ `
${paramsStruct}
${mouseStruct}
${particleDefs}
${hashFunctions}
${wgslUtils}

@group(0) @binding(0) var<storage, read> input: array<Particle>;
@group(0) @binding(1) var<storage, read_write> output: array<Particle>;
@group(0) @binding(2) var<storage, read> collision: array<u32>;
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

fn isCollision(p: vec2i) -> bool {
  if (!inBounds(p, params.width, params.height)) { return false; }
  return collision[getIndexI(p, params.width)] > 0u;
}

fn writeIfInBounds(p: vec2i, val: Particle) {
  if (inBounds(p, params.width, params.height)) {
    output[getIndexI(p, params.width)] = val;
  }
}

// Block-based: each thread processes one 2x2 Margolus block
@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let offset = getOffset(params.frame);
  let p = vec2i(gid.xy) * 2 - offset;
  
  // Load block (getData handles out-of-bounds → WALL)
  var t00 = getData(p);
  var t10 = getData(p + vec2i(1, 0));
  var t01 = getData(p + vec2i(0, 1));
  var t11 = getData(p + vec2i(1, 1));
  let tn00 = getData(p + vec2i(0, -1));
  let tn10 = getData(p + vec2i(1, -1));
  
  // Mouse input - apply to each cell before physics
  if (mouse.x > 0.0) {
    let m = vec2f(mouse.x, mouse.y);
    let mp = vec2f(mouse.prevX, mouse.prevY);
    if (sdSegment(vec2f(p), m, mp) < params.brushRadius) {
      t00 = newParticle(params.materialType, p, params.frame);
    }
    if (sdSegment(vec2f(p + vec2i(1, 0)), m, mp) < params.brushRadius) {
      t10 = newParticle(params.materialType, p + vec2i(1, 0), params.frame);
    }
    if (sdSegment(vec2f(p + vec2i(0, 1)), m, mp) < params.brushRadius) {
      t01 = newParticle(params.materialType, p + vec2i(0, 1), params.frame);
    }
    if (sdSegment(vec2f(p + vec2i(1, 1)), m, mp) < params.brushRadius) {
      t11 = newParticle(params.materialType, p + vec2i(1, 1), params.frame);
    }
  }
  
  // Physics (skip if uniform block)
  if (!(t00.ptype == t10.ptype && t01.ptype == t11.ptype && t00.ptype == t01.ptype)) {
    let r = hash44(vec4f(vec2f(p), f32(params.frame), 0.0));
    
    // SMOKE
    if (t00.ptype == SMOKE) {
      if (t01.ptype < SMOKE && r.y < 0.25) { let tmp = t00; t00 = t01; t01 = tmp; }
      else if (r.z < 0.003) { t00 = newParticle(AIR, p, params.frame); }
    }
    if (t10.ptype == SMOKE) {
      if (t11.ptype < SMOKE && r.y < 0.25) { let tmp = t10; t10 = t11; t11 = tmp; }
      else if (r.z < 0.003) { t10 = newParticle(AIR, p + vec2i(1, 0), params.frame); }
    }
    if ((t01.ptype == SMOKE && t11.ptype < SMOKE) || (t01.ptype < SMOKE && t11.ptype == SMOKE)) {
      if (r.x < 0.25) { let tmp = t01; t01 = t11; t11 = tmp; }
    }
    
    // SAND
    if (((t01.ptype == SAND && t11.ptype < SAND) || (t01.ptype < SAND && t11.ptype == SAND)) && t00.ptype < SAND && t10.ptype < SAND && r.x < 0.4) {
      let tmp = t01; t01 = t11; t11 = tmp;
    }
    if (t01.ptype == SAND || t01.ptype == STONE) {
      if (t00.ptype < SAND && t00.ptype != WATER && t00.ptype != LAVA && r.y < 0.9) { let tmp = t01; t01 = t00; t00 = tmp; }
      else if (t00.ptype == WATER && r.y < 0.3) { let tmp = t01; t01 = t00; t00 = tmp; }
      else if (t00.ptype == LAVA && r.y < 0.15) { let tmp = t01; t01 = t00; t00 = tmp; }
      else if (t11.ptype < SAND && t10.ptype < SAND) { let tmp = t01; t01 = t10; t10 = tmp; }
    }
    if (t11.ptype == SAND || t11.ptype == STONE) {
      if (t10.ptype < SAND && t10.ptype != WATER && t10.ptype != LAVA && r.y < 0.9) { let tmp = t11; t11 = t10; t10 = tmp; }
      else if (t10.ptype == WATER && r.y < 0.3) { let tmp = t11; t11 = t10; t10 = tmp; }
      else if (t10.ptype == LAVA && r.y < 0.15) { let tmp = t11; t11 = t10; t10 = tmp; }
      else if (t01.ptype < SAND && t00.ptype < SAND) { let tmp = t11; t11 = t00; t00 = tmp; }
    }
    
    // WATER
    var drop = false;
    if (t01.ptype == WATER) {
      if (t00.ptype < WATER && r.y < 0.95) { let tmp = t01; t01 = t00; t00 = tmp; drop = true; }
      else if (t11.ptype < WATER && t10.ptype < WATER && r.z < 0.3) { let tmp = t01; t01 = t10; t10 = tmp; drop = true; }
    }
    if (t11.ptype == WATER) {
      if (t10.ptype < WATER && r.y < 0.95) { let tmp = t11; t11 = t10; t10 = tmp; drop = true; }
      else if (t01.ptype < WATER && t00.ptype < WATER && r.z < 0.3) { let tmp = t11; t11 = t00; t00 = tmp; drop = true; }
    }
    if (!drop) {
      if ((t01.ptype == WATER && t11.ptype < WATER) || (t01.ptype < WATER && t11.ptype == WATER)) {
        if ((t00.ptype >= WATER && t10.ptype >= WATER) || r.w < 0.8) { let tmp = t01; t01 = t11; t11 = tmp; }
      }
      if ((t00.ptype == WATER && t10.ptype < WATER) || (t00.ptype < WATER && t10.ptype == WATER)) {
        if ((tn00.ptype >= WATER && tn10.ptype >= WATER) || r.w < 0.8) { let tmp = t00; t00 = t10; t10 = tmp; }
      }
    }
    
    // LAVA
    if (t01.ptype == LAVA) {
      if (t00.ptype < LAVA && r.y < 0.8) { let tmp = t01; t01 = t00; t00 = tmp; }
      else if (t11.ptype < LAVA && t10.ptype < LAVA && r.z < 0.2) { let tmp = t01; t01 = t10; t10 = tmp; }
    }
    if (t11.ptype == LAVA) {
      if (t10.ptype < LAVA && r.y < 0.8) { let tmp = t11; t11 = t10; t10 = tmp; }
      else if (t01.ptype < LAVA && t00.ptype < LAVA && r.z < 0.2) { let tmp = t11; t11 = t00; t00 = tmp; }
    }
    
    // Lava + Water reactions
    if (t00.ptype == LAVA) {
      if (t01.ptype == WATER) { t00 = newParticle(STONE, p, params.frame); t01 = newParticle(SMOKE, p + vec2i(0, 1), params.frame); }
      else if (t10.ptype == WATER) { t00 = newParticle(STONE, p, params.frame); t10 = newParticle(SMOKE, p + vec2i(1, 0), params.frame); }
    }
    if (t10.ptype == LAVA) {
      if (t11.ptype == WATER) { t10 = newParticle(STONE, p + vec2i(1, 0), params.frame); t11 = newParticle(SMOKE, p + vec2i(1, 1), params.frame); }
      else if (t00.ptype == WATER) { t10 = newParticle(STONE, p + vec2i(1, 0), params.frame); t00 = newParticle(SMOKE, p, params.frame); }
    }
    if ((t01.ptype == LAVA && t11.ptype < LAVA) || (t01.ptype < LAVA && t11.ptype == LAVA)) {
      if (r.x < 0.6) { let tmp = t01; t01 = t11; t11 = tmp; }
    }
  }
  
  // Collision cleanup - particles becoming air when collision removed
  if (t00.ptype == COLLISION && !isCollision(p)) { t00 = newParticle(AIR, p, params.frame); }
  if (t10.ptype == COLLISION && !isCollision(p + vec2i(1, 0))) { t10 = newParticle(AIR, p + vec2i(1, 0), params.frame); }
  if (t01.ptype == COLLISION && !isCollision(p + vec2i(0, 1))) { t01 = newParticle(AIR, p + vec2i(0, 1), params.frame); }
  if (t11.ptype == COLLISION && !isCollision(p + vec2i(1, 1))) { t11 = newParticle(AIR, p + vec2i(1, 1), params.frame); }
  
  // Write only in-bounds cells
  writeIfInBounds(p, t00);
  writeIfInBounds(p + vec2i(1, 0), t10);
  writeIfInBounds(p + vec2i(0, 1), t01);
  writeIfInBounds(p + vec2i(1, 1), t11);
}
`;

const renderShader = /*wgsl*/ `
${paramsStruct}
${particleDefs}
${wgslUtils}

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

@group(0) @binding(0) var<storage, read> state: array<Particle>;
@group(0) @binding(1) var<uniform> params: Params;

const bgColor = vec3f(0.12, 0.133, 0.141);

fn getParticleColor(p: Particle) -> vec3f {
  let r = f32(p.rand) / 255.0;
  switch p.ptype {
    case AIR:       { return bgColor; }
    case SMOKE:     { return mix(bgColor, vec3f(0.15), 0.4 + r * 0.2); }
    case WATER:     { return mix(bgColor, vec3f(0.2, 0.4, 0.8), 0.6 + r * 0.2); }
    case LAVA:      { return mix(vec3f(0.9, 0.3, 0.1), vec3f(1.0, 0.6, 0.2), r); }
    case SAND:      { return mix(vec3f(0.86, 0.62, 0.27), vec3f(0.82, 0.58, 0.23), r) * (0.8 + r * 0.3); }
    case STONE:     { return mix(vec3f(0.08, 0.1, 0.12), vec3f(0.12, 0.14, 0.16), r) * (0.7 + r * 0.3); }
    case WALL, COLLISION: { return bgColor * 0.5 * (r * 0.4 + 0.6); }
    default:        { return bgColor; }
  }
}

fn linearTosRGB(col: vec3f) -> vec3f {
  let cutoff = col < vec3f(0.0031308);
  return select(1.055 * pow(col, vec3f(1.0 / 2.4)) - 0.055, col * 12.92, cutoff);
}

@fragment
fn fragment_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let coord = vec2u(texCoord * vec2f(f32(params.width), f32(params.height)));
  let p = state[getIndex(coord.x, coord.y, params.width)];
  return vec4f(linearTosRGB(getParticleColor(p)), 1.0);
}
`;
