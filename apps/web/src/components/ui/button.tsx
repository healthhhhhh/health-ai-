import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap transition-[color,background-color,box-shadow,transform] duration-200 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-fill text-on-primary shadow-raised hover:bg-primary-pressed active:bg-primary-pressed",
        secondary: "bg-card text-primary ring-1 ring-separator hover:bg-primary-soft",
        soft: "bg-primary-soft text-primary hover:bg-primary-tint",
        ghost: "text-text-secondary hover:bg-card-muted hover:text-text-primary",
        link: "text-primary hover:underline underline-offset-4 px-0",
        destructive: "bg-error-fill text-on-primary shadow-card hover:opacity-90",
      },
      size: {
        sm: "h-9 px-4 text-caption",
        md: "h-11 px-5 text-body",
        lg: "h-13 px-7 text-card-title",
      },
      fullWidth: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, fullWidth, type = "button", ...props }: ComponentProps<"button"> & ButtonVariants) {
  return <button type={type} className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props} />;
}

export function ButtonLink({ className, variant, size, fullWidth, ...props }: ComponentProps<typeof Link> & ButtonVariants) {
  return <Link className={cn(buttonVariants({ variant, size, fullWidth }), className)} {...props} />;
}
