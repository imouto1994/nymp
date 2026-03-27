#!/usr/bin/env python3
"""
decode_scripts.py - Decompress and extract text from nymp encoded script files.

The game stores its scripts as LZSS-compressed binary bytecode. Each file
has a 24-byte header followed by compressed data:

    +0x00  16 bytes   zeros (padding)
    +0x10  u32le      compressed data size (== file size - 24)
    +0x14  u32le      decompressed data size
    +0x18  ...        LZSS-compressed bytecode

After decompression, the bytecode contains length-prefixed Shift-JIS strings:

    [u32le byte_length] [cp932 text bytes]

These strings fall into several categories:
  - Dialogue:     starts with 「 — spoken lines with speaker name attached
  - Narration:    starts with \u3000 (ideographic space) — inner monologue / SFX
  - Speaker name: Japanese text that precedes a dialogue line
  - Labels:       scene markers like "10_オープニング_000" — skipped
  - Resources:    ASCII identifiers like "black", "se001" — skipped

USAGE
-----
    python decode_scripts.py                     # decode all, write to game-script/
    python decode_scripts.py -o custom_dir/      # decode all, write to custom dir
    python decode_scripts.py -v                  # verbose per-file stats
"""

import struct
import os
import sys
import argparse

INPUT_DIR = "encoded-scripts"
OUTPUT_DIR = "game-script"

PROTAGONIST_NAME = "圭介"

WINDOW_SIZE = 4096
WINDOW_FILL = 0x00
WINDOW_INIT_POS = WINDOW_SIZE - 18  # 4078


def decompress_lzss(data: bytes) -> bytes:
    """
    Decompress LZSS data from a 24-byte-header script file.

    Flag bytes are read LSB-first: bit=1 means the next byte is a literal;
    bit=0 means the next two bytes encode a back-reference as:
        offset = byte1 | ((byte2 & 0xF0) << 4)   (12-bit window position)
        length = (byte2 & 0x0F) + 3               (3..18 bytes to copy)
    """
    decompressed_size = struct.unpack_from('<I', data, 0x14)[0]
    src_data = data[0x18:]

    window = bytearray([WINDOW_FILL] * WINDOW_SIZE)
    win_pos = WINDOW_INIT_POS
    output = bytearray()
    src = 0

    while src < len(src_data) and len(output) < decompressed_size:
        flags = src_data[src]
        src += 1

        for bit in range(8):
            if src >= len(src_data) or len(output) >= decompressed_size:
                break

            if flags & (1 << bit):
                byte = src_data[src]
                src += 1
                output.append(byte)
                window[win_pos] = byte
                win_pos = (win_pos + 1) % WINDOW_SIZE
            else:
                if src + 1 >= len(src_data):
                    break
                b1 = src_data[src]
                b2 = src_data[src + 1]
                src += 2

                offset = b1 | ((b2 & 0xF0) << 4)
                length = (b2 & 0x0F) + 3

                for j in range(length):
                    byte = window[(offset + j) % WINDOW_SIZE]
                    output.append(byte)
                    window[win_pos] = byte
                    win_pos = (win_pos + 1) % WINDOW_SIZE

    return bytes(output)


def extract_strings(dec: bytes) -> list[tuple[int, str]]:
    """
    Scan decompressed bytecode for length-prefixed Shift-JIS strings.
    Returns a list of (offset, decoded_text) tuples.
    """
    entries = []
    i = 0
    n = len(dec)

    while i < n - 4:
        slen = struct.unpack_from('<I', dec, i)[0]
        if 2 <= slen <= 2000 and i + 4 + slen <= n:
            raw = dec[i + 4 : i + 4 + slen]
            try:
                txt = raw.decode('cp932')
            except (UnicodeDecodeError, ValueError):
                i += 1
                continue

            if len(txt) >= 1 and all(ord(c) >= 0x20 for c in txt):
                entries.append((i, txt))
                i += 4 + slen
                continue
        i += 1

    return entries


def _is_label(txt: str) -> bool:
    """Labels are scene markers like '10_オープニング_000' or 'a_xxx_NNN'."""
    return '_' in txt and any(c.isdigit() for c in txt)


def _is_resource(txt: str) -> bool:
    """Resource names are pure ASCII: 'black', 'se001', 'op_001', etc.
    Strings containing '%' are variable references (e.g. '%1'), not resources."""
    return '%' not in txt and all(ord(c) < 0x80 for c in txt)


def _is_dialogue(txt: str) -> bool:
    return txt.startswith('\u300c')  # 「


def _is_narration(txt: str) -> bool:
    return txt.startswith('\u3000')  # Ideographic space


def build_script_lines(entries: list[tuple[int, str]]) -> list[str]:
    """
    Walk the extracted string entries and produce output lines:
      - Speaker + dialogue combined:  speaker「text」
      - Narration output as-is:       \u3000narration text
    Labels and resource identifiers are skipped.
    """
    lines = []
    speaker = None

    for _, txt in entries:
        txt = txt.replace('%1', PROTAGONIST_NAME)

        if _is_label(txt) or _is_resource(txt):
            continue

        if _is_dialogue(txt):
            if speaker:
                lines.append(f"{speaker}{txt}")
            else:
                lines.append(txt)
            speaker = None
        elif _is_narration(txt):
            lines.append(txt)
            speaker = None
        else:
            speaker = txt

    return lines


def process_file(
    filepath: str, output_dir: str | None, verbose: bool
) -> tuple[int, bool]:
    """
    Decode one script file. Returns (line_count, success).
    """
    try:
        with open(filepath, 'rb') as f:
            raw = f.read()
    except OSError as ex:
        print(f"[ERROR] Cannot read {filepath}: {ex}", file=sys.stderr)
        return 0, False

    if len(raw) < 24:
        if verbose:
            print(f"  {os.path.basename(filepath):30s}  skipped (too small)")
        return 0, False

    try:
        dec = decompress_lzss(raw)
    except Exception as ex:
        print(f"[ERROR] Decompression failed for {filepath}: {ex}", file=sys.stderr)
        return 0, False

    expected = struct.unpack_from('<I', raw, 0x14)[0]
    if len(dec) != expected:
        print(
            f"[WARN] {filepath}: decompressed {len(dec)} bytes, expected {expected}",
            file=sys.stderr,
        )

    entries = extract_strings(dec)
    lines = build_script_lines(entries)

    if not lines:
        if verbose:
            print(f"  {os.path.basename(filepath):30s}  skipped (no text)")
        return 0, True

    if output_dir:
        text = '\n'.join(lines) + '\n'
        rel = os.path.relpath(filepath, INPUT_DIR)
        out_name = rel + '.txt'
        out_path = os.path.join(output_dir, out_name)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(text)
        if verbose:
            print(f"  {rel:30s}  {len(lines):4d} lines")
    else:
        sys.stdout.reconfigure(encoding='utf-8')
        print(f"=== {os.path.basename(filepath)} ===\n")
        for line in lines:
            print(line)
        print()

    return len(lines), True


def collect_files(input_dir: str) -> list[str]:
    """Collect all script files (excluding hidden files) from input_dir, sorted."""
    files = []
    for root, dirs, filenames in os.walk(input_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        for fn in filenames:
            if fn.startswith('.'):
                continue
            files.append(os.path.join(root, fn))
    return sorted(files)


def main():
    parser = argparse.ArgumentParser(
        description="Decompress and extract text from nymp encoded script files"
    )
    parser.add_argument(
        'input', nargs='?', default=INPUT_DIR,
        help=f'Input file or directory (default: {INPUT_DIR}/)',
    )
    parser.add_argument(
        '-o', '--out', default=None,
        help=f'Output directory (default: {OUTPUT_DIR}/ when processing a directory)',
    )
    parser.add_argument('-v', '--verbose', action='store_true')
    args = parser.parse_args()

    if os.path.isdir(args.input):
        files = collect_files(args.input)
        if not files:
            print(f"No files found in {args.input}/")
            sys.exit(1)

        out_dir = args.out or OUTPUT_DIR
        print(f"Processing {len(files)} files from {args.input}/ ...")

        total_lines = 0
        total_ok = 0
        for path in files:
            nl, ok = process_file(path, out_dir, args.verbose)
            total_lines += nl
            total_ok += ok

        print(f"\nDone. {total_ok}/{len(files)} files decoded, {total_lines} text lines total.")
        print(f"Output: {os.path.abspath(out_dir)}/")

    elif os.path.isfile(args.input):
        process_file(args.input, args.out, args.verbose)

    else:
        print(f"Error: {args.input!r} not found", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
