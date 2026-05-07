import * as fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace duplicate aria-labels
code = code.replace(/aria-label="([^"]+)" aria-label="\1"/g, 'aria-label="$1"');
code = code.replace(/aria-label=\{([^}]+)\} aria-label=\{\1\}/g, 'aria-label={$1}');

// Also check for multiple different ones? Just delete duplicate substrings
let prevCode = null;
while (code !== prevCode) {
  prevCode = code;
  code = code.replace(/(aria-label=(?:"[^"]+"|{[^}]+}))\s+\1/g, '$1');
}

fs.writeFileSync('src/App.tsx', code);
console.log("Cleanup successful!");
