#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';

const filePath = process.argv[2];
if (!filePath) {
  process.stderr.write('Usage: node md-to-portable-text.js <markdown-file>\n');
  process.exit(1);
}

let markdown;
try {
  markdown = fs.readFileSync(path.resolve(filePath), 'utf8');
} catch (err) {
  process.stderr.write(`Cannot read file: ${err.message}\n`);
  process.exit(1);
}

// Strip frontmatter (--- ... ---)
const fmMatch = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
const clean = fmMatch ? markdown.slice(fmMatch[0].length) : markdown;

try {
  const blocks = markdownToPortableText(clean);
  process.stdout.write(JSON.stringify(blocks, null, 2) + '\n');
} catch (err) {
  process.stderr.write(`Conversion error: ${err.message}\n`);
  process.exit(1);
}

function markdownToPortableText(markdown) {
  const blocks = [];
  let blockCounter = 0;
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, `h${headingMatch[1].length}`, parseInline(headingMatch[2].trim(), `b${blockCounter}`)));
      i++; continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)/);
    if (ulMatch) {
      blockCounter++;
      const block = makeBlock(`b${blockCounter}`, 'normal', parseInline(ulMatch[2].trim(), `b${blockCounter}`));
      block.listItem = 'bullet';
      block.level = ulMatch[1].length >= 4 ? 2 : 1;
      blocks.push(block);
      i++; continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.*)/);
    if (olMatch) {
      blockCounter++;
      const block = makeBlock(`b${blockCounter}`, 'normal', parseInline(olMatch[2].trim(), `b${blockCounter}`));
      block.listItem = 'number';
      block.level = olMatch[1].length >= 4 ? 2 : 1;
      blocks.push(block);
      i++; continue;
    }

    // Blockquote
    const quoteMatch = line.match(/^>\s*(.*)/);
    if (quoteMatch) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, 'blockquote', parseInline(quoteMatch[1].trim(), `b${blockCounter}`)));
      i++; continue;
    }

    // Normal paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].match(/^\s*\d+[.)]\s/) &&
      !lines[i].match(/^>\s/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blockCounter++;
      blocks.push(makeBlock(`b${blockCounter}`, 'normal', parseInline(paraLines.join(' ').trim(), `b${blockCounter}`)));
    }
  }

  return blocks;
}

function makeBlock(key, style, parsed) {
  return {
    _type: 'block',
    _key: key,
    style: style,
    markDefs: parsed.markDefs,
    children: parsed.children,
  };
}

function parseInline(text, blockKey) {
  const children = [];
  const markDefs = [];
  let childCounter = 0;
  let linkCounter = 0;

  const pattern = /(\[([^\]]+)\]\(([^)]+)\))|\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`(.+?)`|(https?:\/\/[^\s,)]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.substring(lastIndex, match.index);
      if (plain) {
        childCounter++;
        children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: plain, marks: [] });
      }
    }

    childCounter++;
    const ck = `${blockKey}c${childCounter}`;

    if (match[1]) {
      linkCounter++;
      const lk = `${blockKey}link${linkCounter}`;
      markDefs.push({ _type: 'link', _key: lk, href: match[3] });
      children.push({ _type: 'span', _key: ck, text: match[2], marks: [lk] });
    } else if (match[4]) {
      children.push({ _type: 'span', _key: ck, text: match[4], marks: ['strong', 'em'] });
    } else if (match[5]) {
      children.push({ _type: 'span', _key: ck, text: match[5], marks: ['strong'] });
    } else if (match[6]) {
      children.push({ _type: 'span', _key: ck, text: match[6], marks: ['em'] });
    } else if (match[7]) {
      children.push({ _type: 'span', _key: ck, text: match[7], marks: ['strike'] });
    } else if (match[8]) {
      children.push({ _type: 'span', _key: ck, text: match[8], marks: ['code'] });
    } else if (match[9]) {
      let url = match[9];
      let trailing = '';
      if (/[.;:]$/.test(url)) { trailing = url.slice(-1); url = url.slice(0, -1); }
      linkCounter++;
      const lk = `${blockKey}link${linkCounter}`;
      markDefs.push({ _type: 'link', _key: lk, href: url, blank: true });
      children.push({ _type: 'span', _key: ck, text: url, marks: [lk] });
      if (trailing) {
        childCounter++;
        children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: trailing, marks: [] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    childCounter++;
    children.push({ _type: 'span', _key: `${blockKey}c${childCounter}`, text: text.substring(lastIndex), marks: [] });
  }

  if (children.length === 0) {
    children.push({ _type: 'span', _key: `${blockKey}c1`, text: '', marks: [] });
  }

  return { children, markDefs };
}
