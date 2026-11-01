/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
};

export default nextConfig;
