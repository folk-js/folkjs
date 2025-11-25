import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const WORKGROUP_SIZE = 8;

/**
 * WebGPU-based distance field calculation using the Jump Flooding Algorithm (JFA).
 * Uses compute shaders for seed initialization and JFA passes, eliminating the need for ping-pong textures.
 * Previous implementations: WebGL2 (folk-distance-field.ts), CPU-based (github.com/folk-canvas/folk-canvas/commit/fdd7fb9d84d93ad665875cad25783c232fd17bcc)
 */
export class FolkDistanceFieldWebGPU extends FolkBaseSet {
  static override tagName = 'folk-distance-field-webgpu';

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // Shader modules (cached)
  #seedShaderModule!: GPUShaderModule;
  #jfaShaderModule!: GPUShaderModule;
  #renderShaderModule!: GPUShaderModule;

  // Pipelines
  #seedComputePipeline!: GPUComputePipeline;
  #jfaComputePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Storage textures for distance field data (ping-pong between passes)
  #distanceTextures: GPUTexture[] = [];

  // Shape data
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  // Cached bind group layouts
  #seedBindGroupLayout!: GPUBindGroupLayout;
  #jfaBindGroupLayout!: GPUBindGroupLayout;
  #renderBindGroupLayout!: GPUBindGroupLayout;

  // Current buffer index for ping-pong
  #currentBufferIndex = 0;

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    await this.#initPipelines();
    this.#initBuffers();

    window.addEventListener('resize', this.#handleResize);

    // Trigger initial render now that WebGPU is ready
    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
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

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth;
    this.#canvas.height = this.clientHeight;
    this.renderRoot.prepend(this.#canvas);

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
  }

  async #initPipelines() {
    // Create and cache shader modules
    this.#seedShaderModule = this.#device.createShaderModule({ code: seedComputeShader });
    this.#jfaShaderModule = this.#device.createShaderModule({ code: jfaComputeShader });
    this.#renderShaderModule = this.#device.createShaderModule({ code: renderShader });

    // Create compute pipeline for seed initialization
    this.#seedComputePipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.#seedShaderModule,
        entryPoint: 'main',
      },
    });

    // Cache the bind group layout
    this.#seedBindGroupLayout = this.#seedComputePipeline.getBindGroupLayout(0);

    // Create compute pipeline for JFA passes
    this.#jfaComputePipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.#jfaShaderModule,
        entryPoint: 'main',
      },
    });

    this.#jfaBindGroupLayout = this.#jfaComputePipeline.getBindGroupLayout(0);

    // Create render pipeline for visualization
    this.#renderPipeline = this.#device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.#renderShaderModule,
        entryPoint: 'vertex_main',
      },
      fragment: {
        module: this.#renderShaderModule,
        entryPoint: 'fragment_main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });

    this.#renderBindGroupLayout = this.#renderPipeline.getBindGroupLayout(0);
  }

  #initBuffers() {
    const { width, height } = this.#canvas;

    this.#distanceTextures = [0, 1].map(() =>
      this.#device.createTexture({
        size: { width, height },
        format: 'rgba32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
  }

  /**
   * Handles updates to geometry elements by re-initializing seed points and rerunning the JFA.
   */
  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    // Wait for WebGPU to be initialized
    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#updateShapeData();
    this.#runJumpFloodingAlgorithm();
  }

  #updateShapeData() {
    const shapeData: number[] = [];

    const containerWidth = this.clientWidth;
    const containerHeight = this.clientHeight;

    // Collect all shape rectangles
    this.sourceRects.forEach((rect, index) => {
      // Normalize coordinates to [0, 1] range
      const left = rect.left / containerWidth;
      const right = rect.right / containerWidth;
      const top = rect.top / containerHeight;
      const bottom = rect.bottom / containerHeight;

      const shapeID = index + 1; // Avoid zero

      // Store shape as: minX, minY, maxX, maxY, shapeID
      shapeData.push(left, top, right, bottom, shapeID);
    });

    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      return;
    }

    // Resize shape data buffer if needed
    const requiredSize = shapeData.length * 4; // 4 bytes per float32

    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer?.destroy();
      this.#shapeDataBuffer = this.#device.createBuffer({
        size: requiredSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    // Upload shape data
    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));
  }

  #runJumpFloodingAlgorithm() {
    if (this.#shapeCount === 0 || !this.#shapeDataBuffer) return;

    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const aspectRatio = width / height;
    const workgroupsX = Math.ceil(width / WORKGROUP_SIZE);
    const workgroupsY = Math.ceil(height / WORKGROUP_SIZE);

    const maxStepSize = 1 << Math.floor(Math.log2(Math.max(width, height)));
    const jfaPassCount = Math.floor(Math.log2(maxStepSize)) + 1;
    const paramsBuffers: GPUBuffer[] = [];

    // Create params buffers for each JFA pass
    let stepSize = maxStepSize;
    for (let i = 0; i < jfaPassCount; i++) {
      paramsBuffers.push(this.#createParamsBuffer(width, height, stepSize, aspectRatio));
      stepSize >>= 1;
    }

    const encoder = this.#device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    // Step 1: Initialize seeds
    const seedBindGroup = this.#device.createBindGroup({
      layout: this.#seedBindGroupLayout,
      entries: [
        { binding: 0, resource: this.#distanceTextures[0].createView() },
        { binding: 1, resource: { buffer: paramsBuffers[0] } },
        { binding: 2, resource: { buffer: this.#shapeDataBuffer } },
      ],
    });

    computePass.setPipeline(this.#seedComputePipeline);
    computePass.setBindGroup(0, seedBindGroup);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

    // TODO: Check if running all JFA passes in a single compute pass causes synchronization issues.
    // WebGPU may not guarantee proper memory synchronization between storage texture writes/reads
    // within the same compute pass. If artifacts appear, split into separate compute passes.

    // Step 2: Run all JFA passes
    this.#currentBufferIndex = 0;

    for (let i = 0; i < jfaPassCount; i++) {
      const inputTexture = this.#distanceTextures[this.#currentBufferIndex];
      const outputTexture = this.#distanceTextures[1 - this.#currentBufferIndex];

      const bindGroup = this.#device.createBindGroup({
        layout: this.#jfaBindGroupLayout,
        entries: [
          { binding: 0, resource: inputTexture.createView() },
          { binding: 1, resource: outputTexture.createView() },
          { binding: 2, resource: { buffer: paramsBuffers[i] } },
        ],
      });

      computePass.setPipeline(this.#jfaComputePipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

      this.#currentBufferIndex = 1 - this.#currentBufferIndex;
    }

    computePass.end();

    // Step 3: Render to screen
    const renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderBindGroupLayout,
      entries: [
        { binding: 0, resource: this.#distanceTextures[this.#currentBufferIndex].createView() },
        { binding: 1, resource: { buffer: paramsBuffers[0] } },
      ],
    });

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.#renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(4);
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
    paramsBuffers.forEach((buffer) => buffer.destroy());
  }

  #handleResize = () => {
    // Update canvas size
    this.#canvas.width = this.clientWidth;
    this.#canvas.height = this.clientHeight;

    // Reconfigure context
    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    // Reinitialize textures with new size
    this.#distanceTextures.forEach((texture) => texture.destroy());
    this.#initBuffers();

    // Rerun algorithm
    this.#updateShapeData();
    this.#runJumpFloodingAlgorithm();
  };

  #cleanupResources() {
    this.#distanceTextures.forEach((texture) => texture.destroy());
    this.#shapeDataBuffer?.destroy();
  }

  #createParamsBuffer(width: number, height: number, stepSize: number, aspectRatio: number): GPUBuffer {
    const data = new ArrayBuffer(32);
    new Uint32Array(data, 0, 4).set([width, height, stepSize, this.#shapeCount]);
    new Float32Array(data, 16, 1).set([aspectRatio]);

    const buffer = this.#device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data));
    buffer.unmap();
    return buffer;
  }
}

/** Shared WGSL struct for compute and render parameters */
const paramsStruct = /*wgsl*/ `
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  shapeCount: u32,
  aspectRatio: f32,
}`;

/**
 * Compute shader for seed initialization.
 * Rasterizes shapes and marks pixels inside them as seed points.
 */
const seedComputeShader = /*wgsl*/ `
${paramsStruct}

struct ShapeData {
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
  shapeID: f32,
}

// Large value representing infinity for unseeded pixels
const INFINITY: f32 = 1e10;

@group(0) @binding(0) var distanceField: texture_storage_2d<rgba32float, write>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> shapes: array<ShapeData>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }

  let dims = vec2f(f32(params.width), f32(params.height));
  let pixel = vec2f(coord) / dims;
  
  // Use -1,-1 as "no seed" marker, INFINITY for initial distance of unseeded pixels
  var nearestSeed = vec2f(-1.0, -1.0);
  var shapeID = 0.0;
  var minDist = INFINITY;
  
  // Check all shapes to see if this pixel is inside any
  for (var i = 0u; i < params.shapeCount; i++) {
    let shape = shapes[i];
    
    // Check if pixel is inside this shape using vector operations
    let inShape = all(pixel >= vec2f(shape.minX, shape.minY)) && 
                  all(pixel <= vec2f(shape.maxX, shape.maxY));
    if (inShape) {
      // Inside shape - this is a seed point with distance 0
      nearestSeed = pixel;
      shapeID = shape.shapeID;
      minDist = 0.0;
      break;
    }
  }
  
  // Write initial seed data (distance is 0 for seeds, INFINITY for unseeded)
  textureStore(distanceField, coord, vec4f(nearestSeed.x, nearestSeed.y, shapeID, minDist));
}
`;

/**
 * Compute shader for JFA passes.
 * Updates each pixel with the nearest seed by checking neighbors at step distance.
 */
const jfaComputeShader = /*wgsl*/ `
${paramsStruct}

// 9 offsets for checking neighbors in a 3x3 grid
const OFFSETS: array<vec2i, 9> = array(
  vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
  vec2i(-1,  0), vec2i(0,  0), vec2i(1,  0),
  vec2i(-1,  1), vec2i(0,  1), vec2i(1,  1)
);

@group(0) @binding(0) var inputField: texture_storage_2d<rgba32float, read>;
@group(0) @binding(1) var outputField: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }

  let dims = vec2f(f32(params.width), f32(params.height));
  let pixel = vec2f(coord) / dims;
  
  var nearest = textureLoad(inputField, coord);
  var minDist = nearest.w;
  
  let step = i32(params.stepSize);
  
  // Check 9 neighbors in a grid around current pixel
  for (var i = 0u; i < 9u; i++) {
    let neighborCoord = vec2i(coord) + OFFSETS[i] * step;
    
    // Direct bounds checking
    let inBounds = all(neighborCoord >= vec2i(0)) && all(neighborCoord < vec2i(i32(params.width), i32(params.height)));
    
    // Clamp for safe texture access (textureLoad requires valid coordinates)
    let safeCoord = clamp(neighborCoord, vec2i(0), vec2i(i32(params.width) - 1, i32(params.height) - 1));
    let neighbor = textureLoad(inputField, vec2u(safeCoord));
    
    // Check if valid: in bounds AND has a seed assigned
    let hasValidSeed = neighbor.x >= 0.0;
    let isValid = inBounds && hasValidSeed;

    // Calculate distance with aspect ratio correction
    let seedPos = vec2f(neighbor.x * params.aspectRatio, neighbor.y);
    let pixelPos = vec2f(pixel.x * params.aspectRatio, pixel.y);
    let dist = distance(seedPos, pixelPos);

    let isCloser = dist < minDist;
    let shouldUpdate = isValid && isCloser;
    nearest = select(nearest, vec4f(neighbor.x, neighbor.y, neighbor.z, dist), shouldUpdate);
    minDist = select(minDist, dist, shouldUpdate);
  }
  
  textureStore(outputField, coord, nearest);
}
`;

/**
 * Combined render shader (vertex and fragment) for fullscreen quad rendering.
 */
const renderShader = /*wgsl*/ `
${paramsStruct}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // Generate positions: (-1,-1), (1,-1), (-1,1), (1,1)
  let pos = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  
  var out: VertexOutput;
  out.position = vec4f(pos, 0.0, 1.0);
  out.texCoord = pos * vec2f(0.5, -0.5) + 0.5; // flip Y for texture coords
  return out;
}

@group(0) @binding(0) var distanceField: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;

fn hsv2rgb(c: vec3f) -> vec3f {
  let K = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3f(0.0), vec3f(1.0)), c.y);
}

@fragment
fn fragment_main(@location(0) texCoord: vec2f) -> @location(0) vec4f {
  let dims = vec2f(f32(params.width), f32(params.height));
  let coord = vec2u(texCoord * dims);
  
  let data = textureLoad(distanceField, coord, 0);
  let shapeID = data.z;
  let distance = data.w;
  
  // Generate color from shape ID using golden ratio for nice distribution
  let hue = fract(shapeID * 0.61803398875);
  var color = hsv2rgb(vec3f(hue, 0.5, 0.95));
  
  // Apply exponential falloff (distance is in normalized [0,1] coordinates)
  let falloff = 8.0;
  color *= exp(-distance * falloff);
  
  return vec4f(color, 1.0);
}
`;
