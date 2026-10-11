#!/usr/bin/env node
/* Inlines core.js into the standalone HTML files so there is only ever one
   copy of the scheduling rules. Edit core.js, run this, commit the output. */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = readFileSync(join(root, 'core.js'), 'utf8');

// Strip the module syntax: the inlined copy runs as a plain classic script.
const inlined = core
  .replace(/^export\s+(const|function|class|let)\s/gm, '$1 ')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

const MARK_START = '/* ==CORE:START== */';
const MARK_END = '/* ==CORE:END== */';

function build(name) {
  const srcPath = join(root, 'src', name);
  let html = readFileSync(srcPath, 'utf8');
  const a = html.indexOf(MARK_START), b = html.indexOf(MARK_END);
  if (a === -1 || b === -1) throw new Error(`${name}: missing CORE markers`);
  html = html.slice(0, a + MARK_START.length) + '\n' + inlined + '\n' + html.slice(b);

  // The web clock carries a baked-in copy of the data as a last-resort fallback.
  if (html.includes('__FALLBACK__')) {
    const data = readFileSync(join(root, 'overrides.json'), 'utf8');
    html = html.replace('__FALLBACK__', JSON.stringify(JSON.parse(data)));
  }
  writeFileSync(join(root, name), html);
  console.log(`built ${name}  (${(html.length / 1024).toFixed(1)} KB)`);
}

for (const f of ['clock.html', 'schedule-editor.html', 'office.html']) {
  try { build(f); } catch (e) { console.log(`skipped ${f}: ${e.message}`); }
}

// The extension imports core.js directly, so it just needs a fresh copy.
mkdirSync(join(root, 'extension'), { recursive: true });
copyFileSync(join(root, 'core.js'), join(root, 'extension', 'core.js'));
console.log('copied core.js into extension/');
