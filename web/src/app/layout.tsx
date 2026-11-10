import "./globals.css";
import type { Metadata } from "next";
import { TabSync } from "./tab-sync";

export const metadata: Metadata = {
  title: "DCU Live — console",
  description: "Moderation and course data for the DCU Live app.",
  icons: { icon: "/logo.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TabSync />
        {children}
      </body>
    </html>
  );
}
