const fs = require('fs');
const path = require('path');

const base = path.join(process.cwd(), 'intermediate');
const expected = Array.from({ length: 10 }, (_, i) => String(i).padStart(2, '0'));

function fail(message) {
  console.error(`[validate-intermediate] ${message}`);
  process.exit(1);
}

for (const number of expected) {
  const file = path.join(base, `note-${number}.json`);
  if (!fs.existsSync(file)) fail(`missing file: ${file}`);
  let post;
  try {
    post = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(`invalid JSON in ${file}: ${err.message}`);
  }

  if (!post.title || typeof post.title !== 'string') fail(`missing title: ${file}`);
  if (!post.body || typeof post.body !== 'string' || post.body.trim().length < 200) fail(`body too short: ${file}`);
  if (!post.coverImage || !fs.existsSync(path.join(process.cwd(), post.coverImage))) {
    fail(`missing coverImage for ${file}: ${post.coverImage || '(none)'}`);
  }

  if (number === '00') {
    if (post.paid !== false) fail('note-00 must be free');
  } else {
    if (post.paid !== true) fail(`note-${number} must be paid`);
    if (Number(post.price) !== 300) fail(`note-${number} price must be 300`);
    if (!Number.isInteger(post.paidLineIndex) || post.paidLineIndex < 0) {
      fail(`note-${number} paidLineIndex must be a non-negative integer`);
    }
  }
}

const indexFile = path.join(base, 'index.json');
if (!fs.existsSync(indexFile)) fail('missing intermediate/index.json');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
if (!Array.isArray(index.index) || index.index.length !== 9) fail('intermediate/index.json must contain 9 derived entries');

console.log('[validate-intermediate] OK: 10 articles, pricing, covers, and index structure validated.');
