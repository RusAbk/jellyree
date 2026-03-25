module.exports = {
  apps: [
    {
      name: 'jellyree-api',
      cwd: `${__dirname}/server`,
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        // Set to the absolute ffmpeg path if 'ffmpeg' is not available in PM2's PATH.
        // Run `which ffmpeg` on the server to find the correct path.
        // Example: FFMPEG_PATH: '/usr/bin/ffmpeg',
      },
    },
  ],
}
