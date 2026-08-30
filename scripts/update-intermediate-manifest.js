const fs = require('fs');
const path = require('path');

const [numberArg, urlArg] = process.argv.slice(2);
if (!/^\d{2}$/.test(numberArg || '')) {
  console.error('usage: node scripts/update-intermediate-manifest.js NN URL');
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(urlArg);
} catch (_) {
  console.error('invalid URL:', urlArg);
  process.exit(1);
}
if (parsedUrl.hostname !== 'note.com' || !/^\/rapomaru666\/n\/[^/]+\/?$/.test(parsedUrl.pathname)) {
  console.error('unexpected published URL:', urlArg);
  process.exit(1);
}

const noteId = parsedUrl.pathname.split('/').filter(Boolean).pop();
const base = path.join(process.cwd(), 'intermediate');
const manifestPath = path.join(base, 'published.json');
const postPath = path.join(base, `note-${numberArg}.json`);
const post = JSON.parse(fs.readFileSync(postPath, 'utf8'));

let manifest = {
  series: 'ChatGPTを使ってnoteを投稿する方法 中級編',
  status: 'publishing',
  articles: {}
};
if (fs.existsSync(manifestPath)) {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.articles || typeof manifest.articles !== 'object') manifest.articles = {};
}

manifest.status = 'publishing';
manifest.updatedAt = new Date().toISOString();
manifest.articles[numberArg] = {
  number: numberArg,
  title: post.title,
  paid: post.paid === true,
  price: post.paid === true ? Number(post.price || 0) : 0,
  noteId,
  url: `https://note.com/rapomaru666/n/${noteId}`,
  publishedAt: manifest.articles[numberArg]?.publishedAt || new Date().toISOString()
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`[update-intermediate-manifest] ${numberArg} -> ${manifest.articles[numberArg].url}`);
