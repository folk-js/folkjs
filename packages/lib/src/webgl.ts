export class WebGLUtils {
  static createShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!success) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }
    return shader;
  }

  static createProgram(
    gl: WebGL2RenderingContext,
    vertexShader: WebGLShader,
    fragmentShader?: WebGLShader
  ): WebGLProgram {
    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    if (fragmentShader) {
      gl.attachShader(program, fragmentShader);
    }
    gl.linkProgram(program);

    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!success) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program linking failed: ${error}`);
    }
    return program;
  }

  static createWebGLCanvas(
    width: number,
    height: number
  ): { gl: WebGL2RenderingContext | undefined; canvas: HTMLCanvasElement } {
    const canvas = document.createElement('canvas');

    // Set canvas styles
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.zIndex = '-1';

    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) {
      console.error('WebGL2 is not available.');
      return { gl: undefined, canvas };
    }
    return { gl, canvas };
  }

  static createShaderProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertexShader = this.createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.createProgram(gl, vertexShader, fragmentShader);

    // Clean up shaders since they're now linked to the program
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }
}
