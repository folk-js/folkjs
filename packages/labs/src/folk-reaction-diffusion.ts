import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

// Reaction-diffusion compute shader constants
// Based on: https://tympanus.net/codrops/2024/05/01/reaction-diffusion-compute-shader-in-webgpu/
const KERNEL_SIZE = 3;
const WORKGROUP_SIZE = [8, 8];
const TILE_SIZE = [2, 2];
const CACHE_SIZE = [TILE_SIZE[0] * WORKGROUP_SIZE[0], TILE_SIZE[1] * WORKGROUP_SIZE[1]]; // [16, 16]
const DISPATCH_SIZE = [CACHE_SIZE[0] - (KERNEL_SIZE - 1), CACHE_SIZE[1] - (KERNEL_SIZE - 1)]; // [14, 14]

// Resolution scale for the simulation (fraction of canvas size)
const SIMULATION_SCALE = 0.5;

// Number of RD iterations per frame
const ITERATIONS_PER_FRAME = 8;

/**
 * WebGPU-based reaction-diffusion simulation.
 * Uses compute shaders with workgroup caching for efficient convolution.
 * DOM elements are rasterized to a seed texture that influences the simulation.
 */
export class FolkReactionDiffusion extends FolkBaseSet {
  static override tagName = 'folk-reaction-diffusion';

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // Seed canvas for rasterizing DOM elements
  #seedCanvas!: HTMLCanvasElement;
  #seedCtx!: CanvasRenderingContext2D;

  // Shader modules
  #rdComputeModule!: GPUShaderModule;
  #compositeModule!: GPUShaderModule;

  // Pipelines
  #rdComputePipeline!: GPUComputePipeline;
  #compositePipeline!: GPURenderPipeline;

  // Bind group layouts
  #rdBindGroupLayout!: GPUBindGroupLayout;
  #compositeBindGroupLayout!: GPUBindGroupLayout;

  // Storage textures for ping-pong (rgba16float for RD simulation)
  #rdTextures: GPUTexture[] = [];
  #currentTextureIndex = 0;

  // Seed texture (from DOM elements)
  #seedTexture!: GPUTexture;

  // Uniforms
  #animationUniformBuffer!: GPUBuffer;
  #paramsUniformBuffer!: GPUBuffer;

  // Sampler for composite pass
  #sampler!: GPUSampler;

  // Animation state
  #animationFrameId = 0;
  #startTime = 0;
  #pulse = 0;
  #pointerPos = { x: 0.5, y: 0.5 };
  #pointerVelocity = { x: 0, y: 0 };
  #lastPointerPos = { x: 0.5, y: 0.5 };
  #isInitialized = false;

  // Simulation dimensions (scaled down from canvas)
  #simWidth = 0;
  #simHeight = 0;

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    await this.#initPipelines();
    this.#initResources();

    window.addEventListener('resize', this.#handleResize);
    window.addEventListener('pointermove', this.#handlePointerMove);

    this.#isInitialized = true;
    this.#startTime = performance.now();
    this.#startAnimationLoop();

    // Trigger initial render
    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#handleResize);
    window.removeEventListener('pointermove', this.#handlePointerMove);
    cancelAnimationFrame(this.#animationFrameId);
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

    // Main canvas for display
    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#canvas.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%;';
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

    // Seed canvas for rasterizing DOM elements
    this.#seedCanvas = document.createElement('canvas');
    const seedCtx = this.#seedCanvas.getContext('2d', { willReadFrequently: true });
    if (!seedCtx) {
      throw new Error('Failed to get 2D context for seed canvas.');
    }
    this.#seedCtx = seedCtx;
  }

  async #initPipelines() {
    // Create shader modules
    this.#rdComputeModule = this.#device.createShaderModule({
      label: 'Reaction-Diffusion Compute Shader',
      code: rdComputeShader,
    });

    this.#compositeModule = this.#device.createShaderModule({
      label: 'Composite Shader',
      code: compositeShader,
    });

    // Create compute pipeline for reaction-diffusion
    this.#rdComputePipeline = this.#device.createComputePipeline({
      label: 'RD Compute Pipeline',
      layout: 'auto',
      compute: {
        module: this.#rdComputeModule,
        entryPoint: 'compute_main',
      },
    });

    this.#rdBindGroupLayout = this.#rdComputePipeline.getBindGroupLayout(0);

    // Create render pipeline for composite
    this.#compositePipeline = this.#device.createRenderPipeline({
      label: 'Composite Pipeline',
      layout: 'auto',
      vertex: {
        module: this.#compositeModule,
        entryPoint: 'vertex_main',
      },
      fragment: {
        module: this.#compositeModule,
        entryPoint: 'frag_main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    this.#compositeBindGroupLayout = this.#compositePipeline.getBindGroupLayout(0);
  }

  #initResources() {
    // Calculate simulation dimensions
    this.#simWidth = Math.floor((this.#canvas.width || 800) * SIMULATION_SCALE);
    this.#simHeight = Math.floor((this.#canvas.height || 600) * SIMULATION_SCALE);

    // Update seed canvas size
    this.#seedCanvas.width = this.#simWidth;
    this.#seedCanvas.height = this.#simHeight;

    // Create ping-pong textures for RD simulation
    this.#rdTextures = [0, 1].map((i) =>
      this.#device.createTexture({
        label: `RD Texture ${i}`,
        size: { width: this.#simWidth, height: this.#simHeight },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
    );

    // Create seed texture
    this.#seedTexture = this.#device.createTexture({
      label: 'Seed Texture',
      size: { width: this.#simWidth, height: this.#simHeight },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Create sampler for composite pass
    this.#sampler = this.#device.createSampler({
      minFilter: 'linear',
      magFilter: 'linear',
    });

    // Create uniform buffers
    // Animation uniforms: pulse (f32), padding (f32), pointerVelocity (vec2f), pointerPos (vec2f) = 24 bytes, align to 32
    this.#animationUniformBuffer = this.#device.createBuffer({
      label: 'Animation Uniforms',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Params uniforms: width (u32), height (u32) = 8 bytes, align to 16
    this.#paramsUniformBuffer = this.#device.createBuffer({
      label: 'Params Uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write initial params
    this.#device.queue.writeBuffer(this.#paramsUniformBuffer, 0, new Uint32Array([this.#simWidth, this.#simHeight]));

    // Initialize RD textures with chemical A = 1, chemical B = 0
    this.#initializeSimulation();
  }

  #initializeSimulation() {
    // WebGPU requires bytesPerRow to be a multiple of 256
    const bytesPerPixel = 8; // rgba16float = 4 × 2 bytes
    const unpaddedBytesPerRow = this.#simWidth * bytesPerPixel;
    const paddedBytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
    const paddedWidth = paddedBytesPerRow / bytesPerPixel;

    // Create initial data with padding: A = 1.0, B = 0.0 everywhere
    const initData = new Float32Array(paddedWidth * this.#simHeight * 4);
    for (let y = 0; y < this.#simHeight; y++) {
      for (let x = 0; x < this.#simWidth; x++) {
        const idx = (y * paddedWidth + x) * 4;
        initData[idx + 0] = 1.0; // Chemical A
        initData[idx + 1] = 0.0; // Chemical B
        initData[idx + 2] = 0.0; // unused
        initData[idx + 3] = 1.0; // unused
      }
    }

    // Add some random seeds for chemical B in the center
    const centerX = Math.floor(this.#simWidth / 2);
    const centerY = Math.floor(this.#simHeight / 2);
    const seedRadius = Math.min(this.#simWidth, this.#simHeight) / 8;

    for (let y = 0; y < this.#simHeight; y++) {
      for (let x = 0; x < this.#simWidth; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < seedRadius && Math.random() < 0.3) {
          const idx = (y * paddedWidth + x) * 4;
          initData[idx + 1] = 1.0; // Add chemical B
        }
      }
    }

    // Convert to Float16 for rgba16float texture
    const bufferSize = paddedWidth * this.#simHeight * 4 * 2; // 2 bytes per float16
    const stagingBuffer = this.#device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: true,
    });

    // Convert float32 to float16
    const float16Data = new Uint16Array(stagingBuffer.getMappedRange());
    for (let i = 0; i < initData.length; i++) {
      float16Data[i] = float32ToFloat16(initData[i]);
    }
    stagingBuffer.unmap();

    // Copy to both textures
    const encoder = this.#device.createCommandEncoder();
    for (const texture of this.#rdTextures) {
      encoder.copyBufferToTexture(
        { buffer: stagingBuffer, bytesPerRow: paddedBytesPerRow },
        { texture },
        { width: this.#simWidth, height: this.#simHeight },
      );
    }
    this.#device.queue.submit([encoder.finish()]);
    stagingBuffer.destroy();
  }

  /**
   * Handles updates to geometry elements by updating the seed texture.
   */
  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (!this.#isInitialized) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#updateSeedTexture();
  }

  #updateSeedTexture() {
    // Clear seed canvas
    this.#seedCtx.fillStyle = 'black';
    this.#seedCtx.fillRect(0, 0, this.#seedCanvas.width, this.#seedCanvas.height);

    // Draw source elements as white shapes
    this.#seedCtx.fillStyle = 'white';

    const containerWidth = this.clientWidth || 1;
    const containerHeight = this.clientHeight || 1;

    this.sourceRects.forEach((rect) => {
      // Scale to simulation dimensions
      const x = (rect.left / containerWidth) * this.#simWidth;
      const y = (rect.top / containerHeight) * this.#simHeight;
      const w = (rect.width / containerWidth) * this.#simWidth;
      const h = (rect.height / containerHeight) * this.#simHeight;

      this.#seedCtx.fillRect(x, y, w, h);
    });

    // Upload to GPU
    const imageData = this.#seedCtx.getImageData(0, 0, this.#seedCanvas.width, this.#seedCanvas.height);

    this.#device.queue.writeTexture(
      { texture: this.#seedTexture },
      imageData.data,
      { bytesPerRow: this.#seedCanvas.width * 4 },
      { width: this.#seedCanvas.width, height: this.#seedCanvas.height },
    );
  }

  #startAnimationLoop() {
    const animate = () => {
      this.#animationFrameId = requestAnimationFrame(animate);

      // Update pulse (sinusoidal animation)
      const elapsed = (performance.now() - this.#startTime) / 1000;
      this.#pulse = Math.sin(elapsed * 0.5) * 0.5 + 0.5;

      // Update pointer velocity with smoothing
      const velX = (this.#pointerPos.x - this.#lastPointerPos.x) * 0.5;
      const velY = (this.#pointerPos.y - this.#lastPointerPos.y) * 0.5;
      this.#pointerVelocity.x = this.#pointerVelocity.x * 0.9 + velX * 0.1;
      this.#pointerVelocity.y = this.#pointerVelocity.y * 0.9 + velY * 0.1;
      this.#lastPointerPos = { ...this.#pointerPos };

      this.#render();
    };

    animate();
  }

  #render() {
    // Update animation uniforms
    const animData = new ArrayBuffer(32);
    const animFloats = new Float32Array(animData);
    animFloats[0] = this.#pulse;
    animFloats[1] = 0; // padding
    animFloats[2] = this.#pointerVelocity.x;
    animFloats[3] = this.#pointerVelocity.y;
    animFloats[4] = this.#pointerPos.x * 2 - 1; // Convert to [-1, 1]
    animFloats[5] = this.#pointerPos.y * 2 - 1;
    this.#device.queue.writeBuffer(this.#animationUniformBuffer, 0, animData);

    const encoder = this.#device.createCommandEncoder();

    // Run multiple RD iterations
    for (let i = 0; i < ITERATIONS_PER_FRAME; i++) {
      const inputTexture = this.#rdTextures[this.#currentTextureIndex];
      const outputTexture = this.#rdTextures[1 - this.#currentTextureIndex];

      const computePass = encoder.beginComputePass();

      const bindGroup = this.#device.createBindGroup({
        layout: this.#rdBindGroupLayout,
        entries: [
          { binding: 0, resource: inputTexture.createView() },
          { binding: 1, resource: outputTexture.createView() },
          { binding: 2, resource: this.#seedTexture.createView() },
          { binding: 3, resource: { buffer: this.#animationUniformBuffer } },
        ],
      });

      computePass.setPipeline(this.#rdComputePipeline);
      computePass.setBindGroup(0, bindGroup);

      // Dispatch workgroups to cover the simulation area
      const dispatchX = Math.ceil(this.#simWidth / DISPATCH_SIZE[0]);
      const dispatchY = Math.ceil(this.#simHeight / DISPATCH_SIZE[1]);
      computePass.dispatchWorkgroups(dispatchX, dispatchY);

      computePass.end();

      // Swap textures
      this.#currentTextureIndex = 1 - this.#currentTextureIndex;
    }

    // Composite pass - render to screen
    const compositeBindGroup = this.#device.createBindGroup({
      layout: this.#compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#animationUniformBuffer } },
        { binding: 1, resource: this.#sampler },
        { binding: 2, resource: this.#rdTextures[this.#currentTextureIndex].createView() },
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

    renderPass.setPipeline(this.#compositePipeline);
    renderPass.setBindGroup(0, compositeBindGroup);
    renderPass.draw(3); // Fullscreen triangle
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
  }

  #handleResize = () => {
    // Update canvas size
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;

    // Reconfigure context
    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    // Cleanup old resources
    this.#rdTextures.forEach((t) => t.destroy());
    this.#seedTexture.destroy();

    // Reinitialize with new size
    this.#initResources();
    this.#updateSeedTexture();
  };

  #handlePointerMove = (e: PointerEvent) => {
    const rect = this.#canvas.getBoundingClientRect();
    this.#pointerPos = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  };

  #cleanupResources() {
    this.#rdTextures.forEach((t) => t.destroy());
    this.#seedTexture?.destroy();
    this.#animationUniformBuffer?.destroy();
    this.#paramsUniformBuffer?.destroy();
  }
}

// Helper: Convert float32 to float16
function float32ToFloat16(val: number): number {
  const floatView = new Float32Array(1);
  const int32View = new Int32Array(floatView.buffer);

  floatView[0] = val;
  const x = int32View[0];

  let bits = (x >> 16) & 0x8000; // Sign
  let m = (x >> 12) & 0x07ff; // Mantissa
  const e = (x >> 23) & 0xff; // Exponent

  if (e < 103) {
    return bits;
  }

  if (e > 142) {
    bits |= 0x7c00;
    bits |= (e === 255 ? 0 : 1) && x & 0x007fffff;
    return bits;
  }

  if (e < 113) {
    m |= 0x0800;
    bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);
    return bits;
  }

  bits |= ((e - 112) << 10) | (m >> 1);
  bits += m & 1;
  return bits;
}

/**
 * Reaction-Diffusion Compute Shader
 * Uses workgroup caching for efficient laplacian kernel convolution.
 */
const rdComputeShader = /*wgsl*/ `
const kernelSize = ${KERNEL_SIZE}u;
const dispatchSize = vec2u(${DISPATCH_SIZE[0]}u, ${DISPATCH_SIZE[1]}u);
const tileSize = vec2u(${TILE_SIZE[0]}u, ${TILE_SIZE[1]}u);
const cacheSize = vec2u(${CACHE_SIZE[0]}u, ${CACHE_SIZE[1]}u);

// Laplacian kernel for diffusion
const laplacian: array<f32, 9> = array(
  0.05, 0.20, 0.05,
  0.20, -1.0, 0.20,
  0.05, 0.20, 0.05,
);

struct AnimationUniforms {
  pulse: f32,
  _pad: f32,
  pointerVelocity: vec2f,
  pointerPos: vec2f,
}

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var seedTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> animationUniforms: AnimationUniforms;

// Manual bilinear sampling for fractional coordinates
fn texture2D_bilinear(t: texture_2d<f32>, coord: vec2f, dims: vec2u) -> vec4f {
  let f: vec2f = fract(coord);
  let sample: vec2u = vec2u(coord + (0.5 - f));
  let maxCoord = dims - vec2u(1u);
  
  let tl: vec4f = textureLoad(t, clamp(sample, vec2u(0u), maxCoord), 0);
  let tr: vec4f = textureLoad(t, clamp(sample + vec2u(1u, 0u), vec2u(0u), maxCoord), 0);
  let bl: vec4f = textureLoad(t, clamp(sample + vec2u(0u, 1u), vec2u(0u), maxCoord), 0);
  let br: vec4f = textureLoad(t, clamp(sample + vec2u(1u, 1u), vec2u(0u), maxCoord), 0);
  
  let tA: vec4f = mix(tl, tr, f.x);
  let tB: vec4f = mix(bl, br, f.x);
  return mix(tA, tB, f.y);
}

// Workgroup cache for texture lookups
var<workgroup> cache: array<array<vec4f, ${CACHE_SIZE[0]}>, ${CACHE_SIZE[1]}>;

@compute @workgroup_size(${WORKGROUP_SIZE[0]}, ${WORKGROUP_SIZE[1]}, 1)
fn compute_main(
  @builtin(workgroup_id) workGroupID: vec3u,
  @builtin(local_invocation_id) localInvocationID: vec3u,
) {
  let kernelOffset: vec2u = vec2u((kernelSize - 1u) / 2u);
  let tileOffset: vec2u = localInvocationID.xy * tileSize;
  let dispatchOffset: vec2u = workGroupID.xy * dispatchSize;
  
  let dims: vec2u = textureDimensions(inputTex, 0);
  let dimsF = vec2f(dims);
  let aspectFactor: vec2f = dimsF / f32(max(dims.x, dims.y));

  // Load pixels into workgroup cache
  for (var c = 0u; c < tileSize.x; c++) {
    for (var r = 0u; r < tileSize.y; r++) {
      let local: vec2u = vec2u(c, r) + tileOffset;
      var sampleCoord: vec2i = vec2i(dispatchOffset + local) - vec2i(kernelOffset);
      
      // Clamp to edges
      sampleCoord = clamp(sampleCoord, vec2i(0), vec2i(dims) - vec2i(1));
      
      // Calculate UV for motion effects
      var sampleCoordF = vec2f(sampleCoord);
      var sampleUv: vec2f = sampleCoordF / dimsF;
      
      // Center pulse motion - push outward from center
      sampleCoordF -= (sampleUv * 2.0 - 1.0) * 0.01 * (2.0 * animationUniforms.pulse + 2.0 + 1.5);
      
      // Pointer influence - move pixels based on pointer velocity
      let st = ((sampleUv * 2.0 - 1.0) * aspectFactor) * 0.5 + 0.5;
      let pointerPos = (animationUniforms.pointerPos * aspectFactor) * 0.5 + 0.5;
      var pointerMask = smoothstep(0.6, 1.0, 1.0 - min(1.0, distance(st, pointerPos)));
      sampleCoordF -= animationUniforms.pointerVelocity * 80.0 * pointerMask;
      
      // Sample with bilinear interpolation
      let input: vec4f = texture2D_bilinear(inputTex, sampleCoordF, dims);
      
      // Get seed value
      let seed: vec4f = textureLoad(seedTex, vec2u(sampleCoord), 0);
      
      // Store: R = chemical A, G = chemical B, B = seed value
      cache[local.y][local.x] = vec4f(input.rg, seed.r, 0.0);
    }
  }
  
  workgroupBarrier();
  
  // Process pixels within valid bounds
  let bounds: vec4u = vec4u(
    dispatchOffset,
    min(dims, dispatchOffset + dispatchSize)
  );
  
  for (var c = 0u; c < tileSize.x; c++) {
    for (var r = 0u; r < tileSize.y; r++) {
      let local: vec2u = vec2u(c, r) + tileOffset;
      let sample: vec2u = dispatchOffset + local - kernelOffset;
      
      if (all(sample >= bounds.xy) && all(sample < bounds.zw)) {
        let uv: vec2f = (2.0 * vec2f(sample) / vec2f(dims)) - 1.0;
        
        // Laplacian convolution
        var lap = vec2f(0.0);
        for (var x = 0; x < 3; x++) {
          for (var y = 0; y < 3; y++) {
            let i = vec2i(local) + vec2i(x, y) - vec2i(kernelOffset);
            lap += cache[i.y][i.x].xy * laplacian[y * 3 + x];
          }
        }
        
        // Pointer influence on diffusion rate
        let st = (uv * aspectFactor) * 0.5 + 0.5;
        let pointerPos = (animationUniforms.pointerPos * aspectFactor) * 0.5 + 0.5;
        var pointerMask = smoothstep(0.6, 1.0, 1.0 - min(1.0, distance(st, pointerPos)));
        pointerMask = pointerMask * length(animationUniforms.pointerVelocity) * 30.0;
        
        // Distance from center affects parameters
        let dist = mix(dot(uv.xx, uv.xx), dot(uv.yy, uv.yy), step(1.4, f32(dims.x) / f32(dims.y)));
        
        // Reaction-diffusion parameters
        let cacheValue: vec4f = cache[local.y][local.x];
        let dA = 1.0 - dist * 0.15;
        var dB = 0.25 + dist * 0.1;
        dB = dB + 0.1 * (animationUniforms.pulse * 0.5 + 0.5);
        dB = dB - min(0.15, 0.2 * pointerMask);
        dB = max(0.1, dB);
        
        let feed = 0.065;
        var kill = 0.06;
        // Seed areas affect kill rate
        kill = kill + cacheValue.b * 0.05 * (animationUniforms.pulse * 0.3 + 0.7);
        
        // Gray-Scott reaction-diffusion
        let A = cacheValue.x;
        let B = cacheValue.y;
        let reaction = A * B * B;
        
        let rd = vec2f(
          A + (dA * lap.x - reaction + feed * (1.0 - A)),
          B + (dB * lap.y + reaction - (kill + feed) * B),
        );
        
        textureStore(outputTex, sample, vec4f(clamp(rd, vec2f(0.0), vec2f(1.0)), 0.0, 1.0));
      }
    }
  }
}
`;

/**
 * Composite Shader - renders the RD simulation with visual effects.
 * Includes bulge distortion, color palette, emboss, iridescence, and vignette.
 */
const compositeShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

struct AnimationUniforms {
  pulse: f32,
  _pad: f32,
  pointerVelocity: vec2f,
  pointerPos: vec2f,
}

@group(0) @binding(0) var<uniform> animationUniforms: AnimationUniforms;
@group(0) @binding(1) var inputTexSampler: sampler;
@group(0) @binding(2) var inputTex: texture_2d<f32>;

@vertex
fn vertex_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  // Fullscreen triangle
  const pos: array<vec2f, 3> = array(
    vec2f(-1.0, 3.0),
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0)
  );
  const uv: array<vec2f, 3> = array(
    vec2f(0.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0)
  );
  
  var output: VertexOutput;
  output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
  output.uv = uv[vertexIndex];
  return output;
}

// Iq's palette function
fn pal(t: f32, a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  return a + b * cos(6.28318 * (c * t + d));
}

// Bulge distortion
fn distort(r: vec2f, alpha: f32) -> vec2f {
  return r + r * -alpha * (1.0 - dot(r, r) * 1.25);
}

// Emboss effect
fn emboss(
  p: vec2f,
  channel: vec4f,
  center: vec4f,
  tex: texture_2d<f32>,
  texSampler: sampler,
  texelSize: vec2f,
  scale: f32,
  shift: f32
) -> vec4f {
  let tlColor: vec4f = textureSample(tex, texSampler, p + vec2f(-texelSize.x, texelSize.y) * scale);
  let brColor: vec4f = textureSample(tex, texSampler, p + vec2f(texelSize.x, -texelSize.y) * scale);
  let c: f32 = smoothstep(0.0, shift, dot(center, channel));
  let tl: f32 = smoothstep(0.0, shift, dot(tlColor, channel));
  let br: f32 = smoothstep(0.0, shift, dot(brColor, channel));
  return vec4f(tl, c, br, clamp(2.0 * br - c - tl, 0.0, 1.0));
}

@fragment
fn frag_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  // Apply bulge distortion
  let p = distort(uv * 2.0 - 1.0, -0.15) * 0.5 + 0.5;
  
  // Get input data
  let inputTexSize: vec2f = vec2f(textureDimensions(inputTex));
  let inputTexelSize = 1.0 / inputTexSize;
  let input: vec4f = textureSample(inputTex, inputTexSampler, p);
  
  // Use chemical B distribution as base color value
  let value = smoothstep(0.225, 0.8, input.g);
  var base: vec3f = pal(value * 0.4 + 0.4, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.05, 0.1, 0.2));
  base *= 1.5 * (animationUniforms.pulse * 0.15 + 0.85);
  
  // Centered UV and distance
  let st = uv * 2.0 - 1.0;
  let dist = length(st);
  
  // Inner emboss effect
  var emboss1: vec4f = emboss(p, vec4f(1.0, 0.0, 0.0, 0.0), input, inputTex, inputTexSampler, inputTexelSize, 0.5, 0.4 + dist * 0.3);
  emboss1.w = emboss1.w * 0.3 * (animationUniforms.pulse * 0.2 + 0.8);
  
  // Inner specular
  let specular = smoothstep(0.2, 0.3, 2.0 * emboss1.x - emboss1.y - emboss1.z) * 0.5 * (1.0 - dist) * ((1.0 - animationUniforms.pulse) * 0.15 + 0.85);
  
  // Outer emboss for iridescence
  var emboss2: vec4f = emboss(p, vec4f(0.0, 1.0, 0.0, 0.0), input, inputTex, inputTexSampler, inputTexelSize, 0.8, 0.1);
  var iridescence = pal(input.r * 5.0 + 0.2, vec3f(0.5), vec3f(0.5), vec3f(1.0), vec3f(0.0, 0.33, 0.67));
  iridescence = mix(iridescence, vec3f(0.0), smoothstep(0.0, 0.4, max(input.g, emboss2.w)));
  iridescence *= 0.07 * ((1.0 - animationUniforms.pulse) * 0.2 + 0.8);
  
  // Vignette
  let vignette = dist * 0.075;
  
  var color: vec4f = vec4f(base + vec3f(emboss1.w) + specular + iridescence - vignette, 1.0);
  
  return color;
}
`;
