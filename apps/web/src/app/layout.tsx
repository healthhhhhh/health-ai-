import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import { PreviewPanel } from "@/features/preview/preview-panel";
import { REFRESH_COOKIE } from "@/lib/api/session";
import { DISPLAY_COOKIE, parseDisplayPrefs } from "@/lib/display-prefs";
import { isPreviewMode } from "@/lib/preview/mode";

export const metadata: Metadata = {
  title: { default: "HealthMate — Your AI Health Companion", template: "%s · HealthMate" },
  description: "Understand your health information, track your health, make sense of medical reports and stay on track with your care plan.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8FC" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1220" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const preview = isPreviewMode();
  const jar = await cookies();
  const signedIn = preview && Boolean(jar.get(REFRESH_COOKIE)?.value);
  const { theme } = parseDisplayPrefs(jar.get(DISPLAY_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme}>
      <body className="min-h-dvh">
        <ToastProvider>
          {children}
          {preview && <PreviewPanel signedIn={signedIn} />}
        </ToastProvider>
      </body>
    </html>
  );
}
