/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // 引擎工作台（AutoMode）按 easy-director 的约定关闭严格模式
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
};

export default nextConfig;
