import crypto from 'node:crypto';

import js2xmlparser from 'js2xmlparser';

import Crypto from '../../../crypto/Crypto.js';
import { isFollowUpPhase } from '../../phase.js';
import { attachUploadTransaction, encryptOrderData, normalizeDocument, prepareUploadTransaction } from '../../orderData.js';

import downloadSerializer from './download.js';
import genericSerializer from './generic.js';

const signatureValue = (document: string | Buffer, key: any) => {
	const digested = Crypto.digestWithHash(document);

	return Crypto.sign(key, digested);
};
const orderSignature = (ebicsAccount: any, document: string | Buffer, key: any, xmlOptions: any) => {
	const xmlObj = {
		'@': {
			xmlns: 'http://www.ebics.org/S002',
			'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
			'xsi:schemaLocation': 'http://www.ebics.org/S002 http://www.ebics.org/S002/ebics_signature.xsd',
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

/**
 * The transaction key and encrypted segments live on the order, so the initialisation and every
 * transfer of ONE transaction share them. The client prepares a fresh set for each upload; a caller
 * driving the serializer directly gets one prepared by the initialisation. A transfer never makes up
 * a key of its own: the bank only knows the one sent with the initialisation.
 */
const uploadTransaction = (order: any, client: any) => {
	if (!order.transactionKey || !order.segments) {
		if (isFollowUpPhase(order))
			throw new Error('Cannot build an upload transfer without the transaction key of its initialisation');

		attachUploadTransaction(order, prepareUploadTransaction(order.document, client.segmentSize));
	}

	return { transactionKey: order.transactionKey as Buffer, segments: order.segments as string[] };
};

export default {
	async use(order: any, client: any): Promise<any> {
		const { transactionKey, segments } = uploadTransaction(order, client);

		if (isFollowUpPhase(order)) {
			const number: number = order.segmentNumber ?? 1;
			const segment = segments[number - 1];
			if (segment === undefined)
				throw new Error(`Upload has ${segments.length} segment(s), cannot transfer segment ${number}`);

			return genericSerializer(client.hostId, order.transactionId).transfer(segment, number, number === segments.length);
		}

		const keys = await client.keys();
		const ebicsAccount = {
			partnerId: client.partnerId,
			userId: client.userId,
			hostId: client.hostId,
		};
		const normalizedDocument = normalizeDocument(order.document);
		const builder = await downloadSerializer.use(order, client);

		builder.xmlSchema.header.static.NumSegments = segments.length;
		builder.xmlSchema.body = {
			DataTransfer: {
				DataEncryptionInfo: {
					'@': { authenticate: true },
					EncryptionPubKeyDigest: {
						'@': { Version: 'E002', Algorithm: 'http://www.w3.org/2001/04/xmlenc#sha256' },
						'#': Crypto.digestPublicKey(keys.bankE()!),
					},
					TransactionKey: Crypto.publicEncrypt(keys.bankE()!, transactionKey).toString('base64'),
				},
				SignatureData: {
					'@': { authenticate: true },
					'#': encryptOrderData(orderSignature(ebicsAccount, normalizedDocument, keys.a(), builder.xmlOptions), transactionKey),
				},
				DataDigest: {
					'@': {
						SignatureVersion: 'A006',
					},
					'#': crypto.createHash('sha256').update(normalizedDocument).digest('base64').trim(),
				},
			},
		};

		return builder;
	},
};
