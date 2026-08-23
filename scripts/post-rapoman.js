const fs = require('fs');
const { spawnSync } = require('child_process');

const sourceFile = process.env.RAPOMAN_POST_FILE || 'rapoman/post.json';
const ledgerFile = process.env.RAPOMAN_LEDGER_FILE || 'rapoman/published.json';
const tempFile = 'rapoman/.post-rendered.json';
const PRIMARY_MARKER = '[[RAPOMAN_PRIMARY_AFFILIATE]]';
const FOOTER_MARKER = '[[RAPOMAN_FOOTER_AFFILIATE]]';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function affiliateAnchor(url, label, extraStyle = '') {
  return `<a href="${escapeAttr(url)}" target="_blank" rel="sponsored noopener noreferrer" style="${extraStyle}">${escapeHtml(label)}</a>`;
}

function renderPrimaryAffiliate(post) {
  const cover = post.comicCover || {};
  const primary = post.affiliateZones?.primary || {};
  const link = Array.isArray(primary.links) ? primary.links[0] : null;
  if (!link) throw new Error('上部アフィリエイトリンクがありません。');

  const disclosure = escapeHtml(post.affiliateDisclosure || '※本記事にはアフィリエイト広告を含みます。');
  const targetUrl = link.url;
  const cta = link.label || primary.requiredBodyText || 'この作品を見る';
  const alt = cover.alt || `${post.title || 'コミックス'} 表紙`;

  return [
    '<div class="rapoman-primary-affiliate" style="text-align:center;margin:24px 0 32px;">',
    `  <p style="margin:0 0 12px;font-size:12px;color:#666;">${disclosure}</p>`,
    `  <p style="margin:0 0 12px;"><a href="${escapeAttr(targetUrl)}" target="_blank" rel="sponsored noopener noreferrer"><img src="${escapeAttr(cover.imageUrl)}" alt="${escapeAttr(alt)}" loading="lazy" style="display:block;width:auto;max-width:260px;height:auto;max-height:none;margin:0 auto;"></a></p>`,
    `  <p style="margin:0;">${affiliateAnchor(targetUrl, cta, 'font-weight:700;text-decoration:underline;')}</p>`,
    '</div>'
  ].join('\n');
}

function renderFooterAffiliate(post) {
  const footer = post.affiliateZones?.footer || {};
  const links = Array.isArray(footer.links) ? footer.links : [];
  const heading = footer.requiredBodyText || 'この作品を読む・買う';
  const disclosure = escapeHtml(post.affiliateDisclosure || '※本記事にはアフィリエイト広告を含みます。');

  const items = links.map(link => {
    const label = link.label || link.provider || 'この作品を見る';
    const provider = link.provider ? `<div style="font-size:11px;color:#777;margin-top:4px;">${escapeHtml(link.provider)}</div>` : '';
    return `<li style="margin:10px 0;">${affiliateAnchor(link.url, label, 'display:block;padding:12px 14px;border:1px solid #ddd;border-radius:6px;text-align:center;font-weight:700;text-decoration:none;')}${provider}</li>`;
  }).join('\n');

  return [
    '<section class="rapoman-footer-affiliate" style="margin-top:36px;">',
    `  <h2>${escapeHtml(heading)}</h2>`,
    `  <p style="font-size:12px;color:#666;">${disclosure}</p>`,
    '  <ul style="list-style:none;padding:0;margin:0;">',
    items,
    '  </ul>',
    '</section>'
  ].join('\n');
}

function inlineMarkdown(value) {
  const links = [];
  let text = String(value).replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    const token = `@@RAPOMAN_LINK_${links.length}@@`;
    links.push(`<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    return token;
  });
  text = escapeHtml(text);
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  links.forEach((html, index) => {
    text = text.replace(`@@RAPOMAN_LINK_${index}@@`, html);
  });
  return text;
}

function renderMarkdown(body, post) {
  const blocks = String(body || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean);

  const html = [];
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const block of blocks) {
    if (block === PRIMARY_MARKER) {
      closeList();
      html.push(renderPrimaryAffiliate(post));
      continue;
    }
    if (block === FOOTER_MARKER) {
      closeList();
      html.push(renderFooterAffiliate(post));
      continue;
    }
    if (/^##\s+/.test(block)) {
      closeList();
      html.push(`<h2>${inlineMarkdown(block.replace(/^##\s+/, ''))}</h2>`);
      continue;
    }
    if (/^---+$/.test(block)) {
      closeList();
      html.push('<hr>');
      continue;
    }
    if (/^-\s+/.test(block)) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(block.replace(/^-\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inlineMarkdown(block).replace(/\n/g, '<br>')}</p>`);
  }
  closeList();
  return html.join('\n');
}

function renderHtmlBody(body, post) {
  return String(body || '')
    .replace(PRIMARY_MARKER, renderPrimaryAffiliate(post))
    .replace(FOOTER_MARKER, renderFooterAffiliate(post));
}

const post = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : { posts: [] };
const exists = Array.isArray(ledger.posts) && ledger.posts.some(item => item.postKey === post.postKey);

const renderedBody = post.contentType === 'text/html'
  ? renderHtmlBody(post.body, post)
  : renderMarkdown(post.body, post);

const rendered = {
  ...post,
  body: renderedBody,
  contentType: 'text/html',
  updateExisting: exists
};

fs.writeFileSync(tempFile, JSON.stringify(rendered, null, 2) + '\n');

const result = spawnSync(process.execPath, ['scripts/post-senki.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    SENKI_POST_FILE: tempFile,
    SENKI_LEDGER_FILE: ledgerFile
  }
});

fs.rmSync(tempFile, { force: true });
process.exit(result.status ?? 1);
