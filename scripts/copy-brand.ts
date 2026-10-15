// Copies brand assets from inputs/brand (the source of truth) into web/public/brand, which is git-ignored and served as
// static assets. PWA icons are placeholder copies of the wordmark until square icons are supplied.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'inputs', 'brand');
const dst = path.join(root, 'web', 'public', 'brand');
mkdirSync(dst, { recursive: true });

const files = ['app_banner-web.jpg', 'logo_black.png', 'logo_black.svg', 'logo_white.png', 'logo_white.svg'];
for (const f of files) {
  const from = path.join(src, f);
  if (!existsSync(from)) {
    console.warn(`brand:copy — missing ${from}`);
    continue;
  }
  copyFileSync(from, path.join(dst, f));
}
copyFileSync(path.join(src, 'logo_black.png'), path.join(dst, 'icon-192.png'));
copyFileSync(path.join(src, 'logo_black.png'), path.join(dst, 'icon-512.png'));
console.log(`brand:copy — ${files.length} files → web/public/brand`);
