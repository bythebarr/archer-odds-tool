import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { SlipProvider } from "@/lib/slip/SlipContext";
import { SlipButton } from "@/components/slip/SlipButton";
import { THEME_COLORS } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION = "Every sport, one board — model leans, hit-rates, and EV across MLB, UFC, tennis & soccer. Research/discovery only.";

export const metadata: Metadata = {
  title: {
    default: "archer — every-sport odds, model leans & EV",
    template: "%s · archer",
  },
  description: SITE_DESCRIPTION,
  appleWebApp: {
    title: "archer",
    statusBarStyle: "default",
  },
  openGraph: {
    siteName: "archer",
    title: "archer — every-sport odds, model leans & EV",
    description: SITE_DESCRIPTION,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "archer — every-sport odds, model leans & EV",
    description: SITE_DESCRIPTION,
  },
};

// Runs before first paint (see the Next.js "preventing flash before
// hydration" guide) so a stored/system dark preference never flashes light.
// Deliberately not using the `viewport.themeColor` metadata export: Next
// renders that as its own React-managed <meta> tag, which would fight this
// script (and ThemeToggle) for ownership of the same tag and duplicate it.
// This plain, un-managed <meta id="theme-color-meta"> below is the only one.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");var resolved=(t==="light"||t==="dark")?t:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",resolved);var m=document.getElementById("theme-color-meta");if(m)m.setAttribute("content",resolved==="dark"?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta id="theme-color-meta" name="theme-color" content={THEME_COLORS.light} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <SlipProvider>
          <Suspense fallback={<div className="h-[57px] border-b border-border" />}>
            <SiteNav />
          </Suspense>
          {children}
          <footer className="mx-auto w-full max-w-2xl px-4 py-6 text-center text-xs text-muted-foreground">
            For informational and research purposes only. Not betting advice; odds, hit-rates, and EV
            figures are not guaranteed accurate and carry no warranty. This tool does not facilitate
            bet placement. If you or someone you know has a gambling problem, call or text the National
            Problem Gambling Helpline at 1-800-522-4700.
          </footer>
          <SlipButton />
        </SlipProvider>
      </body>
    </html>
  );
}
