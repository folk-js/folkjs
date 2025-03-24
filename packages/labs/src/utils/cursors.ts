const resizeCursorCache = new Map<number, string>();
const rotateCursorCache = new Map<number, string>();

function getRoundedDegree(degrees: number, interval: number = 1): number {
  return (Math.round(degrees / interval) * interval) % 360;
}

export function getResizeCursorUrl(degrees: number): string {
  degrees = getRoundedDegree(degrees);

  // Map degrees greater than 180 to equivalent symmetrical cursor
  if (degrees > 180) {
    degrees -= 180;
  }

  if (!resizeCursorCache.has(degrees)) {
    const url = resizeCursorUrl(degrees);
    resizeCursorCache.set(degrees, url);
  }
  return resizeCursorCache.get(degrees)!;
}

export function getRotateCursorUrl(degrees: number): string {
  degrees = getRoundedDegree(degrees);

  if (!rotateCursorCache.has(degrees)) {
    const url = rotateCursorUrl(degrees);
    rotateCursorCache.set(degrees, url);
  }
  return rotateCursorCache.get(degrees)!;
}

const resizeCursorUrl = (degrees: number) =>
  `url("data:image/svg+xml,<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg'><g fill='none' transform='rotate(${degrees} 16 16)'><path d='M9 9L21 21M9 9H12L9 12V9ZM21 21V18L18 21H21Z' stroke='white' stroke-width='3' stroke-linejoin='miter'/><path d='M9 9L21 21M9 9H12L9 12V9ZM21 21V18L18 21H21Z' stroke='black' stroke-width='1.5' stroke-linejoin='miter'/></g></svg>") 16 16, nwse-resize`;

const rotateCursorUrl = (degrees: number) =>
  `url("data:image/svg+xml,<svg height='32' width='32' viewBox='0 0 32 32' xmlns='http://www.w3.org/2000/svg' style='color: black;'><defs><filter id='shadow' y='-40%' x='-40%' width='180%' height='180%' color-interpolation-filters='sRGB'><feDropShadow dx='2' dy='2' stdDeviation='1.5' flood-opacity='.3'/></filter></defs><g filter='url(%23shadow)'><g fill='none' transform='rotate(${degrees} 16 16)'><path d='M22.4789 9.45728L25.9935 12.9942L22.4789 16.5283V14.1032C18.126 14.1502 14.6071 17.6737 14.5675 22.0283H17.05L13.513 25.543L9.97889 22.0283H12.5674C12.6071 16.5691 17.0214 12.1503 22.4789 12.1031L22.4789 9.45728Z' fill='black'/><path fill-rule='evenodd' clip-rule='evenodd' d='M21.4789 7.03223L27.4035 12.9945L21.4789 18.9521V15.1868C18.4798 15.6549 16.1113 18.0273 15.649 21.0284H19.475L13.5128 26.953L7.55519 21.0284H11.6189C12.1243 15.8155 16.2679 11.6677 21.4789 11.1559L21.4789 7.03223ZM22.4789 12.1031C17.0214 12.1503 12.6071 16.5691 12.5674 22.0284H9.97889L13.513 25.543L17.05 22.0284H14.5675C14.5705 21.6896 14.5947 21.3558 14.6386 21.0284C15.1157 17.4741 17.9266 14.6592 21.4789 14.1761C21.8063 14.1316 22.1401 14.1069 22.4789 14.1032V16.5284L25.9935 12.9942L22.4789 9.45729L22.4789 12.1031Z' fill='white'/></g></g></svg>") 16 16, pointer`;
