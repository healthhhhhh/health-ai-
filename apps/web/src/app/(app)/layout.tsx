import { BottomNav } from "@/components/layout/bottom-nav";
import { SampleDataNotice } from "@/components/layout/sample-data-notice";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { getMeta, getProfile } from "@/lib/api/data";
import { ApiError } from "@/lib/api/server";
import type { ProfileDetails } from "@healthmate/shared-types";

// Every app screen is per-user data; never prerender it.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const meta = await getMeta();
  let profile: ProfileDetails | null = null;
  let offline = false;
  try {
    profile = (await getProfile()).profile;
  } catch (error) {
    // Keep the app shell usable when data can't load; each page shows its own error or offline state.
    if (!(error instanceof ApiError)) throw error; // includes sign-in redirects
    offline = error.code === "network";
  }
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-md bg-card px-4 py-2 font-semibold text-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {meta?.preview ? (
          <SampleDataNotice>Preview mode — a sample account with sample AI responses. Not real health data or medical advice.</SampleDataNotice>
        ) : (
          meta?.ai.demo && <SampleDataNotice>Demo server — AI answers are scripted examples and the account holds example content.</SampleDataNotice>
        )}
        {offline && (
          <p role="status" className="bg-error-soft px-4 py-1.5 text-center text-xs font-medium text-error">
            You&apos;re offline. Showing what&apos;s available — we&apos;ll reconnect automatically.
          </p>
        )}
        <TopBar userName={profile ? `${profile.firstName} ${profile.lastName}`.trim() : ""} />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-28 focus:outline-none sm:px-6 md:pb-10 lg:px-8">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
