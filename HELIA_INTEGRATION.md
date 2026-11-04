# Helia integration points (plan and scaffold)

Status: **planning + scaffold only.** `integrations/helia.py` is a tested client; neither the server (`run.py`) nor the browser module knows about it, and no route or UI uses it (a test enforces that).

The demo never embeds Helia. It calls the **Helia sidecar** (`meshkit-sidecar-helia`, in `seetadev/Tornado-Backend-Stack`) over HTTP, **from the server**. The browser module stays dependency-free and never sees the sidecar or its secret.

## The sidecar contract (read from the source at commit `8afe218`, then confirmed by running it)

| Call | Behaviour |
|---|---|
| `POST /upload` (raw bytes) | `200 {"cid": "..."}`. Over the limit (`MESHKIT_HELIA_MAX_UPLOAD_MB`, default **20**) -> `413`. |
| `GET /retrieve/<cid>` | `200` raw bytes. Malformed CID -> `400` (fast). A CID it does not hold -> **`504` after 5 s**, **not 404**, in the default `HELIA_NETWORK=offline` mode. |
| `GET /list` | every CID uploaded since the sidecar started (global). |
| `GET /health` | `200 {"status":"ok",...}`, unauthenticated. |
| auth | every route except `/health` needs `X-Meshkit-Helia-Token: <MESHKIT_HELIA_SHARED_SECRET>` -> otherwise `401`. The sidecar publishes no host port; it is meant to be reached over the docker network. |

Verified against the real sidecar (`tests/integration/test_helia_real.py`): a small payload gets the raw-leaf `CIDv1` (`bafkrei...`) equal to `sha2-256` computed locally, identical bytes give identical CIDs, an unknown CID gives `504` after 5.0 s, 413 at limit + 1, 400 for malformed CIDs, 401 without the token except on `/health`. Not in the sidecar: **delete**, per-user ownership, and (offline mode) replication.

**Sidecar bug found while testing (commit `8afe218`):** `POST /upload` **without a `Content-Type` header** is answered `200` with the CID of an *empty* file (`bafkreihdwdcef...`) and **nothing is stored** (the body is never parsed, so the size limit is not enforced either). Clients must always send `Content-Type: application/octet-stream`; `HeliaClient` and the Tornado proxy do. An `xfail` integration test documents the desired behaviour and flips to XPASS when it is fixed upstream.

Tornado-Backend-Stack's own `/meshkit-helia/*` proxy has **no caller authentication** (CORS only) and an open `/list`; do not point a browser at it for anything non-public. **Dependency:** the sidecar exists only in the open PR [seetadev/Tornado-Backend-Stack#15](https://github.com/seetadev/Tornado-Backend-Stack/pull/15) (private repository).

## What the scaffold provides

`integrations/helia.py`: `HeliaClient(base_url, secret, ...)` with `await put(bytes) -> cid`, `await get(cid) -> bytes`, `await health() -> bool` on `tornado.httpclient.AsyncHTTPClient` (the demo already runs Tornado 6.6).

- Checked **locally before any request**: CID shape, payload size (default 20 MiB), non-empty bytes.
- The secret is only ever sent as `X-Meshkit-Helia-Token`; never logged, never in `repr()` or an error; **redirects are never followed**.
- Errors, mapped like the Tornado proxy so callers fall back uniformly: unreachable / 502 / 503 / secret mismatch -> `HeliaUnavailable` (502); slow or 504 -> `HeliaTimeout` (504); `HeliaInvalidCid` (400); `HeliaPayloadTooLarge` (413); `HeliaNotFound` (404); else `HeliaError`.
- Upload replies are validated; an oversized download surfaces as `HeliaUnavailable` (Tornado reports it as a closed connection).

## Configuration

`HELIA_SIDECAR_URL` (unset = disabled; `HeliaClient.from_env()` returns `None`), `HELIA_SIDECAR_SECRET` (equal to the sidecar's `MESHKIT_HELIA_SHARED_SECRET`; server-side only; use TLS unless the network is private), `HELIA_API_PREFIX` (`""`, or `/meshkit-helia` via the proxy), `HELIA_HEALTH_PATH` (`/health`), `HELIA_MAX_UPLOAD_MB` (20), `HELIA_CONNECT_TIMEOUT` (3 s), `HELIA_REQUEST_TIMEOUT` (8 s). When wired, pass them through `docker-compose.yml` and `.env.example`, and add `COPY integrations integrations` to the `Dockerfile` (it copies only `run.py` and `static` today).

## Integration points

1. **Images by CID.** `static/images.json` entries are `{src, alt, width, height}`; add `cid` (and `sha256`) to each. The 16 demo images are 9-88 KB each, far under the cap, and **under one chunk (1 MiB), so each CID is a raw-leaf CIDv1 that the server can re-derive from the bytes**: a full integrity check without trusting the sidecar.
   - Publish: `tools/publish_to_helia.py` (not written yet) `put()`s every file under `static/images/` and writes the CIDs into `images.json`.
   - Serve: a same-origin route `GET /ipfs/<cid>` fetches with `get()`, verifies the hash, and answers with `Cache-Control: public, max-age=31536000, immutable` and `ETag: "<cid>"`. The CSP (`img-src 'self'`, `connect-src 'self'`) does not change.
   - Browser module: a small option, for example `resolveSrc(image) -> url` (default: `image.src`), so a page can ask for `/ipfs/<cid>`; the module's existing `isSafeImageSrc` check still applies, and on an `<img>` error it falls back to `image.src` (the local copy).
2. **The `images.json` manifest by CID.** Publish the manifest itself with `put()` to get one CID that names an immutable gallery snapshot (`?gallery=<cid>`). The manifest read back from Helia is **untrusted input**: validate the schema, cap its size (for example 1 MiB / 1,000 entries), validate every `cid`, and keep running every `src` through `isSafeImageSrc`.
3. **Pointer to "the latest gallery".** A new gallery is a new CID, and the sidecar has no mutable names (no IPNS). The latest CID has to be stored somewhere (an env var or a tiny file); this is a product decision.

## Fallback on 502 / 504

The local files stay the master. On `HeliaUnavailable` (502) or `HeliaTimeout` (504) the server answers from `static/images/` using the manifest's `cid -> src` map, logs one warning (no secret, no payload), and marks Helia "down" for a short period so each request does not wait 8 s. A `504` also means "this sidecar does not hold that CID", so both cases take the same path. `HeliaMisconfigured` (secret mismatch) is a deployment bug: log loudly and fall back. With no local copy: `503` + `Retry-After`, never `500`. The browser-side `<img>` fallback to `src` covers the case where `/ipfs/<cid>` itself fails.

## Is encryption needed?

**No for the demo.** The images are CC0 / public domain ([CREDITS.md](CREDITS.md)), the CIDs are not secrets, and sharing them is the point. **Yes if galleries ever hold private user images:** the sidecar stores plaintext, has no delete, and in `online` mode a queried CID is visible to peers and gateways. Encrypt before `put()` (for example AES-256-GCM with a key the app keeps) and keep `HELIA_NETWORK=offline`.

## Open questions

1. Is this a module for other sites (then Helia support belongs in the host app, not here) or just a demo? Today only the demo server would call Helia.
2. Where does the sidecar run for the demo (its source is in a private repo, so this repo's compose cannot build it)?
3. How is "the latest gallery CID" published (no mutable names in the sidecar)?
4. Offline or online Helia? Offline is a single node, one volume, no replication.
5. If users can upload images: moderation, size/format validation, licences (CREDITS.md assumes PD/CC0 only), and deletion (the sidecar has none).

## Running the opt-in integration test (real sidecar)

```bash
git clone git@github.com:seetadev/Tornado-Backend-Stack.git ../Tornado-Backend-Stack
git -C ../Tornado-Backend-Stack checkout 8afe218
export HELIA_SIDECAR_BUILD_CONTEXT=$PWD/../Tornado-Backend-Stack/meshkit-sidecar-helia
export HELIA_SIDECAR_SECRET=$(openssl rand -hex 32)
docker compose -f tests/integration/docker-compose.helia.yml up -d --build --wait
HELIA_SIDECAR_URL=http://127.0.0.1:5052 pytest tests/integration -v -s
docker compose -f tests/integration/docker-compose.helia.yml down -v
```

Without `HELIA_SIDECAR_URL` those tests are skipped. The regular unit tests (`pytest`) use `tests/helia_mock.py`, a **mock** of the contract above.
