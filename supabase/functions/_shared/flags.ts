// Feature switches (PSS-AI R9): an app_settings row `pssai_<feature>` with value 'on' or 'off'.
// A missing row means off, so every new behaviour stays off until the owner switches it on.
// deno-lint-ignore-file no-explicit-any
export async function featureOn(db: { from: (table: string) => any }, feature: string): Promise<boolean> {
  const { data } = await db.from("app_settings").select("value").eq("key", `pssai_${feature}`).maybeSingle();
  return data?.value === "on";
}
