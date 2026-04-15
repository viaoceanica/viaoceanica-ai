/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: "/module/contabilidade",
  async rewrites() {
    const serverApiBase = process.env.SERVER_API_BASE_URL || "http://mod-contabilidade:4003";
    return [
      {
        source: "/api-proxy/api/:path*",
        destination: `${serverApiBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
