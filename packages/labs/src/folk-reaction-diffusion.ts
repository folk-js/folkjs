import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Reaction-Diffusion Parameters (Gray-Scott model)
 * Try different combinations for various patterns:
 * - Mitosis: feed=0.0367, kill=0.0649
 * - Coral: feed=0.0545, kill=0.062
 * - Maze: feed=0.029, kill=0.057
 * - Holes: feed=0.039, kill=0.058
 * - Spots: feed=0.025, kill=0.06
 * - Waves: feed=0.014, kill=0.045
 */
const RD_CONFIG = {
  // Base diffusion rates
  diffusionA: 1.0, // Diffusion rate for chemical A (typically 1.0)
  diffusionB: 0.25, // Diffusion rate for chemical B (0.25-0.5, lower = sharper patterns)

  // Reaction parameters
  feed: 0.065, // Feed rate - how fast A is added (0.01 - 0.1)
  kill: 0.06, // Kill rate - how fast B is removed (0.045 - 0.07)

  // Spatial variation (how parameters change from center to edges)
  feedVariation: 0.0, // How much feed varies with distance from center
  killVariation: 0.0, // How much kill varies with distance from center
  diffusionVariation: 0.15, // How much diffusion varies with distance

  // Seed influence (DOM elements)
  seedKillBoost: 0.05, // How much seed areas boost kill rate
  seedPulseInfluence: 0.3, // How much pulse affects seed influence

  // Animation
  pulseSpeed: 0.5, // Speed of pulse animation
  pulseStrength: 0.1, // How much pulse affects diffusion
  centerMotion: 0.01, // Strength of center push motion

  // Pointer interaction
  pointerRadius: 0.4, // Size of pointer influence area (0-1)
  pointerStrength: 80.0, // How much pointer moves the simulation
  pointerDiffusionEffect: 0.15, // How much pointer affects diffusion rate
};

/**
 * Composite/Visual Effect Settings
 */
const COMPOSITE_CONFIG = {
  // Toggle effects on/off
  enableBulgeDistortion: true,
  enableEmboss: true,
  enableSpecular: true,
  enableIridescence: true,
  enableVignette: true,

  // Bulge distortion
  bulgeStrength: -0.15, // Negative = bulge out, positive = bulge in

  // Color palette (Iq cosine palette parameters)
  // Base color: a + b * cos(2π * (c * t + d))
  colorA: [0.5, 0.5, 0.5], // Base brightness
  colorB: [0.5, 0.5, 0.5], // Color amplitude
  colorC: [1.0, 1.0, 1.0], // Color frequency
  colorD: [0.05, 0.1, 0.2], // Color phase offset
  colorBrightness: 1.5, // Overall brightness multiplier

  // Emboss effect
  embossScale: 0.5, // Size of emboss sampling
  embossStrength: 0.3, // Intensity of emboss

  // Specular highlight
  specularStrength: 0.5, // Intensity of specular

  // Iridescence
  iridescenceStrength: 0.07, // Intensity of iridescence
  iridescenceColorD: [0.0, 0.33, 0.67], // Iridescence color phase

  // Vignette
  vignetteStrength: 0.075, // Darkness at edges
};

/**
 * Performance Settings
 */
const PERFORMANCE_CONFIG = {
  simulationScale: 0.5, // Resolution scale (0.25 = quarter res, 1.0 = full res)
  iterationsPerFrame: 8, // RD iterations per animation frame
};

// ============================================================================
// SHADER CONSTANTS (don't modify unless you know what you're doing)
// ============================================================================
const KERNEL_SIZE = 3;
const WORKGROUP_SIZE = [8, 8];
const TILE_SIZE = [2, 2];
const CACHE_SIZE = [TILE_SIZE[0] * WORKGROUP_SIZE[0], TILE_SIZE[1] * WORKGROUP_SIZE[1]]; // [16, 16]
const DISPATCH_SIZE = [CACHE_SIZE[0] - (KERNEL_SIZE - 1), CACHE_SIZE[1] - (KERNEL_SIZE - 1)]; // [14, 14]

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
  #rdConfigBuffer!: GPUBuffer;
  #compositeConfigBuffer!: GPUBuffer;

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
    this.#simWidth = Math.floor((this.#canvas.width || 800) * PERFORMANCE_CONFIG.simulationScale);
    this.#simHeight = Math.floor((this.#canvas.height || 600) * PERFORMANCE_CONFIG.simulationScale);

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

    // RD config buffer (12 floats = 48 bytes, align to 64)
    this.#rdConfigBuffer = this.#device.createBuffer({
      label: 'RD Config',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Composite config buffer (24 floats = 96 bytes, align to 128)
    this.#compositeConfigBuffer = this.#device.createBuffer({
      label: 'Composite Config',
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Write initial params
    this.#device.queue.writeBuffer(this.#paramsUniformBuffer, 0, new Uint32Array([this.#simWidth, this.#simHeight]));

    // Write RD config
    this.#writeRDConfig();

    // Write composite config
    this.#writeCompositeConfig();

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
      this.#pulse = Math.sin(elapsed * RD_CONFIG.pulseSpeed) * 0.5 + 0.5;

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
    for (let i = 0; i < PERFORMANCE_CONFIG.iterationsPerFrame; i++) {
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
          { binding: 4, resource: { buffer: this.#rdConfigBuffer } },
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
        { binding: 3, resource: { buffer: this.#compositeConfigBuffer } },
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
    this.#rdConfigBuffer?.destroy();
    this.#compositeConfigBuffer?.destroy();
  }

  #writeRDConfig() {
    const data = new Float32Array([
      RD_CONFIG.diffusionA,
      RD_CONFIG.diffusionB,
      RD_CONFIG.feed,
      RD_CONFIG.kill,
      RD_CONFIG.feedVariation,
      RD_CONFIG.killVariation,
      RD_CONFIG.diffusionVariation,
      RD_CONFIG.seedKillBoost,
      RD_CONFIG.seedPulseInfluence,
      RD_CONFIG.pulseStrength,
      RD_CONFIG.centerMotion,
      RD_CONFIG.pointerRadius,
      RD_CONFIG.pointerStrength,
      RD_CONFIG.pointerDiffusionEffect,
      0, // padding
      0, // padding
    ]);
    this.#device.queue.writeBuffer(this.#rdConfigBuffer, 0, data);
  }

  #writeCompositeConfig() {
    const data = new Float32Array([
      // Toggles (as floats: 0.0 or 1.0)
      COMPOSITE_CONFIG.enableBulgeDistortion ? 1.0 : 0.0,
      COMPOSITE_CONFIG.enableEmboss ? 1.0 : 0.0,
      COMPOSITE_CONFIG.enableSpecular ? 1.0 : 0.0,
      COMPOSITE_CONFIG.enableIridescence ? 1.0 : 0.0,
      COMPOSITE_CONFIG.enableVignette ? 1.0 : 0.0,
      COMPOSITE_CONFIG.bulgeStrength,
      COMPOSITE_CONFIG.embossScale,
      COMPOSITE_CONFIG.embossStrength,
      // Color A (vec3 + padding)
      ...COMPOSITE_CONFIG.colorA,
      COMPOSITE_CONFIG.specularStrength,
      // Color B (vec3 + padding)
      ...COMPOSITE_CONFIG.colorB,
      COMPOSITE_CONFIG.iridescenceStrength,
      // Color C (vec3 + padding)
      ...COMPOSITE_CONFIG.colorC,
      COMPOSITE_CONFIG.vignetteStrength,
      // Color D (vec3 + padding)
      ...COMPOSITE_CONFIG.colorD,
      COMPOSITE_CONFIG.colorBrightness,
      // Iridescence color D (vec3 + padding)
      ...COMPOSITE_CONFIG.iridescenceColorD,
      0, // padding
    ]);
    this.#device.queue.writeBuffer(this.#compositeConfigBuffer, 0, data);
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

struct RDConfig {
  diffusionA: f32,
  diffusionB: f32,
  feed: f32,
  kill: f32,
  feedVariation: f32,
  killVariation: f32,
  diffusionVariation: f32,
  seedKillBoost: f32,
  seedPulseInfluence: f32,
  pulseStrength: f32,
  centerMotion: f32,
  pointerRadius: f32,
  pointerStrength: f32,
  pointerDiffusionEffect: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var seedTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> anim: AnimationUniforms;
@group(0) @binding(4) var<uniform> cfg: RDConfig;

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
      sampleCoordF -= (sampleUv * 2.0 - 1.0) * cfg.centerMotion * (2.0 * anim.pulse + 2.0 + 1.5);
      
      // Pointer influence - move pixels based on pointer velocity
      let st = ((sampleUv * 2.0 - 1.0) * aspectFactor) * 0.5 + 0.5;
      let pointerPos = (anim.pointerPos * aspectFactor) * 0.5 + 0.5;
      let pointerDist = distance(st, pointerPos) / cfg.pointerRadius;
      var pointerMask = smoothstep(1.0, 0.0, min(1.0, pointerDist));
      sampleCoordF -= anim.pointerVelocity * cfg.pointerStrength * pointerMask;
      
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
        let pointerPos = (anim.pointerPos * aspectFactor) * 0.5 + 0.5;
        let pointerDist = distance(st, pointerPos) / cfg.pointerRadius;
        var pointerMask = smoothstep(1.0, 0.0, min(1.0, pointerDist));
        pointerMask = pointerMask * length(anim.pointerVelocity) * 30.0;
        
        // Distance from center affects parameters
        let dist = mix(dot(uv.xx, uv.xx), dot(uv.yy, uv.yy), step(1.4, f32(dims.x) / f32(dims.y)));
        
        // Reaction-diffusion parameters from config
        let cacheValue: vec4f = cache[local.y][local.x];
        let dA = cfg.diffusionA - dist * cfg.diffusionVariation;
        var dB = cfg.diffusionB + dist * cfg.diffusionVariation * 0.5;
        dB = dB + cfg.pulseStrength * (anim.pulse * 0.5 + 0.5);
        dB = dB - min(cfg.pointerDiffusionEffect, cfg.pointerDiffusionEffect * 1.5 * pointerMask);
        dB = max(0.1, dB);
        
        var feed = cfg.feed + dist * cfg.feedVariation;
        var kill = cfg.kill + dist * cfg.killVariation;
        // Seed areas affect kill rate
        kill = kill + cacheValue.b * cfg.seedKillBoost * (anim.pulse * cfg.seedPulseInfluence + (1.0 - cfg.seedPulseInfluence));
        
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

struct CompositeConfig {
  enableBulge: f32,
  enableEmboss: f32,
  enableSpecular: f32,
  enableIridescence: f32,
  enableVignette: f32,
  bulgeStrength: f32,
  embossScale: f32,
  embossStrength: f32,
  colorA: vec3f,
  specularStrength: f32,
  colorB: vec3f,
  iridescenceStrength: f32,
  colorC: vec3f,
  vignetteStrength: f32,
  colorD: vec3f,
  colorBrightness: f32,
  iridescenceColorD: vec3f,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> anim: AnimationUniforms;
@group(0) @binding(1) var inputTexSampler: sampler;
@group(0) @binding(2) var inputTex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> cfg: CompositeConfig;

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
  // Apply bulge distortion (conditional)
  var p: vec2f;
  if (cfg.enableBulge > 0.5) {
    p = distort(uv * 2.0 - 1.0, cfg.bulgeStrength) * 0.5 + 0.5;
  } else {
    p = uv;
  }
  
  // Get input data
  let inputTexSize: vec2f = vec2f(textureDimensions(inputTex));
  let inputTexelSize = 1.0 / inputTexSize;
  let input: vec4f = textureSample(inputTex, inputTexSampler, p);
  
  // Use chemical B distribution as base color value
  let value = smoothstep(0.225, 0.8, input.g);
  var base: vec3f = pal(value * 0.4 + 0.4, cfg.colorA, cfg.colorB, cfg.colorC, cfg.colorD);
  base *= cfg.colorBrightness * (anim.pulse * 0.15 + 0.85);
  
  // Centered UV and distance
  let st = uv * 2.0 - 1.0;
  let dist = length(st);
  
  // Inner emboss effect (conditional)
  var embossValue: f32 = 0.0;
  var emboss1: vec4f = vec4f(0.0);
  if (cfg.enableEmboss > 0.5) {
    emboss1 = emboss(p, vec4f(1.0, 0.0, 0.0, 0.0), input, inputTex, inputTexSampler, inputTexelSize, cfg.embossScale, 0.4 + dist * 0.3);
    embossValue = emboss1.w * cfg.embossStrength * (anim.pulse * 0.2 + 0.8);
  }
  
  // Inner specular (conditional)
  var specular: f32 = 0.0;
  if (cfg.enableSpecular > 0.5 && cfg.enableEmboss > 0.5) {
    specular = smoothstep(0.2, 0.3, 2.0 * emboss1.x - emboss1.y - emboss1.z) * cfg.specularStrength * (1.0 - dist) * ((1.0 - anim.pulse) * 0.15 + 0.85);
  }
  
  // Outer emboss for iridescence (conditional)
  var iridescence: vec3f = vec3f(0.0);
  if (cfg.enableIridescence > 0.5) {
    let emboss2: vec4f = emboss(p, vec4f(0.0, 1.0, 0.0, 0.0), input, inputTex, inputTexSampler, inputTexelSize, 0.8, 0.1);
    iridescence = pal(input.r * 5.0 + 0.2, cfg.colorA, cfg.colorB, cfg.colorC, cfg.iridescenceColorD);
    iridescence = mix(iridescence, vec3f(0.0), smoothstep(0.0, 0.4, max(input.g, emboss2.w)));
    iridescence *= cfg.iridescenceStrength * ((1.0 - anim.pulse) * 0.2 + 0.8);
  }
  
  // Vignette (conditional)
  var vignette: f32 = 0.0;
  if (cfg.enableVignette > 0.5) {
    vignette = dist * cfg.vignetteStrength;
  }
  
  var color: vec4f = vec4f(base + vec3f(embossValue) + specular + iridescence - vignette, 1.0);
  
  return color;
}
`;
