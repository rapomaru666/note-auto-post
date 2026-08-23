const fs = require('fs');

const postFile = process.env.RAPOMAN_POST_FILE || 'rapoman/post.json';
const post = JSON.parse(fs.readFileSync(postFile, 'utf8'));
const body = String(post.body || '');
const errors = [];

if (!body.trim()) errors.push('本文が空です。');

const paragraphCount = body.split(/\n\s*\n/).filter(part => part.trim() && !/^##\s+/.test(part.trim()) && !/^---+$/.test(part.trim())).length;
const headingCount = (body.match(/^##\s+/gm) || []).length;

if (paragraphCount < 5) errors.push('段落数が少なすぎます。読みやすい改行・段落分けが必要です。');
if (headingCount < 3) errors.push('見出しが少なすぎます。長文を章分けしてください。');

const longestBlock = body
  .split(/\n\s*\n/)
  .reduce((max, part) => Math.max(max, part.trim().length), 0);
if (longestBlock > 500) errors.push(`1段落が長すぎます（最大${longestBlock}文字）。段落を分割してください。`);

if (errors.length) {
  console.error('RAPOMAN readability audit: FAIL');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`RAPOMAN readability audit: PASS (paragraphs=${paragraphCount}, headings=${headingCount}, longestBlock=${longestBlock})`);
