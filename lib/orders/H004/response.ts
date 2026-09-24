import Crypto from '../../crypto/Crypto.js';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import errors from './errors.js';
import { decryptOrderData } from '../orderData.js';
import type Keys from '../../keymanagers/Keys.js';

const lastChild = (node: any): any => {
	let y = node.lastChild;

	while (y.nodeType !== 1) y = y.previousSibling;

	return y;
};

const responseFactory = (xml: string, keys: Keys) => ({
	keys,
	doc: new DOMParser().parseFromString(xml, 'text/xml'),

	isSegmented() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc as unknown as Node,
		) as unknown as unknown[];

		return !!node.length;
	},

	isLastSegment() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			"//xmlns:header/xmlns:mutable/*[@lastSegment='true' or @lastSegment='1']",
			this.doc as unknown as Node,
		) as unknown as unknown[];

		return !!node.length;
	},

	/** Total number of order data segments, announced in the initialisation answer; 0 when absent. */
	numSegments() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:NumSegments',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? Number(node[0].textContent) : 0;
	},

	/** Number of the segment this answer carries; 0 when absent. */
	segmentNumber() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? Number(node[0].textContent) : 0;
	},

	/** The still encrypted, base64-encoded order data segment of this answer; `''` when absent. */
	orderDataSegment(): string {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H004',
			'OrderData',
		);

		return orderDataNode.length ? (orderDataNode[0]!.textContent ?? '') : '';
	},

	/** Decrypted order data of this single answer (key management, single-segment downloads). */
	orderData() {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H004',
			'OrderData',
		);

		if (!orderDataNode.length) return Buffer.alloc(0);

		return decryptOrderData(this.orderDataSegment(), this.transactionKey());
	},

	transactionKey() {
		const keyNodeText = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H004',
			'TransactionKey',
		)[0]!.textContent;
		return Crypto.privateDecrypt(
			(this.keys as any).e()!,
			Buffer.from(keyNodeText as string, 'base64'),
		);
	},

	transactionId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:TransactionID',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	orderId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'.//xmlns:header/xmlns:mutable/xmlns:OrderID',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	businessCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select('//xmlns:body/xmlns:ReturnCode', this.doc as unknown as Node) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	businessSymbol(code: string) {
		return errors.business[code]!.symbol;
	},

	businessShortText(code: string) {
		return errors.business[code]!.short_text;
	},

	businessMeaning(code: string) {
		return errors.business[code]!.meaning;
	},

	technicalCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReturnCode',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	technicalSymbol() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReportText',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? node[0].textContent : '';
	},

	technicalShortText(code: string) {
		return errors.technical[code]!.short_text;
	},

	technicalMeaning(code: string) {
		return errors.technical[code]!.meaning;
	},

	bankKeys() {
		const orderData = this.orderData().toString();
		if (!orderData.length) return {};

		const doc = new DOMParser().parseFromString(orderData, 'text/xml');
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H004' });
		const keyNodes = select('//xmlns:PubKeyValue', doc as unknown as Node) as unknown as any[];
		const bankKeys: Record<string, { mod: Buffer; exp: Buffer }> = {};

		if (!keyNodes.length) return {};

		for (let i = 0; i < keyNodes.length; i++) {
			const type = lastChild(keyNodes[i].parentNode).textContent;
			const modulus = (xpath.select(
				".//*[local-name(.)='Modulus']",
				keyNodes[i],
			) as unknown as any[])[0].textContent;
			const exponent = (xpath.select(
				".//*[local-name(.)='Exponent']",
				keyNodes[i],
			) as unknown as any[])[0].textContent;

			const mod = Buffer.from(modulus, 'base64');
			const exp = Buffer.from(exponent, 'base64');
			bankKeys[`bank${type}`] = {
				mod,
				exp,
			};
		}

		return bankKeys;
	},

	toXML() {
		return new XMLSerializer().serializeToString(this.doc);
	},
});

export default responseFactory;
