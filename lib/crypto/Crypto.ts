import crypto from 'node:crypto';
import NodeRSA from 'node-rsa';

import BigNumber from './BigNumber.js';
import mgf1 from './MGF1.js';
import type Key from '../keymanagers/Key.js';

const modPow = (base: BigNumber, power: BigNumber, mod: BigNumber): BigNumber => {
	let result = new BigNumber(1);

	while ((power as unknown as number) > 0) {
		result = (power.and(new BigNumber(1)).toString() === '1') ? (result.mul(base)).mod(mod) : result;  
		base = (base.mul(base)).mod(mod);
		power = power.shrn(1);
	}
	return result;
};

const emsaPSS = (msg: Buffer | string, salt: Buffer): Buffer => {
	const eightNullBytes = Buffer.from('\x00'.repeat(8));
	const digestedMsg = crypto.createHash('sha256').update(msg).digest();
	const mTickHash = crypto.createHash('sha256').update(Buffer.concat([eightNullBytes, digestedMsg, salt])).digest();

	const ps = Buffer.from('\x00'.repeat(190));
	// rolldown/oxc strips '\x01' from string literals during build, producing
	// Buffer.from("") (empty); use the array form to round-trip the 0x01 byte.
	const db = Buffer.concat([ps, Buffer.from([0x01]), salt]);

	const dbMask = mgf1.generate(mTickHash, db.length);
	const maskedDb = mgf1.xor(db, dbMask);

	let maskedDbMsb = mgf1.rjust(new BigNumber(maskedDb.slice(0, 1)).toString(2), 8, '0');


	maskedDbMsb = `0${maskedDbMsb.substr(1)}`;
	// console.log((new BN(maskedDbMsb, 2).toBuffer())[0], new BigNumber(maskedDbMsb, 2).toBuffer()[0]);
	// maskedDb[0] = (new BN(maskedDbMsb, 2).toBuffer())[0]; // eslint-disable-line
	maskedDb[0] = new BigNumber(maskedDbMsb, 2).toBEBuffer()[0]!;  

	return Buffer.concat([maskedDb, mTickHash, Buffer.from('BC', 'hex')]);
};


export default class Crypto {
	static digestPublicKey(key: Key): string {
		const str = [key.e('hex').replace(/^(0+)/g, ''), key.n('hex').replace(/^(0+)/g, '')].map(x => x.toLowerCase()).join(' ');

		return crypto.createHash('sha256').update(str).digest('base64').trim();
	}

	static publicEncrypt(key: Key, data: Buffer | string): Buffer {
		return crypto.publicEncrypt({
			key: key.toPem(),
			padding: crypto.constants.RSA_PKCS1_PADDING,
		}, Buffer.isBuffer(data) ? data : Buffer.from(data));
	}

	static privateDecrypt(key: Key, data: Buffer | string): Buffer {
		const keyRSA = new NodeRSA(
			key.toPem(),
			'pkcs1-private-pem', {
				encryptionScheme: 'pkcs1',
				environment: 'browser', // would use the crypto module by default, which blocks pkcs1
			},
		);
		return keyRSA.decrypt(data as Buffer);
	}

	static privateSign(key: Key, data: Buffer | string, outputEncoding: crypto.BinaryToTextEncoding = 'base64'): string {
		const signer = crypto.createSign('SHA256');

		return signer.update(data).sign(key.toPem(), outputEncoding);
	}

	static sign(key: Key, msg: Buffer | string, salt: Buffer = crypto.randomBytes(32)): string {
		const base = new BigNumber(emsaPSS(msg, salt));
		const power = new BigNumber(key.d());
		const mod = new BigNumber(key.n() as Buffer);
		const buffer = modPow(base, power, mod).toBEBuffer();

		if (buffer.byteLength === 257 && buffer[0] === 0x00)
			return buffer.slice(1).toString('base64');

		return buffer.toString('base64');
	}

	static pad(d: Buffer): Buffer {
		const dLen = d.length;
		const len = 16 * (Math.trunc(dLen / 16) + 1);

		return Buffer.concat([d, Buffer.from(Buffer.from([0]).toString().repeat(len - dLen - 1)), Buffer.from([len - dLen])]);
	}

	static digestWithHash(data: Buffer | string, algorith: string = 'sha256'): Buffer {
		return crypto.createHash(algorith).update(data).digest();
	}

	static nonce(outputEncoding: crypto.BinaryToTextEncoding = 'hex'): string {
		return crypto.randomBytes(16).toString(outputEncoding);
	}

	static timestamp(): string {
		return new Date().toISOString();
	}
}
