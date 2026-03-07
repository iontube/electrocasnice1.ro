import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const SITE_URL = 'https://electrocasnice1.ro';
const MAX_URLS_PER_SITEMAP = 200;

function slugify(text) {
  return text.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function generateSitemaps() {
  console.log('Generating sitemaps...');

  const keywordsPath = path.join(rootDir, 'keywords.json');
  const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
  const completed = keywordsData.completed || [];

  const articles = completed.map(item => ({
    slug: slugify(item.keyword),
    date: item.modifiedDate || item.date || new Date().toISOString(),
    image: `/images/articles/${slugify(item.keyword)}.webp`
  }));

  const postSitemaps = [];
  for (let i = 0; i < Math.max(1, Math.ceil(articles.length / MAX_URLS_PER_SITEMAP)); i++) {
    const chunk = articles.slice(i * MAX_URLS_PER_SITEMAP, (i + 1) * MAX_URLS_PER_SITEMAP);
    const filename = i === 0 ? 'post-sitemap.xml' : `post-sitemap${i + 1}.xml`;

    const urls = chunk.map(a => `  <url>
    <loc>${SITE_URL}/${a.slug}/</loc>
    <lastmod>${new Date(a.date).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>${a.image ? `
    <image:image>
      <image:loc>${SITE_URL}${a.image}</image:loc>
    </image:image>` : ''}
  </url>`).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;

    fs.writeFileSync(path.join(distDir, filename), xml);
    postSitemaps.push(filename);
    console.log(`  Created ${filename} (${chunk.length} URLs)`);
  }

  // Category sitemap
  const categories = ['masini-de-spalat', 'frigidere', 'cuptoare-aragazuri', 'aspiratoare', 'masini-spalat-vase', 'electrocasnice-mici'];
  const categoryUrls = categories.map(cat => `  <url>
    <loc>${SITE_URL}/${cat}/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n');

  const categorySitemap = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${SITE_URL}/blog/</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
${categoryUrls}
  <url>
    <loc>${SITE_URL}/contact/</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
</urlset>`;

  fs.writeFileSync(path.join(distDir, 'category-sitemap.xml'), categorySitemap);
  console.log(`  Created category-sitemap.xml`);

  // Sitemap index
  const now = new Date().toISOString();
  const sitemapEntries = [
    ...postSitemaps.map(f => `  <sitemap>
    <loc>${SITE_URL}/${f}</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`),
    `  <sitemap>
    <loc>${SITE_URL}/category-sitemap.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`
  ].join('\n');

  const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`;

  fs.writeFileSync(path.join(distDir, 'sitemap_index.xml'), sitemapIndex);
  console.log(`  Created sitemap_index.xml`);

  // XSL stylesheet
  const xsl = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:html="http://www.w3.org/TR/REC-html40"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <title>Sitemap - Electrocasnice1.ro</title>
        <style>body{font-family:'Overpass',sans-serif;max-width:1200px;margin:0 auto;padding:20px;background:#ffffff}h1{color:#18171c;font-family:'Space Grotesk',sans-serif}table{width:100%;border-collapse:collapse}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid #ebebeb}th{background:#f5f5f3;font-size:.85rem;color:#7a7a7a}a{color:#055a5b}</style>
      </head>
      <body>
        <h1>Sitemap</h1>
        <table>
          <tr><th>URL</th><th>Last Modified</th></tr>
          <xsl:for-each select="sitemap:urlset/sitemap:url">
            <tr>
              <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
              <td><xsl:value-of select="sitemap:lastmod"/></td>
            </tr>
          </xsl:for-each>
          <xsl:for-each select="sitemap:sitemapindex/sitemap:sitemap">
            <tr>
              <td><a href="{sitemap:loc}"><xsl:value-of select="sitemap:loc"/></a></td>
              <td><xsl:value-of select="sitemap:lastmod"/></td>
            </tr>
          </xsl:for-each>
        </table>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>`;

  fs.writeFileSync(path.join(distDir, 'sitemap.xsl'), xsl);
  console.log(`  Created sitemap.xsl`);

  console.log('\nSitemap generation complete!');
}

generateSitemaps();
