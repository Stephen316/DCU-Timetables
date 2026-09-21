import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DCU Timetable — console",
  description: "Moderation and course data for the DCU Timetable app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
