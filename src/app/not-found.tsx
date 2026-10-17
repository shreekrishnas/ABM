import Link from "next/link";
import { Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="glass-card-static page-enter">
      <Empty title="Page not found" sub="The record may have been merged or erased." action={<Link href="/work" className="btn btn-primary btn-sm">Back to workspace</Link>} />
    </div>
  );
}
