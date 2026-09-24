import crypto from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

export type BankKeyValue = { pem: string } | { mod: Buffer; exp: Buffer };

type KeyFormat = 'certificate' | 'keyValue';

const text = (node: any, localName: string): string | undefined => {
	const found = xpath.select(`.//*[local-name(.)='${localName}']`, node) as unknown as any[];
	const value = found[0]?.textContent?.trim();

	return value || undefined;
};

/**
 * Read the bank keys from HPB order data (`HPBResponseOrderData`). A bank sends each key either as
 * an X.509 certificate (`ds:X509Data`), as a bare RSA key (`PubKeyValue/ds:RSAKeyValue` with
 * Modulus and Exponent), or both. `prefer` picks the format used when both are present.
 */
export function parseBankKeys(orderData: string, prefer: KeyFormat): Record<string, BankKeyValue> {
	if (!orderData.length) return {};

	const doc = new DOMParser().parseFromString(orderData, 'text/xml');
	const infos = xpath.select(
		"//*[local-name(.)='AuthenticationPubKeyInfo' or local-name(.)='EncryptionPubKeyInfo']",
		doc as unknown as Node,
	) as unknown as any[];
	const bankKeys: Record<string, BankKeyValue> = {};

	for (const info of infos) {
		const version = text(info, 'AuthenticationVersion') ?? text(info, 'EncryptionVersion');
		if (!version) continue;

		const certificate = text(info, 'X509Certificate');
		const modulus = text(info, 'Modulus');
		const exponent = text(info, 'Exponent');

		const fromCertificate = certificate
			? { pem: new crypto.X509Certificate(Buffer.from(certificate, 'base64')).toString() }
			: undefined;
		const fromKeyValue = modulus && exponent
			? { mod: Buffer.from(modulus, 'base64'), exp: Buffer.from(exponent, 'base64') }
			: undefined;

		const key = prefer === 'certificate' ? fromCertificate ?? fromKeyValue : fromKeyValue ?? fromCertificate;
		if (key) bankKeys[`bank${version}`] = key;
	}

	return bankKeys;
}
