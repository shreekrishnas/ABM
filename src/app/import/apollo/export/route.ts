import { EXPORT_COLUMNS, exportRows, listVisitorCompanies, parseRange } from "@/lib/web/visitor-prospects";
import { xlsxBuffer } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

// Behind the same sign-in as the rest of the app (like the companies export).
/** The selected visitor companies and their Apollo prospects, in the CSV import's columns. Independent of any pipeline import. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const { from, to } = parseRange(p.get("from") ?? undefined, p.get("to") ?? undefined);
  const keys = new Set(p.getAll("k"));
  const companies = (await listVisitorCompanies(from, to)).filter((c) => !keys.size || keys.has(c.key));
  const buf = await xlsxBuffer("Website visitors", EXPORT_COLUMNS, exportRows(companies));
  return new Response(new Blob([buf as BlobPart]), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="website-visitors-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
