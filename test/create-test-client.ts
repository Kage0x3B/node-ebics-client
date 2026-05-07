import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, fsKeysStorage } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function createTestClient(): Client {
	return new Client({
		url: 'https://iso20022test.credit-suisse.com/ebicsweb/ebicsweb',
		partnerId: 'CRS04381',
		userId: 'CRS04381',
		hostId: 'CRSISOTB',
		passphrase: 'test',
		keyStorage: fsKeysStorage(path.resolve(__dirname, './support/TEST_KEYS.key')),
	});
}
