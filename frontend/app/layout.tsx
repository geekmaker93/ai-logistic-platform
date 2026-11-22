import type { Metadata } from "next";
import AuthInactivityWatcher from "@/app/components/auth-inactivity-watcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "LynkXpress",
  description: "AI-powered logistics workflow platform",
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
