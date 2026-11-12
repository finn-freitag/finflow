import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FinFlow — Category Tree & Private/Business Expense Tracker",
  description:
    "Hierarchical Category Tree finance tracker with recursive folder sums, interactive charts, Private & Business accounts, split transactions, and OIDC/Built-in authentication.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090d16",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-indigo-500 selection:text-white">{children}</body>
    </html>
  );
}
