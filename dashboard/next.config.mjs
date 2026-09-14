/** @type {import('next').NextConfig} */
const ORCH = process.env.ORCH_ORIGIN || "http://127.0.0.1:8787";

const nextConfig = {
  // 统一入口：浏览器只访问同源 /orch/*，由 Next 转发到 orchestrator。
  // 好处：orchestrator 不必开 CORS，内网地址也不进浏览器；生产部署时只改 ORCH_ORIGIN。
  async rewrites() {
    return [{ source: "/orch/:path*", destination: `${ORCH}/:path*` }];
  },
};

export default nextConfig;
