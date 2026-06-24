import * as React from 'react';
import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    backgrounds: {
      default: 'eforge-plan',
      values: [{ name: 'eforge-plan', value: '#0a0c0f' }],
    },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: '100vh', padding: 24, color: 'var(--color-foreground)' }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
