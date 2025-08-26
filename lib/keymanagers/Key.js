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
			keyCertSign: true,
			digitalSignature: true,
			nonRepudiation: true,
			keyEncipherment: true,
			dataEncipherment: true,
		},
	]);
	certificate.sign(privateKey, sha256.create());

	return certificate;
};

module.exports = class Key {
	constructor({
		pem = null, mod = null, exp = null, size = 2048,
	} = {}) {
		// generate new private key
		if (!pem && !mod && !exp) {
			const keyPair = rsa.generateKeyPair(size);

			this.type = 'private';
			this.privateKey = keyPair.privateKey;
			this.publicKey = keyPair.publicKey;
			this.certificate = certificateFromPrivateKey(keyPair.privateKey);

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

	readFromPem(pem) {
		this.type = getKeyType(pem);
		switch (this.type) {
			case 'public':
				this.publicKey = publicKeyFromPem(pem);
				this.privateKey = null;
				this.certificate = null;
				break;
			case 'private':
				this.privateKey = privateKeyFromPem(pem);
				this.publicKey = setRsaPublicKey(this.privateKey.n, this.privateKey.e);
				this.certificate = certificateFromPrivateKey(this.privateKey);
				break;
			case 'certificate':
				this.privateKey = null;
				this.certificate = certificateFromPem(pem);
				this.publicKey = this.certificate.publicKey;
				break;
			default:
				throw new Error(`Unknown key type: ${this.type}`);
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

		this.type = 'public';
		this.publicKey = rsa.setPublicKey(bnMod, bnExp);
		this.privateKey = null;
		this.certificate = null;
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

	certificateBase64() {
		if (!this.certificate)
			throw new Error('Certificate is not available.');

		return new X509Certificate(certificateToPem(this.certificate)).raw.toString('base64');
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

		if (this.certificate)
			return certificateToPem(this.certificate);

		if (this.publicKey)
			return publicKeyToPem(this.publicKey);

		throw new Error('No key found');
	}
};
