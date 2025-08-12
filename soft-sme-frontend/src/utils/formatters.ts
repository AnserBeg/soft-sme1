import { getApiConfig } from '../config/api';
import defaultLogo from '../assets/default-logo.png';

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export const formatPercentage = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
};

export const formatDate = (date: string | Date): string => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
};

/**
 * Helper function to get the correct logo URL for different environments
 * Handles Windows file paths, Unix paths, and relative paths
 */
export const getLogoUrl = (logo_url: string | undefined): string => {
  console.log('getLogoUrl called with:', logo_url);
  
  // If no logo URL provided, return default
  if (!logo_url) {
    console.log('No logo URL provided, using default');
    return defaultLogo;
  }
  
  // If it's already a full URL (starts with http/https), return as is
  if (logo_url.startsWith('http://') || logo_url.startsWith('https://')) {
    console.log('Logo URL is already a full URL:', logo_url);
    return logo_url;
  }
  
  // If it's a Windows file path (contains backslashes or drive letter), extract filename
  if (logo_url.includes('\\') || logo_url.includes(':/') || logo_url.includes(':\\')) {
    // Handle Windows paths like "C:\uploads\filename.png" or "C:/uploads/filename.png"
    const filename = logo_url.split(/[\\\/]/).pop() || logo_url;
    console.log('Extracted filename from Windows path:', filename);
    
    // Validate filename
    if (!filename || filename === logo_url) {
      console.warn('Could not extract valid filename from Windows path, using default');
      return defaultLogo;
    }
    
    const { baseURL } = getApiConfig();
    const finalUrl = `${baseURL.replace(/\/$/, '')}/uploads/${filename}`;
    console.log('Built final URL from Windows path:', finalUrl);
    return finalUrl;
  }
  
  // If it's a Unix-style path (starts with /), extract filename
  if (logo_url.startsWith('/')) {
    const filename = logo_url.split('/').pop() || logo_url;
    console.log('Extracted filename from Unix path:', filename);
    
    // Validate filename
    if (!filename || filename === logo_url) {
      console.warn('Could not extract valid filename from Unix path, using default');
      return defaultLogo;
    }
    
    const { baseURL } = getApiConfig();
    const finalUrl = `${baseURL.replace(/\/$/, '')}/uploads/${filename}`;
    console.log('Built final URL from Unix path:', finalUrl);
    return finalUrl;
  }
  
  // If it's just a filename, validate it first
  if (logo_url.includes('\\') || logo_url.includes(':/') || logo_url.includes(':\\')) {
    console.warn('Invalid filename format, using default');
    return defaultLogo;
  }
  
  // If it's just a filename, build the full URL
  const { baseURL } = getApiConfig();
  const finalUrl = `${baseURL.replace(/\/$/, '')}/uploads/${logo_url}`;
  console.log('Built final URL from filename:', finalUrl);
  return finalUrl;
}; 