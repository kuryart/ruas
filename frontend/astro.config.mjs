// @ts-check
import { defineConfig } from 'astro/config';

import solidJs from '@astrojs/solid-js';

const API_COMMANDS = [
  'list_contacts', 'read_contact', 'save_contact',
  'create_contact', 'delete_contact',
  'list_notes', 'read_note', 'search_notes',
  'save_note', 'create_note', 'delete_note', 'list_blocks',
  'get_backlinks', 'list_notes_tree',
  'list_appearance', 'read_appearance_css', 'get_appearance_config', 'set_appearance_config',
];

// https://astro.build/config
export default defineConfig({
  integrations: [solidJs()],
  vite: {
    // Pre-bundle deps that are otherwise discovered lazily; without this, adding
    // a new dependency can leave the dev server serving a stale/octet-stream
    // chunk and break island hydration until the cache is cleared.
    optimizeDeps: {
      include: ['fuse.js'],
    },
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