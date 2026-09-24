import { assert } from 'chai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import xmlLintWasm from 'xmllint-wasm';

import * as ebics from '../../index.js';
import Crypto from '../../lib/crypto/Crypto.js';
import serializer from '../../lib/middleware/serializer.js';
import { MAX_SEGMENT_SIZE, decryptOrderData, encryptOrderData, prepareUploadTransaction } from '../../lib/orders/orderData.js';

const { OrdersH004, OrdersH005 } = ebics;
const __dirname = dirname(fileURLToPath(import.meta.url));

interface ScriptedResponse {
	status?: number;
	contentType?: string;
	body: string;
}

type Handler = (body: string) => ScriptedResponse;

/* ---------- request inspection ---------- */

const pick = (xml: string, tag: string): string | undefined =>
	new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml)?.[1];

const phaseOf = (xml: string) => pick(xml, 'TransactionPhase');
const transactionIdOf = (xml: string) => pick(xml, 'TransactionID');
const orderDataOf = (xml: string) => pick(xml, 'OrderData');
const segmentOf = (xml: string): { number: number; lastSegment: string } | undefined => {
	const match = /<SegmentNumber lastSegment="(\w+)">(\d+)<\/SegmentNumber>/.exec(xml);
	return match ? { number: Number(match[2]), lastSegment: match[1]! } : undefined;
};

/* ---------- bank answers (H005) ---------- */

const h005Response = ({
	transactionId,
	phase = 'Initialisation',
	orderId = 'N001',
	businessCode = '000000',
	extraStatic = '',
	extraMutable = '',
	extraBody = '',
}: {
	transactionId?: string;
	phase?: string;
	orderId?: string | null;
	businessCode?: string;
	extraStatic?: string;
	extraMutable?: string;
	extraBody?: string;
}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ebicsResponse xmlns="urn:org:ebics:H005" Version="H005" Revision="1">
	<header authenticate="true">
		<static>${transactionId ? `<TransactionID>${transactionId}</TransactionID>` : ''}${extraStatic}</static>
		<mutable>
			<TransactionPhase>${phase}</TransactionPhase>
			${extraMutable}
			${orderId === null ? '' : `<OrderID>${orderId}</OrderID>`}
			<ReturnCode>000000</ReturnCode>
			<ReportText>[EBICS_OK] OK</ReportText>
		</mutable>
	</header>
	<body>${extraBody}<ReturnCode authenticate="true">${businessCode}</ReturnCode></body>
</ebicsResponse>`;

/** A single-segment download answer whose order data is encrypted for the client's E002 key. */
const h005DownloadInit = (transactionId: string, clientE: { toPem(): string }, payload: string): string => {
	const transactionKey = crypto.randomBytes(16);
	const encryptedKey = crypto.publicEncrypt(
		{ key: clientE.toPem(), padding: crypto.constants.RSA_PKCS1_PADDING },
		transactionKey,
	).toString('base64');

	return h005Response({
		transactionId,
		extraStatic: '<NumSegments>1</NumSegments>',
		extraMutable: '<SegmentNumber lastSegment="true">1</SegmentNumber>',
		extraBody: `<DataTransfer><DataEncryptionInfo authenticate="true"><EncryptionPubKeyDigest Version="E002" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256">AA==</EncryptionPubKeyDigest><TransactionKey>${encryptedKey}</TransactionKey></DataEncryptionInfo><OrderData>${encryptOrderData(payload, transactionKey)}</OrderData></DataTransfer>`,
	});
};

/* ---------- stub bank ---------- */

/** Stand-in for a bank that routes every POST through `handler` after a small random delay, recording the requests. */
function createStubBank() {
	const requests: string[] = [];
	let handler: Handler = () => ({ status: 500, body: 'stub bank: no handler' });

	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => { body += chunk; });
		req.on('end', () => {
			requests.push(body);
			let next: ScriptedResponse;
			try {
				next = handler(body);
			} catch (error) {
				next = { status: 500, body: `stub bank: ${(error as Error).message}` };
			}
			// Random latency lets concurrent transactions interleave.
			setTimeout(() => {
				res.writeHead(next.status ?? 200, { 'content-type': next.contentType ?? 'text/xml;charset=UTF-8' });
				res.end(next.body);
			}, Math.floor(Math.random() * 10));
		});
	});

	return {
		requests,
		setHandler: (fn: Handler) => { handler = fn; },
		listen: () => new Promise<string>((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ebics`));
		}),
		close: () => new Promise<void>(resolve => server.close(() => resolve())),
	};
}

/* ---------- XSD validation ---------- */

const xsdValidator = (version: 'H004' | 'H005') => {
	const xsdDir = path.resolve(__dirname, `../xsd/${version}`);
	const mainFile = `ebics_${version}.xsd`;
	const schemaDoc = fs.readFileSync(path.resolve(xsdDir, mainFile), { encoding: 'utf8' });
	const preload = fs
		.readdirSync(xsdDir)
		.filter(file => file.endsWith('.xsd') && file !== mainFile)
		.map(file => ({ fileName: file, contents: fs.readFileSync(path.join(xsdDir, file), { encoding: 'utf8' }) }));

	return async (xml: string): Promise<string[]> => {
		const results = await xmlLintWasm.validateXML({
			xml: [{ fileName: 'ebics.xml', contents: xml }],
			schema: [{ fileName: mainFile, contents: schemaDoc }],
			preload,
		});
		return results.valid ? [] : results.errors.map(e => e.message);
	};
};

/* ---------- helpers ---------- */

const newClient = async (url: string, options: Partial<ebics.ClientOptions> = {}): Promise<ebics.Client> => {
	const client = new ebics.Client({
		url,
		partnerId: 'PARTNER1',
		userId: 'USER1',
		hostId: 'HOST1',
		passphrase: Buffer.alloc(32, 0),
		iv: Buffer.alloc(16, 0),
		keyStorage: ebics.inMemoryKeysStorage(),
		timeout: 5000,
		...options,
	});
	await client.generateKeys({ subject: 'ebics.example.com' }, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
	return client;
};

/** The AES transaction key of an upload init request, decrypted with the (test-known) bank private key. */
const transactionKeyOf = async (client: ebics.Client, initXml: string): Promise<Buffer> => {
	const encrypted = pick(initXml, 'TransactionKey');
	assert.isString(encrypted, 'init request carries a TransactionKey');
	const keys = await client.keys();
	return Crypto.privateDecrypt(keys!.bankE()!, Buffer.from(encrypted!, 'base64'));
};

/** Document whose encrypted, base64-encoded order data spans exactly `n` segments of `size`. */
const documentWithSegments = (n: number, size: number): string => {
	for (let len = 1; len < 100_000; len++) {
		const doc = `<Document>${crypto.randomBytes(len).toString('hex')}</Document>`;
		const encodedLength = encryptOrderData(doc, crypto.randomBytes(16)).length;
		if (Math.ceil(encodedLength / size) === n) return doc;
	}
	throw new Error(`no document found for ${n} segments of ${size}`);
};

/** Plain upload bank: every init opens TX<n>, every transfer is accepted for its TransactionID. */
const uploadBank = (opts: { rejectSegment?: number } = {}): Handler => {
	let counter = 0;
	return (body) => {
		const phase = phaseOf(body);
		if (phase === 'Initialisation') {
			counter++;
			return { body: h005Response({ transactionId: `TX${counter}`, orderId: `N${counter}` }) };
		}
		const transactionId = transactionIdOf(body)!;
		const segment = segmentOf(body);
		if (opts.rejectSegment && segment?.number === opts.rejectSegment)
			return { body: h005Response({ transactionId, phase: 'Transfer', orderId: null, businessCode: '091112' }) };
		return { body: h005Response({ transactionId, phase: 'Transfer', orderId: null }) };
	};
};

/* ---------- tests ---------- */

describe('Upload transaction (key, statelessness, segmentation)', () => {
	const bank = createStubBank();
	let url: string;
	let client: ebics.Client;

	before(async () => {
		url = await bank.listen();
		client = await newClient(url);
	});

	after(() => bank.close());

	beforeEach(() => {
		bank.requests.length = 0;
		bank.setHandler(uploadBank());
	});

	const inits = () => bank.requests.filter(r => phaseOf(r) === 'Initialisation');
	const transfers = () => bank.requests.filter(r => phaseOf(r) === 'Transfer');

	describe('A1: per-transaction key', () => {
		it('uses a fresh transaction key for every upload', async () => {
			const doc = '<Document>same</Document>';
			await client.send(OrdersH005.SDD(doc) as never);
			await client.send(OrdersH005.SDD(doc) as never);

			const [firstInit, secondInit] = inits();
			const key1 = await transactionKeyOf(client, firstInit!);
			const key2 = await transactionKeyOf(client, secondInit!);

			assert.lengthOf(key1, 16);
			assert.lengthOf(key2, 16);
			assert.notDeepEqual(key1, key2, 'two uploads must not share the transaction key');

			const [firstTransfer, secondTransfer] = transfers();
			assert.notStrictEqual(orderDataOf(firstTransfer!), orderDataOf(secondTransfer!), 'same document must encrypt differently');
		});

		it('encrypts the transfer order data with the key announced in the init', async () => {
			const doc = '<Document>\n<Line>payload</Line>\r\n</Document>';
			await client.send(OrdersH005.SDD(doc) as never);

			const key = await transactionKeyOf(client, inits()[0]!);
			const plain = decryptOrderData(orderDataOf(transfers()[0]!)!, key).toString();

			assert.strictEqual(plain, '<Document><Line>payload</Line></Document>');
		});

		it('removes transactionKey and segments from the order after the upload', async () => {
			const order = OrdersH005.SDD('<Document/>') as unknown as Record<string, unknown>;
			const result = await client.send(order as never) as ebics.EbicsUploadResponse;

			assert.strictEqual(result.businessCode, '000000');
			assert.notProperty(order, 'transactionKey');
			assert.notProperty(order, 'segments');
		});

		it('removes transactionKey and segments even when the upload fails', async () => {
			bank.setHandler(() => ({ status: 503, body: 'down' }));
			const order = OrdersH005.SDD('<Document/>') as unknown as Record<string, unknown>;

			try {
				await client.send(order as never);
				assert.fail('expected an error');
			} catch (error) {
				assert.instanceOf(error, ebics.EbicsClientError);
			}
			assert.notProperty(order, 'transactionKey');
			assert.notProperty(order, 'segments');
		});

		it('re-sending the same order object generates a new key', async () => {
			const order = OrdersH005.SDD('<Document/>');
			await client.send(order as never);
			await client.send(order as never);

			const [a, b] = inits();
			assert.notDeepEqual(await transactionKeyOf(client, a!), await transactionKeyOf(client, b!));
		});
	});

	describe('A2: concurrency / stateless serializers', () => {
		it('keeps concurrent uploads and downloads apart', async () => {
			const keys = await client.keys();
			const downloadPayload = '<Statement>camt.053</Statement>';
			let counter = 0;
			bank.setHandler((body) => {
				const phase = phaseOf(body);
				if (phase === 'Initialisation') {
					counter++;
					if (body.includes('<AdminOrderType>BTD</AdminOrderType>'))
						return { body: h005DownloadInit(`DL${counter}`, keys!.e()!, downloadPayload) };
					return { body: h005Response({ transactionId: `UP${counter}` }) };
				}
				return { body: h005Response({ transactionId: transactionIdOf(body)!, phase }) };
			});

			const docs = ['<Document>alpha</Document>', '<Document>bravo</Document>', '<Document>charlie</Document>'];
			const [up1, dl1, up2, dl2, up3] = await Promise.all([
				client.send(OrdersH005.SDD(docs[0]!) as never),
				client.send(OrdersH005.EOP({ start: '2026-01-01', end: '2026-01-02' }) as never),
				client.send(OrdersH005.SCT(docs[1]!) as never),
				client.send(OrdersH005.STM({ start: '2026-01-01', end: '2026-01-02' }) as never),
				client.send(OrdersH005.XCT(docs[2]!) as never),
			]) as [ebics.EbicsUploadResponse, ebics.EbicsDownloadResponse, ebics.EbicsUploadResponse, ebics.EbicsDownloadResponse, ebics.EbicsUploadResponse];

			for (const dl of [dl1, dl2]) {
				assert.strictEqual(dl.businessCode, '000000');
				assert.strictEqual(dl.orderData.toString(), downloadPayload);
			}
			for (const up of [up1, up2, up3]) {
				assert.strictEqual(up.phase, 'transfer');
				assert.strictEqual(up.businessCode, '000000');
			}

			// Each upload init: its own service; each follow-up: phase matches the transaction kind.
			const followUpsByTx = new Map<string, string>();
			const upTxs = [up1, up2, up3].map(u => u.transactionId!);
			const dlTxs = [dl1, dl2].map(d => d.transactionId);
			assert.strictEqual(new Set([...upTxs, ...dlTxs]).size, 5, 'five distinct transactions');

			for (const request of bank.requests.filter(r => phaseOf(r) !== 'Initialisation')) {
				const tx = transactionIdOf(request)!;
				if (tx.startsWith('UP')) {
					assert.strictEqual(phaseOf(request), 'Transfer');
					assert.include(request, '<OrderData>');
					assert.notInclude(request, 'TransferReceipt');
				} else {
					assert.strictEqual(phaseOf(request), 'Receipt');
					assert.include(request, '<ReceiptCode>0</ReceiptCode>');
					assert.notInclude(request, '<OrderData>');
				}
				followUpsByTx.set(tx, phaseOf(request)!);
			}
			assert.strictEqual(followUpsByTx.size, 5);

			// Uploads: every transfer decrypts to its own document with the key of its own init.
			const uploadInits = inits().filter(r => r.includes('<AdminOrderType>BTU</AdminOrderType>'));
			assert.lengthOf(uploadInits, 3);
			const uploadTransfers = transfers();
			assert.lengthOf(uploadTransfers, 3);
			const decryptedDocs: string[] = [];
			for (const init of uploadInits) {
				const key = await transactionKeyOf(client, init);
				const matches = uploadTransfers
					.map((t) => {
						try {
							return decryptOrderData(orderDataOf(t)!, key).toString();
						} catch {
							return undefined;
						}
					})
					.filter(d => d !== undefined && docs.includes(d));
				assert.lengthOf(matches, 1, 'exactly one transfer is encrypted with this init key');
				decryptedDocs.push(matches[0]!);
				// The service in the init matches the document it transferred.
				const service = pick(init, 'ServiceName');
				const expected = { SDD: docs[0], SCT: docs[1], XCT: docs[2] }[service as 'SDD' | 'SCT' | 'XCT'];
				assert.strictEqual(matches[0], expected, `init for ${service} transferred its own document`);
			}
			assert.sameMembers(decryptedDocs, docs);

			// Each upload transfer carries the TransactionID the bank assigned to that upload.
			for (const [i, up] of [up1, up2, up3].entries()) {
				const transfer = uploadTransfers.find(t => transactionIdOf(t) === up.transactionId);
				assert.isDefined(transfer, `transfer for upload ${i}`);
			}
		});

		it('serializer.use() returns independent builders when called concurrently', async () => {
			const upload = { ...OrdersH005.SDD('<Document>one</Document>'), phase: 'initialisation' } as Record<string, unknown>;
			const download = { ...OrdersH005.EOP({ start: '2026-01-01', end: '2026-01-02' }), phase: 'initialisation' } as Record<string, unknown>;
			const transferA = {
				...OrdersH005.SCT('<Document>A</Document>'),
				phase: 'transfer',
				transactionId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
				...prepareUploadTransaction('<Document>A</Document>'),
			} as Record<string, unknown>;
			const transferB = {
				...OrdersH005.XCT('<Document>B</Document>'),
				phase: 'transfer',
				transactionId: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
				...prepareUploadTransaction('<Document>B</Document>'),
			} as Record<string, unknown>;

			const builders = await Promise.all([
				serializer.use(upload as never, client),
				serializer.use(download as never, client),
				serializer.use(transferA as never, client),
				serializer.use(transferB as never, client),
			]) as Array<{ toXML(): string }>;

			assert.strictEqual(new Set(builders).size, 4, 'four distinct builder objects');
			const [upXml, dlXml, aXml, bXml] = builders.map(b => b.toXML()) as [string, string, string, string];

			assert.include(upXml, '<AdminOrderType>BTU</AdminOrderType>');
			assert.include(upXml, '<ServiceName>SDD</ServiceName>');
			assert.include(upXml, '<DataTransfer>');
			assert.include(upXml, '<NumSegments>1</NumSegments>');

			assert.include(dlXml, '<AdminOrderType>BTD</AdminOrderType>');
			assert.include(dlXml, '<ServiceName>EOP</ServiceName>');
			assert.notInclude(dlXml, '<DataTransfer>');
			assert.notInclude(dlXml, 'NumSegments');

			assert.strictEqual(transactionIdOf(aXml), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
			assert.strictEqual(orderDataOf(aXml), (transferA['segments'] as string[])[0]);
			assert.strictEqual(transactionIdOf(bXml), 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
			assert.strictEqual(orderDataOf(bXml), (transferB['segments'] as string[])[0]);
			assert.strictEqual(
				decryptOrderData(orderDataOf(bXml)!, transferB['transactionKey'] as Buffer).toString(),
				'<Document>B</Document>',
			);

			// Building another request afterwards does not change an earlier builder's output.
			const again = await serializer.use(download as never, client) as { toXML(): string };
			assert.notStrictEqual(again, builders[1]);
			assert.strictEqual(builders[0]!.toXML(), upXml);
			assert.strictEqual(builders[2]!.toXML(), aXml);
		});
	});

	describe('B1: upload segmentation', () => {
		const SEGMENT = 64;

		it('declares NumSegments and sends every segment in order, lastSegment only on the last', async () => {
			const segClient = await newClient(url, { segmentSize: SEGMENT });
			const doc = documentWithSegments(4, SEGMENT);

			const result = await segClient.send(OrdersH005.SDD(doc) as never) as ebics.EbicsUploadResponse;

			assert.include(result, { phase: 'transfer', businessCode: '000000', numSegments: 4, segmentNumber: 4 });
			const init = inits()[0]!;
			assert.lengthOf(inits(), 1);
			assert.strictEqual(pick(init, 'NumSegments'), '4');
			assert.isUndefined(segmentOf(init), 'the init carries no SegmentNumber');

			const sent = transfers();
			assert.lengthOf(sent, 4);
			assert.deepEqual(sent.map(t => segmentOf(t)), [
				{ number: 1, lastSegment: 'false' },
				{ number: 2, lastSegment: 'false' },
				{ number: 3, lastSegment: 'false' },
				{ number: 4, lastSegment: 'true' },
			]);
			for (const t of sent) assert.strictEqual(transactionIdOf(t), 'TX1');

			const parts = sent.map(t => orderDataOf(t)!);
			for (const part of parts.slice(0, -1)) assert.lengthOf(part, SEGMENT);
			assert.isAtMost(parts.at(-1)!.length, SEGMENT);
			assert.isAbove(parts.at(-1)!.length, 0);

			const key = await transactionKeyOf(segClient, init);
			const joined = parts.join('');
			assert.strictEqual(joined, encryptOrderData(doc, key), 'segments concatenate to the single-segment encryption');
			assert.strictEqual(decryptOrderData(joined, key).toString(), doc);
		});

		it('sends a single segment with lastSegment="true" by default', async () => {
			await client.send(OrdersH005.SDD('<Document>small</Document>') as never);

			assert.strictEqual(pick(inits()[0]!, 'NumSegments'), '1');
			assert.lengthOf(transfers(), 1);
			assert.deepEqual(segmentOf(transfers()[0]!), { number: 1, lastSegment: 'true' });
		});

		it('works the same for H004', async () => {
			const segClient = await newClient(url, { segmentSize: SEGMENT });
			const doc = documentWithSegments(3, SEGMENT);
			const h004Response = (tx: string, phase: string) => `<?xml version="1.0" encoding="UTF-8"?>
<ebicsResponse xmlns="urn:org:ebics:H004" Version="H004" Revision="1">
	<header authenticate="true"><static><TransactionID>${tx}</TransactionID></static>
		<mutable><TransactionPhase>${phase}</TransactionPhase><OrderID>N001</OrderID><ReturnCode>000000</ReturnCode><ReportText>[EBICS_OK] OK</ReportText></mutable>
	</header>
	<body><ReturnCode authenticate="true">000000</ReturnCode></body>
</ebicsResponse>`;
			bank.setHandler(body => ({ body: h004Response(transactionIdOf(body) ?? 'H4TX', phaseOf(body)!) }));

			const result = await segClient.send(OrdersH004.XCT(doc) as never) as ebics.EbicsUploadResponse;

			assert.include(result, { phase: 'transfer', businessCode: '000000', numSegments: 3, segmentNumber: 3 });
			assert.strictEqual(pick(inits()[0]!, 'NumSegments'), '3');
			assert.deepEqual(transfers().map(t => segmentOf(t)), [
				{ number: 1, lastSegment: 'false' },
				{ number: 2, lastSegment: 'false' },
				{ number: 3, lastSegment: 'true' },
			]);
			const key = await transactionKeyOf(segClient, inits()[0]!);
			assert.strictEqual(decryptOrderData(transfers().map(t => orderDataOf(t)!).join(''), key).toString(), doc);
		});

		it('stops at a rejected segment and reports it', async () => {
			const segClient = await newClient(url, { segmentSize: SEGMENT });
			bank.setHandler(uploadBank({ rejectSegment: 2 }));

			const result = await segClient.send(OrdersH005.SDD(documentWithSegments(3, SEGMENT)) as never) as ebics.EbicsUploadResponse;

			assert.include(result, { phase: 'transfer', segmentNumber: 2, numSegments: 3, businessCode: '091112', transactionId: 'TX1' });
			assert.deepEqual(transfers().map(t => segmentOf(t)?.number), [1, 2], 'segment 3 is never sent');
		});
	});

	describe('B1: segmentSize validation', () => {
		const make = (segmentSize: number) => () => new ebics.Client({
			url,
			partnerId: 'P',
			userId: 'U',
			hostId: 'H',
			passphrase: 'x',
			keyStorage: ebics.inMemoryKeysStorage(),
			segmentSize,
		});

		for (const bad of [0, 2, 3, 6, 65, 4.5, -4, MAX_SEGMENT_SIZE + 4, NaN])
			it(`rejects segmentSize ${bad}`, () => {
				assert.throws(make(bad), /segmentSize/);
			});

		for (const good of [4, 64, 1000, MAX_SEGMENT_SIZE])
			it(`accepts segmentSize ${good}`, () => {
				assert.strictEqual(make(good)().segmentSize, good);
			});

		it('defaults to 1 MiB', () => {
			assert.strictEqual(MAX_SEGMENT_SIZE, 1024 * 1024);
			assert.strictEqual(client.segmentSize, MAX_SEGMENT_SIZE);
		});
	});

	describe('XSD validity of segmented upload requests', () => {
		const TX = '0123456789ABCDEF0123456789ABCDEF';

		for (const version of ['H004', 'H005'] as const)
			it(`${version}: init with NumSegments=3 and transfers 1..3 are schema-valid`, async () => {
				const validate = xsdValidator(version);
				const xsdClient = await newClient(url);
				const doc = documentWithSegments(3, 64);
				const base = version === 'H004' ? OrdersH004.XCT(doc) : OrdersH005.SDD(doc);
				const transaction = prepareUploadTransaction(doc, 64);
				assert.lengthOf(transaction.segments, 3);

				const init = await xsdClient.signOrder({ ...base, phase: 'initialisation', ...transaction } as never);
				assert.deepEqual(await validate(init), [], 'init request');
				assert.strictEqual(pick(init, 'NumSegments'), '3');

				for (let n = 1; n <= 3; n++) {
					const xml = await xsdClient.signOrder({ ...base, phase: 'transfer', transactionId: TX, segmentNumber: n, ...transaction } as never);
					assert.deepEqual(await validate(xml), [], `transfer segment ${n}`);
					assert.deepEqual(segmentOf(xml), { number: n, lastSegment: n === 3 ? 'true' : 'false' });
					assert.strictEqual(orderDataOf(xml), transaction.segments[n - 1]);
				}
			});
	});
	describe('serializer: transaction key on the order', () => {
		const TX = '0123456789ABCDEF0123456789ABCDEF';

		for (const version of ['H004', 'H005'] as const)
			it(`${version}: building a transfer for an order without transactionKey throws`, async () => {
				const doc = '<Document>orphan</Document>';
				const base = version === 'H004' ? OrdersH004.XCT(doc) : OrdersH005.SDD(doc);
				const order = { ...base, phase: 'transfer', transactionId: TX, segmentNumber: 1 };

				try {
					await client.signOrder(order as never);
					assert.fail('expected an error');
				} catch (error) {
					assert.match((error as Error).message, /transaction key/);
				}
				assert.notProperty(order, 'transactionKey', 'no key was made up for the transfer');
				assert.lengthOf(bank.requests, 0);
			});

		it('keeps the init key non-enumerable on the order and reuses it for the transfer', async () => {
			const doc = '<Document>keyed</Document>';
			const order = { ...OrdersH005.SDD(doc), phase: 'initialisation' } as Record<string, unknown>;

			const init = await client.signOrder(order as never);

			const key = order['transactionKey'];
			assert.instanceOf(key, Buffer);
			assert.notInclude(Object.keys(order), 'transactionKey');
			assert.notInclude(Object.keys(order), 'segments');
			assert.notInclude(JSON.stringify(order), 'transactionKey');
			assert.notInclude(JSON.stringify(order), 'segments');
			assert.notProperty({ ...order }, 'transactionKey', 'spreading does not copy the key');
			assert.deepEqual(await transactionKeyOf(client, init), key, 'the init announces the key stored on the order');

			order['phase'] = 'transfer';
			order['transactionId'] = TX;
			order['segmentNumber'] = 1;
			const transfer = await client.signOrder(order as never);

			assert.strictEqual(order['transactionKey'], key, 'the transfer did not replace the key');
			assert.strictEqual(decryptOrderData(orderDataOf(transfer)!, key as Buffer).toString(), doc);
		});

		it('honours client.segmentSize in signOrder', async () => {
			const segClient = await newClient(url, { segmentSize: 64 });
			const doc = documentWithSegments(3, 64);
			const order = { ...OrdersH005.SDD(doc), phase: 'initialisation' } as Record<string, unknown>;

			const init = await segClient.signOrder(order as never);

			assert.strictEqual(pick(init, 'NumSegments'), '3');
			assert.lengthOf(order['segments'] as string[], 3);
			for (const segment of (order['segments'] as string[]).slice(0, -1)) assert.lengthOf(segment, 64);

			const defaultInit = await client.signOrder({ ...OrdersH005.SDD(doc), phase: 'initialisation' } as never);
			assert.strictEqual(pick(defaultInit, 'NumSegments'), '1', 'the default client sends the same document in one segment');
		});
	});
});
