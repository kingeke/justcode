import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Base64url-encodes a buffer (RFC 7636 / 4648 §5, no padding). */
function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Creates a PKCE verifier and its S256 challenge. The verifier is a high-entropy
 * random string; the challenge is the base64url-encoded SHA-256 of the verifier.
 */
export function createPkcePair(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** A random base64url state value for CSRF protection on the OAuth redirect. */
export function createState(): string {
  return base64Url(randomBytes(16));
}
