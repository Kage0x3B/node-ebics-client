import { encrypt, decrypt } from '../crypto/encryptDecrypt.js';

export interface KeyEncryptor {
	encrypt: (data: string) => string;
	decrypt: (data: string) => string;
}

interface DefaultKeyEncryptorOptions {
	passphrase: string | Buffer;
	iv?: string | Buffer;
	algorithm?: string;
}

const defaultKeyEncryptor = (
	{ passphrase, iv, algorithm = 'aes-256-cbc' }: DefaultKeyEncryptorOptions,
): KeyEncryptor => ({
	encrypt: (data: string) => encrypt(data, algorithm, passphrase, iv),
	decrypt: (data: string) => decrypt(data, algorithm, passphrase, iv),
});

export default defaultKeyEncryptor;
