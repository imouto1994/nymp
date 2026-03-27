/**
 * Merge Original Scripts
 *
 * Reads every text file in `game-script/` (including subdirectories),
 * splits inline speech patterns, and writes a single `merged-original.txt`.
 *
 * Lines in each file are either:
 *   - Speech:    speaker「content」  → ＃{speaker} + 「{content}」
 *   - Narration: 　text…             → kept as-is
 *
 * File sections are separated by `--------------------` and each section
 * starts with the filename (with subdirectory prefix) followed by
 * `********************`.
 *
 * Usage:
 *   node merge-original-scripts.mjs
 */

import { glob } from "glob";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

const INPUT_DIR = "game-script";
const OUTPUT_FILE = "merged-original.txt";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

const MAX_CHUNK_LINES = 900;
const CHUNKS_DIR = "original-merged-chunks";

const KNOWN_SPEAKERS = new Set([
  "圭介",
  "詩織",
  "茜",
  "蘭",
  "唯実",
  "未来",
  "女の子",
  "運転手",
  "警察官",
  "先生",
  "コーチ",
  "八百屋",
  "男",
  "女子生徒",
  "女子生徒Ａ",
  "女子生徒Ｂ",
  "女子生徒Ｃ",
  "女子生徒Ｄ",
  "男子生徒",
  "男子生徒Ａ",
  "男子生徒Ｂ",
  "男子生徒Ｃ",
  "男子生徒Ｄ",
  "男子生徒達",
  "生徒達",
  "不良生徒Ａ",
  "不良生徒Ｂ",
  "部員",
  "女子部員",
  "女子部員Ａ",
  "女子部員Ｂ",
  "？？",
]);

const SPEECH_PATTERN = /^(.+?)(「[\s\S]*」)$/;

/**
 * Try to parse an inline speech line into { speaker, content }.
 * Returns null if the line is narration.
 */
function parseSpeech(line) {
  const match = line.match(SPEECH_PATTERN);
  if (!match) return null;

  const speaker = match[1];
  const content = match[2];

  if (!KNOWN_SPEAKERS.has(speaker)) return null;

  return { speaker, content };
}

async function main() {
  const files = (await glob(`${INPUT_DIR}/**/*.txt`)).sort();

  if (files.length === 0) {
    console.error(`No .txt files found in ${INPUT_DIR}/`);
    process.exit(1);
  }

  const sections = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf-8");
    let srcLines = raw.split("\n");
    if (srcLines.at(-1) === "") srcLines.pop();

    // Convert each line: split inline speech into ＃speaker + content.
    const lines = [];
    for (const srcLine of srcLines) {
      const speech = parseSpeech(srcLine);
      if (speech) {
        lines.push(`＃${speech.speaker}`);
        lines.push(speech.content);
      } else {
        lines.push(srcLine);
      }
    }

    const sectionName = path.relative(INPUT_DIR, filePath).replace(/\.txt$/, "");
    sections.push(`${sectionName}\n${HEADER_SEPARATOR}\n${lines.join("\n")}`);
  }

  const output = sections.map((s) => `${SECTION_SEPARATOR}\n${s}`).join("\n");
  await writeFile(OUTPUT_FILE, output + "\n", "utf-8");

  console.log(`${files.length} files merged into ${OUTPUT_FILE}`);

  // Split into line-limited chunks.
  await rm(CHUNKS_DIR, { recursive: true, force: true });
  await mkdir(CHUNKS_DIR, { recursive: true });

  const chunks = [];
  let currentChunk = [];
  let currentLineCount = 0;

  for (const section of sections) {
    const sectionText = `${SECTION_SEPARATOR}\n${section}`;
    const sectionLineCount = sectionText.split("\n").length;

    if (currentLineCount + sectionLineCount > MAX_CHUNK_LINES && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLineCount = 0;
    }

    currentChunk.push(sectionText);
    currentLineCount += sectionLineCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkNum = String(i + 1).padStart(3, "0");
    const chunkPath = path.join(CHUNKS_DIR, `part-${chunkNum}.txt`);
    await writeFile(chunkPath, chunks[i].join("\n") + "\n", "utf-8");
  }

  console.log(`${chunks.length} chunks written to ${CHUNKS_DIR}/`);
}

main().catch(console.error);
