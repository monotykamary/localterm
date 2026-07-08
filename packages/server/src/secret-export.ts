import { Decrypter, Encrypter, armor } from "age-encryption";
import { SECRET_EXPORT_VERSION, SECRET_EXPORT_SCRYPT_WORK_FACTOR } from "./constants.js";
import { secretExportPayloadSchema } from "./schemas.js";
import type { SecretExportEntry, SecretExportPayload } from "./types.js";

// Encrypt the export's secrets with an age passphrase and ASCII-armor the
// ciphertext. Armored output is a copy-pasteable text file interoperable with
// the stock `age` CLI (`age -d -p`), so a user isn't locked into localterm to
// decrypt. The scrypt work factor defaults to SECRET_EXPORT_SCRYPT_WORK_FACTOR
// (age's 2^18) for the strongest affordable KDF on a one-time export; tests
// inject a lower factor. The versioned payload is built here so the route
// never handles the version literal.
export const encryptSecretExport = async (
  secrets: SecretExportEntry[],
  passphrase: string,
  scryptWorkFactor = SECRET_EXPORT_SCRYPT_WORK_FACTOR,
): Promise<string> => {
  const payload: SecretExportPayload = { version: SECRET_EXPORT_VERSION, secrets };
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(scryptWorkFactor);
  const ciphertext = await encrypter.encrypt(JSON.stringify(payload));
  return armor.encode(ciphertext);
};

// Decrypt an armored export and zod-validate the payload. A wrong passphrase or
// a non-localterm file throws — age decryption is authenticated, so a bad
// passphrase fails the AEAD rather than returning garbage — and the caller
// maps the throw to a 400. Validation fails closed on a foreign/corrupt payload
// so it can never seed the store with malformed entries.
export const decryptSecretExport = async (
  armored: string,
  passphrase: string,
): Promise<SecretExportPayload> => {
  const decrypter = new Decrypter();
  decrypter.addPassphrase(passphrase);
  const plaintext = await decrypter.decrypt(armor.decode(armored), "text");
  const parsed = secretExportPayloadSchema.safeParse(JSON.parse(plaintext));
  if (!parsed.success) throw new Error("invalid export payload");
  return parsed.data;
};
