import zlib from 'node:zlib';
import crypto from 'node:crypto';

import js2xmlparser from 'js2xmlparser';

import Crypto from '../../../crypto/Crypto.js';

import downloadSerializer from './download.js';

const transKey = crypto.randomBytes(16);

const signatureValue = (document: string, key: any) => {
	const digested = Crypto.digestWithHash(document.replace(/\n|\r/g, ''));

	return Crypto.sign(key, digested);
};
const orderSignature = (ebicsAccount: any, document: string, key: any, xmlOptions: any) => {
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
const encryptedOrderSignature = (ebicsAccount: any, document: string, transactionKey: Buffer, key: any, xmlOptions: any) => {
	const dst = zlib.deflateSync(orderSignature(ebicsAccount, document, key, xmlOptions));
	const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).setAutoPadding(false);

	return Buffer.concat([cipher.update(Crypto.pad(dst)), cipher.final()]).toString('base64');
};
const encryptedOrderData = (document: string, transactionKey: Buffer) => {
	const dst = zlib.deflateSync(document.replace(/\n|\r/g, ''));
	const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).setAutoPadding(false);

	return Buffer.concat([cipher.update(Crypto.pad(dst)), cipher.final()]).toString('base64');
};

export default {
	rootName: '' as string,
	xmlOptions: undefined as any,
	xmlSchema: undefined as any,
	transfer: undefined as any,

	async use(order: any, client: any): Promise<any> {
		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};
		const { transactionId, document } = order;
		const {
			rootName, xmlOptions, xmlSchema, transfer,
		} = await downloadSerializer.use(order, client);

		this.rootName = rootName;
		this.xmlOptions = xmlOptions;
		this.xmlSchema = xmlSchema;
		this.transfer = transfer;

		if (transactionId) return this.transfer(encryptedOrderData(document, transKey));

		this.xmlSchema.header.static.NumSegments = 1;
		this.xmlSchema.body = {
			DataTransfer: {
				DataEncryptionInfo: {
					'@': { authenticate: true },
					EncryptionPubKeyDigest: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestPublicKey(keys.bankE()!),
					},
					TransactionKey: Crypto.publicEncrypt(keys.bankE()!, transKey).toString('base64'),
				},
				SignatureData: {
					'@': { authenticate: true },
					'#': encryptedOrderSignature(ebicsAccount, document, transKey, keys.a(), this.xmlOptions),
				},
			},
		};

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
};
