
import { assert } from 'chai';

import fixtures from '../fixtures/keys.js';
import Key from '../../lib/keymanagers/Key.js';

const stripWhitespace = (str: string): string => str.replace(/\s+/g, '');

describe('Keys management', () => {
	describe('generates brand new', () => {
		const keySize = 2048;
		const newKey = Key.generate();

		it('private key', () => {
			assert.isTrue(newKey.storePrivateKey);
		});

		it('that has the right key size', () => {
			assert(newKey.size(), String(keySize));
		});
	});

	describe('creates public key from mod and exp', () => {
		const { pem, mod, exp } = fixtures.pblc.big;

		describe('that are strings', () => {
			const m = Buffer.from(mod.string, 'base64');
			const e = Buffer.from(exp.string, 'base64');
			const newKey = new Key({ mod: m, exp: e });

			it('and is really public', () => {
				assert.isTrue(newKey.storePublicKey);
			});


			it('and has a propper mod in bytes', () => {
				assert.deepEqual([...newKey.n()], mod.bytes);
			});

			it('and has a propper pem string', () => {
				assert.equal(stripWhitespace(newKey.toPem()), stripWhitespace(pem));
			});
		});

		describe('that are bytes', () => {
			const m = Buffer.from(mod.bytes);
			const e = Buffer.from(exp.bytes);
			const newKey = new Key({ mod: m, exp: e });

			it('and is really public', () => {
				assert.isTrue(newKey.storePublicKey);
			});

			it('and has a propper mod as a string', () => {
				assert.equal(newKey.n().toString('base64'), mod.string);
			});

			it('and has a propper pem string', () => {
				assert.equal(stripWhitespace(newKey.toPem()), stripWhitespace(pem));
			});
		});
	});

	describe('creates public key from pem string', () => {
		const { pem } = fixtures.pblc.big;
		const newKey = new Key({ pem });

		it('and is really public', () => {
			assert.isTrue(newKey.storePublicKey);
		});

		it('and has a propper(the same) pem string', () => {
			assert.equal(stripWhitespace(newKey.toPem()), stripWhitespace(pem));
		});
	});
});
