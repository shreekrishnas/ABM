import { redirect } from "next/navigation";

/** Old address of the companies table: Companies now holds Table | Map on one page. */
export default async function CompaniesAlias({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = new URLSearchParams(Object.entries(await searchParams).filter(([, v]) => v) as [string, string][]);
  redirect(`/accounts${sp.size ? `?${sp}` : ""}`);
}
