/** Static export, served by the gateway itself (one port in laptop mode). */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  // `npm run dev`: forward API and MCP calls to a gateway on :7700
  ...(process.env.NODE_ENV === "development"
    ? { async rewrites() { return [{ source: "/api/:path*", destination: "http://127.0.0.1:7700/api/:path*" }]; } }
    : {}),
};
export default nextConfig;
