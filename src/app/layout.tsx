import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wild Frame AI",
  description: "STEP IN. BECOME ANYTHING. — AI selfie transformations, powered by Lucy.",
  // A kiosk screen is not something search engines should index, and the
  // delivery pages are private by construction.
  robots: { index: false, follow: false },
  applicationName: "Wild Frame AI",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Wild Frame AI" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Pinch-zoom on a kiosk leaves the next customer looking at a zoomed screen.
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-wf-black text-wf-white antialiased">{children}</body>
    </html>
  );
}
