// Symmetric encryption for Pi.sshPrivateKeyEncrypted (see prisma/schema.prisma).
// Only the admin ever touches these keys - one server-side secret is
// enough, there's no per-user access boundary to enforce with per-user
// key derivation.
//
// AES-256-GCM: authenticated (a tampered/corrupted ciphertext fails to
// decrypt loudly instead of silently producing garbage that ssh would
// then choke on with a confusing error), and built into Node's `crypto`
// module - no new dependency for something this self-contained.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit, the recommended/standard GCM nonce size
const SALT = "beehive-monitoring-app-pi-ssh-key"; // fixed, not secret - see below

function getKey(): Buffer {
  const secret = process.env.SSH_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "SSH_KEY_ENCRYPTION_SECRET is not set - required to encrypt/decrypt " +
        "Pi SSH private keys. Generate one with `openssl rand -base64 32` " +
        "and set it in .env (see .env.example). Deliberately separate from " +
        "AUTH_SECRET: rotating one shouldn't invalidate the other.",
    );
  }
  // scrypt over a fixed salt turns any-length secret into exactly 32 bytes
  // (AES-256's key size) deterministically - not password-hashing (this
  // isn't stored or compared, just used as a KDF), so a fixed salt is fine
  // here: the thing being protected is the secret's entropy, which the
  // salt doesn't add to.
  return scryptSync(secret, SALT, 32);
}

// Ciphertext layout: iv (12 bytes) || authTag (16 bytes) || ciphertext,
// base64-encoded as one string so it fits in the schema's single String?
// column.
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const key = getKey();
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
