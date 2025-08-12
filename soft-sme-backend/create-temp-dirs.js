const fs = require('fs');
const path = require('path');

// Create temp-uploads directory
const tempUploadsDir = path.join(__dirname, 'temp-uploads');
if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir, { recursive: true });
  console.log('Created temp-uploads directory');
} else {
  console.log('temp-uploads directory already exists');
}

// Create backups directory if it doesn't exist
const backupsDir = path.join(__dirname, 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
  console.log('Created backups directory');
} else {
  console.log('backups directory already exists');
}

console.log('Directory setup complete!'); 