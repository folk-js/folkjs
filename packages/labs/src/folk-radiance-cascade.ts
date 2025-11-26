import { type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { FolkBaseSet } from './folk-base-set';

const WORKGROUP_SIZE = 256;

// Configuration for radiance cascades - matching the reference demo settings
const PROBE_SPACING_POWER = 1; // 2^1 = 2 probe spacing at level 0
const RAY_COUNT_POWER = 2; // 2^2 = 4 rays per probe at level 0
const BRANCHING_FACTOR = 2; // 2^2 = 4 rays merge per level
const INTERVAL_RADIUS = 6.76; // Base interval radius
const MAX_CASCADE_LEVELS = 5;

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
    this.#canvas.addEventListener('mousemove', this.#handleMouseMove);

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
    this.#canvas.removeEventListener('mousemove', this.#handleMouseMove);
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
    this.#numCascadeLevels = Math.min(MAX_CASCADE_LEVELS, Math.floor(Math.log2(Math.min(width, height) / probeDiameter0)));

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
        { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba8unorm', access: 'write-only' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });

    this.#fluencePipeline = device.createComputePipeline({
      label: 'Fluence-Pipeline',
      compute: { module: fluenceModule, entryPoint: 'main' },
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
    for (let level = this.#numCascadeLevels - 1; level >= 0; level--) {
      const probeDiameter = probeDiameter0 << level;
      const probeRadius = probeDiameter >> 1;
      const probeRayCount = probeRayCount0 << (BRANCHING_FACTOR * level);

      const cascadeWidth = Math.floor(width / probeDiameter);
      const cascadeHeight = Math.floor(height / probeDiameter);
      const totalRays = cascadeWidth * cascadeHeight * probeRayCount;

      // Interval calculation - matching reference implementation
      const intervalStart = level === 0 ? 0 : INTERVAL_RADIUS * Math.pow(2, BRANCHING_FACTOR * (level - 1));
      const intervalEnd = INTERVAL_RADIUS * Math.pow(2, BRANCHING_FACTOR * level);

      // Update UBO for this level
      const uboData = new ArrayBuffer(64);
      const u32 = new Uint32Array(uboData);
      const f32 = new Float32Array(uboData);

      u32[0] = totalRays;
      u32[1] = probeRadius;
      u32[2] = probeRayCount;
      u32[3] = level;
      u32[4] = this.#numCascadeLevels;
      u32[5] = width;
      u32[6] = height;
      u32[7] = this.#maxLevel0Rays;
      f32[8] = intervalStart;
      f32[9] = intervalEnd;
      u32[10] = BRANCHING_FACTOR;
      u32[11] = this.#shapeCount;
      f32[12] = time;
      f32[13] = this.#mousePosition.x;
      f32[14] = this.#mousePosition.y;

      this.#device.queue.writeBuffer(this.#uboBuffer, level * 256, new Uint8Array(uboData));

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(this.#raymarchPipeline);
      computePass.setBindGroup(0, raymarchBindGroup, [level * 256]);

      const workgroups = Math.ceil(totalRays / WORKGROUP_SIZE);
      computePass.dispatchWorkgroups(workgroups, 1, 1);
      computePass.end();
    }

    // Build fluence texture from level 0 probes
    {
      const cascadeWidth = Math.floor(width / probeDiameter0);

      const uboData = new Uint32Array([
        probeRayCount0,
        cascadeWidth,
        width,
        height,
        probeDiameter0 >> 1, // probeRadius
      ]);

      const fluenceUBO = this.#device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Uint32Array(fluenceUBO.getMappedRange()).set(uboData);
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
    const rect = this.#canvas.getBoundingClientRect();
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

// Raymarch shader - traces rays for each probe
const raymarchShader = /*wgsl*/ `
const PI: f32 = 3.141592653589793;
const TAU: f32 = PI * 2.0;
const BRANCHING_FACTOR: u32 = ${BRANCHING_FACTOR}u;

struct UBO {
  totalRays: u32,
  probeRadius: u32,
  probeRayCount: u32,
  level: u32,
  levelCount: u32,
  width: u32,
  height: u32,
  maxLevel0Rays: u32,
  intervalStart: f32,
  intervalEnd: f32,
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
  
  // Check shapes for occlusion
  for (var i = 0u; i < ubo.shapeCount; i++) {
    let shape = shapes[i];
    if (pos.x >= shape.minX && pos.x <= shape.maxX &&
        pos.y >= shape.minY && pos.y <= shape.maxY) {
      // Inside shape = fully opaque, no emission
      return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    
    // Check for glow ring around shape
    let center = vec2f((shape.minX + shape.maxX) * 0.5, (shape.minY + shape.maxY) * 0.5);
    let halfSize = vec2f((shape.maxX - shape.minX) * 0.5, (shape.maxY - shape.minY) * 0.5);
    
    // Signed distance to box edge
    let d = abs(pos - center) - halfSize;
    let dist = length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0);
    
    // Thin emissive ring just outside shape
    let glowStart = 1.0;
    let glowEnd = 8.0;
    if (dist > glowStart && dist < glowEnd) {
      let hue = f32(i) * 0.618;
      let r = 0.5 + 0.5 * sin(hue * TAU);
      let g = 0.5 + 0.5 * sin((hue + 0.333) * TAU);
      let b = 0.5 + 0.5 * sin((hue + 0.666) * TAU);
      let falloff = 1.0 - (dist - glowStart) / (glowEnd - glowStart);
      emissive += vec3f(r, g, b) * falloff * falloff * 0.5;
    }
  }
  
  // Mouse light - point-like emitter
  let mousePos = vec2f(ubo.mouseX, ubo.mouseY);
  let distMouse = length(pos - mousePos);
  let mouseRadius = 15.0;
  if (distMouse < mouseRadius) {
    let pulse = 0.5 + 0.5 * sin(ubo.time * 3.0);
    let falloff = 1.0 - distMouse / mouseRadius;
    emissive += vec3f(1.0 + pulse * 0.5, 0.6, 0.2) * falloff * falloff * 2.0;
  }
  
  return vec4f(emissive, opacity);
}

fn sampleUpperProbe(rawPos: vec2i, raysPerProbe: i32, bufferStartIndex: i32, cascadeWidth: i32) -> vec4f {
  // Clamp to valid probe positions
  let pos = clamp(rawPos, vec2i(0), vec2i(cascadeWidth - 1));
  let index = raysPerProbe * pos.x + pos.y * cascadeWidth * raysPerProbe;
  
  let rayCount = 1 << BRANCHING_FACTOR;
  var acc = vec4f(0.0);
  for (var offset = 0; offset < rayCount; offset++) {
    acc += probes[bufferStartIndex + index + offset];
  }
  return acc / f32(rayCount);
}

fn sampleUpperProbes(probeCenter: vec2f, rayIndex: i32) -> vec4f {
  let upperLevel = ubo.level + 1u;
  
  if (upperLevel >= ubo.levelCount) {
    // Sky/environment - return transparent (no ambient)
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  
  let upperRaysPerProbe = i32(ubo.probeRayCount << BRANCHING_FACTOR);
  let upperRayIndex = rayIndex << BRANCHING_FACTOR;
  let upperBufferOffset = i32(ubo.maxLevel0Rays * (upperLevel % 2u));
  let upperProbeDiameter = i32(ubo.probeRadius) * 4;
  let upperCascadeWidth = i32(ubo.width) / upperProbeDiameter;
  
  let idx = probeCenter / f32(upperProbeDiameter) - 0.5;
  let basePos = vec2i(floor(idx));
  
  let bufferStart = upperBufferOffset + upperRayIndex;
  let samples = array(
    sampleUpperProbe(basePos, upperRaysPerProbe, bufferStart, upperCascadeWidth),
    sampleUpperProbe(basePos + vec2i(1, 0), upperRaysPerProbe, bufferStart, upperCascadeWidth),
    sampleUpperProbe(basePos + vec2i(0, 1), upperRaysPerProbe, bufferStart, upperCascadeWidth),
    sampleUpperProbe(basePos + vec2i(1, 1), upperRaysPerProbe, bufferStart, upperCascadeWidth),
  );
  
  let factor = fract(idx);
  let invFactor = 1.0 - factor;
  
  // Bilinear interpolation
  let r1 = samples[0] * invFactor.x + samples[1] * factor.x;
  let r2 = samples[2] * invFactor.x + samples[3] * factor.x;
  return r1 * invFactor.y + r2 * factor.y;
}

@compute @workgroup_size(${WORKGROUP_SIZE}, 1, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let rayIndex = i32(id.x);
  if (rayIndex >= i32(ubo.totalRays)) {
    return;
  }

  let probeIndex = rayIndex / i32(ubo.probeRayCount);
  let probeRayIndex = rayIndex % i32(ubo.probeRayCount);
  
  let probeRadius = f32(ubo.probeRadius);
  let probeDiameter = probeRadius * 2.0;
  let cascadeWidth = i32(f32(ubo.width) / probeDiameter);
  
  let col = probeIndex % cascadeWidth;
  let row = probeIndex / cascadeWidth;
  
  // Ray angle with half-pixel offset for better coverage
  let rayAngle = TAU * (f32(probeRayIndex) + 0.5) / f32(ubo.probeRayCount);
  let rayDir = vec2f(cos(rayAngle), sin(rayAngle));
  
  // Probe center position
  let rayOrigin = vec2f(
    f32(col) * probeDiameter + probeRadius,
    f32(row) * probeDiameter + probeRadius,
  );
  
  // Raymarch through the interval using DDA-style stepping
  var acc = vec4f(0.0, 0.0, 0.0, 1.0);
  var t = ubo.intervalStart;
  let maxDist = ubo.intervalEnd;
  
  while (t < maxDist) {
    let pos = rayOrigin + rayDir * t;
    
    // Bounds check
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= f32(ubo.width) || pos.y >= f32(ubo.height)) {
      break;
    }
    
    // Sample scene: returns (emissive RGB, opacity)
    let sample = sampleScene(pos);
    
    // Accumulate: add emissive light, reduce transmittance by opacity
    let transparency = 1.0 - sample.a;
    acc = vec4f(
      acc.rgb + acc.a * sample.rgb,
      acc.a * transparency
    );
    
    // Early out if fully occluded
    if (acc.a < 0.001) {
      break;
    }
    
    t += 1.0;
  }
  
  // Sample upper cascade and merge
  let upperSample = sampleUpperProbes(rayOrigin, probeRayIndex);
  
  // Write to buffer with ping-pong indexing
  let outputIndex = i32(ubo.maxLevel0Rays * (ubo.level % 2u)) + rayIndex;
  probes[outputIndex] = vec4f(
    acc.rgb + acc.a * upperSample.rgb,
    acc.a * upperSample.a
  );
}
`;

// Fluence shader - averages all rays per probe for final display
const fluenceShader = /*wgsl*/ `
struct UBO {
  probeRayCount: u32,
  cascadeWidth: u32,
  width: u32,
  height: u32,
  probeRadius: u32,
}

@group(0) @binding(0) var fluenceTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var<storage, read> probes: array<vec4f>;
@group(0) @binding(2) var<uniform> ubo: UBO;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ubo.width || id.y >= ubo.height) {
    return;
  }
  
  let probeDiameter = f32(ubo.probeRadius) * 2.0;
  let pixelCenter = vec2f(id.xy) + 0.5;
  
  // Find which probe this pixel belongs to
  let probeIdx = vec2i(pixelCenter / probeDiameter);
  let clampedIdx = clamp(probeIdx, vec2i(0), vec2i(i32(ubo.cascadeWidth) - 1));
  
  // Calculate index into probe buffer (level 0 starts at offset 0)
  let startIndex = clampedIdx.x * i32(ubo.probeRayCount) + clampedIdx.y * i32(ubo.probeRayCount * ubo.cascadeWidth);
  
  // Average all rays from this probe
  var acc = vec4f(0.0);
  for (var i = 0u; i < ubo.probeRayCount; i++) {
    acc += probes[startIndex + i32(i)];
  }
  acc /= f32(ubo.probeRayCount);
  
  // ACES-like tone mapping for better contrast
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  let color = saturate((acc.rgb * (a * acc.rgb + b)) / (acc.rgb * (c * acc.rgb + d) + e));
  
  // Gamma correction
  let gamma = pow(color, vec3f(1.0 / 2.2));
  
  textureStore(fluenceTexture, id.xy, vec4f(gamma, 1.0));
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
