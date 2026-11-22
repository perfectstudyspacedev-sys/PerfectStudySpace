# Function libraries stored in the repo

The api function imports these two files by relative path, so it starts with no
internet access: nothing is downloaded at a cold start, on Supabase cloud or on the
self-hosted server (a fresh server, an emptied module cache, esm.sh or npm down).

| File | How it was made | sha256 |
|---|---|---|
| supabase-js@2.49.1.mjs | esbuild 0.24.2 browser bundle of npm @supabase/supabase-js 2.49.1 (auth-js 2.68.0, functions-js 2.4.4, node-fetch 2.6.15, postgrest-js 1.19.2, realtime-js 2.11.2, storage-js 2.7.1): `esbuild entry.js --bundle --format=esm --platform=browser --target=es2022 --minify --legal-comments=eof`, entry.js = `export * from '@supabase/supabase-js'` | 4e6e3397a35a72070e84d7e80e4162fddfdc1edfb439d9b11902175128736ae3 |
| jose@5.10.0.mjs | esm.sh single-file bundle https://esm.sh/jose@5.10.0/denonext/jose.bundle.mjs | 4d3f07db214ea0dd8325ab3124ecbfc3d8bf48fa9ccb4a0079f8e06b0f931106 |

Both import nothing. The supabase-js browser build is used on purpose: the Deno build
imports node: modules, and Deno then downloads @types/node from npm whenever its
module cache is empty, so the function could not start without internet.

To update one: build or download the new version under a new versioned name, record
it here, change the import in api/index.ts, and run the test suite.

The folder name starts with an underscore, so it is never deployed or served as a
function (Supabase convention; the self-hosted nginx answers 404 for /_ paths).
