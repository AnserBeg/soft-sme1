import fs from 'fs';
import path from 'path';
import axios from 'axios';

const projectRoot = path.resolve(__dirname, '..', '..');
const defaultLogoPath = path.join(projectRoot, 'assets', 'default-logo.png');

const normalizeLocalLogoPath = (logoUrl: string) => {
  const trimmed = logoUrl.trim();
  if (!trimmed) {
    return null;
  }

  let relativePath = trimmed.replace(/\\/g, '/');

  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return null;
  }

  if (path.isAbsolute(relativePath) && !relativePath.startsWith('/uploads')) {
    return relativePath;
  }

  if (relativePath.startsWith('/')) {
    relativePath = relativePath.replace(/^\/+/, '');
  }

  // Some legacy values might just be the filename
  if (!relativePath.startsWith('uploads/')) {
    relativePath = path.join('uploads', relativePath);
  }

  const absolutePath = path.join(projectRoot, relativePath);
  return absolutePath;
};

export const getLogoImageSource = async (
  logoUrl?: string | null
): Promise<Buffer | string | null> => {
  if (logoUrl) {
    const trimmed = logoUrl.trim();

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      try {
        const response = await axios.get<ArrayBuffer>(trimmed, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
      } catch (error) {
        console.error('Failed to download logo from URL for PDF generation:', error);
      }
    } else {
      const absolutePath = normalizeLocalLogoPath(trimmed);
      if (absolutePath && fs.existsSync(absolutePath)) {
        return absolutePath;
      }
    }
  }

  if (fs.existsSync(defaultLogoPath)) {
    return defaultLogoPath;
  }

  return null;
};
