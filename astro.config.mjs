import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://electrocasnice1.ro',
  trailingSlash: 'always',
  compressHTML: true,
  build: { format: 'directory' },
});
