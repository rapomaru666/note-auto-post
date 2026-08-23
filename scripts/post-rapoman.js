const fs = require('fs');
const { spawnSync } = require('child_process');

const sourceFile = process.env.RAPOMAN_POST_FILE || 'rapoman/post.json';
const ledgerFile = process.env.RAPOMAN_LEDGER_FILE || 'rapoman/published.json';
const tempFile = 'rapoman/.post-rendered.json';

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

function renderMarkdown(body) {
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

const post = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : { posts: [] };
const exists = Array.isArray(ledger.posts) && ledger.posts.some(item => item.postKey === post.postKey);

const rendered = {
  ...post,
  body: post.contentType === 'text/html' ? post.body : renderMarkdown(post.body),
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
