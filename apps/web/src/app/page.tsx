import { Sparkles } from "lucide-react";
import { LogoMark } from "@/components/illustrations/logo";
import { Mascot } from "@/components/illustrations/mascot";
import { ButtonLink } from "@/components/ui/button";
import { Disclaimer } from "@/components/ui/disclaimer";
import { IconBadge } from "@/components/ui/icon-badge";
import { ONBOARDING_FEATURES } from "@/lib/onboarding";
import Link from "next/link";

export default function WelcomePage() {
  return (
    <main className="bg-app-gradient min-h-dvh">
      <div className="mx-auto grid min-h-dvh max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1fr_1.05fr] lg:px-10">
        {/* Brand + features */}
        <section aria-labelledby="welcome-title" className="mx-auto flex w-full max-w-md flex-col items-center text-center lg:mx-0 lg:items-start lg:text-left">
          <span className="animate-fade-up relative mb-6 inline-flex size-28 items-center justify-center">
            <span aria-hidden className="animate-halo absolute -inset-4 rounded-full bg-primary-tint" />
            <span className="relative inline-flex size-28 items-center justify-center rounded-full bg-card shadow-[0_12px_40px_rgb(47_100_236/0.18)] ring-8 ring-primary-soft">
              <LogoMark size={60} className="animate-heartbeat" />
            </span>
          </span>
          <h1 id="welcome-title" className="animate-fade-up text-display text-text-primary [animation-delay:80ms] sm:text-[2.5rem]">
            HealthMate
          </h1>
          <p className="animate-fade-up mt-1 text-lg text-text-secondary [animation-delay:130ms]">Your AI Health Companion</p>

          <ul className="mt-9 flex w-full flex-col gap-5 text-left">
            {ONBOARDING_FEATURES.map(({ title, description, icon: Icon, tone }, i) => (
              <li key={title} className="animate-fade-up group flex items-center gap-4" style={{ animationDelay: `${220 + i * 90}ms` }}>
                <IconBadge icon={<Icon />} tone={tone} size="lg" className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6" />
                <div>
                  <p className="text-card-title text-text-primary">{title}</p>
                  <p className="text-caption text-text-secondary">{description}</p>
                </div>
              </li>
            ))}
          </ul>

          <div className="animate-fade-up mt-10 flex w-full flex-col items-center gap-3 [animation-delay:600ms] lg:items-stretch">
            <ButtonLink href="/sign-in?mode=sign-up" size="lg" fullWidth>
              Get Started
            </ButtonLink>
            <ButtonLink href="/sign-in" variant="link" size="md">
              Sign In
            </ButtonLink>
          </div>
          <p className="mt-4 text-xs text-text-secondary">
            By continuing you agree to our{" "}
            <Link href="/help#terms" className="font-semibold text-primary underline-offset-4 hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/help#privacy" className="font-semibold text-primary underline-offset-4 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </section>

        {/* Visual: assistant introduction (desktop/tablet) */}
        <section aria-label="Meet your AI Health Assistant" className="animate-fade-up relative hidden [animation-delay:250ms] lg:block">
          <div className="bg-hero-gradient relative overflow-hidden rounded-xl p-10 shadow-card">
            <div className="flex items-center gap-8">
              <Mascot size={220} withBackdrop />
              <div>
                <p className="inline-flex items-center gap-1.5 rounded-pill bg-card/80 px-3 py-1 text-xs font-semibold text-purple">
                  <Sparkles aria-hidden className="size-3.5" /> AI Health Assistant
                </p>
                <h2 className="mt-3 text-page-heading text-text-primary">Hi, I&apos;m Mate.</h2>
                <p className="mt-2 text-body text-text-secondary">
                  I can help you make sense of symptoms and reports, keep track of your health, and prepare for conversations with your doctor.
                </p>
              </div>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3" aria-hidden>
              <div className="lift rounded-lg bg-card p-4 shadow-card">
                <p className="text-caption text-text-secondary">Sleep</p>
                <p className="text-metric text-text-primary">7h 12m</p>
              </div>
              <div className="lift rounded-lg bg-card p-4 shadow-card">
                <p className="text-caption text-text-secondary">Today&apos;s plan</p>
                <p className="text-metric text-text-primary">
                  2 <span className="text-body font-medium text-text-secondary">of 5 done</span>
                </p>
              </div>
            </div>
          </div>
          <Disclaimer className="mt-5 px-2" />
        </section>
      </div>
    </main>
  );
}
