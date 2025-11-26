import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const WORKGROUP_SIZE = 256;

// Configuration for radiance cascades
const PROBE_SPACING_POWER = 2; // 2^2 = 4 probe spacing at level 0 (larger = smoother)
const RAY_COUNT_POWER = 3; // 2^3 = 8 rays per probe at level 0
const BRANCHING_FACTOR = 2; // 2^2 = 4 rays merge per level
const INTERVAL_RADIUS = 4; // Base interval radius (smaller values = more iterations)
const MAX_CASCADE_LEVELS = 6;

/**
 * WebGPU-based Radiance Cascades for 2D global illumination.
 * Uses a buffer-based approach inspired by tmpvar's implementation.
 */
export class FolkRadianceCascade extends FolkBaseSet {
  static override tagName = 'folk-radiance-cascade';

  #canvas!: HTMLCanvasElement;
  #device!: GPUDevice;
  #context!: GPUCanvasContext;
  #presentationFormat!: GPUTextureFormat;

  // Pipelines
  #raymarchPipeline!: GPUComputePipeline;
  #fluencePipeline!: GPUComputePipeline;
  #renderPipeline!: GPURenderPipeline;

  // Bind group layouts
  #raymarchBindGroupLayout!: GPUBindGroupLayout;
  #fluenceBindGroupLayout!: GPUBindGroupLayout;
  #renderBindGroupLayout!: GPUBindGroupLayout;

  // Buffers and textures
  #probeBuffer!: GPUBuffer;
  #uboBuffer!: GPUBuffer;
  #fluenceTexture!: GPUTexture;

  // Shape data for density sampling
  #shapeDataBuffer?: GPUBuffer;
  #shapeCount = 0;

  // Animation state
  #animationFrame = 0;
  #startTime = 0;
  #mousePosition = { x: 0, y: 0 };
  #isRunning = false;

  // Computed values
  #maxLevel0Rays = 0;
  #numCascadeLevels = 0;
  #sampler!: GPUSampler;

  override async connectedCallback() {
    super.connectedCallback();

    await this.#initWebGPU();
    this.#initBuffers();
    await this.#initPipelines();

    window.addEventListener('resize', this.#handleResize);
    // Listen on window since both canvas and host have pointer-events: none
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

    this.#context.configure({
      device: this.#device,
      format: this.#presentationFormat,
      alphaMode: 'premultiplied',
    });

    this.#sampler = this.#device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'nearest',
    });
  }

  #initBuffers() {
    const { width, height } = this.#canvas;

    // Calculate probe counts at level 0 (smallest probes)
    const probeDiameter0 = Math.pow(2, PROBE_SPACING_POWER);
    const probeRayCount0 = Math.pow(2, RAY_COUNT_POWER);

    // Calculate the maximum number of rays at level 0 (which has the most probes)
    const cascadeWidth0 = Math.floor(width / probeDiameter0);
    const cascadeHeight0 = Math.floor(height / probeDiameter0);
    this.#maxLevel0Rays = cascadeWidth0 * cascadeHeight0 * probeRayCount0;

    // Calculate number of cascade levels
    this.#numCascadeLevels = Math.min(
      MAX_CASCADE_LEVELS,
      Math.floor(Math.log2(Math.min(width, height) / probeDiameter0)),
    );

    // Probe buffer: vec4f per ray, doubled for ping-pong
    // Each vec4f stores: rgb (radiance) + a (transmittance)
    const probeBufferSize = this.#maxLevel0Rays * 16 * 2; // 16 bytes per vec4f, x2 for ping-pong
    this.#probeBuffer = this.#device.createBuffer({
      label: 'ProbeBuffer',
      size: probeBufferSize,
      usage: GPUBufferUsage.STORAGE,
    });

    // UBO for per-level parameters (256-byte aligned per level)
    this.#uboBuffer = this.#device.createBuffer({
      label: 'UBO',
      size: 256 * (MAX_CASCADE_LEVELS + 1),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Fluence texture (final output before render)
    this.#fluenceTexture = this.#device.createTexture({
      label: 'FluenceTexture',
      size: { width, height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  async #initPipelines() {
    const device = this.#device;

    // Raymarch pipeline
    const raymarchModule = device.createShaderModule({ code: raymarchShader });
    this.#raymarchBindGroupLayout = device.createBindGroupLayout({
      label: 'Raymarch-BindGroupLayout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    this.#raymarchPipeline = device.createComputePipeline({
      label: 'Raymarch-Pipeline',
      compute: { module: raymarchModule, entryPoint: 'main' },
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.#raymarchBindGroupLayout] }),
    });

    // Fluence pipeline
    const fluenceModule = device.createShaderModule({ code: fluenceShader });
    this.#fluenceBindGroupLayout = device.createBindGroupLayout({
      label: 'Fluence-BindGroupLayout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { format: 'rgba8unorm', access: 'write-only' },
        },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.#fluencePipeline = device.createComputePipeline({
      label: 'Fluence-Pipeline',
      compute: { module: fluenceModule, entryPoint: 'ComputeMain' },
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.#fluenceBindGroupLayout] }),
    });

    // Render pipeline
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

    this.#renderBindGroupLayout = this.#renderPipeline.getBindGroupLayout(0);
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (!this.#device) return;
    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#updateShapeData();
  }

  #updateShapeData() {
    const shapeData: number[] = [];

    this.sourceRects.forEach((rect) => {
      shapeData.push(rect.left, rect.top, rect.right, rect.bottom);
    });

    this.#shapeCount = this.sourceRects.length;

    if (shapeData.length === 0) {
      if (!this.#shapeDataBuffer) {
        this.#shapeDataBuffer = this.#device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array([0, 0, 0, 0]));
      }
      return;
    }

    const requiredSize = shapeData.length * 4;

    if (!this.#shapeDataBuffer || this.#shapeDataBuffer.size < requiredSize) {
      this.#shapeDataBuffer?.destroy();
      this.#shapeDataBuffer = this.#device.createBuffer({
        size: requiredSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }

    this.#device.queue.writeBuffer(this.#shapeDataBuffer, 0, new Float32Array(shapeData));
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
    if (!this.#shapeDataBuffer) {
      this.#updateShapeData();
    }

    const { width, height } = this.#canvas;
    const time = (performance.now() - this.#startTime) / 1000;

    const probeDiameter0 = Math.pow(2, PROBE_SPACING_POWER);
    const probeRayCount0 = Math.pow(2, RAY_COUNT_POWER);

    const encoder = this.#device.createCommandEncoder();

    // Create raymarch bind group (shared across levels)
    const raymarchBindGroup = this.#device.createBindGroup({
      layout: this.#raymarchBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.#probeBuffer } },
        { binding: 1, resource: { buffer: this.#uboBuffer, size: 256 } },
        { binding: 2, resource: { buffer: this.#shapeDataBuffer! } },
      ],
    });

    // Process each cascade level from highest to lowest
    // Match reference: loop from levelCount to 0 inclusive
    const levelCount = this.#numCascadeLevels;
    for (let level = levelCount; level >= 0; level--) {
      const probeDiameter = probeDiameter0 << level;
      const probeRadius = probeDiameter >> 1;
      const probeRayCount = probeRayCount0 << (BRANCHING_FACTOR * level);

      const cascadeWidth = Math.floor(width / probeDiameter);
      const cascadeHeight = Math.floor(height / probeDiameter);
      const totalRays = cascadeWidth * cascadeHeight * probeRayCount;

      // Interval calculation - use integer shifts like reference (JS << truncates to int32)
      const intervalRadius = Math.floor(INTERVAL_RADIUS);
      const intervalStart = level === 0 ? 0 : intervalRadius << (BRANCHING_FACTOR * (level - 1));
      const intervalEnd = intervalRadius << (BRANCHING_FACTOR * level);

      // Update UBO for this level - use Int32Array like reference
      const uboData = new Int32Array(16);
      uboData[0] = totalRays;
      uboData[1] = probeRadius;
      uboData[2] = probeRayCount;
      uboData[3] = level;
      uboData[4] = levelCount;
      uboData[5] = width;
      uboData[6] = height;
      uboData[7] = this.#maxLevel0Rays;
      uboData[8] = intervalStart;
      uboData[9] = intervalEnd;
      uboData[10] = BRANCHING_FACTOR;
      uboData[11] = this.#shapeCount;
      // Time and mouse as float view
      const f32 = new Float32Array(uboData.buffer);
      f32[12] = time;
      f32[13] = this.#mousePosition.x;
      f32[14] = this.#mousePosition.y;

      this.#device.queue.writeBuffer(this.#uboBuffer, level * 256, new Uint8Array(uboData.buffer));

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#raymarchPipeline);
      computePass.setBindGroup(0, raymarchBindGroup, [level * 256]);

      const workgroups = Math.ceil(totalRays / WORKGROUP_SIZE);
      computePass.dispatchWorkgroups(workgroups, 1, 1);
      computePass.end();
    }

    // Build fluence texture from level 0 probes
    {
      const probeDiameter = probeDiameter0;
      const cascadeWidth = Math.floor(width / probeDiameter);
      const cascadeHeight = Math.floor(height / probeDiameter);

      // UBO layout: probeRayCount, cascadeWidth, cascadeHeight, width, height, probeRadius
      const uboData = new Int32Array([
        probeRayCount0,
        cascadeWidth,
        cascadeHeight,
        width,
        height,
        probeDiameter >> 1, // probeRadius
      ]);

      const fluenceUBO = this.#device.createBuffer({
        size: 32, // 6 i32 values = 24 bytes, aligned to 32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Int32Array(fluenceUBO.getMappedRange()).set(uboData);
      fluenceUBO.unmap();

      const bindGroup = this.#device.createBindGroup({
        layout: this.#fluenceBindGroupLayout,
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

      // Schedule buffer destruction after submission
      this.#device.queue.onSubmittedWorkDone().then(() => fluenceUBO.destroy());
    }

    // Render to screen
    const renderBindGroup = this.#device.createBindGroup({
      layout: this.#renderBindGroupLayout,
      entries: [
        { binding: 0, resource: this.#fluenceTexture.createView() },
        { binding: 1, resource: this.#sampler },
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
    renderPass.setViewport(0, 0, width, height, 0, 1);
    renderPass.draw(4);
    renderPass.end();

    this.#device.queue.submit([encoder.finish()]);
  }

  #handleResize = () => {
    this.#canvas.width = this.clientWidth || 800;
    this.#canvas.height = this.clientHeight || 600;

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
    this.#mousePosition.x = (e.clientX - rect.left) * (this.#canvas.width / rect.width);
    this.#mousePosition.y = (e.clientY - rect.top) * (this.#canvas.height / rect.height);
  };

  #cleanupResources() {
    this.#probeBuffer?.destroy();
    this.#uboBuffer?.destroy();
    this.#fluenceTexture?.destroy();
    this.#shapeDataBuffer?.destroy();
  }
}

// Raymarch shader - traces rays for each probe (matching reference types)
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
  shapeCount: u32,
  time: f32,
  mouseX: f32,
  mouseY: f32,
}

struct Shape {
  minX: f32,
  minY: f32,
  maxX: f32,
  maxY: f32,
}

@group(0) @binding(0) var<storage, read_write> probes: array<vec4f>;
@group(0) @binding(1) var<uniform> ubo: UBO;
@group(0) @binding(2) var<storage, read> shapes: array<Shape>;

// Sample scene at position - returns vec4(emissive RGB, opacity)
fn sampleScene(pos: vec2f) -> vec4f {
  var emissive = vec3f(0.0);
  var opacity = 0.0;
  
  // Check shapes for occlusion first
  for (var i = 0u; i < ubo.shapeCount; i++) {
    let shape = shapes[i];
    if (pos.x >= shape.minX && pos.x <= shape.maxX &&
        pos.y >= shape.minY && pos.y <= shape.maxY) {
      // Inside shape = fully opaque blocker
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
  }
  
  // Only check light sources if not inside a blocker
  // Mouse light - bright emitter that follows cursor
  let mousePos = vec2f(ubo.mouseX, ubo.mouseY);
  let distMouse = length(pos - mousePos);
  let mouseRadius = 20.0;
  if (distMouse < mouseRadius) {
    let pulse = 0.7 + 0.3 * sin(ubo.time * 2.0);
    let falloff = 1.0 - distMouse / mouseRadius;
    // Bright warm point light
    emissive = vec3f(3.0 * pulse, 2.0 * pulse, 0.8) * falloff * falloff;
  }
  
  // Shape glow - thin rings around shapes
  for (var i = 0u; i < ubo.shapeCount; i++) {
    let shape = shapes[i];
    let center = vec2f((shape.minX + shape.maxX) * 0.5, (shape.minY + shape.maxY) * 0.5);
    let halfSize = vec2f((shape.maxX - shape.minX) * 0.5, (shape.maxY - shape.minY) * 0.5);
    
    // SDF to box
    let d = abs(pos - center) - halfSize;
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
    
    // Very thin emissive ring at shape edge
    let glowWidth = 3.0;
    if (dist > 0.0 && dist < glowWidth) {
      let hue = f32(i) * 0.618;
      let r = 0.5 + 0.5 * sin(hue * TAU);
      let g = 0.5 + 0.5 * sin((hue + 0.333) * TAU);
      let b = 0.5 + 0.5 * sin((hue + 0.666) * TAU);
      let falloff = 1.0 - dist / glowWidth;
      emissive += vec3f(r, g, b) * falloff * 0.8;
    }
  }
  
  return vec4f(emissive, opacity);
}

fn SampleUpperProbe(rawPos: vec2i, raysPerProbe: i32, bufferStartIndex: i32, cascadeWidth: i32, cascadeHeight: i32) -> vec4f {
  // Clamp to valid probe positions for non-square canvases
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
    // Sky/environment - return transparent (no ambient)
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
  
  // Bilinear interpolation
  let r1 = samples[0] * invFactor.x + samples[1] * factor.x;
  let r2 = samples[2] * invFactor.x + samples[3] * factor.x;
  return r1 * invFactor.y + r2 * factor.y;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, 1, 1)
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
  
  // Ray angle with half-pixel offset
  let RayAngle = TAU * (f32(ProbeRayIndex) + 0.5) / f32(ubo.probeRayCount);
  let RayDirection = vec2f(cos(RayAngle), sin(RayAngle));
  
  // Probe center position
  let RayOrigin = vec2f(
    f32(col) * ProbeDiameter + ProbeRadius,
    f32(row) * ProbeDiameter + ProbeRadius,
  );
  
  let OutputIndex = ubo.maxLevel0Rays * (ubo.level % 2) + RayIndex;
  
  // Raymarch through interval (fixed size stepping like reference)
  var acc = vec4f(0.0, 0.0, 0.0, 1.0);
  let dims = vec2f(f32(ubo.width), f32(ubo.height));
  var t = 0.0;
  let stepSize = 1.0;
  
  while (true) {
    let pos = RayOrigin + RayDirection * (LowerIntervalRadius + t);
    
    // Distance check
    if (distance(pos, RayOrigin) > IntervalRadius) {
      break;
    }
    
    // Bounds check
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= dims.x || pos.y >= dims.y) {
      break;
    }
    
    // Sample scene
    let sample = sampleScene(pos);
    
    // Accumulate
    let transparency = 1.0 - sample.a;
    acc = vec4f(
      acc.rgb + acc.a * sample.rgb,
      acc.a * transparency
    );
    
    t += stepSize;
  }
  
  // Sample upper cascade and merge
  let UpperResult = SampleUpperProbes(RayOrigin, ProbeRayIndex);
  
  probes[OutputIndex] = vec4f(
    acc.rgb + acc.a * UpperResult.rgb,
    acc.a * UpperResult.a
  );
}
`;

// Fluence shader - averages all rays per probe for final display with bilinear interpolation
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
fn ComputeMain(@builtin(global_invocation_id) id: vec3u) {
  if (i32(id.x) >= ubo.width || i32(id.y) >= ubo.height) {
    return;
  }
  
  let pixelCenter = vec2f(id.xy) + 0.5;
  let probeDiameter = f32(ubo.probeRadius) * 2.0;
  
  // Calculate probe coordinates (in floating point for interpolation)
  let probeCoord = pixelCenter / probeDiameter - 0.5;
  let baseProbe = vec2i(floor(probeCoord));
  let frac = fract(probeCoord);
  
  // Sample 4 neighboring probes
  let s00 = sampleProbe(baseProbe.x, baseProbe.y);
  let s10 = sampleProbe(baseProbe.x + 1, baseProbe.y);
  let s01 = sampleProbe(baseProbe.x, baseProbe.y + 1);
  let s11 = sampleProbe(baseProbe.x + 1, baseProbe.y + 1);
  
  // Bilinear interpolation
  let r0 = mix(s00, s10, frac.x);
  let r1 = mix(s01, s11, frac.x);
  let result = mix(r0, r1, frac.y);
  
  textureStore(fluenceTexture, id.xy, result);
}
`;

// Render shader - displays final texture with proper sampling
const renderShader = /*wgsl*/ `
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertex_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
  // Full-screen triangle strip
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

@fragment
fn fragment_main(in: VertexOutput) -> @location(0) vec4f {
  return textureSample(fluenceTexture, fluenceSampler, in.uv);
}
`;
