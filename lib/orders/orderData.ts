import zlib from 'node:zlib';
import crypto from 'node:crypto';

import Crypto from '../crypto/Crypto.js';

/** EBICS encrypts order data with AES-128-CBC and a fixed all-zero IV; confidentiality rests on a fresh key per transaction. */
const ZERO_IV = Buffer.alloc(16, 0);

/** EBICS caps one order data segment at 1 MB of the base64-encoded, encrypted, compressed data. */
export const MAX_SEGMENT_SIZE = 1024 * 1024;

/** A fresh AES-128 transaction key. Must never be shared between two transactions. */
export const generateTransactionKey = (): Buffer => crypto.randomBytes(16);

/**
 * Check a segment size option. Segments are cut from a base64 string, so the size must be a
 * multiple of 4 — every segment then holds whole base64 quanta.
 */
export function assertSegmentSize(segmentSize: number): void {
	if (!Number.isInteger(segmentSize) || segmentSize < 4 || segmentSize % 4 !== 0 || segmentSize > MAX_SEGMENT_SIZE)
		throw new Error(`segmentSize must be a multiple of 4 between 4 and ${MAX_SEGMENT_SIZE} bytes, got ${segmentSize}`);
}

/** Compress, pad and encrypt a payload with the transaction key; the result is base64-encoded. */
export function encryptOrderData(data: Buffer | string, transactionKey: Buffer): string {
	const compressed = zlib.deflateSync(data);
	const cipher = crypto.createCipheriv('aes-128-cbc', transactionKey, ZERO_IV).setAutoPadding(false);

	return Buffer.concat([cipher.update(Crypto.pad(compressed)), cipher.final()]).toString('base64');
}

/** Split base64-encoded order data into transfer segments of at most `segmentSize` characters. */
export function splitSegments(encoded: string, segmentSize: number = MAX_SEGMENT_SIZE): string[] {
	assertSegmentSize(segmentSize);

	const segments: string[] = [];
	for (let offset = 0; offset < encoded.length; offset += segmentSize)
		segments.push(encoded.slice(offset, offset + segmentSize));

	// An empty payload still travels as one (empty) segment.
	return segments.length ? segments : [''];
}

/**
 * Join base64-encoded segments into the encrypted bytes. Banks either cut one base64 string (at any
 * position) or base64-encode every segment on its own, padding included. Segments holding whole
 * base64 quanta are decoded one by one, which reads both; otherwise the string is joined first.
 */
function decodeSegments(segments: string[]): Buffer {
	const cleaned = segments.map(segment => segment.replace(/\s/g, ''));
	const wholeQuanta = cleaned.slice(0, -1).every(segment => segment.length % 4 === 0);

	return wholeQuanta
		? Buffer.concat(cleaned.map(segment => Buffer.from(segment, 'base64')))
		: Buffer.from(cleaned.join(''), 'base64');
}

/** Decrypt and inflate order data: the base64-encoded segments of a transaction, in order. */
export function decryptOrderData(segments: string | string[], transactionKey: Buffer): Buffer {
	const encrypted = decodeSegments(Array.isArray(segments) ? segments : [segments]);
	const decipher = crypto.createDecipheriv('aes-128-cbc', transactionKey, ZERO_IV).setAutoPadding(false);
	const data = Buffer.concat([decipher.update(encrypted), decipher.final()]);

	return zlib.inflateSync(data);
}

/** The order data of an upload, prepared once per transaction: its key and its encrypted segments. */
export interface UploadTransaction {
	transactionKey: Buffer;
	segments: string[];
}

/**
 * The document as EBICS signs and transfers it. Line breaks are removed from text documents; a
 * Buffer is binary order data and travels byte for byte.
 */
export const normalizeDocument = (document: string | Buffer | undefined): string | Buffer =>
	Buffer.isBuffer(document) ? document : String(document ?? '').replace(/\n|\r/g, '');

export function prepareUploadTransaction(document: string | Buffer | undefined, segmentSize: number = MAX_SEGMENT_SIZE): UploadTransaction {
	const transactionKey = generateTransactionKey();

	return {
		transactionKey,
		segments: splitSegments(encryptOrderData(normalizeDocument(document), transactionKey), segmentSize),
	};
}

/**
 * Keep the transaction state on the order without making it enumerable, so the key does not travel
 * along when the order object is logged, serialized or spread.
 */
export function attachUploadTransaction(order: object, transaction: UploadTransaction): void {
	for (const [key, value] of Object.entries(transaction))
		Object.defineProperty(order, key, { value, enumerable: false, writable: true, configurable: true });
}
