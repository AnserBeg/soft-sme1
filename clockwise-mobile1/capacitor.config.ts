import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Must be a valid Java package name for Android/iOS.
  appId: 'com.clockwise.mobile',
  appName: 'clockwise-mobile',
  webDir: 'dist',
  // In production we serve the bundled app; remove remote dev server URL.
  bundledWebRuntime: false,
  plugins: {
    Preferences: {
      configure: {
        group: 'TimeTrackingApp'
      }
    }
  }
};

export default config;
