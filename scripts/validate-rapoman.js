const fs = require('fs');

const postFile = process.env.RAPOMAN_POST_FILE || 'rapoman/post.json';
const rulesFile = process.env.RAPOMAN_RULES_FILE || 'rapoman/rules-v1.json';
const outputFile = process.env.RAPOMAN_AUDIT_FILE || 'rapoman/deterministic-audit.json';

function loadJson(path) {
  if (!fs.existsSync(path)) throw new Error(`必須ファイルがありません: ${path}`);
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (_) {
    return false;
  }
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

const rules = loadJson(rulesFile);
const post = loadJson(postFile);
const errors = [];
const warnings = [];
const body = String(post.body || '');

add(errors, post.rulesVersion === rules.rulesVersion, `rulesVersionは ${rules.rulesVersion} 必須です。`);
add(errors, typeof post.title === 'string' && post.title.trim().length > 0, 'titleが空です。');
add(errors, body.trim().length > 0, 'bodyが空です。');

const userPoints = Array.isArray(post.userPoints) ? post.userPoints : [];
add(errors, userPoints.length >= rules.minimums.userPoints, `ワイの感想が最低${rules.minimums.userPoints}件必要です。`);
for (const point of userPoints) {
  const text = String(point.requiredBodyText || '').trim();
  add(errors, text.length > 0, `ワイの感想「${point.label || '名称なし'}」のrequiredBodyTextが空です。`);
  if (text) add(errors, body.includes(text), `ワイの感想が本文から欠落しています: ${text}`);
}

const mustCover = Array.isArray(post.mustCoverTopics) ? post.mustCoverTopics : [];
add(errors, mustCover.length >= rules.minimums.mustCoverTopics, `王道補完ポイントが最低${rules.minimums.mustCoverTopics}件必要です。`);
for (const item of mustCover) {
  const text = String(item.requiredBodyText || '').trim();
  add(errors, String(item.topic || '').trim().length > 0, '王道補完ポイントのtopicが空です。');
  add(errors, text.length > 0, `王道補完「${item.topic || '名称なし'}」のrequiredBodyTextが空です。`);
  if (text) add(errors, body.includes(text), `王道補完ポイントが本文から欠落しています: ${text}`);
  const sources = Array.isArray(item.sources) ? item.sources : [];
  add(errors, sources.some(validUrl), `王道補完「${item.topic || '名称なし'}」に有効な根拠URLがありません。`);
}

const latest = post.latestInfo || {};
add(errors, /^\d{4}-\d{2}-\d{2}$/.test(String(latest.asOf || '')), 'latestInfo.asOfはYYYY-MM-DD形式必須です。');
const latestMarker = String(latest.requiredBodyText || '').trim();
add(errors, latestMarker.length > 0, '最新情報の日付表示用requiredBodyTextが空です。');
if (latestMarker) add(errors, body.includes(latestMarker), `本文に最新情報の基準日がありません: ${latestMarker}`);
add(errors, Array.isArray(latest.sources) && latest.sources.some(validUrl), '最新情報の根拠URLがありません。');

const research = Array.isArray(post.researchSources) ? post.researchSources : [];
add(errors, research.length >= rules.minimums.researchSources, `調査ソースが最低${rules.minimums.researchSources}件必要です。`);
add(errors, research.filter(item => item.type === 'official' && validUrl(item.url)).length >= rules.minimums.officialSources, `公式ソースが最低${rules.minimums.officialSources}件必要です。`);
for (const source of research) add(errors, validUrl(source.url), `無効な調査URLがあります: ${source.url || '(空)'}`);

const cover = post.comicCover || {};
add(errors, rules.imagePolicy.coverAllowedTypes.includes(cover.type), `コミックス画像typeが不正です: ${cover.type || '(空)'}`);
if (cover.type === 'affiliate-cover' || cover.type === 'official-cover') {
  add(errors, validUrl(cover.imageUrl), 'コミックス書影のimageUrlがありません。');
  add(errors, validUrl(cover.sourceUrl), 'コミックス書影のsourceUrlがありません。');
}
if (cover.type === 'affiliate-cover') add(errors, validUrl(cover.affiliateUrl), 'アフィリエイト書影のaffiliateUrlがありません。');

const bodyImages = Array.isArray(post.bodyImages) ? post.bodyImages : [];
for (const image of bodyImages) {
  add(errors, rules.imagePolicy.bodyAllowedTypes.includes(image.type), `本文画像typeが不正です: ${image.type || '(空)'}`);
  if (image.type === 'quoted-original') {
    add(errors, validUrl(image.sourceUrl), '原作引用画像にsourceUrlがありません。');
    add(errors, String(image.purpose || '').trim().length > 0, '原作引用画像に引用目的がありません。');
    add(errors, image.unchanged === true, '原作引用画像はunchanged=true必須です。改変画像は公開不可です。');
  }
}

const chapters = Array.isArray(post.passionChapters) ? post.passionChapters : [];
add(errors, chapters.length >= rules.minimums.passionChapters, `パッション章が最低${rules.minimums.passionChapters}件必要です。`);
for (const chapter of chapters) {
  const heading = String(chapter.heading || '').trim();
  add(errors, heading.length > 0, '空のパッション章見出しがあります。');
  if (heading) add(errors, body.includes(heading), `パッション章が本文から欠落しています: ${heading}`);
}

for (const pattern of rules.forbiddenPatterns) {
  if (body.includes(pattern)) errors.push(`禁止表現・禁止セクションを検出: ${pattern}`);
}

if (body.length < 1200) warnings.push('本文が1200文字未満です。薄い記事になっていないか独立AI監査で重点確認してください。');

const result = {
  rulesVersion: rules.rulesVersion,
  postKey: post.postKey || null,
  checkedAt: new Date().toISOString(),
  passed: errors.length === 0,
  errors,
  warnings
};
fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');

if (errors.length) {
  console.error('RAPOMAN deterministic audit: FAIL');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('RAPOMAN deterministic audit: PASS');
for (const warning of warnings) console.log(`WARNING: ${warning}`);
