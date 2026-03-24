import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { makeShaderDataDefinitions, makeStructuredView, type StructuredView } from 'webgpu-utils';
import { FolkBaseSet } from './folk-base-set';

type Line = [x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, thickness: number];

// The one tunable parameter: probe spacing at the finest cascade level.
// Smaller = higher quality, larger cascade textures.
const PROBE_SPACING_0 = 1;

// Fixed by the 2D Radiance Cascades algorithm (Sannikov 2023).
// In 2D, 4 base rays with 4× angular branching and 2× spatial scaling
// produces equal-sized cascade textures at every level — the standard
// configuration used by all reference implementations.
const BASE_RAY_COUNT = 4;
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

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World texture - stores scene (emissive RGB, opacity)
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;

  // Pipelines
  #worldRenderPipeline!: GPURenderPipeline;
  #mouseLightPipeline!: GPURenderPipeline;
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
  #mouseLightUBO!: GPUBuffer;
  #fluenceUBO!: GPUBuffer;
  #jfaTextures!: GPUTexture[];
  #jfaTextureViews!: GPUTextureView[];
  #jfaParamsBuffer!: GPUBuffer;
  #sdfTexture!: GPUTexture;
  #sdfTextureView!: GPUTextureView;
  #fluenceTexture!: GPUTexture;
  #fluenceTextureView!: GPUTextureView;

  // Pre-allocated bind groups (created once at init/resize, not per frame)
  #mouseLightBindGroup!: GPUBindGroup;
  #jfaSeedBindGroup!: GPUBindGroup;
  #jfaPassBindGroups!: GPUBindGroup[];
  #jfaFinalizeBindGroup!: GPUBindGroup;
  #raymarchBindGroups!: GPUBindGroup[];
  #fluenceBindGroup!: GPUBindGroup;
  #renderBindGroup!: GPUBindGroup;

  // Structured views for type-safe UBO packing (from webgpu-utils)
  #raymarchUBOView!: StructuredView;
  #fluenceUBOView!: StructuredView;
  #mouseLightUBOView!: StructuredView;
  #jfaParamsView!: StructuredView;

  // Shape data for rendering to world texture
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  #lines: Line[] = [];
  #lineBuffer?: GPUBuffer;
  #lineVertexCount = 0;
  #lineBufferDirty = false;

  // Samplers
  #linearSampler!: GPUSampler;

  // Animation state
  #animationFrame = 0;
  #mousePosition = { x: 0, y: 0 };
  #mouseLightColor = { r: 0.8, g: 0.6, b: 0.3 };
  #isRunning = false;
  #resizing = false;

  // Computed values
  #numCascadeLevels = 0;
  #jfaPassCount = 0;
  #jfaResultIndex = 0;
  #maxCascadeTexW = 0;
  #maxCascadeTexH = 0;

  // Debug visualization
  #debugMode = 0;
  #debugDirection = 0;
  #debugCascadeIdx = 0; // 0 = level-0 result tex, 1 = the other
  #debugRenderPipeline!: GPURenderPipeline;
  #debugBindGroup!: GPUBindGroup;
  #debugUBO!: GPUBuffer;
  #debugUBOView!: StructuredView;

  static readonly #debugModeNames = ['Normal', 'SDF', 'World', 'Cascade (raw)', 'Cascade (tile)', 'Fluence', 'JFA Seeds'];

  // Profiling
  #profilingSupported = false;
  #profilingQuerySet!: GPUQuerySet;
  #profilingResolveBuffer!: GPUBuffer;
  #profilingReadBuffers!: [GPUBuffer, GPUBuffer];
  #profilingWriteIndex = 0;
  #profilingMappingPending = false;
  #profilingOverlay!: HTMLDivElement;
  #smoothedGpuTimes = { world: 0, jfa: 0, cascade: 0, fluence: 0, render: 0, total: 0 };
  #smoothedCpuTime = 0;
  #lastOverlayUpdate = 0;

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
      this.#lineVertexCount = 0;
      return;
    }

    // Each line becomes a quad (2 triangles) plus round endcaps (filled circles
    // at each endpoint). The caps fill gaps between consecutive segments that
    // would otherwise let rays leak through at joints — the root cause of the
    // beaded shadow artifacts along curved lines.
    const CAP_SEGMENTS = 8;
    // Vertex format: x, y, r, g, b (5 floats, 20 bytes)
    const vertices: number[] = [];

    const toClipX = (x: number) => (x / this.#canvas.width) * 2 - 1;
    const toClipY = (y: number) => 1 - (y / this.#canvas.height) * 2;
    const clipRadiusX = (px: number) => (px / this.#canvas.width) * 2;
    const clipRadiusY = (px: number) => (px / this.#canvas.height) * 2;

    for (const line of this.#lines) {
      const [x1, y1, x2, y2, r, g, b, thickness] = line;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const nx = (-dy / len) * (thickness / 2);
      const ny = (dx / len) * (thickness / 2);

      // Quad body
      const p1x = toClipX(x1 - nx),
        p1y = toClipY(y1 - ny);
      const p2x = toClipX(x1 + nx),
        p2y = toClipY(y1 + ny);
      const p3x = toClipX(x2 - nx),
        p3y = toClipY(y2 - ny);
      const p4x = toClipX(x2 + nx),
        p4y = toClipY(y2 + ny);

      vertices.push(p1x, p1y, r, g, b);
      vertices.push(p2x, p2y, r, g, b);
      vertices.push(p3x, p3y, r, g, b);
      vertices.push(p2x, p2y, r, g, b);
      vertices.push(p4x, p4y, r, g, b);
      vertices.push(p3x, p3y, r, g, b);

      // Round endcaps — full circles at each endpoint so adjacent segments
      // overlap cleanly regardless of the joint angle.
      const rx = clipRadiusX(thickness / 2);
      const ry = clipRadiusY(thickness / 2);

      for (const [ex, ey] of [
        [x1, y1],
        [x2, y2],
      ]) {
        const cx = toClipX(ex);
        const cy = toClipY(ey);
        for (let i = 0; i < CAP_SEGMENTS; i++) {
          const a0 = (i / CAP_SEGMENTS) * Math.PI * 2;
          const a1 = ((i + 1) / CAP_SEGMENTS) * Math.PI * 2;
          vertices.push(cx, cy, r, g, b);
          vertices.push(cx + Math.cos(a0) * rx, cy + Math.sin(a0) * ry, r, g, b);
          vertices.push(cx + Math.cos(a1) * rx, cy + Math.sin(a1) * ry, r, g, b);
        }
      }
    }

    if (vertices.length === 0) {
      this.#lineVertexCount = 0;
      return;
    }

    this.#lineVertexCount = vertices.length / 5;
    this.#lineBuffer = uploadVertexData(this.#device, this.#lineBuffer, new Float32Array(vertices));
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
    this.#mouseLightUBOView = uboView(mouseLightShader, 'light');
    this.#jfaParamsView = uboView(jfaSeedShader, 'params');
    this.#debugUBOView = uboView(debugShader, 'debug');
  }

  #initBuffers() {
    const { width, height } = this.#canvas;

    // Number of cascade levels needed to cover the screen diagonal.
    // Level N covers up to PROBE_SPACING_0 * BRANCHING_FACTOR^N pixels.
    const diagonal = Math.sqrt(width * width + height * height);
    this.#numCascadeLevels = Math.ceil(Math.log(diagonal / PROBE_SPACING_0) / Math.log(BRANCHING_FACTOR)) + 1;

    // Compute max cascade texture dimensions across all levels.
    // Each level's texture tiles probes spatially within direction-tiles:
    //   texW = probesX * sqrtRays, texH = probesY * sqrtRays
    // Both ping-pong textures are sized to the maximum across all levels
    // so we can reuse them without reallocation.
    this.#maxCascadeTexW = 0;
    this.#maxCascadeTexH = 0;
    for (let level = 0; level <= this.#numCascadeLevels; level++) {
      const spacing = PROBE_SPACING_0 * Math.pow(SPATIAL_SCALE, level);
      const probesX = Math.floor(width / spacing);
      const probesY = Math.floor(height / spacing);
      const sqrtRays = Math.round(Math.sqrt(BASE_RAY_COUNT * Math.pow(BRANCHING_FACTOR, level)));
      this.#maxCascadeTexW = Math.max(this.#maxCascadeTexW, probesX * sqrtRays);
      this.#maxCascadeTexH = Math.max(this.#maxCascadeTexH, probesY * sqrtRays);
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

    this.#mouseLightUBO = this.#device.createBuffer({
      label: 'MouseLightUBO',
      size: this.#mouseLightUBOView.arrayBuffer.byteLength,
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

    this.#debugUBO = this.#device.createBuffer({
      label: 'DebugUBO',
      size: Math.max(this.#debugUBOView.arrayBuffer.byteLength, 32),
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

    // Mouse light pipeline - renders mouse cursor as emissive circle into world texture
    const mouseLightModule = device.createShaderModule({ code: mouseLightShader });
    this.#mouseLightPipeline = device.createRenderPipeline({
      label: 'MouseLight-Pipeline',
      layout: 'auto',
      vertex: { module: mouseLightModule, entryPoint: 'vertex_main' },
      fragment: {
        module: mouseLightModule,
        entryPoint: 'fragment_main',
        targets: [
          {
            format: 'rgba16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-strip' },
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

    // Debug visualization pipeline
    const debugModule = device.createShaderModule({ code: debugShader });
    this.#debugRenderPipeline = device.createRenderPipeline({
      label: 'Debug-Pipeline',
      layout: 'auto',
      vertex: { module: debugModule, entryPoint: 'vertex_main' },
      fragment: {
        module: debugModule,
        entryPoint: 'fragment_main',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  #initBindGroups() {
    const { width, height } = this.#canvas;
    const uboSize = this.#raymarchUBOView.arrayBuffer.byteLength;

    // Mouse light bind group
    this.#mouseLightBindGroup = this.#device.createBindGroup({
      layout: this.#mouseLightPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.#mouseLightUBO } }],
    });

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
      const sqrtRays = Math.round(Math.sqrt(BASE_RAY_COUNT * Math.pow(BRANCHING_FACTOR, level)));
      const cascadeWidth = Math.floor(width / probeSpacing);
      const cascadeHeight = Math.floor(height / probeSpacing);
      const intervalStart = level === 0 ? 0 : PROBE_SPACING_0 * Math.pow(BRANCHING_FACTOR, level - 1);

      // Pre-compute upper cascade dimensions on the CPU so the shader doesn't
      // re-derive them via integer division (which can mismatch due to truncation).
      const upperSpacing = PROBE_SPACING_0 * Math.pow(SPATIAL_SCALE, level + 1);

      // Extend each interval by the diagonal of the upper cascade's probe spacing
      // (Yaazarai pattern) to prevent light leaks at cascade boundaries.
      const overlap = level < levelCount ? Math.SQRT2 * upperSpacing : 0;
      const intervalEnd = PROBE_SPACING_0 * Math.pow(BRANCHING_FACTOR, level) + overlap;
      const upperCascadeW = level >= levelCount ? 0 : Math.floor(width / upperSpacing);
      const upperCascadeH = level >= levelCount ? 0 : Math.floor(height / upperSpacing);

      this.#raymarchUBOView.set({
        probeSpacing,
        intervalStart,
        intervalEnd,
        level,
        levelCount,
        width,
        height,
        sqrtRays,
        cascadeWidth,
        cascadeHeight,
        upperCascadeW,
        upperCascadeH,
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
    const level0SqrtRays = Math.round(Math.sqrt(BASE_RAY_COUNT));
    this.#fluenceUBOView.set({
      probeSpacing: PROBE_SPACING_0,
      cascadeWidth,
      cascadeHeight,
      width,
      height,
      sqrtRays: level0SqrtRays,
    });
    this.#device.queue.writeBuffer(this.#fluenceUBO, 0, this.#fluenceUBOView.arrayBuffer);

    this.#fluenceBindGroup = this.#device.createBindGroup({
      layout: this.#fluencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#fluenceTextureView },
        { binding: 1, resource: this.#cascadeTextureViews[level0ResultIndex] },
        { binding: 2, resource: { buffer: this.#fluenceUBO } },
        { binding: 3, resource: this.#linearSampler },
      ],
    });

    // Final render bind group
    this.#renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#fluenceTextureView },
        { binding: 1, resource: this.#linearSampler },
        { binding: 2, resource: this.#worldTextureView },
      ],
    });

    // Debug visualization bind group — exposes all intermediate textures
    this.#debugBindGroup = this.#device.createBindGroup({
      layout: this.#debugRenderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#linearSampler },
        { binding: 1, resource: this.#sdfTextureView },
        { binding: 2, resource: this.#worldTextureView },
        { binding: 3, resource: this.#cascadeTextureViews[0] },
        { binding: 4, resource: this.#cascadeTextureViews[1] },
        { binding: 5, resource: this.#fluenceTextureView },
        { binding: 6, resource: this.#jfaTextureViews[this.#jfaResultIndex] },
        { binding: 7, resource: { buffer: this.#debugUBO } },
      ],
    });
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (!this.#device) return;
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

      if (this.#profilingOverlay && now - this.#lastOverlayUpdate > 200) {
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

    const { width, height } = this.#canvas;
    const jfaWorkgroupsX = Math.ceil(width / 16);
    const jfaWorkgroupsY = Math.ceil(height / 16);
    const cascadeWorkgroupsX = Math.ceil(this.#maxCascadeTexW / 16);
    const cascadeWorkgroupsY = Math.ceil(this.#maxCascadeTexH / 16);

    // Only the mouse light UBO changes per frame (mouse position).
    // All other UBOs are written once in #initBindGroups.
    this.#mouseLightUBOView.set({
      mouseX: this.#mousePosition.x,
      mouseY: this.#mousePosition.y,
      radius: 20.0,
      intensity: 1.0,
      canvasWidth: width,
      canvasHeight: height,
      colorR: this.#mouseLightColor.r,
      colorG: this.#mouseLightColor.g,
      colorB: this.#mouseLightColor.b,
      pad: 0,
    });
    this.#device.queue.writeBuffer(this.#mouseLightUBO, 0, this.#mouseLightUBOView.arrayBuffer);

    const encoder = this.#device.createCommandEncoder();
    const qs = this.#profilingSupported ? this.#profilingQuerySet : null;

    // Step 1: Clear and render world texture
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

      if (this.#lineBuffer && this.#lineVertexCount > 0) {
        renderPass.setVertexBuffer(0, this.#lineBuffer);
        renderPass.draw(this.#lineVertexCount);
      }

      renderPass.end();
    }

    // Step 1b: Draw mouse light
    {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.#worldTextureView, loadOp: 'load', storeOp: 'store' }],
        ...(qs && { timestampWrites: { querySet: qs, endOfPassWriteIndex: 1 } }),
      });
      renderPass.setPipeline(this.#mouseLightPipeline);
      renderPass.setBindGroup(0, this.#mouseLightBindGroup);
      renderPass.draw(4);
      renderPass.end();
    }

    // Step 2: JFA distance field + SDF finalize
    {
      const seedPass = encoder.beginComputePass(
        qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2 } } : undefined,
      );
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

      // Finalize: convert seed coordinates → distance for hardware-filtered SDF sampling
      const finalizePass = encoder.beginComputePass(
        qs ? { timestampWrites: { querySet: qs, endOfPassWriteIndex: 3 } } : undefined,
      );
      finalizePass.setPipeline(this.#jfaFinalizePipeline);
      finalizePass.setBindGroup(0, this.#jfaFinalizeBindGroup);
      finalizePass.dispatchWorkgroups(jfaWorkgroupsX, jfaWorkgroupsY);
      finalizePass.end();
    }

    // Step 3: Raymarch each cascade level (highest first, ping-ponging cascade textures).
    const levelCount = this.#numCascadeLevels;
    for (let level = levelCount; level >= 0; level--) {
      const isFirstCascade = level === levelCount;
      const isLastCascade = level === 0;
      const computePass = encoder.beginComputePass(
        qs && (isFirstCascade || isLastCascade)
          ? {
              timestampWrites: {
                querySet: qs,
                ...(isFirstCascade && { beginningOfPassWriteIndex: 4 }),
                ...(isLastCascade && { endOfPassWriteIndex: 5 }),
              },
            }
          : undefined,
      );
      computePass.setPipeline(this.#raymarchPipeline);
      computePass.setBindGroup(0, this.#raymarchBindGroups[level]);
      computePass.dispatchWorkgroups(cascadeWorkgroupsX, cascadeWorkgroupsY, 1);
      computePass.end();
    }

    // Step 4: Build fluence texture from cascade-0 result
    {
      const computePass = encoder.beginComputePass(
        qs ? { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 6, endOfPassWriteIndex: 7 } } : undefined,
      );
      computePass.setPipeline(this.#fluencePipeline);
      computePass.setBindGroup(0, this.#fluenceBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16), 1);
      computePass.end();
    }

    // Step 5: Final render (or debug visualization)
    {
      if (this.#debugMode > 0) {
        const level0ResultIndex = this.#numCascadeLevels % 2;
        const cascadeWidth = Math.floor(width / PROBE_SPACING_0);
        const cascadeHeight = Math.floor(height / PROBE_SPACING_0);
        const sqrtRays = Math.round(Math.sqrt(BASE_RAY_COUNT));
        const dir = this.#debugDirection;
        const dx = dir % sqrtRays;
        const dy = Math.floor(dir / sqrtRays);

        this.#debugUBOView.set({
          mode: this.#debugMode,
          resultIdx: this.#debugCascadeIdx === 0 ? level0ResultIndex : 1 - level0ResultIndex,
          tileOffsetX: dx * cascadeWidth,
          tileOffsetY: dy * cascadeHeight,
          tileSizeX: cascadeWidth,
          tileSizeY: cascadeHeight,
          texSizeX: this.#maxCascadeTexW,
          texSizeY: this.#maxCascadeTexH,
        });
        this.#device.queue.writeBuffer(this.#debugUBO, 0, this.#debugUBOView.arrayBuffer);
      }

      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        ...(qs && { timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 8, endOfPassWriteIndex: 9 } }),
      });

      if (this.#debugMode > 0) {
        renderPass.setPipeline(this.#debugRenderPipeline);
        renderPass.setBindGroup(0, this.#debugBindGroup);
      } else {
        renderPass.setPipeline(this.#renderPipeline);
        renderPass.setBindGroup(0, this.#renderBindGroup);
      }

      renderPass.setViewport(0, 0, width, height, 0, 1);
      renderPass.draw(4);
      renderPass.end();
    }

    if (qs) {
      encoder.resolveQuerySet(qs, 0, 10, this.#profilingResolveBuffer, 0);
      const writeBuf = this.#profilingReadBuffers[this.#profilingWriteIndex];
      encoder.copyBufferToBuffer(this.#profilingResolveBuffer, 0, writeBuf, 0, 10 * 8);
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
    if (e.key >= '0' && e.key <= '6') {
      this.#debugMode = parseInt(e.key);
    } else if (e.key === '=' || e.key === '+') {
      this.#debugDirection = (this.#debugDirection + 1) % (BASE_RAY_COUNT * BRANCHING_FACTOR);
    } else if (e.key === '-' || e.key === '_') {
      const total = BASE_RAY_COUNT * BRANCHING_FACTOR;
      this.#debugDirection = (this.#debugDirection + total - 1) % total;
    } else if (e.key === ']') {
      this.#debugCascadeIdx = 1 - this.#debugCascadeIdx;
    } else if (e.key === '[') {
      this.#debugCascadeIdx = 1 - this.#debugCascadeIdx;
    }
  };

  #cleanupResources() {
    this.#cascadeTextures?.forEach((t) => t.destroy());
    this.#uboBuffer?.destroy();
    this.#mouseLightUBO?.destroy();
    this.#fluenceUBO?.destroy();
    this.#debugUBO?.destroy();
    this.#jfaTextures?.forEach((t) => t.destroy());
    this.#jfaParamsBuffer?.destroy();
    this.#sdfTexture?.destroy();
    this.#worldTexture?.destroy();
    this.#fluenceTexture?.destroy();
    this.#shapeDataBuffer?.destroy();
    this.#lineBuffer?.destroy();
    this.#shapeDataBuffer = undefined;
    this.#lineBuffer = undefined;
  }

  #initProfiling() {
    if (!this.#profilingSupported) {
      this.#createProfilingOverlay();
      return;
    }

    const count = 10;
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

    this.#createProfilingOverlay();
  }

  #createProfilingOverlay() {
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
    });
    document.body.appendChild(this.#profilingOverlay);
  }

  #processTimestamps(timestamps: BigInt64Array) {
    const toMs = (begin: bigint, end: bigint) => Number(end - begin) / 1_000_000;

    const world = toMs(timestamps[0], timestamps[1]);
    const jfa = toMs(timestamps[2], timestamps[3]);
    const cascade = toMs(timestamps[4], timestamps[5]);
    const fluence = toMs(timestamps[6], timestamps[7]);
    const render = toMs(timestamps[8], timestamps[9]);
    const total = toMs(timestamps[0], timestamps[9]);

    if (total <= 0 || isNaN(total)) return;

    const alpha = 0.1;
    const s = this.#smoothedGpuTimes;
    const ema = (prev: number, curr: number) => (prev === 0 ? curr : prev + alpha * (curr - prev));
    s.world = ema(s.world, world);
    s.jfa = ema(s.jfa, jfa);
    s.cascade = ema(s.cascade, cascade);
    s.fluence = ema(s.fluence, fluence);
    s.render = ema(s.render, render);
    s.total = ema(s.total, total);
  }

  #updateOverlayDOM() {
    if (!this.#profilingOverlay) return;

    const { width, height } = this.#canvas;
    const fps = this.#smoothedCpuTime > 0 ? Math.round(1000 / this.#smoothedCpuTime) : 0;
    const fmt = (ms: number) => ms.toFixed(2).padStart(5);

    const modeName = FolkRadianceCascade.#debugModeNames[this.#debugMode] ?? 'Unknown';
    let text = `${width}×${height}  ${fps} fps  [${this.#debugMode}] ${modeName}`;

    if (this.#debugMode === 4) {
      text += `  dir=${this.#debugDirection}`;
    }
    if (this.#debugMode === 3 || this.#debugMode === 4) {
      text += `  tex=${this.#debugCascadeIdx}`;
    }

    if (this.#profilingSupported && this.#smoothedGpuTimes.total > 0) {
      const s = this.#smoothedGpuTimes;
      text +=
        `  GPU ${fmt(s.total)}ms\n` +
        ` Scene   ${fmt(s.world)}ms\n` +
        ` JFA     ${fmt(s.jfa)}ms\n` +
        ` Cascade ${fmt(s.cascade)}ms\n` +
        ` Fluence ${fmt(s.fluence)}ms\n` +
        ` Render  ${fmt(s.render)}ms`;
    }

    this.#profilingOverlay.textContent = text;
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

// Mouse light shader - renders the cursor as an emissive circle into the world texture.
// By placing the mouse light in the world texture (rather than injecting it directly
// into the raymarch), it naturally participates in occlusion and indirect illumination:
// objects can block the mouse light and it bounces off surfaces correctly.
const mouseLightShader = /*wgsl*/ `
struct MouseLight {
  mouseX: f32,
  mouseY: f32,
  radius: f32,
  intensity: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  colorR: f32,
  colorG: f32,
  colorB: f32,
  pad: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var<uniform> light: MouseLight;

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

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let pixelPos = in.uv * vec2f(light.canvasWidth, light.canvasHeight);
  let mousePos = vec2f(light.mouseX, light.mouseY);
  let dist = length(pixelPos - mousePos);

  if (dist >= light.radius) {
    discard;
  }

  // Quadratic falloff from center. Low opacity so rays pass through the light
  // volume rather than treating it as a solid occluder.
  let falloff = 1.0 - dist / light.radius;
  let brightness = falloff * falloff * light.intensity;
  let color = vec3f(light.colorR, light.colorG, light.colorB);
  let opacity = 0.02;
  return vec4f(brightness * color, opacity);
}
`;

// Raymarch shader - traces rays through the scene using SDF sphere marching.
//
// Each ray covers a specific interval [intervalStart, intervalEnd] in pixel distance
// from its probe center. The SDF (generated by JFA) provides the distance to the
// nearest surface at each sample point, allowing rays to skip empty space in large
// strides rather than stepping pixel-by-pixel. This reduces per-ray cost from
// O(interval_length) to O(log(interval_length)) in practice (Sannikov 2023).
//
// Radiance is accumulated front-to-back with transmittance tracking:
//   acc.rgb = accumulated radiance (pre-multiplied by transmittance)
//   acc.a   = remaining transmittance (1.0 = fully transparent, 0.0 = fully blocked)
// The merge with the upper cascade uses the standard interval merging formula:
//   merged.rgb = near.rgb + near.a * far.rgb
//   merged.a   = near.a * far.a
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
  sqrtRays: i32,
  cascadeWidth: i32,
  cascadeHeight: i32,
  upperCascadeW: i32,
  upperCascadeH: i32,
}

@group(0) @binding(0) var cascadeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> ubo: UBO;
@group(0) @binding(2) var worldTexture: texture_2d<f32>;
@group(0) @binding(3) var worldSampler: sampler;
@group(0) @binding(4) var sdfTexture: texture_2d<f32>;
@group(0) @binding(5) var upperCascade: texture_2d<f32>;

fn sampleWorld(pos: vec2f) -> vec4f {
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  let uv = pos / dims;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4f(0.0);
  }
  return textureSampleLevel(worldTexture, worldSampler, uv, 0.0);
}

fn sampleSDF(pos: vec2f) -> f32 {
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= dims.x || pos.y >= dims.y) {
    return 1e6;
  }
  let uv = (pos + 0.5) / dims;
  return max(textureSampleLevel(sdfTexture, worldSampler, uv, 0.0).r, 0.0);
}

// Bilinear merge: sample 4 neighboring upper probes using hardware bilinear
// interpolation. In direction-first layout, each direction tile contains
// spatially-arranged probes, so textureSampleLevel with a linear sampler
// naturally interpolates between neighboring probes.
//
// Upper cascade dimensions (upperCascadeW/H) are passed through the UBO
// rather than re-derived in the shader, avoiding integer division truncation
// mismatches between CPU and GPU.
fn sampleUpperCascade(probeCenter: vec2f, dirIndex: i32) -> vec4f {
  if (ubo.level >= ubo.levelCount) { return vec4f(0.0, 0.0, 0.0, 1.0); }

  let upperSqrtRays = ubo.sqrtRays * 2;
  let upperProbeSpacing = ubo.probeSpacing * 2.0;
  let texSize = vec2f(textureDimensions(upperCascade));
  let upperProbePos = probeCenter / upperProbeSpacing - 0.5;
  // Clamp to [0.5, size - 1.5] so the bilinear 2×2 footprint stays entirely
  // within the direction tile. Without this, edge probes sample from adjacent
  // direction tiles — a different direction's data masquerading as spatial neighbors.
  let clampedPos = clamp(upperProbePos, vec2f(0.5), vec2f(f32(ubo.upperCascadeW) - 1.5, f32(ubo.upperCascadeH) - 1.5));

  var acc = vec4f(0.0);
  for (var k = 0; k < 4; k++) {
    let parentDir = dirIndex * 4 + k;
    let pdx = parentDir % upperSqrtRays;
    let pdy = parentDir / upperSqrtRays;
    let tileOrigin = vec2f(f32(pdx * ubo.upperCascadeW), f32(pdy * ubo.upperCascadeH));
    let uv = (tileOrigin + clampedPos + 0.5) / texSize;
    acc += textureSampleLevel(upperCascade, worldSampler, uv, 0.0);
  }
  return acc * 0.25;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let texW = u32(ubo.cascadeWidth * ubo.sqrtRays);
  let texH = u32(ubo.cascadeHeight * ubo.sqrtRays);
  if (id.x >= texW || id.y >= texH) { return; }

  // Direction-first layout: each tile of cascadeWidth × cascadeHeight texels
  // contains all probes for one direction. Tiles are arranged in a
  // sqrtRays × sqrtRays grid across the texture.
  let dirX = i32(id.x) / ubo.cascadeWidth;
  let dirY = i32(id.y) / ubo.cascadeHeight;
  let probeX = i32(id.x) % ubo.cascadeWidth;
  let probeY = i32(id.y) % ubo.cascadeHeight;
  let rayIndex = dirY * ubo.sqrtRays + dirX;
  let totalRays = ubo.sqrtRays * ubo.sqrtRays;

  let ProbeDiameter = ubo.probeSpacing;
  let ProbeRadius = ProbeDiameter * 0.5;

  // Half-texel angular offset centers rays between directions (Sannikov 2023 Sec. 3)
  let RayAngle = TAU * (f32(rayIndex) + 0.5) / f32(totalRays);
  let RayDirection = vec2f(cos(RayAngle), sin(RayAngle));
  let RayOrigin = vec2f(
    f32(probeX) * ProbeDiameter + ProbeRadius,
    f32(probeY) * ProbeDiameter + ProbeRadius,
  );

  let IntervalStart = ubo.intervalStart;
  let IntervalEnd = ubo.intervalEnd;
  let IntervalLength = IntervalEnd - IntervalStart;

  // SDF sphere march through the interval
  var acc = vec4f(0.0, 0.0, 0.0, 1.0);
  var t = 0.0;

  while (t < IntervalLength) {
    let pos = RayOrigin + RayDirection * (IntervalStart + t);
    let dist = sampleSDF(pos);

    if (dist < 1.0) {
      // Rays starting inside a light volume on non-zero cascades should not
      // accumulate that light's radiance — only cascade 0 sees surface emission
      // directly. Without this, higher cascades double-count nearby emitters.
      if (dist < 0.001 && t == 0.0 && ubo.level != 0) {
        t += 1.0;
        continue;
      }
      let worldSample = sampleWorld(pos);
      let transparency = 1.0 - worldSample.a;
      acc = vec4f(
        acc.rgb + acc.a * worldSample.rgb,
        acc.a * transparency
      );
      if (acc.a < 0.01) { break; }
      t += 1.0;
    } else {
      t += dist;
    }
  }

  let upper = sampleUpperCascade(RayOrigin, rayIndex);
  textureStore(cascadeOut, id.xy, vec4f(
    acc.rgb + acc.a * upper.rgb,
    acc.a * upper.a
  ));
}
`;

// Fluence shader: samples the merged cascade-0 texture to produce per-pixel
// irradiance. Level 0 has BASE_RAY_COUNT rays arranged in a sqrtRays × sqrtRays
// grid of direction tiles. For each pixel, we compute the probe coordinate and
// use hardware bilinear sampling within each direction tile, then sum all
// directions for isotropic angular integration.
const fluenceShader = /*wgsl*/ `
struct UBO {
  probeSpacing: f32,
  cascadeWidth: i32,
  cascadeHeight: i32,
  width: i32,
  height: i32,
  sqrtRays: i32,
}

@group(0) @binding(0) var fluenceTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var cascadeTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> ubo: UBO;
@group(0) @binding(3) var cascadeSampler: sampler;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= ubo.width || i32(id.y) >= ubo.height) { return; }

  let pixelCenter = vec2f(id.xy) + 0.5;
  let probeCoord = pixelCenter / ubo.probeSpacing - 0.5;
  // Clamp to [0.5, size - 1.5] so the bilinear 2×2 footprint stays entirely
  // within each direction tile.
  let clampedCoord = clamp(probeCoord, vec2f(0.5), vec2f(f32(ubo.cascadeWidth) - 1.5, f32(ubo.cascadeHeight) - 1.5));
  let texSize = vec2f(textureDimensions(cascadeTexture));

  let rayCount = ubo.sqrtRays * ubo.sqrtRays;
  var acc = vec4f(0.0);
  for (var d = 0; d < rayCount; d++) {
    let dx = d % ubo.sqrtRays;
    let dy = d / ubo.sqrtRays;
    let tileOrigin = vec2f(f32(dx * ubo.cascadeWidth), f32(dy * ubo.cascadeHeight));
    let uv = (tileOrigin + clampedCoord + 0.5) / texSize;
    acc += textureSampleLevel(cascadeTexture, cascadeSampler, uv, 0.0);
  }

  textureStore(fluenceTexture, id.xy, acc / f32(rayCount));
}
`;

// Final display shader - composites emissive surfaces with indirect illumination,
// applies tone mapping, and converts from linear to sRGB for display.
//
// The world texture stores emissive colors in linear space (written by the world
// render pass). The fluence texture stores indirect illumination accumulated by the
// cascade pipeline, also in linear space. We combine them, tone map to [0,1], then
// apply the sRGB transfer function for correct perceptual display.
const renderShader = /*wgsl*/ `
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

// Reinhard tone mapping: simple and stable global operator that maps HDR [0, inf)
// to LDR [0, 1) per-channel. Chosen over ACES for simplicity; can be swapped later.
fn reinhardTonemap(hdr: vec3f) -> vec3f {
  return hdr / (hdr + vec3f(1.0));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  return pow(c, vec3f(1.0 / 2.2));
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let fluence = textureSample(fluenceTexture, fluenceSampler, in.uv);
  let world = textureSample(worldTexture, fluenceSampler, in.uv);

  // world.a indicates emitter presence; world.rgb is linear emissive color.
  // Emissive surfaces contribute their own color plus receive indirect light.
  let emissive = world.rgb * world.a;
  let indirect = fluence.rgb;
  let hdr = emissive + indirect;

  let mapped = reinhardTonemap(hdr);
  let srgb = linearToSrgb(mapped);
  return vec4f(srgb, 1.0);
}
`;

const debugShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

struct DebugUBO {
  mode: u32,
  resultIdx: u32,
  tileOffsetX: f32,
  tileOffsetY: f32,
  tileSizeX: f32,
  tileSizeY: f32,
  texSizeX: f32,
  texSizeY: f32,
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

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var sdfTex: texture_2d<f32>;
@group(0) @binding(2) var worldTex: texture_2d<f32>;
@group(0) @binding(3) var cascadeTex0: texture_2d<f32>;
@group(0) @binding(4) var cascadeTex1: texture_2d<f32>;
@group(0) @binding(5) var fluenceTex: texture_2d<f32>;
@group(0) @binding(6) var jfaTex: texture_2d<f32>;
@group(0) @binding(7) var<uniform> debug: DebugUBO;

fn linearToSrgb(c: vec3f) -> vec3f {
  return pow(c, vec3f(1.0 / 2.2));
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let mode = debug.mode;

  // Mode 1: SDF distance field — grayscale, brighter = further from surface
  if (mode == 1u) {
    let dist = textureSample(sdfTex, samp, in.uv).r;
    let v = saturate(1.0 - dist / 128.0);
    return vec4f(v, v, v, 1.0);
  }

  // Mode 2: World texture — raw emissive RGBA as the shaders see it
  if (mode == 2u) {
    let w = textureSample(worldTex, samp, in.uv);
    return vec4f(linearToSrgb(w.rgb * w.a), 1.0);
  }

  // Mode 3: Raw cascade texture — full direction-first packed texture
  if (mode == 3u) {
    var s: vec4f;
    if (debug.resultIdx == 0u) {
      s = textureSample(cascadeTex0, samp, in.uv);
    } else {
      s = textureSample(cascadeTex1, samp, in.uv);
    }
    return vec4f(linearToSrgb(abs(s.rgb) * 3.0), 1.0);
  }

  // Mode 4: Single direction tile from cascade, stretched to fill canvas
  if (mode == 4u) {
    let tileUV = vec2f(
      (debug.tileOffsetX + in.uv.x * debug.tileSizeX) / debug.texSizeX,
      (debug.tileOffsetY + in.uv.y * debug.tileSizeY) / debug.texSizeY
    );
    var s: vec4f;
    if (debug.resultIdx == 0u) {
      s = textureSample(cascadeTex0, samp, tileUV);
    } else {
      s = textureSample(cascadeTex1, samp, tileUV);
    }
    return vec4f(linearToSrgb(abs(s.rgb) * 3.0), 1.0);
  }

  // Mode 5: Fluence texture — pre-tonemap indirect illumination
  if (mode == 5u) {
    let f = textureSample(fluenceTex, samp, in.uv);
    return vec4f(linearToSrgb(f.rgb), 1.0);
  }

  // Mode 6: JFA seed coordinates visualized as color
  if (mode == 6u) {
    let dims = vec2f(textureDimensions(jfaTex));
    let coord = vec2u(clamp(in.uv * dims, vec2f(0.0), dims - 1.0));
    let seed = textureLoad(jfaTex, coord, 0);
    if (seed.x < 0.0) {
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    return vec4f(fract(seed.xy / 256.0), 0.5, 1.0);
  }

  return vec4f(1.0, 0.0, 1.0, 1.0);
}
`;
