#!/usr/bin/env node

/**
 * Auto-generate articles script for electrocasnice1.ro
 * - Reads keywords from keywords.json
 * - Generates 1 article per run, rotating categories daily
 * - Updates keywords.json (moves to completed)
 * - Runs build and deploy
 * - Stops when no more keywords
 */

import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectDir = path.join(__dirname, '..');

// Load .env file manually
async function loadEnv() {
  try {
    const envPath = path.join(projectDir, '.env');
    const content = await fs.readFile(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key.trim()] = valueParts.join('=').trim();
        }
      }
    }
  } catch (e) {}
}

await loadEnv();

const ARTICLES_PER_RUN = parseInt(process.env.ARTICLES_PER_RUN) || 1;
const KEYWORDS_FILE = path.join(projectDir, 'keywords.json');
const LOG_FILE = path.join(projectDir, 'generation.log');
const LAST_CATEGORY_FILE = path.join(projectDir, 'last-category.json');

async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(message);
  await fs.appendFile(LOG_FILE, logMessage);
}

const NODE_PATH = process.execPath;
const NODE_BIN_DIR = path.dirname(NODE_PATH);
const NPM_PATH = path.join(NODE_BIN_DIR, 'npm');
const NPX_PATH = path.join(NODE_BIN_DIR, 'npx');

function runCommand(command, args, cwd) {
  let actualCommand = command;
  if (command === 'node') actualCommand = NODE_PATH;
  else if (command === 'npm') actualCommand = NPM_PATH;
  else if (command === 'npx') actualCommand = NPX_PATH;

  return new Promise((resolve, reject) => {
    const proc = spawn(actualCommand, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        PATH: `${NODE_BIN_DIR}:${process.env.PATH || ''}`
      }
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function getLastCategorySlug() {
  try {
    const content = await fs.readFile(LAST_CATEGORY_FILE, 'utf-8');
    return JSON.parse(content).lastCategorySlug || null;
  } catch (e) { return null; }
}

async function saveLastCategorySlug(slug) {
  await fs.writeFile(LAST_CATEGORY_FILE, JSON.stringify({ lastCategorySlug: slug }, null, 2));
}

async function selectFromDifferentCategories(keywords, count) {
  const byCategory = {};
  for (const kw of keywords) {
    const cat = kw.categorySlug;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(kw);
  }

  const categories = Object.keys(byCategory).sort();
  if (categories.length === 0) return [];

  const lastSlug = await getLastCategorySlug();
  let startIndex = 0;
  if (lastSlug) {
    const lastIndex = categories.indexOf(lastSlug);
    if (lastIndex !== -1) startIndex = (lastIndex + 1) % categories.length;
  }

  const selected = [];
  let catIndex = startIndex;
  let attempts = 0;

  while (selected.length < count && attempts < categories.length) {
    const cat = categories[catIndex % categories.length];
    const catKeywords = byCategory[cat];
    if (catKeywords && catKeywords.length > 0) {
      selected.push(catKeywords.shift());
      await saveLastCategorySlug(cat);
    }
    catIndex++;
    attempts++;
  }

  return selected;
}

function shouldRunToday(keywordsPath) {
  try {
    const keywordsData = JSON.parse(readFileSync(keywordsPath, 'utf-8'));
    const completed = keywordsData.completed || [];
    if (completed.length === 0) return true;

    let lastDate = null;
    for (const item of completed) {
      const d = item.date || item.pubDate;
      if (d) {
        const parsed = new Date(d);
        if (!lastDate || parsed > lastDate) lastDate = parsed;
      }
    }

    if (!lastDate) return true;
    const daysSinceLast = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < 0.5) return false;
    return true;
  } catch (e) { return true; }
}

async function generateStats() {
  const pagesDir = path.join(projectDir, 'src', 'pages');
  const publicDir = path.join(projectDir, 'public');
  const excludePages = new Set(['index', 'contact', 'cookies', 'privacy-policy', 'privacy', 'gdpr', 'sitemap', '404', 'about', 'terms', 'disclaimer-afiliere', 'politica-cookies', 'politica-de-confidentialitate', 'politica-confidentialitate', 'termeni-si-conditii']);

  const files = await fs.readdir(pagesDir);
  const articles = files.filter(f => {
    if (!f.endsWith('.astro')) return false;
    const name = f.replace('.astro', '');
    if (name.startsWith('[')) return false;
    if (excludePages.has(name)) return false;
    return true;
  });

  const stats = { articlesCount: articles.length, lastUpdated: new Date().toISOString() };
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'stats.json'), JSON.stringify(stats, null, 2));
  await log(`Stats generated: ${articles.length} articles`);
}

function generateImagePrompt(keyword, category) {
  const basePrompts = {
    'Masini de Spalat Rufe': 'Ultra-realistic photo of modern washing machine in a clean bright laundry room, soft natural lighting, professional product photography, no people, neutral background',
    'Frigidere si Combine': 'Ultra-realistic photo of modern stainless steel refrigerator in a contemporary kitchen, bright ambient lighting, professional product photography, no people',
    'Cuptoare si Aragazuri': 'Ultra-realistic photo of modern built-in oven in an elegant kitchen, warm ambient lighting, professional product photography, no people',
    'Aspiratoare': 'Ultra-realistic photo of modern vacuum cleaner on hardwood floor, bright room, professional product photography, no people, clean setting',
    'Masini de Spalat Vase': 'Ultra-realistic photo of modern dishwasher in a contemporary kitchen, clean lines, soft lighting, professional photography, no people',
    'Electrocasnice Mici': 'Ultra-realistic photo of modern kitchen appliance on clean countertop, bright natural lighting, professional product photography, no people',
  };
  const base = basePrompts[category] || basePrompts['Masini de Spalat Rufe'];
  return `${keyword} - ${base}`;
}

async function main() {
  await log('='.repeat(60));
  await log('AUTO-GENERATE STARTED');
  await log('='.repeat(60));

  if (!shouldRunToday(KEYWORDS_FILE)) {
    await log('Last article was less than 12 hours ago. Skipping.');
    return;
  }

  // Random delay 0-20 minutes
  const delayMs = Math.floor(Math.random() * 20 * 60 * 1000);
  const delayMin = Math.round(delayMs / 60000);
  await log(`Random delay: ${delayMin} minutes`);
  await new Promise(r => setTimeout(r, delayMs));

  let keywordsData;
  try {
    const content = await fs.readFile(KEYWORDS_FILE, 'utf-8');
    keywordsData = JSON.parse(content);
  } catch (error) {
    await log(`ERROR: Could not read keywords.json: ${error.message}`);
    process.exit(1);
  }

  const pendingKeywords = keywordsData.pending || [];
  if (pendingKeywords.length === 0) {
    await log('No more keywords to process. Stopping.');
    process.exit(0);
  }

  await log(`Pending keywords: ${pendingKeywords.length}`);
  await log(`Will generate: ${Math.min(ARTICLES_PER_RUN, pendingKeywords.length)} articles`);

  const toProcess = await selectFromDifferentCategories([...pendingKeywords], Math.min(ARTICLES_PER_RUN, pendingKeywords.length));
  await log(`Selected: ${toProcess.map(k => `${k.keyword} (${k.category})`).join(', ')}`);

  const articlesToGenerate = toProcess.map(kw => ({
    category: kw.category,
    categorySlug: kw.categorySlug,
    keyword: kw.keyword,
    imagePrompt: generateImagePrompt(kw.keyword, kw.category)
  }));

  const tempConfigPath = path.join(projectDir, 'scripts', 'temp-articles.json');
  await fs.writeFile(tempConfigPath, JSON.stringify(articlesToGenerate, null, 2));

  await log('Generating articles...');

  try {
    await runCommand('node', ['scripts/generate-batch.js'], projectDir);
    await log('Articles generated successfully');
  } catch (error) {
    await log(`ERROR generating articles: ${error.message}`);
    process.exit(1);
  }

  const successfulKeywordsPath = path.join(projectDir, 'scripts', 'successful-keywords.json');
  let successfulKeywords = [];
  try {
    const successContent = await fs.readFile(successfulKeywordsPath, 'utf-8');
    successfulKeywords = JSON.parse(successContent);
  } catch (e) {
    await log('Warning: Could not read successful-keywords.json');
  }

  const successfulToProcess = toProcess.filter(kw => successfulKeywords.includes(kw.keyword));
  const failedToProcess = toProcess.filter(kw => !successfulKeywords.includes(kw.keyword));

  const processedKeywordNames = toProcess.map(k => k.keyword);
  keywordsData.pending = [...pendingKeywords.filter(kw => !processedKeywordNames.includes(kw.keyword)), ...failedToProcess];
  keywordsData.completed = [...(keywordsData.completed || []), ...successfulToProcess];
  await fs.writeFile(KEYWORDS_FILE, JSON.stringify(keywordsData, null, 2));
  await log(`Keywords updated. Generated: ${successfulToProcess.length}, Failed: ${failedToProcess.length}, Remaining: ${keywordsData.pending.length}`);

  if (successfulToProcess.length === 0) {
    await log('No articles generated successfully. Skipping build and deploy.');
    try {
      await fs.unlink(tempConfigPath);
      await fs.unlink(successfulKeywordsPath);
    } catch (e) {}
    return;
  }

  await generateStats();

  await log('Building site...');
  try {
    await runCommand('npm', ['run', 'build'], projectDir);
    await log('Build completed');
  } catch (error) {
    await log(`ERROR building: ${error.message}`);
    process.exit(1);
  }

  // Generate WordPress-style sitemaps
  try {
    await runCommand('node', ['scripts/generate-sitemaps.js'], projectDir);
    await log('Sitemaps generated');
  } catch (error) {
    await log(`Warning: sitemaps generation failed: ${error.message}`);
  }

  // Deploy to Cloudflare (with retry)
  const projectName = process.env.CLOUDFLARE_PROJECT_NAME || 'electrocasnice1-ro';
  const MAX_DEPLOY_RETRIES = 3;
  let deploySuccess = false;
  for (let attempt = 1; attempt <= MAX_DEPLOY_RETRIES; attempt++) {
    await log(`Deploying to Cloudflare (project: ${projectName})... attempt ${attempt}/${MAX_DEPLOY_RETRIES}`);
    try {
      await runCommand('npx', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', projectName, '--branch', 'main'], projectDir);
      await log('Deploy completed');
      deploySuccess = true;
      break;
    } catch (error) {
      await log(`Deploy attempt ${attempt} failed: ${error.message}`);
      if (attempt < MAX_DEPLOY_RETRIES) {
        const waitSec = attempt * 30;
        await log(`Waiting ${waitSec}s before retry...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }
  if (!deploySuccess) {
    await log('ERROR: All deploy attempts failed');
    process.exit(1);
  }

  try {
    await fs.unlink(tempConfigPath);
    await fs.unlink(successfulKeywordsPath);
  } catch (e) {}

  await log('='.repeat(60));
  await log('AUTO-GENERATE COMPLETED SUCCESSFULLY');
  await log(`Remaining keywords: ${keywordsData.pending.length}`);
  await log('='.repeat(60));
}

main().catch(async (error) => {
  await log(`FATAL ERROR: ${error.message}`);
  process.exit(1);
});
