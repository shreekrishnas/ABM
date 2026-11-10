// Whether this request shows the extra pages: a Super Admin always does; otherwise the clients in view decide.
import { baseDb } from "@/lib/db-base";
import { resolveScope } from "@/lib/scope";

export async function showExtras(): Promise<boolean> {
  try {
    const scope = await resolveScope();
    if (!scope) return true; // sign-in off (local): show everything
    if (scope.all) return true;
    const ids = scope.active ? [scope.active] : scope.ids ?? [];
    if (!ids.length) return false;
    return (await baseDb.client.count({ where: { id: { in: ids }, showExtras: true } })) > 0;
  } catch {
    return false;
  }
}
