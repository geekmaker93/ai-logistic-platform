import type { Metadata } from "next";
import AuthInactivityWatcher from "@/app/components/auth-inactivity-watcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "LynkXpress",
  description:
    "LynkXpress is an innovative freight logistics platform connecting shippers and carriers. Find loads, compare shipping quotes, manage deliveries and track shipments with ease.",
  applicationName: "LynkXpress",
  openGraph: {
    title: "LynkXpress",
    description: "Freight and logistics technology.",
    siteName: "LynkXpress",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "LynkXpress",
    description: "Freight and logistics technology.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthInactivityWatcher />
        {children}
      </body>
    </html>
  );
}
