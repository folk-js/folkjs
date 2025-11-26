import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const PROBE_SPACING_POWER = 2; // 2^2 = 4 probe spacing at level 0
const RAY_COUNT_POWER = 3; // 2^3 = 8 rays per probe at level 0
const BRANCHING_FACTOR = 2; // 2^2 = 4 rays merge per level
const INTERVAL_RADIUS = 2; // Base interval radius
const MAX_CASCADE_LEVELS = 6;
const RESOLUTION_SCALE = 1; // Higher = sharper lines but more GPU work

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
  #mipmapPipeline!: GPUComputePipeline;
  #raymarchPipeline!: GPUComputePipeline;
  #fluencePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Buffers and textures
  #probeBuffer!: GPUBuffer;
  #uboBuffer!: GPUBuffer;
  #fluenceTexture!: GPUTexture;

  // Shape data for rendering to world texture
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  // Line segments: [x1, y1, x2, y2, r, g, b, thickness]
  #lines: number[][] = [];
  #lineBuffer?: GPUBuffer;
  #lineRenderPipeline!: GPURenderPipeline;

  // Samplers
  #linearSampler!: GPUSampler;

  // Animation state
  #animationFrame = 0;
  #startTime = 0;
  #mousePosition = { x: 0, y: 0 };
  #isRunning = false;

  // Computed values
  #maxLevel0Rays = 0;
  #numCascadeLevels = 0;

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    this.#initBuffers();
    await this.#initPipelines();

    window.addEventListener('resize', this.#handleResize);
    window.addEventListener('mousemove', this.#handleMouseMove);

    this.#startTime = performance.now();
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
    this.#cleanupResources();
  }

  // Public API for line drawing
  addLine(x1: number, y1: number, x2: number, y2: number, colorIndex: number, thickness = 8) {
    const color = FolkRadianceCascade.#colors[colorIndex] || FolkRadianceCascade.#colors[1];
    this.#lines.push([x1, y1, x2, y2, color[0], color[1], color[2], thickness]);
    this.#updateLineBuffer();
  }

  clearLines() {
    this.#lines = [];
    this.#updateLineBuffer();
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
    this.#updateLineBuffer();
  }

  #updateLineBuffer() {
    if (!this.#device || this.#lines.length === 0) return;

    // Each line becomes a quad (2 triangles, 6 vertices)
    // Vertex format: x, y, r, g, b, _ (6 floats, 24 bytes)
    const vertices: number[] = [];

    for (const line of this.#lines) {
      const [x1raw, y1raw, x2raw, y2raw, r, g, b, thicknessRaw] = line;
      // Scale CSS coordinates to internal resolution
      const x1 = x1raw * RESOLUTION_SCALE;
      const y1 = y1raw * RESOLUTION_SCALE;
      const x2 = x2raw * RESOLUTION_SCALE;
      const y2 = y2raw * RESOLUTION_SCALE;
      const thickness = thicknessRaw * RESOLUTION_SCALE;

      // Calculate perpendicular direction for line thickness
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const nx = (-dy / len) * (thickness / 2);
      const ny = (dx / len) * (thickness / 2);

      // Convert to clip space
      const toClipX = (x: number) => (x / this.#canvas.width) * 2 - 1;
      const toClipY = (y: number) => 1 - (y / this.#canvas.height) * 2;

      // Four corners of the line quad
      const p1x = toClipX(x1 - nx),
        p1y = toClipY(y1 - ny);
      const p2x = toClipX(x1 + nx),
        p2y = toClipY(y1 + ny);
      const p3x = toClipX(x2 - nx),
        p3y = toClipY(y2 - ny);
      const p4x = toClipX(x2 + nx),
        p4y = toClipY(y2 + ny);

      // Triangle 1
      vertices.push(p1x, p1y, r, g, b, 0);
      vertices.push(p2x, p2y, r, g, b, 0);
      vertices.push(p3x, p3y, r, g, b, 0);
      // Triangle 2
      vertices.push(p2x, p2y, r, g, b, 0);
      vertices.push(p4x, p4y, r, g, b, 0);
      vertices.push(p3x, p3y, r, g, b, 0);
    }

    if (vertices.length === 0) return;

    const data = new Float32Array(vertices);
    const requiredSize = data.byteLength;

    if (!this.#lineBuffer || this.#lineBuffer.size < requiredSize) {
      this.#lineBuffer?.destroy();
      this.#lineBuffer = this.#device.createBuffer({
        size: requiredSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    this.#device.queue.writeBuffer(this.#lineBuffer, 0, data);
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
    this.#canvas.width = (this.clientWidth || 800) * RESOLUTION_SCALE;
    this.#canvas.height = (this.clientHeight || 600) * RESOLUTION_SCALE;
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

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    this.#linearSampler = this.#device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
  }

  #initBuffers() {
    const { width, height } = this.#canvas;

    // Calculate probe counts at level 0
    const probeDiameter0 = Math.pow(2, PROBE_SPACING_POWER);
    const probeRayCount0 = Math.pow(2, RAY_COUNT_POWER);

    const cascadeWidth0 = Math.floor(width / probeDiameter0);
    const cascadeHeight0 = Math.floor(height / probeDiameter0);
    this.#maxLevel0Rays = cascadeWidth0 * cascadeHeight0 * probeRayCount0;

    this.#numCascadeLevels = Math.min(
      MAX_CASCADE_LEVELS,
      Math.floor(Math.log2(Math.min(width, height) / probeDiameter0)),
    );

    // Probe buffer for ping-pong
    const probeBufferSize = this.#maxLevel0Rays * 16 * 2;
    this.#probeBuffer = this.#device.createBuffer({
      label: 'ProbeBuffer',
      size: probeBufferSize,
      usage: GPUBufferUsage.STORAGE,
    });

    // UBO for per-level parameters
    this.#uboBuffer = this.#device.createBuffer({
      label: 'UBO',
      size: 256 * (MAX_CASCADE_LEVELS + 1),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // World texture with mipmaps
    const mipLevelCount = Math.floor(Math.log2(Math.max(width, height))) + 1;
    this.#worldTexture = this.#device.createTexture({
      label: 'WorldTexture',
      size: { width, height },
      format: 'rgba16float',
      mipLevelCount,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    });
    this.#worldTextureView = this.#worldTexture.createView();

    // Fluence texture
    this.#fluenceTexture = this.#device.createTexture({
      label: 'FluenceTexture',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  async #initPipelines() {
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
            arrayStride: 24, // 6 floats * 4 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' }, // position
              { shaderLocation: 1, offset: 8, format: 'float32x3' }, // color
              { shaderLocation: 2, offset: 20, format: 'float32' }, // isEdge
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

    // Mipmap pipeline
    const mipmapModule = device.createShaderModule({ code: mipmapShader });
    this.#mipmapPipeline = device.createComputePipeline({
      label: 'Mipmap-Pipeline',
      compute: { module: mipmapModule, entryPoint: 'main' },
      layout: 'auto',
    });

    // Raymarch pipeline
    const raymarchModule = device.createShaderModule({ code: raymarchShader });
    this.#raymarchPipeline = device.createComputePipeline({
      label: 'Raymarch-Pipeline',
      compute: { module: raymarchModule, entryPoint: 'main' },
      layout: 'auto',
    });

    // Fluence pipeline
    const fluenceModule = device.createShaderModule({ code: fluenceShader });
    this.#fluencePipeline = device.createComputePipeline({
      label: 'Fluence-Pipeline',
      compute: { module: fluenceModule, entryPoint: 'main' },
      layout: 'auto',
    });

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

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#updateShapeData();
  }

  // Color palette - normalized for similar perceived brightness
  static readonly #colors = [
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
      const x0 = (rect.left / (this.#canvas.width / RESOLUTION_SCALE)) * 2 - 1;
      const y0 = 1 - (rect.top / (this.#canvas.height / RESOLUTION_SCALE)) * 2;
      const x1 = (rect.right / (this.#canvas.width / RESOLUTION_SCALE)) * 2 - 1;
      const y1 = 1 - (rect.bottom / (this.#canvas.height / RESOLUTION_SCALE)) * 2;

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

      // Two triangles per quad
      // x, y, r, g, b, isEdge (1=edge glow, 0=solid)
      // Triangle 1
      vertices.push(x0, y0, r, g, b, 0);
      vertices.push(x1, y0, r, g, b, 0);
      vertices.push(x0, y1, r, g, b, 0);
      // Triangle 2
      vertices.push(x1, y0, r, g, b, 0);
      vertices.push(x1, y1, r, g, b, 0);
      vertices.push(x0, y1, r, g, b, 0);
    });

    this.#shapeCount = this.sourceRects.length;

    if (vertices.length === 0) {
      return;
    }

    const requiredSize = vertices.length * 4;

    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer?.destroy();
      this.#shapeDataBuffer = this.#device.createBuffer({
        size: requiredSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      });
    }

    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(vertices));
  }

  #startAnimationLoop() {
    const render = () => {
      if (!this.#isRunning) return;

      this.#runRadianceCascades();
      this.#animationFrame = requestAnimationFrame(render);
    };

    this.#animationFrame = requestAnimationFrame(render);
  }

  #runRadianceCascades() {
    const { width, height } = this.#canvas;
    const time = (performance.now() - this.#startTime) / 1000;

    const probeDiameter0 = Math.pow(2, PROBE_SPACING_POWER);
    const probeRayCount0 = Math.pow(2, RAY_COUNT_POWER);

    const encoder = this.#device.createCommandEncoder();

    // Step 1: Clear and render world texture
    {
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#worldTexture.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      renderPass.setPipeline(this.#worldRenderPipeline);

      // Draw shapes
      if (this.#shapeDataBuffer && this.#shapeCount > 0) {
        renderPass.setVertexBuffer(0, this.#shapeDataBuffer);
        renderPass.draw(this.#shapeCount * 6);
      }

      // Draw lines (uses same pipeline since vertex format matches)
      if (this.#lineBuffer && this.#lines.length > 0) {
        renderPass.setVertexBuffer(0, this.#lineBuffer);
        renderPass.draw(this.#lines.length * 6);
      }

      renderPass.end();
    }

    // Step 2: Generate mipmaps for world texture
    this.#generateMipmaps(encoder, this.#worldTexture);

    // Step 3: Raymarch each cascade level
    const levelCount = this.#numCascadeLevels;
    for (let level = levelCount; level >= 0; level--) {
      const probeDiameter = probeDiameter0 << level;
      const probeRadius = probeDiameter >> 1;
      const probeRayCount = probeRayCount0 << (BRANCHING_FACTOR * level);

      const cascadeWidth = Math.floor(width / probeDiameter);
      const cascadeHeight = Math.floor(height / probeDiameter);
      const totalRays = cascadeWidth * cascadeHeight * probeRayCount;

      const intervalRadius = Math.floor(INTERVAL_RADIUS);
      const intervalStart = level === 0 ? 0 : intervalRadius << (BRANCHING_FACTOR * (level - 1));
      const intervalEnd = intervalRadius << (BRANCHING_FACTOR * level);

      // Update UBO
      const uboData = new ArrayBuffer(64);
      const i32View = new Int32Array(uboData);
      const f32View = new Float32Array(uboData);

      i32View[0] = totalRays;
      i32View[1] = probeRadius;
      i32View[2] = probeRayCount;
      i32View[3] = level;
      i32View[4] = levelCount;
      i32View[5] = width;
      i32View[6] = height;
      i32View[7] = this.#maxLevel0Rays;
      i32View[8] = intervalStart;
      i32View[9] = intervalEnd;
      i32View[10] = BRANCHING_FACTOR;
      i32View[11] = level; // mipLevel for texture sampling
      f32View[12] = time;
      f32View[13] = this.#mousePosition.x;
      f32View[14] = this.#mousePosition.y;

      this.#device.queue.writeBuffer(this.#uboBuffer, level * 256, new Uint8Array(uboData));

      const bindGroup = this.#device.createBindGroup({
        layout: this.#raymarchPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.#probeBuffer } },
          { binding: 1, resource: { buffer: this.#uboBuffer, offset: level * 256, size: 64 } },
          { binding: 2, resource: this.#worldTextureView },
          { binding: 3, resource: this.#linearSampler },
        ],
      });

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#raymarchPipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(totalRays / 256), 1, 1);
      computePass.end();
    }

    // Step 4: Build fluence texture
    {
      const cascadeWidth = Math.floor(width / probeDiameter0);
      const cascadeHeight = Math.floor(height / probeDiameter0);

      const uboData = new Int32Array([probeRayCount0, cascadeWidth, cascadeHeight, width, height, probeDiameter0 >> 1]);

      const fluenceUBO = this.#device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Int32Array(fluenceUBO.getMappedRange()).set(uboData);
      fluenceUBO.unmap();

      const bindGroup = this.#device.createBindGroup({
        layout: this.#fluencePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#fluenceTexture.createView() },
          { binding: 1, resource: { buffer: this.#probeBuffer } },
          { binding: 2, resource: { buffer: fluenceUBO } },
        ],
      });

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#fluencePipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16), 1);
      computePass.end();

      this.#device.queue.onSubmittedWorkDone().then(() => fluenceUBO.destroy());
    }

    // Step 5: Final render
    {
      const bindGroup = this.#device.createBindGroup({
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.#fluenceTexture.createView() },
          { binding: 1, resource: this.#linearSampler },
          { binding: 2, resource: this.#worldTextureView },
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
      renderPass.setBindGroup(0, bindGroup);
      renderPass.setViewport(0, 0, width, height, 0, 1);
      renderPass.draw(4);
      renderPass.end();
    }

    this.#device.queue.submit([encoder.finish()]);
  }

  #generateMipmaps(encoder: GPUCommandEncoder, texture: GPUTexture) {
    const mipLevelCount = texture.mipLevelCount;

    for (let level = 1; level < mipLevelCount; level++) {
      const dstWidth = Math.max(1, texture.width >> level);
      const dstHeight = Math.max(1, texture.height >> level);

      if (dstWidth === 0 || dstHeight === 0) break;

      // Create views for source and destination mip levels
      const srcView = texture.createView({
        baseMipLevel: level - 1,
        mipLevelCount: 1,
      });
      const dstView = texture.createView({
        baseMipLevel: level,
        mipLevelCount: 1,
      });

      // Create UBO with dimensions
      const uboData = new Uint32Array([dstWidth, dstHeight]);
      const ubo = this.#device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Uint32Array(ubo.getMappedRange()).set(uboData);
      ubo.unmap();

      const bindGroup = this.#device.createBindGroup({
        layout: this.#mipmapPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: dstView },
          { binding: 2, resource: { buffer: ubo } },
        ],
      });

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#mipmapPipeline);
      computePass.setBindGroup(0, bindGroup);
      computePass.dispatchWorkgroups(Math.ceil(dstWidth / 8), Math.ceil(dstHeight / 8), 1);
      computePass.end();

      // Schedule cleanup
      this.#device.queue.onSubmittedWorkDone().then(() => ubo.destroy());
    }
  }

  #handleResize = async () => {
    const newWidth = (this.clientWidth || 800) * RESOLUTION_SCALE;
    const newHeight = (this.clientHeight || 600) * RESOLUTION_SCALE;

    // Skip if dimensions haven't actually changed
    if (this.#canvas.width === newWidth && this.#canvas.height === newHeight) {
      return;
    }

    this.#canvas.width = newWidth;
    this.#canvas.height = newHeight;

    // Wait for any in-flight GPU work to complete before destroying resources
    await this.#device.queue.onSubmittedWorkDone();

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    this.#cleanupResources();
    this.#initBuffers();
    this.#updateShapeData();
  };

  #handleMouseMove = (e: MouseEvent) => {
    const rect = this.getBoundingClientRect();
    // Convert to internal (scaled) coordinates
    this.#mousePosition.x = (e.clientX - rect.left) * RESOLUTION_SCALE;
    this.#mousePosition.y = (e.clientY - rect.top) * RESOLUTION_SCALE;
  };

  #cleanupResources() {
    this.#probeBuffer?.destroy();
    this.#uboBuffer?.destroy();
    this.#worldTexture?.destroy();
    this.#fluenceTexture?.destroy();
    this.#shapeDataBuffer?.destroy();
    this.#lineBuffer?.destroy();
    // Clear references to prevent use-after-destroy
    this.#shapeDataBuffer = undefined;
    this.#lineBuffer = undefined;
  }
}

// Mipmap generation shader - box filter downsampling
const mipmapShader = /*wgsl*/ `
struct UBO {
  width: u32,
  height: u32,
}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var dstTexture: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> ubo: UBO;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ubo.width || id.y >= ubo.height) {
    return;
  }
  
  // Sample 4 texels from source and average them
  let srcCoord = vec2i(id.xy) * 2;
  let s00 = textureLoad(srcTexture, srcCoord, 0);
  let s10 = textureLoad(srcTexture, srcCoord + vec2i(1, 0), 0);
  let s01 = textureLoad(srcTexture, srcCoord + vec2i(0, 1), 0);
  let s11 = textureLoad(srcTexture, srcCoord + vec2i(1, 1), 0);
  
  let avg = (s00 + s10 + s01 + s11) * 0.25;
  textureStore(dstTexture, id.xy, avg);
}
`;

// World render shader - renders shapes to world texture
const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) isEdge: f32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) isEdge: f32,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  out.isEdge = input.isEdge;
  return out;
}

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  // Shapes emit their color and are opaque
  return vec4f(in.color, 1.0);
}
`;

// Raymarch shader - traces rays sampling from world texture
const raymarchShader = /*wgsl*/ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = PI * 2.0;

struct UBO {
  totalRays: u32,
  probeRadius: i32,
  probeRayCount: i32,
  level: i32,
  levelCount: i32,
  width: i32,
  height: i32,
  maxLevel0Rays: i32,
  intervalStartRadius: i32,
  intervalEndRadius: i32,
  branchingFactor: u32,
  mipLevel: i32,
  time: f32,
  mouseX: f32,
  mouseY: f32,
}

@group(0) @binding(0) var<storage, read_write> probes: array<vec4f>;
@group(0) @binding(1) var<uniform> ubo: UBO;
@group(0) @binding(2) var worldTexture: texture_2d<f32>;
@group(0) @binding(3) var worldSampler: sampler;

fn sampleWorld(pos: vec2f, mipLevel: f32) -> vec4f {
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  let uv = pos / dims;
  
  // Check bounds
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }
  
  // Sample at the appropriate mip level for this cascade
  return textureSampleLevel(worldTexture, worldSampler, uv, mipLevel);
}

fn SampleUpperProbe(rawPos: vec2i, raysPerProbe: i32, bufferStartIndex: i32, cascadeWidth: i32, cascadeHeight: i32) -> vec4f {
  let pos = clamp(rawPos, vec2i(0), vec2i(cascadeWidth - 1, cascadeHeight - 1));
  let index = raysPerProbe * pos.x + pos.y * cascadeWidth * raysPerProbe;
  
  let rayCount = 1 << ubo.branchingFactor;
  var accColor = vec4f(0.0);
  for (var offset = 0; offset < rayCount; offset++) {
    accColor += probes[bufferStartIndex + index + offset];
  }
  return accColor / f32(rayCount);
}

fn SampleUpperProbes(lowerProbeCenter: vec2f, rayIndex: i32) -> vec4f {
  let UpperLevel = ubo.level + 1;
  
  if (UpperLevel >= ubo.levelCount) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  
  let UpperRaysPerProbe = ubo.probeRayCount << ubo.branchingFactor;
  let UpperLevelRayIndex = rayIndex << ubo.branchingFactor;
  let UpperLevelBufferOffset = ubo.maxLevel0Rays * (UpperLevel % 2);
  let UpperProbeDiameter = 2 * (ubo.probeRadius << 1);
  let UpperCascadeWidth = ubo.width / UpperProbeDiameter;
  let UpperCascadeHeight = ubo.height / UpperProbeDiameter;
  
  let index = lowerProbeCenter / f32(UpperProbeDiameter) - 0.5;
  let basePos = vec2i(floor(index));
  
  let bufferStartIndex = UpperLevelBufferOffset + UpperLevelRayIndex;
  let samples = array(
    SampleUpperProbe(basePos, UpperRaysPerProbe, bufferStartIndex, UpperCascadeWidth, UpperCascadeHeight),
    SampleUpperProbe(basePos + vec2i(1, 0), UpperRaysPerProbe, bufferStartIndex, UpperCascadeWidth, UpperCascadeHeight),
    SampleUpperProbe(basePos + vec2i(0, 1), UpperRaysPerProbe, bufferStartIndex, UpperCascadeWidth, UpperCascadeHeight),
    SampleUpperProbe(basePos + vec2i(1, 1), UpperRaysPerProbe, bufferStartIndex, UpperCascadeWidth, UpperCascadeHeight),
  );
  
  let factor = fract(index);
  let invFactor = 1.0 - factor;
  
  let r1 = samples[0] * invFactor.x + samples[1] * factor.x;
  let r2 = samples[2] * invFactor.x + samples[3] * factor.x;
  return r1 * invFactor.y + r2 * factor.y;
}

@compute @workgroup_size(256, 1, 1)
fn main(@builtin(global_invocation_id) GlobalInvocationID: vec3u) {
  let RayIndex = i32(GlobalInvocationID.x);
  if (RayIndex >= i32(ubo.totalRays)) {
    return;
  }

  let ProbeIndex = RayIndex / ubo.probeRayCount;
  let ProbeRayIndex = RayIndex % ubo.probeRayCount;
  
  let ProbeRadius = f32(ubo.probeRadius);
  let IntervalRadius = f32(ubo.intervalEndRadius);
  let LowerIntervalRadius = f32(ubo.intervalStartRadius);
  let ProbeDiameter = ProbeRadius * 2.0;
  let CascadeWidth = ubo.width / i32(ProbeDiameter);
  
  let col = ProbeIndex % CascadeWidth;
  let row = ProbeIndex / CascadeWidth;
  
  let RayAngle = TAU * (f32(ProbeRayIndex) + 0.5) / f32(ubo.probeRayCount);
  let RayDirection = vec2f(cos(RayAngle), sin(RayAngle));
  
  let RayOrigin = vec2f(
    f32(col) * ProbeDiameter + ProbeRadius,
    f32(row) * ProbeDiameter + ProbeRadius,
  );
  
  let OutputIndex = ubo.maxLevel0Rays * (ubo.level % 2) + RayIndex;
  
  // Raymarch through interval
  var acc = vec4f(0.0, 0.0, 0.0, 1.0);
  let mipLevel = f32(ubo.mipLevel);
  var t = 0.0;
  let stepSize = max(1.0, pow(2.0, mipLevel));
  
  // Add mouse light contribution
  let mousePos = vec2f(ubo.mouseX, ubo.mouseY);
  let mouseToOrigin = RayOrigin - mousePos;
  let mouseDist = length(mouseToOrigin);
  let mouseRadius = 20.0;
  if (mouseDist < mouseRadius) {
    let falloff = 1.0 - mouseDist / mouseRadius;
    let pulse = 0.9 + 0.1 * sin(ubo.time * 2.0);
    acc.r += falloff * falloff * pulse * 0.8;
    acc.g += falloff * falloff * pulse * 0.6;
    acc.b += falloff * falloff * pulse * 0.3;
  }
  
  while (true) {
    let pos = RayOrigin + RayDirection * (LowerIntervalRadius + t);
    
    if (t > IntervalRadius - LowerIntervalRadius) {
      break;
    }
    
    let sample = sampleWorld(pos, mipLevel);
    
    let transparency = 1.0 - sample.a;
    acc = vec4f(
      acc.rgb + acc.a * sample.rgb,
      acc.a * transparency
    );
    
    // Early termination if fully occluded
    if (acc.a < 0.01) {
      break;
    }
    
    t += stepSize;
  }
  
  let UpperResult = SampleUpperProbes(RayOrigin, ProbeRayIndex);
  
  probes[OutputIndex] = vec4f(
    acc.rgb + acc.a * UpperResult.rgb,
    acc.a * UpperResult.a
  );
}
`;

// Fluence shader with bilinear interpolation
const fluenceShader = /*wgsl*/ `
struct UBO {
  probeRayCount: i32,
  cascadeWidth: i32,
  cascadeHeight: i32,
  width: i32,
  height: i32,
  probeRadius: i32,
}

@group(0) @binding(0) var fluenceTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<storage, read_write> probes: array<vec4f>;
@group(0) @binding(2) var<uniform> ubo: UBO;

fn sampleProbe(probeX: i32, probeY: i32) -> vec4f {
  let cx = clamp(probeX, 0, ubo.cascadeWidth - 1);
  let cy = clamp(probeY, 0, ubo.cascadeHeight - 1);
  let startIndex = cx * ubo.probeRayCount + cy * ubo.probeRayCount * ubo.cascadeWidth;
  
  var acc = vec4f(0.0);
  for (var rayIndex = 0; rayIndex < ubo.probeRayCount; rayIndex++) {
    acc += probes[startIndex + rayIndex];
  }
  return acc / f32(ubo.probeRayCount);
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= ubo.width || i32(id.y) >= ubo.height) {
    return;
  }
  
  let pixelCenter = vec2f(id.xy) + 0.5;
  let probeDiameter = f32(ubo.probeRadius) * 2.0;
  
  let probeCoord = pixelCenter / probeDiameter - 0.5;
  let baseProbe = vec2i(floor(probeCoord));
  let frac = fract(probeCoord);
  
  let s00 = sampleProbe(baseProbe.x, baseProbe.y);
  let s10 = sampleProbe(baseProbe.x + 1, baseProbe.y);
  let s01 = sampleProbe(baseProbe.x, baseProbe.y + 1);
  let s11 = sampleProbe(baseProbe.x + 1, baseProbe.y + 1);
  
  let r0 = mix(s00, s10, frac.x);
  let r1 = mix(s01, s11, frac.x);
  let result = mix(r0, r1, frac.y);
  
  textureStore(fluenceTexture, id.xy, result);
}
`;

// Render shader - composites fluence with emissive surfaces
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

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  let fluence = textureSample(fluenceTexture, fluenceSampler, in.uv);
  let world = textureSample(worldTexture, fluenceSampler, in.uv);
  
  // If this pixel has emissive content, show it; otherwise show fluence
  // world.a = 1 means opaque emitter, world.rgb is emissive color
  if (world.a > 0.5) {
    // Blend emissive color with fluence for a nice glow effect
    return vec4f(world.rgb * 0.3 + fluence.rgb * 0.8, 1.0);
  }
  return vec4f(fluence.rgb * 0.8, 1.0);
}
`;
