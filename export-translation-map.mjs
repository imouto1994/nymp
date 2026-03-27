/**
 * Export Translation Map
 *
 * Reads `original-merged-chunks/` and `translated-merged-chunks/`, parses
 * them into matching sections, and builds a JSON mapping of every unique
 * original line to its translated counterpart.
 *
 * Speech source lines (＃ in original, $ in translated) and their following
 * content lines are merged into a single entry:
 *
 *   Original:  ＃茜                →  key:   "〈茜〉：だ、だって！？"
 *              「だ、だって！？」    value: "Akane: "W-what do you mean!?""
 *
 * Narration lines are mapped directly:
 *
 *   key:   "　僕の名前は、葉山圭介。"
 *   value: "My name is Keisuke Hayama."
 *
 * Empty lines are skipped. First occurrence wins for duplicates.
 *
 * Output: `translation-map.json`
 *
 * Usage:
 *   node export-translation-map.mjs
 */

import { readFile, writeFile } from "fs/promises";
import { glob } from "glob";

const ORIGINAL_CHUNKS_DIR = "original-merged-chunks";
const TRANSLATED_CHUNKS_DIR = "translated-merged-chunks";
const OUTPUT_FILE = "translation-map.json";

async function readChunks(dir) {
  const files = (await glob(`${dir}/part-*.txt`)).sort();
  const parts = await Promise.all(files.map((f) => readFile(f, "utf-8")));
  return parts.join("\n");
}

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

const SPEAKER_MAP = new Map([
  ["圭介", "Keisuke"],
  ["詩織", "Shiori"],
  ["茜", "Akane"],
  ["蘭", "Ran"],
  ["唯実", "Yuimi"],
  ["未来", "Mirai"],
  ["女の子", "Girl"],
  ["運転手", "Driver"],
  ["警察官", "Police Officer"],
  ["先生", "Teacher"],
  ["コーチ", "Coach"],
  ["八百屋", "Greengrocer"],
  ["男", "Man"],
  ["女子生徒", "Female Student"],
  ["女子生徒Ａ", "Female Student A"],
  ["女子生徒Ｂ", "Female Student B"],
  ["女子生徒Ｃ", "Female Student C"],
  ["女子生徒Ｄ", "Female Student D"],
  ["男子生徒", "Male Student"],
  ["男子生徒Ａ", "Male Student A"],
  ["男子生徒Ｂ", "Male Student B"],
  ["男子生徒Ｃ", "Male Student C"],
  ["男子生徒Ｄ", "Male Student D"],
  ["男子生徒達", "Male Students"],
  ["生徒達", "Students"],
  ["不良生徒Ａ", "Delinquent A"],
  ["不良生徒Ｂ", "Delinquent B"],
  ["部員", "Club Member"],
  ["女子部員", "Female Club Member"],
  ["女子部員Ａ", "Female Club Member A"],
  ["女子部員Ｂ", "Female Club Member B"],
  ["？？", "??"],
]);

const JP_BRACKET_PAIRS = [
  ["「", "」"],
];

function parseSections(text) {
  const raw = text.split(`${SECTION_SEPARATOR}\n`);
  const sections = new Map();

  for (const block of raw) {
    const headerEnd = block.indexOf(`\n${HEADER_SEPARATOR}\n`);
    if (headerEnd === -1) continue;

    const fileName = block.slice(0, headerEnd).trim();
    const body = block.slice(headerEnd + HEADER_SEPARATOR.length + 2);

    sections.set(fileName, body.split("\n"));
  }

  return sections;
}

function stripBracketsJP(line) {
  for (const [open, close] of JP_BRACKET_PAIRS) {
    if (line.startsWith(open) && line.endsWith(close)) {
      return line.slice(1, -1);
    }
  }
  return line;
}

function stripBracketsEN(line) {
  if (line.startsWith("\u201C") && line.endsWith("\u201D")) {
    return line.slice(1, -1);
  }
  return line;
}

async function main() {
  const originalText = await readChunks(ORIGINAL_CHUNKS_DIR);
  const translatedText = await readChunks(TRANSLATED_CHUNKS_DIR);

  const origSections = parseSections(originalText);
  const transSections = parseSections(translatedText);

  const map = new Map();
  let totalPairs = 0;
  let duplicates = 0;
  const unknownSpeakers = new Set();

  for (const [fileName, origLines] of origSections) {
    if (!transSections.has(fileName)) continue;
    const transLines = transSections.get(fileName);

    let i = 0;
    while (i < origLines.length && i < transLines.length) {
      const origLine = origLines[i];
      const transLine = transLines[i];

      if (origLine.length === 0) {
        i++;
        continue;
      }

      if (origLine.startsWith("＃")) {
        const speakerJP = origLine.slice(1);
        const speakerEN = SPEAKER_MAP.get(speakerJP);

        if (!speakerEN) {
          unknownSpeakers.add(speakerJP);
        }

        if (i + 1 < origLines.length && i + 1 < transLines.length) {
          const contentOrig = origLines[i + 1];
          const contentTrans = transLines[i + 1];

          const key = `〈${speakerJP}〉：${stripBracketsJP(contentOrig)}`;
          const value = `${speakerEN || speakerJP}: \u201C${stripBracketsEN(contentTrans)}\u201D`;

          if (!map.has(key)) {
            map.set(key, value);
            totalPairs++;
          } else {
            duplicates++;
          }

          i += 2;
        } else {
          i++;
        }
        continue;
      }

      if (!map.has(origLine)) {
        map.set(origLine, transLine);
        totalPairs++;
      } else {
        duplicates++;
      }

      i++;
    }
  }

  const obj = Object.fromEntries(map);
  await writeFile(OUTPUT_FILE, JSON.stringify(obj, null, 2), "utf-8");

  console.log("— Summary —");
  console.log(`  Sections processed: ${origSections.size}`);
  console.log(`  Unique entries:     ${totalPairs}`);
  console.log(`  Duplicates skipped: ${duplicates}`);
  console.log(`  Exported to:        ${OUTPUT_FILE}`);

  if (unknownSpeakers.size > 0) {
    console.log(
      `\n  Unknown speakers: ${[...unknownSpeakers].join(", ")}`,
    );
  }
}

main().catch(console.error);
