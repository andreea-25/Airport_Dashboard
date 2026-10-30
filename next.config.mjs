/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};
export default nextConfig;
