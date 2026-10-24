# Private professional review handoff

The owner prepares a scoped, expiring signed review package in the legal workspace.
The encrypted offline path needs no reviewer account or external document service.
It does not authenticate a reviewer or create professional approval automatically.
The owner confirms the returning identity/decision through the agreed private channel.

## Owner to professional

1. Save the exact source revisions and create a signed package with named attorney/CPA
   grants. Check facts, redaction and permission to share. Keep the signing key private
   on the API; missing signing configuration fails closed.
2. Download the reusable **offline review reader** from the trusted owner site. Its
   HTML contains code only, no package, passphrase, signing secret or private facts.
3. In **Encrypted offline handoff**, generate a random passphrase or enter a strong
   separate passphrase, repeat it and confirm it is saved separately. Encryption runs
   locally. Download the opaque `.3dpreview` file. The passphrase fields clear after use.
4. Give the professional the encrypted data file and trusted reader. Convey the
   passphrase and independently verified signing-key fingerprint separately through
   the agreed trusted channel. Software does not send any of these automatically.

The unencrypted owner ZIP remains explicitly labeled for private owner use. Prefer
its encrypted derivative for the professional handoff. Obtain the reader itself through
an authentic source; a malicious replacement executable could lie about verification.
A public key or fingerprint bundled with a package alone does not establish identity.

## Offline recipient and return

Save `3dprint4me-review-reader.html` before disconnecting, then open it locally in a
browser supporting Web Crypto Ed25519 and streaming raw-deflate decompression. Select
the encrypted file, enter the passphrase and paste the independently trusted fingerprint.
The reader decrypts locally, verifies the Ed25519 signature over the canonical manifest,
and checks every listed file hash/size before offering individual Markdown, DOCX and
review-aid downloads. It rejects extra entries, unsafe names, unsupported methods and
bounded expansion failures. It never opens embedded documents or renders source HTML.

Edit/comment in the downloaded DOCX using the professional's normal document tools.
Use **Encrypt a returned DOCX** with a separate return passphrase saved for the owner.
The local output is another opaque `.3dpreview` file, with a different authenticated
purpose. Convey its return passphrase separately. Nothing is uploaded by the reader.
Send the exact source hash, granted scope, actual decision, conditions and review date
through the agreed private channel; file author labels do not verify identity.

The owner selects that encrypted return in the existing DOCX feedback form, enters its
return passphrase and confirms the named reviewer identity. Decryption occurs locally;
only the original DOCX bytes and the existing explicit source/reviewer evidence go to
the private API. A decoded copy stays only in the open view for unchanged uncertain
retries, preserving the command key. Navigating, concealment or sign-out clears it.
Importing preserves untrusted feedback and never edits source, resolves a concern,
publishes text or records approval. Record any actual professional decision separately.

## Format and bounds

The JSON envelope has exactly `format`, `purpose`, `kdf`, `cipher`, and `ciphertext`.
`format` is `3dprint4me-review-v1`; `purpose` is `review-archive` or `returned-docx`.
The header excluding ciphertext is canonical JSON and authenticated as GCM additional
associated data. All binary values use canonical padded base64.

- AES-256-GCM, 128-bit tag, a fresh random 12-byte IV for each encryption.
- PBKDF2-HMAC-SHA-256, exactly 600,000 iterations, fresh random 16-byte salt.
- Passphrases: 20–1024 UTF-8 bytes, used exactly without trimming or normalization.
  The generated default uses 24 random bytes encoded as 32 URL-safe characters.
- Review archive: 8 MiB plaintext maximum; encrypted JSON approximately 11 MiB maximum.
  Returned DOCX: 512 KiB plaintext maximum, with a separately bounded encrypted file.
- Reader ZIP directory: at most 100 entries, 32 MiB per entry and 64 MiB total expanded.
  Before trusting the signing key, manifest and signature expansion are bounded to
  256 KiB and 2 KiB. Streaming decompression aborts above the declared bounded size.
- The reader offers only verified individual files, not an unchecked decrypted ZIP.
  Names are flat, allowlisted data/document extensions; no path extraction occurs.

Unknown envelope keys, purposes, algorithms, KDF work factors or noncanonical base64
are rejected before expensive derivation. Wrong passphrases and GCM tampering share a
safe unlock failure. Passphrases never enter requests, storage, filenames or logs.
Browser strings cannot promise cryptographic memory erasure; fields/references and
private download URLs are cleared, but downloaded copies remain with their recipient.

Authenticated encryption uses the [Web Crypto AES-GCM/PBKDF2 model](https://www.w3.org/TR/WebCryptoAPI/).
The work factor follows the current [OWASP PBKDF2-HMAC-SHA-256 floor](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
This does not claim FIPS validation or memory-hard password derivation. Use the generated
random passphrase or a strong password-manager secret; human-readable length alone
is not a reliable strength estimate.

## Expiry, lifecycle and build

The server limits grants to thirty days and rejects expired download/review/import
requests. The offline reader checks its device clock and clears an open view after
expiry, concealment or page exit. A known passphrase and copied plaintext cannot be
revoked remotely, and a recipient can change their own clock. Server acceptance and
identity checks remain authoritative; do not present offline expiry as recall.

The reader has hash-bound inline script/style and CSP `connect-src 'none'`,
`form-action 'none'`, and `default-src 'none'`. Password forms also use `method=dialog`
to avoid native request fallback. It has no remote fonts, analytics or network client.
Owner passphrase processing stays outside the API command payload builder.

Source: `operator/review-reader/`, `operator/assets/review-envelope.js`, and
`operator/assets/partner-review-encryption.js`. Run `npm run review:reader:build`
after changes. `npm run validate` checks the generated reader for staleness; the
operator build copies it without requiring the development bundler. Commit `operator/review-reader.html`.
The shell caches only static code; encrypted/private payloads are never cached by it.

Native tests exercise a real signed package from restricted PostgreSQL through an
offline local-file reader and encrypted return. Synthetic fixture keys/decisions are
not actual professional clearance. Exact owner issuance, other portal acceptance
work and the staging/production release remain separate requirements.
