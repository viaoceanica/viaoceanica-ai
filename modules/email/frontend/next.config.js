/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: "/module/email",
  output: "standalone",
  async rewrites() {
    const serverApiBase = process.env.SERVER_API_BASE_URL || "http://mod-email:4004";
    return [
      {
        source: "/api-proxy/api/:path*",
        destination: `${serverApiBase}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
