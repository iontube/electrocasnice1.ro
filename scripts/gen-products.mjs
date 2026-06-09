// Generate the appliances dataset from pretulverde.db. BROAD coverage (all home appliances across
// merchants), accessories/parts/consumables/furniture excluded. DEDUP across merchants -> one page per
// model+color, cheapest offer per merchant. Each product classified into OUR category taxonomy.
import Database from '/sites/pretulverde.ro/node_modules/better-sqlite3/lib/index.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = '/sites/pretulverde.ro/pretulverde.db';
const CAMPAIGN = JSON.parse(readFileSync('/sites/pretulverde.ro/_data/campaign.json', 'utf8'));
const AFF = '2ace29e87';
const IMG_HOST = 'https://img.electrocasnice1.ro';
const SITE_NAME = 'Electrocasnice1.ro';
const OUT = fileURLToPath(new URL('../src/data/electrocasnice.json', import.meta.url));

const db = new Database(DB, { readonly: true });
const APP_SUBS = ['aragazuri-si-cuptoare', 'aragazuri', 'plite', 'climatizare', 'aparate-de-aer-conditionat', 'aer-conditionat', 'masini-de-spalat', 'masini-de-spalat-rufe', 'masini-de-spalat-rufe-cu-uscator', 'masini-de-spalat-10-12-kg', 'masini-de-spalat-8-9-kg', 'masini-de-spalat-6-7-kg', 'masini-de-spalat-vase', 'uscatoare-de-rufe', 'frigidere', 'frigidere-si-congelatoare', 'frigider', 'congelatoare', 'mixere', 'blendere', 'blendere-si-tocatoare', 'aparate-si-espressoare-de-cafea-automate', 'cuptoare-cu-microunde', 'boilere', 'fierbatoare', 'prajitoare-de-paine', 'friteuze', 'air-fryer', 'sandwich-maker-and-waffle', 'hote', 'aspirator-umed-uscat', 'aspirator-vertical-stick', 'aspirator-fara-sac', 'aspiratoare', 'fiare-de-calcat', 'statii-de-calcat', 'masini-de-cusut', 'dezumidificator-casnic'];
const INQ = APP_SUBS.map((s) => `'${s}'`).join(',');
const TITLE = `(lower(title) LIKE '%frigider%' OR lower(title) LIKE '%combina frigorifica%' OR lower(title) LIKE '%congelator%' OR lower(title) LIKE '%masina de spalat%' OR lower(title) LIKE '%uscator de rufe%' OR lower(title) LIKE '%aspirator%' OR lower(title) LIKE '%cuptor%' OR lower(title) LIKE '%aragaz%' OR lower(title) LIKE '%plita%' OR lower(title) LIKE '%hota %' OR lower(title) LIKE '%espressor%' OR lower(title) LIKE '%aparat de cafea%' OR lower(title) LIKE '%fierbator%' OR lower(title) LIKE '%prajitor de paine%' OR lower(title) LIKE '%friteuza%' OR lower(title) LIKE '%air fryer%' OR lower(title) LIKE '%blender%' OR lower(title) LIKE '%mixer%' OR lower(title) LIKE '%robot de bucatarie%' OR lower(title) LIKE '%storcator%' OR lower(title) LIKE '%fier de calcat%' OR lower(title) LIKE '%aer conditionat%' OR lower(title) LIKE '%boiler%' OR lower(title) LIKE '%dezumidificator%' OR lower(title) LIKE '%masina de cusut%' OR lower(title) LIKE '%masina de tocat%')`;
const NOT_WORDS = ['accesori', 'piesa', 'piese', 'filtru', 'filtre', ' sac ', ' saci', 'furtun', 'garnitura', 'perie pentru', 'duza', 'rezerva', 'consumabil', 'detergent', 'tableta', 'capsula', 'cartus', 'solutie', 'spray', 'odorizant', 'husa', 'masuta', 'mobilier', 'jucarie', 'jucărie', 'set cadou', 'magnet', ' carte', 'suport de', 'raft ', 'sertar', 'balama', 'rulment', 'motor universal', 'curea', 'termostat', 'rezistenta', 'pompa', 'amortizor', 'protectie', 'protecție', 'vopsea', 'autocolant', 'sticker', 'decalcifiant', 'anticalcar', 'pahar', 'cana ', 'recipient'];
const NOT_SQL = NOT_WORDS.map((w) => `lower(title) NOT LIKE '%${w}%'`).join(' AND ');
const BRAND_BLOCK = ['smallrig', 'insta360', 'leifheit', 'vileda', 'gimi', 'brabantia', 'fisher-price', 'fisher price', 'svoora', 'zuru', 'playgo', 'melissa', 'lego', 'hasbro', 'noriel', 'roller', 'atelier 49'];
const BRAND_SQL = BRAND_BLOCK.map((b) => `lower(coalesce(brand,'')) <> '${b}'`).join(' AND ');
const rows = db.prepare(`SELECT id, slug, title, price, oldPrice, brand, brandSlug, merchant, merchantSlug, img, descr
  FROM products WHERE (megaSlug='electronice-it' OR megaSlug='casa-gradina') AND (subSlug IN (${INQ}) OR ${TITLE}) AND ${NOT_SQL} AND ${BRAND_SQL}
  AND img IS NOT NULL AND img <> '' AND price >= 100 ORDER BY price DESC`).all();

// ---- OUR category taxonomy (order matters: specific first) ----
const CATEGORIES = [
  { slug: 'masini-spalat-vase', label: 'Mașini de spălat vase', re: /spalat vase|spălat vase|de vase/i },
  { slug: 'masini-spalat-rufe', label: 'Mașini de spălat rufe', re: /masina de spalat|mașină de spălat|masină de spalat/i },
  { slug: 'uscatoare-rufe', label: 'Uscătoare de rufe', re: /uscator de rufe|uscător de rufe|uscator rufe/i },
  { slug: 'frigidere', label: 'Frigidere și congelatoare', re: /frigider|combina frigorifica|combină frigorifică|congelator|lada frigorifica|ladă frigorifică|minibar/i },
  { slug: 'microunde', label: 'Cuptoare cu microunde', re: /microunde/i },
  { slug: 'aragaze-cuptoare', label: 'Aragaze, cuptoare și plite', re: /aragaz|cuptor|plita|plită|hota|hotă/i },
  { slug: 'aspiratoare', label: 'Aspiratoare', re: /aspirator/i },
  { slug: 'aparate-cafea', label: 'Aparate de cafea', re: /espressor|aparat de cafea|aparate de cafea|filtru de cafea|rasnita|râșniță|cafea/i },
  { slug: 'climatizare', label: 'Climatizare și purificare aer', re: /aer conditionat|aer condiționat|climatizare|dezumidificator|umidificator|purificator|ventilator|radiator|convector|aeroterma|aerotermă/i },
  { slug: 'fiare-calcat', label: 'Fiare și stații de călcat', re: /fier de calcat|statie de calcat|stație de călcat|de calcat|de călcat/i },
  { slug: 'boilere', label: 'Boilere și încălzire apă', re: /boiler|instant apa|incalzitor de apa|încălzitor de apă/i },
  { slug: 'masini-cusut', label: 'Mașini de cusut', re: /masina de cusut|mașină de cusut/i },
  { slug: 'electrocasnice-mici', label: 'Electrocasnice mici de bucătărie', re: /blender|mixer|robot de bucatarie|robot de bucătărie|storcator|stoarcator|friteuza|friteuză|air fryer|prajitor|prăjitor|toaster|sandwich|vafe|gofre|fierbator|fierbător|feliator|cantar|cântar|tocator|tocător|gratar electric|grill|raclette|aparat de tocat|masina de tocat|mașină de tocat/i },
];
const CAT_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.label]));
function classify(title, descr) {
  const s = title + ' ' + (descr || '');
  for (const c of CATEGORIES) if (c.re.test(s)) return c.slug;
  return 'electrocasnice-mici';
}

// ---- helpers ----
const esc = (s) => String(s || '');
const money = (n) => Number(n).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lei';
const sl = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 70).replace(/^-+|-+$/g, '');
const seedOf = (s) => { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const strip = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const COLORS = ['alb', 'alba', 'inox', 'silver', 'argintiu', 'argintie', 'negru', 'neagra', 'gri', 'grafit', 'antracit', 'crem', 'rosu', 'rosie', 'albastru', 'white', 'black', 'silver'];
const M_NAMES = { evomag: 'evoMAG', dwyn: 'Dwyn', ozone: 'Ozone', flanco: 'Flanco', vonmag: 'Vonmag', flip: 'Flip', bsgmag: 'BSGmag', fornello: 'Fornello', dioda: 'Dioda' };
const merchSlugOf = (m) => (m || '').replace(/\/+$/, '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'magazin';

function imgUrl(poolImg, name) {
  const m = /([0-9a-f]{16})\.webp$/.exec(poolImg || '');
  if (!m) return '';
  return `${IMG_HOST}/${sl(name).slice(0, 55).replace(/-+$/, '')}-${m[1]}.webp`;
}

function parseSpecs(t, descr, brand, catSlug) {
  const s = t + ' ' + (descr || '');
  const energyClass = (s.match(/clasa\s*([A-G]\+{0,3})/i) || s.match(/\b([A-G]\+{2,3})\b/) || [])[1] || '';
  const power = (s.match(/(\d{3,4})\s*W\b/i) || [])[1];
  const capL = (s.match(/(\d{2,3})\s*[lL]\b/) || [])[1];
  const capKg = (s.match(/(\d{1,2}(?:[.,]\d)?)\s*kg\b/i) || [])[1];
  const capSet = (s.match(/(\d{1,2})\s*(?:seturi|set)\b/i) || [])[1];
  let color = ''; const ss = strip(t);
  for (const c of COLORS) { if (new RegExp('\\b' + c + '\\b').test(ss)) { color = c; break; } }
  // pick the capacity that fits the category
  let capacity = '';
  if (catSlug === 'masini-spalat-rufe' && capKg) capacity = `${capKg} kg`;
  else if (catSlug === 'masini-spalat-vase' && capSet) capacity = `${capSet} seturi`;
  else if (capL) capacity = `${capL} L`;
  else if (capKg) capacity = `${capKg} kg`;
  return { brand: brand || '', energyClass: energyClass ? energyClass.toUpperCase() : '', power: power ? +power : null, capacity, color };
}

function modelKey(title, brandSlug, sp, catSlug) {
  let core = strip(title).split(',')[0]
    .replace(/\b(frigider|combina|frigorifica|congelator|masina|de|spalat|rufe|vase|aragaz|cuptor|plita|hota|aspirator|microunde|cafea|espressor|fierbator|prajitor|toaster|blender|mixer|robot|storcator|fier|calcat|aer|conditionat|boiler|friteuza|uscator|clasa|[a-g]\+*|inox|alb|negru|silver|gri|kg|seturi|litri|l|cm|w|rpm|\d+)\b/g, ' ');
  for (const c of COLORS) core = core.replace(new RegExp('\\b' + c + '\\b', 'g'), ' ');
  if (brandSlug) core = core.replace(new RegExp('\\b' + brandSlug.replace(/-/g, ' ') + '\\b', 'g'), ' ');
  core = core.replace(/[^a-z0-9]+/g, '');
  return `${brandSlug || 'x'}|${core}|${catSlug}|${sp.color}`;
}

function genProse(p, sp, catLabel, offerCount) {
  const r = rng(seedOf(p.slug));
  const b = sp.brand || 'acest producător';
  const price = money(p.price);
  const m = esc(p.merchant).replace(/\/+$/, '');
  const reduced = p.oldPrice > p.price;
  const noun = catLabel.toLowerCase().replace(/^(mașini|aparate|fiare|cuptoare|uscătoare)/, (x) => ({ 'mașini': 'mașină', 'aparate': 'aparat', 'fiare': 'fier', 'cuptoare': 'cuptor', 'uscătoare': 'uscător' }[x] || x)).replace(/ și .*/, '').replace(/, .*/, '');
  const specBits = [sp.capacity && `capacitate ${sp.capacity}`, sp.energyClass && `clasă energetică ${sp.energyClass}`, sp.power && `putere ${sp.power} W`, sp.color && `finisaj ${sp.color}`].filter(Boolean);
  const specSent = specBits.length ? `Are ${specBits.slice(0, 3).join(', ')}.` : '';
  const opener = pick(r, [
    `${esc(p.title)} este un produs ieftin de la ${b}, disponibil de la ${price}${reduced ? ` (redus de la ${money(p.oldPrice)})` : ''}.`,
    `La ${price}${reduced ? `, sub prețul vechi de ${money(p.oldPrice)},` : ''} ${esc(p.title)} este oferta ${b} pe care o urmărim la categoria ${catLabel.toLowerCase()}.`,
    `Cauți ${noun} ieftin? ${esc(p.title)} de la ${b} pornește de la ${price}.`,
  ]);
  const offerSent = offerCount > 1 ? ` Îl găsești la ${offerCount} magazine — mai jos îți arătăm fiecare ofertă, de la cea mai mică.` : ` Disponibil prin ${m}.`;
  const intro = `${opener} ${specSent}${offerSent}`;
  const guide = [
    `${esc(p.title)} face parte din categoria ${catLabel.toLowerCase()}. ${sp.energyClass ? `Clasa energetică ${sp.energyClass} înseamnă un consum rezonabil pe termen lung.` : 'La un electrocasnic folosit des, verifică clasa energetică — contează la factură.'}`,
    `${sp.power ? `Cu o putere de ${sp.power} W, ` : ''}${sp.capacity ? `și o capacitate de ${sp.capacity}, ` : ''}este o alegere bună în segmentul accesibil. Compară prețurile de mai jos și cumpără de la magazinul cu cea mai bună ofertă.`,
  ];
  const faq = [
    { q: `Cât costă ${esc(p.title)}?`, a: `${esc(p.title)} pornește de la ${price}${reduced ? ` (redus de la ${money(p.oldPrice)})` : ''}.${offerCount > 1 ? ` Este listat la ${offerCount} magazine; afișăm fiecare ofertă.` : ''} Prețurile sunt actualizate periodic.` },
    ...(sp.capacity ? [{ q: `Ce capacitate are?`, a: `Are o capacitate de ${sp.capacity}.` }] : []),
    ...(sp.energyClass ? [{ q: `Ce clasă energetică are?`, a: `Are clasă energetică ${sp.energyClass}.` }] : []),
    { q: `De unde îl pot cumpăra?`, a: `Prin ${SITE_NAME} — îți arătăm ${offerCount > 1 ? 'toate ofertele și' : ''} prețul curent și te ducem direct la magazin.` },
  ];
  return { intro, guide, faq };
}

// ---- DEDUP ----
const winners = {};
for (const row of rows) {
  const img = imgUrl(row.img, row.title); if (!img) continue;
  const cu = (CAMPAIGN[row.merchantSlug] || {}).c; if (!cu) continue;
  const catSlug = classify(row.title, row.descr);
  const sp = parseSpecs(row.title, row.descr, row.brand, catSlug);
  const mkey = modelKey(row.title, row.brandSlug, sp, catSlug);
  const mSlug = merchSlugOf(row.merchant);
  const offer = { mSlug, mName: M_NAMES[mSlug] || cap(mSlug), price: row.price, oldPrice: row.oldPrice > row.price ? row.oldPrice : null, affiliate: `https://event.2performant.com/events/click?ad_type=product_store&aff_code=${AFF}&unique=${encodeURIComponent(row.id)}&campaign_unique=${cu}`, row, sp, img, catSlug };
  const w = winners[mkey] || (winners[mkey] = { byMerchant: {} });
  const cur = w.byMerchant[mSlug];
  if (!cur || offer.price < cur.price) w.byMerchant[mSlug] = offer;
}

const LEDGER = fileURLToPath(new URL('../.cache/modified-ledger.json', import.meta.url));
const oldLedger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : {};
const newLedger = {};
const BUILD_DATE = new Date().toISOString().slice(0, 10);

const seen = new Set();
const products = [];
for (const [mkey, w] of Object.entries(winners)) {
  const offers = Object.values(w.byMerchant).sort((a, b) => a.price - b.price).slice(0, 6);
  const best = offers[0];
  const { row, sp, img, catSlug } = best;
  const name = row.title.trim();
  let slug = oldLedger[mkey] && oldLedger[mkey].s;
  if (!slug) { slug = (sl(name).slice(0, 55).replace(/-+$/, '') || 'ec') + '-' + seedOf(mkey).toString(36); if (seen.has(slug)) { let k = 2; while (seen.has(slug + '-' + k)) k++; slug += '-' + k; } }
  seen.add(slug);
  const offerCount = offers.length;
  const catLabel = CAT_LABELS[catSlug];
  const prose = genProse({ title: name, slug, price: best.price, oldPrice: best.oldPrice || 0, merchant: best.row.merchant }, sp, catLabel, offerCount);
  const brandSlug = row.brandSlug || (sp.brand ? sl(sp.brand) : '');
  const offerList = offers.map((o, i) => ({ merchantSlug: o.mSlug, merchantName: o.mName, price: o.price, oldPrice: o.oldPrice, affiliate: o.affiliate, outKey: i === 0 ? slug : `${slug}~${o.mSlug}` }));
  const chash = seedOf(`${best.price}|${best.oldPrice}|${name}|${img}|${JSON.stringify(sp)}|${offers.map((o) => o.mSlug + o.price).join()}`);
  const modified = (oldLedger[mkey] && oldLedger[mkey].h === chash) ? oldLedger[mkey].m : BUILD_DATE;
  newLedger[mkey] = { h: chash, m: modified, s: slug, b: brandSlug, z: catSlug, d: BUILD_DATE };
  products.push({
    slug, id: row.id, name, brand: sp.brand, brandSlug, price: best.price, oldPrice: best.oldPrice,
    merchant: best.row.merchant, merchantSlug: best.mSlug, merchantName: best.mName, img, affiliate: best.affiliate, modified, band: catSlug, category: catSlug, categoryLabel: catLabel, offerCount,
    offers: offerList,
    specs: { Brand: sp.brand || '—', Categorie: catLabel, ...(sp.capacity ? { Capacitate: sp.capacity } : {}), ...(sp.energyClass ? { 'Clasă energetică': sp.energyClass } : {}), ...(sp.power ? { Putere: `${sp.power} W` } : {}), ...(sp.color ? { Culoare: cap(sp.color) } : {}) },
    prose,
  });
}

// dropped -> 301 similar (same brand+category)
const RETAIN_DAYS = 150;
const cutoff = new Date(new Date(BUILD_DATE + 'T00:00:00Z').getTime() - RETAIN_DAYS * 864e5).toISOString().slice(0, 10);
const byBrandBand = {};
for (const p of products) (byBrandBand[`${p.brandSlug}|${p.band}`] ||= []).push(p);
const brandPages = new Set();
{ const bc = {}; for (const p of products) if (p.brandSlug) bc[p.brandSlug] = (bc[p.brandSlug] || 0) + 1; for (const b in bc) if (bc[b] >= 4) brandPages.add(b); }
const dropped = {};
for (const mkey of Object.keys(oldLedger)) {
  if (newLedger[mkey]) continue;
  const e = oldLedger[mkey]; if (!e || !e.s) continue;
  if ((e.d || '0') < cutoff) continue;
  const sim = byBrandBand[`${e.b}|${e.z}`];
  dropped[e.s] = (sim && sim.length) ? `/produs/${sim[0].slug}/` : (brandPages.has(e.b) ? `/brand/${e.b}/` : (CAT_LABELS[e.z] ? `/${e.z}/` : '/electrocasnice/'));
  newLedger[mkey] = e;
}

mkdirSync(fileURLToPath(new URL('../src/data', import.meta.url)), { recursive: true });
writeFileSync(OUT, JSON.stringify(products));
mkdirSync(fileURLToPath(new URL('../.cache', import.meta.url)), { recursive: true });
writeFileSync(LEDGER, JSON.stringify(newLedger));
writeFileSync(fileURLToPath(new URL('../.cache/dropped.json', import.meta.url)), JSON.stringify(dropped));
// also write the category list for the pages
writeFileSync(fileURLToPath(new URL('../src/data/categories.json', import.meta.url)), JSON.stringify(CATEGORIES.map((c) => ({ slug: c.slug, label: c.label }))));
const multi = products.filter((p) => p.offerCount > 1).length;
const cats = {}; for (const p of products) cats[p.category] = (cats[p.category] || 0) + 1;
console.log(`  ${rows.length} offers -> ${products.length} distinct products (${multi} multi-merchant); ${Object.keys(dropped).length} dropped 301s`);
console.log('  by category:', Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(', '));
const brands = {}; for (const p of products) brands[p.brand] = (brands[p.brand] || 0) + 1;
console.log('  top brands:', Object.entries(brands).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join(', '));
