import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Ensure DOM is cleaned up after each test to prevent state leaking between tests.
afterEach(() => {
  cleanup();
});
