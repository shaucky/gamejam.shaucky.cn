/**
 * download-model —— 把在线页面所需的模型文件下载到 docs/themes/model/
 * 使浏览器端从同源加载模型，规避 hf-mirror.com 的 CORS 限制。
 *
 * 用法：node download-model.mjs [--host https://hf-mirror.com]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 与 themes2vec.mjs 保持一致
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const OUT_DIR = path.resolve(__dirname, '../docs/themes/model', MODEL_ID);

const args = process.argv.slice(2);
const host = args.includes('--host') ? args[args.indexOf('--host') + 1] : 'https://hf-mirror.com';

// transformers.js v2 浏览器端 quantized 模式所需的文件集
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

fs.mkdirSync(path.join(OUT_DIR, 'onnx'), { recursive: true });

// GitHub 单文件 100MB 上限：拆分分片大小（64MB）
const PART_SIZE = 64 * 1024 * 1024;

for (const file of FILES) {
  const dest = path.join(OUT_DIR, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[model] 已存在，跳过：${dest}（${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB）`);
    continue;
  }
  const url = `${host}/${MODEL_ID}/resolve/main/${file}`;
  console.log(`[model] 下载 ${url} …`);
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`[model] 失败：HTTP ${resp.status} ${url}`);
    process.exit(1);
  }
  const total = Number(resp.headers.get('content-length')) || 0;
  let done = 0;
  const readable = Readable.fromWeb(resp.body);
  const out = fs.createWriteStream(dest);
  readable.on('data', (chunk) => {
    done += chunk.length;
    if (total > 0) {
      process.stdout.write(`\r[model] ${file}：${((done / total) * 100).toFixed(1)}%（${(done / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB）`);
    }
  });
  await new Promise((resolve, reject) => {
    readable.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
  console.log(`\n[model] 完成：${dest}（${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB）`);
  splitFile(dest);
}
for (const file of FILES) {
  const dest = path.join(OUT_DIR, file);
  if (fs.existsSync(dest)) splitFile(dest);
}

// 超过 GitHub 100MB 上限的文件拆分为 <PART_SIZE> 的分片（浏览器端拦截 fetch 合并）
function splitFile(dest) {
  const size = fs.statSync(dest).size;
  if (size <= PART_SIZE) return;
  const parts = Math.ceil(size / PART_SIZE);
  console.log(`[model] ${path.basename(dest)}（${(size / 1024 / 1024).toFixed(1)} MB）超过 GitHub 100MB 上限，拆分为 ${parts} 个分片…`);
  const buf = fs.readFileSync(dest);
  for (let i = 0; i < parts; i++) {
    const partPath = `${dest}.${i}`;
    fs.writeFileSync(partPath, buf.subarray(i * PART_SIZE, Math.min((i + 1) * PART_SIZE, size)));
    console.log(`[model]   分片 ${partPath}（${(fs.statSync(partPath).size / 1024 / 1024).toFixed(1)} MB）`);
  }
  fs.unlinkSync(dest);
  console.log(`[model] 已删除原始大文件：${dest}`);
}

// 生成分片清单：记录文件的原始字节数，供在线页面计算准确的下载进度。
// 原因：GitHub Pages 等会对 onnx 启用 gzip 传输，响应的 Content-Length 是压缩后的大小，
// 而浏览器 fetch 读到的是解压后的字节，两者口径不一致，不能作为进度分母。
{
  const onnxDir = path.join(OUT_DIR, 'onnx');
  const shardFiles = fs.existsSync(onnxDir)
    ? fs.readdirSync(onnxDir)
        .filter(f => /^model_quantized\.onnx(\.\d+)?$/.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : [];
  if (shardFiles.length) {
    const shards = shardFiles.map(file => ({ file, bytes: fs.statSync(path.join(onnxDir, file)).size }));
    const manifest = {
      model: MODEL_ID,
      totalBytes: shards.reduce((s, x) => s + x.bytes, 0),
      shards,
    };
    fs.writeFileSync(path.join(onnxDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`[model] 已生成 manifest.json（${shards.length} 个分片，共 ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB）`);
  }
}

console.log(`[model] 全部完成，输出目录：${OUT_DIR}`);
