import crypto from 'node:crypto';

const createKeyAndIv = (passphrase: string | Buffer): { key: Buffer; iv: Buffer } => {
	// this generates a 256-bit key and a 128-bit iv for aes-256-cbc
	// just like nodejs's deprecated/removed crypto.createCipher would
	const a = crypto.createHash('md5').update(passphrase).digest();
	const b = crypto
		.createHash('md5')
		.update(Buffer.concat([a, Buffer.from(passphrase)]))
		.digest();
	const c = crypto
		.createHash('md5')
		.update(Buffer.concat([b, Buffer.from(passphrase)]))
		.digest();
	const bytes = Buffer.concat([a, b, c]);
	const key = bytes.subarray(0, 32);
	const iv = bytes.subarray(32, 48);
	return { key, iv };
};

const encrypt = (
	data: string | Buffer,
	algorithm: string,
	passphrase: string | Buffer,
	iv?: string | Buffer,
): string => {
	let cipher: ReturnType<typeof crypto.createCipheriv>;
	if (iv) {
		cipher = crypto.createCipheriv(algorithm, passphrase, iv);
	} else {
		console.warn(
			'[Deprecation notice] No IV provided, falling back to legacy key derivation.\n'
            + 'This will be removed in a future major release. You should encrypt your keys with a proper key and IV.',
		);
		if ((crypto as { createCipher?: typeof crypto.createCipheriv }).createCipher) {
			// nodejs < 22
			cipher = (crypto as unknown as { createCipher: (algo: string, pw: string | Buffer) => ReturnType<typeof crypto.createCipheriv> })
				.createCipher(algorithm, passphrase);
		} else {
			const { key, iv: generatedIv } = createKeyAndIv(passphrase);
			cipher = crypto.createCipheriv(algorithm, key, generatedIv);
		}
	}
	const encrypted = cipher.update(data as string, 'utf8', 'hex') + cipher.final('hex');
	return Buffer.from(encrypted).toString('base64');
};

const decrypt = (
	data: string,
	algorithm: string,
	passphrase: string | Buffer,
	iv?: string | Buffer,
): string => {
	const dataStr = Buffer.from(data, 'base64').toString();
	let decipher: ReturnType<typeof crypto.createDecipheriv>;
	if (iv) {
		decipher = crypto.createDecipheriv(algorithm, passphrase, iv);
	} else {
		console.warn(
			'[Deprecation notice] No IV provided, falling back to legacy key derivation.\n'
			+ 'This will be removed in a future major release. You should re-encrypt your keys with a proper key and IV.',
		);
		if ((crypto as { createDecipher?: typeof crypto.createDecipheriv }).createDecipher) {
			// nodejs < 22
			decipher = (crypto as unknown as { createDecipher: (algo: string, pw: string | Buffer) => ReturnType<typeof crypto.createDecipheriv> })
				.createDecipher(algorithm, passphrase);
		} else {
			const { key, iv: generatedIv } = createKeyAndIv(passphrase);
			decipher = crypto.createDecipheriv(algorithm, key, generatedIv);
		}
	}
	const decrypted = decipher.update(dataStr, 'hex', 'utf8') + decipher.final('utf8');
	return decrypted;
};

export { encrypt, decrypt };

export default { encrypt, decrypt };
