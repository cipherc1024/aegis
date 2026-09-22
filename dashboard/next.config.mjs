/** @type {import('next').NextConfig} */
const ORCH = process.env.ORCH_ORIGIN || "http://127.0.0.1:8787";

// 静态导出模式（npm run build:export）：产出 out/ 纯静态目录，可放任意静态托管，
// 无需 Node 进程、无需 orchestrator。代价是 /orch/* 代理不再存在（静态产物没有服务端
// 转发能力），因此依赖 orchestrator 的页会如实显示"离线"，而不是回退到占位数字。
const STATIC_EXPORT = process.env.STATIC_EXPORT === "1";

const nextConfig = STATIC_EXPORT
  ? {
      output: "export",
      // 静态托管无服务端，图片优化器不可用
      images: { unoptimized: true },
      // /verify → /verify/index.html，静态服务器无需额外 rewrite 规则
      trailingSlash: true,
      // ⚠️ 不要在这里设 distDir —— Next 内部把导出目标目录写成
      // `config.distDir ?? "out"`（build/index.js:380-382），一旦覆盖 distDir，
      // 导出物就会落进 distDir 而不是 out/。保持默认：.next/ 是构建中间产物
      // （两套构建共用、会被互相覆盖，但产物 out/ 与代理版共用 .next/ 的差别
      //  只影响缓存，不影响 out/ 的正确性），导出物固定落 out/。
    }
  : {
      // 统一入口：浏览器只访问同源 /orch/*，由 Next 转发到 orchestrator。
      // 好处：orchestrator 不必开 CORS，内网地址也不进浏览器；生产部署时只改 ORCH_ORIGIN。
      async rewrites() {
        return [{ source: "/orch/:path*", destination: `${ORCH}/:path*` }];
      },
    };

export default nextConfig;
