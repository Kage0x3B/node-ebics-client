import { Client, fsKeysStorage } from '../index.js';

import loadConfig from './loadConfig.js';

interface ClientConfig {
	url: string;
	partnerId: string;
	userId: string;
	hostId: string;
	passphrase: string | Buffer;
	iv?: string | Buffer;
	keyStoragePath: string;
}

const getClient = ({
	url,
	partnerId,
	userId,
	hostId,
	passphrase,
	iv,
	keyStoragePath,
}: ClientConfig = loadConfig() as unknown as ClientConfig): Client => new Client({
	url,
	partnerId,
	userId,
	hostId,
	passphrase,
	iv,
	keyStorage: fsKeysStorage(keyStoragePath),
});

export default getClient;
