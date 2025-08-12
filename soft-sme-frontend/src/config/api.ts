// Declare global variables for Vite build
declare global {
  const __VITE_API_BASE_URL__: string | undefined;
  const __VITE_CLOUDFLARE_URL__: string | undefined;
}

// API Configuration for different environments
// Replace YOUR_CLOUD_URL with your actual cloud backend URL

// Detect if running in Electron
const isElectron = window && (window as any).electronAPI;

// Function to normalize URL - use HTTP for localhost
function normalizeURL(url: string): string {
  if (url && url.includes('localhost') && url.startsWith('https://')) {
    return url.replace('https://', 'http://');
  }
  return url;
}

const baseURL = normalizeURL(import.meta.env.VITE_API_BASE_URL || (typeof __VITE_API_BASE_URL__ !== 'undefined' ? __VITE_API_BASE_URL__ : 'http://localhost:5000'));
console.log('API baseURL:', import.meta.env.VITE_API_BASE_URL); // Debug: Print the API base URL
console.log('Is Electron:', isElectron); // Debug: Check if running in Electron

export const API_CONFIG = {
  development: {
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000',
    timeout: 120000, // 2 minutes for AI queries
  },
  production: {
    baseURL: import.meta.env.VITE_API_BASE_URL || (typeof __VITE_API_BASE_URL__ !== 'undefined' ? __VITE_API_BASE_URL__ : 'https://consequences-composition-uh-counters.trycloudflare.com'), // Use environment variable with fallback
    timeout: 120000, // 2 minutes for AI queries
  },
  staging: {
    baseURL: import.meta.env.VITE_API_BASE_URL || 'https://consequences-composition-uh-counters.trycloudflare.com', // Use environment variable with fallback
    timeout: 120000, // 2 minutes for AI queries
  },
  cloudflare: {
    // Replace with your actual Cloudflare tunnel URL
    baseURL: import.meta.env.VITE_CLOUDFLARE_URL || 'https://api.yourdomain.com',
    timeout: 120000, // 2 minutes for AI queries
  }
};

export function getApiConfig() {
  // Debug logging
  console.log('Environment variables:', {
    VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
    VITE_CLOUDFLARE_URL: import.meta.env.VITE_CLOUDFLARE_URL,
    MODE: import.meta.env.MODE,
    NODE_ENV: process.env.NODE_ENV,
    isElectron: isElectron
  });

  // For Electron builds, prioritize the environment variables
  if (isElectron) {
    console.log('Running in Electron - checking environment variables');
    
    // Check for Cloudflare environment variable first
    if (import.meta.env.VITE_CLOUDFLARE_URL && 
        !import.meta.env.VITE_CLOUDFLARE_URL.includes('localhost')) {
      console.log('Using cloudflare config for Electron');
      return {
        baseURL: import.meta.env.VITE_CLOUDFLARE_URL,
        timeout: 120000,
      };
    }
    
    // Check for direct API base URL
    if (import.meta.env.VITE_API_BASE_URL) {
      console.log('Using VITE_API_BASE_URL for Electron');
      return {
        baseURL: normalizeURL(import.meta.env.VITE_API_BASE_URL),
        timeout: 120000,
      };
    }
  }

  // Check for Cloudflare environment variable first (but only if it's not localhost)
  if (import.meta.env.VITE_CLOUDFLARE_URL && 
      !import.meta.env.VITE_CLOUDFLARE_URL.includes('localhost')) {
    console.log('Using cloudflare config');
    return API_CONFIG.cloudflare;
  }
  
  // Check for direct API base URL
  if (import.meta.env.VITE_API_BASE_URL) {
    console.log('Using development config with VITE_API_BASE_URL');
    return {
      baseURL: normalizeURL(import.meta.env.VITE_API_BASE_URL),
      timeout: 120000,
    };
  }
  
  if (import.meta.env.MODE === 'production') {
    console.log('Using production config');
    return {
      baseURL: normalizeURL(API_CONFIG.production.baseURL),
      timeout: 120000,
    };
  }
  if (import.meta.env.MODE === 'staging') {
    console.log('Using staging config');
    return {
      baseURL: normalizeURL(API_CONFIG.staging.baseURL),
      timeout: 120000,
    };
  }
  
  console.log('Using development config (fallback)');
  return {
    baseURL: normalizeURL(API_CONFIG.development.baseURL),
    timeout: 120000,
  };
}

// Get current environment
export const getCurrentEnvironment = (): 'development' | 'production' | 'staging' | 'cloudflare' => {
  if (import.meta.env.VITE_CLOUDFLARE_URL) return 'cloudflare';
  if (process.env.NODE_ENV === 'production') {
    // You can add logic here to detect staging vs production
    // For example, check window.location.hostname
    return 'production';
  }
  return 'development';
};

// Get current API config
export const getApiConfigOld = () => {
  const env = getCurrentEnvironment();
  return API_CONFIG[env];
}; 