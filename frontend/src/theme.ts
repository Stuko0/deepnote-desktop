import { extendTheme } from '@chakra-ui/react';

/**
 * Theme derived from the design tokens captured from the Deepnote SaaS
 * (research/ui: 684 --chakra-* custom properties). Inter for UI, Roboto Mono
 * for code, blue for primary actions, purple for the brand and agent.
 */
const theme = extendTheme({
  fonts: {
    heading: 'Inter, system-ui, sans-serif',
    body: 'Inter, system-ui, sans-serif',
    mono: 'Roboto Mono, ui-monospace, monospace',
  },
  colors: {
    brand: {
      50: '#f3f0ff',
      100: '#e4dcff',
      500: '#6b46c1',
      600: '#553c9a',
      700: '#44337a',
    },
    accent: {
      50: '#eef5ff',
      100: '#d6e4ff',
      200: '#a6c8ff',
      500: '#276ef1',
      600: '#1f5fd6',
      700: '#1a4fae',
      950: '#012447',
    },
  },
  styles: {
    global: {
      body: { bg: 'white', color: 'gray.800' },
    },
  },
  config: {
    initialColorMode: 'light',
    useSystemColorMode: false,
  },
});

export default theme;
