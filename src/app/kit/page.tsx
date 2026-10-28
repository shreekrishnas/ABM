import { PageHeader, Stat, StatRow } from "@/components/kit";
import { KitDemo } from "./demo";

export const metadata = { title: "Component kit" };

/** The shared components, live: what every redesigned screen is built from. Not in the navigation. */
export default function KitPage() {
  return (
    <div>
      <PageHeader title="Component kit" description="The shared building blocks every screen uses, with their states. Styled only with design tokens." />
      <StatRow>
        <Stat id="qualified" value={2} sub="8% of 25 imported" />
        <Stat id="emails_to_approve" value={0} sub="Nothing waiting" />
        <Stat id="at_risk" value={1} tone="danger" sub="1 paused · 0 stuck" />
        <Stat id="spend_total" value="$1.48" loading />
      </StatRow>
      <KitDemo />
    </div>
  );
}
