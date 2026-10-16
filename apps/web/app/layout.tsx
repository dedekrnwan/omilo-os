import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/bricolage-grotesque/latin-500.css";
import "@fontsource/bricolage-grotesque/latin-600.css";
import "@fontsource/fraunces/latin-400.css";
import "@fontsource/fraunces/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "remixicon/fonts/remixicon.css";
import "./globals.css";
import type { Metadata } from "next";
import Shell from "@/components/Shell";

const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const metadata: Metadata = {
  title: "Saga OS", description: "Run your company with a team of AI helpers",
  manifest: `${base}/manifest.webmanifest`, icons: { icon: [{ url: `${base}/saga.svg`, type: "image/svg+xml" }, { url: `${base}/icon-192.png`, sizes: "192x192" }], apple: `${base}/icon-192.png` },
  appleWebApp: { capable: true, title: "Saga OS", statusBarStyle: "default" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
