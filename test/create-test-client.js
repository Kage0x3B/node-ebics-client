'use strict';

const { Client, fsKeysStorage } = require('..');
const path = require('path');

module.exports = function createTestClient() {
	return new Client({
		url: 'https://iso20022test.credit-suisse.com/ebicsweb/ebicsweb',
		partnerId: 'CRS04381',
		userId: 'CRS04381',
		hostId: 'CRSISOTB',
		passphrase: 'test',
		keyStorage: fsKeysStorage(path.resolve(__dirname, './support/TEST_KEYS.key')),
	});
};
