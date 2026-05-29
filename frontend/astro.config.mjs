// @ts-check
import { defineConfig } from 'astro/config';

import solidJs from '@astrojs/solid-js';

const API_COMMANDS = [
  'list_contacts', 'read_contact', 'save_contact',
  'create_contact', 'delete_contact',
];

// https://astro.build/config
export default defineConfig({
  integrations: [solidJs()],
  vite: {
    server: {
      proxy: Object.fromEntries(
        API_COMMANDS.map(cmd => [
          `/${cmd}`,
          { target: 'http://localhost:8080', changeOrigin: true },
        ]),
      ),
    },
  },
});