const fs = require('fs');
const path = require('path');

const base = path.join(process.cwd(), 'intermediate');
const manifestPath = path.join(base, 'published.json');
if (!fs.existsSync(manifestPath)) {
  console.error('intermediate/published.json not found');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const required = Array.from({ length: 10 }, (_, i) => String(i).padStart(2, '0'));
for (const number of required) {
  const article = manifest.articles?.[number];
  if (!article?.url || !article?.noteId) {
    console.error(`missing published article in manifest: ${number}`);
    process.exit(1);
  }
}

const circles = ['','①','②','③','④','⑤','⑥','⑦','⑧','⑨'];
const loadPost = number => JSON.parse(fs.readFileSync(path.join(base, `note-${number}.json`), 'utf8'));
const lines = number => loadPost(number).body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

const repairs = [];

// Free INDEX article -> all nine derived articles.
const indexLines = lines('00');
const indexLinks = [];
for (let i = 1; i <= 9; i++) {
  const targetText = indexLines.find(line => line.startsWith(`中級編${circles[i]}：`));
  if (!targetText) {
    console.error(`INDEX link text not found for ${circles[i]}`);
    process.exit(1);
  }
  indexLinks.push({ text: targetText, url: manifest.articles[String(i).padStart(2, '0')].url });
}
repairs.push({
  action: 'updateLinks',
  noteId: manifest.articles['00'].noteId,
  noteAccount: 'rapomaru666',
  preserveSettings: true,
  links: indexLinks
});

// Each paid article -> INDEX, and next article when an exact next-step line exists.
for (let i = 1; i <= 9; i++) {
  const number = String(i).padStart(2, '0');
  const articleLines = lines(number);
  const articleLinks = [];

  const roadmapText = articleLines.find(line => line === '中級編の全体ロードマップはこちら');
  if (roadmapText) {
    articleLinks.push({ text: roadmapText, url: manifest.articles['00'].url });
  }

  if (i < 9) {
    const nextText = articleLines.find(line => line.startsWith(`中級編${circles[i + 1]}：`));
    if (nextText) {
      articleLinks.push({ text: nextText, url: manifest.articles[String(i + 1).padStart(2, '0')].url });
    }
  }

  if (articleLinks.length === 0) {
    console.error(`no repairable link text found in note-${number}.json`);
    process.exit(1);
  }

  repairs.push({
    action: 'updateLinks',
    noteId: manifest.articles[number].noteId,
    noteAccount: 'rapomaru666',
    preserveSettings: true,
    links: articleLinks
  });
}

const output = {
  series: manifest.series,
  generatedAt: new Date().toISOString(),
  repairs
};
const outputPath = path.join(base, 'repair-links.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
console.log(`[build-intermediate-repairs] generated ${repairs.length} repairs`);
