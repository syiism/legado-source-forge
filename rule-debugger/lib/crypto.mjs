import crypto from 'node:crypto';

const utf8 = (s) => Buffer.from(String(s), 'utf8');

export function signedBytes(buf) {
  return Array.from(buf, (b) => (b > 127 ? b - 256 : b));
}

export function unsignedBuffer(data, encoding = 'utf8') {
  if (Array.isArray(data)) return Buffer.from(data.map((x) => x & 255));
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data), encoding);
}

export function md5Encode(str) {
  return crypto.createHash('md5').update(utf8(str)).digest('hex');
}

export function md5Encode16(str) {
  return md5Encode(str).slice(8, 24);
}

export function base64Encode(data) {
  return unsignedBuffer(data).toString('base64');
}

export function base64Decode(str) {
  return Buffer.from(String(str).replace(/\s+/g, ''), 'base64').toString('utf8');
}

export function base64DecodeBytes(str) {
  return signedBytes(Buffer.from(String(str).replace(/\s+/g, ''), 'base64'));
}

export function hexEncode(str) {
  return unsignedBuffer(str).toString('hex');
}

export function hexDecode(hex) {
  return Buffer.from(String(hex), 'hex').toString('utf8');
}

export function hexDecodeBytes(hex) {
  return signedBytes(Buffer.from(String(hex), 'hex'));
}

function digestAlgorithm(name) {
  const key = String(name ?? 'md5').toLowerCase().replace(/[\s_-]/g, '');
  const map = {
    md5: 'md5',
    md516: 'md5',
    sha1: 'sha1',
    sha256: 'sha256',
    sha384: 'sha384',
    sha512: 'sha512',
    sha3: 'sha3-256',
    sha3256: 'sha3-256',
    sha3512: 'sha3-512',
  };
  const alg = map[key];
  if (!alg) throw new Error(`Unknown digest algorithm: ${name}`);
  return { alg, isMd516: key === 'md516' };
}

export function digestHex(data, algorithm = 'md5') {
  const { alg, isMd516 } = digestAlgorithm(algorithm);
  const hex = crypto.createHash(alg).update(unsignedBuffer(data)).digest('hex');
  return isMd516 ? hex.slice(8, 24) : hex;
}

export function digestBase64(data, algorithm = 'md5') {
  const { alg } = digestAlgorithm(algorithm);
  return crypto.createHash(alg).update(unsignedBuffer(data)).digest('base64');
}

function hmacAlgorithm(name) {
  const raw = String(name ?? 'HmacSHA256').replace(/^hmac/i, '');
  return digestAlgorithm(raw || 'sha256').alg;
}

export function hmacHex(algorithm, key, data) {
  return crypto.createHmac(hmacAlgorithm(algorithm), unsignedBuffer(key)).update(unsignedBuffer(data)).digest('hex');
}

export function hmacBase64(algorithm, key, data) {
  return crypto.createHmac(hmacAlgorithm(algorithm), unsignedBuffer(key)).update(unsignedBuffer(data)).digest('base64');
}

function parseTransformation(transformation) {
  const parts = String(transformation || 'AES/ECB/PKCS5Padding').split('/');
  return {
    alg: (parts[0] || 'AES').toUpperCase(),
    mode: (parts[1] || 'ECB').toUpperCase(),
    padding: parts[2] || 'PKCS5Padding',
  };
}

function cipherName({ alg, mode }, keyLength) {
  const normalized = { DESEDE: 'DESEDE', TRIPLEDES: 'DESEDE' }[alg] ?? alg;
  if (normalized === 'AES') {
    const bits = { 16: 128, 24: 192, 32: 256 }[keyLength];
    if (!bits) throw new Error(`Invalid AES key length: ${keyLength} bytes`);
    return `aes-${bits}-${mode.toLowerCase()}`;
  }
  if (normalized === 'DES') {
    // OpenSSL 3 默认 provider 关闭单 DES；3DES 三组相同密钥在数学上等价于单 DES
    return mode === 'ECB' ? 'des-ede3' : `des-ede3-${mode.toLowerCase()}`;
  }
  if (normalized === 'DESEDE') {
    return mode === 'ECB' ? 'des-ede3' : `des-ede3-${mode.toLowerCase()}`;
  }
  throw new Error(`Unsupported symmetric algorithm: ${alg}`);
}

export function createSymmetricCrypto(transformation, key, iv) {
  const spec = parseTransformation(transformation);
  const normalizeKey = (bytes) => {
    if (spec.alg === 'DES') {
      if (bytes.length !== 8) throw new Error(`Invalid DES key length: ${bytes.length} bytes`);
      return Buffer.concat([bytes, bytes, bytes]);
    }
    if (spec.alg === 'DESEDE' || spec.alg === 'TRIPLEDES') {
      if (bytes.length !== 24) throw new Error(`Invalid 3DES key length: ${bytes.length} bytes`);
    }
    return bytes;
  };
  let keyBytes = normalizeKey(unsignedBuffer(key));
  let ivBytes = iv === undefined || iv === null || iv === '' ? null : unsignedBuffer(iv);
  let autoPadding = !/NoPadding/i.test(spec.padding);
  const name = (bytes) => cipherName(spec, bytes.length);

  const run = (direction, data) => {
    const bytes = unsignedBuffer(data);
    const algorithm = name(keyBytes);
    const needsIv = spec.mode !== 'ECB';
    if (needsIv && (!ivBytes || ivBytes.length === 0)) throw new Error(`${spec.alg}/${spec.mode} requires an iv`);
    const cipher = direction === 'encrypt'
      ? crypto.createCipheriv(algorithm, keyBytes, needsIv ? ivBytes : null)
      : crypto.createDecipheriv(algorithm, keyBytes, needsIv ? ivBytes : null);
    if (spec.mode === 'GCM') {
      if (direction === 'encrypt') {
        return Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
      }
      const tag = bytes.subarray(bytes.length - 16);
      const body = bytes.subarray(0, bytes.length - 16);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(body), cipher.final()]);
    }
    cipher.setAutoPadding(autoPadding);
    return Buffer.concat([cipher.update(bytes), cipher.final()]);
  };

  return {
    setKey(next) {
      keyBytes = normalizeKey(unsignedBuffer(next));
      return this;
    },
    setIv(next) {
      ivBytes = next === undefined || next === null || next === '' ? null : unsignedBuffer(next);
      return this;
    },
    setAutoPadding(flag) {
      autoPadding = Boolean(flag);
      return this;
    },
    encrypt(data) {
      return signedBytes(run('encrypt', data));
    },
    encryptBase64(data) {
      return run('encrypt', data).toString('base64');
    },
    encryptHex(data) {
      return run('encrypt', data).toString('hex');
    },
    decrypt(data) {
      return signedBytes(run('decrypt', data));
    },
    decryptBase64(data) {
      return signedBytes(run('decrypt', Buffer.from(String(data).replace(/\s+/g, ''), 'base64')));
    },
    decryptHex(data) {
      return signedBytes(run('decrypt', Buffer.from(String(data), 'hex')));
    },
    decryptStr(data) {
      return run('decrypt', Buffer.from(String(data).replace(/\s+/g, ''), 'base64')).toString('utf8');
    },
  };
}

function toPem(value, label) {
  const text = String(value).trim();
  if (text.includes('-----BEGIN')) return text;
  const wrapped = text.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
}

export function createAsymmetricCrypto(transformation, key, privateKey) {
  const padding = /NoPadding/i.test(String(transformation))
    ? crypto.constants.RSA_NO_PADDING
    : crypto.constants.RSA_PKCS1_PADDING;
  const privatePem = privateKey ? toPem(privateKey, 'PRIVATE KEY') : null;
  const rawKey = String(key ?? '');

  const publicKeyObject = () => {
    if (/-----BEGIN/.test(rawKey)) {
      if (/PRIVATE KEY/.test(rawKey)) return crypto.createPublicKey(rawKey);
      return crypto.createPublicKey(rawKey);
    }
    if (privatePem) return crypto.createPublicKey(privatePem);
    return crypto.createPublicKey(toPem(rawKey, 'PUBLIC KEY'));
  };
  const privateKeyObject = () => {
    const pem = privatePem ?? (/PRIVATE KEY/.test(rawKey) ? rawKey : toPem(rawKey, 'PRIVATE KEY'));
    return crypto.createPrivateKey(pem);
  };

  return {
    encrypt(data) {
      return signedBytes(crypto.publicEncrypt({ key: publicKeyObject(), padding }, unsignedBuffer(data)));
    },
    encryptBase64(data) {
      return crypto.publicEncrypt({ key: publicKeyObject(), padding }, unsignedBuffer(data)).toString('base64');
    },
    decrypt(data) {
      return signedBytes(crypto.privateDecrypt({ key: privateKeyObject(), padding }, unsignedBuffer(data)));
    },
    decryptBase64(data) {
      return signedBytes(crypto.privateDecrypt({ key: privateKeyObject(), padding },
        Buffer.from(String(data).replace(/\s+/g, ''), 'base64')));
    },
    decryptStr(data) {
      return crypto.privateDecrypt({ key: privateKeyObject(), padding }, unsignedBuffer(data)).toString('utf8');
    },
  };
}

export function createSign() {
  throw new Error('java.createSign 尚未实现（离线调试器不支持签名对象）');
}

export function signedBytesOf(data) {
  return signedBytes(unsignedBuffer(data));
}
