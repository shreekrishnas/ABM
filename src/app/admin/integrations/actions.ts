"use server";

import { revalidatePath } from "next/cache";
import { baseDb } from "@/lib/db-base";
import { audit, requireSuperAdmin } from "@/lib/me";
import { INTEGRATION_KEYS, decryptKeys, encryptKeys, integrationKeyStates, syncIntegrationEnv } from "@/lib/integration-keys";

export type KeyResult = { ok: boolean; message: string; needsKey?: boolean };

const specOf = (key: string) => INTEGRATION_KEYS.find((i) => i.key === key);

/** Switch an integration on or off. Switching on without its required key asks for the key instead. */
export async function setIntegrationEnabledAction(key: string, on: boolean): Promise<KeyResult> {
  try {
    const me = await requireSuperAdmin();
    const spec = specOf(key);
    if (!spec) return { ok: false, message: "Unknown integration" };
    const state = (await integrationKeyStates()).get(key);
    if (on && !state?.ready) return { ok: false, needsKey: true, message: `${spec.name} needs its key first` };
    if (key === "openrouter") {
      // The AI switch is the AI pause, which keeps queued work waiting cleanly.
      const { setAiPausedAction } = await import("@/app/team/actions");
      const r = await setAiPausedAction(!on);
      revalidatePath("/", "layout");
      return { ok: r?.ok ?? false, message: r?.message ?? "" };
    }
    await baseDb.integrationSetting.upsert({ where: { key }, create: { key, enabled: on, updatedBy: me.email }, update: { enabled: on, updatedBy: me.email } });
    await syncIntegrationEnv(true);
    await audit(me.email, on ? "integration.on" : "integration.off", { target: spec.name });
    revalidatePath("/", "layout");
    return { ok: true, message: `${spec.name} is ${on ? "on" : "off"}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't change it" };
  }
}

/** Save keys typed into the app (empty fields keep what is already saved), then switch the integration on. */
export async function saveIntegrationKeysAction(key: string, _: KeyResult | null, fd: FormData): Promise<KeyResult> {
  try {
    const me = await requireSuperAdmin();
    const spec = specOf(key);
    if (!spec) return { ok: false, message: "Unknown integration" };
    const row = await baseDb.integrationSetting.findUnique({ where: { key } });
    const values = decryptKeys(row?.secrets);
    const changed: string[] = [];
    for (const f of spec.fields) {
      const v = String(fd.get(f.env) ?? "").trim();
      if (!v) continue;
      if (v.length > 2000 || /\s/.test(v) && f.secret) return { ok: false, message: `${f.label} looks wrong (no spaces allowed)` };
      values[f.env] = v;
      changed.push(f.label);
    }
    if (!changed.length) return { ok: false, message: "Type a key first" };
    // Required keys must be present after saving (from this form, earlier saves or Vercel).
    const states = await integrationKeyStates();
    const have = (env: string) => Boolean(values[env]) || Boolean(states.get(key)?.fields.find((f) => f.env === env)?.source);
    const missing = spec.anyOf ? (spec.fields.some((f) => have(f.env)) ? [] : ["one key"]) : spec.fields.filter((f) => f.required && !have(f.env)).map((f) => f.label);
    if (missing.length) return { ok: false, message: `Still needed: ${missing.join(", ")}` };
    const secrets = encryptKeys(values);
    await baseDb.integrationSetting.upsert({ where: { key }, create: { key, enabled: true, secrets, updatedBy: me.email }, update: { enabled: true, secrets, updatedBy: me.email } });
    await syncIntegrationEnv(true);
    // Never log the values: only which fields changed.
    await audit(me.email, "integration.keys", { target: spec.name, after: { fields: changed } });
    revalidatePath("/", "layout");
    return { ok: true, message: `${spec.name}: key saved and switched on${key === "openrouter" ? ". Resume AI with the switch when you're ready" : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't save the key" };
  }
}

/** Forget a key saved in the app (a key set in Vercel stays). */
export async function removeIntegrationKeyAction(key: string, env: string): Promise<KeyResult> {
  try {
    const me = await requireSuperAdmin();
    const spec = specOf(key);
    if (!spec || !spec.fields.some((f) => f.env === env)) return { ok: false, message: "Unknown key" };
    const row = await baseDb.integrationSetting.findUnique({ where: { key } });
    const values = decryptKeys(row?.secrets);
    delete values[env];
    await baseDb.integrationSetting.upsert({ where: { key }, create: { key, secrets: null, updatedBy: me.email }, update: { secrets: Object.keys(values).length ? encryptKeys(values) : null, updatedBy: me.email } });
    await syncIntegrationEnv(true);
    await audit(me.email, "integration.key_removed", { target: `${spec.name}: ${spec.fields.find((f) => f.env === env)?.label}` });
    revalidatePath("/", "layout");
    return { ok: true, message: "Key removed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Couldn't remove it" };
  }
}
