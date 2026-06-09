import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
let redirects = '';
let dropped = {};
try { dropped = JSON.parse(readFileSync(fileURLToPath(new URL('../.cache/dropped.json', import.meta.url)), 'utf-8')); } catch {}
let dn = 0;
for (const [slug, target] of Object.entries(dropped)) { redirects += `/produs/${slug}/ ${target} 301\n`; redirects += `/produs/${slug} ${target} 301\n`; dn++; }
writeFileSync(fileURLToPath(new URL('../public/_redirects', import.meta.url)), redirects);
console.log(`_redirects: ${dn} dropped 301s`);
let recs = [];
try { recs = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/electrocasnice.json', import.meta.url)), 'utf-8')); } catch {}
const map = {};
for (const p of recs) for (const o of (p.offers || [])) if (o.outKey && o.affiliate && !map[o.outKey]) map[o.outKey] = o.affiliate;
mkdirSync(fileURLToPath(new URL('../functions/out', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../functions/out/[slug].js', import.meta.url)),
`const MAP = ${JSON.stringify(map)};
export function onRequest(context){const url=MAP[context.params.slug];if(url)return Response.redirect(url,302);return Response.redirect(new URL('/electrocasnice/',context.request.url).toString(),302);}
`);
console.log(`functions/out: ${Object.keys(map).length} keys`);
