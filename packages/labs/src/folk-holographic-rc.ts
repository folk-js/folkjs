import { property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

type Line = [x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, thickness: number];

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

// -- WGSL shaders --

const worldRenderShader = /*wgsl*/ `
struct VertexInput {
  @location(0) position: vec2f,
  @location(1) color: vec3f,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}
fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

@vertex fn vertex_main(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(input.position, 0.0, 1.0);
  out.color = input.color;
  return out;
}
@fragment fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  return vec4f(srgbToLinear(in.color), 1.0);
}
`;

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

fn srgbToLinear(c: vec3f) -> vec3f { return pow(c, vec3f(2.2)); }

@vertex fn vertex_main(
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
  let clip = vec2f(pixel.x / canvas.width * 2.0 - 1.0, 1.0 - pixel.y / canvas.height * 2.0);
  var out: VertexOutput;
  out.position = vec4f(clip, 0.0, 1.0);
  out.color = color;
  out.p1 = p1;
  out.p2 = p2;
  out.radius = r;
  return out;
}
@fragment fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
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

const testComputeShader = /*wgsl*/ `
@group(0) @binding(0) var worldTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dims = textureDimensions(worldTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let world = textureLoad(worldTex, gid.xy, 0);

  // Pass through the world texture so we can see shapes
  textureStore(outputTex, gid.xy, world);
}
`;

const blitShader = /*wgsl*/ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let pos = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  return vec4f(pos[i], 0, 1);
}

@group(0) @binding(0) var outputTex: texture_2d<f32>;

@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let col = textureLoad(outputTex, vec2u(pos.xy), 0);
  return vec4f(col.rgb, 1.0);
}
`;

export class FolkHolographicRC extends FolkBaseSet {
  static override tagName = 'folk-holographic-rc';

  @property({ type: Number, reflect: true }) exposure = 2.0;

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // World texture — scene geometry (emissive RGB, opacity)
  #worldTexture!: GPUTexture;
  #worldTextureView!: GPUTextureView;
  #worldRenderPipeline!: GPURenderPipeline;

  // Shape data for rendering to world texture
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  // Line drawing
  #lines: Line[] = [];
  #lineInstanceBuffer?: GPUBuffer;
  #lineInstanceCapacity = 0;
  #lineCount = 0;
  #lineBufferDirty = false;
  #lineRenderPipeline!: GPURenderPipeline;
  #lineUBO?: GPUBuffer;
  #lineBindGroup?: GPUBindGroup;

  // Mouse light
  #mousePosition = { x: 0, y: 0 };
  #mouseLightColor = { r: 0.8, g: 0.6, b: 0.3 };
  #mouseLightRadius = 10;
  #mouseLightBuffer?: GPUBuffer;
  #mouseLightVertexCount = 0;

  // Output texture
  #outputTexture!: GPUTexture;
  #outputTextureView!: GPUTextureView;

  // Test compute pass
  #testComputePipeline!: GPUComputePipeline;
  #testComputeBindGroup!: GPUBindGroup;

  // Final blit
  #renderPipeline!: GPURenderPipeline;
  #renderBindGroup!: GPUBindGroup;

  #animationFrame = 0;
  #isRunning = false;
  #resizing = false;

  // Color palette (shared with demo HTML)
  static readonly #colors: [number, number, number][] = [
    [0, 0, 0],
    [0.05, 0.05, 0.05],
    [1, 0.25, 0.25],
    [1, 0.5, 0.2],
    [0.75, 0.75, 0.2],
    [0.25, 0.8, 0.35],
    [0.25, 0.75, 0.75],
    [0.3, 0.4, 1],
    [0.65, 0.3, 1],
    [0.8, 0.8, 0.8],
  ];

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    this.#initResources();
    this.#initPipelines();
    this.#initBindGroups();

    window.addEventListener('resize', this.#handleResize);
    window.addEventListener('mousemove', this.#handleMouseMove);
    this.#isRunning = true;
    this.#startAnimationLoop();

    this.requestUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#isRunning = false;
    if (this.#animationFrame) cancelAnimationFrame(this.#animationFrame);
    window.removeEventListener('resize', this.#handleResize);
    window.removeEventListener('mousemove', this.#handleMouseMove);
    this.#destroyResources();
  }

  // -- Public API (mirrors FolkRadianceCascade for 1:1 demo parity) --

  addLine(x1: number, y1: number, x2: number, y2: number, colorIndex: number, thickness = 20) {
    const [r, g, b] = FolkHolographicRC.#colors[colorIndex] ?? FolkHolographicRC.#colors[1];
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
    this.#lines = this.#lines.filter((line) => {
      const [x1, y1, x2, y2] = line;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(x - x1, y - y1) > radius;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const nearX = x1 + t * dx;
      const nearY = y1 + t * dy;
      return Math.hypot(x - nearX, y - nearY) > radius;
    });
    this.#lineBufferDirty = true;
  }

  // -- Reactive update: rebuild shape data when sources change --

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);
    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;
    this.#updateShapeData();
  }

  // -- WebGPU init --

  async #initWebGPU() {
    if (!navigator.gpu) throw new Error('WebGPU is not supported in this browser.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('Failed to get GPU adapter.');
    this.#device = await adapter.requestDevice();

    this.#canvas = document.createElement('canvas');
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;
    this.#canvas.style.position = 'absolute';
    this.#canvas.style.inset = '0';
    this.#canvas.style.width = '100%';
    this.#canvas.style.height = '100%';
    this.#canvas.style.pointerEvents = 'none';
    this.renderRoot.prepend(this.#canvas);

    const context = this.#canvas.getContext('webgpu');
    if (!context) throw new Error('Failed to get WebGPU context.');
    this.#context = context;
    this.#presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.#configureContext();
  }

  #configureContext() {
    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });
  }

  #initResources() {
    const { width, height } = this.#canvas;

    this.#worldTexture = this.#device.createTexture({
      label: 'HRC-WorldTexture',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#worldTextureView = this.#worldTexture.createView();

    this.#outputTexture = this.#device.createTexture({
      label: 'HRC-Output',
      size: { width, height },
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.#outputTextureView = this.#outputTexture.createView();
  }

  #initPipelines() {
    const device = this.#device;

    // World render pipeline — shapes as colored quads
    const worldModule = device.createShaderModule({ code: worldRenderShader });
    this.#worldRenderPipeline = device.createRenderPipeline({
      label: 'HRC-WorldRender',
      layout: 'auto',
      vertex: {
        module: worldModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 20,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x3' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: worldModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' as GPUTextureFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Line render pipeline — instanced capsule SDF quads
    const lineModule = device.createShaderModule({ code: lineRenderShader });
    this.#lineRenderPipeline = device.createRenderPipeline({
      label: 'HRC-LineRender',
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vertex_main',
        buffers: [
          {
            arrayStride: 32,
            stepMode: 'instance' as GPUVertexStepMode,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 1, offset: 8, format: 'float32x2' as GPUVertexFormat },
              { shaderLocation: 2, offset: 16, format: 'float32x3' as GPUVertexFormat },
              { shaderLocation: 3, offset: 28, format: 'float32' as GPUVertexFormat },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fragment_main',
        targets: [{ format: 'rgba16float' as GPUTextureFormat }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Test compute pipeline — passes world texture through to output
    this.#testComputePipeline = device.createComputePipeline({
      label: 'HRC-TestCompute',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: testComputeShader }),
        entryPoint: 'main',
      },
    });

    // Final blit pipeline
    const blitModule = device.createShaderModule({ code: blitShader });
    this.#renderPipeline = device.createRenderPipeline({
      label: 'HRC-Blit',
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs',
        targets: [{ format: this.#presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });
  }

  #initBindGroups() {
    const { width, height } = this.#canvas;

    // Line render UBO
    this.#lineUBO?.destroy();
    this.#lineUBO = this.#device.createBuffer({
      label: 'HRC-LineUBO',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.#device.queue.writeBuffer(this.#lineUBO, 0, new Float32Array([width, height]));
    this.#lineBindGroup = this.#device.createBindGroup({
      layout: this.#lineRenderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.#lineUBO } }],
    });

    // Test compute bind group
    this.#testComputeBindGroup = this.#device.createBindGroup({
      layout: this.#testComputePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.#worldTextureView },
        { binding: 1, resource: this.#outputTextureView },
      ],
    });

    // Blit bind group
    this.#renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: this.#outputTextureView }],
    });
  }

  #destroyResources() {
    this.#worldTexture?.destroy();
    this.#outputTexture?.destroy();
  }

  // -- Shape & line data --

  #updateShapeData() {
    const vertices: number[] = [];
    const elements = Array.from(this.sourceElements);

    this.sourceRects.forEach((rect, index) => {
      const x0 = (rect.left / this.#canvas.width) * 2 - 1;
      const y0 = 1 - (rect.top / this.#canvas.height) * 2;
      const x1 = (rect.right / this.#canvas.width) * 2 - 1;
      const y1 = 1 - (rect.bottom / this.#canvas.height) * 2;

      const element = elements[index];
      const colorAttr = element?.getAttribute('data-color');
      let r: number, g: number, b: number;

      if (colorAttr !== null) {
        const colorIndex = parseInt(colorAttr) || 0;
        const color = FolkHolographicRC.#colors[colorIndex] || FolkHolographicRC.#colors[0];
        [r, g, b] = color;
      } else {
        const hue = index * 0.618;
        r = 0.5 + 0.5 * Math.sin(hue * Math.PI * 2);
        g = 0.5 + 0.5 * Math.sin((hue + 0.333) * Math.PI * 2);
        b = 0.5 + 0.5 * Math.sin((hue + 0.666) * Math.PI * 2);
      }

      vertices.push(x0, y0, r, g, b);
      vertices.push(x1, y0, r, g, b);
      vertices.push(x0, y1, r, g, b);
      vertices.push(x1, y0, r, g, b);
      vertices.push(x1, y1, r, g, b);
      vertices.push(x0, y1, r, g, b);
    });

    this.#shapeCount = this.sourceRects.length;
    if (vertices.length === 0) return;
    this.#shapeDataBuffer = uploadVertexData(this.#device, this.#shapeDataBuffer, new Float32Array(vertices));
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

  // -- Render loop --

  #startAnimationLoop() {
    const render = () => {
      if (!this.#isRunning) return;
      this.#renderFrame();
      this.#animationFrame = requestAnimationFrame(render);
    };
    this.#animationFrame = requestAnimationFrame(render);
  }

  #renderFrame() {
    if (this.#lineBufferDirty) {
      this.#lineBufferDirty = false;
      this.#updateLineBuffer();
    }
    this.#updateMouseLightBuffer();

    const { width, height } = this.#canvas;
    const encoder = this.#device.createCommandEncoder();

    // Step 1: Render world texture (shapes + lines + mouse light)
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#worldTextureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });

      pass.setPipeline(this.#worldRenderPipeline);

      if (this.#shapeDataBuffer && this.#shapeCount > 0) {
        pass.setVertexBuffer(0, this.#shapeDataBuffer);
        pass.draw(this.#shapeCount * 6);
      }

      if (this.#lineInstanceBuffer && this.#lineCount > 0) {
        pass.setPipeline(this.#lineRenderPipeline);
        pass.setBindGroup(0, this.#lineBindGroup!);
        pass.setVertexBuffer(0, this.#lineInstanceBuffer);
        pass.draw(6, this.#lineCount);
        pass.setPipeline(this.#worldRenderPipeline);
      }

      if (this.#mouseLightBuffer && this.#mouseLightVertexCount > 0) {
        pass.setVertexBuffer(0, this.#mouseLightBuffer);
        pass.draw(this.#mouseLightVertexCount);
      }

      pass.end();
    }

    // Step 2: Compute — currently just passes world texture through.
    // This is where holographic RC passes will go.
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.#testComputePipeline);
      pass.setBindGroup(0, this.#testComputeBindGroup);
      pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
      pass.end();
    }

    // Step 3: Blit output to screen
    {
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      pass.setPipeline(this.#renderPipeline);
      pass.setBindGroup(0, this.#renderBindGroup);
      pass.setViewport(0, 0, width, height, 0, 1);
      pass.draw(4);
      pass.end();
    }

    this.#device.queue.submit([encoder.finish()]);
  }

  // -- Event handlers --

  #handleResize = async () => {
    if (this.#resizing) return;
    this.#resizing = true;
    this.#isRunning = false;
    cancelAnimationFrame(this.#animationFrame);

    await this.#device.queue.onSubmittedWorkDone();

    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;

    this.#configureContext();
    this.#destroyResources();
    this.#initResources();
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
}
