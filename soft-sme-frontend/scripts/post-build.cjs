const fs = require('fs-extra');
const path = require('path');

async function copyFrontendDist() {
  try {
    const sourceDir = path.join(__dirname, '..', 'frontend-dist');
    const targetDir = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'frontend-dist');
    
    console.log('Copying frontend-dist to resources...');
    console.log('Source:', sourceDir);
    console.log('Target:', targetDir);
    
    // Ensure target directory exists
    await fs.ensureDir(targetDir);
    
    // Copy files
    await fs.copy(sourceDir, targetDir, { overwrite: true });
    
    console.log('Successfully copied frontend-dist to resources');
  } catch (error) {
    console.error('Error copying frontend-dist:', error);
    process.exit(1);
  }
}

copyFrontendDist(); 