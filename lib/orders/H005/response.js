'use strict';

const zlib = require('zlib');
const crypto = require('crypto');

const Crypto = require('../../crypto/Crypto');

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const xpath = require('xpath');
const errors = require('./errors');

const DEFAULT_IV = Buffer.from(Array(16).fill(0, 0, 15));

const lastChild = (node) => {
	let y = node.lastChild;

	while (y.nodeType !== 1) y = y.previousSibling;

	return y;
};

module.exports = (xml, keys) => ({
	keys,
	doc: new DOMParser().parseFromString(xml, 'text/xml'),

	isSegmented() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:SegmentNumber',
			this.doc,
		);

		return !!node.length;
	},

	isLastSegment() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			"//xmlns:header/xmlns:mutable/*[@lastSegment='true']",
			this.doc,
		);

		return !!node.length;
	},

	orderData() {
		const orderDataNode = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'OrderData',
		);

		if (!orderDataNode.length) return Buffer.alloc(0);

		const orderData = orderDataNode[0].textContent;
		const decipher = crypto
			.createDecipheriv('aes-128-cbc', this.transactionKey(), DEFAULT_IV)
			.setAutoPadding(false);
		const data = Buffer.from(
			decipher.update(orderData, 'base64', 'binary')
				+ decipher.final('binary'),
			'binary',
		);

		return zlib.inflateSync(data);
	},

	transactionKey() {
		const keyNodeText = this.doc.getElementsByTagNameNS(
			'urn:org:ebics:H005',
			'TransactionKey',
		)[0].textContent;
		return Crypto.privateDecrypt(
			this.keys.e(),
			Buffer.from(keyNodeText, 'base64'),
		);
	},

	transactionId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:static/xmlns:TransactionID',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	orderId() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'.//xmlns:header/xmlns:mutable/xmlns:OrderID',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	businessCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select('//xmlns:body/xmlns:ReturnCode', this.doc);

		return node.length ? node[0].textContent : '';
	},

	businessSymbol(code) {
		if (!errors.business[code]) return undefined;
		return errors.business[code].symbol;
	},

	businessShortText(code) {
		if (!errors.business[code]) return undefined;
		return errors.business[code].short_text;
	},

	businessMeaning(code) {
		if (!errors.business[code]) return undefined;
		return errors.business[code].meaning;
	},

	technicalCode() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReturnCode',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	technicalSymbol() {
		const select = xpath.useNamespaces({ xmlns: 'urn:org:ebics:H005' });
		const node = select(
			'//xmlns:header/xmlns:mutable/xmlns:ReportText',
			this.doc,
		);

		return node.length ? node[0].textContent : '';
	},

	technicalShortText(code) {
		if (!errors.technical[code]) return undefined;
		return errors.technical[code].short_text;
	},

	technicalMeaning(code) {
		if (!errors.technical[code]) return undefined;
		return errors.technical[code].meaning;
	},

	bankKeys() {
		const orderData = this.orderData().toString();
		if (!orderData.length) return {};

		const doc = new DOMParser().parseFromString(orderData, 'text/xml');
		const select = xpath.useNamespaces({ ds: 'http://www.w3.org/2000/09/xmldsig#' });
		const keyNodes = select('//ds:X509Data', doc);
		const bankKeys = {};

		if (!keyNodes.length) return {};

		for (let i = 0; i < keyNodes.length; i++) {
			const type = xpath.select('.//*[local-name(.)=\'AuthenticationVersion\' or local-name(.)=\'EncryptionVersion\']', keyNodes[i].parentNode)[0].textContent;
			const certificateBase64 = select('//ds:X509Certificate', keyNodes[i])[0].textContent.trim();
			const certificate = new crypto.X509Certificate(Buffer.from(certificateBase64, 'base64'));
			bankKeys[`bank${type}`] = { pem: certificate.toString() };
		}

		return bankKeys;
	},

	toXML() {
		return new XMLSerializer().serializeToString(this.doc);
	},
});
