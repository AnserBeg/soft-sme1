const fs = require('fs-extra');
const path = require('path');

const mainJsPath = path.resolve(__dirname, '../dist-electron/main.js');
const mainCjsPath = path.resolve(__dirname, '../dist-electron/main.cjs');

fs.move(mainJsPath, mainCjsPath, { overwrite: true })
  .then(() => {
    console.log('Successfully renamed main.js to main.cjs');
  })
  .catch(err => {
    console.error('Error renaming main.js to main.cjs:', err);
    process.exit(1);
  });

// Removed direct copy of preload.ts to preload.js. Preload script should be compiled by tsc. 