/** 
 * The nature of this project requires that we have multiple game/simulation loops running at the same time.
 * This usually means multiple calls to window.requestAnimationFrame, which turns out is very costly.
 * These helper functions batch calls to window.requestAnimationFrame to avoid that overhead.
 * TODO: add some benchmarks for this
*/

const callbacks = new Set<FrameRequestCallback>();
let rAFId = -1;

function onRAF(time: DOMHighResTimeStamp) {
  rAFId = -1;
  const values = Array.from(callbacks);
  callbacks.clear();
  values.forEach((callback) => callback(time));
}

/** Batch calls to window.requestAnimationFrame */
export function requestAnimationFrame(callback: FrameRequestCallback) {
  if (callbacks.size === 0) {
    rAFId = window.requestAnimationFrame(onRAF);
  }

  callbacks.add(callback);
}

/** Batch calls to window.cancelAnimationFrame */
export function cancelAnimationFrame(callback: FrameRequestCallback) {
  callbacks.delete(callback);

  if (callbacks.size === 0) {
    window.cancelAnimationFrame(rAFId);
  }
}
