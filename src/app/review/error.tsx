"use client";

import { SectionError } from "@/components/section-error";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SectionError error={error} reset={reset} back="/review" label="Approvals" />;
}
