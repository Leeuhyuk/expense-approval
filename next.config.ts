import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 폴더의 lockfile 자동 감지로 인한 워크스페이스 루트 오인 방지
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
