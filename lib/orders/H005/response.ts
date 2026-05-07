import zlib from 'node:zlib';
import crypto from 'node:crypto';

import Crypto from '../../crypto/Crypto.js';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import errors from './errors.js';
import type Keys from '../../keymanagers/Keys.js';

const DEFAULT_IV = Buffer.from(Array(16).fill(0, 0, 15));

const lastChild = (node: any): any => {
	let y = node.lastChild;

	while (y.nodeType !== 1) y = y.previousSibling;

	return y;
};

const responseFactory = (xml: string, keys: Keys) => ({
	keys,
	doc: new DOMParser().parseFromString(xml, 'text/xml'),

	isSegmented() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc as unknown as Node,
		) as unknown as unknown[];

		return !!node.length;
	},

	isLastSegment() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			"//xmlns:header/xmlns:mutable/*[@lastSegment='true']",
			this.doc as unknown as Node,
		) as unknown as unknown[];

		return !!node.length;
	},

	orderData() {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'OrderData',
		);

		if (!orderDataNode.length) return Buffer.alloc(0);

		const orderData = orderDataNode[0]!.textContent;
		const decipher = crypto
			.createDecipheriv('aes-128-cbc', this.transactionKey(), DEFAULT_IV)
			.setAutoPadding(false);
		const data = Buffer.from(
			decipher.update(orderData as string, 'base64', 'binary')
				+ decipher.final('binary'),
			'binary',
		);

		return zlib.inflateSync(data);
	},

	transactionKey() {
		const keyNodeText = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'TransactionKey',
		)[0]!.textContent;
		return Crypto.privateDecrypt(
			(this.keys as any).e()!,
			Buffer.from(keyNodeText as string, 'base64'),
		);
	},

	transactionId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:TransactionID',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	orderId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'.//xmlns:header/xmlns:mutable/xmlns:OrderID',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	businessCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select('//xmlns:body/xmlns:ReturnCode', this.doc as unknown as Node) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	businessSymbol(code: string) {
		if (!errors.business[code]) return undefined;
		return errors.business[code]!.symbol;
	},

	businessShortText(code: string) {
		if (!errors.business[code]) return undefined;
		return errors.business[code]!.short_text;
	},

	businessMeaning(code: string) {
		if (!errors.business[code]) return undefined;
		return errors.business[code]!.meaning;
	},

	technicalCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReturnCode',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	technicalSymbol() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReportText',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	technicalShortText(code: string) {
		if (!errors.technical[code]) return undefined;
		return errors.technical[code]!.short_text;
	},

	technicalMeaning(code: string) {
		if (!errors.technical[code]) return undefined;
		return errors.technical[code]!.meaning;
	},

	bankKeys() {
		const orderData = this.orderData().toString();
		if (!orderData.length) return {};

		const doc = new DOMParser().parseFromString(orderData, 'text/xml');
		const select = xpath.useNamespaces({ ds: 'http://www.w3.org/2000/09/xmldsig#' });
		const keyNodes = select('//ds:X509Data', doc as unknown as Node) as unknown as any[];
		const bankKeys: Record<string, { pem: string }> = {};

		if (!keyNodes.length) return {};

		for (let i = 0; i < keyNodes.length; i++) {
			const type = (xpath.select('.//*[local-name(.)=\'AuthenticationVersion\' or local-name(.)=\'EncryptionVersion\']', keyNodes[i].parentNode) as unknown as any[])[0].textContent;
			const certificateBase64 = (select('.//ds:X509Certificate', keyNodes[i]) as unknown as any[])[0].textContent.trim();
			const certificate = new crypto.X509Certificate(Buffer.from(certificateBase64, 'base64'));
			bankKeys[`bank${type}`] = { pem: certificate.toString() };
		}

		return bankKeys;
	},

	toXML() {
		return new XMLSerializer().serializeToString(this.doc);
	},
});

export default responseFactory;
