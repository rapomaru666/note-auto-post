const fs = require('fs');

const postFile = process.env.RAPOMAN_POST_FILE || 'rapoman/post.json';
const rulesFile = process.env.RAPOMAN_RULES_FILE || 'rapoman/rules-v1.json';
const deterministicFile = process.env.RAPOMAN_DETERMINISTIC_AUDIT_FILE || 'rapoman/deterministic-audit.json';
const outputFile = process.env.RAPOMAN_AI_AUDIT_FILE || 'rapoman/ai-audit.json';
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

if (!apiKey) {
  console.error('GEMINI_API_KEY が未設定です。独立AI監査を通さない限り公開不可です。');
  process.exit(1);
}

function load(path) {
  if (!fs.existsSync(path)) throw new Error(`必須ファイルがありません: ${path}`);
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function extractText(data) {
  return (data.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

(async () => {
  const post = load(postFile);
  const rules = load(rulesFile);
  const deterministic = load(deterministicFile);
  if (deterministic.passed !== true) throw new Error('決定論監査がPASSしていません。AI監査へ進めません。');

  const prompt = `あなたはRAPOMAN漫画記事の独立監査専任です。執筆者ではありません。全文を書き直さず、合否と問題点だけを返してください。\n\n最重要方針:\n- ユーザー本人の独自感想・変な着眼点・本音が主役。\n- AIが追加した王道ポイントは、作品を語る上で外せない抜けを補う脇役であること。\n- AIがユーザーの感想を捏造・上書きしてはいけない。\n- 普通の採点型レビューへ矯正してはいけない。\n- パッションが弱く、百科事典・SEO記事・AI一般論になっていたらFAIL。\n- userPointsが本文の中心として生きているか確認する。\n- mustCoverTopicsが不自然に欠落せず、しかし主役を奪っていないか確認する。\n- 最新情報、基本情報、画像権利メタデータ、禁止項目を確認する。\n- 原作引用画像は改変不可。怪しい場合はoriginalへフォールバックすべき。\n\n固定ルール:\n${JSON.stringify(rules, null, 2)}\n\n投稿データ:\n${JSON.stringify(post, null, 2)}\n\n次のJSONだけ返してください。\n{\n  "passed": trueまたはfalse,\n  "score": 0から100の整数,\n  "critical": ["公開を止める問題"],\n  "warnings": ["改善推奨だが公開停止までは不要な問題"],\n  "userVoice": "ユーザーの感性が主役になっているかの短い判定",\n  "majorPointCoverage": "王道補完の抜けと過剰の短い判定",\n  "reason": "総合判定を簡潔に"\n}\n\npassed=trueにできるのはcriticalが0件で、scoreが80以上の場合だけです。`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-api-client': 'rapoman-publisher/1.0'
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Gemini API監査に失敗 HTTP ${response.status}: ${raw.slice(0, 800)}`);
  const data = JSON.parse(raw);
  const text = extractText(data);
  if (!text) throw new Error('Gemini監査結果が空です。');
  const audit = parseJson(text);

  if (!Array.isArray(audit.critical)) audit.critical = [];
  if (!Array.isArray(audit.warnings)) audit.warnings = [];
  audit.model = model;
  audit.checkedAt = new Date().toISOString();
  audit.postKey = post.postKey || null;
  audit.passed = audit.passed === true && audit.critical.length === 0 && Number(audit.score) >= 80;

  fs.writeFileSync(outputFile, JSON.stringify(audit, null, 2) + '\n');

  if (!audit.passed) {
    console.error('RAPOMAN independent AI audit: FAIL');
    for (const item of audit.critical) console.error(`- ${item}`);
    process.exit(1);
  }
  console.log(`RAPOMAN independent AI audit: PASS (${audit.score}/100)`);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
