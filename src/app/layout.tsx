import type { Metadata, Viewport } from "next";
import { Nunito, Nunito_Sans, Fraunces } from "next/font/google";
import { Providers } from "@/components/shared/Providers";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Warm editorial serif for the public blog's display headings.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Blog Saver",
  description: "Import, rescue, and keep your blogs alive.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${nunito.variable} ${nunitoSans.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-screen">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
