import { assert } from 'chai';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseBankKeys } from '../../lib/orders/bankKeys.js';
import Key from '../../lib/keymanagers/Key.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
const modulus = Buffer.from(jwk.n, 'base64url');
const exponent = Buffer.from(jwk.e, 'base64url');

const keyValue = `<PubKeyValue><ds:RSAKeyValue><ds:Modulus>${modulus.toString('base64')}</ds:Modulus><ds:Exponent>${exponent.toString('base64')}</ds:Exponent></ds:RSAKeyValue></PubKeyValue>`;
const certificate = (base64: string) => `<ds:X509Data><ds:X509Certificate>${base64}</ds:X509Certificate></ds:X509Data>`;

const h005OrderData = (content: string) => `<?xml version="1.0" encoding="UTF-8"?>
<HPBResponseOrderData xmlns="urn:org:ebics:H005" xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
	<AuthenticationPubKeyInfo>${content}<AuthenticationVersion>X002</AuthenticationVersion></AuthenticationPubKeyInfo>
	<EncryptionPubKeyInfo>${content}<EncryptionVersion>E002</EncryptionVersion></EncryptionPubKeyInfo>
	<HostID>HOST</HostID>
</HPBResponseOrderData>`;

/** The base64 body of a self-signed certificate, as a bank puts it into ds:X509Certificate. */
const certificateBase64 = (): string =>
	new Key({ size: 2048, certificateOptions: { subject: 'bank' } }).certificatePem().replace(/-----[^-]+-----|\s/g, '');

describe('HPB bank keys', () => {
	it('reads RSAKeyValue (Modulus/Exponent) from H005 order data', () => {
		const keys = parseBankKeys(h005OrderData(keyValue), 'certificate') as Record<string, { mod: Buffer; exp: Buffer }>;

		assert.hasAllKeys(keys, ['bankX002', 'bankE002']);
		assert.deepEqual(keys.bankX002!.mod, modulus);
		assert.deepEqual(keys.bankE002!.exp, exponent);

		const key = new Key(keys.bankE002!);
		assert.strictEqual((key.n() as Buffer).toString('hex').replace(/^0+/, ''), modulus.toString('hex').replace(/^0+/, ''), 'usable as a bank key');
	});

	it('reads X509 certificates and prefers the requested format when both are present', () => {
		const cert = certificateBase64();

		const onlyCertificate = parseBankKeys(h005OrderData(certificate(cert)), 'certificate');
		assert.include(Object.keys(onlyCertificate.bankX002!), 'pem');

		const both = h005OrderData(certificate(cert) + keyValue);
		assert.include(Object.keys(parseBankKeys(both, 'certificate').bankX002!), 'pem');
		assert.include(Object.keys(parseBankKeys(both, 'keyValue').bankX002!), 'mod');
	});

	it('still reads the H004 fixture', () => {
		const keys = parseBankKeys(readFileSync(join(__dirname, '../fixtures/HPB_response_data.xml'), 'utf8'), 'keyValue');

		assert.hasAllKeys(keys, ['bankX002', 'bankE002']);
	});

	it('returns no keys for empty order data', () => {
		assert.deepEqual(parseBankKeys('', 'certificate'), {});
	});
});
