import * as React from 'react';
import type { Preview } from '@storybook/react-vite';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
// The app's global stylesheet: Tailwind v4 (@import "tailwindcss") plus the
// console @theme tokens (near-black background, green accent). Processed by the
// same @tailwindcss/postcss pipeline the app uses, via postcss.config.js.
import '../src/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    backgrounds: {
      default: 'console',
      values: [{ name: 'console', value: '#0a0c0f' }],
    },
  },
  decorators: [
    // Now-dashboard cards live in a grid column roughly this wide. Constraining
    // the canvas keeps story layout faithful to the real dashboard instead of
    // stretching cards full-bleed. globals.css sets body overflow:hidden for
    // the app shell; relax it here so taller stories aren't clipped.
    (Story) => (
      <div style={{ maxWidth: 460, padding: 16, color: 'var(--color-foreground)' }}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
