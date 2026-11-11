// What a client still needs before it can run, for its settings page and the Super Admin overview.
import { baseDb } from "@/lib/db-base";

export type SetupStep = { key: string; label: string; done: boolean; detail: string; href: string };

export async function setupSteps(clientId: string): Promise<SetupStep[]> {
  const { ensureSellerPacks, sellerFor } = await import("@/lib/seller");
  const { readiness } = await import("@/lib/seller/brain");
  await ensureSellerPacks();
  const [client, people, owners, campaigns, senders, companies] = await Promise.all([
    baseDb.client.findUnique({ where: { id: clientId }, select: { monthlyBudgetUsd: true } }),
    baseDb.userClient.count({ where: { clientId, user: { status: "active" } } }),
    baseDb.userClient.count({ where: { clientId, role: "owner", user: { status: "active" } } }),
    baseDb.campaign.count(),
    baseDb.senderProfile.count(),
    baseDb.account.count({ where: { sellerId: clientId, mergedIntoId: null } }),
  ]);
  // The newest saved brain, complete or not (a new client's brain is half filled at first).
  const latest = await baseDb.sellerPackRevision.findFirst({ where: { sellerId: clientId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { pack: true } });
  let brain: { ready: boolean; missing: string[] };
  try {
    brain = latest?.pack ? readiness(latest.pack as unknown as Parameters<typeof readiness>[0]) : readiness(sellerFor(clientId));
  } catch {
    brain = { ready: false, missing: ["Fill in the Account Brain"] };
  }
  return [
    { key: "brain", label: "Account Brain ready", done: brain.ready, detail: brain.ready ? "Research and drafting can use it" : `Still needed: ${brain.missing.slice(0, 3).join("; ")}${brain.missing.length > 3 ? ` and ${brain.missing.length - 3} more` : ""}`, href: `/brain?client=${clientId}` },
    { key: "cap", label: "Monthly spending cap", done: client?.monthlyBudgetUsd != null, detail: client?.monthlyBudgetUsd != null ? `$${client.monthlyBudgetUsd.toLocaleString()} a month` : "Set a ceiling so research can't overspend", href: "#basics" },
    { key: "people", label: "People and an Owner", done: people > 0 && owners > 0, detail: people ? (owners ? `${people} ${people === 1 ? "person" : "people"}, ${owners} owner${owners === 1 ? "" : "s"}` : `${people} assigned, but no Owner yet`) : "Assign at least one person and make one an Owner", href: "#people" },
    { key: "outreach", label: "A campaign and a LinkedIn sender", done: campaigns > 0 && senders > 0, detail: campaigns && senders ? `${campaigns} campaign${campaigns === 1 ? "" : "s"}, ${senders} sender${senders === 1 ? "" : "s"}` : "Add them under Settings → Campaigns and Senders", href: "/settings" },
    { key: "companies", label: "First companies imported", done: companies > 0, detail: companies ? `${companies} compan${companies === 1 ? "y" : "ies"}` : "Upload a list or describe the companies you want", href: "/import" },
  ];
}
