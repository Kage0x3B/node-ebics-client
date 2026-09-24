import { assert } from 'chai';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import zlib from 'node:zlib';

import * as ebics from '../../index.js';
import { EbicsClientError, EbicsClientErrorCode } from '../../index.js';

const { OrdersH005: Orders } = ebics;

/** What the stub does with one request: answer it, redirect it, hang, or drop the connection. */
type Action =
	| { kind: 'respond'; status?: number; headers?: Record<string, string>; body: string | Buffer; delay?: number }
	| { kind: 'truncate'; body: string }
	| { kind: 'hang' }
	| { kind: 'reset' };

interface ReceivedRequest {
	method: string;
	url: string;
	headers: http.IncomingHttpHeaders;
	body: string;
	socket: Socket;
}

/** Minimal H005 `ebicsResponse` with OK return codes. */
const h005Response = ({ transactionId = 'TX0001', orderId = 'A001' }: { transactionId?: string; orderId?: string | null } = {}): string => `<?xml version="1.0" encoding="UTF-8"?>
<ebicsResponse xmlns="urn:org:ebics:H005" Version="H005" Revision="1">
	<header authenticate="true">
		<static><TransactionID>${transactionId}</TransactionID></static>
		<mutable>
			<TransactionPhase>Initialisation</TransactionPhase>
			${orderId === null ? '' : `<OrderID>${orderId}</OrderID>`}
			<ReturnCode>000000</ReturnCode>
			<ReportText>[EBICS_OK] OK</ReportText>
		</mutable>
	</header>
	<body><ReturnCode authenticate="true">000000</ReturnCode></body>
</ebicsResponse>`;

const ok = (body = h005Response()): Action => ({ kind: 'respond', body });

/** Scripted HTTP server: runs the next queued action per request, records requests and TCP connections. */
function createStubServer() {
	const queue: Action[] = [];
	const requests: ReceivedRequest[] = [];
	const connections: Socket[] = [];
	const server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (chunk) => { body += chunk; });
		req.on('end', () => {
			requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body, socket: req.socket });
			const next = queue.shift() ?? { kind: 'respond', status: 500, body: 'stub server: no response scripted' };

			if (next.kind === 'hang') return;
			if (next.kind === 'reset') {
				req.socket.destroy();
				return;
			}
			if (next.kind === 'truncate') {
				// Announce the full body, send half of it, then drop the connection.
				const full = Buffer.from(next.body);
				res.writeHead(200, { 'content-type': 'text/xml;charset=UTF-8', 'content-length': full.length });
				res.write(full.subarray(0, Math.floor(full.length / 2)), () => setTimeout(() => req.socket.destroy(), 20));
				return;
			}
			const answer = () => {
				res.writeHead(next.status ?? 200, { 'content-type': 'text/xml;charset=UTF-8', ...next.headers });
				res.end(next.body);
			};
			if (next.delay) setTimeout(answer, next.delay);
			else answer();
		});
	});
	server.on('connection', socket => connections.push(socket));

	return {
		queue,
		requests,
		connections,
		/** TransactionPhase of every POST received, in order. */
		phases: () => requests.map(r => /<TransactionPhase>(\w+)<\/TransactionPhase>/.exec(r.body)?.[1] ?? 'none'),
		reset: () => {
			queue.length = 0;
			requests.length = 0;
			connections.length = 0;
			server.closeAllConnections();
		},
		port: () => (server.address() as AddressInfo).port,
		listen: () => new Promise<string>((resolve) => {
			server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/ebics`));
		}),
		close: () => new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		}),
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

async function expectError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error) {
		return error as Error;
	}
	assert.fail('expected an error');
}

describe('HTTP transport', () => {
	const server = createStubServer();
	const keyStorage = ebics.inMemoryKeysStorage();
	let url: string;

	const makeClient = (options: Partial<ConstructorParameters<typeof ebics.Client>[0]> = {}) => new ebics.Client({
		url,
		partnerId: 'PARTNER1',
		userId: 'USER1',
		hostId: 'HOST1',
		passphrase: Buffer.alloc(32, 0),
		iv: Buffer.alloc(16, 0),
		keyStorage,
		...options,
	});

	const upload = (client: ebics.Client, document = '<Document/>') =>
		client.send(Orders.SDD(document) as never) as Promise<ebics.EbicsUploadResponse>;

	before(async () => {
		url = await server.listen();
		await makeClient().generateKeys({ subject: 'ebics.example.com' }, ['A006', 'E002', 'X002', 'bankE002', 'bankX002']);
	});

	after(() => server.close());

	beforeEach(() => server.reset());

	describe('no retries, no redirects', () => {
		it('does not retry an HTTP 503 and reports EBICS_CLIENT_HTTP_STATUS', async () => {
			server.queue.push({ kind: 'respond', status: 503, headers: { 'content-type': 'text/plain' }, body: 'unavailable' }, ok());

			const error = await expectClientError(upload(makeClient()), EbicsClientErrorCode.HTTP_STATUS);

			assert.strictEqual(error.httpStatus, 503);
			assert.strictEqual(error.phase, 'initialisation');
			assert.strictEqual(server.requests.length, 1, 'exactly one request — no retry');
		});

		it('does not follow a 302 redirect (no GET arrives) and reports the 302', async () => {
			server.queue.push(
				{ kind: 'respond', status: 302, headers: { location: '/elsewhere', 'content-type': 'text/html' }, body: '<html>moved</html>' },
				ok(),
			);

			const error = await expectClientError(upload(makeClient()), EbicsClientErrorCode.HTTP_STATUS);

			assert.strictEqual(error.httpStatus, 302);
			assert.strictEqual(server.requests.length, 1);
			assert.strictEqual(server.requests[0]!.method, 'POST');
			assert.isFalse(server.requests.some(r => r.method === 'GET'), 'the redirect was not followed');
		});

		it('surfaces a connection reset once, without retrying', async () => {
			server.queue.push({ kind: 'reset' }, ok());

			const error = await expectError(upload(makeClient()));

			assert.instanceOf(error, Error);
			assert.match(`${(error as NodeJS.ErrnoException).code} ${error.message}`, /ECONNRESET|socket hang up/);
			assert.strictEqual(server.requests.length, 1, 'exactly one request — no retry');
		});
	});

	describe('timeout', () => {
		it('fails with EBICS_CLIENT_TIMEOUT when the bank never answers the initialisation', async () => {
			server.queue.push({ kind: 'hang' });
			const started = Date.now();

			const error = await expectClientError(upload(makeClient({ timeout: 100 })), EbicsClientErrorCode.TIMEOUT);

			const elapsed = Date.now() - started;
			assert.isAtLeast(elapsed, 90);
			assert.isBelow(elapsed, 2000);
			assert.strictEqual(error.phase, 'initialisation');
			assert.isTrue(error.requestSent);
			assert.isUndefined(error.segmentNumber);
			assert.strictEqual(server.requests.length, 1);
		});

		it('reports phase transfer and the segment number when a transfer times out', async () => {
			// Incompressible order data in 64-byte segments -> many segments; segment 2 hangs.
			const document = `<Document>${randomBytes(300).toString('base64')}</Document>`;
			server.queue.push(ok(h005Response({ transactionId: 'TX42', orderId: 'N1' })), ok(h005Response({ transactionId: 'TX42', orderId: null })), { kind: 'hang' });

			const error = await expectClientError(
				upload(makeClient({ timeout: 100, segmentSize: 64 }), document),
				EbicsClientErrorCode.TIMEOUT,
			);

			assert.strictEqual(error.phase, 'transfer');
			assert.strictEqual(error.segmentNumber, 2);
			assert.isAbove(error.numSegments ?? 0, 2);
			assert.strictEqual(error.transactionId, 'TX42');
			assert.isTrue(error.requestSent);
			assert.include(error.message, 'outcome is unknown');
			assert.deepEqual(server.phases(), ['Initialisation', 'Transfer', 'Transfer']);
		});

		it('timeout 0 disables the timeout', async () => {
			server.queue.push({ ...ok(h005Response({ transactionId: 'TX42' })), delay: 150 } as Action, ok(h005Response({ transactionId: 'TX42', orderId: null })));

			const result = await upload(makeClient({ timeout: 0 }));

			assert.include(result, { phase: 'transfer', technicalCode: '000000', businessCode: '000000' });
		});

		it('a slow answer within the timeout succeeds', async () => {
			server.queue.push({ ...ok(h005Response({ transactionId: 'TX42' })), delay: 50 } as Action, ok(h005Response({ transactionId: 'TX42', orderId: null })));

			const result = await upload(makeClient({ timeout: 1000 }));

			assert.include(result, { phase: 'transfer', businessCode: '000000' });
		});

		it('defaults to 60 seconds', () => {
			assert.strictEqual(makeClient().timeout, 60_000);
		});

		it('accepts the maximum timeout 2^31 - 1', () => {
			assert.strictEqual(makeClient({ timeout: 2 ** 31 - 1 }).timeout, 2 ** 31 - 1);
		});

		for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 2 ** 32])
			it(`rejects timeout ${bad} in the constructor`, () => {
				assert.throws(() => makeClient({ timeout: bad }), /timeout/);
			});
	});

	describe('connections', () => {
		it('opens a fresh connection per request and asks the server to close it', async () => {
			server.queue.push(ok(h005Response({ transactionId: 'TX42' })), ok(h005Response({ transactionId: 'TX42', orderId: null })));

			await upload(makeClient());

			assert.strictEqual(server.requests.length, 2);
			assert.strictEqual(server.connections.length, 2, 'two requests, two TCP connections');
			assert.notStrictEqual(server.requests[0]!.socket, server.requests[1]!.socket);
			for (const r of server.requests)
				assert.strictEqual(r.headers.connection, 'close');
		});

		it('uses a custom agent when given', async () => {
			let created = 0;
			class CountingAgent extends http.Agent {
				override createConnection(...args: Parameters<http.Agent['createConnection']>) {
					created++;
					return (http.Agent.prototype as any).createConnection.apply(this, args);
				}
			}
			const agent = new CountingAgent({ keepAlive: true });
			server.queue.push(ok(h005Response({ transactionId: 'TX42' })), ok(h005Response({ transactionId: 'TX42', orderId: null })));

			try {
				await upload(makeClient({ agent }));
			} finally {
				agent.destroy();
			}

			assert.strictEqual(server.requests.length, 2);
			assert.isAbove(created, 0, 'the custom agent opened the connection');
			assert.strictEqual(server.connections.length, 1, 'the keep-alive agent reused its connection');
			assert.strictEqual(server.requests[0]!.headers.connection, 'keep-alive');
		});
	});
	describe('agents', () => {
		/** Agent-base-like proxy agent: every connection goes to the stub, whatever host the URL names. */
		class ProxyAgent extends http.Agent {
			created = 0;
			constructor(private readonly port: number) {
				super({ keepAlive: false });
			}

			override createConnection(): Socket {
				this.created++;
				return net.connect({ host: '127.0.0.1', port: this.port });
			}
		}

		it('rejects an http.Agent for an https:// URL instead of using another agent', async () => {
			const agent = new ProxyAgent(server.port());
			const client = makeClient({ url: `https://127.0.0.1:${server.port()}/ebics`, agent });
			server.queue.push(ok());

			const error = await expectError(upload(client));

			assert.instanceOf(error, Error);
			assert.match(`${(error as NodeJS.ErrnoException).code} ${error.message}`, /protocol/i);
			assert.strictEqual(agent.created, 0, 'the mismatched agent opened no connection');
			assert.strictEqual(server.connections.length, 0, 'no connection reached the server');
			assert.strictEqual(server.requests.length, 0);
		});

		it('rejects an https.Agent for an http:// URL instead of using another agent', async () => {
			let created = 0;
			class CountingHttpsAgent extends https.Agent {
				override createConnection(...args: Parameters<https.Agent['createConnection']>) {
					created++;
					return (https.Agent.prototype as any).createConnection.apply(this, args);
				}
			}
			const agent = new CountingHttpsAgent();
			server.queue.push(ok());

			try {
				const error = await expectError(upload(makeClient({ agent })));

				assert.instanceOf(error, Error);
				assert.match(`${(error as NodeJS.ErrnoException).code} ${error.message}`, /protocol/i);
			} finally {
				agent.destroy();
			}
			assert.strictEqual(created, 0, 'the mismatched agent opened no connection');
			assert.strictEqual(server.connections.length, 0, 'no connection reached the server');
			assert.strictEqual(server.requests.length, 0);
		});

		it('routes through a proxy agent that overrides createConnection', async () => {
			const agent = new ProxyAgent(server.port());
			// The URL's host does not resolve: only the agent can reach the stub.
			const client = makeClient({ url: 'http://bank.invalid:1/ebics', agent });
			server.queue.push(ok(h005Response({ transactionId: 'TX42' })), ok(h005Response({ transactionId: 'TX42', orderId: null })));

			const result = await upload(client);

			assert.include(result, { phase: 'transfer', businessCode: '000000' });
			assert.strictEqual(agent.created, 2, 'one connection per request, both through the proxy agent');
			assert.strictEqual(server.requests.length, 2);
			for (const r of server.requests) {
				assert.strictEqual(r.url, '/ebics');
				assert.strictEqual(r.headers.host, 'bank.invalid:1');
			}
		});
	});

	describe('response body', () => {
		it('decodes a gzip-encoded response body', async () => {
			server.queue.push(
				{ kind: 'respond', headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(h005Response({ transactionId: 'TXGZ' })) },
				{ kind: 'respond', headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(h005Response({ transactionId: 'TXGZ', orderId: null })) },
			);

			const result = await upload(makeClient());

			assert.include(result, { phase: 'transfer', technicalCode: '000000', businessCode: '000000', transactionId: 'TXGZ' });
			assert.strictEqual(server.requests.length, 2);
		});

		it('rejects once, without retrying, when the connection is destroyed mid-body', async () => {
			server.queue.push({ kind: 'truncate', body: h005Response({ transactionId: 'TX42' }) }, ok(), ok());
			const client = makeClient();
			let settled = 0;

			const error = await expectError(upload(client).finally(() => { settled++; }));
			// Give late socket events a chance to surface a second outcome or request.
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.instanceOf(error, Error);
			assert.notInstanceOf(error, EbicsClientError, 'a transport error, not a parse or timeout error');
			assert.match(`${(error as NodeJS.ErrnoException).code} ${error.message}`, /aborted|ECONNRESET|socket hang up|closed before/i);
			assert.strictEqual(settled, 1);
			assert.strictEqual(server.requests.length, 1, 'exactly one request — no retry');
		});
	});
});
