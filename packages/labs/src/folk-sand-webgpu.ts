import { css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const WORKGROUP_SIZE = 8;

/**
 * WebGPU-based falling sand simulation using block cellular automata with Margolus offsets.
 * Based on "Probabilistic Cellular Automata for Granular Media in Video Games" (https://arxiv.org/abs/2008.06341)
 *
 * Simplified from WebGL2 version - no shadows/lighting, fewer particle types.
 */
export class FolkSandWebGPU extends FolkBaseSet {
  static override tagName = 'folk-sand-webgpu';

  static override styles = [
    FolkBaseSet.styles,
    css`
      canvas {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 100%;
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
  #presentationFormat!: GPUTextureFormat;

  // Simulation dimensions (coarser than display)
  #PIXELS_PER_PARTICLE = 4;
  #bufferWidth = 0;
  #bufferHeight = 0;

  // Pipelines
  #initPipeline!: GPUComputePipeline;
  #simulationPipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Textures for simulation state (ping-pong)
  #stateTextures: GPUTexture[] = [];
  #currentStateIndex = 0;

  // Collision texture
  #collisionTexture!: GPUTexture;

  // Shape data buffer for collision
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  // Uniform buffers
  #paramsBuffer!: GPUBuffer;
  #mouseBuffer!: GPUBuffer;

  // Bind group layouts (cached)
  #initBindGroupLayout!: GPUBindGroupLayout;
  #simBindGroupLayout!: GPUBindGroupLayout;
  #renderBindGroupLayout!: GPUBindGroupLayout;
  #collisionBindGroupLayout!: GPUBindGroupLayout;
  #collisionPipeline!: GPUComputePipeline;

  // Input state
  #pointer = {
    x: -1,
    y: -1,
    prevX: -1,
    prevY: -1,
    down: false,
  };

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
      this.#initResources();
      await this.#initPipelines();
      this.#runInitPass();
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
    this.#cleanupResources();
  }

  async #initWebGPU() {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter.');
    }

    this.#device = await adapter.requestDevice();

    this.#canvas.width = this.clientWidth * devicePixelRatio;
    this.#canvas.height = this.clientHeight * devicePixelRatio;

    const context = this.#canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context.');
    }

    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    this.#bufferWidth = Math.ceil(this.#canvas.width / this.#PIXELS_PER_PARTICLE);
    this.#bufferHeight = Math.ceil(this.#canvas.height / this.#PIXELS_PER_PARTICLE);
  }

  #initResources() {
    const device = this.#device;

    // Create state textures for ping-pong (rgba8uint: r=random, g=unused, b=data, a=type)
    for (let i = 0; i < 2; i++) {
      this.#stateTextures[i] = device.createTexture({
        size: { width: this.#bufferWidth, height: this.#bufferHeight },
        format: 'rgba8uint',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });
    }

    // Collision texture - must use r32uint for storage binding compatibility
    this.#collisionTexture = device.createTexture({
      size: { width: this.#bufferWidth, height: this.#bufferHeight },
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Params buffer: width, height, frame, materialType, brushRadius, initialSand
    this.#paramsBuffer = device.createBuffer({
      size: 32, // 6 u32s + padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Mouse buffer: x, y, prevX, prevY (in buffer coordinates)
    this.#mouseBuffer = device.createBuffer({
      size: 16, // 4 f32s
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  async #initPipelines() {
    const device = this.#device;

    // === Initialization Pipeline ===
    const initModule = device.createShaderModule({ code: initShader });
    this.#initPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: initModule, entryPoint: 'main' },
    });
    this.#initBindGroupLayout = this.#initPipeline.getBindGroupLayout(0);

    // === Collision Pipeline ===
    const collisionModule = device.createShaderModule({ code: collisionShader });
    this.#collisionPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: collisionModule, entryPoint: 'main' },
    });
    this.#collisionBindGroupLayout = this.#collisionPipeline.getBindGroupLayout(0);

    // === Simulation Pipeline ===
    const simModule = device.createShaderModule({ code: simulationShader });
    this.#simulationPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: simModule, entryPoint: 'main' },
    });
    this.#simBindGroupLayout = this.#simulationPipeline.getBindGroupLayout(0);

    // === Render Pipeline ===
    const renderModule = device.createShaderModule({ code: renderShader });
    this.#renderPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vertex_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fragment_main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });
    this.#renderBindGroupLayout = this.#renderPipeline.getBindGroupLayout(0);
  }

  #runInitPass() {
    this.#updateParamsBuffer(0);

    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    const bindGroup = this.#device.createBindGroup({
      layout: this.#initBindGroupLayout,
      entries: [
        { binding: 0, resource: this.#stateTextures[0].createView() },
        { binding: 1, resource: { buffer: this.#paramsBuffer } },
      ],
    });

    pass.setPipeline(this.#initPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.#bufferWidth / WORKGROUP_SIZE),
      Math.ceil(this.#bufferHeight / WORKGROUP_SIZE),
    );
    pass.end();

    this.#device.queue.submit([encoder.finish()]);
  }

  #updateParamsBuffer(frame: number) {
    const data = new ArrayBuffer(32);
    const view = new DataView(data);
    view.setUint32(0, this.#bufferWidth, true);
    view.setUint32(4, this.#bufferHeight, true);
    view.setUint32(8, frame, true);
    view.setUint32(12, this.#materialType, true);
    view.setFloat32(16, this.#brushRadius, true);
    view.setFloat32(20, this.initialSand, true);
    this.#device.queue.writeBuffer(this.#paramsBuffer, 0, data);
  }

  #updateMouseBuffer() {
    const mx = (this.#pointer.x / this.#canvas.width) * this.#bufferWidth;
    const my = (1.0 - this.#pointer.y / this.#canvas.height) * this.#bufferHeight;
    const mpx = (this.#pointer.prevX / this.#canvas.width) * this.#bufferWidth;
    const mpy = (1.0 - this.#pointer.prevY / this.#canvas.height) * this.#bufferHeight;

    const data = new Float32Array([
      this.#pointer.down ? mx : -1,
      this.#pointer.down ? my : -1,
      this.#pointer.down ? mpx : -1,
      this.#pointer.down ? mpy : -1,
    ]);
    this.#device.queue.writeBuffer(this.#mouseBuffer, 0, data);
  }

  #render = () => {
    this.#animationId = requestAnimationFrame(this.#render);

    // Handle resize
    const width = this.clientWidth * devicePixelRatio;
    const height = this.clientHeight * devicePixelRatio;
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#handleResize(width, height);
    }

    // Run simulation passes (3 per frame for better mixing)
    const PASSES = 3;
    for (let i = 0; i < PASSES; i++) {
      this.#runSimulationPass(this.#frame * PASSES + i);
    }
    this.#frame++;

    // Render to screen
    this.#runRenderPass();

    // Update previous pointer position
    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
  };

  #runSimulationPass(frame: number) {
    this.#updateParamsBuffer(frame);
    this.#updateMouseBuffer();

    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    const inputTex = this.#stateTextures[this.#currentStateIndex];
    const outputTex = this.#stateTextures[1 - this.#currentStateIndex];

    const bindGroup = this.#device.createBindGroup({
      layout: this.#simBindGroupLayout,
      entries: [
        { binding: 0, resource: inputTex.createView() },
        { binding: 1, resource: outputTex.createView() },
        { binding: 2, resource: this.#collisionTexture.createView() },
        { binding: 3, resource: { buffer: this.#paramsBuffer } },
        { binding: 4, resource: { buffer: this.#mouseBuffer } },
      ],
    });

    pass.setPipeline(this.#simulationPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.#bufferWidth / WORKGROUP_SIZE),
      Math.ceil(this.#bufferHeight / WORKGROUP_SIZE),
    );
    pass.end();

    this.#device.queue.submit([encoder.finish()]);
    this.#currentStateIndex = 1 - this.#currentStateIndex;
  }

  #runRenderPass() {
    const encoder = this.#device.createCommandEncoder();

    const bindGroup = this.#device.createBindGroup({
      layout: this.#renderBindGroupLayout,
      entries: [
        { binding: 0, resource: this.#stateTextures[this.#currentStateIndex].createView() },
        { binding: 1, resource: { buffer: this.#paramsBuffer } },
      ],
    });

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
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();

    this.#device.queue.submit([encoder.finish()]);
  }

  #handleResize(width: number, height: number) {
    this.#canvas.width = width;
    this.#canvas.height = height;

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    const newBufferWidth = Math.ceil(width / this.#PIXELS_PER_PARTICLE);
    const newBufferHeight = Math.ceil(height / this.#PIXELS_PER_PARTICLE);

    if (newBufferWidth !== this.#bufferWidth || newBufferHeight !== this.#bufferHeight) {
      this.#bufferWidth = newBufferWidth;
      this.#bufferHeight = newBufferHeight;

      // Recreate textures
      this.#stateTextures.forEach((t) => t.destroy());
      this.#collisionTexture.destroy();

      for (let i = 0; i < 2; i++) {
        this.#stateTextures[i] = this.#device.createTexture({
          size: { width: this.#bufferWidth, height: this.#bufferHeight },
          format: 'rgba8uint',
          usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
      }

      this.#collisionTexture = this.#device.createTexture({
        size: { width: this.#bufferWidth, height: this.#bufferHeight },
        format: 'r32uint',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      });

      this.#currentStateIndex = 0;
      this.#runInitPass();
      this.#updateCollisionTexture();
    }
  }

  // === Collision Detection ===

  #updateShapeData() {
    const shapeData: number[] = [];

    this.sourceRects.forEach((rect) => {
      // Normalize to [0, 1] and flip Y for simulation coordinates (Y=0 at bottom)
      const left = rect.left / this.clientWidth;
      const right = rect.right / this.clientWidth;
      // Flip Y: DOM top becomes simulation maxY, DOM bottom becomes simulation minY
      const minY = 1.0 - rect.bottom / this.clientHeight;
      const maxY = 1.0 - rect.top / this.clientHeight;

      shapeData.push(left, minY, right, maxY);
    });

    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      this.#shapeDataBuffer?.destroy();
      this.#shapeDataBuffer = undefined;
      return;
    }

    const requiredSize = shapeData.length * 4;
    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer?.destroy();
      this.#shapeDataBuffer = this.#device.createBuffer({
        size: Math.max(requiredSize, 64), // Minimum size
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));
  }

  #updateCollisionTexture() {
    if (!this.#device) return;

    this.#updateShapeData();

    // Clear collision texture first
    const encoder = this.#device.createCommandEncoder();

    if (this.#shapeCount > 0 && this.#shapeDataBuffer) {
      const pass = encoder.beginComputePass();

      // Create params buffer for collision
      const paramsData = new Uint32Array([this.#bufferWidth, this.#bufferHeight, this.#shapeCount, 0]);
      const collisionParamsBuffer = this.#device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.#device.queue.writeBuffer(collisionParamsBuffer, 0, paramsData);

      const bindGroup = this.#device.createBindGroup({
        layout: this.#collisionBindGroupLayout,
        entries: [
          { binding: 0, resource: this.#collisionTexture.createView() },
          { binding: 1, resource: { buffer: collisionParamsBuffer } },
          { binding: 2, resource: { buffer: this.#shapeDataBuffer } },
        ],
      });

      pass.setPipeline(this.#collisionPipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.#bufferWidth / WORKGROUP_SIZE),
        Math.ceil(this.#bufferHeight / WORKGROUP_SIZE),
      );
      pass.end();

      this.#device.queue.submit([encoder.finish()]);
      collisionParamsBuffer.destroy();
    } else {
      this.#device.queue.submit([encoder.finish()]);
    }
  }

  // === Event Handlers ===

  #attachEventListeners() {
    this.#canvas.addEventListener('pointerdown', this.#handlePointerDown);
    this.#canvas.addEventListener('pointermove', this.#handlePointerMove);
    this.#canvas.addEventListener('pointerup', this.#handlePointerUp);
    this.#canvas.addEventListener('pointerleave', this.#handlePointerUp);
    document.addEventListener('keydown', this.#handleKeyDown);
  }

  #detachEventListeners() {
    this.#canvas.removeEventListener('pointerdown', this.#handlePointerDown);
    this.#canvas.removeEventListener('pointermove', this.#handlePointerMove);
    this.#canvas.removeEventListener('pointerup', this.#handlePointerUp);
    this.#canvas.removeEventListener('pointerleave', this.#handlePointerUp);
    document.removeEventListener('keydown', this.#handleKeyDown);
  }

  #handlePointerDown = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * devicePixelRatio;
    const y = (e.clientY - rect.top) * devicePixelRatio;

    this.#pointer.x = x;
    this.#pointer.y = y;
    this.#pointer.prevX = x;
    this.#pointer.prevY = y;
    this.#pointer.down = true;
  };

  #handlePointerMove = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * devicePixelRatio;
    const y = (e.clientY - rect.top) * devicePixelRatio;

    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
    this.#pointer.x = x;
    this.#pointer.y = y;
  };

  #handlePointerUp = () => {
    this.#pointer.down = false;
  };

  #handleKeyDown = (e: KeyboardEvent) => {
    const key = parseInt(e.key);
    if (!isNaN(key) && key >= 0 && key <= 6) {
      this.#materialType = key;
      this.onMaterialChange?.(this.#materialType);
    }
  };

  #cleanupResources() {
    this.#stateTextures.forEach((t) => t.destroy());
    this.#collisionTexture?.destroy();
    this.#paramsBuffer?.destroy();
    this.#mouseBuffer?.destroy();
    this.#shapeDataBuffer?.destroy();
  }

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

// Particle type constants
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

// Hash function for randomness
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

// Initialization shader
const initShader = /*wgsl*/ `
${paramsStruct}
${particleTypes}
${hashFunctions}

@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8uint, write>;
@group(0) @binding(1) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }
  
  let r = hash12(vec2f(coord));
  var particleType = AIR;
  
  if (r < params.initialSand) {
    particleType = SAND;
  }
  
  let randByte = u32(hash12(vec2f(coord) + 0.5) * 255.0);
  textureStore(outputTex, coord, vec4u(randByte, 0u, 0u, particleType));
}
`;

// Collision shader - rasterizes shapes into collision texture
const collisionShader = /*wgsl*/ `
struct CollisionParams {
  width: u32,
  height: u32,
  shapeCount: u32,
  padding: u32,
}

struct Shape {
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
}

@group(0) @binding(0) var collisionTex: texture_storage_2d<r32uint, write>;
@group(0) @binding(1) var<uniform> params: CollisionParams;
@group(0) @binding(2) var<storage, read> shapes: array<Shape>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }
  
  let pixel = vec2f(f32(coord.x) / f32(params.width), f32(coord.y) / f32(params.height));
  
  var isCollision = 0u;
  
  for (var i = 0u; i < params.shapeCount; i++) {
    let shape = shapes[i];
    if (pixel.x >= shape.minX && pixel.x <= shape.maxX &&
        pixel.y >= shape.minY && pixel.y <= shape.maxY) {
      isCollision = 1u;
      break;
    }
  }
  
  textureStore(collisionTex, coord, vec4u(isCollision, 0u, 0u, 0u));
}
`;

// Main simulation shader with Margolus neighborhood
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

// Signed distance to line segment
fn sdSegment(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Get Margolus offset for this frame
fn getOffset(frame: u32) -> vec2i {
  let i = frame % 4u;
  if (i == 0u) { return vec2i(0, 0); }
  if (i == 1u) { return vec2i(1, 1); }
  if (i == 2u) { return vec2i(0, 1); }
  return vec2i(1, 0);
}

// Read particle data at position
fn getData(p: vec2i) -> vec4u {
  if (p.x < 0 || p.y < 0 || p.x >= i32(params.width) || p.y >= i32(params.height)) {
    return vec4u(0u, 0u, 0u, WALL);
  }
  
  let collision = textureLoad(collisionTex, vec2u(p), 0).r;
  if (collision > 0u) {
    return vec4u(0u, 0u, 0u, COLLISION);
  }
  
  return textureLoad(inputTex, vec2u(p), 0);
}

// Create a new particle
fn createParticle(particleType: u32, coord: vec2i, frame: u32) -> vec4u {
  let randByte = u32(hash14(vec4f(vec2f(coord), f32(frame), f32(particleType))) * 255.0);
  return vec4u(randByte, 0u, 0u, particleType);
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let coord = vec2i(global_id.xy);
  
  if (coord.x >= i32(params.width) || coord.y >= i32(params.height)) {
    return;
  }
  
  // Check mouse input first
  if (mouse.x > 0.0) {
    let d = sdSegment(vec2f(coord), vec2f(mouse.x, mouse.y), vec2f(mouse.prevX, mouse.prevY));
    if (d < params.brushRadius) {
      textureStore(outputTex, vec2u(coord), createParticle(params.materialType, coord, params.frame));
      return;
    }
  }
  
  // Get Margolus offset and calculate block position
  let offset = getOffset(params.frame);
  let fc = coord + offset;
  let p = (fc / 2) * 2 - offset;
  let xy = fc % 2;
  let i = xy.x + xy.y * 2;
  
  // Load 2x2 block
  var t00 = getData(p);                  // top-left
  var t10 = getData(p + vec2i(1, 0));    // top-right  
  var t01 = getData(p + vec2i(0, 1));    // bottom-left
  var t11 = getData(p + vec2i(1, 1));    // bottom-right
  
  // Check neighbors above for water spreading
  let tn00 = getData(p + vec2i(0, -1));
  let tn10 = getData(p + vec2i(1, -1));
  
  // Early exit if all same type
  if (t00.a == t10.a && t01.a == t11.a && t00.a == t01.a) {
    let result = select(select(select(t00, t10, i == 1), t01, i == 2), t11, i == 3);
    textureStore(outputTex, vec2u(coord), result);
    return;
  }
  
  // Random values for this block
  let r = hash44(vec4f(vec2f(p), f32(params.frame), 0.0));
  
  // === SMOKE behavior (rises) ===
  if (t00.a == SMOKE) {
    if (t01.a < SMOKE && r.y < 0.25) {
      let tmp = t00; t00 = t01; t01 = tmp;
    } else if (r.z < 0.003) {
      t00 = createParticle(AIR, p, params.frame);
    }
  }
  if (t10.a == SMOKE) {
    if (t11.a < SMOKE && r.y < 0.25) {
      let tmp = t10; t10 = t11; t11 = tmp;
    } else if (r.z < 0.003) {
      t10 = createParticle(AIR, p + vec2i(1, 0), params.frame);
    }
  }
  
  // Horizontal smoke spreading
  if ((t01.a == SMOKE && t11.a < SMOKE) || (t01.a < SMOKE && t11.a == SMOKE)) {
    if (r.x < 0.25) {
      let tmp = t01; t01 = t11; t11 = tmp;
    }
  }
  
  // === SAND behavior ===
  // Horizontal jitter when both below are sand and nothing above
  if (((t01.a == SAND && t11.a < SAND) || (t01.a < SAND && t11.a == SAND)) &&
      t00.a < SAND && t10.a < SAND && r.x < 0.4) {
    let tmp = t01; t01 = t11; t11 = tmp;
  }
  
  // Sand falling
  if (t01.a == SAND || t01.a == STONE) {
    if (t00.a < SAND && t00.a != WATER && t00.a != LAVA) {
      if (r.y < 0.9) {
        let tmp = t01; t01 = t00; t00 = tmp;
      }
    } else if (t00.a == WATER && r.y < 0.3) {
      let tmp = t01; t01 = t00; t00 = tmp;
    } else if (t00.a == LAVA && r.y < 0.15) {
      let tmp = t01; t01 = t00; t00 = tmp;
    } else if (t11.a < SAND && t10.a < SAND) {
      let tmp = t01; t01 = t10; t10 = tmp;
    }
  }
  
  if (t11.a == SAND || t11.a == STONE) {
    if (t10.a < SAND && t10.a != WATER && t10.a != LAVA) {
      if (r.y < 0.9) {
        let tmp = t11; t11 = t10; t10 = tmp;
      }
    } else if (t10.a == WATER && r.y < 0.3) {
      let tmp = t11; t11 = t10; t10 = tmp;
    } else if (t10.a == LAVA && r.y < 0.15) {
      let tmp = t11; t11 = t10; t10 = tmp;
    } else if (t01.a < SAND && t00.a < SAND) {
      let tmp = t11; t11 = t00; t00 = tmp;
    }
  }
  
  // === WATER behavior ===
  var drop = false;
  
  if (t01.a == WATER) {
    if (t00.a < WATER && r.y < 0.95) {
      let tmp = t01; t01 = t00; t00 = tmp;
      drop = true;
    } else if (t11.a < WATER && t10.a < WATER && r.z < 0.3) {
      let tmp = t01; t01 = t10; t10 = tmp;
      drop = true;
    }
  }
  
  if (t11.a == WATER) {
    if (t10.a < WATER && r.y < 0.95) {
      let tmp = t11; t11 = t10; t10 = tmp;
      drop = true;
    } else if (t01.a < WATER && t00.a < WATER && r.z < 0.3) {
      let tmp = t11; t11 = t00; t00 = tmp;
      drop = true;
    }
  }
  
  // Water horizontal spreading
  if (!drop) {
    if ((t01.a == WATER && t11.a < WATER) || (t01.a < WATER && t11.a == WATER)) {
      if ((t00.a >= WATER && t10.a >= WATER) || r.w < 0.8) {
        let tmp = t01; t01 = t11; t11 = tmp;
      }
    }
    if ((t00.a == WATER && t10.a < WATER) || (t00.a < WATER && t10.a == WATER)) {
      if ((tn00.a >= WATER && tn10.a >= WATER) || r.w < 0.8) {
        let tmp = t00; t00 = t10; t10 = tmp;
      }
    }
  }
  
  // === LAVA behavior ===
  if (t01.a == LAVA) {
    if (t00.a < LAVA && r.y < 0.8) {
      let tmp = t01; t01 = t00; t00 = tmp;
    } else if (t11.a < LAVA && t10.a < LAVA && r.z < 0.2) {
      let tmp = t01; t01 = t10; t10 = tmp;
    }
  }
  
  if (t11.a == LAVA) {
    if (t10.a < LAVA && r.y < 0.8) {
      let tmp = t11; t11 = t10; t10 = tmp;
    } else if (t01.a < LAVA && t00.a < LAVA && r.z < 0.2) {
      let tmp = t11; t11 = t00; t00 = tmp;
    }
  }
  
  // Lava + Water = Stone + Smoke
  if (t00.a == LAVA) {
    if (t01.a == WATER) {
      t00 = createParticle(STONE, p, params.frame);
      t01 = createParticle(SMOKE, p + vec2i(0, 1), params.frame);
    } else if (t10.a == WATER) {
      t00 = createParticle(STONE, p, params.frame);
      t10 = createParticle(SMOKE, p + vec2i(1, 0), params.frame);
    }
  }
  
  if (t10.a == LAVA) {
    if (t11.a == WATER) {
      t10 = createParticle(STONE, p + vec2i(1, 0), params.frame);
      t11 = createParticle(SMOKE, p + vec2i(1, 1), params.frame);
    } else if (t00.a == WATER) {
      t10 = createParticle(STONE, p + vec2i(1, 0), params.frame);
      t00 = createParticle(SMOKE, p, params.frame);
    }
  }
  
  // Horizontal lava spreading
  if ((t01.a == LAVA && t11.a < LAVA) || (t01.a < LAVA && t11.a == LAVA)) {
    if (r.x < 0.6) {
      let tmp = t01; t01 = t11; t11 = tmp;
    }
  }
  
  // Output the appropriate cell based on position in block
  var result = t00;
  if (i == 1) { result = t10; }
  else if (i == 2) { result = t01; }
  else if (i == 3) { result = t11; }
  
  // Handle collision cells becoming air when collision removed
  if (result.a == COLLISION) {
    let collision = textureLoad(collisionTex, vec2u(coord), 0).r;
    if (collision == 0u) {
      result = createParticle(AIR, coord, params.frame);
    }
  }
  
  textureStore(outputTex, vec2u(coord), result);
}
`;

// Render shader - visualizes the simulation
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
  // Don't flip Y - simulation Y=0 is at bottom, screen Y=-1 is at bottom
  out.texCoord = pos * 0.5 + 0.5;
  return out;
}

@group(0) @binding(0) var stateTex: texture_2d<u32>;
@group(0) @binding(1) var<uniform> params: Params;

const bgColor = vec3f(0.12, 0.133, 0.141);

fn getParticleColor(data: vec4u) -> vec3f {
  let rand = f32(data.r) / 255.0;
  let particleType = data.a;
  
  if (particleType == AIR) {
    return bgColor;
  }
  if (particleType == SMOKE) {
    return mix(bgColor, vec3f(0.15), 0.4 + rand * 0.2);
  }
  if (particleType == WATER) {
    let waterColor = vec3f(0.2, 0.4, 0.8);
    return mix(bgColor, waterColor, 0.6 + rand * 0.2);
  }
  if (particleType == LAVA) {
    let baseColor = vec3f(0.9, 0.3, 0.1);
    let glowColor = vec3f(1.0, 0.6, 0.2);
    return mix(baseColor, glowColor, rand);
  }
  if (particleType == SAND) {
    let baseColor = vec3f(0.86, 0.62, 0.27);
    let altColor = vec3f(0.82, 0.58, 0.23);
    return mix(baseColor, altColor, rand) * (0.8 + rand * 0.3);
  }
  if (particleType == STONE) {
    let baseColor = vec3f(0.08, 0.1, 0.12);
    let altColor = vec3f(0.12, 0.14, 0.16);
    return mix(baseColor, altColor, rand) * (0.7 + rand * 0.3);
  }
  if (particleType == WALL || particleType == COLLISION) {
    return bgColor * 0.5 * (rand * 0.4 + 0.6);
  }
  
  return bgColor;
}

fn linearTosRGB(col: vec3f) -> vec3f {
  let cutoff = col < vec3f(0.0031308);
  let higher = 1.055 * pow(col, vec3f(1.0 / 2.4)) - 0.055;
  let lower = col * 12.92;
  return select(higher, lower, cutoff);
}

@fragment
fn fragment_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let coord = vec2u(texCoord * vec2f(f32(params.width), f32(params.height)));
  let data = textureLoad(stateTex, coord, 0);
  
  var color = getParticleColor(data);
  color = linearTosRGB(color);
  
  return vec4f(color, 1.0);
}
`;
