import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const parameters = { cost: 32768, blockSize: 8, parallelization: 1, keyLength: 64 };
const maxMemory = 128 * 1024 * 1024;

export const hashPassword = async password => {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, parameters.keyLength, {
    N: parameters.cost,
    r: parameters.blockSize,
    p: parameters.parallelization,
    maxmem: maxMemory
  });
  return [
    'scrypt',
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
};

export const verifyPassword = async (password, encodedHash) => {
  try {
    const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey] = String(encodedHash).split('$');
    if (algorithm !== 'scrypt' || !encodedSalt || !encodedKey) return false;

    const salt = Buffer.from(encodedSalt, 'base64url');
    const expectedKey = Buffer.from(encodedKey, 'base64url');
    if (!salt.length || !expectedKey.length) return false;

    const derivedKey = await scrypt(password, salt, expectedKey.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelization),
      maxmem: maxMemory
    });
    return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
  } catch {
    return false;
  }
};
