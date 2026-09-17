# End-to-End Encryption (E2EE)

Beisammen encrypts media client-side so that only circle members can read it —
neither the cloud backend, the S3/R2 bucket, nor a self-hosted server operator
ever see plaintext content or keys. The design follows the Ente model
(per-file keys wrapped by collection keys wrapped per member) rather than MLS:
stored family media needs durable group access, not messaging-style forward
secrecy.

All primitives are libsodium via `@beisammen/crypto` (`packages/crypto`),
which is sodium-implementation-injected: mobile passes
`react-native-libsodium`, web/tests pass `libsodium-wrappers`.

## Key hierarchy

```
recovery code  ──(Argon-free: random 32-byte key, Crockford-base32+checksum)
      │ wraps
master key     ── generated on device, stored in the device keychain
      │            (iOS: iCloud-Keychain-synced — pragmatic device migration;
      │             Android: local Keystore only → recovery code required)
      │ wraps
user X25519 keypair ── public key on server; private key stored only wrapped
      │ opens (crypto_box_seal)
circle key (per epoch) ── sealed per member into `circleKeyGrants`
      │ wraps (secretbox)
file key (per asset)   ── encrypts the media bytes (BSE1 format)
```

Server-side state (`convex/keys.ts`, tables `userKeys`, `circleKeyEpochs`,
`circleKeyGrants`) holds only public keys and ciphertext. Registration is
write-once per user; replacing keys is rejected until an explicit
re-encrypting reset flow exists.

### Epochs and membership

- The first member client to come online initializes epoch 1 with a
  self-grant (`initializeCircleKey`; concurrent initializers lose the race
  and re-read).
- Any member holding epoch keys tops up grants for members without one
  (`listMissingKeyGrants` → `grantCircleKeys`), covering **every epoch the
  granter holds**, not just the current one. New joiners and users recovering
  from a key reset therefore get access to the full circle history as soon as
  any key-holding member is online — the server verifies membership and that
  the granter itself holds a grant, and never sees the key.
- Every departure (removal, leave, account deletion) deletes the member's
  grants and marks the circle `keyRotationPendingAt`. While that flag is set,
  encrypted upload completion is rejected server-side, so no post-departure
  media can be sealed under an epoch the departed member still holds — even
  if the departing client crashes before rotating. The remover's client
  rotates immediately; otherwise the next manage-role client to come online
  rotates automatically (`useCircleKeys` → `rotateCircleKeyNow`). Rotation
  (`rotateCircleKey`, owners/admins, must self-grant) generates a fresh key,
  so it does not require holding the previous epoch, and it clears the flag.
- Upload completion additionally requires the *current* epoch: envelopes
  referencing an older epoch are rejected as stale. Old epochs stay stored so
  old assets remain decryptable; a removed member who saved keys can, as in
  every E2EE system, still read content from epochs they legitimately held.
- Grants and registered public keys are shape-validated server-side (exact
  base64 lengths for X25519 public keys and sealed circle keys), grant
  sealing skips individual members with malformed keys instead of aborting
  the batch, and a member can reject their own unreadable grant
  (`rejectMyKeyGrant`) so an honest key holder re-grants — an attacker racing
  a poisoned grant in first cannot permanently lock a member out.
- Known limitation (documented, not yet mitigated): member public keys and
  the roster are served by the backend without end-to-end authentication
  (no pinning, signed rosters, or key transparency). A malicious server
  operator could substitute keys or insert a ghost member and receive future
  circle keys from honest clients. Fixing this requires identity-key
  pinning/verification UX and is tracked as its own phase.

### Recovery UX (pragmatic profile)

Clerk handles auth (OAuth — no password to derive keys from), so the master
key is device-generated. Three recovery paths, in order:

1. iCloud Keychain sync (iOS, automatic).
2. Recovery code (`XXXXX-XXXXX-…`), shown once at key generation and
   re-viewable in settings; redeems `encMasterKeyByRecovery` on a new device.
3. Key reset (`keys.resetKeys`) as the explicit last resort when the code is
   lost: replaces the registered key material, deletes the now-unreadable
   grants, and shows a fresh recovery code that must be acknowledged. Because
   media keys live in circle epochs (not user keys), shared-circle media comes
   back automatically through the multi-epoch grant top-up once any other
   key-holding member is online. Only solo-circle history is permanently
   lost; the destructive confirm in the app spells that out. Trade-off: an
   attacker holding a valid auth session could trigger a reset and then
   receive re-grants like a new joiner — the same server-trust exposure as
   the roster gap documented below.
4. A failed key bootstrap surfaces as a dedicated retry screen
   (`CryptoGate`, status `unavailable`) instead of failing silently.

## Media format: BSE1 (`packages/crypto/src/fileEncryption.ts`)

36-byte header (magic `BSE1`, version, algorithm, chunk size, plaintext
length, 16-byte file nonce) followed by fixed-size chunks encrypted with
XChaCha20-Poly1305; chunk nonce = fileNonce ‖ chunk index, AD =
base64(header ‖ final-flag byte) as a UTF-8 string (react-native-libsodium
only implements string AD inputs). Properties:

- Chunks decrypt independently → HTTP range requests can fetch and decrypt
  exactly the chunks a video player asks for. No video duration limit is
  needed; playback streams via a local decrypting proxy instead of
  download-everything-first. R2 has zero egress fees, so ranged streaming
  costs nothing extra.
- The authenticated header (length + final flag) rules out truncation and
  chunk reordering.
- Default chunk size 1 MiB; previews use the same format via
  `encryptBytes`/`decryptBytes`.
- Live Photos upload the companion clip as a third object
  (`assets.pairedVideoStorage`), encrypted with `encryptFileToFile` under the
  same per-asset file key — one envelope covers still, preview and clip. The
  viewer decrypts it through the media cache's `pairedVideo` variant.
- The header's chunk-size field is read before any chunk is authenticated, so
  parsing rejects values above `MAX_CHUNK_SIZE` (8 MiB) and the video proxy
  additionally caps single ranged fetches — a crafted header from a malicious
  member cannot force multi-gigabyte allocations on viewers' devices.

## What stays plaintext (deliberate)

- `capturedAt`, dimensions, mimeType, sizes — needed for sorting, limits and
  billing; billing charges the server-observed ciphertext size (HEAD), which
  works unchanged.
- NOT location: GPS metadata moves into the encrypted envelope in the media
  phase. The map/places view is rebuilt client-side from decrypted metadata
  (memories aggregation for places leaves the server).
- Captions/comments/reactions remain plaintext for now (explicitly out of
  scope for the media phase).

## Phasing

- **Phase 0 (done):** `@beisammen/crypto`, key registry (`convex/keys.ts`),
  keychain + bootstrap/recovery logic in
  `apps/mobile/src/features/crypto/`, grant cleanup on member removal /
  leave / account deletion.
- **Phase 1 (done):** encrypt originals + previews in the upload pipeline (BSE1,
  per-asset file key wrapped with the circle-key epoch, stored on
  `assets.encryption`), decrypting media cache on display, encrypted GPS +
  original file name in `encMetadata`, generic upload file names, client-side
  place aggregation. EXIF stripping became unnecessary: originals and
  previews are both ciphertext server-side, and decrypted content is only
  ever visible to circle members.
- **Phase 2 (done):** encrypted video originals stream via a local
  range-decrypting HTTP proxy in the app process
  (`apps/mobile/src/features/media/video-proxy/`): a loopback TCP server
  (react-native-tcp-socket, 127.0.0.1, OS-assigned port) serves
  `/v/<random-token>` URLs to the native player. Seeks map to chunk indexes,
  ciphertext ranges are fetched straight from R2 and decrypted in memory —
  Convex only signs URLs, roughly one `assets.getReadUrl` call per 5-minute
  URL window (refreshed early and on 403). A fully decrypted cache file is
  preferred over the proxy when it exists; images/previews keep the
  decrypted-cache path, and the explicit download/save/share flows keep
  download-then-decrypt (they need a real file). Android release builds allow
  cleartext only for 127.0.0.1/localhost via a network security config
  (`apps/mobile/plugins/with-localhost-cleartext.js`); iOS allows localhost
  through `NSAllowsLocalNetworking`.
- **Phase 3:** E2EE web share links: share key in the URL fragment (never
  sent to the server), browser decrypts via WASM libsodium. Public links
  were removed until this exists.
- **Migration:** existing plaintext assets stay readable; clients re-encrypt
  opportunistically or content is marked "pre-E2EE".

## Local plaintext lifecycle

Decrypted media exists on-device as plaintext in the decrypted display cache
(`decrypted-media/<circleId>/` in the cache directory, size-capped) and the
save/share download directory. Both are deleted on sign-out and instance
switch (`session-provider.tsx` → `clearDecryptedMediaCache` /
`clearShareDownloads`), so plaintext never outlives the session that was
authorized to decrypt it. The cache is additionally scoped per circle: leaving
a circle drops its subdirectory immediately
(`clearCircleDecryptedMedia`), and once per session after sign-in the cache is
reconciled against the current membership list so removals that happened while
the app was closed are cleaned up on the next start
(`use-decrypted-cache-reconciliation.ts` → `reconcileDecryptedMediaCache`).
Upload-recovery files (which include pre-encryption source copies) are cleared
per instance on sign-out as before.

## Known gaps

- Circle cover images and user profile images still use the legacy plaintext
  image pipeline (`imageUploads`, no BSE1 envelope) — the server and storage
  operator can read them. They are served through short-lived presigned URLs
  and cached on-device by expo-image under the storage object key; the
  fullscreen avatar view reuses that same source, so it adds no new plaintext
  on disk. Moving them onto the encrypted pipeline needs a schema + read-path
  migration and is open.
- No end-to-end authentication of member identity keys (see "Epochs and
  membership" above).
