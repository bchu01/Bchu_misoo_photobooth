import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Do not generate AGENTS.md / CLAUDE.md into the app directory.
  agentRules: false,
};

export default nextConfig;
