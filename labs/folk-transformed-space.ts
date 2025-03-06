import { FolkElement, type Point } from '@lib';
import { Gizmos } from '@lib/folk-gizmos';
import { html } from '@lib/tags';
import { css } from '@lit/reactive-element';

export class FolkTransformedSpace extends FolkElement {
  static override tagName = 'folk-transformed-space';

  static styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
    }

    .space {
      position: absolute;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
      backface-visibility: hidden;
    }
  `;

  #matrix = new DOMMatrix();

  override createRenderRoot() {
    const root = super.createRenderRoot() as ShadowRoot;

    root.setHTMLUnsafe(html`
      <div class="space" style="transform: ${this.#matrix}">
        <slot></slot>
      </div>
    `);

    return root;
  }

  rotate(angle: number = 45) {
    this.#matrix = new DOMMatrix().rotateAxisAngle(1, 0, 0, angle);

    const space = this.shadowRoot?.querySelector('.space');
    if (space instanceof HTMLElement) {
      space.style.transform = this.#matrix.toString();
    }

    Gizmos.clear();
  }

  translate2D(x: number, y: number) {
    this.#matrix = new DOMMatrix().translate(x, y);

    const space = this.shadowRoot?.querySelector('.space');
    if (space instanceof HTMLElement) {
      space.style.transform = this.#matrix.toString();
    }

    Gizmos.clear();
  }

  scale(factor: number) {
    this.#matrix = new DOMMatrix().scale(factor, factor);

    const space = this.shadowRoot?.querySelector('.space');
    if (space instanceof HTMLElement) {
      space.style.transform = this.#matrix.toString();
    }
  }

  randomize2D() {
    const min = -200;
    const max = 200;
    const translateX = Math.random() * (max - min) + min;
    const translateY = Math.random() * (max - min) + min;
    const scaleFactor = Math.random() * 1.5 + 0.5; // Random scale between 0.5 and 2
    const rotationAngle = Math.random() * 90; // Random rotation up to 90 degrees
    this.#matrix = new DOMMatrix()
      .translate(translateX, translateY)
      .scale(scaleFactor, scaleFactor)
      .rotateAxisAngle(0, 0, 1, rotationAngle);

    const space = this.shadowRoot?.querySelector('.space');
    if (space instanceof HTMLElement) {
      space.style.transform = this.#matrix.toString();
    }

    Gizmos.clear();
  }

  randomize3D() {
    const min = -200;
    const max = 200;
    const translateX = Math.random() * (max - min) + min;
    const translateY = Math.random() * (max - min) + min;
    const scaleFactor = Math.random() * 1.5 + 0.5; // Random scale between 0.5 and 2
    const rotationAngle = Math.random() * 45; // Random rotation up to 90 degrees

    this.#matrix = new DOMMatrix()
      .translate(translateX, translateY)
      // .scale(scaleFactor, scaleFactor)
      .rotateAxisAngle(1, 0, 0, rotationAngle * Math.random())
      .rotateAxisAngle(0, 1, 0, rotationAngle * Math.random())
      .rotateAxisAngle(0, 0, 1, rotationAngle * Math.random());
    const space = this.shadowRoot?.querySelector('.space');
    if (space instanceof HTMLElement) {
      space.style.transform = this.#matrix.toString();
    }

    Gizmos.clear();
  }

  static projectPoint(point: Point, space: FolkTransformedSpace): Point {
    // Visualize the click location in screen space
    Gizmos.point(point, { color: 'red', size: 4 });

    // Create a ray from camera (assuming orthographic projection)
    const rayOrigin = { x: point.x, y: point.y, z: -1000 }; // Camera positioned behind screen
    const rayDirection = { x: 0, y: 0, z: 1 }; // Pointing forward along z-axis

    // Extract plane information from the transformation matrix
    const matrixElements = space.#matrix.toFloat32Array();

    // The plane normal is the transformed z-axis (third column of rotation part)
    const planeNormal = {
      x: matrixElements[8],
      y: matrixElements[9],
      z: matrixElements[10],
    };

    // Normalize the normal vector
    const normalLength = Math.sqrt(
      planeNormal.x * planeNormal.x + planeNormal.y * planeNormal.y + planeNormal.z * planeNormal.z,
    );

    if (normalLength < 0.0001) {
      console.warn('Plane normal is too small, defaulting to simple inverse transform');
      // Fall back to the original method if the normal is degenerate
      const inverseMatrix = space.#matrix.inverse();
      const pointOnTransformedSpace = inverseMatrix.transformPoint(point);
      // Gizmos.point(pointOnTransformedSpace, { color: 'black', size: 2, layer: 'transformed' });
      return pointOnTransformedSpace;
    }

    planeNormal.x /= normalLength;
    planeNormal.y /= normalLength;
    planeNormal.z /= normalLength;

    // A point on the plane (the transform origin point)
    const planePoint = {
      x: matrixElements[12],
      y: matrixElements[13],
      z: matrixElements[14],
    };

    // Calculate ray-plane intersection
    const dotNormalDirection =
      planeNormal.x * rayDirection.x + planeNormal.y * rayDirection.y + planeNormal.z * rayDirection.z;

    if (Math.abs(dotNormalDirection) < 0.0001) {
      // Ray is parallel to the plane, no intersection
      console.warn('Ray is parallel to plane, no intersection possible');
      return point; // Return original point as fallback
    }

    const dotNormalDifference =
      planeNormal.x * (planePoint.x - rayOrigin.x) +
      planeNormal.y * (planePoint.y - rayOrigin.y) +
      planeNormal.z * (planePoint.z - rayOrigin.z);

    const t = dotNormalDifference / dotNormalDirection;

    // Calculate intersection point in world space
    const intersectionPoint = {
      x: rayOrigin.x + rayDirection.x * t,
      y: rayOrigin.y + rayDirection.y * t,
      z: rayOrigin.z + rayDirection.z * t,
    };

    // Transform the world intersection point to plane local coordinates
    const inverseMatrix = space.#matrix.inverse();
    const localPoint = inverseMatrix.transformPoint(
      new DOMPoint(intersectionPoint.x, intersectionPoint.y, intersectionPoint.z),
    );

    // The local point in 2D (x,y) is what we want to return
    const pointOnTransformedSpace = {
      x: localPoint.x,
      y: localPoint.y,
    };

    // draw the point onto the transformed plane in its local x/y coordinates
    Gizmos.point(pointOnTransformedSpace, { color: 'blue', size: 10, layer: 'transformed' });

    return pointOnTransformedSpace;
  }
}
