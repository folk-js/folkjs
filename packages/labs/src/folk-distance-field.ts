import { DOMRectTransform, type Point } from '@folkjs/canvas';
import { type PropertyValues } from '@folkjs/canvas/reactive-element';
import { glsl } from '@folkjs/dom/tags';
import { WebGLUtils } from '@folkjs/dom/webgl';
import { FolkBaseSet } from './folk-base-set';

/**
 * The DistanceField class calculates a distance field using the Jump Flooding Algorithm (JFA) in WebGL.
 * It renders shapes as seed points and computes the distance from each pixel to the nearest seed point.
 * Previous CPU-based implementation: github.com/folk-canvas/folk-canvas/commit/fdd7fb9d84d93ad665875cad25783c232fd17bcc
 */
export class FolkDistanceField extends FolkBaseSet {
  static override tagName = 'folk-distance-field';

  static readonly MAX_DISTANCE = 99999.0;

  #canvas!: HTMLCanvasElement;
  #glContext!: WebGL2RenderingContext;
  #framebuffer!: WebGLFramebuffer;
  #fullscreenQuadVAO!: WebGLVertexArrayObject;
  #jfaProgram!: WebGLProgram; // Shader program for the Jump Flooding Algorithm
  #renderProgram!: WebGLProgram; // Shader program for final rendering
  #seedProgram!: WebGLProgram; // Shader program for rendering seed points

  /**
   * Groups data for handling different sets of shapes.
   * 'mergeA' and 'mergeB' shapes will have their distance fields merged in rendering,
   * while 'others' will be processed separately.
   */
  #groups: {
    [groupName: string]: {
      textures: WebGLTexture[];
      isPingTexture: boolean;
      shapeVAO: WebGLVertexArrayObject;
      positionBuffer: WebGLBuffer | null;
    };
  } = {};

  // Add class property to store Float32Arrays
  #groupBuffers: {
    [groupName: string]: Float32Array;
  } = {};

  override connectedCallback() {
    super.connectedCallback();

    // Initialize groups for 'mergeA', 'mergeB', and 'others'
    this.#groups = {
      mergeA: {
        textures: [],
        isPingTexture: true,
        shapeVAO: null!,
        positionBuffer: null,
      },
      mergeB: {
        textures: [],
        isPingTexture: true,
        shapeVAO: null!,
        positionBuffer: null,
      },
      others: {
        textures: [],
        isPingTexture: true,
        shapeVAO: null!,
        positionBuffer: null,
      },
    };

    this.#initWebGL();
    this.#initShaders();
    this.#initPingPongTextures();

    window.addEventListener('resize', this.#handleResize);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();

    window.removeEventListener('resize', this.#handleResize);

    this.#cleanupWebGLResources();
  }

  #initWebGL() {
    const { gl, canvas } = WebGLUtils.createWebGLCanvas(this.clientWidth, this.clientHeight);

    if (!gl || !canvas) {
      throw new Error('Failed to initialize WebGL context.');
    }

    this.#canvas = canvas;
    this.renderRoot.prepend(canvas);
    this.#glContext = gl;

    // Create framebuffer object
    this.#framebuffer = gl.createFramebuffer()!;
    if (!this.#framebuffer) {
      throw new Error('Failed to create framebuffer.');
    }
  }

  /**
   * Handles updates to geometry elements by re-initializing seed points and rerunning the JFA.
   */
  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (this.sourcesMap.size !== this.sourceElements.size) return;

    this.#populateSeedPoints();
    this.#runJumpFloodingAlgorithm();
  }

  /**
   * Initializes all shader programs used in rendering.
   */
  #initShaders() {
    this.#jfaProgram = WebGLUtils.createShaderProgram(this.#glContext, commonVertShader, jfaFragShader);
    this.#renderProgram = WebGLUtils.createShaderProgram(this.#glContext, commonVertShader, renderFragShader);
    this.#seedProgram = WebGLUtils.createShaderProgram(this.#glContext, seedVertShader, seedFragShader);
  }

  /**
   * Initializes textures and framebuffer for ping-pong rendering.
   * Supports separate textures for 'mergeA', 'mergeB', and 'others' groups.
   */
  #initPingPongTextures() {
    // Initialize textures for each group
    for (const groupName in this.#groups) {
      this.#groups[groupName].textures = this.#createPingPongTextures();
      this.#groups[groupName].isPingTexture = true;
    }
  }

  /**
   * Utility method to create ping-pong textures.
   */
  #createPingPongTextures(): WebGLTexture[] {
    const gl = this.#glContext;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const textures: WebGLTexture[] = [];

    // Enable the EXT_color_buffer_half_float extension for high-precision floating-point textures
    const ext = gl.getExtension('EXT_color_buffer_half_float');
    if (!ext) {
      console.error('EXT_color_buffer_half_float extension is not supported.');
      return textures;
    }

    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // Set texture parameters
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Use high-precision format for accurate distance calculations
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);

      textures.push(texture);
    }

    return textures;
  }

  /**
   * Populates seed points and assigns shapes to 'mergeA', 'mergeB', or 'others' groups.
   * Shapes with index 0 and 1 are assigned to 'mergeA' and 'mergeB' respectively.
   */
  #populateSeedPoints() {
    const gl = this.#glContext;
    const groupPositions: { [groupName: string]: number[] } = {
      mergeA: [],
      mergeB: [],
      others: [],
    };

    const containerWidth = this.clientWidth;
    const containerHeight = this.clientHeight;

    // Collect positions and assign shapes to groups
    this.sourceRects.forEach((rect, index) => {
      let topLeftParent: Point;
      let topRightParent: Point;
      let bottomLeftParent: Point;
      let bottomRightParent: Point;

      if (rect instanceof DOMRectTransform) {
        topLeftParent = rect.toParentSpace(rect.topLeft);
        topRightParent = rect.toParentSpace(rect.topRight);
        bottomLeftParent = rect.toParentSpace(rect.bottomLeft);
        bottomRightParent = rect.toParentSpace(rect.bottomRight);
      } else {
        topLeftParent = { x: rect.left, y: rect.top };
        topRightParent = { x: rect.right, y: rect.top };
        bottomLeftParent = { x: rect.left, y: rect.bottom };
        bottomRightParent = { x: rect.right, y: rect.bottom };
      }

      // Convert rotated coordinates to NDC using container dimensions
      const x1 = (topLeftParent.x / containerWidth) * 2 - 1;
      const y1 = -((topLeftParent.y / containerHeight) * 2 - 1);
      const x2 = (topRightParent.x / containerWidth) * 2 - 1;
      const y2 = -((topRightParent.y / containerHeight) * 2 - 1);
      const x3 = (bottomLeftParent.x / containerWidth) * 2 - 1;
      const y3 = -((bottomLeftParent.y / containerHeight) * 2 - 1);
      const x4 = (bottomRightParent.x / containerWidth) * 2 - 1;
      const y4 = -((bottomRightParent.y / containerHeight) * 2 - 1);

      const shapeID = index + 1; // Avoid zero to prevent hash function issues

      // Represent each rectangle as two triangles, including shapeID as the z component
      const rectPositions = [
        x1,
        y1,
        shapeID,
        x2,
        y2,
        shapeID,
        x3,
        y3,
        shapeID,

        x3,
        y3,
        shapeID,
        x2,
        y2,
        shapeID,
        x4,
        y4,
        shapeID,
      ];

      // Assign shapes to groups based on index or any other criteria
      let groupName: string;
      if (index === 0) {
        groupName = 'mergeA';
      } else if (index === 1) {
        groupName = 'mergeB';
      } else {
        groupName = 'others';
      }

      groupPositions[groupName].push(...rectPositions);
    });

    // Initialize buffers and VAOs for each group
    for (const groupName in groupPositions) {
      const positions = groupPositions[groupName];
      const group = this.#groups[groupName];

      if (!group.shapeVAO) {
        // First time initialization
        group.shapeVAO = gl.createVertexArray()!;
        gl.bindVertexArray(group.shapeVAO);
        group.positionBuffer = gl.createBuffer()!;

        // Create and store the Float32Array
        this.#groupBuffers[groupName] = new Float32Array(positions);

        gl.bindBuffer(gl.ARRAY_BUFFER, group.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.#groupBuffers[groupName], gl.DYNAMIC_DRAW);

        const positionLocation = gl.getAttribLocation(this.#seedProgram, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
      } else {
        // Reuse existing Float32Array if size hasn't changed
        const existingArray = this.#groupBuffers[groupName];
        if (positions.length !== existingArray.length) {
          // Only create new array if size changed
          this.#groupBuffers[groupName] = new Float32Array(positions);
          gl.bindBuffer(gl.ARRAY_BUFFER, group.positionBuffer!);
          gl.bufferData(gl.ARRAY_BUFFER, this.#groupBuffers[groupName], gl.DYNAMIC_DRAW);
        } else {
          // Reuse existing array
          existingArray.set(positions);
          gl.bindBuffer(gl.ARRAY_BUFFER, group.positionBuffer!);
          gl.bufferData(gl.ARRAY_BUFFER, existingArray, gl.DYNAMIC_DRAW);
        }
      }
    }

    // Render the seed points into the textures for each group
    for (const groupName in groupPositions) {
      const positions = groupPositions[groupName];
      const vertexCount = positions.length / 3;
      this.#renderSeedPointsForGroup(
        this.#groups[groupName].shapeVAO,
        this.#groups[groupName].textures[this.#groups[groupName].isPingTexture ? 0 : 1],
        vertexCount,
      );
    }
  }

  /**
   * Utility method to render seed points for a given group.
   */
  #renderSeedPointsForGroup(vao: WebGLVertexArrayObject, seedTexture: WebGLTexture, vertexCount: number) {
    const gl = this.#glContext;

    // Bind framebuffer to render to the seed texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, seedTexture, 0);

    // Clear the texture with a large initial distance
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, FolkDistanceField.MAX_DISTANCE);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use the seed shader program
    gl.useProgram(this.#seedProgram);

    // Set the canvas size uniform
    const canvasSizeLocation = gl.getUniformLocation(this.#seedProgram, 'u_canvasSize');
    gl.uniform2f(canvasSizeLocation, this.#canvas.width, this.#canvas.height);

    // Bind VAO and draw shapes
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    gl.bindVertexArray(null);

    // Unbind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Executes the Jump Flooding Algorithm (JFA) for each group separately.
   * 'mergeA' and 'mergeB' groups will have their distance fields merged in rendering.
   */
  #runJumpFloodingAlgorithm() {
    // Compute initial step size
    let stepSize = 1 << Math.floor(Math.log2(Math.max(this.#canvas.width, this.#canvas.height)));

    // Perform passes with decreasing step sizes for each group
    for (const groupName in this.#groups) {
      const group = this.#groups[groupName];
      const textures = group.textures;
      let isPingTexture = group.isPingTexture;

      for (let size = stepSize; size >= 1; size >>= 1) {
        this.#renderPass(size, textures, isPingTexture);
        isPingTexture = !isPingTexture;
      }

      group.isPingTexture = isPingTexture; // Update the ping-pong status
    }

    // Render the final result to the screen
    this.#renderToScreen();
  }

  /**
   * Performs a single pass of the Jump Flooding Algorithm with a given step size for a specific distance field.
   */
  #renderPass(stepSize: number, textures: WebGLTexture[], isPingTexture: boolean) {
    const gl = this.#glContext;

    // Swap textures for ping-pong rendering
    const inputTexture = isPingTexture ? textures[0] : textures[1];
    const outputTexture = isPingTexture ? textures[1] : textures[0];

    // Bind framebuffer to output texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);

    // Use the JFA shader program
    gl.useProgram(this.#jfaProgram);

    // Compute and set the offsets uniform for neighboring pixels
    const offsets = this.#computeOffsets(stepSize);
    const offsetsLocation = gl.getUniformLocation(this.#jfaProgram, 'u_offsets');
    gl.uniform2fv(offsetsLocation, offsets);

    // Bind input texture containing the previous step's results
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.uniform1i(gl.getUniformLocation(this.#jfaProgram, 'u_previousTexture'), 0);

    // Draw a fullscreen quad to process all pixels
    this.#drawFullscreenQuad();

    // Unbind framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * Renders the final distance field to the screen using the render shader program.
   * Merges 'mergeA' and 'mergeB' distance fields during rendering, while 'others' are not merged.
   */
  #renderToScreen() {
    const gl = this.#glContext;

    // Unbind framebuffer to render directly to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);

    // Use the render shader program
    gl.useProgram(this.#renderProgram);

    // Bind the final textures from each group
    let textureUnit = 0;
    for (const groupName in this.#groups) {
      const group = this.#groups[groupName];
      const finalTexture = group.textures[group.isPingTexture ? 0 : 1];
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, finalTexture);
      gl.uniform1i(gl.getUniformLocation(this.#renderProgram, `u_texture_${groupName}`), textureUnit);
      textureUnit++;
    }

    // Draw a fullscreen quad to display the result
    this.#drawFullscreenQuad();
  }

  /**
   * Draws a fullscreen quad to cover the entire canvas.
   * This is used in shader passes where every pixel needs to be processed.
   */
  #drawFullscreenQuad() {
    const gl = this.#glContext;

    // Initialize the quad geometry if it hasn't been done yet
    if (!this.#fullscreenQuadVAO) {
      this.#initFullscreenQuad();
    }

    gl.bindVertexArray(this.#fullscreenQuadVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Initializes the geometry and buffers for the fullscreen quad.
   */
  #initFullscreenQuad() {
    const gl = this.#glContext;

    // Define positions for a quad covering the entire screen
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    this.#fullscreenQuadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.#fullscreenQuadVAO);

    const positionBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionAttributeLocation = gl.getAttribLocation(this.#jfaProgram, 'a_position');
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.vertexAttribPointer(
      positionAttributeLocation,
      2, // size (x, y)
      gl.FLOAT, // type
      false, // normalize
      0, // stride
      0, // offset
    );

    gl.bindVertexArray(null);
  }

  /**
   * Handles window resize events by updating canvas size, re-initializing textures and seed points,
   * and rerunning the Jump Flooding Algorithm.
   */
  #handleResize = () => {
    const gl = this.#glContext;

    // Update canvas size to match the container instead of window
    this.#canvas.width = this.clientWidth;
    this.#canvas.height = this.clientHeight;

    // Update the viewport
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);

    // Re-initialize textures with the new dimensions
    this.#initPingPongTextures();

    // Re-initialize seed point rendering to update positions
    this.#populateSeedPoints();

    // Rerun the Jump Flooding Algorithm with the new sizes
    this.#runJumpFloodingAlgorithm();
  };

  /**
   * Computes the offsets to sample neighboring pixels based on the current step size.
   * These offsets are used in the JFA shader to determine where to look for potential nearer seed points.
   * @param stepSize The current step size for neighbor sampling.
   * @returns A Float32Array of offsets.
   */
  #computeOffsets(stepSize: number): Float32Array {
    const aspectRatio = this.#canvas.width / this.#canvas.height;
    const offsets: number[] = [];
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) {
        // Adjust x offset by aspect ratio to maintain uniform distances
        offsets.push((x * stepSize * aspectRatio) / this.#canvas.width, (y * stepSize) / this.#canvas.height);
      }
    }
    return new Float32Array(offsets);
  }

  /**
   * Cleans up WebGL resources to prevent memory leaks.
   * This is called when the element is disconnected from the DOM.
   */
  #cleanupWebGLResources() {
    const gl = this.#glContext;

    // Delete resources for each group
    for (const groupName in this.#groups) {
      const group = this.#groups[groupName];

      // Delete textures
      group.textures.forEach((texture) => gl.deleteTexture(texture));
      group.textures = [];

      // Delete VAOs
      if (group.shapeVAO) {
        gl.deleteVertexArray(group.shapeVAO);
      }

      // Delete buffers
      if (group.positionBuffer) {
        gl.deleteBuffer(group.positionBuffer);
      }
    }

    // Delete framebuffer
    if (this.#framebuffer) {
      gl.deleteFramebuffer(this.#framebuffer);
    }

    // Delete fullscreen quad VAO
    if (this.#fullscreenQuadVAO) {
      gl.deleteVertexArray(this.#fullscreenQuadVAO);
    }

    // Delete shader programs
    if (this.#jfaProgram) {
      gl.deleteProgram(this.#jfaProgram);
    }
    if (this.#renderProgram) {
      gl.deleteProgram(this.#renderProgram);
    }
    if (this.#seedProgram) {
      gl.deleteProgram(this.#seedProgram);
    }

    this.#groupBuffers = {};
  }
}

/**
 * Vertex shader shared by multiple programs.
 * Transforms vertices to normalized device coordinates and passes texture coordinates to the fragment shader.
 */
const commonVertShader = glsl`#version 300 es
precision mediump float;
in vec2 a_position;
out vec2 v_texCoord;

void main() {
  v_texCoord = a_position * 0.5 + 0.5; // Transform to [0, 1] range
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Fragment shader for the Jump Flooding Algorithm.
 * Updates the nearest seed point and distance for each pixel by examining neighboring pixels.
 */
const jfaFragShader = glsl`#version 300 es
precision mediump float;
precision mediump int;

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_previousTexture;
uniform vec2 u_offsets[9];

void main() {
    vec4 nearest = texture(u_previousTexture, v_texCoord);
    float minDist = nearest.a;

    float aspectRatio = float(textureSize(u_previousTexture, 0).x) / float(textureSize(u_previousTexture, 0).y);
    
    for (int i = 0; i < 9; ++i) {
        vec2 sampleCoord = v_texCoord + u_offsets[i];
        sampleCoord = clamp(sampleCoord, vec2(0.0), vec2(1.0));
        vec4 sampled = texture(u_previousTexture, sampleCoord);

        if (sampled.z == 0.0) {
            continue;
        }

        // Adjust x coordinate by aspect ratio when calculating distance
        vec2 adjustedCoord = vec2(v_texCoord.x * aspectRatio, v_texCoord.y);
        vec2 adjustedSampledCoord = vec2(sampled.x * aspectRatio, sampled.y);
        float dist = distance(adjustedSampledCoord, adjustedCoord);

        if (dist < minDist) {
            nearest = sampled;
            nearest.a = dist;
            minDist = dist;
        }
    }

    outColor = nearest;
}`;

/**
 * Fragment shader for rendering the final distance field.
 * Merges 'mergeA' and 'mergeB' distance fields during rendering.
 */
const renderFragShader = glsl`#version 300 es
precision mediump float;

#define DEBUG_MODULO false
#define DEBUG_HARD_CUTOFF false
#define FALLOFF_FACTOR 10.0
#define SMOOTHING_FACTOR 0.1
#define DEBUG_HARD_CUTOFF_DISTANCE 0.2

in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_texture_mergeA;
uniform sampler2D u_texture_mergeB;
uniform sampler2D u_texture_others;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Smooth minimum function
float smoothMin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec4 texelMergeA = texture(u_texture_mergeA, v_texCoord);
  vec4 texelMergeB = texture(u_texture_mergeB, v_texCoord);
  vec4 texelOthers = texture(u_texture_others, v_texCoord);

  // Extract shape IDs and distances
  float shapeIDMergeA = texelMergeA.z;
  float distanceMergeA = texelMergeA.a;

  float shapeIDMergeB = texelMergeB.z;
  float distanceMergeB = texelMergeB.a;

  float shapeIDOthers = texelOthers.z;
  float distanceOthers = texelOthers.a;

  // Compute colors for mergeA and mergeB
  float hueMergeA = fract(shapeIDMergeA * 0.61803398875);
  vec3 colorMergeA = hsv2rgb(vec3(hueMergeA, 0.5, 0.95));

  float hueMergeB = fract(shapeIDMergeB * 0.61803398875);
  vec3 colorMergeB = hsv2rgb(vec3(hueMergeB, 0.5, 0.95));

  // Merge distances of mergeA and mergeB
  float mergedDistanceAB = smoothMin(distanceMergeA, distanceMergeB, SMOOTHING_FACTOR);

  // Calculate blend factor for colors
  float hAB = clamp(0.5 + 0.5 * (distanceMergeB - distanceMergeA) / SMOOTHING_FACTOR, 0.0, 1.0);
  vec3 mergedColorAB = mix(colorMergeB, colorMergeA, hAB);

  // Compute color and distance for others
  float hueOthers = fract(shapeIDOthers * 0.61803398875);
  vec3 colorOthers = hsv2rgb(vec3(hueOthers, 0.5, 0.95));

  // Decide between merged distances and others
  float finalDistance;
  vec3 finalColor;

  if (mergedDistanceAB <= distanceOthers) {
    finalDistance = mergedDistanceAB;
    finalColor = mergedColorAB;
  } else {
    finalDistance = distanceOthers;
    finalColor = colorOthers;
  }

  if (DEBUG_MODULO) {
    // Visualize distance bands using modulo
    float bandWidth = 0.02; // Adjust this value to change the width of the bands
    float distanceBand = mod(finalDistance, bandWidth) / bandWidth;
    
    // Create alternating black and white bands
    float bandColor = step(0.1, distanceBand);
    
    // Mix the band visualization with the merged color
    finalColor = mix(vec3(0.0), finalColor, bandColor);
  }

  // Before applying any effects, check if we should use hard cutoff
  if (DEBUG_HARD_CUTOFF) {
    // If distance is greater than cutoff, set intensity to 0, otherwise 1
    finalColor *= finalDistance > DEBUG_HARD_CUTOFF_DISTANCE ? 0.0 : exp(-finalDistance * FALLOFF_FACTOR);
  } else {
    // Use the original smooth falloff
    finalColor *= exp(-finalDistance * FALLOFF_FACTOR);
  }


  outColor = vec4(finalColor, 1.0);
}`;

/**
 * Vertex shader for rendering seed points.
 * Outputs the shape ID to the fragment shader.
 */
const seedVertShader = glsl`#version 300 es
precision mediump float;

in vec3 a_position; // x, y position and shapeID as z
flat out float v_shapeID;

void main() {
  gl_Position = vec4(a_position.xy, 0.0, 1.0);
  v_shapeID = a_position.z; // Pass shape ID to fragment shader
}`;

/**
 * Fragment shader for rendering seed points.
 * Initializes the texture with seed point positions and shape IDs.
 */
const seedFragShader = glsl`#version 300 es
precision mediump float;

flat in float v_shapeID;
uniform vec2 u_canvasSize;

out vec4 outColor;

void main() {
  vec2 seedCoord = gl_FragCoord.xy / u_canvasSize;
  outColor = vec4(seedCoord, v_shapeID, 0.0);  // Seed coords (x, y), shape ID (z), initial distance (a)
}`;
