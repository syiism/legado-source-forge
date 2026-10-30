import crypto from 'node:crypto';
import {
  signedBytes,
  unsignedBuffer,
  createSymmetricCrypto,
} from './crypto.mjs';

const bytes = (data) => unsignedBuffer(data);

function javaUrlEncode(str, enc = 'UTF-8') {
  return encodeURIComponent(String(str))
    .replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

function javaString(value) {
  if (Array.isArray(value) || Buffer.isBuffer(value)) {
    const text = Buffer.from(Array.from(value, (x) => x & 255)).toString('utf8');
    return makeString(text);
  }
  return makeString(String(value));
}

function makeString(text) {
  return {
    getBytes(charset = 'UTF-8') {
      return signedBytes(Buffer.from(text, String(charset).toLowerCase().includes('gb') ? 'gbk' : 'utf8'));
    },
    toString() {
      return text;
    },
    length() {
      return text.length;
    },
    valueOf() {
      return text;
    },
  };
}

class Cipher {
  constructor(transformation) {
    this.transformation = transformation;
    this.mode = null;
    this.key = null;
    this.iv = null;
    this.padding = /NoPadding/i.test(transformation) ? 'NoPadding' : 'PKCS5Padding';
  }

  init(mode, keySpec, ivSpec) {
    this.mode = mode;
    this.key = bytes(keySpec?.k ?? keySpec);
    this.iv = ivSpec ? bytes(ivSpec.v ?? ivSpec) : null;
    return this;
  }

  doFinal(data) {
    const transformation = String(this.transformation).includes('/')
      ? this.transformation
      : `${this.transformation}/${/NoPadding/i.test(this.padding) ? 'ECB/NoPadding' : 'ECB/PKCS5Padding'}`;
    const cipher = createSymmetricCrypto(transformation, Array.from(this.key), this.iv ? Array.from(this.iv) : null);
    return this.mode === Cipher.DECRYPT_MODE ? cipher.decrypt(bytes(data)) : cipher.encrypt(bytes(data));
  }

  update(data) {
    return this.doFinal(data);
  }
}
Cipher.getInstance = (transformation) => new Cipher(transformation);
Cipher.ENCRYPT_MODE = 1;
Cipher.DECRYPT_MODE = 2;

class MessageDigest {
  constructor(algorithm) {
    this.algorithm = String(algorithm);
    this.chunks = [];
  }
  update(data) {
    this.chunks.push(bytes(data));
    return this;
  }
  digest(data) {
    if (data !== undefined) this.chunks.push(bytes(data));
    const alg = { 'SHA-1': 'sha1', 'SHA-256': 'sha256', 'SHA-512': 'sha512', 'MD5': 'md5' }[this.algorithm.toUpperCase()]
      ?? this.algorithm.toLowerCase();
    const hash = crypto.createHash(alg);
    for (const chunk of this.chunks) hash.update(chunk);
    return signedBytes(hash.digest());
  }
}
MessageDigest.getInstance = (algorithm) => new MessageDigest(algorithm);

class SecureRandom {
  nextBytes(array) {
    const buf = crypto.randomBytes(array.length);
    for (let i = 0; i < array.length; i++) array[i] = buf[i] > 127 ? buf[i] - 256 : buf[i];
    return array;
  }
  nextInt(bound) {
    return Math.floor(Math.random() * (bound || 0x7fffffff));
  }
}

class StringBuilder {
  constructor(value = '') {
    this.parts = [String(value)];
  }
  append(v) {
    this.parts.push(String(v));
    return this;
  }
  toString() {
    return this.parts.join('');
  }
}

class HashMap {
  constructor() {
    this.map = new Map();
  }
  put(k, v) {
    this.map.set(String(k), v);
    return v;
  }
  get(k) {
    return this.map.get(String(k)) ?? null;
  }
  containsKey(k) {
    return this.map.has(String(k));
  }
  remove(k) {
    return this.map.delete(String(k));
  }
  size() {
    return this.map.size;
  }
  keySet() {
    return [...this.map.keys()];
  }
}

const androidBase64 = {
  DEFAULT: 0,
  NO_PADDING: 1,
  NO_WRAP: 2,
  URL_SAFE: 8,
  encodeToString(data, flags = 0) {
    let out = bytes(data).toString(flags & 8 ? 'base64url' : 'base64');
    if (flags & 1) out = out.replace(/=+$/, '');
    return out;
  },
  decode(str, flags = 0) {
    const text = String(str).replace(/\s+/g, '');
    return signedBytes(Buffer.from(text, flags & 8 ? 'base64url' : 'base64'));
  },
};

const javaBase64 = {
  getEncoder() {
    return { encodeToString: (data) => Buffer.from(Array.from(data, (x) => x & 255)).toString('base64') };
  },
  getUrlEncoder() {
    return { encodeToString: (data) => Buffer.from(Array.from(data, (x) => x & 255)).toString('base64url') };
  },
  getDecoder() {
    return { decode: (str) => signedBytes(Buffer.from(String(str), 'base64')) };
  },
};

export function createPackages() {
  return {
    java: {
      lang: {
        String: javaString,
        StringBuilder,
        Integer: {
          parseInt: (v) => parseInt(v, 10),
          valueOf: (v) => parseInt(v, 10),
          toString: (v) => String(v),
          MAX_VALUE: 2147483647,
        },
        Long: { parseLong: (v) => Number(v), MAX_VALUE: Number.MAX_SAFE_INTEGER },
        Thread: { sleep: () => {} },
        System: {
          arraycopy(src, srcPos, dest, destPos, length) {
            for (let i = 0; i < length; i++) dest[destPos + i] = src[srcPos + i];
            return dest;
          },
          currentTimeMillis: () => Date.now(),
          getProperty: () => '',
          out: { println: () => {} },
          err: { println: () => {} },
        },
      },
      net: {
        URLEncoder: { encode: javaUrlEncode },
        URL: function (value) {
          return { toString: () => String(value), toExternalForm: () => String(value) };
        },
      },
      security: {
        MessageDigest,
        SecureRandom,
      },
      util: {
        Base64: javaBase64,
        UUID: { randomUUID: () => ({ toString: () => crypto.randomUUID() }) },
        Arrays: {
          copyOf: (src, len) => Array.from(src).slice(0, len),
          copyOfRange: (src, from, to) => Array.from(src).slice(from, to),
          equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        },
        HashMap,
      },
      nio: {
        charset: {
          StandardCharsets: { UTF_8: { name: () => 'UTF-8' }, GBK: { name: () => 'GBK' } },
        },
      },
    },
    android: {
      util: { Base64: androidBase64 },
    },
    javax: {
      crypto: {
        Cipher,
        spec: {
          SecretKeySpec: function (b) {
            this.k = Array.from(b, (x) => x & 255);
          },
          IvParameterSpec: function (b) {
            this.v = Array.from(b, (x) => x & 255);
          },
          GCMParameterSpec: function (tagBits, b) {
            this.v = Array.from(b, (x) => x & 255);
            this.tagBits = tagBits;
          },
        },
      },
    },
  };
}
