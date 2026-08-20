const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const postPath = process.env.POST_FILE || 'post.json';
  if (!fs.existsSync(postPath)) return;

  const post = JSON.parse(fs.readFileSync(postPath, 'utf8'));
  const spec = post.coverTemplate;
  if (!spec) {
    console.log('coverTemplateなし: 見出し画像の自動生成をスキップ');
    return;
  }

  const baseImage = spec.baseImage || 'assets/note-theme-02.jpg';
  const output = spec.output || post.coverImage || 'assets/generated-cover.png';
  if (!fs.existsSync(baseImage)) throw new Error(`ベース画像が見つかりません: ${baseImage}`);

  const base64 = fs.readFileSync(baseImage).toString('base64');
  const ext = path.extname(baseImage).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${base64}`;

  const themeColor = spec.themeColor || '#315a4e';
  const accentColor = spec.accentColor || '#d7c089';
  const title = spec.title || post.title || '';
  const subtitle = spec.subtitle || '';
  const badge = spec.badge || '単独コンテンツ';
  const labels = Array.isArray(spec.labels) ? spec.labels : [];

  const escapeHtml = value => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 670 } });

  await page.setContent(`<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 670px; overflow: hidden; }
  body { font-family: "Yu Gothic", "Noto Sans JP", "Hiragino Kaku Gothic ProN", sans-serif; }
  #cover {
    position: relative;
    width: 1280px;
    height: 670px;
    overflow: hidden;
    background: ${themeColor};
  }
  .photo {
    position: absolute;
    inset: 0;
    background-image: url('${dataUrl}');
    background-size: cover;
    background-position: center center;
    filter: saturate(.82) contrast(1.02);
  }
  .wash {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg,
        ${themeColor} 0%,
        ${themeColor} 54%,
        color-mix(in srgb, ${themeColor} 90%, transparent) 66%,
        color-mix(in srgb, ${themeColor} 32%, transparent) 100%);
  }
  .left-mask {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 68%;
    background: linear-gradient(135deg, ${themeColor} 0%, color-mix(in srgb, ${themeColor} 88%, #000 12%) 100%);
    opacity: .98;
  }
  .circuit {
    position: absolute;
    inset: 0;
    opacity: .14;
    background-image:
      linear-gradient(90deg, transparent 0 10%, rgba(255,255,255,.55) 10.2% 10.35%, transparent 10.55% 100%),
      linear-gradient(0deg, transparent 0 22%, rgba(255,255,255,.45) 22.2% 22.35%, transparent 22.55% 100%);
    background-size: 260px 180px;
  }
  .frame {
    position: absolute;
    inset: 22px;
    border: 2px solid color-mix(in srgb, ${accentColor} 72%, white 28%);
    border-radius: 3px;
    opacity: .9;
  }
  .content {
    position: absolute;
    left: 68px;
    top: 58px;
    width: 710px;
    color: white;
  }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 9px 18px;
    border: 1px solid ${accentColor};
    border-radius: 999px;
    color: ${accentColor};
    font-weight: 700;
    font-size: 20px;
    letter-spacing: .08em;
    background: rgba(0,0,0,.14);
  }
  .title {
    margin-top: 42px;
    font-family: "Yu Mincho", "Noto Serif JP", serif;
    font-weight: 800;
    font-size: 76px;
    line-height: 1.08;
    letter-spacing: .02em;
    text-shadow: 0 4px 18px rgba(0,0,0,.35);
  }
  .subtitle {
    margin-top: 24px;
    max-width: 680px;
    font-size: 34px;
    line-height: 1.35;
    font-weight: 700;
    color: #f4f1e7;
  }
  .labels {
    display: flex;
    gap: 12px;
    margin-top: 34px;
  }
  .label {
    padding: 8px 16px;
    border-radius: 999px;
    background: rgba(255,255,255,.13);
    border: 1px solid rgba(255,255,255,.42);
    font-size: 19px;
    font-weight: 700;
  }
  .brand {
    position: absolute;
    left: 70px;
    bottom: 48px;
    font-size: 17px;
    letter-spacing: .16em;
    color: ${accentColor};
    font-weight: 800;
  }
  .side-tag {
    position: absolute;
    right: 46px;
    top: 48px;
    padding: 8px 15px;
    background: rgba(0,0,0,.38);
    border: 1px solid rgba(255,255,255,.35);
    color: white;
    font-size: 17px;
    font-weight: 700;
  }
</style>
</head>
<body>
  <div id="cover">
    <div class="photo"></div>
    <div class="wash"></div>
    <div class="left-mask"></div>
    <div class="circuit"></div>
    <div class="frame"></div>
    <div class="content">
      <div class="eyebrow">${escapeHtml(badge)}</div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="subtitle">${escapeHtml(subtitle)}</div>
      <div class="labels">${labels.map(label => `<span class="label">${escapeHtml(label)}</span>`).join('')}</div>
    </div>
    <div class="brand">RAPOMARU PRESS</div>
    <div class="side-tag">CURSOR GUIDE</div>
  </div>
</body>
</html>`);

  await page.locator('#cover').screenshot({ path: output });
  await browser.close();
  console.log('見出し画像を生成:', output);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
