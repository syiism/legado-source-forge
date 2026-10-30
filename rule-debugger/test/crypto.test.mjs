import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  md5Encode,
  md5Encode16,
  base64Encode,
  base64Decode,
  base64DecodeBytes,
  hexEncode,
  hexDecode,
  digestHex,
  digestBase64,
  hmacHex,
  hmacBase64,
  createSymmetricCrypto,
  createAsymmetricCrypto,
} from '../lib/crypto.mjs';

test('md5Encode / md5Encode16 对齐 JsEncodeUtils', () => {
  assert.equal(md5Encode('hello'), '5d41402abc4b2a76b9719d911017c592');
  assert.equal(md5Encode16('hello'), 'bc4b2a76b9719d91');
  assert.equal(md5Encode('中文'), md5Encode('中文'));
  assert.equal(md5Encode16('中文').length, 16);
});

test('base64 / hex 往返与有符号字节语义', () => {
  assert.equal(base64Encode('hello'), 'aGVsbG8=');
  assert.equal(base64Decode('aGVsbG8='), 'hello');
  assert.equal(base64Decode('aGVs\nbG8='), 'hello');
  assert.deepEqual(base64DecodeBytes('/w=='), [-1]);
  assert.equal(hexEncode('hi'), '6869');
  assert.equal(hexDecode('6869'), 'hi');
});

test('digestHex / digestBase64 支持 sha256 与 md5_16', () => {
  assert.equal(
    digestHex('abc', 'sha256'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(digestBase64('abc', 'md5'), 'kAFQmDzST7DWlj99KOF/cg==');
  assert.equal(digestHex('hello', 'md5_16'), md5Encode16('hello'));
});

test('HMAC 已知向量（RFC 4231 case 2）', () => {
  assert.equal(
    hmacHex('HmacSHA256', 'Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  );
  assert.equal(
    hmacBase64('HmacSHA256', 'Jefe', 'what do ya want for nothing?'),
    'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=',
  );
});

test('AES-128/ECB/NoPadding NIST SP 800-38A 向量', () => {
  const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
  const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
  const crypto = createSymmetricCrypto('AES/ECB/NoPadding', key);
  assert.equal(crypto.encryptHex(plain), '3ad77bb40d7a3660a89ecaf32466ef97');
  assert.deepEqual(crypto.decryptHex('3ad77bb40d7a3660a89ecaf32466ef97'), [...plain].map((b) => (b > 127 ? b - 256 : b)));
});

test('AES-128/CBC/NoPadding NIST 向量 + IV 缺失报错', () => {
  const key = Buffer.from('2b7e151628aed2a6abf7158809cf4f3c', 'hex');
  const iv = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const plain = Buffer.from('6bc1bee22e409f96e93d7e117393172a', 'hex');
  const crypto = createSymmetricCrypto('AES/CBC/NoPadding', key, iv);
  assert.equal(crypto.encryptHex(plain), '7649abac8119b246cee98e9b12e9197d');
  assert.throws(() => createSymmetricCrypto('AES/CBC/PKCS5Padding', key).encryptHex(plain), /requires an iv/);
});

test('AES/CBC/PKCS5Padding 中文往返与 Base64 输出', () => {
  const key = Buffer.from('0123456789abcdef', 'utf8');
  const iv = Buffer.from('abcdef0123456789', 'utf8');
  const crypto = createSymmetricCrypto('AES/CBC/PKCS5Padding', key, iv);
  const encoded = crypto.encryptBase64('长夜将至，我从今开始守望');
  assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(crypto.decryptStr(encoded), '长夜将至，我从今开始守望');
});

test('DES / 3DES 往返', () => {
  const des = createSymmetricCrypto('DES/ECB/PKCS5Padding', '12345678');
  assert.equal(des.decryptStr(des.encryptBase64('legado')), 'legado');
  const triple = createSymmetricCrypto('DESede/CBC/PKCS5Padding', '123456781234567812345678', '12345678');
  assert.equal(triple.decryptStr(triple.encryptBase64('book source')), 'book source');
});

test('RSA 公钥加密 / 私钥解密', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const rsa = createAsymmetricCrypto('RSA/ECB/PKCS1Padding', publicKey, privateKey);
  const encoded = rsa.encryptBase64('secret payload');
  const decrypted = rsa.decryptBase64(encoded);
  assert.equal(Buffer.from(decrypted.map((b) => b & 255)).toString('utf8'), 'secret payload');
});
