import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.axis.cube',
  appName: 'AXIS 魔方',
  backgroundColor: '#0a1016',
  // Capacitor's Android launch policy must keep light icons over the gallery.
  plugins: { SystemBars: { style: 'DARK' } },
  // The isolated probe never changes the website's dist or ships by default.
  webDir: process.env.AXIS_MOBILE_PROBE === '1'
    ? 'evidence/beginner-site-2026-11-01/mobile/probe-dist'
    : 'dist',
  ios: {
    contentInset: 'never',
  },
};

export default config;
