
import { join, dirname } from 'node:path';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';


import BankLetter from '../../lib/BankLetter.js';
import createTestClient from '../create-test-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = createTestClient();

const createDir = (where: string): void => {
	try {
		mkdirSync(where);
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
			throw e;
	}
};

describe('BankLetter', () => {
	let bankLetterGenerator: BankLetter | null = null;

	it('creates an instance', () => assert.doesNotThrow(() => {
		bankLetterGenerator = new BankLetter({
			client,
			bankName: 'Credit Suisse AG',
			template: readFileSync(join(__dirname, '../../templates/ini_de.hbs'), { encoding: 'utf8' }),
		});
	}));

	it('genrates a letter', async () => assert.doesNotThrow(async () => bankLetterGenerator!.generate()));
	it('throws with invalid serliazitaion path', async () => bankLetterGenerator!.serialize('').catch(e => assert.instanceOf(e, Error)));
	it('serliaziers a letter to disk', async () => {
		createDir('.test_tmp');
		await bankLetterGenerator!.serialize('.test_tmp/test_letter.html').then(t => assert.equal(t, true));
		assert.equal(existsSync('.test_tmp/test_letter.html'), true);
	});
});
