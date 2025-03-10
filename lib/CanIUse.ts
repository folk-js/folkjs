export class CanIUse {
  static moveBefore() {
    const enabled = !!(Element.prototype as any).moveBefore;
    if (!enabled) {
      console.warn('moveBefore() API requires Chrome Canary with chrome://flags/#atomic-move enabled');
      alert('moveBefore() API requires Chrome Canary with chrome://flags/#atomic-move enabled');
    }
    return enabled;
  }

  static viewTransition() {
    const enabled = !!(document as any).startViewTransition;
    if (!enabled) {
      console.warn('View Transition API is not supported in this browser');
      alert('View Transition API is not supported in this browser');
    }
    return enabled;
  }

  static webGPU() {
    const enabled = !!(navigator as any).gpu;
    if (!enabled) {
      console.warn('WebGPU is not supported in this browser');
      alert('WebGPU is not supported/enabled in this browser');
    }
    return enabled;
  }

  static paintAPI() {
    const enabled = typeof CSS !== 'undefined' && !!(CSS as any).paintWorklet;
    if (!enabled) {
      console.warn('CSS Paint API is not supported in this browser');
      alert('CSS Paint API is not supported in this browser');
    }
    return enabled;
  }

  static highlightAPI() {}
}
