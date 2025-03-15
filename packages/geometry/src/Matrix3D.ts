import type { Point } from './Point.js';

/**
 * Projects a point onto a plane defined by an orthographic 3D transformation matrix.
 * @param point - The point to project onto the plane.
 * @param matrix - The transformation matrix defining the plane.
 * @returns The projected point in the plane's local coordinates.
 * @note Currently assumes 0-0 transform origin.
 */
export function projectPointOntoPlane(point: Point, matrix: DOMMatrix) {
  // Create a ray from camera (assuming orthographic projection)
  const rayOrigin = { x: point.x, y: point.y, z: -1000 }; // Camera positioned behind screen
  const rayDirection = { x: 0, y: 0, z: 1 }; // Pointing forward along z-axis

  // To transform normals correctly with a matrix that includes scaling,
  // we need to use the inverse transpose of the upper 3x3 portion of the matrix
  // Fortunately, for plane normals, we can extract this directly from the inverse matrix
  const inverseMatrix = matrix.inverse();
  const invMatrixElements = inverseMatrix.toFloat32Array();

  // The transformed plane normal is the third row of the inverse matrix (for the Z-normal)
  // Note: We take the 3rd row (not column) of the inverse because of how normals transform
  const planeNormal = {
    x: invMatrixElements[2]!, // Element [0,2]
    y: invMatrixElements[6]!, // Element [1,2]
    z: invMatrixElements[10]!, // Element [2,2]
  };

  // Normalize the normal vector
  const normalLength = Math.sqrt(
    planeNormal.x * planeNormal.x + planeNormal.y * planeNormal.y + planeNormal.z * planeNormal.z,
  );

  if (normalLength < 0.0001) {
    console.warn('Plane normal is too small, defaulting to simple inverse transform');
    // Fall back to the original method if the normal is degenerate
    const pointOnTransformedSpace = inverseMatrix.transformPoint(point);
    return pointOnTransformedSpace;
  }

  planeNormal.x /= normalLength;
  planeNormal.y /= normalLength;
  planeNormal.z /= normalLength;

  const matrixElements = matrix.toFloat32Array();

  // A point on the plane (the transform origin point)
  const planePoint = {
    x: matrixElements[12]!,
    y: matrixElements[13]!,
    z: matrixElements[14]!,
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
  const localPoint = inverseMatrix.transformPoint(
    new DOMPoint(intersectionPoint.x, intersectionPoint.y, intersectionPoint.z),
  );

  // The local point in 2D (x,y) is what we want to return
  const pointOnTransformedSpace = {
    x: localPoint.x,
    y: localPoint.y,
  };

  return pointOnTransformedSpace;
}

/**
 * Projects a point from a plane's local coordinates back to screen space.
 * This is the inverse of projectPointOntoPlane.
 * @param planePoint - The point in the plane's local coordinates.
 * @param matrix - The transformation matrix defining the plane.
 * @returns The corresponding screen-space point.
 */
export function projectPointFromPlane(planePoint: Point, matrix: DOMMatrix): Point {
  // Transform the point from the plane's local space to world space
  const worldPoint = matrix.transformPoint(planePoint);

  return {
    x: worldPoint.x,
    y: worldPoint.y,
  };
}
