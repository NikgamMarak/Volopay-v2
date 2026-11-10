// Entry point. Checks that every file was uploaded before starting, so a missing
// file gives a clear message instead of a confusing error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const required = [
  'routes.js', 'db.js', 'auth.js', 'proposals.js', 'mcp.js', 'views.js', 'markdown.js',
  'styles.css', 'client-common.js', 'client-dashboard.js', 'client-editor.js', 'client-document.js',
];
const missing = required.filter((f) => !fs.existsSync(path.join(here, f)));
if (missing.length) {
  console.error(`Pitchpad cannot start. These files are missing next to server.js: ${missing.join(', ')}`);
  console.error('Fix: upload every file from pitchpad.zip to the top level of your GitHub repository, not inside a folder.');
  process.exit(1);
}

await import('./routes.js');
