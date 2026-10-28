import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // 自托管字体允许跨域：tasteskill 的检查器从另一个端口渲染页面快照时也能拿到真字体。字体是公开资源，没有泄露面
  async headers() {
    return [{ source: "/_next/static/media/:path*", headers: [{ key: "Access-Control-Allow-Origin", value: "*" }] }];
  },
};

export default config;
