// Stored next to this router, pinned: upstream imported 'jsr:@panva/jose@6', which is
// downloaded from jsr.io whenever the module cache is empty, so with no internet the whole
// functions container could not start (worker boot error, restart loop). 6.2.18 is what
// that range resolved to (22 Nov 2026); the file is esm.sh's single-file bundle of npm
// jose 6.2.18 (same code as jsr @panva/jose), sha256 72ae2cd5b9a228b6...
import * as jose from './jose@6.2.18.mjs'

// Only the shape parseJwks checks; jose checks the keys themselves.
type JSONWebKeySet = { keys: unknown[] }

console.log('main function started')

const JWT_SECRET = Deno.env.get('JWT_SECRET')
const SUPABASE_JWKS = parseJwks(Deno.env.get('SUPABASE_JWKS'))
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'

// NOTE:(kallebysantos) We don't check for valid keys but just the bare array parsing,
// let this for 'jose' lib verification
export function parseJwks(raw: string | undefined): JSONWebKeySet | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.keys && Array.isArray(parsed.keys)) {
      return parsed as JSONWebKeySet
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract JWT token from Authorization header
 *
 * Parses the Authorization header to extract the Bearer token.
 * Expects format: "Bearer <token>"
 *
 * @param req - The HTTP request object
 * @returns The JWT token string
 * @throws Error if Authorization header is missing or malformed
 */
function getAuthToken(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }
  const [bearer, token] = authHeader.split(' ')
  if (bearer !== 'Bearer') {
    throw new Error(`Auth header is not 'Bearer {token}'`)
  }
  return token
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not available for HS256 token verification')
    return false
  }

  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET);

  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error('Symmetric Legacy JWT verification error', e);
    return false;
  }
  return true;
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWKS) {
    console.error('JWKS not available for ES256/RS256 token verification')
    return false
  }

  try {
    const localJwks = jose.createLocalJWKSet(SUPABASE_JWKS);
    await jose.jwtVerify(jwt, localJwks);
  } catch (e) {
    console.error('Asymmetric JWT verification error', e);
    return false
  }

  return true;
}

/**
 * Verify JWT token, handling both legacy (HS256) and newer (ES256/RS256) algorithms
 * 
 * This function automatically detects the algorithm used in the token and applies
 * the appropriate verification method:
 * - HS256: Uses JWT_SECRET (symmetric key)
 * - ES256/RS256: Uses JWKS endpoint (asymmetric public keys)
 * 
 * This fix ensures compatibility with both legacy tokens and newer asymmetric tokens,
 * resolving the "Key for the ES256 algorithm must be of type CryptoKey" error.
 * 
 * @param jwt - The JWT token string to verify
 * @returns Promise resolving to true if verification succeeds, false otherwise
 */
async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg: jwtAlgorithm } = jose.decodeProtectedHeader(jwt)

  if (jwtAlgorithm === 'HS256') {
    console.log(`Legacy token type detected, attempting ${jwtAlgorithm} verification.`)

    return await isValidLegacyJWT(jwt)
  }

  if (jwtAlgorithm === 'ES256' || jwtAlgorithm === 'RS256') {
    return await isValidJWT(jwt)
  }

  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) {
    try {
      const token = getAuthToken(req)
      const isValidJWT = await isValidHybridJWT(token);

      if (!isValidJWT) {
        return new Response(JSON.stringify({ msg: 'Invalid JWT' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch (e) {
      console.error(e)
      return new Response(JSON.stringify({ msg: e.toString() }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const url = new URL(req.url)
  const { pathname } = url
  const path_parts = pathname.split('/')
  const service_name = path_parts[1]

  if (!service_name || service_name === '') {
    const error = { msg: 'missing function name in request' }
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const servicePath = `/home/deno/functions/${service_name}`
  console.error(`serving the request with ${servicePath}`)

  // Set per stack in docker-compose.yml; the upstream values were fixed at
  // 150 MB / 60 s, below Supabase cloud's 256 MB / 150 s.
  const memoryLimitMb = Number(Deno.env.get('EDGE_WORKER_MEMORY_MB')) || 150
  const workerTimeoutMs = Number(Deno.env.get('EDGE_WORKER_TIMEOUT_MS')) || 1 * 60 * 1000
  // CPU time a worker may use, added up over every request it serves (the per_worker
  // policy reuses workers). Soft: the worker finishes what it has and retires, the next
  // request gets a fresh one. Hard: requests still running on it are cancelled (500).
  // Left unset, the runtime's small defaults cancelled heavy reports mid-request.
  const cpuTimeSoftLimitMs = Number(Deno.env.get('EDGE_WORKER_CPU_SOFT_MS')) || 15000
  const cpuTimeHardLimitMs = Number(Deno.env.get('EDGE_WORKER_CPU_HARD_MS')) || 45000
  const noModuleCache = false
  const importMapPath = null
  const envVarsObj = Deno.env.toObject()
  const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])
  const createWorker = (forceCreate: boolean) =>
    EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      cpuTimeSoftLimitMs,
      cpuTimeHardLimitMs,
      noModuleCache,
      importMapPath,
      envVars,
      forceCreate,
    })

  // Kept for the one retry below; a request body can be read only once.
  const spare = req.clone()
  try {
    const worker = await createWorker(false)
    return await worker.fetch(req)
  } catch (e) {
    // One retry, on a new worker, only when nothing can happen twice:
    //  - the request never reached a worker (the one picked had just retired), or
    //  - it carries an Idempotency-Key: the function then runs it at most once and answers
    //    a repeat with the first run's stored result (PSS migration 053).
    // "user worker failed to respond" without a key means it did reach a worker and may
    // have written data: no retry.
    const neverReached = /failed to send request to user worker|worker has already retired/i.test(String(e))
    if (neverReached || spare.headers.has('idempotency-key')) {
      console.error(`${neverReached ? 'request never reached a worker' : 'idempotent request failed'}, retrying once on a new worker: ${e}`)
      try {
        const worker = await createWorker(true)
        return await worker.fetch(spare)
      } catch (e2) {
        return errorResponse(e2)
      }
    }
    return errorResponse(e)
  }
})

function errorResponse(e: unknown) {
  return new Response(JSON.stringify({ msg: String(e) }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
