import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="bg-app-gradient flex min-h-dvh items-center justify-center">
      <EmptyState icon={<Compass />} title="Page not found" description="The page you're looking for doesn't exist or has moved." action={<ButtonLink href="/home">Go to Home</ButtonLink>} />
    </main>
  );
}
