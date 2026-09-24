import js2xmlparser from 'js2xmlparser';

import constants from '../../../consts.js';

const rootName = 'ebicsRequest';
const rootAttributes = {
	'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
	xmlns: 'urn:org:ebics:H005',
	Version: 'H005',
	Revision: '1',
};
const authSignature = ({
	'ds:SignedInfo': {
		'ds:CanonicalizationMethod': {
			'@': {
				Algorithm:
						'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
			},
		},
		'ds:SignatureMethod': {
			'@': {
				Algorithm:
						'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
			},
		},
		'ds:Reference': {
			'@': { URI: "#xpointer(//*[@authenticate='true'])" },
			'ds:Transforms': {
				'ds:Transform': {
					'@': {
						Algorithm:
								'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
					},
				},
			},
			'ds:DigestMethod': {
				'@': {
					Algorithm:
							'http://www.w3.org/2001/04/xmlenc#sha256',
				},
			},
			'ds:DigestValue': {},
		},
	},
	'ds:SignatureValue': {},
});

const xmlOptions = {
	declaration: {
		include: true,
		encoding: 'utf-8',
	},
	format: {
		doubleQuotes: true,
		indent: '',
		newline: '',
		pretty: true,
	},
};

const followUpHeader = (hostId: string, transactionId: string | undefined, mutable: Record<string, unknown>) => ({
	'@': { authenticate: true },
	static: {
		HostID: hostId,
		TransactionID: transactionId,
	},
	mutable,
});

const segmentNumber = (number: number, lastSegment: boolean) => ({
	'@': { lastSegment },
	'#': number,
});

/**
 * A fresh request builder per call. Builders are never shared: concurrent EBICS requests in one
 * process must not see each other's header or body.
 */
const genericFactory = (hostId: string, transactionId?: string): any => ({
	productString: constants.productString,
	rootName,
	xmlOptions,
	xmlSchema: {
		'@': rootAttributes,
		header: {},
		AuthSignature: authSignature,
		body: {},
	},

	/** Acknowledge a download. ReceiptCode 0 confirms receipt, 1 asks the bank to deliver again. */
	receipt(receiptCode: 0 | 1 = 0) {
		this.xmlSchema = {
			'@': rootAttributes,
			header: followUpHeader(hostId, transactionId, { TransactionPhase: 'Receipt' }),
			AuthSignature: authSignature,
			body: {
				TransferReceipt: {
					'@': { authenticate: true },
					ReceiptCode: receiptCode,
				},
			},
		};

		return this;
	},

	/** Send one segment of upload order data. */
	transfer(encryptedOrderData: string, number: number = 1, lastSegment: boolean = true) {
		this.xmlSchema = {
			'@': rootAttributes,
			header: followUpHeader(hostId, transactionId, {
				TransactionPhase: 'Transfer',
				SegmentNumber: segmentNumber(number, lastSegment),
			}),
			AuthSignature: authSignature,
			body: {
				DataTransfer: {
					OrderData: encryptedOrderData,
				},
			},
		};

		return this;
	},

	/** Request the next segment of download order data. */
	downloadTransfer(number: number, lastSegment: boolean) {
		this.xmlSchema = {
			'@': rootAttributes,
			header: followUpHeader(hostId, transactionId, {
				TransactionPhase: 'Transfer',
				SegmentNumber: segmentNumber(number, lastSegment),
			}),
			AuthSignature: authSignature,
			body: {},
		};

		return this;
	},

	toXML() {
		return js2xmlparser.parse(this.rootName, this.xmlSchema, this.xmlOptions);
	},
});

export default genericFactory;
