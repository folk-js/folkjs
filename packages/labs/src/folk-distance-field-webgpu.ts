import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

/** Shared WGSL struct for compute and render parameters */
const paramsStruct = /*wgsl*/ `
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  shapeCount: u32,
  aspectRatio: f32,
}`;

const WORKGROUP_SIZE = 8;

/**
 * WebGPU-based distance field calculation using the Jump Flooding Algorithm (JFA).
 * Uses compute shaders for seed initialization and JFA passes, eliminating the need for ping-pong textures.
 * Previous implementations: WebGL2 (folk-distance-field.ts), CPU-based (github.com/folk-canvas/folk-canvas/commit/fdd7fb9d84d93ad665875cad25783c232fd17bcc)
 */
export class FolkDistanceFieldWebGPU extends FolkBaseSet {
  static override tagName = 'folk-distance-field-webgpu';

  static readonly MAX_DISTANCE = 99999.0;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // Shader modules (cached)
  #seedShaderModule!: GPUShaderModule;
  #jfaShaderModule!: GPUShaderModule;
  #renderVertexShaderModule!: GPUShaderModule;
  #renderFragmentShaderModule!: GPUShaderModule;

  // Pipelines
  #seedComputePipeline!: GPUComputePipeline;
  #jfaComputePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Storage buffers for distance field data (ping-pong between passes)
  #distanceBuffers: GPUBuffer[] = [];

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
    this.#renderVertexShaderModule = this.#device.createShaderModule({ code: renderVertexShader });
    this.#renderFragmentShaderModule = this.#device.createShaderModule({ code: renderFragmentShader });

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
        module: this.#renderVertexShaderModule,
        entryPoint: 'main',
      },
      fragment: {
        module: this.#renderFragmentShaderModule,
        entryPoint: 'main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });

    this.#renderBindGroupLayout = this.#renderPipeline.getBindGroupLayout(0);
  }

  #initBuffers() {
    const width = this.#canvas.width;
    const height = this.#canvas.height;

    // Each pixel stores: vec4<f32> (seedX, seedY, shapeID, distance)
    // 4 floats * 4 bytes = 16 bytes per pixel
    const bufferSize = width * height * 16;

    // Create ping-pong storage buffers
    for (let i = 0; i < 2; i++) {
      this.#distanceBuffers[i] = this.#device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
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
    // Struct layout: width(u32), height(u32), stepSize(u32), shapeCount(u32), aspectRatio(f32), _pad1(f32), _pad2(f32), _pad3(f32)
    let stepSize = maxStepSize;
    for (let i = 0; i < jfaPassCount; i++) {
      const paramsData = new ArrayBuffer(32);
      const uintView = new Uint32Array(paramsData, 0, 4);
      const floatView = new Float32Array(paramsData, 16, 4);

      uintView[0] = width;
      uintView[1] = height;
      uintView[2] = stepSize;
      uintView[3] = this.#shapeCount;
      floatView[0] = aspectRatio;

      const buffer = this.#device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(paramsData));
      buffer.unmap();
      paramsBuffers.push(buffer);
      stepSize >>= 1;
    }

    const encoder = this.#device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    // Step 1: Initialize seeds
    const seedBindGroup = this.#device.createBindGroup({
      layout: this.#seedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#distanceBuffers[0] } },
        { binding: 1, resource: { buffer: paramsBuffers[0] } },
        { binding: 2, resource: { buffer: this.#shapeDataBuffer } },
      ],
    });

    computePass.setPipeline(this.#seedComputePipeline);
    computePass.setBindGroup(0, seedBindGroup);
    computePass.dispatchWorkgroups(workgroupsX, workgroupsY);

    // TODO: Check if running all JFA passes in a single compute pass causes synchronization issues.
    // WebGPU may not guarantee proper memory synchronization between storage buffer writes/reads
    // within the same compute pass. If artifacts appear, split into separate compute passes.

    // Step 2: Run all JFA passes
    this.#currentBufferIndex = 0;

    for (let i = 0; i < jfaPassCount; i++) {
      const inputBuffer = this.#distanceBuffers[this.#currentBufferIndex];
      const outputBuffer = this.#distanceBuffers[1 - this.#currentBufferIndex];

      const bindGroup = this.#device.createBindGroup({
        layout: this.#jfaBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
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
        { binding: 0, resource: { buffer: this.#distanceBuffers[this.#currentBufferIndex] } },
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

    // Reinitialize buffers with new size
    this.#distanceBuffers.forEach((buffer) => buffer.destroy());
    this.#initBuffers();

    // Rerun algorithm
    this.#updateShapeData();
    this.#runJumpFloodingAlgorithm();
  };

  #cleanupResources() {
    this.#distanceBuffers.forEach((buffer) => buffer.destroy());
    this.#shapeDataBuffer?.destroy();
  }
}

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

const MAX_DISTANCE: f32 = ${FolkDistanceFieldWebGPU.MAX_DISTANCE};

@group(0) @binding(0) var<storage, read_write> distanceField: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> shapes: array<ShapeData>;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }

  let index = coord.y * params.width + coord.x;
  let pixel = vec2<f32>(coord) / vec2<f32>(f32(params.width), f32(params.height));
  
  var minDist = MAX_DISTANCE;
  var nearestSeed = vec2<f32>(-1.0, -1.0); // Use -1,-1 as "no seed" marker
  var shapeID = 0.0;
  
  // Check all shapes to see if this pixel is inside any
  for (var i = 0u; i < params.shapeCount; i++) {
    let shape = shapes[i];
    
    // Check if pixel is inside this shape
    if (pixel.x >= shape.minX && pixel.x <= shape.maxX &&
        pixel.y >= shape.minY && pixel.y <= shape.maxY) {
      // Inside shape - this is a seed point with distance 0
      nearestSeed = pixel;
      shapeID = shape.shapeID;
      minDist = 0.0;
      break;
    }
  }
  
  // Write initial seed data
  distanceField[index] = vec4<f32>(nearestSeed.x, nearestSeed.y, shapeID, minDist);
}
`;

/**
 * Compute shader for JFA passes.
 * Updates each pixel with the nearest seed by checking neighbors at step distance.
 */
const jfaComputeShader = /*wgsl*/ `
${paramsStruct}

@group(0) @binding(0) var<storage, read> inputField: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> outputField: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coord = global_id.xy;
  
  if (coord.x >= params.width || coord.y >= params.height) {
    return;
  }

  let index = coord.y * params.width + coord.x;
  let pixel = vec2<f32>(coord) / vec2<f32>(f32(params.width), f32(params.height));
  
  var nearest = inputField[index];
  var minDist = nearest.w;
  
  let step = i32(params.stepSize);
  
  // Check 9 neighbors in a grid around current pixel
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let neighborCoord = vec2<i32>(coord) + vec2<i32>(dx, dy) * step;
      
      // Check bounds
      if (neighborCoord.x < 0 || neighborCoord.x >= i32(params.width) || 
          neighborCoord.y < 0 || neighborCoord.y >= i32(params.height)) {
        continue;
      }
      
      let neighborIndex = u32(neighborCoord.y) * params.width + u32(neighborCoord.x);
      let neighbor = inputField[neighborIndex];
      
      // Skip if no seed assigned yet (check for -1,-1 marker)
      if (neighbor.x < 0.0) {
        continue;
      }

      // Calculate distance with aspect ratio correction
      let seedPos = vec2<f32>(neighbor.x * params.aspectRatio, neighbor.y);
      let pixelPos = vec2<f32>(pixel.x * params.aspectRatio, pixel.y);
      let dist = distance(seedPos, pixelPos);

      if (dist < minDist) {
        nearest = vec4<f32>(neighbor.x, neighbor.y, neighbor.z, dist);
        minDist = dist;
      }
    }
  }
  
  outputField[index] = nearest;
}
`;

/**
 * Vertex shader for fullscreen quad rendering.
 */
const renderVertexShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
}

@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;
  
  // Generate fullscreen quad from vertex index
  let x = f32((vertexIndex & 1u) << 1u) - 1.0;
  let y = f32((vertexIndex & 2u)) - 1.0;
  
  output.position = vec4<f32>(x, y, 0.0, 1.0);
  output.texCoord = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  
  return output;
}
`;

/**
 * Fragment shader for visualizing the distance field.
 */
const renderFragmentShader = /*wgsl*/ `
${paramsStruct}

@group(0) @binding(0) var<storage, read> distanceField: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@fragment
fn main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let coord = vec2<u32>(texCoord * vec2<f32>(f32(params.width), f32(params.height)));
  let index = coord.y * params.width + coord.x;
  
  let data = distanceField[index];
  let shapeID = data.z;
  let distance = data.w;
  
  // Generate color from shape ID using golden ratio for nice distribution
  let hue = fract(shapeID * 0.61803398875);
  var color = hsv2rgb(vec3<f32>(hue, 0.5, 0.95));
  
  // Apply exponential falloff (distance is in normalized [0,1] coordinates)
  let falloff = 8.0;
  color *= exp(-distance * falloff);
  
  return vec4<f32>(color, 1.0);
}
`;
