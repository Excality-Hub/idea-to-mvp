import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom's synthetic mouse events leave `event.view` null, which crashes d3-zoom's
// drag-disable helper (used internally by @xyflow/react's pane pan/zoom) when a
// click on a node bubbles up to the canvas. Real browsers always populate
// `event.view`, so this is a test-environment-only artifact, not a product bug.
window.addEventListener("error", (event) => {
  if (event.error instanceof TypeError && /reading 'document'/.test(event.error.message)) {
    event.preventDefault();
  }
});
