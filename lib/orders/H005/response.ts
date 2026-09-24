import Crypto from '../../crypto/Crypto.js';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import errors from './errors.js';
import { decryptOrderData } from '../orderData.js';
import { parseBankKeys } from '../bankKeys.js';
import type Keys from '../../keymanagers/Keys.js';

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
			"//xmlns:header/xmlns:mutable/*[@lastSegment='true' or @lastSegment='1']",
			this.doc as unknown as Node,
		) as unknown as unknown[];

		return !!node.length;
	},

	/** Total number of order data segments, announced in the initialisation answer; 0 when absent. */
	numSegments() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:NumSegments',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? Number(node[0].textContent) : 0;
	},

	/** Number of the segment this answer carries; 0 when absent. */
	segmentNumber() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc as unknown as Node,
		) as unknown as any[];

		return node.length ? Number(node[0].textContent) : 0;
	},

	/** The still encrypted, base64-encoded order data segment of this answer; `''` when absent. */
	orderDataSegment(): string {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'OrderData',
		);

		return orderDataNode.length ? (orderDataNode[0]!.textContent ?? '') : '';
	},

	/** Decrypted order data of this single answer (key management, single-segment downloads). */
	orderData() {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'OrderData',
		);

		if (!orderDataNode.length) return Buffer.alloc(0);

		return decryptOrderData(this.orderDataSegment(), this.transactionKey());
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
		return parseBankKeys(this.orderData().toString(), 'certificate');
	},

	toXML() {
		return new XMLSerializer().serializeToString(this.doc);
	},
});

export default responseFactory;
