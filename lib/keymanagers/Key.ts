import forge from 'node-forge';
import { X509Certificate } from 'node:crypto';

import Crypto from '../crypto/Crypto.js';

const {
	pki: {
		rsa,
		publicKeyToPem,
		privateKeyToPem,
		publicKeyFromPem,
		privateKeyFromPem,
		setRsaPublicKey,
		createCertificate,
		certificateToPem,
		certificateFromPem,
	},
	md: {
		sha256,
	},
	jsbn: {
		BigInteger,
	},
} = forge;

export interface CertificateOptions {
	subject: string | forge.pki.CertificateField[];
	issuer?: string | forge.pki.CertificateField[];
	notBefore?: Date;
	notAfter?: Date;
}

interface KeyConstructorOptions {
	pem?: string | string[] | null;
	mod?: Buffer | null;
	exp?: Buffer | null;
	size?: number;
	certificateOptions?: CertificateOptions | null;
}

const getKeyType = (str: string): 'private' | 'public' | 'certificate' | null => {
	const matches = str.match(/BEGIN (?:RSA )?(PRIVATE|PUBLIC|CERTIFICATE)/);
	if (!matches)
		return null;
	return matches[1]!.toLowerCase() as 'private' | 'public' | 'certificate';
};

const certificateFromPrivateKey = (
	privateKey: forge.pki.rsa.PrivateKey,
	certificateOptions: CertificateOptions,
): forge.pki.Certificate => {
	const certificate = createCertificate();
	certificate.publicKey = setRsaPublicKey(privateKey.n, privateKey.e);
	certificate.validity.notBefore = certificateOptions.notBefore || new Date("2000-01-01");
	certificate.validity.notAfter =	certificateOptions.notAfter || new Date("9999-12-31");

	const subject = certificateOptions.subject;
	if (typeof subject == "string") {
		certificate.setSubject([{ shortName: "CN", value: subject }]);
	} else if (Array.isArray(subject) && subject.length) {
		certificate.setSubject(subject);
	} else {
		throw new Error("certificateOptions.subject must be a string (common name) or an array of certificate fields");
	}

	const issuer = certificateOptions.issuer || subject;
	if (typeof issuer == "string") {
		certificate.setIssuer([{ shortName: "CN", value: issuer }]);
	} else if (Array.isArray(issuer) && issuer.length) {
		certificate.setIssuer(issuer);
	} else {
		throw new Error("certificateOptions.issuer must be a string (common name) or an array of certificate fields");
	}

	certificate.setExtensions([
		{
			name: 'keyUsage',
			digitalSignature: true,
			nonRepudiation: true,
			keyEncipherment: true,
		},
	]);
	certificate.sign(privateKey, sha256.create());

	return certificate;
};

export default class Key {
	storePrivateKey: boolean;
	storePublicKey: boolean;
	storeCertificate: boolean;
	privateKey: forge.pki.rsa.PrivateKey | null;
	publicKey: forge.pki.rsa.PublicKey | null;
	certificates: forge.pki.Certificate[];

	constructor({
		pem = null, mod = null, exp = null, size = 2048, certificateOptions = null,
	}: KeyConstructorOptions = {}) {
		this.storePrivateKey = false;
		this.storePublicKey = false;
		this.storeCertificate = false;
		this.privateKey = null;
		this.publicKey = null;
		this.certificates = [];

		// generate new private key
		if (!pem && !mod && !exp) {
			const keyPair = rsa.generateKeyPair(size);

			this.storePrivateKey = true;
			this.privateKey = keyPair.privateKey;
			this.publicKey = keyPair.publicKey;
			if (certificateOptions) {
				this.storeCertificate = true;
				this.certificates.push(certificateFromPrivateKey(this.privateKey, certificateOptions));
			}
			return;
		}

		// new key from pem string
		if (pem) {
			this.readFromPem(pem);

			if (certificateOptions && this.privateKey && !this.certificates.length) {
				this.certificates.push(certificateFromPrivateKey(this.privateKey, certificateOptions));
				this.storeCertificate = true;
			}

			return;
		}

		// new key from mod and exp
		if (mod && exp) {
			this.readFromModAndExp(mod, exp); // only used for H004
			return;
		}

		// not good
		throw new Error(`Can not create key without ${!mod ? 'modulus' : 'exponent'}.`);
	}

	readFromPem(pemOrPems: string | string[]): void {
		let pems = Array.isArray(pemOrPems) ? pemOrPems : [pemOrPems];
		pems = pems.flatMap(pem => {
			const matches = Array.from(pem.matchAll(/\s*(----+\s*BEGIN [^-]*----+\r?\n[^-]+----+\s*END [^-]*----+)/gm));
			return matches.map(match => match[1]!); // split multiple pems contained in one single string
		});
		for (const pem of pems) {
			const type = getKeyType(pem);
			switch (type) {
				case 'public':
					this.storePublicKey = true;
					this.publicKey = publicKeyFromPem(pem) as forge.pki.rsa.PublicKey;
					break;
				case 'private':
					this.storePrivateKey = true;
					this.privateKey = privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
					if (!this.publicKey)
						this.publicKey = setRsaPublicKey(this.privateKey.n, this.privateKey.e);
					break;
				case 'certificate': {
					if (!this.storeCertificate) this.certificates = [];
					this.storeCertificate = true;
					const certificate = certificateFromPem(pem);
					this.certificates.push(certificate);
					if (!this.publicKey)
						this.publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
					break;
				}
				default:
					throw new Error(`Unknown key type: ${type}`);
			}
		}
	}

	/**
	 * Creates a public key from modulus and exponent
	 */
	readFromModAndExp(mod: Buffer, exp: Buffer): void {
		const bnMod = new BigInteger(mod.toString('hex'), 16);
		const bnExp = new BigInteger(exp.toString('hex'), 16);

		this.storePublicKey = true;
		this.publicKey = rsa.setPublicKey(bnMod, bnExp);
	}

	static generate(size?: number, certificateOptions?: CertificateOptions): Key {
		return new Key({ size, certificateOptions });
	}

	static importKey({ mod, exp }: { mod: Buffer; exp: Buffer }): Key {
		return new Key({ mod, exp });
	}

	n(to?: 'buff'): Buffer;
	n(to: 'hex'): string;
	n(to: string = 'buff'): Buffer | string {
		const key = (this.privateKey || this.publicKey)!;
		const keyN = Buffer.from(key.n.toByteArray());

		return to === 'hex' ? keyN.toString('hex', 1) : keyN;
	}

	e(to?: 'buff'): Buffer;
	e(to: 'hex'): string;
	e(to: string = 'buff'): Buffer | string {
		const key = (this.privateKey || this.publicKey)!;
		const eKey = Buffer.from(key.e.toByteArray());

		return to === 'hex' ? eKey.toString('hex') : eKey;
	}

	d(): Buffer {
		if (!this.privateKey)
			throw new Error('Can not get d component out of public key.');

		return Buffer.from(this.privateKey.d.toByteArray());
	}

	certificateBase64s(): string[] {
		if (!this.certificates.length)
			throw new Error("Certificate is not set. Please use either client.generateKeys(certificateOptions) or client.setKeys(...) to set one.");

		const base64s = this.certificates.map(cert => new X509Certificate(certificateToPem(cert)).raw.toString('base64'));
		return base64s;
	}

	 
	size(): number {
		const keyN = this.n('hex');
		const bn = new BigInteger(keyN, 16);

		return bn.bitLength();
	}

	hasCertificate(): boolean {
		return this.certificates.length > 0;
	}

	certificatePem(): string {
		if (!this.hasCertificate())
			throw new Error("Certificate is not set. Please use either client.generateKeys(certificateOptions) or client.setKeys(...) to set one.");
		return certificateToPem(this.certificates[0]!);
	}

	sha256(): string {
		let digest = '';
		if (this.hasCertificate()) {
			const cert = new X509Certificate(certificateToPem(this.certificates[0]!));
			digest = cert.fingerprint256.replaceAll(':', '');
		} else {
			digest = Buffer.from(Crypto.digestPublicKey(this), 'base64').toString('hex');
		}
		return digest.toUpperCase().match(/.{1,2}/g)!.join(' ');
	}


	toPem(): string {
		if (this.privateKey)
			return privateKeyToPem(this.privateKey);

		if (this.publicKey)
			return publicKeyToPem(this.publicKey);

		// note: certificates are intentionally omitted here as a single pem representation is only used for encryption/decryption

		throw new Error('No key found');
	}

	toPems(): string[] {
		const pems: string[] = [];
		if (this.storePrivateKey)
			pems.push(privateKeyToPem(this.privateKey!));

		if (this.storeCertificate)
			pems.push(...this.certificates.map(cert => certificateToPem(cert)));

		if (this.storePublicKey)
			pems.push(publicKeyToPem(this.publicKey!));

		return pems;
	}
}
