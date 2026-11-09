// Self-hosted stack: signed Storage links handed to the browser are built on SUPABASE_PUBLIC_URL
// (the functions themselves talk to the internal gateway, SUPABASE_URL). On Supabase cloud
// SUPABASE_PUBLIC_URL is unset and every link stays exactly as supabase-js made it.
import { check, done } from "./harness.ts";
import { publicStorageLink } from "../../supabase/functions/_shared/http.ts";

const link = "http://kong:8000/storage/v1/object/sign/payment-proofs/a/b.jpg?token=t";
const saved = { pub: Deno.env.get("SUPABASE_PUBLIC_URL"), url: Deno.env.get("SUPABASE_URL") };

Deno.env.delete("SUPABASE_PUBLIC_URL");
Deno.env.set("SUPABASE_URL", "http://kong:8000");
check(publicStorageLink(link) === link, "no SUPABASE_PUBLIC_URL (Supabase cloud): link unchanged");

Deno.env.set("SUPABASE_PUBLIC_URL", "https://api.perfectstudyspace.in");
check(publicStorageLink(link) === "https://api.perfectstudyspace.in/storage/v1/object/sign/payment-proofs/a/b.jpg?token=t",
  "self-hosted: link built on the public address, path and token kept");

Deno.env.set("SUPABASE_PUBLIC_URL", "https://api.perfectstudyspace.in/");
Deno.env.set("SUPABASE_URL", "http://kong:8000/");
check(publicStorageLink(link).startsWith("https://api.perfectstudyspace.in/storage/v1/"), "trailing slashes in either setting are ignored");

const other = "https://cdn.example.com/storage/v1/object/sign/x?token=t";
check(publicStorageLink(other) === other, "a link that does not start with SUPABASE_URL is left alone");
check(publicStorageLink("http://kong:8000.evil/storage/v1/x") === "http://kong:8000.evil/storage/v1/x", "a look-alike host is not rewritten");

Deno.env.set("SUPABASE_PUBLIC_URL", "http://kong:8000");
check(publicStorageLink(link) === link, "public and internal the same: unchanged");

for (const [k, v] of [["SUPABASE_PUBLIC_URL", saved.pub], ["SUPABASE_URL", saved.url]] as const) {
  if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
}
done();
