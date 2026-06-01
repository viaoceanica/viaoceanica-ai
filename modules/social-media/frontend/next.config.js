const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  basePath: '/module/social-media',
  async rewrites() {
    const apiBase = process.env.SERVER_API_BASE_URL || 'http://mod-social-media:4005';
    return [
      { source: '/api/:path*', destination: `${apiBase}/api/v1/:path*` },
      { source: '/health', destination: `${apiBase}/health` },
      { source: '/ready', destination: `${apiBase}/ready` }
    ];
  }
};
module.exports = nextConfig;
