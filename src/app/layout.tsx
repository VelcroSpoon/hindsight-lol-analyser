import type { Metadata } from "next";
import Link from "next/link";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family, used at two widths: extra-wide for headings, normal for reading.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hindsight",
  description:
    "See where your League of Legends ranked games went wrong: every death on the map, and whether your team had vision there.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <header className="site-header">
          <Link href="/" className="wordmark">
            Hindsight
          </Link>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <p>
            Hindsight isn&rsquo;t endorsed by Riot Games and doesn&rsquo;t reflect the views or
            opinions of Riot Games or anyone officially involved in producing or managing Riot
            Games properties. Riot Games and all associated properties are trademarks or
            registered trademarks of Riot Games, Inc.
          </p>
        </footer>
      </body>
    </html>
  );
}
