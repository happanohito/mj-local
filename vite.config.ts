import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'MJ_');
  const host = env.MJ_HOST || 'localhost';

  return {
    plugins: [react()],
    base: env.MJ_BASE_PATH || '/',
    server: {
      host: env.MJ_BIND_HOST || host,
      port: Number(env.MJ_PORT || '4173'),
      strictPort: true,
      allowedHosts: [host],
    },
  };
});
