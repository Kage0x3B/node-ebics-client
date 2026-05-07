import { assert } from 'chai';
import { constants, randomBytes, verify } from 'node:crypto';

import Crypto from '../../lib/crypto/Crypto.js';
import Key from '../../lib/keymanagers/Key.js';

// Round-trips Crypto.sign() through node:crypto's RSA-PSS verifier.
//
// This is a regression guard against byte-level corruption of the PSS-encoded
// message. The migration uncovered a rolldown/oxc bug that silently dropped
// the `\x01` separator byte from `Buffer.from('\x01')` literals, producing
// structurally invalid PSS padding that no verifier would accept.
//
// Any future bundler/transform regression that mangles bytes in emsaPSS()
// will fail here — node's verify only accepts a valid PSS-encoded message.
describe('Crypto.sign — PSS signature round-trip', () => {
	it('produces a signature that node:crypto verifies as valid', () => {
		const key = Key.generate(2048);
		const message = Buffer.from('ebics-pss-roundtrip-probe');
		const salt = randomBytes(32);

		const signatureBase64 = Crypto.sign(key, message, salt);
		const signature = Buffer.from(signatureBase64, 'base64');

		const ok = verify(
			'sha256',
			message,
			{
				key: key.toPem(),
				padding: constants.RSA_PKCS1_PSS_PADDING,
				saltLength: 32,
			},
			signature,
		);

		assert.isTrue(ok, 'node:crypto rejected the PSS signature — likely byte-level corruption in emsaPSS');
	});

	it('produces signatures of the expected length (256 bytes for 2048-bit key)', () => {
		const key = Key.generate(2048);
		const signature = Buffer.from(Crypto.sign(key, Buffer.from('hi')), 'base64');
		assert.equal(signature.length, 256, 'PSS signature must be exactly modulus-byte-length');
	});
});
