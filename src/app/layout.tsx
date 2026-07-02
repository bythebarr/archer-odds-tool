import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "archer-odds-tool",
  description: "MLB odds line-shopping, hit-rates, and EV — research/discovery only.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <footer className="mx-auto w-full max-w-2xl px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          For informational and research purposes only. Not betting advice; odds, hit-rates, and EV
          figures are not guaranteed accurate and carry no warranty. This tool does not facilitate
          bet placement. If you or someone you know has a gambling problem, call or text the National
          Problem Gambling Helpline at 1-800-522-4700.
        </footer>
      </body>
    </html>
  );
}
