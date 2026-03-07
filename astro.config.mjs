import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://electrocasnice1.ro',
  trailingSlash: 'always',
  compressHTML: true,
  build: {
    format: 'directory'
  },
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()]
  }
});
