import { randomBytes } from 'crypto';

export function createOpaqueShareToken() {
  return randomBytes(24).toString('base64url');
}
