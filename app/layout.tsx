import type { Metadata } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });

export const metadata: Metadata = {
  title: "Trailhead Pantry · Pullback demo",
  description: "A demo snack store with Pullback, the recall-to-refund agent for PayPal merchants",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <div className="bg-cocoa px-4 py-1.5 text-center text-[11px] text-cream/80">
          Demo: the store, customers and orders are fictional. Payments and refunds run in the PayPal sandbox. Recalls are real openFDA records unless marked simulated.
        </div>
        {children}
      </body>
    </html>
  );
}
