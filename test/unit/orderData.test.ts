import { assert } from 'chai';
import crypto from 'node:crypto';

import { decryptOrderData, encryptOrderData, normalizeDocument, splitSegments } from '../../lib/orders/orderData.js';

describe('order data', () => {
	it('strips line breaks from text documents only', () => {
		assert.strictEqual(normalizeDocument('<a>\r\n<b/>\n</a>'), '<a><b/></a>');

		const binary = Buffer.from([0xe4, 0x0a, 0x41, 0x0d]);
		assert.strictEqual(normalizeDocument(binary), binary, 'binary order data travels byte for byte');
	});

	it('round-trips a Buffer document through encryption and segmentation', () => {
		const key = crypto.randomBytes(16);
		const binary = crypto.randomBytes(500);
		const segments = splitSegments(encryptOrderData(binary, key), 64);

		assert.isAbove(segments.length, 1);
		assert.deepEqual(decryptOrderData(segments, key), binary);
	});
});
