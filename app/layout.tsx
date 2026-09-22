import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Navbar from "@/components/Navbar";
import OfflineIndicator from "@/components/OfflineIndicator";
import Toaster from "@/components/Toaster";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pin the max scale so phone browsers never zoom the layout out of shape;
  // user pinch-zoom (accessibility) stays enabled.
  maximumScale: 5,
};

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  title: "HillSense AI — Community hazard intelligence for the Himalayas",
  description:
    "Know the hazard before you reach it. Community-powered, AI-checked mountain hazard alerts for Himachal Pradesh: report by text, photo or voice; see safety-checked hazards near you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <OfflineIndicator />
        <Navbar />
        <main className="flex-1 pb-10">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
