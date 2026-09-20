/**
 * themes2vec —— 主题池向量化工具（仅本地运行）
 *
 * 使用 transformers.js 加载 Xenova/paraphrase-multilingual-MiniLM-L12-v2，
 * 将主题池（纯文本，一行一个主题）编码为向量池 JSON，
 * 供 docs/themes 在线页面解码使用。
 *
 * 注：原 Xenova/multilingual-MiniLM-L6-v2 已在 Hugging Face 下架（401），
 *     改用同家族的多语言 MiniLM 替代模型。
 *
 * 用法：
 *   npm install
 *   npm run build
 *   node themes2vec.mjs [--input themes.txt] [--output ../docs/data/themes/vectors.json] [--host https://huggingface.co]
 *
 * 向量说明：
 *   - 模型输出 384 维句子向量，采用 mean 池化（与模型卡一致）
 *   - 向量经过 L2 归一化，余弦相似度可直接用点积计算
 *   - 以 base64 编码的 float32 存储，压缩 JSON 体积
 *   - 模型下载默认走 hf-mirror.com（国内直连），可用 --host 切换官方源
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline, env } from '@xenova/transformers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const POOLING = 'mean';

// ---------- 命令行参数 ----------
const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const inputPath = path.resolve(__dirname, argOf('--input', 'themes.txt'));
const outputPath = path.resolve(__dirname, argOf('--output', '../docs/data/themes/vectors.json'));
env.remoteHost = argOf('--host', 'https://hf-mirror.com');

// ---------- 读取主题池（纯文本：一行一个主题） ----------
const raw = fs.readFileSync(inputPath, 'utf8');
const themes = [...new Set(
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
)];
if (themes.length === 0) {
  console.error(`[themes2vec] 主题池为空：${inputPath}`);
  process.exit(1);
}
console.log(`[themes2vec] 载入主题池 ${themes.length} 个主题（${path.basename(inputPath)}）`);

// ---------- 编码为向量 ----------
console.log(`[themes2vec] 加载模型 ${MODEL_ID}（首次运行将从 Hugging Face 下载缓存）…`);
const extractor = await pipeline('feature-extraction', MODEL_ID);

const BATCH = 32;
const vecArrays = [];
for (let i = 0; i < themes.length; i += BATCH) {
  const batch = themes.slice(i, i + BATCH);
  const output = await extractor(batch, { pooling: POOLING, normalize: true });
  const list = output.tolist(); // [[...384 个浮点数], ...]
  for (const vec of list) vecArrays.push(vec);
  console.log(`[themes2vec] 编码进度 ${Math.min(i + BATCH, themes.length)}/${themes.length}`);
}
if (vecArrays.length !== themes.length) {
  console.error('[themes2vec] 编码数量与主题数量不一致，请检查输入。');
  process.exit(1);
}

// ---------- 序列化为向量池 JSON ----------
function toBase64F32(vec) {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
}

const pool = {
  model: MODEL_ID,
  pooling: POOLING,
  normalized: true,
  dtype: 'float32-base64',
  dim: vecArrays[0].length,
  count: themes.length,
  themes,
  vectors: vecArrays.map(toBase64F32),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(pool));
const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(1);
console.log(`[themes2vec] 向量池已生成：${outputPath}（${themes.length} × ${pool.dim} 维，${sizeKB} KB）`);
