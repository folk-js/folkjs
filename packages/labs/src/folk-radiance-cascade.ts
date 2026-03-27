import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

type Line = [x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, thickness: number];

// The one tunable parameter: probe spacing at the finest cascade level.
// Smaller = higher quality, larger cascade textures.
const PROBE_SPACING_0 = 2;

// Fixed by the 2D Radiance Cascades algorithm (Sannikov 2023).
// In 2D, 4 base rays with 4× angular branching and 2× spatial scaling
// produces equal-sized cascade textures at every level — the standard
// configuration used by all reference implementations.
const BRANCHING_FACTOR = 4;
const SPATIAL_SCALE = Math.round(Math.sqrt(BRANCHING_FACTOR)); // = 2

function uboView(shader: string, name: string): StructuredView {
  return makeStructuredView(makeShaderDataDefinitions(shader).uniforms[name]);
}

function createComputePipeline(device: GPUDevice, label: string, code: string): GPUComputePipeline {
  return device.createComputePipeline({
    label,
    layout: 'auto',
    compute: { module: device.createShaderModule({ code }), entryPoint: 'main' },
  });
}

function uploadVertexData(
  device: GPUDevice,
  existing: GPUBuffer | undefined,
  data: Float32Array<ArrayBuffer>,
): GPUBuffer {
  if (!existing || existing.size < data.byteLength) {
    existing?.destroy();
    existing = device.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }
  device.queue.writeBuffer(existing, 0, data);
  return existing;
}

/**
 * WebGPU-based Radiance Cascades for 2D global illumination.
 * Uses a world texture approach for efficient scene sampling.
 */
export class FolkRadianceCascade extends FolkBaseSet {
  static override tagName = 'folk-radiance-cascade';

  @property({ type: Number, reflect: true }) exposure = 1.0;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World texture - stores scene (emissive RGB, opacity)
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;

  // Pipelines
  #worldRenderPipeline!: GPURenderPipeline;
  #jfaSeedPipeline!: GPUComputePipeline;
  #jfaPipeline!: GPUComputePipeline;
  #jfaFinalizePipeline!: GPUComputePipeline;
  #raymarchPipeline!: GPUComputePipeline;
  #fluencePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Buffers and textures
  #cascadeTextures!: GPUTexture[];
  #cascadeTextureViews!: GPUTextureView[];
  #uboBuffer!: GPUBuffer;
  #fluenceUBO!: GPUBuffer;
  #jfaTextures!: GPUTexture[];
  #jfaTextureViews!: GPUTextureView[];
  #jfaParamsBuffer!: GPUBuffer;
  #sdfTexture!: GPUTexture;
  #sdfTextureView!: GPUTextureView;
  #fluenceTexture!: GPUTexture;
  #fluenceTextureView!: GPUTextureView;
  #renderUBO!: GPUBuffer;

  // Pre-allocated bind groups (created once at init/resize, not per frame)
  #jfaSeedBindGroup!: GPUBindGroup;
  #jfaPassBindGroups!: GPUBindGroup[];
  #jfaFinalizeBindGroup!: GPUBindGroup;
  #raymarchBindGroups!: GPUBindGroup[];
  #fluenceBindGroup!: GPUBindGroup;
  #renderBindGroup!: GPUBindGroup;

  // Structured views for type-safe UBO packing (from webgpu-utils)
  #raymarchUBOView!: StructuredView;
  #fluenceUBOView!: StructuredView;
  #jfaParamsView!: StructuredView;
  #renderUBOView!: StructuredView;

  // Shape data for rendering to world texture
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  #lines: Line[] = [];
  #lineInstanceBuffer?: GPUBuffer;
  #lineInstanceCapacity = 0;
  #lineCount = 0;
  #lineBufferDirty = false;
  #lineRenderPipeline!: GPURenderPipeline;
  #lineUBO?: GPUBuffer;
  #lineBindGroup?: GPUBindGroup;

  // Samplers
  #linearSampler!: GPUSampler;

  // Mouse light (rendered as geometry in the world pass)
  #mousePosition = { x: 0, y: 0 };
  #mouseLightColor = { r: 0.8, g: 0.6, b: 0.3 };
  #mouseLightRadius = 10;
  #mouseLightBuffer?: GPUBuffer;
  #mouseLightVertexCount = 0;

  // Animation state
  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  // Computed values
  #numCascadeLevels = 0;
  #jfaPassCount = 0;
  #jfaResultIndex = 0;
  #maxCascadeTexW = 0;
  #maxCascadeTexH = 0;

  // Profiling (toggled with ".")
  #profilingSupported = false;
  #profilingQuerySet!: GPUQuerySet;
  #profilingResolveBuffer!: GPUBuffer;
  #profilingReadBuffers!: [GPUBuffer, GPUBuffer];
  #profilingWriteIndex = 0;
  #profilingMappingPending = false;
  #profilingOverlay: HTMLDivElement | null = null;
  #profilingVisible = false;
  #smoothedGpuTime = 0;
  #smoothedCpuTime = 0;
  #lastOverlayUpdate = 0;
  #debugMode = 0;
  static #debugModeNames = ['normal', 'C-1 only', 'C0 only', 'diff ×4', 'C-1 per-dir', 'cascade atlas'];

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    this.#initStructuredViews();
    this.#initBuffers();
    this.#initPipelines();
    this.#initBindGroups();
    this.#initProfiling();

    window.addEventListener('resize', this.#handleResize);
    window.addEventListener('mousemove', this.#handleMouseMove);
    window.addEventListener('keydown', this.#handleKeyDown);
    this.#isRunning = true;
    this.#startAnimationLoop();

    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#isRunning = false;
    if (this.#animationFrame) {
      cancelAnimationFrame(this.#animationFrame);
    }
    window.removeEventListener('resize', this.#handleResize);
    window.removeEventListener('mousemove', this.#handleMouseMove);
    window.removeEventListener('keydown', this.#handleKeyDown);
    this.#cleanupResources();
    this.#cleanupProfiling();
  }

  // Public API for line drawing
  addLine(x1: number, y1: number, x2: number, y2: number, colorIndex: number, thickness = 20) {
    const [r, g, b] = FolkRadianceCascade.#colors[colorIndex] ?? FolkRadianceCascade.#colors[1];
    this.#lines.push([x1, y1, x2, y2, r, g, b, thickness]);
    this.#lineBufferDirty = true;
  }

  clearLines() {
    this.#lines = [];
    this.#lineBufferDirty = true;
  }

  setMouseLightColor(r: number, g: number, b: number) {
    this.#mouseLightColor = { r, g, b };
  }

  setMouseLightRadius(radius: number) {
    this.#mouseLightRadius = radius;
  }

  eraseAt(x: number, y: number, radius: number) {
    // Remove lines that pass within radius of the point
    this.#lines = this.#lines.filter((line) => {
      const [x1, y1, x2, y2] = line;
      // Distance from point to line segment
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(x - x1, y - y1) > radius;

      let t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const nearX = x1 + t * dx;
      const nearY = y1 + t * dy;
      return Math.hypot(x - nearX, y - nearY) > radius;
    });
    this.#lineBufferDirty = true;
  }

  #updateLineBuffer() {
    if (!this.#device || this.#lines.length === 0) {
      this.#lineCount = 0;
      return;
    }

    const count = this.#lines.length;
    const FLOATS_PER_LINE = 8;
    const BYTES_PER_LINE = FLOATS_PER_LINE * 4;

    if (!this.#lineInstanceBuffer || this.#lineInstanceCapacity < count) {
      this.#lineInstanceBuffer?.destroy();
      this.#lineInstanceCapacity = Math.max(count, 256);
      this.#lineInstanceBuffer = this.#device.createBuffer({
        size: this.#lineInstanceCapacity * BYTES_PER_LINE,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    const data = new Float32Array(count * FLOATS_PER_LINE);
    for (let i = 0; i < count; i++) {
      const [x1, y1, x2, y2, r, g, b, thickness] = this.#lines[i];
      const off = i * FLOATS_PER_LINE;
      data[off] = x1;
      data[off + 1] = y1;
      data[off + 2] = x2;
      data[off + 3] = y2;
      data[off + 4] = r;
      data[off + 5] = g;
      data[off + 6] = b;
      data[off + 7] = thickness;
    }
    this.#device.queue.writeBuffer(this.#lineInstanceBuffer, 0, data);
    this.#lineCount = count;
  }

  #updateMouseLightBuffer() {
    if (!this.#device) return;

    const SEGMENTS = 12;
    const { x, y } = this.#mousePosition;
    const { r, g, b } = this.#mouseLightColor;
    const radius = this.#mouseLightRadius;

    const toClipX = (px: number) => (px / this.#canvas.width) * 2 - 1;
    const toClipY = (py: number) => 1 - (py / this.#canvas.height) * 2;
    const rx = (radius / this.#canvas.width) * 2;
    const ry = (radius / this.#canvas.height) * 2;
    const cx = toClipX(x);
    const cy = toClipY(y);

    const vertices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a0 = (i / SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
      vertices.push(cx, cy, r, g, b);
      vertices.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b);
      vertices.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b);
    }

    this.#mouseLightVertexCount = vertices.length / 5;
    this.#mouseLightBuffer = uploadVertexData(this.#device, this.#mouseLightBuffer, new Float32Array(vertices));
  }

  async #initWebGPU() {
    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser.');
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error('Failed to get GPU adapter.');
    }

    this.#profilingSupported = adapter.features.has('timestamp-query');
    this.#device = await adapter.requestDevice({
      requiredFeatures: this.#profilingSupported ? ['timestamp-query'] : [],
    });

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#canvas.style.position = 'absolute';
    this.#canvas.style.top = '0';
    this.#canvas.style.left = '0';
    this.#canvas.style.width = '100%';
    this.#canvas.style.height = '100%';
    this.#canvas.style.pointerEvents = 'none';
    this.renderRoot.prepend(this.#canvas);

    const context = this.#canvas.getContext('webgpu');
    if (!context) {
      throw new Error('Failed to get WebGPU context.');
    }

    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    this.#configureContext();

    this.#linearSampler = this.#device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  #configureContext() {
    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });
  }

  #initStructuredViews() {
    this.#raymarchUBOView = uboView(raymarchShader, 'ubo');
    this.#fluenceUBOView = uboView(fluenceShader, 'ubo');
    this.#jfaParamsView = uboView(jfaSeedShader, 'params');
    this.#renderUBOView = uboView(renderShader, 'ubo');
  }

  #initBuffers() {
    const { width, height } = this.#canvas;

    // Number of cascade levels needed to cover the screen diagonal.
    // Level N covers up to PROBE_SPACING_0 * BRANCHING_FACTOR^N pixels.
    const diagonal = Math.sqrt(width * width + height * height);
    this.#numCascadeLevels = Math.ceil(Math.log(diagonal / PROBE_SPACING_0) / Math.log(BRANCHING_FACTOR));

    // Compute max cascade texture dimensions across all levels.
    // With C-1 gathering, sqrtBins = SPATIAL_SCALE^(level+1) so each sub-ray
    // at level N reads a unique bin from level N+1 (maintaining the 4× angular
    // branching ratio). This gives equal-sized W×H textures at every level.
    this.#maxCascadeTexW = 0;
    this.#maxCascadeTexH = 0;
    for (let level = 0; level <= this.#numCascadeLevels; level++) {
      const spacing = PROBE_SPACING_0 * Math.pow(SPATIAL_SCALE, level);
      const probesX = Math.floor(width / spacing);
      const probesY = Math.floor(height / spacing);
      const sqrtBins = Math.round(Math.pow(SPATIAL_SCALE, level + 1));
      this.#maxCascadeTexW = Math.max(this.#maxCascadeTexW, probesX * sqrtBins);
      this.#maxCascadeTexH = Math.max(this.#maxCascadeTexH, probesY * sqrtBins);
    }

    // Direction-first cascade textures (ping-pong pair).
    // rgba16float is both storage-compatible and filterable, enabling
    // hardware bilinear interpolation during cascade merging.
    this.#cascadeTextures = [0, 1].map((i) =>
      this.#device.createTexture({
        label: `Cascade-Texture-${i}`,
        size: { width: this.#maxCascadeTexW, height: this.#maxCascadeTexH },
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#cascadeTextureViews = this.#cascadeTextures.map((t) => t.createView());

    // UBO for per-level parameters
    this.#uboBuffer = this.#device.createBuffer({
      label: 'UBO',
      size: 256 * (this.#numCascadeLevels + 1),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // JFA ping-pong textures: store (seedX, seedY) per texel.
    // rg32float halves bandwidth vs rgba32float; distance is computed in a
    // finalize pass after JFA completes.
    this.#jfaTextures = [0, 1].map((i) =>
      this.#device.createTexture({
        label: `JFA-Texture-${i}`,
        size: { width, height },
        format: 'rg32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
    this.#jfaTextureViews = this.#jfaTextures.map((t) => t.createView());

    // Precomputed SDF distance texture. rgba16float is always filterable,
    // enabling hardware bilinear sampling in the raymarch shader (replaces
    // 4 textureLoad calls with 1 textureSampleLevel).
    this.#sdfTexture = this.#device.createTexture({
      label: 'SDF-Texture',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#sdfTextureView = this.#sdfTexture.createView();

    // Pre-compute JFA pass count and result texture index.
    // The number of passes determines which ping-pong texture holds the final SDF.
    const maxDim = Math.max(width, height);
    const maxStep = 1 << Math.floor(Math.log2(maxDim));
    this.#jfaPassCount = Math.floor(Math.log2(maxStep)) + 1;
    this.#jfaResultIndex = this.#jfaPassCount % 2;

    // JFA params buffer: holds per-pass params at 256-byte-aligned offsets.
    const maxJfaPasses = this.#jfaPassCount + 1; // +1 for seed pass
    this.#jfaParamsBuffer = this.#device.createBuffer({
      label: 'JFA-Params',
      size: 256 * (maxJfaPasses + 1),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.#worldTexture = this.#device.createTexture({
      label: 'WorldTexture',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#worldTextureView = this.#worldTexture.createView();

    this.#fluenceTexture = this.#device.createTexture({
      label: 'FluenceTexture',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#fluenceTextureView = this.#fluenceTexture.createView();

    // Fluence UBO - pre-allocated, updated via writeBuffer (not per-frame)
    this.#fluenceUBO = this.#device.createBuffer({
      label: 'FluenceUBO',
      size: this.#fluenceUBOView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.#renderUBO = this.#device.createBuffer({
      label: 'RenderUBO',
      size: this.#renderUBOView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  #initPipelines() {
    const device = this.#device;

    // World render pipeline - renders shapes to world texture
    const worldRenderModule = device.createShaderModule({ code: worldRenderShader });
    this.#worldRenderPipeline = device.createRenderPipeline({
      label: 'WorldRender-Pipeline',
      layout: 'auto',
      vertex: {
        module: worldRenderModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 20, // 5 floats * 4 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
              { shaderLocation: 1, offset: 8, format: 'float32x3' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: worldRenderModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Line render pipeline — instanced capsule SDF quads
    const lineModule = device.createShaderModule({ code: lineRenderShader });
    this.#lineRenderPipeline = device.createRenderPipeline({
      label: 'LineRender-Pipeline',
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 32, // 8 floats * 4 bytes
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // p1
              { shaderLocation: 1, offset: 8, format: 'float32x2' }, // p2
              { shaderLocation: 2, offset: 16, format: 'float32x3' }, // color
              { shaderLocation: 3, offset: 28, format: 'float32' }, // thickness
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.#jfaSeedPipeline = createComputePipeline(device, 'JFA-Seed', jfaSeedShader);
    this.#jfaPipeline = createComputePipeline(device, 'JFA', jfaShader);
    this.#jfaFinalizePipeline = createComputePipeline(device, 'JFA-Finalize', jfaFinalizeShader);
    this.#raymarchPipeline = createComputePipeline(device, 'Raymarch', raymarchShader);
    this.#fluencePipeline = createComputePipeline(device, 'Fluence', fluenceShader);

    // Final render pipeline
    const renderModule = device.createShaderModule({ code: renderShader });
    this.#renderPipeline = device.createRenderPipeline({
      label: 'Render-Pipeline',
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vertex_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fragment_main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  #initBindGroups() {
    const { width, height } = this.#canvas;
    const uboSize = this.#raymarchUBOView.arrayBuffer.byteLength;

    // JFA seed bind group
    this.#jfaSeedBindGroup = this.#device.createBindGroup({
      layout: this.#jfaSeedPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#worldTextureView },
        { binding: 1, resource: this.#jfaTextureViews[0] },
        { binding: 2, resource: { buffer: this.#jfaParamsBuffer, offset: 0, size: 16 } },
      ],
    });

    // JFA propagation bind groups (one per pass, pre-created with correct offsets)
    this.#jfaPassBindGroups = [];
    let jfaCurrent = 0;
    for (let i = 0; i < this.#jfaPassCount; i++) {
      const srcIndex = jfaCurrent;
      const dstIndex = 1 - jfaCurrent;
      const bufferOffset = (i + 1) * 256;

      this.#jfaPassBindGroups.push(
        this.#device.createBindGroup({
          layout: this.#jfaPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: this.#jfaTextureViews[srcIndex] },
            { binding: 1, resource: this.#jfaTextureViews[dstIndex] },
            { binding: 2, resource: { buffer: this.#jfaParamsBuffer, offset: bufferOffset, size: 16 } },
          ],
        }),
      );

      jfaCurrent = dstIndex;
    }

    // Write JFA params once (they only depend on canvas size, not per-frame state)
    this.#jfaParamsView.set({ width, height, stepSize: 0, pad: 0 });
    this.#device.queue.writeBuffer(this.#jfaParamsBuffer, 0, this.#jfaParamsView.arrayBuffer);

    const maxDim = Math.max(width, height);
    const maxStep = 1 << Math.floor(Math.log2(maxDim));
    let passIndex = 0;
    for (let step = maxStep; step >= 1; step >>= 1) {
      const bufferOffset = (passIndex + 1) * 256;
      this.#jfaParamsView.set({ width, height, stepSize: step, pad: 0 });
      this.#device.queue.writeBuffer(this.#jfaParamsBuffer, bufferOffset, this.#jfaParamsView.arrayBuffer);
      passIndex++;
    }

    // JFA finalize bind group: reads final seed coords, writes precomputed distance
    this.#jfaFinalizeBindGroup = this.#device.createBindGroup({
      layout: this.#jfaFinalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#jfaTextureViews[this.#jfaResultIndex] },
        { binding: 1, resource: this.#sdfTextureView },
        { binding: 2, resource: { buffer: this.#jfaParamsBuffer, offset: 0, size: 16 } },
      ],
    });

    // Line render UBO: canvas dimensions for clip-space conversion
    this.#lineUBO?.destroy();
    this.#lineUBO = this.#device.createBuffer({
      label: 'LineUBO',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(this.#lineUBO, 0, new Float32Array([width, height]));
    this.#lineBindGroup = this.#device.createBindGroup({
      layout: this.#lineRenderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.#lineUBO } }],
    });

    // Raymarch bind groups with direction-first cascade texture ping-pong.
    // Processing order is highest level first (no upper cascade) down to level 0.
    // Each level alternates which cascade texture it writes to vs reads from.
    const levelCount = this.#numCascadeLevels;
    this.#raymarchBindGroups = [];
    for (let level = 0; level <= levelCount; level++) {
      const processIndex = levelCount - level;
      const writeIndex = processIndex % 2;
      const readIndex = 1 - writeIndex;

      const probeSpacing = PROBE_SPACING_0 * Math.pow(SPATIAL_SCALE, level);
      const sqrtBins = Math.round(Math.pow(SPATIAL_SCALE, level + 1));
      const cascadeWidth = Math.floor(width / probeSpacing);
      const cascadeHeight = Math.floor(height / probeSpacing);
      const baseStart = level === 0 ? 0 : PROBE_SPACING_0 * Math.pow(BRANCHING_FACTOR, level - 1);
      const intervalStart = baseStart + PROBE_SPACING_0;
      const intervalEnd = PROBE_SPACING_0 * Math.pow(BRANCHING_FACTOR, level) + PROBE_SPACING_0;

      const upperSpacing = PROBE_SPACING_0 * Math.pow(SPATIAL_SCALE, level + 1);
      const upperCascadeW = level >= levelCount ? 0 : Math.floor(width / upperSpacing);
      const upperCascadeH = level >= levelCount ? 0 : Math.floor(height / upperSpacing);
      const upperSqrtBins = Math.round(Math.pow(SPATIAL_SCALE, level + 2));

      this.#raymarchUBOView.set({
        probeSpacing,
        intervalStart,
        intervalEnd,
        level,
        levelCount,
        width,
        height,
        sqrtBins,
        cascadeWidth,
        cascadeHeight,
        upperCascadeW,
        upperCascadeH,
        upperSqrtBins,
      });
      this.#device.queue.writeBuffer(this.#uboBuffer, level * 256, this.#raymarchUBOView.arrayBuffer);

      this.#raymarchBindGroups[level] = this.#device.createBindGroup({
        layout: this.#raymarchPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#cascadeTextureViews[writeIndex] },
          { binding: 1, resource: { buffer: this.#uboBuffer, offset: level * 256, size: uboSize } },
          { binding: 2, resource: this.#worldTextureView },
          { binding: 3, resource: this.#linearSampler },
          { binding: 4, resource: this.#sdfTextureView },
          { binding: 5, resource: this.#cascadeTextureViews[readIndex] },
        ],
      });
    }

    // Fluence samples the merged cascade-0 result.
    // Level 0 result ends up in cascadeTextures[levelCount % 2].
    const level0ResultIndex = levelCount % 2;
    const cascadeWidth = Math.floor(width / PROBE_SPACING_0);
    const cascadeHeight = Math.floor(height / PROBE_SPACING_0);
    this.#fluenceUBOView.set({
      probeSpacing: PROBE_SPACING_0,
      cascadeWidth,
      cascadeHeight,
      width,
      height,
      sqrtBins: SPATIAL_SCALE,
      debugMode: this.#debugMode,
    });
    this.#device.queue.writeBuffer(this.#fluenceUBO, 0, this.#fluenceUBOView.arrayBuffer);

    this.#fluenceBindGroup = this.#device.createBindGroup({
      layout: this.#fluencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#fluenceTextureView },
        { binding: 1, resource: this.#cascadeTextureViews[level0ResultIndex] },
        { binding: 2, resource: { buffer: this.#fluenceUBO } },
        { binding: 3, resource: this.#linearSampler },
        { binding: 4, resource: this.#sdfTextureView },
        { binding: 5, resource: this.#worldTextureView },
      ],
    });

    // Final render bind group
    this.#renderUBOView.set({ exposure: this.exposure });
    this.#device.queue.writeBuffer(this.#renderUBO, 0, this.#renderUBOView.arrayBuffer);

    this.#renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#fluenceTextureView },
        { binding: 1, resource: this.#linearSampler },
        { binding: 2, resource: this.#worldTextureView },
        { binding: 3, resource: { buffer: this.#renderUBO } },
      ],
    });
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (!this.#device) return;

    if (changedProperties.has('exposure')) {
      this.#renderUBOView.set({ exposure: this.exposure });
      this.#device.queue.writeBuffer(this.#renderUBO, 0, this.#renderUBOView.arrayBuffer);
    }

    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#updateShapeData();
  }

  // Color palette - normalized for similar perceived brightness
  static readonly #colors: [number, number, number][] = [
    [0, 0, 0], // 0: Eraser (handled specially)
    [0.05, 0.05, 0.05], // 1: Black (blocks light)
    [1, 0.25, 0.25], // 2: Red
    [1, 0.5, 0.2], // 3: Orange
    [0.75, 0.75, 0.2], // 4: Yellow (reduced)
    [0.25, 0.8, 0.35], // 5: Green
    [0.25, 0.75, 0.75], // 6: Cyan (reduced)
    [0.3, 0.4, 1], // 7: Blue
    [0.65, 0.3, 1], // 8: Purple
    [0.8, 0.8, 0.8], // 9: White (reduced)
  ];

  #updateShapeData() {
    // Build shape vertex data for rendering to world texture
    // Each shape becomes 2 triangles (6 vertices)
    const vertices: number[] = [];
    const elements = Array.from(this.sourceElements);

    this.sourceRects.forEach((rect, index) => {
      // Convert CSS coordinates to clip space
      const x0 = (rect.left / this.#canvas.width) * 2 - 1;
      const y0 = 1 - (rect.top / this.#canvas.height) * 2;
      const x1 = (rect.right / this.#canvas.width) * 2 - 1;
      const y1 = 1 - (rect.bottom / this.#canvas.height) * 2;

      // Get color from data-color attribute, or use index-based hue
      const element = elements[index];
      const colorAttr = element?.getAttribute('data-color');
      let r: number, g: number, b: number;

      if (colorAttr !== null) {
        const colorIndex = parseInt(colorAttr) || 0;
        const color = FolkRadianceCascade.#colors[colorIndex] || FolkRadianceCascade.#colors[0];
        [r, g, b] = color;
      } else {
        // Default: use index-based hue rotation
        const hue = index * 0.618;
        r = 0.5 + 0.5 * Math.sin(hue * Math.PI * 2);
        g = 0.5 + 0.5 * Math.sin((hue + 0.333) * Math.PI * 2);
        b = 0.5 + 0.5 * Math.sin((hue + 0.666) * Math.PI * 2);
      }

      // Two triangles per quad: x, y, r, g, b
      vertices.push(x0, y0, r, g, b);
      vertices.push(x1, y0, r, g, b);
      vertices.push(x0, y1, r, g, b);
      vertices.push(x1, y0, r, g, b);
      vertices.push(x1, y1, r, g, b);
      vertices.push(x0, y1, r, g, b);
    });

    this.#shapeCount = this.sourceRects.length;

    if (vertices.length === 0) {
      return;
    }

    this.#shapeDataBuffer = uploadVertexData(this.#device, this.#shapeDataBuffer, new Float32Array(vertices));
  }

  #startAnimationLoop() {
    let lastTime = 0;

    const render = (now: number) => {
      if (!this.#isRunning) return;

      if (lastTime > 0) {
        const delta = now - lastTime;
        const alpha = 0.05;
        this.#smoothedCpuTime =
          this.#smoothedCpuTime === 0 ? delta : this.#smoothedCpuTime + alpha * (delta - this.#smoothedCpuTime);
      }
      lastTime = now;

      this.#runRadianceCascades();

      if (this.#profilingVisible && now - this.#lastOverlayUpdate > 200) {
        this.#lastOverlayUpdate = now;
        this.#updateOverlayDOM();
      }

      this.#animationFrame = requestAnimationFrame(render);
    };

    this.#animationFrame = requestAnimationFrame(render);
  }

  #runRadianceCascades() {
    if (this.#lineBufferDirty) {
      this.#lineBufferDirty = false;
      this.#updateLineBuffer();
    }

    this.#updateMouseLightBuffer();

    const { width, height } = this.#canvas;
    const jfaWorkgroupsX = Math.ceil(width / 16);
    const jfaWorkgroupsY = Math.ceil(height / 16);
    const cascadeWorkgroupsX = Math.ceil(this.#maxCascadeTexW / 16);
    const cascadeWorkgroupsY = Math.ceil(this.#maxCascadeTexH / 16);

    const encoder = this.#device.createCommandEncoder();
    const qs = this.#profilingSupported ? this.#profilingQuerySet : null;

    // Step 1: Clear and render world texture (shapes, lines, mouse light)
    {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#worldTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        ...(qs && { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0 } }),
      });

      renderPass.setPipeline(this.#worldRenderPipeline);

      if (this.#shapeDataBuffer && this.#shapeCount > 0) {
        renderPass.setVertexBuffer(0, this.#shapeDataBuffer);
        renderPass.draw(this.#shapeCount * 6);
      }

      if (this.#lineInstanceBuffer && this.#lineCount > 0) {
        renderPass.setPipeline(this.#lineRenderPipeline);
        renderPass.setBindGroup(0, this.#lineBindGroup!);
        renderPass.setVertexBuffer(0, this.#lineInstanceBuffer);
        renderPass.draw(6, this.#lineCount);
        renderPass.setPipeline(this.#worldRenderPipeline);
      }

      if (this.#mouseLightBuffer && this.#mouseLightVertexCount > 0) {
        renderPass.setVertexBuffer(0, this.#mouseLightBuffer);
        renderPass.draw(this.#mouseLightVertexCount);
      }

      renderPass.end();
    }

    // Step 2: JFA distance field + SDF finalize
    {
      const seedPass = encoder.beginComputePass();
      seedPass.setPipeline(this.#jfaSeedPipeline);
      seedPass.setBindGroup(0, this.#jfaSeedBindGroup);
      seedPass.dispatchWorkgroups(jfaWorkgroupsX, jfaWorkgroupsY);
      seedPass.end();

      for (let i = 0; i < this.#jfaPassCount; i++) {
        const jfaPass = encoder.beginComputePass();
        jfaPass.setPipeline(this.#jfaPipeline);
        jfaPass.setBindGroup(0, this.#jfaPassBindGroups[i]);
        jfaPass.dispatchWorkgroups(jfaWorkgroupsX, jfaWorkgroupsY);
        jfaPass.end();
      }

      const finalizePass = encoder.beginComputePass();
      finalizePass.setPipeline(this.#jfaFinalizePipeline);
      finalizePass.setBindGroup(0, this.#jfaFinalizeBindGroup);
      finalizePass.dispatchWorkgroups(jfaWorkgroupsX, jfaWorkgroupsY);
      finalizePass.end();
    }

    // Step 3: Raymarch each cascade level (highest first, ping-ponging cascade textures).
    const levelCount = this.#numCascadeLevels;
    for (let level = levelCount; level >= 0; level--) {
      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#raymarchPipeline);
      computePass.setBindGroup(0, this.#raymarchBindGroups[level]);
      computePass.dispatchWorkgroups(cascadeWorkgroupsX, cascadeWorkgroupsY, 1);
      computePass.end();
    }

    // Step 4: Build fluence texture from cascade-0 result
    {
      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#fluencePipeline);
      computePass.setBindGroup(0, this.#fluenceBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16), 1);
      computePass.end();
    }

    // Step 5: Final render
    {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        ...(qs && { timestampWrites: { querySet: qs, endOfPassWriteIndex: 1 } }),
      });
      renderPass.setPipeline(this.#renderPipeline);
      renderPass.setBindGroup(0, this.#renderBindGroup);
      renderPass.setViewport(0, 0, width, height, 0, 1);
      renderPass.draw(4);
      renderPass.end();
    }

    if (qs) {
      encoder.resolveQuerySet(qs, 0, 2, this.#profilingResolveBuffer, 0);
      const writeBuf = this.#profilingReadBuffers[this.#profilingWriteIndex];
      encoder.copyBufferToBuffer(this.#profilingResolveBuffer, 0, writeBuf, 0, 2 * 8);
    }

    this.#device.queue.submit([encoder.finish()]);

    if (qs && !this.#profilingMappingPending) {
      const bufToMap = this.#profilingReadBuffers[this.#profilingWriteIndex];
      this.#profilingWriteIndex = 1 - this.#profilingWriteIndex;
      this.#profilingMappingPending = true;

      bufToMap
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          try {
            const data = new BigInt64Array(bufToMap.getMappedRange());
            this.#processTimestamps(data);
          } finally {
            bufToMap.unmap();
            this.#profilingMappingPending = false;
          }
        })
        .catch(() => {
          this.#profilingMappingPending = false;
        });
    }
  }

  #handleResize = async () => {
    // Coalesce rapid resize events: if a rebuild is already in flight,
    // skip — the in-flight rebuild re-reads dimensions after the await
    // so it will pick up the latest size.
    if (this.#resizing) return;
    this.#resizing = true;

    // Setting #isRunning to false stops ALL render loop closures,
    // including any orphaned ones from previous resize calls.
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);

    await this.#device.queue.onSubmittedWorkDone();

    // Re-read dimensions after await — they may have changed while we waited.
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;

    this.#configureContext();
    this.#cleanupResources();
    this.#initBuffers();
    this.#initBindGroups();
    this.#updateShapeData();

    this.#resizing = false;
    this.#isRunning = true;
    this.#startAnimationLoop();
  };

  #handleMouseMove = (e: MouseEvent) => {
    const rect = this.getBoundingClientRect();
    this.#mousePosition.x = e.clientX - rect.left;
    this.#mousePosition.y = e.clientY - rect.top;
  };

  #handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === '.') {
      this.#profilingVisible = !this.#profilingVisible;
      if (this.#profilingOverlay) {
        this.#profilingOverlay.style.display = this.#profilingVisible ? 'block' : 'none';
      }
    }
    if (e.key === 'd') {
      const count = FolkRadianceCascade.#debugModeNames.length;
      this.#debugMode = (this.#debugMode + 1) % count;
      console.log(`[RC debug] mode ${this.#debugMode}: ${FolkRadianceCascade.#debugModeNames[this.#debugMode]}`);
      this.#fluenceUBOView.set({ debugMode: this.#debugMode });
      this.#device.queue.writeBuffer(this.#fluenceUBO, 0, this.#fluenceUBOView.arrayBuffer);
    }
  };

  #cleanupResources() {
    this.#cascadeTextures?.forEach((t) => t.destroy());
    this.#uboBuffer?.destroy();
    this.#fluenceUBO?.destroy();
    this.#renderUBO?.destroy();
    this.#jfaTextures?.forEach((t) => t.destroy());
    this.#jfaParamsBuffer?.destroy();
    this.#sdfTexture?.destroy();
    this.#worldTexture?.destroy();
    this.#fluenceTexture?.destroy();
    this.#shapeDataBuffer?.destroy();
    this.#lineInstanceBuffer?.destroy();
    this.#lineUBO?.destroy();
    this.#mouseLightBuffer?.destroy();
    this.#shapeDataBuffer = undefined;
    this.#lineInstanceBuffer = undefined;
    this.#lineInstanceCapacity = 0;
    this.#mouseLightBuffer = undefined;
  }

  #initProfiling() {
    if (!this.#profilingSupported) return;

    const count = 2;
    this.#profilingQuerySet = this.#device.createQuerySet({ type: 'timestamp', count });
    this.#profilingResolveBuffer = this.#device.createBuffer({
      label: 'Profiling-Resolve',
      size: count * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    this.#profilingReadBuffers = [0, 1].map((i) =>
      this.#device.createBuffer({
        label: `Profiling-Read-${i}`,
        size: count * 8,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    ) as [GPUBuffer, GPUBuffer];
  }

  #ensureProfilingOverlay() {
    if (this.#profilingOverlay) return;
    this.#profilingOverlay = document.createElement('div');
    Object.assign(this.#profilingOverlay.style, {
      position: 'fixed',
      bottom: '8px',
      right: '8px',
      fontFamily: "'SF Mono', Consolas, Monaco, monospace",
      fontSize: '11px',
      lineHeight: '1.5',
      color: '#0f0',
      background: 'rgba(0, 0, 0, 0.7)',
      padding: '6px 10px',
      borderRadius: '4px',
      zIndex: '99999',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      display: this.#profilingVisible ? 'block' : 'none',
    });
    document.body.appendChild(this.#profilingOverlay);
  }

  #processTimestamps(timestamps: BigInt64Array) {
    const total = Number(timestamps[1] - timestamps[0]) / 1_000_000;
    if (total <= 0 || isNaN(total)) return;
    const alpha = 0.1;
    this.#smoothedGpuTime =
      this.#smoothedGpuTime === 0 ? total : this.#smoothedGpuTime + alpha * (total - this.#smoothedGpuTime);
  }

  #updateOverlayDOM() {
    if (!this.#profilingVisible) return;
    this.#ensureProfilingOverlay();

    const fps = this.#smoothedCpuTime > 0 ? Math.round(1000 / this.#smoothedCpuTime) : 0;
    let text = `${fps} fps`;

    if (this.#profilingSupported && this.#smoothedGpuTime > 0) {
      text += `  GPU ${this.#smoothedGpuTime.toFixed(1)}ms`;
    }

    this.#profilingOverlay!.textContent = text;
  }

  #cleanupProfiling() {
    this.#profilingQuerySet?.destroy();
    this.#profilingResolveBuffer?.destroy();
    this.#profilingReadBuffers?.forEach((b) => b.destroy());
    this.#profilingOverlay?.remove();
  }
}

// JFA seed shader - initializes the distance field from the world texture.
// Pixels with alpha > 0 (occupied by emitters/occluders) become seeds with
// distance 0. Empty pixels get a sentinel value that JFA propagation will fill.
// This approach generates the SDF from whatever is in the world texture each
// frame, so it adapts to moving geometry automatically.
const jfaSeedShader = /*wgsl*/ `
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  pad: u32,
}

const SENTINEL: f32 = -1.0;

@group(0) @binding(0) var worldTexture: texture_2d<f32>;
@group(0) @binding(1) var output: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let world = textureLoad(worldTexture, id.xy, 0);

  if (world.a > 0.0) {
    textureStore(output, id.xy, vec4f(f32(id.x), f32(id.y), 0.0, 0.0));
  } else {
    textureStore(output, id.xy, vec4f(SENTINEL, SENTINEL, 0.0, 0.0));
  }
}
`;

// JFA propagation shader - standard Jump Flood Algorithm (Rong & Tan 2006).
// Each pass checks 9 neighbors at a given step distance and keeps the nearest
// seed. After log2(max(W,H)) passes with halving step sizes, every pixel knows
// its nearest seed and the Euclidean distance to it in pixel space.
// This distance field is then used for sphere marching in the raymarch pass.
const jfaShader = /*wgsl*/ `
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  pad: u32,
}

const SENTINEL: f32 = -1.0;

const OFFSETS: array<vec2i, 9> = array(
  vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
  vec2i(-1,  0), vec2i(0,  0), vec2i(1,  0),
  vec2i(-1,  1), vec2i(0,  1), vec2i(1,  1)
);

@group(0) @binding(0) var inputField: texture_2d<f32>;
@group(0) @binding(1) var outputField: texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let pixel = vec2f(id.xy);
  var nearest = textureLoad(inputField, id.xy, 0).xy;
  var minDist = select(distance(pixel, nearest), 1e10, nearest.x < 0.0);
  let step = i32(params.stepSize);

  for (var i = 0u; i < 9u; i++) {
    let neighborCoord = vec2i(id.xy) + OFFSETS[i] * step;

    let inBounds = all(neighborCoord >= vec2i(0)) &&
                   all(neighborCoord < vec2i(i32(params.width), i32(params.height)));
    if (!inBounds) { continue; }

    let neighbor = textureLoad(inputField, vec2u(neighborCoord), 0).xy;

    if (neighbor.x < 0.0) { continue; }

    let dist = distance(pixel, neighbor);
    if (dist < minDist) {
      nearest = neighbor;
      minDist = dist;
    }
  }

  textureStore(outputField, id.xy, vec4f(nearest, 0.0, 0.0));
}
`;

// JFA finalize shader — converts seed coordinates from the JFA result into a
// precomputed distance field. The output rgba16float texture is always filterable,
// enabling hardware bilinear sampling in the raymarch shader
const jfaFinalizeShader = /*wgsl*/ `
struct Params {
  width: u32,
  height: u32,
  stepSize: u32,
  pad: u32,
}

@group(0) @binding(0) var jfaResult: texture_2d<f32>;
@group(0) @binding(1) var sdfOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) {
    return;
  }

  let seed = textureLoad(jfaResult, id.xy, 0).xy;
  let pixel = vec2f(id.xy);
  let dist = select(distance(pixel, seed), 1e6, seed.x < 0.0);
  textureStore(sdfOutput, id.xy, vec4f(dist, 0.0, 0.0, 0.0));
}
`;

// World render shader - renders shapes/lines to world texture in linear color space.
// All cascade processing (raymarching, merging, fluence) operates in linear space;
// sRGB conversion happens only in the final display pass.
const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}

// sRGB to linear conversion. Input colors are perceptual (sRGB); the cascade
// pipeline must operate in linear space for physically correct light transport.
fn srgbToLinear(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(srgbToLinear(in.color), 1.0);
}
`;

// Line render shader: instanced capsule SDF quads.
// Each line is a single instance — the vertex shader expands it into a bounding
// quad, and the fragment shader evaluates the capsule SDF for pixel-perfect
// round endcaps with zero CPU tessellation.
const lineRenderShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) p1: vec2f,
  @location(2) p2: vec2f,
  @location(3) radius: f32,
}

struct Canvas { width: f32, height: f32 }
@group(0) @binding(0) var<uniform> canvas: Canvas;

fn srgbToLinear(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

@vertex
fn vertex_main(
  @builtin(vertex_index) vid: u32,
  @location(0) p1: vec2f,
  @location(1) p2: vec2f,
  @location(2) color: vec3f,
  @location(3) thickness: f32,
) -> VertexOutput {
  let r = thickness * 0.5;
  let minP = min(p1, p2) - vec2f(r);
  let maxP = max(p1, p2) + vec2f(r);

  var corners = array<vec2f, 6>(
    vec2f(0, 0), vec2f(1, 0), vec2f(0, 1),
    vec2f(1, 0), vec2f(1, 1), vec2f(0, 1),
  );
  let c = corners[vid];
  let pixel = minP + (maxP - minP) * c;
  let clip = vec2f(
    pixel.x / canvas.width * 2.0 - 1.0,
    1.0 - pixel.y / canvas.height * 2.0,
  );

  var out: VertexOutput;
  out.position = vec4f(clip, 0.0, 1.0);
  out.color = color;
  out.p1 = p1;
  out.p2 = p2;
  out.radius = r;
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let pos = in.position.xy;
  let ab = in.p2 - in.p1;
  let ap = pos - in.p1;
  let lenSq = dot(ab, ab);
  let t = select(clamp(dot(ap, ab) / lenSq, 0.0, 1.0), 0.0, lenSq < 0.001);
  let nearest = in.p1 + ab * t;
  let d = length(pos - nearest) - in.radius;
  if (d > 0.0) { discard; }
  return vec4f(srgbToLinear(in.color), 1.0);
}
`;

// Raymarch shader with pre-averaging and optional bilinear fix.
//
// Each thread handles one pre-averaged "bin" covering 4 sub-directions.
// Vanilla merge: 4 rays, each merged with 1 bilinear upper sample.
// Bilinear fix: 4 rays × 4 upper probes = 16 rays; each ray is aimed at
// one of the 4 surrounding upper probes, merged with that probe's value,
// then spatially weighted. Fixes ringing/parallax artifacts at 4× ray cost.
const raymarchShader = /*wgsl*/ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = PI * 2.0;

struct UBO {
  probeSpacing: f32,
  intervalStart: f32,
  intervalEnd: f32,
  level: i32,
  levelCount: i32,
  width: i32,
  height: i32,
  sqrtBins: i32,
  cascadeWidth: i32,
  cascadeHeight: i32,
  upperCascadeW: i32,
  upperCascadeH: i32,
  upperSqrtBins: i32,
}

@group(0) @binding(0) var cascadeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> ubo: UBO;
@group(0) @binding(2) var worldTexture: texture_2d<f32>;
@group(0) @binding(3) var worldSampler: sampler;
@group(0) @binding(4) var sdfTexture: texture_2d<f32>;
@group(0) @binding(5) var upperCascade: texture_2d<f32>;

fn sampleWorld(pos: vec2f) -> vec4f {
  let ipos = vec2i(pos);
  if (ipos.x < 0 || ipos.y < 0 || ipos.x >= ubo.width || ipos.y >= ubo.height) {
    return vec4f(0.0);
  }
  return textureLoad(worldTexture, ipos, 0);
}

fn sampleSDF(pos: vec2f) -> f32 {
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= dims.x || pos.y >= dims.y) {
    return 1e6;
  }
  let uv = pos / dims;
  return max(textureSampleLevel(sdfTexture, worldSampler, uv, 0.0).r, 0.0);
}

fn marchRay(origin: vec2f, direction: vec2f, intervalStart: f32, intervalLength: f32) -> vec4f {
  var hit = vec4f(0.0, 0.0, 0.0, 1.0);
  var t = 0.0;
  let remaining = intervalLength;
  while (t < remaining) {
    let pos = origin + direction * (intervalStart + t);
    let dist = sampleSDF(pos);
    if (dist >= remaining - t) { break; }
    if (dist < 1.0) {
      if (dist < 0.001 && t == 0.0 && ubo.level != 0) {
        t += 1.0;
        continue;
      }
      let worldSample = sampleWorld(pos);
      if (worldSample.a > 0.5) {
        hit = vec4f(worldSample.rgb, 0.0);
        break;
      }
      t += 1.0;
    } else {
      t += dist;
    }
  }
  return hit;
}

// Bilinear fix: read a specific upper probe's bin via point-sample (textureLoad)
fn loadUpperProbeBin(upperProbeX: i32, upperProbeY: i32, upperBinIndex: i32) -> vec4f {
  let pdx = upperBinIndex % ubo.upperSqrtBins;
  let pdy = upperBinIndex / ubo.upperSqrtBins;
  let texelX = pdx * ubo.upperCascadeW + upperProbeX;
  let texelY = pdy * ubo.upperCascadeH + upperProbeY;
  return textureLoad(upperCascade, vec2i(texelX, texelY), 0);
}

// Bilinear fix merge: cast a ray toward each of the 4 surrounding upper probes,
// merge each with that probe's stored value, then spatially weight the results.
fn mergeWithBilinearFix(
  probeCenter: vec2f, dir: vec2f,
  intervalStart: f32, intervalEnd: f32, upperBinIndex: i32
) -> vec4f {
  if (ubo.level >= ubo.levelCount) {
    return marchRay(probeCenter, dir, intervalStart, intervalEnd - intervalStart);
  }

  let upperProbeSpacing = ubo.probeSpacing * 2.0;
  let upperProbeF = probeCenter / upperProbeSpacing - 0.5;
  let baseProbe = vec2i(floor(upperProbeF));
  let frac = upperProbeF - vec2f(baseProbe);

  let w00 = (1.0 - frac.x) * (1.0 - frac.y);
  let w10 = frac.x * (1.0 - frac.y);
  let w01 = (1.0 - frac.x) * frac.y;
  let w11 = frac.x * frac.y;

  let maxPX = ubo.upperCascadeW - 1;
  let maxPY = ubo.upperCascadeH - 1;

  var merged = vec4f(0.0);
  for (var bi = 0; bi < 4; bi++) {
    let ox = bi & 1;
    let oy = (bi >> 1) & 1;
    let px = clamp(baseProbe.x + ox, 0, maxPX);
    let py = clamp(baseProbe.y + oy, 0, maxPY);

    let w = select(select(select(w11, w01, ox == 0), w10, oy == 0), w00, ox == 0 && oy == 0);

    let upperCenter = (vec2f(f32(px), f32(py)) + 0.5) * upperProbeSpacing;
    let rayEnd = upperCenter + dir * intervalEnd;
    let rayStart = probeCenter + dir * intervalStart;
    let toEnd = rayEnd - rayStart;
    let rayLen = length(toEnd);
    let rayDir = select(toEnd / rayLen, dir, rayLen < 0.001);

    let hit = marchRay(rayStart, rayDir, 0.0, rayLen);
    let upper = loadUpperProbeBin(px, py, upperBinIndex);
    merged += vec4f(hit.rgb + hit.a * upper.rgb, hit.a * upper.a) * w;
  }
  return merged;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let texW = u32(ubo.cascadeWidth * ubo.sqrtBins);
  let texH = u32(ubo.cascadeHeight * ubo.sqrtBins);
  if (id.x >= texW || id.y >= texH) { return; }

  let binX = i32(id.x) / ubo.cascadeWidth;
  let binY = i32(id.y) / ubo.cascadeHeight;
  let probeX = i32(id.x) % ubo.cascadeWidth;
  let probeY = i32(id.y) % ubo.cascadeHeight;
  let binIndex = binY * ubo.sqrtBins + binX;
  let totalRays = ubo.sqrtBins * ubo.sqrtBins * 4;

  let ProbeDiameter = ubo.probeSpacing;
  let ProbeRadius = ProbeDiameter * 0.5;
  let RayOrigin = vec2f(
    f32(probeX) * ProbeDiameter + ProbeRadius,
    f32(probeY) * ProbeDiameter + ProbeRadius,
  );

  let IntervalStart = ubo.intervalStart;
  let IntervalEnd = ubo.intervalEnd;

  let upperTotalBins = ubo.upperSqrtBins * ubo.upperSqrtBins;
  let currentTotalBins = ubo.sqrtBins * ubo.sqrtBins;
  let raysPerUpperBin = max(1, (4 * currentTotalBins) / upperTotalBins);

  var acc = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let rayIndex = binIndex * 4 + k;
    let angle = TAU * (f32(rayIndex) + 0.5) / f32(totalRays);
    let dir = vec2f(cos(angle), sin(angle));

    let upperBinIdx = rayIndex / raysPerUpperBin;
    acc += mergeWithBilinearFix(RayOrigin, dir, IntervalStart, IntervalEnd, upperBinIdx);
  }

  textureStore(cascadeOut, id.xy, acc * 0.25);
}
`;

// Fluence shader with C-1 gathering: for each pixel, traces a short per-pixel
// ray (C-1) in each of 4 directions and merges with the bilinearly-sampled
// per-direction C0 data from the cascade texture.
const fluenceShader = /*wgsl*/ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = PI * 2.0;

struct UBO {
  probeSpacing: f32,
  cascadeWidth: i32,
  cascadeHeight: i32,
  width: i32,
  height: i32,
  sqrtBins: i32,
  debugMode: i32,
}

@group(0) @binding(0) var fluenceTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var cascadeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> ubo: UBO;
@group(0) @binding(3) var cascadeSampler: sampler;
@group(0) @binding(4) var sdfTexture: texture_2d<f32>;
@group(0) @binding(5) var worldTexture: texture_2d<f32>;

fn sampleSDF(pos: vec2f) -> f32 {
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= dims.x || pos.y >= dims.y) {
    return 1e6;
  }
  let uv = pos / dims;
  return max(textureSampleLevel(sdfTexture, cascadeSampler, uv, 0.0).r, 0.0);
}

fn sampleWorld(pos: vec2f) -> vec4f {
  let ipos = vec2i(pos);
  if (ipos.x < 0 || ipos.y < 0 || ipos.x >= ubo.width || ipos.y >= ubo.height) {
    return vec4f(0.0);
  }
  return textureLoad(worldTexture, ipos, 0);
}

fn marchC1(origin: vec2f, direction: vec2f, maxDist: f32) -> vec4f {
  let originWorld = sampleWorld(origin);
  if (originWorld.a > 0.5) {
    return vec4f(originWorld.rgb, 0.0);
  }

  var t = 0.0;
  for (var i = 0; i < 8; i++) {
    if (t >= maxDist) { break; }
    let pos = origin + direction * t;
    let dist = sampleSDF(pos);
    if (dist >= maxDist - t) { break; }
    if (dist < 1.0) {
      let w = sampleWorld(pos);
      if (w.a > 0.5) {
        return vec4f(w.rgb, 0.0);
      }
    }
    t += max(dist, 0.5);
  }
  return vec4f(0.0, 0.0, 0.0, 1.0);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= ubo.width || i32(id.y) >= ubo.height) { return; }

  let texSize = vec2f(textureDimensions(cascadeTexture));

  // Mode 5: Raw cascade atlas — display the cascade texture directly.
  // The 2×2 directional tiles are visible at half spatial resolution each.
  if (ubo.debugMode == 5) {
    let rawUV = (vec2f(id.xy) + 0.5) / texSize;
    textureStore(fluenceTexture, id.xy, textureSampleLevel(cascadeTexture, cascadeSampler, rawUV, 0.0));
    return;
  }

  let pixelCenter = vec2f(id.xy) + 0.5;
  let probeCoord = pixelCenter / ubo.probeSpacing - 0.5;
  let clampedCoord = clamp(probeCoord, vec2f(0.5), vec2f(f32(ubo.cascadeWidth) - 1.5, f32(ubo.cascadeHeight) - 1.5));

  let binCount = ubo.sqrtBins * ubo.sqrtBins;
  let cm1Dist = ubo.probeSpacing;

  // Mode 4: Per-direction C-1+C0 merged — 2×2 interleaved.
  // Each 2×2 block shows all 4 directions from the block's center (probe center).
  // Layout matches cascade tile order: TL=dir0, TR=dir1, BL=dir2, BR=dir3.
  if (ubo.debugMode == 4) {
    let blockX = (id.x / 2u) * 2u;
    let blockY = (id.y / 2u) * 2u;
    let blockCenter = vec2f(f32(blockX) + 1.0, f32(blockY) + 1.0);
    let subX = i32(id.x % 2u);
    let subY = i32(id.y % 2u);
    let dirIdx = subY * ubo.sqrtBins + subX;

    let angle = TAU * (f32(dirIdx) + 0.5) / f32(binCount);
    let dir = vec2f(cos(angle), sin(angle));
    let cm1 = marchC1(blockCenter, dir, cm1Dist);

    let pc = blockCenter / ubo.probeSpacing - 0.5;
    let cc = clamp(pc, vec2f(0.5), vec2f(f32(ubo.cascadeWidth) - 1.5, f32(ubo.cascadeHeight) - 1.5));
    let tdx = dirIdx % ubo.sqrtBins;
    let tdy = dirIdx / ubo.sqrtBins;
    let tileOrig = vec2f(f32(tdx * ubo.cascadeWidth), f32(tdy * ubo.cascadeHeight));
    let dirUV = (tileOrig + cc + 0.5) / texSize;
    let c0dir = textureSampleLevel(cascadeTexture, cascadeSampler, dirUV, 0.0);

    textureStore(fluenceTexture, id.xy, vec4f(cm1.rgb + cm1.a * c0dir.rgb, 1.0));
    return;
  }

  let originSDF = sampleSDF(pixelCenter);
  let needsC1 = originSDF < cm1Dist;

  var merged = vec4f(0.0);
  var c0Only = vec4f(0.0);
  var cm1Only = vec4f(0.0);
  for (var d = 0; d < binCount; d++) {
    let dx = d % ubo.sqrtBins;
    let dy = d / ubo.sqrtBins;
    let tileOrigin = vec2f(f32(dx * ubo.cascadeWidth), f32(dy * ubo.cascadeHeight));
    let uv = (tileOrigin + clampedCoord + 0.5) / texSize;
    let c0 = textureSampleLevel(cascadeTexture, cascadeSampler, uv, 0.0);

    if (needsC1) {
      let angle = TAU * (f32(d) + 0.5) / f32(binCount);
      let dir = vec2f(cos(angle), sin(angle));
      let cm1 = marchC1(pixelCenter, dir, cm1Dist);
      merged += vec4f(cm1.rgb + cm1.a * c0.rgb, cm1.a * c0.a);
      cm1Only += cm1;
    } else {
      merged += c0;
    }
    c0Only += c0;
  }

  let n = f32(binCount);
  if (ubo.debugMode == 1) {
    textureStore(fluenceTexture, id.xy, cm1Only / n);
  } else if (ubo.debugMode == 2) {
    textureStore(fluenceTexture, id.xy, c0Only / n);
  } else if (ubo.debugMode == 3) {
    let diff = (merged - c0Only) / n;
    let vis = diff * 4.0 + 0.5;
    textureStore(fluenceTexture, id.xy, vec4f(vis.rgb, 1.0));
  } else {
    textureStore(fluenceTexture, id.xy, merged / n);
  }
}
`;

// Final display shader - composites emissive surfaces with indirect illumination,
// applies ACES tone mapping with exposure control, and converts to sRGB for display.
const renderShader = /*wgsl*/ `
struct UBO {
  exposure: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  let pos = array(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0),
  );
  var out: VertexOutput;
  out.position = vec4f(pos[vi], 0.0, 1.0);
  out.uv = pos[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

@group(0) @binding(0) var fluenceTexture: texture_2d<f32>;
@group(0) @binding(1) var fluenceSampler: sampler;
@group(0) @binding(2) var worldTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> ubo: UBO;

// ACES filmic tone mapping (Narkowicz 2015 fit). S-curve with a slight toe
// (contrast in shadows) and hard shoulder (highlights clip to white).
// At exposure=1, linear 1.0 maps to ~0.93 sRGB — close to full white.
fn acesTonemap(x: vec3f) -> vec3f {
  return clamp(
    (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14),
    vec3f(0.0), vec3f(1.0)
  );
}

fn linearToSrgb(c: vec3f) -> vec3f {
  return pow(c, vec3f(1.0 / 2.2));
}

fn pcg(v: u32) -> u32 {
  var state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return word ^ (word >> 16u);
}

fn triangularDither(pos: vec2u) -> vec3f {
  let s0 = pcg(pos.x + pos.y * 65536u);
  let s1 = pcg(s0);
  let s2 = pcg(s1);
  let s3 = pcg(s2);
  let s4 = pcg(s3);
  let s5 = pcg(s4);
  return vec3f(
    f32(s0) / 4294967295.0 + f32(s1) / 4294967295.0 - 1.0,
    f32(s2) / 4294967295.0 + f32(s3) / 4294967295.0 - 1.0,
    f32(s4) / 4294967295.0 + f32(s5) / 4294967295.0 - 1.0,
  ) / 255.0;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let fluence = textureSample(fluenceTexture, fluenceSampler, in.uv);
  let world = textureSample(worldTexture, fluenceSampler, in.uv);

  let emissive = world.rgb * world.a;
  let indirect = fluence.rgb;
  let hdr = (emissive + indirect) * ubo.exposure;

  let mapped = acesTonemap(hdr);
  let srgb = linearToSrgb(mapped) + triangularDither(vec2u(in.position.xy));
  return vec4f(srgb, 1.0);
}
`;
