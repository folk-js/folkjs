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
  #gpu!: {
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
  };

  #PIXELS_PER_PARTICLE = 4;
  #bufferWidth = 0;
  #bufferHeight = 0;

  // Pipelines
  #pipelines!: {
    init: GPUComputePipeline;
    collision: GPUComputePipeline;
    simulation: GPUComputePipeline;
    render: GPURenderPipeline;
  };

  // Textures with cached views
  #stateTextures: Array<{ texture: GPUTexture; view: GPUTextureView }> = [];
  #collisionTexture!: { texture: GPUTexture; view: GPUTextureView };
  #currentStateIndex = 0;

  // Cached bind groups (recreated when textures change)
  #bindGroups!: {
    init: GPUBindGroup;
    simulation: [GPUBindGroup, GPUBindGroup]; // For ping-pong
    render: [GPUBindGroup, GPUBindGroup]; // For ping-pong
    collision?: GPUBindGroup;
  };

  // Buffers
  #buffers!: {
    params: GPUBuffer;
    mouse: GPUBuffer;
    collisionParams: GPUBuffer;
    shapeData?: GPUBuffer;
  };

  // Pre-allocated typed arrays for uniform updates
  #uniformData = {
    params: new ArrayBuffer(32),
    paramsView: null as DataView | null,
    mouse: new Float32Array(4),
    collisionParams: new Uint32Array(4),
  };

  #shapeCount = 0;
  #bindGroupsDirty = true;

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
    this.#cleanup();
  }

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPU adapter');

    const device = await adapter.requestDevice();
    const context = this.#canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();

    this.#gpu = { device, context, format };
    this.#uniformData.paramsView = new DataView(this.#uniformData.params);

    // Size canvas and configure context
    this.#canvas.width = this.clientWidth * devicePixelRatio;
    this.#canvas.height = this.clientHeight * devicePixelRatio;
    context.configure({ device, format, alphaMode: 'premultiplied' });

    this.#bufferWidth = Math.ceil(this.#canvas.width / this.#PIXELS_PER_PARTICLE);
    this.#bufferHeight = Math.ceil(this.#canvas.height / this.#PIXELS_PER_PARTICLE);

    this.#createPipelines();
    this.#createBuffers();
    this.#createTextures();
    this.#createBindGroups();
    this.#runInitPass();
  }

  #createPipelines() {
    const { device, format } = this.#gpu;

    this.#pipelines = {
      init: device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: initShader }), entryPoint: 'main' },
      }),
      collision: device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: collisionShader }), entryPoint: 'main' },
      }),
      simulation: device.createComputePipeline({
        layout: 'auto',
        compute: { module: device.createShaderModule({ code: simulationShader }), entryPoint: 'main' },
      }),
      render: device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: device.createShaderModule({ code: renderShader }), entryPoint: 'vertex_main' },
        fragment: {
          module: device.createShaderModule({ code: renderShader }),
          entryPoint: 'fragment_main',
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-strip' },
      }),
    };
  }

  #createBuffers() {
    const { device } = this.#gpu;

    this.#buffers = {
      params: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      mouse: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      collisionParams: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };
  }

  #createTexture(format: GPUTextureFormat, usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING) {
    const texture = this.#gpu.device.createTexture({
      size: { width: this.#bufferWidth, height: this.#bufferHeight },
      format,
      usage,
    });
    return { texture, view: texture.createView() };
  }

  #createTextures() {
    // Destroy old textures
    this.#stateTextures.forEach((t) => t.texture.destroy());
    this.#collisionTexture?.texture.destroy();

    // Create new textures with cached views
    this.#stateTextures = [this.#createTexture('rgba8uint'), this.#createTexture('rgba8uint')];
    this.#collisionTexture = this.#createTexture('r32uint');
    this.#currentStateIndex = 0;
    this.#bindGroupsDirty = true;
  }

  #createBindGroups() {
    const { device } = this.#gpu;
    const { init, collision, simulation, render } = this.#pipelines;
    const { params, mouse, collisionParams, shapeData } = this.#buffers;

    // Init bind group
    const initBindGroup = device.createBindGroup({
      layout: init.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#stateTextures[0].view },
        { binding: 1, resource: { buffer: params } },
      ],
    });

    // Simulation bind groups (one for each ping-pong direction)
    const createSimBindGroup = (inputIdx: number) =>
      device.createBindGroup({
        layout: simulation.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#stateTextures[inputIdx].view },
          { binding: 1, resource: this.#stateTextures[1 - inputIdx].view },
          { binding: 2, resource: this.#collisionTexture.view },
          { binding: 3, resource: { buffer: params } },
          { binding: 4, resource: { buffer: mouse } },
        ],
      });

    // Render bind groups (one for each state texture)
    const createRenderBindGroup = (idx: number) =>
      device.createBindGroup({
        layout: render.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#stateTextures[idx].view },
          { binding: 1, resource: { buffer: params } },
        ],
      });

    this.#bindGroups = {
      init: initBindGroup,
      simulation: [createSimBindGroup(0), createSimBindGroup(1)],
      render: [createRenderBindGroup(0), createRenderBindGroup(1)],
      collision: shapeData
        ? device.createBindGroup({
            layout: collision.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: this.#collisionTexture.view },
              { binding: 1, resource: { buffer: collisionParams } },
              { binding: 2, resource: { buffer: shapeData } },
            ],
          })
        : undefined,
    };

    this.#bindGroupsDirty = false;
  }

  #workgroups() {
    return {
      x: Math.ceil(this.#bufferWidth / WORKGROUP_SIZE),
      y: Math.ceil(this.#bufferHeight / WORKGROUP_SIZE),
    };
  }

  #updateParams(frame: number) {
    const view = this.#uniformData.paramsView!;
    view.setUint32(0, this.#bufferWidth, true);
    view.setUint32(4, this.#bufferHeight, true);
    view.setUint32(8, frame, true);
    view.setUint32(12, this.#materialType, true);
    view.setFloat32(16, this.#brushRadius, true);
    view.setFloat32(20, this.initialSand, true);
    this.#gpu.device.queue.writeBuffer(this.#buffers.params, 0, this.#uniformData.params);
  }

  #updateMouse() {
    const { x, y, prevX, prevY, down } = this.#pointer;
    const mx = (x / this.#canvas.width) * this.#bufferWidth;
    const my = (1 - y / this.#canvas.height) * this.#bufferHeight;
    const mpx = (prevX / this.#canvas.width) * this.#bufferWidth;
    const mpy = (1 - prevY / this.#canvas.height) * this.#bufferHeight;

    const data = this.#uniformData.mouse;
    data[0] = down ? mx : -1;
    data[1] = down ? my : -1;
    data[2] = down ? mpx : -1;
    data[3] = down ? mpy : -1;
    this.#gpu.device.queue.writeBuffer(this.#buffers.mouse, 0, data);
  }

  #runInitPass() {
    this.#updateParams(0);

    const encoder = this.#gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    const { x, y } = this.#workgroups();

    pass.setPipeline(this.#pipelines.init);
    pass.setBindGroup(0, this.#bindGroups.init);
    pass.dispatchWorkgroups(x, y);
    pass.end();

    this.#gpu.device.queue.submit([encoder.finish()]);
  }

  #render = () => {
    this.#animationId = requestAnimationFrame(this.#render);

    // Handle resize
    const width = this.clientWidth * devicePixelRatio;
    const height = this.clientHeight * devicePixelRatio;
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#handleResize(width, height);
    }

    // Recreate bind groups if needed
    if (this.#bindGroupsDirty) {
      this.#createBindGroups();
    }

    const { device, context } = this.#gpu;
    const { x, y } = this.#workgroups();

    // Run 3 simulation passes per frame for better mixing
    // Each pass needs separate submit to ensure uniform buffer is updated
    const PASSES = 3;
    for (let i = 0; i < PASSES; i++) {
      const frame = this.#frame * PASSES + i;
      this.#updateParams(frame);
      this.#updateMouse();

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#pipelines.simulation);
      pass.setBindGroup(0, this.#bindGroups.simulation[this.#currentStateIndex]);
      pass.dispatchWorkgroups(x, y);
      pass.end();
      device.queue.submit([encoder.finish()]);

      this.#currentStateIndex = 1 - this.#currentStateIndex;
    }
    this.#frame++;

    // Render pass (separate encoder)
    const renderEncoder = device.createCommandEncoder();
    const renderPass = renderEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.12, g: 0.13, b: 0.14, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    renderPass.setPipeline(this.#pipelines.render);
    renderPass.setBindGroup(0, this.#bindGroups.render[this.#currentStateIndex]);
    renderPass.draw(4);
    renderPass.end();
    device.queue.submit([renderEncoder.finish()]);

    this.#pointer.prevX = this.#pointer.x;
    this.#pointer.prevY = this.#pointer.y;
  };

  #handleResize(width: number, height: number) {
    this.#canvas.width = width;
    this.#canvas.height = height;
    this.#gpu.context.configure({
      device: this.#gpu.device,
      format: this.#gpu.format,
      alphaMode: 'premultiplied',
    });

    const newW = Math.ceil(width / this.#PIXELS_PER_PARTICLE);
    const newH = Math.ceil(height / this.#PIXELS_PER_PARTICLE);

    if (newW !== this.#bufferWidth || newH !== this.#bufferHeight) {
      this.#bufferWidth = newW;
      this.#bufferHeight = newH;
      this.#createTextures();
      this.#createBindGroups();
      this.#runInitPass();
      this.#updateCollisionTexture();
    }
  }

  // === Collision Detection ===

  #updateShapeData() {
    const shapeData: number[] = [];

    this.sourceRects.forEach((rect) => {
      const left = rect.left / this.clientWidth;
      const right = rect.right / this.clientWidth;
      const minY = 1 - rect.bottom / this.clientHeight;
      const maxY = 1 - rect.top / this.clientHeight;
      shapeData.push(left, minY, right, maxY);
    });

    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      this.#buffers.shapeData?.destroy();
      this.#buffers.shapeData = undefined;
      this.#bindGroupsDirty = true;
      return;
    }

    const requiredSize = shapeData.length * 4;
    if (!this.#buffers.shapeData || this.#buffers.shapeData.size < requiredSize) {
      this.#buffers.shapeData?.destroy();
      this.#buffers.shapeData = this.#gpu.device.createBuffer({
        size: Math.max(requiredSize, 64),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.#bindGroupsDirty = true;
    }

    this.#gpu.device.queue.writeBuffer(this.#buffers.shapeData, 0, new Float32Array(shapeData));
  }

  #updateCollisionTexture() {
    if (!this.#gpu?.device) return;

    this.#updateShapeData();

    if (this.#bindGroupsDirty) {
      this.#createBindGroups();
    }

    if (this.#shapeCount > 0 && this.#bindGroups.collision) {
      const data = this.#uniformData.collisionParams;
      data[0] = this.#bufferWidth;
      data[1] = this.#bufferHeight;
      data[2] = this.#shapeCount;
      data[3] = 0;
      this.#gpu.device.queue.writeBuffer(this.#buffers.collisionParams, 0, data);

      const encoder = this.#gpu.device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      const { x, y } = this.#workgroups();

      pass.setPipeline(this.#pipelines.collision);
      pass.setBindGroup(0, this.#bindGroups.collision);
      pass.dispatchWorkgroups(x, y);
      pass.end();

      this.#gpu.device.queue.submit([encoder.finish()]);
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
    if (!isNaN(key) && key >= 0 && key <= 6) {
      this.#materialType = key;
      this.onMaterialChange?.(this.#materialType);
    }
  };

  #cleanup() {
    this.#stateTextures.forEach((t) => t.texture.destroy());
    this.#collisionTexture?.texture.destroy();
    this.#buffers?.params.destroy();
    this.#buffers?.mouse.destroy();
    this.#buffers?.collisionParams.destroy();
    this.#buffers?.shapeData?.destroy();
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#gpu?.device) return;
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
