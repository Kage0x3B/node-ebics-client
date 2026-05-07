// const crypto = require('crypto');
import Crypto from '../../crypto/Crypto.js';

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import xpath from 'xpath';
import c14nMod from 'xml-crypto/lib/c14n-canonicalization.js';
const C14n = (c14nMod as unknown as { C14nCanonicalization: new () => { process: (node: unknown) => string } }).C14nCanonicalization;

const digest = (doc: any) => {
	// get the xml node, where the digested value is supposed to be
	const nodeDigestValue = doc.getElementsByTagName('ds:DigestValue')[0];

	// canonicalize the node that has authenticate='true' attribute
	const contentToDigest = (xpath
		.select("//*[@authenticate='true']", doc) as unknown as any[])
		.map(x => new C14n().process(x))
		.join('');

	// fix the canonicalization
	const fixedContent = contentToDigest.replace(
		/xmlns="urn:org:ebics:H005"/g,
		'xmlns="urn:org:ebics:H005" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
	);

	if (nodeDigestValue)
		nodeDigestValue.textContent = Crypto.digestWithHash(fixedContent)
			.toString('base64')
			.trim();

	return doc;
};

const sign = (doc: any, key: any) => {
	const nodeSignatureValue = doc.getElementsByTagName('ds:SignatureValue')[0];

	if (nodeSignatureValue) {
		const select = xpath.useNamespaces({
			ds: 'http://www.w3.org/2000/09/xmldsig#',
		});
		const contentToSign = new C14n()
			.process((select('//ds:SignedInfo', doc) as unknown as any[])[0])
			.replace(
				'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
				'xmlns="urn:org:ebics:H005" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
			);

		nodeSignatureValue.textContent = Crypto.privateSign(key, contentToSign); // this.keys.x().key.sign(contentToSign, 'base64');
	}

	return doc;
};

const toXML = (doc: any) => new XMLSerializer().serializeToString(doc);

export default {
	sign(data: string, keyX: any) {
		const doc = new DOMParser().parseFromString(data, 'text/xml');

		return toXML(sign(digest(doc), keyX));
	},
};
