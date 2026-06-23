import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Ensure DOM is cleaned up after each test to prevent state leaking between tests.
afterEach(() => {
  cleanup();
});

// jsdom lacks the pointer-capture and scroll APIs Radix primitives (Select, etc.)
// rely on. Stub them so Radix-driven components can be exercised in tests.
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

// cmdk observes its list size, but jsdom does not implement ResizeObserver.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
