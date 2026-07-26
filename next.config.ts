import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // @ts-ignore - allow ngrok origin for Next.js HMR
  allowedDevOrigins: ['shut-paralyses-giggling.ngrok-free.dev'],
};

export default nextConfig;
