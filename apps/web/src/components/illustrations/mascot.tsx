import Image from "next/image";
import { useId } from "react";
import { cn } from "@/lib/cn";
import { illustrations } from "./config";

interface MascotProps {
  size?: number;
  className?: string;
  /** Decorative when the surrounding text already introduces the assistant. */
  decorative?: boolean;
  /** Soft glow + sparkles behind the character (hero placements). */
  withBackdrop?: boolean;
}

/**
 * "Mate" — HealthMate's AI assistant character. Deliberately a friendly
 * companion rather than a clinician, so the UI never implies the AI is a doctor.
 */
export function Mascot({ size = 160, className, decorative = false, withBackdrop = false }: MascotProps) {
  const uid = useId().replace(/:/g, "");
  const art = illustrations.mascot;
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": art.alt };

  if (art.src) {
    return <Image src={art.src} alt={decorative ? "" : art.alt} width={size} height={size} className={className} />;
  }

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={cn("shrink-0", className)} {...a11y}>
      <defs>
        <linearGradient id={`${uid}-head`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E3EBFF" />
        </linearGradient>
        <linearGradient id={`${uid}-visor`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#253A74" />
          <stop offset="1" stopColor="#1A2650" />
        </linearGradient>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7F9FF" />
          <stop offset="1" stopColor="#D9E4FF" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#CFDCFF" stopOpacity="0.9" />
          <stop offset="1" stopColor="#CFDCFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {withBackdrop && (
        <g>
          <circle cx="100" cy="104" r="96" fill={`url(#${uid}-glow)`} />
          <path d="M34 52l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#B9A8FF" />
          <path d="M166 40l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#8FB0FF" />
          <circle cx="170" cy="120" r="3" fill="#8FB0FF" />
        </g>
      )}

      {/* antenna with heart */}
      <path d="M100 38v-12" stroke="#9DB6F5" strokeWidth="4" strokeLinecap="round" />
      <path d="M100 30c-3.5-5-11-3.5-11 2.2 0 4.3 6.2 8 11 11.3 4.8-3.3 11-7 11-11.3 0-5.7-7.5-7.2-11-2.2z" fill="#F0605A" />

      {/* body */}
      <path d="M62 150c0-19 17-32 38-32s38 13 38 32v22c0 6-5 10-11 10H73c-6 0-11-4-11-10z" fill={`url(#${uid}-body)`} stroke="#C9D7FB" strokeWidth="2" />
      {/* heart-pulse emblem */}
      <circle cx="100" cy="153" r="14" fill="#2F64EC" />
      <path d="M90 153h5l3-6 4 12 3-6h5" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* arms */}
      <path d="M64 146c-10 2-17 9-19 18" stroke="#C9D7FB" strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d="M136 146c9-4 16-12 18-22" stroke="#C9D7FB" strokeWidth="11" strokeLinecap="round" fill="none" />
      <circle cx="155" cy="121" r="8" fill="#F4F7FF" stroke="#C9D7FB" strokeWidth="2" />

      {/* head */}
      <rect x="46" y="38" width="108" height="86" rx="40" fill={`url(#${uid}-head)`} stroke="#C9D7FB" strokeWidth="2" />
      {/* ear pods */}
      <rect x="38" y="68" width="12" height="28" rx="6" fill="#BFD0FA" />
      <rect x="150" y="68" width="12" height="28" rx="6" fill="#BFD0FA" />
      {/* visor */}
      <rect x="58" y="52" width="84" height="58" rx="27" fill={`url(#${uid}-visor)`} />
      {/* eyes */}
      <rect x="79" y="68" width="10" height="17" rx="5" fill="#9FE3FF" />
      <rect x="111" y="68" width="10" height="17" rx="5" fill="#9FE3FF" />
      <circle cx="86" cy="72" r="2" fill="#FFFFFF" />
      <circle cx="118" cy="72" r="2" fill="#FFFFFF" />
      {/* cheeks */}
      <ellipse cx="72" cy="92" rx="6" ry="3.5" fill="#FF8FA3" opacity="0.55" />
      <ellipse cx="128" cy="92" rx="6" ry="3.5" fill="#FF8FA3" opacity="0.55" />
      {/* smile */}
      <path d="M91 92c5 5 13 5 18 0" fill="none" stroke="#9FE3FF" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
