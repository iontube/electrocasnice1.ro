import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// 20 Gemini API Keys (rotated)
const GEMINI_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').filter(Boolean);

const keyState = GEMINI_KEYS.map((key, i) => ({
  key, index: i, lastUsed: 0, cooldownUntil: 0, dailyCount: 0,
}));

const MIN_GAP_MS = 5000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function acquireKey() {
  const maxWait = 120_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const now = Date.now();
    let bestKey = null;
    let bestTime = Infinity;
    for (const k of keyState) {
      const nextAt = Math.max(k.cooldownUntil, k.lastUsed + MIN_GAP_MS);
      if (nextAt < bestTime) { bestTime = nextAt; bestKey = k; }
    }
    if (!bestKey) throw new Error('No keys available');
    const waitMs = Math.max(0, bestTime - now);
    if (waitMs === 0) return bestKey;
    await sleep(Math.min(waitMs + 50, 10_000));
  }
  throw new Error('Timeout waiting for available key');
}

async function callGemini(prompt, maxRetries = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 40000,
            topP: 0.95,
            topK: 40,
            responseMimeType: "application/json"
          }
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty response');
        ks.lastUsed = Date.now();
        ks.dailyCount++;
        return text;
      }
      const errorBody = await response.text();
      if (response.status === 429) {
        let cooldownMs = 60_000;
        try {
          const errData = JSON.parse(errorBody);
          const retryInfo = errData?.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
          if (retryInfo?.retryDelay) {
            const sec = parseFloat(retryInfo.retryDelay);
            if (!isNaN(sec) && sec > 0) cooldownMs = sec * 1000;
          }
        } catch {}
        ks.cooldownUntil = Date.now() + cooldownMs + 2000;
        console.log(`  Key ${ks.index} rate limited, cooldown ${Math.ceil(cooldownMs/1000)}s`);
        continue;
      }
      if (response.status >= 500) {
        ks.cooldownUntil = Date.now() + 10_000;
        await sleep(2000);
        continue;
      }
      throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
    } catch (error) {
      if (error.message.startsWith('API ')) throw error;
      lastError = error;
      ks.cooldownUntil = Date.now() + 5000;
      await sleep(1000);
    }
  }
  throw lastError || new Error('Max retries exhausted');
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function escapeForHtml(str) { return (str || '').replace(/"/g, '&quot;'); }
function stripStrong(str) { return str.replace(/<\/?strong>/g, ''); }

function stripFakeLinks(html, pagesDir) {
  return html.replace(/<a\s+href="\/([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (match, linkPath, text) => {
    const slug = linkPath.replace(/\/$/, '');
    if (fs.existsSync(path.join(pagesDir, `${slug}.astro`))) return match;
    if (fs.existsSync(path.join(pagesDir, slug))) return match;
    return text;
  });
}

function markdownToHtml(text) {
  if (!text) return text;
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/^\*\s+/gm, '');
  text = text.replace(/^-\s+/gm, '');
  return text;
}

// Strip AI clichés
const stripCliches = (html) => {
  if (!html) return html;
  const replacements = [
    // Filler connectors
    [/\bDe asemenea,?\s*/gi, ''],
    [/\bIn plus,?\s*/gi, ''],
    [/\bPrin urmare,?\s*/gi, ''],
    [/\bTotodata,?\s*/gi, ''],
    [/\bAsadar,?\s*/gi, ''],
    [/\bCu toate acestea,?\s*/gi, ''],
    [/\bNu in ultimul rand,?\s*/gi, ''],
    [/\bIn concluzie,?\s*/gi, ''],
    [/\bEste important de mentionat ca\s*/gi, ''],
    [/\bIn era actuala,?\s*/gi, ''],
    [/\bFara indoiala,?\s*/gi, ''],
    // AI verb constructions
    [/\bbeneficiaza de\b/gi, 'are'],
    [/\bdispune de\b/gi, 'are'],
    [/\bcontribuie la\b/gi, 'ajuta la'],
    [/\bse traduce prin\b/gi, 'inseamna'],
    [/\bse traduce in\b/gi, 'inseamna'],
    [/\bse pozitioneaza ca\b/gi, 'este'],
    [/\bse plaseaza ca\b/gi, 'este'],
    [/\bse distinge prin\b/gi, 'are'],
    [/\bse impune ca\b/gi, 'este'],
    [/\bse remarca prin\b/gi, 'are'],
    [/\bvine echipat cu\b/gi, 'are'],
    [/\bvine echipata cu\b/gi, 'are'],
    [/\bpromitand\b/gi, 'cu'],
    [/\beste proiectat(a)? sa\b/gi, 'poate'],
    [/\bEste proiectata?\b/gi, 'Poate'],
    [/\bcontribuie semnificativ\b/gi, 'ajuta'],
    [/\bun accent puternic pe\b/gi, 'accent pe'],
    [/\bse adreseaza celor care\b/gi, 'e pentru cei care'],
    [/\bse adreseaza\b/gi, 'e pentru'],
    // AI adjectives and phrases
    [/\bo optiune viabila\b/gi, 'o varianta'],
    [/\bo optiune solida\b/gi, 'o varianta buna'],
    [/\bo optiune excelenta\b/gi, 'o varianta buna'],
    [/\bo solutie (eficienta|buna|excelenta)\b/gi, 'o varianta buna'],
    [/\bo alegere excelenta\b/gi, 'o varianta buna'],
    [/\beste o caracteristica esentiala\b/gi, 'conteaza'],
    [/\bremarcabil(a|e)?\b/gi, 'bun'],
    [/\bexceptional(a|e)?\b/gi, 'foarte bun'],
    [/\brevolutionar(a|e)?\b/gi, 'nou'],
    [/\binovativ(a|e)?\b/gi, 'modern'],
    [/\beste esential(a)?\b/gi, 'conteaza'],
    [/\beste crucial(a)?\b/gi, 'conteaza'],
  ];
  for (const [pattern, replacement] of replacements) {
    html = html.replace(pattern, replacement);
  }
  // Fix double spaces
  html = html.replace(/\s{2,}/g, ' ');
  // Fix sentence starts after removal (capitalize)
  html = html.replace(/<p>\s*([a-z])/g, (_, c) => `<p>${c.toUpperCase()}`);
  return html;
};

// Cloudflare Workers AI for image generation
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || '3f7b83a7856f44ddf6ed4ae3b3505ff3';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || 'Iskkfs2zWth2x8rmC50QFotFc81Jme2vqKkryCdU';

async function translateToEnglish(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      ks.lastUsed = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Translate the following Romanian text to English. Return ONLY the English translation, nothing else:\n\n${text}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 200 }
        })
      });
      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text.trim();
      }
    } catch (error) {
      console.error(`  Translation attempt ${attempt + 1} error: ${error.message}`);
    }
    await sleep(2000);
  }
  return text;
}

function stripBrands(text) {
  return text.replace(/\b[A-Z][a-z]+[A-Z]\w*/g, '').replace(/\b[A-Z]{2,}\b/g, '').replace(/\s{2,}/g, ' ').trim();
}

async function rephraseWithoutBrands(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      ks.lastUsed = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Rephrase the following into a short, generic English description for an image prompt. Remove ALL brand names, trademarks, product names. Replace them with generic descriptions. Return ONLY the rephrased text.\n\nExample: "Samsung washing machine 10kg" -> "modern front-loading washing machine"\nExample: "Best budget refrigerator" -> "affordable modern refrigerator in kitchen"\n\nText: "${text}"` }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 100 }
        })
      });
      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        const result = data.candidates[0].content.parts[0].text.trim();
        console.log(`  Rephrased prompt: ${result}`);
        return result;
      }
    } catch (error) {
      console.error(`  Rephrase attempt ${attempt + 1} error: ${error.message}`);
    }
    if (attempt < 2) await sleep(2000);
  }
  return stripBrands(text);
}

async function generateSafePrompt(text, categorySlug) {
  const categoryFallbacks = {
    'masini-de-spalat': 'modern front-loading washing machine in a clean bright laundry room, soft natural lighting',
    'frigidere': 'modern stainless steel refrigerator in a bright contemporary kitchen, soft lighting',
    'cuptoare-aragazuri': 'modern built-in oven and stove in an elegant kitchen, warm ambient lighting',
    'aspiratoare': 'modern vacuum cleaner on a clean hardwood floor, bright room, product photography',
    'masini-spalat-vase': 'modern built-in dishwasher in a contemporary kitchen, clean lines, soft lighting',
    'electrocasnice-mici': 'modern kitchen countertop with small appliances, bright clean setting, product photography',
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const ks = await acquireKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${ks.key}`;
    try {
      ks.lastUsed = Date.now();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Create a short, safe English image prompt for a stock photo related to this home appliance topic: "${text}". Describe ONLY objects and scenery. NEVER mention people, faces, hands, or body parts. NEVER use brand names. Focus on the appliance in a home setting. Return ONLY the description.` }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
        })
      });
      const data = await response.json();
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        return data.candidates[0].content.parts[0].text.trim();
      }
    } catch (error) {
      console.error(`  Safe prompt attempt ${attempt + 1} error: ${error.message}`);
    }
    if (attempt < 2) await sleep(2000);
  }
  return categoryFallbacks[categorySlug] || categoryFallbacks['masini-de-spalat'];
}

async function generateArticleImage(keyword, category, categorySlug) {
  const slug = slugify(keyword);
  const imagesDir = path.join(rootDir, 'public', 'images', 'articles');
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const outputPath = path.join(imagesDir, `${slug}.webp`);
  if (fs.existsSync(outputPath)) {
    console.log(`  Image already exists: ${slug}.webp`);
    return `/images/articles/${slug}.webp`;
  }

  console.log(`  Generating image for: ${keyword}`);

  const categoryPrompts = {
    'masini-de-spalat': 'in a clean bright laundry room, soft natural lighting, modern interior design',
    'frigidere': 'in a bright contemporary kitchen, soft lighting, clean modern design',
    'cuptoare-aragazuri': 'in an elegant modern kitchen, warm ambient lighting, professional setting',
    'aspiratoare': 'on a clean hardwood floor, bright living room, professional product photography',
    'masini-spalat-vase': 'in a modern kitchen with marble countertops, soft lighting, clean aesthetic',
    'electrocasnice-mici': 'on a clean kitchen countertop, bright natural lighting, minimalist setting',
  };

  const MAX_IMAGE_RETRIES = 4;
  let promptFlagged = false;

  for (let attempt = 1; attempt <= MAX_IMAGE_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`  Image retry attempt ${attempt}/${MAX_IMAGE_RETRIES}...`);
      await sleep(3000 * attempt);
    }
    try {
      let prompt;
      if (attempt >= 3) {
        const safeSubject = await generateSafePrompt(keyword, categorySlug);
        prompt = `Realistic photograph of ${safeSubject}, no text, no writing, no words, no letters, no numbers. Photorealistic, high quality, professional photography.`;
      } else {
        const titleEn = await translateToEnglish(keyword);
        console.log(`  Translated title: ${titleEn}`);
        const setting = categoryPrompts[categorySlug] || categoryPrompts['masini-de-spalat'];
        const subject = promptFlagged ? await rephraseWithoutBrands(titleEn) : titleEn;
        prompt = `Realistic photograph of ${subject} ${setting}, no text, no brand name, no writing, no words, no letters, no numbers. Photorealistic, high quality, professional product photography.`;
      }

      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('steps', '20');
      formData.append('width', '1024');
      formData.append('height', '768');

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-2-dev`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
          body: formData,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  Image API error: ${response.status} - ${errorText.slice(0, 200)}`);
        if (errorText.includes('flagged')) promptFlagged = true;
        continue;
      }

      const data = await response.json();
      if (!data.result?.image) {
        console.error('  No image in response');
        continue;
      }

      const imageBuffer = Buffer.from(data.result.image, 'base64');
      const sharp = (await import('sharp')).default;
      await sharp(imageBuffer)
        .resize(800, 600, { fit: 'cover' })
        .webp({ quality: 82, effort: 6 })
        .toFile(outputPath);

      const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(0);
      console.log(`  Image saved: ${slug}.webp (${sizeKB} KB)`);
      return `/images/articles/${slug}.webp`;

    } catch (error) {
      console.error(`  Image generation error: ${error.message}`);
      continue;
    }
  }

  console.error('  Image generation failed after all retries');
  return null;
}

function repairJSON(text) {
  text = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '').trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) text = jsonMatch[0];
  text = text.replace(/,\s*([}\]])/g, '$1');

  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === '\\') { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && ch === '\n') { result += '\\n'; continue; }
    if (inString && ch === '\r') { continue; }
    if (inString && ch === '\t') { result += '\\t'; continue; }
    result += ch;
  }
  return result;
}

// Authors
const AUTHORS = [
  { name: 'Raluca Tanase', role: 'Redactor Electrocasnice', bio: 'Raluca scrie despre electrocasnice de peste 5 ani, cu accent pe masini de spalat si frigidere.', categories: ['masini-de-spalat'] },
  { name: 'Vlad Marinescu', role: 'Specialist Electrocasnice', bio: 'Vlad testeaza si compara electrocasnice pentru a gasi cele mai bune optiuni din piata romaneasca.', categories: ['cuptoare-aragazuri'] },
  { name: 'Ioana Preda', role: 'Expert Electrocasnice Mici', bio: 'Ioana acopera segmentul de electrocasnice mici si masini de spalat vase, cu focus pe raportul calitate-pret.', categories: ['electrocasnice-mici'] },
  { name: 'Andrei Popescu', role: 'Analist Frigidere', bio: 'Andrei analizeaza piata de frigidere si combine frigorifice, comparand modele pe eficienta si pret.', categories: ['frigidere'] },
  { name: 'Elena Dumitrescu', role: 'Redactor Aspiratoare', bio: 'Elena testeaza aspiratoare de toate tipurile si scrie ghiduri de cumparare bazate pe experienta reala.', categories: ['aspiratoare'] },
  { name: 'Mihai Stoica', role: 'Expert Masini de Spalat Vase', bio: 'Mihai compara masini de spalat vase si ajuta cititorii sa aleaga modelul potrivit pentru bucataria lor.', categories: ['masini-spalat-vase'] },
];

async function generateArticleContent(keyword, category) {
  const prompt = `Scrii articole pe un site romanesc de review-uri electrocasnice. Stilul e informativ si directionat spre conversie - ajuti cititorul sa ia o decizie de cumparare. NU esti un AI.

Keyword: "${keyword}"
Categorie: "${category}"

GENEREAZA un articol complet in format JSON. Fara diacritice. Minim 2000 cuvinte.

=== TONUL SI STILUL (CRITIC) ===
Tonul e informativ-conversional, NU personal/jurnal. Scopul e sa raspunzi la intentia de cautare si sa ghidezi spre cumparare.

INTRO:
- Primul paragraf RASPUNDE DIRECT la intentia din keyword. Daca cineva cauta "${keyword}", ce vrea sa afle? Raspunde-i imediat.
- Exemplu bun: "Cea mai buna masina de spalat rufe sub 1500 lei este Arctic APL81223XLW3, cu capacitate de 8 kg, 1200 rpm si clasa A la un pret de ~1300 lei. Dar alegerea depinde de capacitate, viteza de centrifugare si functii."
- Exemplu prost: "Daca iti doresti sa gasesti cea mai buna masina de spalat, ai ajuns unde trebuie. Piata e plina de optiuni..."
- Nu incepe cu anecdote, nu incepe cu "tu" sau "daca vrei". Incepe cu RASPUNSUL.

REVIEW-URI PRODUSE:
- Ton obiectiv dar accesibil - ca un review pe un site de electrocasnice, nu ca o poveste
- Translatezi specs in beneficii practice: "1400 rpm inseamna haine mai putin umede la iesirea din masina"
- Compari cu alternative directe: "fata de Beko, are consum mai mic dar capacitate mai mica"
- Preturi concrete in lei
- Review-ul include pentru cine e potrivit si se incheie cu o recomandare clara
- NU exagera cu "am testat personal" - maximum 1-2 referinte in tot articolul
- Tonul e de expert care informeaza

CONVERSIE:
- Ghideaza spre decizie: "daca prioritizezi consumul mic, alege X; daca vrei capacitate mare, alege Y"
- Mentioneaza pretul si unde se gaseste ("disponibil la ~1300 lei in magazinele online din Romania")
- Concluzia fiecarui review sa fie actionabila

=== ANTI-AI ===
- CUVINTE INTERZISE: "Asadar", "De asemenea", "Cu toate acestea", "Este important de mentionat", "Nu in ultimul rand", "in era actuala", "descopera", "fara indoiala", "in concluzie", "este esential", "este crucial", "o alegere excelenta", "ghid", "ghiduri", "exploreaza", "aprofundam", "remarcabil", "exceptional", "revolutionar", "inovativ", "vom detalia", "vom analiza", "vom explora", "vom prezenta", "in cele ce urmeaza", "in continuare vom", "sa aruncam o privire", "buget optimizat", "alegerea editorului", "editor's choice", "beneficiaza de", "se traduce prin", "se pozitioneaza ca", "vine echipat cu", "promitand", "contribuie semnificativ"
- TAG-URI INTERZISE: "Buget Optimizat", "Alegerea Editorului" - suna a cliseu
- Amesteca paragrafe scurte (1-2 prop) cu medii (3-4 prop)
- Critici oneste: fiecare produs minim 3-4 dezavantaje reale
- Limbaj natural dar nu excesiv informal

=== PARAGRAFE CU INTREBARI (IMPORTANT PENTRU AI SEARCH) ===
Multe paragrafe trebuie sa inceapa cu o INTREBARE directa urmata de raspuns.
- In intro: minim 1 paragraf care incepe cu intrebare
- In review-uri: minim 1 paragraf per review care incepe cu intrebare (ex: "Cat consuma in realitate?", "Merita functia de uscare?")
- In sfaturi: fiecare h3 sa fie intrebare
- Exemplu bun: "Cat consuma o masina de spalat de 8 kg pe un ciclu de spalare? In medie, un model A+++ foloseste 45-50 kWh pe an, adica sub 1 leu pe spalare."

=== STRUCTURA JSON ===
IMPORTANT: Returneaza DOAR JSON valid. Fara markdown, fara backticks.

{
  "intro": "2-3 paragrafe HTML (<p>). PRIMUL PARAGRAF raspunde direct la intentia de cautare. Paragrafele urmatoare detaliaza criteriile si contextul.",
  "products": [
    {
      "name": "Numele complet al produsului",
      "tag": "Best Buy 2026",
      "specs": {
        "capacitate": "ex: 8 kg / 340 litri / 1800W",
        "clasa energetica": "ex: A / B / C",
        "nivel zgomot": "ex: 52 dB(A) spalare / 76 dB(A) centrifugare",
        "consum": "ex: 52 kWh/an / 0.8 kWh/ciclu",
        "dimensiuni": "ex: 60 x 85 x 55 cm",
        "functii": "ex: Steam / Quick Wash / Delay Start"
      },
      "review": "4-6 paragrafe HTML (<p>). Review obiectiv: ce face bine, ce face prost, comparat cu ce, pentru cine, la ce pret.",
      "avantaje": ["avantaj 1", "avantaj 2", "avantaj 3", "avantaj 4", "avantaj 5"],
      "dezavantaje": ["dezavantaj 1", "dezavantaj 2", "dezavantaj 3", "dezavantaj 4"]
    }
  ],
  "comparison": {
    "intro": "1 paragraf introductiv",
    "rows": [
      {
        "model": "Numele modelului",
        "capacitate": "scurt",
        "clasaEnergetica": "scurt",
        "consum": "scurt",
        "pret": "~X lei",
        "potrivitPentru": "3-5 cuvinte"
      }
    ]
  },
  "guide": {
    "title": "Titlu ca intrebare (ex: Cum alegi masina de spalat potrivita?)",
    "content": "3-5 paragrafe HTML (<p>, <h3>, <p>) cu sfaturi de cumparare."
  },
  "faq": [
    {
      "question": "Intrebare naturala de cautare Google",
      "answer": "Raspuns direct 40-70 cuvinte cu cifre concrete."
    }
  ]
}

=== CERINTE PRODUSE ===
- 5-7 produse relevante pentru "${keyword}", ordonate dupa relevanta
- Specs REALE si CORECTE - branduri reale din Romania (Arctic, Beko, Samsung, LG, Bosch, Electrolux, Whirlpool, Gorenje, Indesit, Candy, Tefal, Philips, Rowenta, De'Longhi, Dyson, Liebherr)
- Preturi realiste in lei, Romania 2026
- Review minim 200 cuvinte per produs
- Avantaje: 4-6 | Dezavantaje: 3-5 (oneste, nu cosmetice)
- Tag-uri: "Best Buy 2026", "Raport Calitate-Pret", "Premium", "Pentru Buget Mic", "Alegerea Noastra", "Cel Mai Silentios", "Eficienta Maxima", "Cel Mai Vandut"

=== CERINTE FAQ ===
- 5 intrebari formulari naturale
- Raspunsuri cu cifre concrete, auto-suficiente, fara diacritice

=== REGULI ===
- FARA diacritice (fara ă, î, ș, ț, â)
- Preturile in LEI, realiste
- Keyword "${keyword}" in <strong> de 4-6 ori in articol
- NICIODATA <strong> in titluri/headings
- Total minim 2000 cuvinte`;

  let retries = 7;
  while (retries > 0) {
    try {
      let text = await callGemini(prompt);
      text = text.trim();
      try {
        const parsed = JSON.parse(text);
        if (parsed.intro && parsed.products && parsed.products.length > 0 && parsed.faq) return parsed;
        console.error('  Invalid JSON structure, retrying...');
      } catch (parseError) {
        console.error(`  JSON parse error: ${parseError.message.substring(0, 100)}`);
        try {
          const repaired = repairJSON(text);
          const parsed = JSON.parse(repaired);
          if (parsed.intro && parsed.products && parsed.products.length > 0 && parsed.faq) return parsed;
        } catch {}
      }
      retries--;
      await sleep(2000);
    } catch (error) {
      console.error(`  API error: ${error.message?.substring(0, 100)}, retrying...`);
      retries--;
      await sleep(2000);
    }
  }
  throw new Error('Failed to generate content after retries');
}

function createArticlePage(keyword, content, category, categorySlug, author, pubDate) {
  const slug = slugify(keyword);
  const title = capitalizeFirst(keyword);
  const date = pubDate || new Date().toISOString();
  const modified = new Date().toISOString();

  function cleanHtml(text) {
    if (!text) return '';
    text = markdownToHtml(text);
    if (!text.includes('<p>') && !text.includes('<h')) {
      text = text.split(/\n\n+/).filter(p => p.trim()).map(p => `<p>${p.trim()}</p>`).join('\n');
    }
    return stripCliches(text);
  }

  const introHtml = cleanHtml(content.intro || '');
  const firstPMatch = introHtml.match(/<p>([\s\S]*?)<\/p>/);
  let excerpt = firstPMatch ? firstPMatch[1].replace(/<[^>]*>/g, '').replace(/\*\*/g, '') : '';
  if (excerpt.length > 300) {
    const sentences = excerpt.match(/[^.!?]+[.!?]+/g) || [excerpt];
    excerpt = sentences.slice(0, 2).join('').trim();
  }

  const productReviewsHtml = (content.products || []).map((product) => {
    const productId = slugify(product.name);
    const specs = product.specs || {};
    const specsHtml = Object.entries(specs).map(([key, val]) =>
      `              <span><strong>${capitalizeFirst(key)}:</strong> ${val}</span>`
    ).join('\n');

    const reviewContent = cleanHtml(product.review || '');
    const avantajeHtml = (product.avantaje || []).map(a => `              <li>${markdownToHtml(a)}</li>`).join('\n');
    const dezavantajeHtml = (product.dezavantaje || []).map(d => `              <li>${markdownToHtml(d)}</li>`).join('\n');
    const tag = product.tag || '';

    return `
          <div data-review id="${productId}">
            ${tag ? `<span data-tag>${tag}</span>` : ''}
            <h2>${product.name}</h2>
            <div data-specs>
${specsHtml}
            </div>
            ${reviewContent}
            <div data-pros-cons>
              <div>
                <h4 class="pros-title">Avantaje</h4>
                <ul data-pros>
${avantajeHtml}
                </ul>
              </div>
              <div>
                <h4 class="cons-title">Dezavantaje</h4>
                <ul data-cons>
${dezavantajeHtml}
                </ul>
              </div>
            </div>
          </div>`;
  }).join('\n');

  let comparisonHtml = '';
  if (content.comparison && content.comparison.rows && content.comparison.rows.length > 0) {
    const compIntro = cleanHtml(content.comparison.intro || '');
    const compRows = content.comparison.rows.map(row => `
              <tr>
                <td><strong>${row.model}</strong></td>
                <td>${row.capacitate || ''}</td>
                <td>${row.clasaEnergetica || ''}</td>
                <td>${row.consum || ''}</td>
                <td>${row.pret || ''}</td>
                <td>${row.potrivitPentru || ''}</td>
              </tr>`).join('\n');

    comparisonHtml = `
          <div data-comparison id="comparatie">
            <h2>Comparatie</h2>
            ${compIntro}
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Capacitate</th>
                    <th>Clasa</th>
                    <th>Consum</th>
                    <th>Pret</th>
                    <th>Potrivit pentru</th>
                  </tr>
                </thead>
                <tbody>
${compRows}
                </tbody>
              </table>
            </div>
          </div>`;
  }

  let guideHtml = '';
  if (content.guide) {
    const guideTitle = content.guide.title || 'Sfaturi de cumparare';
    const guideContent = cleanHtml(content.guide.content || '');
    guideHtml = `
          <div data-guide id="sfaturi">
            <h2>${stripStrong(guideTitle)}</h2>
            ${guideContent}
          </div>`;
  }

  const faqHtml = (content.faq || []).map((item, index) => `
            <details id="faq-${index}">
              <summary>${stripStrong(markdownToHtml(item.question))}</summary>
              <div class="faq-answer">${stripStrong(markdownToHtml(item.answer))}</div>
            </details>`).join('\n');

  const faqArray = (content.faq || []).map(item =>
    `{ question: "${stripStrong(item.question).replace(/"/g, '\\"')}", answer: "${stripStrong(item.answer).replace(/"/g, '\\"').replace(/\n/g, ' ')}" }`
  );

  const tocEntries = [];
  (content.products || []).forEach(p => {
    tocEntries.push({ title: p.name, id: slugify(p.name) });
  });
  if (comparisonHtml) tocEntries.push({ title: 'Comparatie', id: 'comparatie' });
  if (guideHtml) tocEntries.push({ title: content.guide?.title || 'Sfaturi de cumparare', id: 'sfaturi' });
  tocEntries.push({ title: 'Intrebari Frecvente', id: 'faq' });

  const tocItems = tocEntries.map(t =>
    `{ title: "${t.title.replace(/"/g, '\\"')}", id: "${t.id}" }`
  );

  const pubDateDisplay = new Date(date).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' });
  const modifiedDateDisplay = new Date(modified).toLocaleDateString('ro-RO', { year: 'numeric', month: 'long', day: 'numeric' });

  let pageContent = `---
import Layout from '../layouts/Layout.astro';
import SimilarArticles from '../components/SimilarArticles.astro';
import PrevNextNav from '../components/PrevNextNav.astro';
import keywordsData from '../../keywords.json';

export const frontmatter = {
  title: "${title.replace(/"/g, '\\"')}",
  slug: "${slug}",
  excerpt: "${excerpt.replace(/"/g, '\\"')}",
  image: "/images/articles/${slug}.webp",
  category: "${category}",
  categorySlug: "${categorySlug}",
  date: "${date}",
  modifiedDate: "${modified}",
  author: "${author.name}",
  authorRole: "${author.role}",
  authorBio: "${author.bio.replace(/"/g, '\\"')}"
};

const breadcrumbs = [
  { name: "Acasa", url: "/" },
  { name: "${category}", url: "/${categorySlug}/" },
  { name: "${title.replace(/"/g, '\\"')}", url: "/${slug}/" }
];

const faq = [
  ${faqArray.join(',\n  ')}
];

const toc = [
  ${tocItems.join(',\n  ')}
];

const allArticles = keywordsData.completed.map(item => ({
  title: item.keyword.charAt(0).toUpperCase() + item.keyword.slice(1),
  slug: item.keyword.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  excerpt: item.excerpt || '',
  image: \`/images/articles/\${item.keyword.toLowerCase()
    .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
    .replace(/ș/g, 's').replace(/ț/g, 't')
    .replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.webp\`,
  category: item.category,
  categorySlug: item.categorySlug,
  date: item.date || new Date().toISOString()
}));
---

<Layout
  title="${escapeForHtml(title)} 2026 — Electrocasnice1.ro"
  description="${escapeForHtml(excerpt)}"
  image="/images/articles/${slug}.webp"
  type="article"
  publishedTime="${date}"
  modifiedTime="${modified}"
  author="${escapeForHtml(author.name)}"
  faqSchema={faq}
  breadcrumbs={breadcrumbs}
>
  <!-- Full-width hero image with overlay tag -->
  <div class="pin-article-hero">
    <img src="/images/articles/${slug}.webp" alt="${escapeForHtml(title)}" width="1200" height="600" decoding="async" fetchpriority="high" />
    <span class="pin-article-hero-tag" data-cat="${categorySlug}">${category}</span>
  </div>

  <!-- Article header — centered -->
  <div class="pin-article-header">
    <nav class="pin-article-crumbs" aria-label="Breadcrumbs">
      <a href="/">Acasa</a>
      <span>/</span>
      <a href="/${categorySlug}/">${category}</a>
      <span>/</span>
      <span>${title}</span>
    </nav>
    <h1>${title}</h1>
    <div class="pin-article-meta">
      <span class="pin-article-author">${author.name}</span>
      <span class="pin-article-sep">&middot;</span>
      <time>${pubDateDisplay}</time>
    </div>
  </div>

  <!-- Content — single centered column -->
  <article class="pin-article-body">
    <details class="pin-toc">
      <summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
        Cuprins
      </summary>
      <nav class="pin-toc-links">
        {toc.map(item => (
          <a href={\`#\${item.id}\`}>{item.title}</a>
        ))}
      </nav>
    </details>

    <div class="article-content" data-content>
      <section id="intro">
        ${introHtml}
      </section>

${productReviewsHtml}

${comparisonHtml}

${guideHtml}

      <div data-faq id="faq">
        <h2>Intrebari Frecvente</h2>
${faqHtml}
      </div>
    </div>

    <div class="pin-author-card">
      <div class="pin-author-avatar">${author.name.split(' ').map(n => n[0]).join('')}</div>
      <div>
        <div class="pin-author-name">${author.name}</div>
        <div class="pin-author-bio">${author.bio}</div>
      </div>
    </div>

    <PrevNextNav currentSlug="${slug}" articles={allArticles} />

    <SimilarArticles
      currentSlug="${slug}"
      currentCategory="${categorySlug}"
      articles={allArticles}
    />
  </article>

  <script>
    const tocDetails = document.querySelector('.pin-toc');
    tocDetails?.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        (tocDetails as HTMLDetailsElement).open = false;
      });
    });
  </script>
</Layout>
`;

  const outputPath = path.join(rootDir, 'src', 'pages', `${slug}.astro`);
  pageContent = stripFakeLinks(pageContent, path.join(rootDir, 'src', 'pages'));
  fs.writeFileSync(outputPath, pageContent);
  console.log(`  Article page created: ${outputPath}`);

  return { slug, title, excerpt, date, modifiedDate: modified };
}

// Main
async function main() {
  console.log('\n========================================');
  console.log('Electrocasnice1.ro - Article Generator');
  console.log('========================================\n');

  const keywordsPath = path.join(rootDir, 'keywords.json');
  const keywordsData = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));

  // Check for temp-articles.json (from auto-generate.js)
  const tempConfigPath = path.join(__dirname, 'temp-articles.json');
  let toProcess;

  if (fs.existsSync(tempConfigPath)) {
    const tempArticles = JSON.parse(fs.readFileSync(tempConfigPath, 'utf-8'));
    toProcess = tempArticles.map(a => ({
      keyword: a.keyword,
      category: a.category,
      categorySlug: a.categorySlug,
    }));
  } else {
    const limitArg = process.argv.find(a => a.startsWith('--limit='));
    const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 1;
    toProcess = keywordsData.pending.slice(0, limit);
  }

  if (toProcess.length === 0) {
    console.log('No keywords to process.');
    return;
  }

  console.log(`Processing ${toProcess.length} article(s)...\n`);

  const successfulKeywords = [];

  for (const item of toProcess) {
    console.log(`\nProcessing: ${item.keyword}`);
    console.log(`Category: ${item.category}`);

    try {
      const author = AUTHORS.find(a => a.categories.includes(item.categorySlug)) || AUTHORS[0];

      console.log('  Generating content...');
      const content = await generateArticleContent(item.keyword, item.category);
      console.log('  Content generated successfully');

      const articleData = createArticlePage(item.keyword, content, item.category, item.categorySlug, author);

      const skipImage = !process.env.CF_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN || process.env.SKIP_IMAGE === '1';
      if (!skipImage) {
        console.log('  Generating image...');
        await generateArticleImage(item.keyword, item.category, item.categorySlug);
      } else {
        console.log('  Skipping image generation (dev mode)');
      }

      successfulKeywords.push(item.keyword);
      console.log(`  Completed: ${item.keyword}`);
      await sleep(1000);

    } catch (error) {
      console.error(`  Failed: ${item.keyword} - ${error.message}`);
    }
  }

  // Write successful keywords for auto-generate.js
  const successfulPath = path.join(__dirname, 'successful-keywords.json');
  fs.writeFileSync(successfulPath, JSON.stringify(successfulKeywords, null, 2));

  // Update keywords.json if not using temp config
  if (!fs.existsSync(tempConfigPath) && successfulKeywords.length > 0) {
    const successSet = new Set(successfulKeywords);
    keywordsData.pending = keywordsData.pending.filter(k => !successSet.has(k.keyword));
    const completed = toProcess.filter(k => successSet.has(k.keyword)).map(k => ({
      ...k,
      date: new Date().toISOString(),
      modifiedDate: new Date().toISOString()
    }));
    keywordsData.completed = [...keywordsData.completed, ...completed];
    fs.writeFileSync(keywordsPath, JSON.stringify(keywordsData, null, 2));
  }

  console.log(`\n========================================`);
  console.log(`Total processed: ${successfulKeywords.length}/${toProcess.length}`);
  console.log('========================================\n');
}

main().catch(console.error);
