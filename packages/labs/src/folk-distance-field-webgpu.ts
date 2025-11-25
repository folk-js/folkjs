import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

/** A raw tagged template literal that just provides WGSL syntax highlighting/LSP support. */
const wgsl = String.raw;

/**
 * The DistanceField class calculates a distance field using the Jump Flooding Algorithm (JFA) in WebGPU.
 * It uses compute shaders for seed initialization and JFA passes, eliminating the need for ping-pong textures.
 * Previous implementations: WebGL2 (folk-distance-field.ts), CPU-based (github.com/folk-canvas/folk-canvas/commit/fdd7fb9d84d93ad665875cad25783c232fd17bcc)
 */
export class FolkDistanceFieldWebGPU extends FolkBaseSet {
  static override tagName = 'folk-distance-field-webgpu';

  static readonly MAX_DISTANCE = 99999.0;

  #canvas!: HTMLCanvasElement;
  #device!: any; // GPUDevice
  #context!: any; // GPUCanvasContext
  #presentationFormat!: any; // GPUTextureFormat

  // Compute pipelines
  #seedComputePipeline!: any; // GPUComputePipeline
  #jfaComputePipeline!: any; // GPUComputePipeline

  // Render pipeline
  #renderPipeline!: any; // GPURenderPipeline

  // Storage buffers for distance field data (ping-pong)
  #distanceBuffers: any[] = []; // GPUBuffer[]
  #bufferSize = 0;

  // Shape data buffer
  #shapeDataBuffer!: any; // GPUBuffer
  #shapeCount = 0;

  // Uniform buffers
  #paramsBuffer!: any; // GPUBuffer

  // Bind groups
  #seedBindGroup!: any; // GPUBindGroup
  #jfaBindGroups: any[] = []; // GPUBindGroup[]
  #renderBindGroup!: any; // GPUBindGroup

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

    this.#cleanupWebGPUResources();
  }

  async #initWebGPU() {
    const nav = navigator as any;
    if (!nav.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await nav.gpu.requestAdapter();
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
    this.#presentationFormat = nav.gpu.getPreferredCanvasFormat();

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });
  }

  async #initPipelines() {
    // Create compute pipeline for seed initialization
    this.#seedComputePipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.#device.createShaderModule({ code: seedComputeShader }),
        entryPoint: 'main',
      },
    });

    // Create compute pipeline for JFA passes
    this.#jfaComputePipeline = this.#device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.#device.createShaderModule({ code: jfaComputeShader }),
        entryPoint: 'main',
      },
    });

    // Create render pipeline for visualization
    this.#renderPipeline = this.#device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: this.#device.createShaderModule({ code: renderVertexShader }),
        entryPoint: 'main',
      },
      fragment: {
        module: this.#device.createShaderModule({ code: renderFragmentShader }),
        entryPoint: 'main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });
  }

  #initBuffers() {
    const width = this.#canvas.width;
    const height = this.#canvas.height;

    // Each pixel stores: vec4<f32> (seedX, seedY, shapeID, distance)
    // 4 floats * 4 bytes = 16 bytes per pixel
    this.#bufferSize = width * height * 16;

    const BufferUsage = (window as any).GPUBufferUsage;

    // Create ping-pong storage buffers
    for (let i = 0; i < 2; i++) {
      this.#distanceBuffers[i] = this.#device.createBuffer({
        size: this.#bufferSize,
        usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
      });
    }

    // Create params buffer for canvas size and step size
    this.#paramsBuffer = this.#device.createBuffer({
      size: 16, // vec4<u32>: width, height, stepSize, shapeCount
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });

    // Shape data buffer will be created on first update
    // this.#shapeDataBuffer will be initialized in #updateShapeData
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

      // Store shape as: minX, minY, maxX, maxY, shapeID, padding...
      shapeData.push(left, top, right, bottom, shapeID, 0, 0, 0);
    });

    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      return;
    }

    // Resize shape data buffer if needed
    const requiredSize = shapeData.length * 4; // 4 bytes per float32
    const BufferUsage = (window as any).GPUBufferUsage;

    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      if (this.#shapeDataBuffer) {
        this.#shapeDataBuffer.destroy();
      }
      this.#shapeDataBuffer = this.#device.createBuffer({
        size: requiredSize,
        usage: BufferUsage.STORAGE | BufferUsage.COPY_DST,
      });
    }

    // Upload shape data
    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));
  }

  #runJumpFloodingAlgorithm() {
    if (this.#shapeCount === 0) return;

    const width = this.#canvas.width;
    const height = this.#canvas.height;

    // Update params buffer BEFORE creating command encoder
    this.#device.queue.writeBuffer(this.#paramsBuffer, 0, new Uint32Array([width, height, 0, this.#shapeCount]));

    const encoder = this.#device.createCommandEncoder();

    // Step 1: Initialize seeds
    this.#seedBindGroup = this.#device.createBindGroup({
      layout: this.#seedComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#distanceBuffers[0] } },
        { binding: 1, resource: { buffer: this.#paramsBuffer } },
        { binding: 2, resource: { buffer: this.#shapeDataBuffer } },
      ],
    });

    const seedPass = encoder.beginComputePass();
    seedPass.setPipeline(this.#seedComputePipeline);
    seedPass.setBindGroup(0, this.#seedBindGroup);
    seedPass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
    seedPass.end();

    // Submit the seed pass
    this.#device.queue.submit([encoder.finish()]);

    // Step 2: Run JFA passes - each in its own command buffer for proper synchronization
    let stepSize = 1 << Math.floor(Math.log2(Math.max(width, height)));
    this.#currentBufferIndex = 0;

    while (stepSize >= 1) {
      const inputBuffer = this.#distanceBuffers[this.#currentBufferIndex];
      const outputBuffer = this.#distanceBuffers[1 - this.#currentBufferIndex];

      // Write step size for this pass
      const paramsData = new Uint32Array([width, height, stepSize, this.#shapeCount]);
      this.#device.queue.writeBuffer(this.#paramsBuffer, 0, paramsData);

      const jfaEncoder = this.#device.createCommandEncoder();

      const bindGroup = this.#device.createBindGroup({
        layout: this.#jfaComputePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: inputBuffer } },
          { binding: 1, resource: { buffer: outputBuffer } },
          { binding: 2, resource: { buffer: this.#paramsBuffer } },
        ],
      });

      const jfaPass = jfaEncoder.beginComputePass();
      jfaPass.setPipeline(this.#jfaComputePipeline);
      jfaPass.setBindGroup(0, bindGroup);
      jfaPass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      jfaPass.end();

      // Submit this JFA pass
      this.#device.queue.submit([jfaEncoder.finish()]);

      this.#currentBufferIndex = 1 - this.#currentBufferIndex;
      stepSize >>= 1;
    }

    // Step 3: Render to screen in a final pass
    const renderEncoder = this.#device.createCommandEncoder();

    this.#renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.#distanceBuffers[this.#currentBufferIndex] } },
        { binding: 1, resource: { buffer: this.#paramsBuffer } },
      ],
    });

    const renderPass = renderEncoder.beginRenderPass({
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
    renderPass.setBindGroup(0, this.#renderBindGroup);
    renderPass.draw(4);
    renderPass.end();

    this.#device.queue.submit([renderEncoder.finish()]);
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

  #cleanupWebGPUResources() {
    this.#distanceBuffers.forEach((buffer) => buffer.destroy());
    this.#shapeDataBuffer?.destroy();
    this.#paramsBuffer?.destroy();
  }
}

/**
 * Compute shader for seed initialization.
 * Rasterizes shapes and marks pixels inside them as seed points.
 */
const seedComputeShader = wgsl`
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  shapeCount: u32,
}

struct ShapeData {
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
  shapeID: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
}

@group(0) @binding(0) var<storage, read_write> distanceField: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var<storage, read> shapes: array<ShapeData>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }

  let index = y * params.width + x;
  let pixel = vec2<f32>(f32(x) / f32(params.width), f32(y) / f32(params.height));
  
  var minDist = 99999.0;
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
const jfaComputeShader = wgsl`
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  shapeCount: u32,
}

@group(0) @binding(0) var<storage, read> inputField: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> outputField: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let x = global_id.x;
  let y = global_id.y;
  
  if (x >= params.width || y >= params.height) {
    return;
  }

  let index = y * params.width + x;
  let pixel = vec2<f32>(f32(x) / f32(params.width), f32(y) / f32(params.height));
  
  var nearest = inputField[index];
  var minDist = nearest.w;
  
  let step = i32(params.stepSize);
  let aspectRatio = f32(params.width) / f32(params.height);
  
  // Check 9 neighbors in a grid around current pixel
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let nx = i32(x) + dx * step;
      let ny = i32(y) + dy * step;
      
      // Check bounds
      if (nx < 0 || nx >= i32(params.width) || ny < 0 || ny >= i32(params.height)) {
        continue;
      }
      
      let neighborIndex = u32(ny) * params.width + u32(nx);
      let neighbor = inputField[neighborIndex];
      
      // Skip if no seed assigned yet (check for -1,-1 marker)
      if (neighbor.x < 0.0) {
        continue;
      }
      
      // Calculate distance with aspect ratio correction
      let seedPos = vec2<f32>(neighbor.x * aspectRatio, neighbor.y);
      let pixelPos = vec2<f32>(pixel.x * aspectRatio, pixel.y);
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
const renderVertexShader = wgsl`
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
const renderFragmentShader = wgsl`
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  shapeCount: u32,
}

@group(0) @binding(0) var<storage, read> distanceField: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> params: Params;

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@fragment
fn main(@location(0) texCoord: vec2<f32>) -> @location(0) vec4<f32> {
  let x = u32(texCoord.x * f32(params.width));
  let y = u32(texCoord.y * f32(params.height));
  let index = y * params.width + x;
  
  let data = distanceField[index];
  let shapeID = data.z;
  let distance = data.w;
  
  // Generate color from shape ID using golden ratio for nice distribution
  let hue = fract(shapeID * 0.61803398875);
  var color = hsv2rgb(vec3<f32>(hue, 0.5, 0.95));
  
  // Apply exponential falloff (distance is in normalized [0,1] coordinates)
  let falloff = 2.0; // Tune this for desired glow size
  color *= exp(-distance * falloff);
  
  return vec4<f32>(color, 1.0);
}
`;
