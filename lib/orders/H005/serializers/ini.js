'use strict';

const zlib = require('zlib');

const js2xmlparser = require('js2xmlparser');

const Crypto = require('../../../crypto/Crypto');

const genericSerializer = require('./generic');

const iniOrderData = (ebicsAccount, key, xmlOptions) => {
	const xmlOrderData = {
		'@': {
			'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
			xmlns: 'http://www.ebics.org/S002',
		},
		SignaturePubKeyInfo: {
			'ds:X509Data': key.certificateBase64s().map(certBase64 => ({
				'ds:X509Certificate': certBase64,
			})),
			SignatureVersion: 'A006',
		},
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
	};

	const xml = js2xmlparser.parse('SignaturePubKeyOrderData', xmlOrderData, xmlOptions);
	return xml;
};
const hiaOrderData = (ebicsAccount, keys, xmlOptions) => {
	const xmlOrderData = {
		'@': {
			'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
			xmlns: 'urn:org:ebics:H005',
		},
		AuthenticationPubKeyInfo: {
			'ds:X509Data': {
				'ds:X509Certificate': keys.x().certificateBase64s().map(certBase64 => ({ '#': certBase64 })),
			},
			AuthenticationVersion: 'X002',
		},
		EncryptionPubKeyInfo: {
			'ds:X509Data': {
				'ds:X509Certificate': keys.e().certificateBase64s().map(certBase64 => ({ '#': certBase64 })),
			},
			EncryptionVersion: 'E002',
		},
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
	};

	const xml = js2xmlparser.parse('HIARequestOrderData', xmlOrderData, xmlOptions);
	return xml;
};
const h3kOrderData = (ebicsAccount, keys, xmlOptions) => {
	const xmlOrderData = {
		'@': {
			'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
			xmlns: 'urn:org:ebics:H005',
		},
		SignatureCertificateInfo: {
			'ds:X509Data': keys.a().certificateBase64s().map(certBase64 => ({
				'ds:X509Certificate': certBase64,
			})),
			SignatureVersion: 'A006',
		},
		AuthenticationCertificateInfo: {
			'ds:X509Data': keys.x().certificateBase64s().map(certBase64 => ({
				'ds:X509Certificate': certBase64,
			})),
			AuthenticationVersion: 'X002',
		},
		EncryptionCertificateInfo: {
			'ds:X509Data': keys.e().certificateBase64s().map(certBase64 => ({
				'ds:X509Certificate': certBase64,
			})),
			EncryptionVersion: 'E002',
		},
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
	};

	const xml = js2xmlparser.parse('H3KRequestOrderData', xmlOrderData, xmlOptions);
	return xml;
};
const commonHeader = (ebicsAccount, orderDetails, productString) => ({
	'@': { authenticate: true },
	static: {
		HostID: ebicsAccount.hostId,
		Nonce: Crypto.nonce(),
		Timestamp: Crypto.timestamp(),
		PartnerID: ebicsAccount.partnerId,
		UserID: ebicsAccount.userId,
		Product: {
			'@': { Language: 'en' },
			'#': productString,
		},
		OrderDetails: orderDetails,
		SecurityMedium: '0000',
	},
	mutable: {},
});






// TODO: import instead of duplication
const signatureValue = (document, key) => {
	const digested = Crypto.digestWithHash(document.replace(/\n|\r/g, ''));

	return Crypto.sign(key, digested);
};
const orderSignature = (ebicsAccount, document, key, xmlOptions) => {
	const xmlObj = {
		'@': {
			xmlns: 'http://www.ebics.org/S001',
			'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'xsi:schemaLocation': 'http://www.ebics.org/S001 http://www.ebics.org/S001/ebics_signature.xsd',
		},
		OrderSignatureData: {
			SignatureVersion: 'A006',
			SignatureValue: signatureValue(document, key),
			PartnerID: ebicsAccount.partnerId,
			UserID: ebicsAccount.userId,
		},
	};

	return js2xmlparser.parse('UserSignatureData', xmlObj, xmlOptions);
};







const process = {
	INI: {
		rootName: 'ebicsUnsecuredRequest',
		header: (ebicsAccount, orderDetails, productString) => {
			const ch = commonHeader(ebicsAccount, orderDetails, productString);

			delete ch.static.Nonce;
			delete ch.static.Timestamp;

			return ch;
		},
		body: (ebicsAccount, keys, xmlOptions) => ({
			DataTransfer: {
				OrderData: Buffer.from(zlib.deflateSync(iniOrderData(ebicsAccount, keys.a(), xmlOptions))).toString('base64'),
			},
		}),
	},
	HIA: {
		rootName: 'ebicsUnsecuredRequest',
		header: (ebicsAccount, orderDetails, productString) => {
			const ch = commonHeader(ebicsAccount, orderDetails, productString);

			delete ch.static.Nonce;
			delete ch.static.Timestamp;

			return ch;
		},
		body: (ebicsAccount, keys, xmlOptions) => ({
			DataTransfer: {
				OrderData: Buffer.from(zlib.deflateSync(hiaOrderData(ebicsAccount, keys, xmlOptions))).toString('base64'),
			},
		}),
	},
	H3K: {
		rootName: 'ebicsUnsignedRequest',
		header: (ebicsAccount, orderDetails, productString) => {
			const ch = commonHeader(ebicsAccount, orderDetails, productString);

			delete ch.static.Nonce;
			delete ch.static.Timestamp;

			return ch;
		},
		body: (ebicsAccount, keys, xmlOptions) => {
			const orderData = h3kOrderData(ebicsAccount, keys, xmlOptions);
			const orderDataBase64 = Buffer.from(zlib.deflateSync(orderData)).toString('base64');
			const signatureXml = orderSignature(ebicsAccount, orderData, keys.a(), this.xmlOptions);
			const signatureBase64 = Buffer.from(zlib.deflateSync(signatureXml)).toString('base64');

			return {
				DataTransfer: {
					SignatureData: {
						'@': { authenticate: true },
						'#': signatureBase64,
					},
					OrderData: orderDataBase64,
				},
			};
		},
	},
	HPB: {
		rootName: 'ebicsNoPubKeyDigestsRequest',
		header: (ebicsAccount, orderDetails, productString) => commonHeader(ebicsAccount, orderDetails, productString),
		body: () => ({}),
	},
};

module.exports = {
	async use(order, client) {
		const keys = await client.keys();
		const { orderDetails, transactionId } = order;
		const { xmlOptions, xmlSchema, productString } = genericSerializer(client.host, transactionId);
		const orderType = orderDetails.AdminOrderType.toUpperCase();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};

		this.rootName = process[orderType].rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;

		this.xmlSchema.header = process[orderType].header(ebicsAccount, orderDetails, productString);
		this.xmlSchema.body = process[orderType].body(ebicsAccount, keys, this.xmlOptions);

		if (orderType !== 'HPB' && Object.prototype.hasOwnProperty.call(this.xmlSchema, 'AuthSignature'))
			delete this.xmlSchema.AuthSignature;

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
