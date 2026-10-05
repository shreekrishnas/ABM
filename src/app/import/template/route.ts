import { templateCsv } from "@/lib/import/fields";

// Downloadable CSV template with the predefined columns and one example row.
export function GET() {
  return new Response(templateCsv(), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="abm-import-template.csv"' },
  });
}
