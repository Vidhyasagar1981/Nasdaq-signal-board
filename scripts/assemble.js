// Usage: node assemble.js <template.html> <engine.js> <data.json> <out.html> [--standalone]
const fs = require('fs');
const [tpl, eng, dat, out, mode] = process.argv.slice(2);
let t = fs.readFileSync(tpl, 'utf8')
  .replace('__ENGINE__', () => fs.readFileSync(eng, 'utf8'))
  .replace('__DATA__', () => fs.readFileSync(dat, 'utf8'));
if (mode === '--standalone') {
  const k = t.indexOf('<div class="wrap">');
  t = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + t.slice(0, k) + '</head><body>\n' + t.slice(k) + '\n</body></html>\n';
}
fs.writeFileSync(out, t);
console.log('wrote', out, (t.length / 1024).toFixed(0) + 'KB');
