import { assert } from 'chai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import xmlLintWasm from 'xmllint-wasm';

import * as ebics from '../../index.js';
import { EbicsClientError, EbicsClientErrorCode } from '../../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type Version = 'H004' | 'H005';

/** TransactionIDType is hexBinary of length 16. */
const TX_ID = '0123456789ABCDEF0123456789ABCDEF';

interface ScriptedResponse {
	status?: number;
	contentType?: string;
	body: string;
	/** Never answer: the request is received, but the connection stays silent. */
	hang?: boolean;
}

/** A download order data payload encrypted the way a bank does it, independent of the library code. */
interface EncryptedDownload {
	/** Base64 of the RSA (PKCS#1 v1.5) encrypted AES transaction key. */
	transactionKey: string;
	/** Base64 order data, split into segments. */
	segments: string[];
}

/** ISO 10126-style padding EBICS uses: fill up to the block, last byte = number of padding bytes. */
const pad = (data: Buffer): Buffer => {
	const padLength = 16 - (data.length % 16);
	return Buffer.concat([data, Buffer.alloc(padLength - 1, 0), Buffer.from([padLength])]);
};

/** Deflate, pad, AES-128-CBC (zero IV): the raw ciphertext and the base64 RSA-encrypted key. */
function encryptRaw(payload: Buffer, clientEncryptionPem: string): { transactionKey: string; ciphertext: Buffer } {
	const aesKey = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv('aes-128-cbc', aesKey, Buffer.alloc(16, 0)).setAutoPadding(false);
	const ciphertext = Buffer.concat([cipher.update(pad(zlib.deflateSync(payload))), cipher.final()]);
	const transactionKey = crypto.publicEncrypt({ key: clientEncryptionPem, padding: crypto.constants.RSA_PKCS1_PADDING }, aesKey).toString('base64');
	return { transactionKey, ciphertext };
}

/** Deflate, pad, AES-128-CBC (zero IV), base64, split into `numSegments` pieces (multiples of 4 characters). */
function encryptDownload(payload: Buffer, clientEncryptionPem: string, numSegments: number): EncryptedDownload {
	const { transactionKey, ciphertext } = encryptRaw(payload, clientEncryptionPem);
	const encoded = ciphertext.toString('base64');

	const quanta = encoded.length / 4;
	assert.isAtLeast(quanta, numSegments, 'payload too small for the requested number of segments');
	const perSegment = Math.ceil(quanta / numSegments) * 4;
	const segments: string[] = [];
	for (let i = 0; i < numSegments; i++)
		segments.push(encoded.slice(i * perSegment, i === numSegments - 1 ? undefined : (i + 1) * perSegment));
	assert.isTrue(segments.every(Boolean), 'every segment must carry data');

	return { transactionKey, segments };
}

/** A download answer (initialisation, transfer or receipt) in the given EBICS version. */
const downloadResponse = ({
	version = 'H005',
	phase = 'Initialisation',
	transactionId = TX_ID,
	numSegments,
	segmentNumber,
	lastSegment = false,
	technicalCode = '000000',
	businessCode = '000000',
	transactionKey,
	orderData,
}: {
	version?: Version;
	phase?: 'Initialisation' | 'Transfer' | 'Receipt';
	transactionId?: string | null;
	numSegments?: number;
	segmentNumber?: number;
	lastSegment?: boolean | '1' | '0';
	technicalCode?: string;
	businessCode?: string;
	transactionKey?: string;
	orderData?: string;
}): string => {
	const encryptionInfo = transactionKey === undefined
		? ''
		: `<DataEncryptionInfo authenticate="true">
				<EncryptionPubKeyDigest Version="E002" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">AAAA</EncryptionPubKeyDigest>
				<TransactionKey>${transactionKey}</TransactionKey>
			</DataEncryptionInfo>`;
	const dataTransfer = orderData === undefined && transactionKey === undefined
		? ''
		: `<DataTransfer>${encryptionInfo}${orderData === undefined ? '' : `<OrderData>${orderData}</OrderData>`}</DataTransfer>`;

	return `<?xml version="1.0" encoding="UTF-8"?>
<ebicsResponse xmlns="urn:org:ebics:${version}" Version="${version}" Revision="1">
	<header authenticate="true">
		<static>
			${transactionId === null ? '' : `<TransactionID>${transactionId}</TransactionID>`}
			${numSegments === undefined ? '' : `<NumSegments>${numSegments}</NumSegments>`}
		</static>
		<mutable>
			<TransactionPhase>${phase}</TransactionPhase>
			${segmentNumber === undefined ? '' : `<SegmentNumber lastSegment="${lastSegment}">${segmentNumber}</SegmentNumber>`}
			<ReturnCode>${technicalCode}</ReturnCode>
			<ReportText>[EBICS_OK] OK</ReportText>
		</mutable>
	</header>
	<body>
		${dataTransfer}
		<ReturnCode authenticate="true">${businessCode}</ReturnCode>
	</body>
</ebicsResponse>`;
};

/** The answer set a bank gives for a segmented download: init with segment 1, then one transfer answer per further segment. */
function segmentedAnswers(version: Version, encrypted: EncryptedDownload, transactionId = TX_ID): ScriptedResponse[] {
	const numSegments = encrypted.segments.length;
	return encrypted.segments.map((segment, i) => ({
		body: downloadResponse({
			version,
			phase: i === 0 ? 'Initialisation' : 'Transfer',
			transactionId,
			numSegments: i === 0 ? numSegments : undefined,
			segmentNumber: i + 1,
			lastSegment: i === numSegments - 1,
			transactionKey: i === 0 ? encrypted.transactionKey : undefined,
			orderData: segment,
		}),
	}));
}

const receiptAnswer = (version: Version = 'H005', transactionId = TX_ID): ScriptedResponse => ({
	body: downloadResponse({ version, phase: 'Receipt', transactionId, technicalCode: '011000' }),
});

/** Scripted stand-in for a bank: answers each POST with the next queued response and records the requests. */
function createStubBank() {
	const queue: ScriptedResponse[] = [];
	const requests: string[] = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => { body += chunk; });
		req.on('end', () => {
			requests.push(body);
			const next = queue.shift() ?? { status: 500, body: 'stub bank: no response scripted' };
			if (next.hang) return;
			res.writeHead(next.status ?? 200, { 'content-type': next.contentType ?? 'text/xml;charset=UTF-8' });
			res.end(next.body);
		});
	});

	return {
		queue,
		requests,
		/** TransactionPhase of every request received, in order. */
		phases: () => requests.map(r => /<TransactionPhase>(\w+)<\/TransactionPhase>/.exec(r)?.[1] ?? 'none'),
		/** SegmentNumber and its lastSegment flag of every request, `null` when it carries none. */
		segments: () => requests.map((r) => {
			const match = /<SegmentNumber lastSegment="(true|false)">(\d+)<\/SegmentNumber>/.exec(r);
			return match ? { number: Number(match[2]), lastSegment: match[1] === 'true' } : null;
		}),
		/** ReceiptCode of every receipt request, in order. */
		receiptCodes: () => requests
			.map(r => /<ReceiptCode>(\d)<\/ReceiptCode>/.exec(r)?.[1])
			.filter((code): code is string => code !== undefined)
			.map(Number),
		listen: () => new Promise<string>((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ebics`));
		}),
		close: () => new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections();
		}),
	};
}

async function expectClientError(promise: Promise<unknown>, code: string): Promise<EbicsClientError> {
	try {
		await promise;
	} catch (error) {
		assert.instanceOf(error, EbicsClientError);
		assert.strictEqual((error as EbicsClientError).code, code, (error as Error).message);
		return error as EbicsClientError;
	}
	assert.fail(`expected an EbicsClientError ${code}`);
}

const xsdValidator = (version: Version) => {
	const xsdDir = path.resolve(__dirname, `../xsd/${version}`);
	const mainSchema = `ebics_${version}.xsd`;
	const schemaDoc = fs.readFileSync(path.resolve(xsdDir, mainSchema), { encoding: 'utf8' });
	const preload = fs
		.readdirSync(xsdDir)
		.filter(file => file.endsWith('.xsd') && file !== mainSchema)
		.map(file => ({ fileName: file, contents: fs.readFileSync(path.join(xsdDir, file), { encoding: 'utf8' }) }));

	return async (xml: string): Promise<string[]> => {
		const results = await xmlLintWasm.validateXML({
			xml: [{ fileName: 'ebics.xml', contents: xml }],
			schema: [{ fileName: mainSchema, contents: schemaDoc }],
			preload,
		});
		return results.valid ? [] : results.errors.map(e => e.message);
	};
};

/** A payload that does not compress to nothing, so it spans several segments. */
const makePayload = (): Buffer => Buffer.from(`<Document>${crypto.randomBytes(1500).toString('hex')}</Document>`);

describe('EBICS download transaction', function () {
	this.timeout(10000);

	const bank = createStubBank();
	let client: ebics.Client;
	/** Same keys and bank as `client`, but gives up after a short timeout. */
	let impatientClient: ebics.Client;
	let encryptionPem: string;

	before(async () => {
		const url = await bank.listen();
		const options = {
			url,
			partnerId: 'PARTNER1',
			userId: 'USER1',
			hostId: 'HOST1',
			passphrase: Buffer.alloc(32, 0),
			iv: Buffer.alloc(16, 0),
			keyStorage: ebics.inMemoryKeysStorage(),
		};
		client = new ebics.Client({ ...options, timeout: 5000 });
		impatientClient = new ebics.Client({ ...options, timeout: 300 });
		const keys = await client.generateKeys({ subject: 'ebics.example.com' }, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
		encryptionPem = keys!.e()!.toPem();
	});

	after(() => bank.close());

	beforeEach(() => {
		bank.queue.length = 0;
		bank.requests.length = 0;
	});

	const downloadH005 = () => client.send(ebics.OrdersH005.EOP({ start: '2026-01-01', end: '2026-01-02' }) as never) as Promise<ebics.EbicsDownloadResponse>;
	const downloadH004 = () => client.send(ebics.OrdersH004.STA('2026-01-01', '2026-01-02') as never) as Promise<ebics.EbicsDownloadResponse>;

	describe('segmented download (H005)', () => {
		it('fetches segments 2..n, decrypts the concatenation once and confirms with ReceiptCode 0', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 3)), receiptAnswer());

			const result = await downloadH005();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Transfer', 'Receipt']);
			assert.deepEqual(bank.segments(), [null, { number: 2, lastSegment: false }, { number: 3, lastSegment: true }, null]);
			assert.deepEqual(bank.receiptCodes(), [0]);
			for (const request of bank.requests.slice(1))
				assert.include(request, `<TransactionID>${TX_ID}</TransactionID>`);
			assert.include(result, { transactionId: TX_ID, phase: 'initialisation', technicalCode: '000000', businessCode: '000000', numSegments: 3 });
		});

		it('handles a single-segment download and still sends ReceiptCode 0', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 1)), receiptAnswer());

			const result = await downloadH005();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.phases(), ['Initialisation', 'Receipt']);
			assert.deepEqual(bank.receiptCodes(), [0]);
			assert.strictEqual(result.numSegments, 1);
		});
	});

	describe('unreadable order data', () => {
		it('sends ReceiptCode 1 (never 0) and throws ORDER_DATA_UNREADABLE', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 2);
			// Valid base64 and block length, but not the ciphertext of a deflate stream.
			encrypted.segments[1] = Buffer.alloc(Buffer.from(encrypted.segments[1]!, 'base64').length, 7).toString('base64');
			bank.queue.push(...segmentedAnswers('H005', encrypted), receiptAnswer());

			const error = await expectClientError(downloadH005(), EbicsClientErrorCode.ORDER_DATA_UNREADABLE);

			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Receipt']);
			assert.deepEqual(bank.receiptCodes(), [1]);
			assert.strictEqual(error.transactionId, TX_ID);
			assert.isDefined(error.cause);
			assert.isTrue(error.redeliveryRequested);
		});

		it('reports when the ReceiptCode 1 could not be sent', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 2);
			encrypted.segments[1] = Buffer.alloc(Buffer.from(encrypted.segments[1]!, 'base64').length, 7).toString('base64');
			// No receipt answer scripted: the stub bank answers the receipt with HTTP 500.
			bank.queue.push(...segmentedAnswers('H005', encrypted));

			const error = await expectClientError(downloadH005(), EbicsClientErrorCode.ORDER_DATA_UNREADABLE);

			assert.deepEqual(bank.receiptCodes(), [1]);
			assert.isFalse(error.redeliveryRequested);
			assert.match(error.message, /could not be sent/);
		});

		it('sends ReceiptCode 1 when the order data is not even valid ciphertext', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 1);
			encrypted.segments[0] = 'AAAA';
			bank.queue.push(...segmentedAnswers('H005', encrypted), receiptAnswer());

			await expectClientError(downloadH005(), EbicsClientErrorCode.ORDER_DATA_UNREADABLE);

			assert.deepEqual(bank.receiptCodes(), [1]);
		});
	});

	describe('bank rejections', () => {
		it('reports a rejected transfer of segment 2 without sending any receipt', async () => {
			const answers = segmentedAnswers('H005', encryptDownload(makePayload(), encryptionPem, 3));
			bank.queue.push(answers[0]!, {
				body: downloadResponse({ phase: 'Transfer', technicalCode: '091101', businessCode: '000000' }),
			});

			const result = await downloadH005();

			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer']);
			assert.deepEqual(bank.receiptCodes(), []);
			assert.include(result, { phase: 'transfer', segmentNumber: 2, numSegments: 3, technicalCode: '091101', transactionId: TX_ID });
			assert.isUndefined(result.receiptCode, 'no receipt was sent');
			assert.isTrue(result.transactionAborted, '091101 ends the transaction');
			assert.strictEqual(result.orderData.length, 0);
		});

		it('returns a rejected initialisation (090005 no data) as the verdict and sends nothing more', async () => {
			bank.queue.push({ body: downloadResponse({ transactionId: null, businessCode: '090005' }) });

			const result = await downloadH005();

			assert.deepEqual(bank.phases(), ['Initialisation']);
			assert.include(result, { phase: 'initialisation', technicalCode: '000000', businessCode: '090005' });
			assert.strictEqual(result.orderData.length, 0);
		});
	});

	describe('segment bookkeeping', () => {
		it('throws SEGMENT_MISMATCH when a transfer answer carries the wrong SegmentNumber', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 3);
			bank.queue.push(segmentedAnswers('H005', encrypted)[0]!, {
				body: downloadResponse({ phase: 'Transfer', segmentNumber: 3, orderData: encrypted.segments[2] }),
			});

			const error = await expectClientError(downloadH005(), EbicsClientErrorCode.SEGMENT_MISMATCH);

			assert.strictEqual(error.segmentNumber, 2);
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Receipt']);
			assert.deepEqual(bank.receiptCodes(), [1], 'the bank is asked to deliver the broken transaction again');
		});

		it('throws SEGMENT_MISMATCH when the init answer is not segment 1', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 2);
			bank.queue.push({
				body: downloadResponse({ numSegments: 2, segmentNumber: 2, transactionKey: encrypted.transactionKey, orderData: encrypted.segments[0] }),
			});

			await expectClientError(downloadH005(), EbicsClientErrorCode.SEGMENT_MISMATCH);

			assert.deepEqual(bank.phases(), ['Initialisation', 'Receipt']);
			assert.deepEqual(bank.receiptCodes(), [1]);
		});

		it('throws SEGMENT_MISMATCH when lastSegment never arrives within NumSegments', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 2);
			const answers = segmentedAnswers('H005', encrypted);
			bank.queue.push(answers[0]!, {
				// Segment 2 of 2, but the bank claims more are coming.
				body: downloadResponse({ phase: 'Transfer', segmentNumber: 2, lastSegment: false, orderData: encrypted.segments[1] }),
			});

			const error = await expectClientError(downloadH005(), EbicsClientErrorCode.SEGMENT_MISMATCH);

			assert.strictEqual(error.segmentNumber, 3);
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Receipt'], 'no request for a segment beyond NumSegments');
			assert.deepEqual(bank.receiptCodes(), [1]);
		});

		it('throws SEGMENT_MISMATCH when lastSegment arrives before NumSegments were delivered, never confirming with 0', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 3);
			const answers = segmentedAnswers('H005', encrypted);
			bank.queue.push(answers[0]!, {
				body: downloadResponse({ phase: 'Transfer', segmentNumber: 2, lastSegment: true, orderData: encrypted.segments[1] }),
			}, receiptAnswer());

			await expectClientError(downloadH005(), EbicsClientErrorCode.SEGMENT_MISMATCH);

			assert.notInclude(bank.receiptCodes(), 0);
		});
	});

	describe('H004', () => {
		it('downloads a 3-segment payload and confirms with ReceiptCode 0', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H004', encryptDownload(payload, encryptionPem, 3)), receiptAnswer('H004'));

			const result = await downloadH004();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Transfer', 'Receipt']);
			assert.deepEqual(bank.segments(), [null, { number: 2, lastSegment: false }, { number: 3, lastSegment: true }, null]);
			assert.deepEqual(bank.receiptCodes(), [0]);
			assert.include(result, { numSegments: 3, receiptCode: 0, transactionAborted: false });
		});

		it('sends ReceiptCode 1 for unreadable order data', async () => {
			const encrypted = encryptDownload(makePayload(), encryptionPem, 1);
			encrypted.segments[0] = Buffer.alloc(Buffer.from(encrypted.segments[0]!, 'base64').length, 7).toString('base64');
			bank.queue.push(...segmentedAnswers('H004', encrypted), receiptAnswer('H004'));

			await expectClientError(downloadH004(), EbicsClientErrorCode.ORDER_DATA_UNREADABLE);

			assert.deepEqual(bank.receiptCodes(), [1]);
		});
	});

	describe('base64 segment boundaries', () => {
		/** Answers carrying the given base64 segments, with the transaction key of `transactionKey`. */
		const answersFor = (transactionKey: string, segments: string[]) => segmentedAnswers('H005', { transactionKey, segments });

		it('decodes segments that the bank base64-encoded separately, each with its own padding', async () => {
			const payload = makePayload();
			const { transactionKey, ciphertext } = encryptRaw(payload, encryptionPem);
			// 100-byte chunks: 100 % 3 = 1, so every segment ends in "==" padding.
			const chunkSize = 100;
			const segments: string[] = [];
			for (let offset = 0; offset < ciphertext.length; offset += chunkSize)
				segments.push(ciphertext.subarray(offset, offset + chunkSize).toString('base64'));
			assert.isAtLeast(segments.length, 3);
			assert.isTrue(segments.slice(0, -1).every(segment => segment.endsWith('==')));
			bank.queue.push(...answersFor(transactionKey, segments), receiptAnswer());

			const result = await downloadH005();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.receiptCodes(), [0]);
			assert.strictEqual(result.numSegments, segments.length);
		});

		it('decodes one base64 string that the bank cut at a position that is not a multiple of 4', async () => {
			const payload = makePayload();
			const { transactionKey, ciphertext } = encryptRaw(payload, encryptionPem);
			const encoded = ciphertext.toString('base64');
			const cuts = [101, 303];
			const segments = [encoded.slice(0, cuts[0]), encoded.slice(cuts[0], cuts[1]), encoded.slice(cuts[1])];
			assert.isTrue(segments.every(Boolean));
			bank.queue.push(...answersFor(transactionKey, segments), receiptAnswer());

			const result = await downloadH005();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Transfer', 'Receipt']);
			assert.deepEqual(bank.receiptCodes(), [0]);
		});
	});

	describe('lastSegment="1"', () => {
		for (const version of ['H005', 'H004'] as const) {
			const download = () => (version === 'H005' ? downloadH005() : downloadH004());

			it(`${version}: accepts lastSegment="1" on the final transfer answer and requests no further segment`, async () => {
				const payload = makePayload();
				const answers = segmentedAnswers(version, encryptDownload(payload, encryptionPem, 3));
				answers[2]!.body = answers[2]!.body.replace('lastSegment="true"', 'lastSegment="1"');
				assert.include(answers[2]!.body, 'lastSegment="1"');
				bank.queue.push(...answers, receiptAnswer(version));

				const result = await download();

				assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
				assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Transfer', 'Receipt']);
				assert.deepEqual(bank.receiptCodes(), [0]);
			});

			it(`${version}: accepts a single-segment init answer with lastSegment="1" without any transfer`, async () => {
				const payload = makePayload();
				const encrypted = encryptDownload(payload, encryptionPem, 1);
				bank.queue.push({
					body: downloadResponse({
						version,
						numSegments: 1,
						segmentNumber: 1,
						lastSegment: '1',
						transactionKey: encrypted.transactionKey,
						orderData: encrypted.segments[0],
					}),
				}, receiptAnswer(version));

				const result = await download();

				assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
				assert.deepEqual(bank.phases(), ['Initialisation', 'Receipt']);
				assert.deepEqual(bank.receiptCodes(), [0]);
			});
		}
	});

	describe('positive receipt', () => {
		it('succeeds when the bank answers the receipt with 011000', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 2)), {
				body: downloadResponse({ phase: 'Receipt', technicalCode: '011000', businessCode: '000000' }),
			});

			const result = await downloadH005();

			assert.strictEqual(Buffer.from(result.orderData).toString(), payload.toString());
			assert.deepEqual(bank.receiptCodes(), [0]);
		});

		const unconfirmed: Array<{ name: string; technicalCode: string; businessCode: string }> = [
			{ name: 'a technical error (091101)', technicalCode: '091101', businessCode: '000000' },
			{ name: 'a business error', technicalCode: '011000', businessCode: '090003' },
		];
		for (const { name, technicalCode, businessCode } of unconfirmed) {
			it(`throws RECEIPT_FAILED carrying the order data when the receipt is answered with ${name}`, async () => {
				const payload = makePayload();
				bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 2)), {
					body: downloadResponse({ phase: 'Receipt', technicalCode, businessCode }),
				});

				const error = await expectClientError(downloadH005(), EbicsClientErrorCode.RECEIPT_FAILED);

				assert.strictEqual(Buffer.from(error.orderData!).toString(), payload.toString());
				assert.notInclude(Object.keys(error), 'orderData', 'the statement is not serialised with the error');
				assert.notInclude(JSON.stringify(error), payload.toString('base64').slice(0, 16));
				assert.include(error, { phase: 'receipt', transactionId: TX_ID, technicalCode, businessCode });
				assert.deepEqual(bank.receiptCodes(), [0], 'no second receipt');
			});
		}

		it('throws RECEIPT_FAILED carrying the order data and the cause when the receipt gets HTTP 500', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 2)), {
				status: 500,
				contentType: 'text/plain',
				body: 'internal error',
			});

			const error = await expectClientError(downloadH005(), EbicsClientErrorCode.RECEIPT_FAILED);

			assert.strictEqual(Buffer.from(error.orderData!).toString(), payload.toString());
			assert.strictEqual(error.transactionId, TX_ID);
			assert.instanceOf(error.cause, EbicsClientError);
			assert.strictEqual((error.cause as EbicsClientError).code, EbicsClientErrorCode.HTTP_STATUS);
			assert.deepEqual(bank.receiptCodes(), [0]);
		});

		it('throws RECEIPT_FAILED with requestSent and the order data when the receipt times out', async () => {
			const payload = makePayload();
			bank.queue.push(...segmentedAnswers('H005', encryptDownload(payload, encryptionPem, 2)), { body: '', hang: true });

			const error = await expectClientError(
				impatientClient.send(ebics.OrdersH005.EOP({ start: '2026-01-01', end: '2026-01-02' }) as never),
				EbicsClientErrorCode.RECEIPT_FAILED,
			);

			assert.strictEqual(Buffer.from(error.orderData!).toString(), payload.toString());
			assert.strictEqual(error.requestSent, true);
			assert.instanceOf(error.cause, EbicsClientError);
			assert.strictEqual((error.cause as EbicsClientError).code, EbicsClientErrorCode.TIMEOUT);
			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Receipt']);
		});
	});

	describe('H004 rejected initialisation', () => {
		it('returns an empty Buffer as orderData', async () => {
			bank.queue.push({ body: downloadResponse({ version: 'H004', transactionId: null, businessCode: '090005' }) });

			const result = await downloadH004();

			assert.deepEqual(bank.phases(), ['Initialisation']);
			assert.include(result, { phase: 'initialisation', businessCode: '090005' });
			assert.isTrue(Buffer.isBuffer(result.orderData));
			assert.strictEqual(result.orderData.length, 0);
		});
	});

	describe('XSD validity of follow-up requests', () => {
		const cases: Array<{ version: Version; download: () => Promise<unknown> }> = [
			{ version: 'H005', download: () => downloadH005() },
			{ version: 'H004', download: () => downloadH004() },
		];

		for (const { version, download } of cases) {
			it(`${version}: download transfer and receipt (codes 0 and 1) requests validate`, async () => {
				const validate = xsdValidator(version);

				bank.queue.push(...segmentedAnswers(version, encryptDownload(makePayload(), encryptionPem, 2)), receiptAnswer(version));
				await download();

				const broken = encryptDownload(makePayload(), encryptionPem, 1);
				broken.segments[0] = Buffer.alloc(Buffer.from(broken.segments[0]!, 'base64').length, 7).toString('base64');
				bank.queue.push(...segmentedAnswers(version, broken), receiptAnswer(version));
				await expectClientError(download(), EbicsClientErrorCode.ORDER_DATA_UNREADABLE);

				assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer', 'Receipt', 'Initialisation', 'Receipt']);
				assert.deepEqual(bank.receiptCodes(), [0, 1]);
				for (const request of bank.requests)
					assert.deepEqual(await validate(request), [], `invalid ${version} request:\n${request}`);
			});
		}
	});
});
