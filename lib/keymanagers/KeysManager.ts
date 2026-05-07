import { encrypt, decrypt } from '../crypto/encryptDecrypt.js';
import Keys from './Keys.js';

interface SyncStorage {
	read(): string;
	write(data: string): void;
}

interface BankKeysInput {
	bankX002?: unknown;
	bankE002?: unknown;
}

const KeysManager = (
	keysStorage: SyncStorage,
	passphrase: string | Buffer,
	algorithm: string = 'aes-256-cbc',
) => {
	const storage = keysStorage;
	const pass = passphrase;
	const algo = algorithm;
	// const createIfNone = createIfNone;

	return {
		generate(save: boolean = true): Keys | typeof this {
			const keys = Keys.generate();

			if (save) {
				this.write(keys);

				return this;
			}

			return keys;
		},

		write(keysObject: Keys): typeof this {
			const rawKeys: Record<string, unknown> = { ...(keysObject.keys as unknown as Record<string, unknown>) };

			Object.keys(rawKeys).map((key) => {
				rawKeys[key] = rawKeys[key] === null ? null : (rawKeys[key] as { toPems: () => string[] }).toPems();

				return key;
			});

			storage.write(encrypt(JSON.stringify(rawKeys), algo, pass));

			return this;
		},

		setBankKeys(bankKeys: BankKeysInput): void {
			const keys = this.keys();

			keys.setBankKeys(bankKeys as Parameters<Keys['setBankKeys']>[0]);
			this.write(keys);
		},

		keys(): Keys {
			const keysString = storage.read();

			return new Keys(JSON.parse(decrypt(keysString, algo, pass)));
		},
	};
};

export default KeysManager;
