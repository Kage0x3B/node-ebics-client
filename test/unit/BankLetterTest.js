'use strict';

/* eslint-env node, mocha */

const { assert } = require('chai');
const { join } = require('path');
const { readFileSync, mkdirSync, existsSync } = require('fs');


const BankLetter = require('../../lib/BankLetter');
const createTestClient = require('../create-test-client');

const client = createTestClient();

const createDir = (where) => {
	try {
		mkdirSync(where);
	} catch (e) {
		if (e.code !== 'EEXIST')
			throw e;
	}
};

describe('BankLetter', () => {
	let bankLetterGenerator = null;

	it('creates an instance', () => assert.doesNotThrow(() => {
		bankLetterGenerator = new BankLetter({
			client,
			bankName: 'Credit Suisse AG',
			template: readFileSync(join(__dirname, '../../templates/ini_de.hbs'), { encoding: 'utf8' }),
		});
	}));

	it('genrates a letter', async () => assert.doesNotThrow(async () => bankLetterGenerator.generate()));
	it('throws with invalid serliazitaion path', async () => bankLetterGenerator.serialize('').catch(e => assert.instanceOf(e, Error)));
	it('serliaziers a letter to disk', async () => {
		createDir('.test_tmp');
		await bankLetterGenerator.serialize('.test_tmp/test_letter.html').then(t => assert.equal(t, true));
		assert.equal(existsSync('.test_tmp/test_letter.html'), true);
	});
});
