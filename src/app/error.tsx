"use client";

import { Empty } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="glass-card-static page-enter">
      <Empty title="Something went wrong" sub={error.digest ? `Reference ${error.digest}` : error.message} action={<button className="btn btn-primary btn-sm" onClick={reset}>Try again</button>} />
    </div>
  );
}
