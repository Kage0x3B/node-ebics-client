'use strict';

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
} = require('node-forge');
const { X509Certificate } = require('crypto');

const getKeyType = (str) => {
	const matches = str.match(/BEGIN (?:RSA )?(PRIVATE|PUBLIC|CERTIFICATE)/);
	if (!matches)
		return null;
	return matches[1].toLowerCase();
};

const certificateFromPrivateKey = (privateKey) => {
	const certificate = createCertificate();
	certificate.publicKey = setRsaPublicKey(privateKey.n, privateKey.e);
	certificate.validity.notBefore = new Date('2000-01-01');
	certificate.validity.notAfter = new Date('9999-12-31');
	certificate.setIssuer([
		{
			shortName: 'CN', value: 'ebics.example.com',
		},
	]);
	certificate.subject = certificate.issuer;
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

module.exports = class Key {
	constructor({
		pem = null, mod = null, exp = null, size = 2048,
	} = {}) {
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
			return;
		}

		// new key from pem string
		if (pem) {
			this.readFromPem(pem);
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

	readFromPem(pemOrPems) {
		let pems = Array.isArray(pemOrPems) ? pemOrPems : [pemOrPems];
		pems = pems.flatMap(pem => {
			const matches = Array.from(pem.matchAll(/\s*(----+\s*BEGIN [^-]*----+\r?\n[^-]+----+\s*END [^-]*----+)/gm))
			return matches.map(match => match[1]); // split multiple pems contained in one single string
		})
		for (const pem of pems) {
			const type = getKeyType(pem);
			switch (type) {
				case 'public':
					this.storePublicKey = true;
					this.publicKey = publicKeyFromPem(pem);
					break;
				case 'private':
					this.storePrivateKey = true;
					this.privateKey = privateKeyFromPem(pem);
					if (!this.publicKey)
						this.publicKey = setRsaPublicKey(this.privateKey.n, this.privateKey.e);
					break;
				case 'certificate':
					if(!this.storeCertificate) this.certificates = [];
					this.storeCertificate = true;
					const certificate = certificateFromPem(pem);
					this.certificates.push(certificate);
					if (!this.publicKey)
						this.publicKey = certificate.publicKey;
					break;
				default:
					throw new Error(`Unknown key type: ${type}`);
			}
		}
	}

	/**
	 * Creates a public key from modulus and exponent
	 * @param {Buffer} mod - the modulus
	 * @param {Buffer} exp - the exponent
	 */
	readFromModAndExp(mod, exp) {
		const bnMod = new BigInteger(mod.toString('hex'), 16);
		const bnExp = new BigInteger(exp.toString('hex'), 16);

		this.storePublicKey = true;
		this.publicKey = rsa.setPublicKey(bnMod, bnExp);
	}

	static generate(size = 2048) {
		return new Key({ size });
	}

	static importKey({ mod, exp }) {
		return new Key({ mod, exp });
	}

	n(to = 'buff') {
		const key = this.privateKey || this.publicKey;
		const keyN = Buffer.from(key.n.toByteArray());

		return to === 'hex' ? keyN.toString('hex', 1) : keyN;
	}

	e(to = 'buff') {
		const key = this.privateKey || this.publicKey;
		const eKey = Buffer.from(key.e.toByteArray());

		return to === 'hex' ? eKey.toString('hex') : eKey;
	}

	d() {
		if (!this.privateKey)
			throw new Error('Can not get d component out of public key.');

		return Buffer.from(this.privateKey.d.toByteArray());
	}

	certificateBase64s() {
		if (!this.certificates.length && this.privateKey)
			this.certificates.push(certificateFromPrivateKey(this.privateKey));
		if (!this.certificates.length)
			throw new Error('Neither certificate nor private key is available.');

		const base64s = this.certificates.map(cert => new X509Certificate(certificateToPem(cert)).raw.toString('base64'));
		return base64s;
	}

	// eslint-disable-next-line class-methods-use-this
	size() {
		const keyN = this.n('hex');
		const bn = new BigInteger(keyN, 16);

		return bn.bitLength();
	}


	toPem() {
		if (this.privateKey)
			return privateKeyToPem(this.privateKey);

		if (this.publicKey)
			return publicKeyToPem(this.publicKey);

		// note: certificates are intentionally omitted here as a single pem representation is only used for encryption/decryption

		throw new Error('No key found');
	}

	toPems() {
		const pems = [];
		if (this.storePrivateKey)
			pems.push(privateKeyToPem(this.privateKey));

		if (this.storeCertificate)
			pems.push(...this.certificates.map(cert => certificateToPem(cert)));

		if (this.storePublicKey)
			pems.push(publicKeyToPem(this.publicKey));

		return pems;
	}
};
