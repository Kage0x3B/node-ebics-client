import { assert } from 'chai';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import * as ebics from '../../index.js';
import { EbicsClientError, EbicsClientErrorCode } from '../../index.js';

const { OrdersH005: Orders } = ebics;

interface ScriptedResponse {
	status?: number;
	contentType?: string;
	body: string;
}

/** Minimal H005 `ebicsResponse`; omit a field by passing `null`. */
const h005Response = ({
	transactionId = 'TX0001',
	orderId = 'A001',
	technicalCode = '000000',
	businessCode = '000000',
	namespace = 'urn:org:ebics:H005',
	root = 'ebicsResponse',
}: {
	transactionId?: string | null;
	orderId?: string | null;
	technicalCode?: string | null;
	businessCode?: string | null;
	namespace?: string;
	root?: string;
} = {}): string => `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${namespace}" Version="H005" Revision="1">
	<header authenticate="true">
		<static>${transactionId === null ? '' : `<TransactionID>${transactionId}</TransactionID>`}</static>
		<mutable>
			<TransactionPhase>Initialisation</TransactionPhase>
			${orderId === null ? '' : `<OrderID>${orderId}</OrderID>`}
			${technicalCode === null ? '' : `<ReturnCode>${technicalCode}</ReturnCode>`}
			<ReportText>[EBICS_OK] OK</ReportText>
		</mutable>
	</header>
	<body>${businessCode === null ? '' : `<ReturnCode authenticate="true">${businessCode}</ReturnCode>`}</body>
</${root}>`;

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
			res.writeHead(next.status ?? 200, { 'content-type': next.contentType ?? 'text/xml;charset=UTF-8' });
			res.end(next.body);
		});
	});

	return {
		queue,
		requests,
		/** TransactionPhase of every request received, in order. */
		phases: () => requests.map(r => /<TransactionPhase>(\w+)<\/TransactionPhase>/.exec(r)?.[1] ?? 'none'),
		listen: () => new Promise<string>((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ebics`));
		}),
		close: () => new Promise<void>(resolve => server.close(() => resolve())),
	};
}

async function expectClientError(promise: Promise<unknown>, code: string): Promise<EbicsClientError> {
	try {
		await promise;
	} catch (error) {
		assert.instanceOf(error, EbicsClientError);
		assert.strictEqual((error as EbicsClientError).code, code);
		return error as EbicsClientError;
	}
	assert.fail(`expected an EbicsClientError ${code}`);
}

describe('EBICS exchange validation', () => {
	const bank = createStubBank();
	let client: ebics.Client;

	before(async () => {
		const url = await bank.listen();
		client = new ebics.Client({
			url,
			partnerId: 'PARTNER1',
			userId: 'USER1',
			hostId: 'HOST1',
			passphrase: Buffer.alloc(32, 0),
			iv: Buffer.alloc(16, 0),
			keyStorage: ebics.inMemoryKeysStorage(),
		});
		await client.generateKeys({ subject: 'ebics.example.com' }, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
	});

	after(() => bank.close());

	beforeEach(() => {
		bank.queue.length = 0;
		bank.requests.length = 0;
	});

	const upload = () => client.send(Orders.SDD('<Document/>') as never) as Promise<ebics.EbicsUploadResponse>;
	const download = () => client.send(Orders.EOP({ start: '2026-01-01', end: '2026-01-02' }) as never) as Promise<ebics.EbicsDownloadResponse>;

	describe('transport and document checks', () => {
		it('rejects a non-200 HTTP status, keeping status and raw body', async () => {
			bank.queue.push({ status: 403, contentType: 'text/html', body: '<html><body>Forbidden</body></html>' });

			const error = await expectClientError(upload(), EbicsClientErrorCode.HTTP_STATUS);

			assert.strictEqual(error.httpStatus, 403);
			assert.strictEqual(error.phase, 'initialisation');
			assert.include(error.rawResponse, 'Forbidden');
			assert.strictEqual(bank.requests.length, 1);
		});

		it('rejects an empty body', async () => {
			bank.queue.push({ body: '' });
			await expectClientError(upload(), EbicsClientErrorCode.EMPTY_RESPONSE);
		});

		it('rejects a body that is not well-formed XML', async () => {
			bank.queue.push({ body: '<ebicsResponse><header>' });
			await expectClientError(upload(), EbicsClientErrorCode.MALFORMED_XML);
		});

		it('rejects an HTML page served with HTTP 200 (the silent BCEE failure)', async () => {
			bank.queue.push({ contentType: 'text/html', body: '<html><head><title>Maintenance</title></head><body>Please retry</body></html>' });

			const error = await expectClientError(upload(), EbicsClientErrorCode.NON_EBICS_RESPONSE);

			assert.include(error.message, '<html>');
			assert.strictEqual(bank.requests.length, 1, 'no second request after a non-EBICS answer');
		});

		it('rejects plain text with no XML root', async () => {
			bank.queue.push({ body: 'service unavailable' });
			await expectClientError(upload(), EbicsClientErrorCode.NON_EBICS_RESPONSE);
		});

		it('rejects an EBICS response of another protocol version', async () => {
			bank.queue.push({ body: h005Response({ namespace: 'urn:org:ebics:H004' }) });
			await expectClientError(upload(), EbicsClientErrorCode.VERSION_MISMATCH);
		});

		it('rejects a response without the header ReturnCode', async () => {
			bank.queue.push({ body: h005Response({ technicalCode: null }) });

			const error = await expectClientError(upload(), EbicsClientErrorCode.MISSING_RETURN_CODE);

			assert.include(error.message, 'header');
		});

		it('rejects a response without the body ReturnCode', async () => {
			bank.queue.push({ body: h005Response({ businessCode: null }) });
			await expectClientError(download(), EbicsClientErrorCode.MISSING_RETURN_CODE);
		});

		it('applies the same checks to key management (INI)', async () => {
			bank.queue.push({ body: h005Response({ root: 'ebicsKeyManagementResponse', technicalCode: null, transactionId: null }) });
			await expectClientError(client.send(Orders.INI as never), EbicsClientErrorCode.MISSING_RETURN_CODE);
		});

		it('still returns a genuine bank rejection as a result', async () => {
			bank.queue.push({ body: h005Response({ transactionId: null, businessCode: '090005' }) });

			const result = await download();

			assert.strictEqual(result.businessCode, '090005');
		});
	});

	describe('upload transaction', () => {
		it('initialises, transfers with the assigned TransactionID and reports the transfer verdict', async () => {
			bank.queue.push({ body: h005Response({ transactionId: 'TX42', orderId: 'N123' }) }, { body: h005Response({ transactionId: 'TX42', orderId: null }) });

			const result = await upload();

			assert.deepEqual(bank.phases(), ['Initialisation', 'Transfer']);
			assert.include(bank.requests[1], '<TransactionID>TX42</TransactionID>');
			assert.include(result, { transactionId: 'TX42', orderId: 'N123', phase: 'transfer', technicalCode: '000000', businessCode: '000000' });
		});

		it('throws instead of re-initialising when an accepted init carries no TransactionID', async () => {
			bank.queue.push({ body: h005Response({ transactionId: null, orderId: null }) });

			const error = await expectClientError(upload(), EbicsClientErrorCode.MISSING_TRANSACTION_ID);

			assert.strictEqual(error.phase, 'initialisation');
			assert.deepEqual(bank.phases(), ['Initialisation'], 'exactly one request — the order data was never sent');
		});

		it('reports a rejected initialisation without sending the order data', async () => {
			bank.queue.push({ body: h005Response({ transactionId: null, orderId: null, businessCode: '091005' }) });

			const result = await upload();

			assert.deepEqual(bank.phases(), ['Initialisation']);
			assert.include(result, { phase: 'initialisation', technicalCode: '000000', businessCode: '091005' });
		});

		it('rejects a transfer answer for a different transaction', async () => {
			bank.queue.push({ body: h005Response({ transactionId: 'TX42' }) }, { body: h005Response({ transactionId: 'OTHER' }) });
			await expectClientError(upload(), EbicsClientErrorCode.TRANSACTION_ID_MISMATCH);
		});
	});

	describe('download transaction', () => {
		it('throws when an accepted download carries no TransactionID', async () => {
			bank.queue.push({ body: h005Response({ transactionId: null }) });
			await expectClientError(download(), EbicsClientErrorCode.MISSING_TRANSACTION_ID);
		});
	});

	describe('serializers', () => {
		it('refuse to build a transfer without a TransactionID', async () => {
			const order = { ...(Orders.SDD('<Document/>') as object), phase: 'transfer' } as never;
			try {
				await client.signOrder(order);
			} catch (error) {
				assert.instanceOf(error, EbicsClientError);
				assert.strictEqual((error as EbicsClientError).code, EbicsClientErrorCode.MISSING_TRANSACTION_ID);
				return;
			}
			assert.fail('expected the serializer to throw');
		});
	});
});
