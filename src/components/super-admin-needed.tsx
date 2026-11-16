// Shown to a Super Admin who opens a Super Admin page while in User mode: one switch away.
import { ShieldCheck } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { SuperAdminSwitch } from "@/components/shell/SuperAdminSwitch";

export function SuperAdminNeeded({ title }: { title: string }) {
  return (
    <div className="page-enter space-y-5">
      <PageHeader eyebrow="Super Admin" title={title} />
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <ShieldCheck size={22} aria-hidden />
          <p className="flex-1 text-sm">{title} opens in Super Admin mode. You&apos;re in User mode right now: switch Super Admin on to open it.</p>
          <SuperAdminSwitch on={false} />
        </div>
      </Card>
    </div>
  );
}
