import http, { type Agent as HttpAgent, type IncomingMessage } from 'node:http';
import https, { type Agent as HttpsAgent } from 'node:https';
import zlib from 'node:zlib';

import constants from './consts.js';
import Keys from './keymanagers/Keys.js';
import defaultKeyEncryptor, { type KeyEncryptor } from './keymanagers/defaultKeyEncryptor.js';
import type { CertificateOptions } from './keymanagers/Key.js';
import type { FsKeysStorage } from './storages/fsKeysStorage.js';
import type { TracesStorage } from './storages/tracesStorage.js';

import signer from './middleware/signer.js';
import serializer from './middleware/serializer.js';
import response from './middleware/response.js';
import { assertEbicsResponse, assertReturnCodes } from './middleware/responseValidator.js';
import EbicsClientError, { EbicsClientErrorCode, type EbicsClientErrorDetails, type EbicsTransactionPhase } from './EbicsClientError.js';
import { MAX_SEGMENT_SIZE, assertSegmentSize, attachUploadTransaction, decryptOrderData, prepareUploadTransaction } from './orders/orderData.js';

const EBICS_OK = '000000';
const RECEIPT_CONFIRMED = new Set(['011000', EBICS_OK]);

/**
 * Technical return codes with which the bank ends a transaction on its side. This client does not
 * resume transactions (EBICS recovery), so each of them means: restart from the initialisation.
 */
const TRANSACTION_ABORTED_CODES = new Set([
	'011101', // EBICS_TX_SEGMENT_NUMBER_UNDERRUN
	'061101', // EBICS_TX_RECOVERY_SYNC
	'091101', // EBICS_TX_UNKNOWN_TXID
	'091102', // EBICS_TX_ABORT
	'091104', // EBICS_TX_SEGMENT_NUMBER_EXCEEDED
	'091105', // EBICS_RECOVERY_NOT_SUPPORTED
]);

/** Default time to wait for the bank's answer to one EBICS request. */
export const DEFAULT_TIMEOUT = 60_000;

/** Upper bound for a download whose initialisation does not announce NumSegments (10 GB at 1 MB per segment). */
const MAX_DOWNLOAD_SEGMENTS = 10_000;

/** Largest delay `setTimeout` accepts; longer ones fire immediately. */
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * Every EBICS request is one isolated HTTP exchange:
 * - no retries: a retry would replay the identical request (same Nonce, same TransactionID) — the
 *   bank either rejects it as a replay or, after a lost answer, sees a transfer for a closed transaction;
 * - no redirects: following one would change or drop the POST; a 3xx is reported as HTTP_STATUS;
 * - no keep-alive: banks and WAFs drop idle connections, and reusing such a socket fails with ECONNRESET.
 */
const isolatedAgents = {
	'http:': new http.Agent({ keepAlive: false }),
	'https:': new https.Agent({ keepAlive: false }),
};

export interface ClientOptions {
	url: string;
	partnerId: string;
	userId: string;
	hostId: string;
	passphrase: string | Buffer;
	iv?: string | Buffer;
	keyStorage: FsKeysStorage;
	tracesStorage?: TracesStorage;
	bankName?: string;
	bankShortName?: string;
	languageCode?: string;
	storageLocation?: string;
	/**
	 * HTTP(S) agent for the requests to the bank. Defaults to an agent without keep-alive, so every
	 * request opens a fresh connection. It must match the protocol of `url`.
	 */
	agent?: HttpAgent | HttpsAgent;
	/**
	 * Milliseconds to wait for the bank's complete answer to one request before failing with
	 * `EBICS_CLIENT_TIMEOUT`. Defaults to 60 000; `0` disables the timeout; at most 2^31 - 1.
	 */
	timeout?: number;
	/**
	 * Maximum size in bytes of one upload order data segment (base64-encoded). Defaults to and may
	 * not exceed 1 MB, the EBICS limit; must be a multiple of 4.
	 */
	segmentSize?: number;
}

export interface BankKeyEntry {
	pem?: string | string[];
	mod?: Buffer;
	exp?: Buffer;
}

export interface BankKeys {
	bankX002?: BankKeyEntry;
	bankE002?: BankKeyEntry;
}

export interface EbicsBaseResponse {
	transactionId?: string;
	/**
	 * The OrderID the bank assigned (uploads: taken from the last answer that carries one, so it is
	 * also found when a bank only reports it with the transfer). `''` when the bank sent none.
	 */
	orderId: string;
	/** Number of order data segments of the transaction, when it carried order data. */
	numSegments?: number;
	/**
	 * The bank aborted the transaction on its side (a recovery / transaction code such as
	 * `061101` EBICS_TX_RECOVERY_SYNC or `091102` EBICS_TX_ABORT). The transaction cannot be
	 * continued: send the order again, which starts a new transaction with a new initialisation.
	 */
	transactionAborted: boolean;
	/**
	 * The transaction step whose verdict this result reports. For an upload, `'initialisation'`
	 * means the bank rejected the order before any order data was transferred.
	 */
	phase?: EbicsTransactionPhase;
	technicalCode: string;
	technicalCodeSymbol: string;
	technicalCodeShortText: string;
	technicalCodeMeaning: string;
	businessCode: string;
	businessCodeSymbol: string;
	businessCodeShortText: string;
	businessCodeMeaning: string;
}

export interface EbicsUploadResponse extends EbicsBaseResponse {
	/**
	 * The last segment sent. When the bank rejects a transfer, this is the rejected segment and
	 * `phase` is `'transfer'`; the segments after it were not sent.
	 */
	segmentNumber?: number;
}

export interface EbicsKeyManagementResponse extends EbicsBaseResponse {
	orderData: string;
	bankKeys: BankKeys;
}

export interface EbicsDownloadResponse extends EbicsBaseResponse {
	orderData: Buffer;
	/**
	 * The ReceiptCode the client sent and the bank confirmed: `0` once the order data was read and
	 * acknowledged. Absent when no receipt was sent (rejected initialisation or transfer, no data).
	 */
	receiptCode?: 0;
	/** When the bank rejects a transfer, the segment it rejected; `phase` is then `'transfer'` and `orderData` is empty. */
	segmentNumber?: number;
}

interface OrderLike {
	version: string;
	operation: string;
	orderDetails: { OrderType?: string; AdminOrderType?: string; [k: string]: unknown };
	transactionId?: string;
	/** Set by the client for follow-up requests; serializers must not infer the phase from `transactionId`. */
	phase?: EbicsTransactionPhase;
	document?: string | Buffer;
	needsExistingKeys?: boolean;
	/** Segment of a transfer request (1-based), set by the client. */
	segmentNumber?: number;
	/** Whether a download transfer request asks for the last segment. */
	lastSegment?: boolean;
	/** Total segments of the transaction, set by the client (error context). */
	numSegments?: number;
	/** ReceiptCode of a download receipt: 0 = received fine, 1 = deliver again. */
	receiptCode?: 0 | 1;
	/** Upload only: the transaction key and encrypted segments of the transaction in progress. */
	transactionKey?: Buffer;
	segments?: string[];
	[k: string]: unknown;
}

const orderTypeOf = (order: OrderLike): string =>
	String(order.orderDetails.AdminOrderType || order.orderDetails.OrderType || 'UNKNOWN');

/** Both return codes report success — the bank accepted this step. */
const isAccepted = (res: { technicalCode(): string; businessCode(): string }): boolean =>
	res.technicalCode() === EBICS_OK && res.businessCode() === EBICS_OK;

/** Undo a content encoding a server applied although none was requested. */
const decodeBody = (data: Buffer, encoding: string | undefined): Buffer => {
	switch (encoding?.toLowerCase()) {
		case 'gzip': return zlib.gunzipSync(data);
		case 'deflate': return zlib.inflateSync(data);
		case 'br': return zlib.brotliDecompressSync(data);
		default: return data;
	}
};

/** The bank's verdict on one step, in the shape of the public result objects. */
const verdictOf = (res: any, phase: EbicsTransactionPhase): Omit<EbicsBaseResponse, 'transactionId' | 'numSegments'> => {
	const technicalCode: string = res.technicalCode();
	const businessCode: string = res.businessCode();

	return {
		orderId: res.orderId(),
		phase,

		technicalCode,
		technicalCodeSymbol: res.technicalSymbol(),
		technicalCodeShortText: res.technicalShortText(technicalCode),
		technicalCodeMeaning: res.technicalMeaning(technicalCode),

		businessCode,
		businessCodeSymbol: res.businessSymbol(businessCode),
		businessCodeShortText: res.businessShortText(businessCode),
		businessCodeMeaning: res.businessMeaning(businessCode),

		transactionAborted: TRANSACTION_ABORTED_CODES.has(technicalCode),
	};
};

/** Forget the state of an earlier transaction run with the same order object. */
const resetTransactionState = (order: OrderLike): void => {
	delete order.transactionId;
	delete order.segmentNumber;
	delete order.lastSegment;
	delete order.numSegments;
	delete order.receiptCode;
	delete order.transactionKey;
	delete order.segments;
};

const stringifyKeys = (keys: Record<string, unknown>): string => {
	Object.keys(keys).map((key) => {
		keys[key] = keys[key] === null ? null : (keys[key] as { toPems: () => string[] }).toPems();
		return key;
	});

	return JSON.stringify(keys);
};

export default class Client {
	url: string;
	partnerId: string;
	userId: string;
	hostId: string;
	keyStorage: FsKeysStorage;
	keyEncryptor: KeyEncryptor;
	tracesStorage: TracesStorage | null;
	bankName: string;
	bankShortName: string;
	languageCode: string;
	storageLocation: string | null;
	agent: HttpAgent | HttpsAgent | undefined;
	timeout: number;
	segmentSize: number;

	constructor({
		url,
		partnerId,
		userId,
		hostId,
		passphrase,
		iv,
		keyStorage,
		tracesStorage,
		bankName,
		bankShortName,
		languageCode,
		storageLocation,
		agent,
		timeout,
		segmentSize,
	}: ClientOptions) {
		if (!url) throw new Error('EBICS URL is required');
		if (!partnerId) throw new Error('partnerId is required');
		if (!userId) throw new Error('userId is required');
		if (!hostId) throw new Error('hostId is required');
		if (!passphrase) throw new Error('passphrase is required');

		if (
			!keyStorage
			|| typeof keyStorage.read !== 'function'
			|| typeof keyStorage.write !== 'function'
		)
			throw new Error('keyStorage implementation missing or wrong');

		if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0 || timeout > MAX_TIMEOUT))
			throw new Error(`timeout must be between 0 and ${MAX_TIMEOUT} milliseconds, got ${timeout}`);
		if (segmentSize !== undefined) assertSegmentSize(segmentSize);

		this.url = url;
		this.partnerId = partnerId;
		this.userId = userId;
		this.hostId = hostId;
		this.keyStorage = keyStorage;
		this.keyEncryptor = defaultKeyEncryptor({ passphrase, iv });
		this.tracesStorage = tracesStorage || null;
		this.bankName = bankName || 'Dummy Bank Full Name';
		this.bankShortName = bankShortName || 'BANKSHORTCODE';
		this.languageCode = languageCode || 'en';
		this.storageLocation = storageLocation || null;
		this.agent = agent;
		this.timeout = timeout ?? DEFAULT_TIMEOUT;
		this.segmentSize = segmentSize ?? MAX_SEGMENT_SIZE;
	}

	async send(order: OrderLike): Promise<unknown> {
		const isInObject = 'operation' in order;

		if (!isInObject) throw new Error('Operation for the order needed');

		if (order.operation.toUpperCase() === constants.orderOperations.ini)
			return this.initialization(order);

		const keys = await this.keys();
		if (keys === null)
			throw new Error(
				'No keys provided. Can not send the order or any other order for that matter.',
			);

		if (order.operation.toUpperCase() === constants.orderOperations.upload)
			return this.upload(order);
		if (
			order.operation.toUpperCase() === constants.orderOperations.download
		)
			return this.download(order);

		throw new Error('Wrong order operation provided');
	}

	async initialization(order: OrderLike): Promise<EbicsKeyManagementResponse> {
		const keys = await this.keys();
		const { needsExistingKeys } = order;
		if (keys === null) {
			if (needsExistingKeys) throw new Error('No keys provided. Can not send the order or any other order for that matter.');
			await this._generateKeys();
		}

		if (this.tracesStorage) this.tracesStorage.new().ofType('ORDER.INI');
		order.phase = 'initialisation';
		const res = await this.ebicsRequest(order);
		const xml: Buffer = res.orderData();

		return {
			...verdictOf(res, 'initialisation'),
			orderData: xml.toString(),
			numSegments: res.numSegments() || (xml.length ? 1 : undefined),
			bankKeys: res.bankKeys(),
		};
	}

	async download(order: OrderLike): Promise<EbicsDownloadResponse> {
		if (this.tracesStorage)
			this.tracesStorage.new().ofType('ORDER.DOWNLOAD');
		resetTransactionState(order);
		order.phase = 'initialisation';
		const res = await this.ebicsRequest(order);

		const transactionId: string = res.transactionId();
		if (!isAccepted(res))
			return { ...verdictOf(res, 'initialisation'), orderData: res.orderData(), transactionId };

		// An accepted download always opens a transaction; without its ID no receipt can be sent.
		if (!transactionId) throw this.missingTransactionId(order, res);
		order.transactionId = transactionId;

		const numSegments: number = res.numSegments();
		order.numSegments = numSegments || undefined;
		const result = { ...verdictOf(res, 'initialisation'), transactionId };

		// An answer without any segment information and without order data opens nothing to acknowledge.
		if (!res.isSegmented() && !res.orderDataSegment())
			return { ...result, numSegments: undefined, orderData: res.orderData() };

		let segments: string[];
		try {
			const collected = await this.downloadSegments(order, res, transactionId, numSegments);

			// The bank rejected a segment. The transaction is left unacknowledged, so the order data
			// stays available for a later download.
			if (!Array.isArray(collected))
				return {
					...verdictOf(collected.response, 'transfer'),
					orderId: collected.response.orderId() || result.orderId,
					orderData: Buffer.alloc(0),
					transactionId,
					numSegments: numSegments || undefined,
					segmentNumber: collected.segmentNumber,
				};

			segments = collected;
		} catch (error) {
			// Order data whose segments do not add up is unusable: ask the bank to deliver it again.
			if (error instanceof EbicsClientError && error.code === EbicsClientErrorCode.SEGMENT_MISMATCH)
				error.redeliveryRequested = await this.requestRedelivery(order, transactionId);
			throw error;
		}

		// Only confirm receipt of order data that could actually be read: a positive receipt marks
		// the data as delivered, and the bank will not deliver it again.
		let orderData: Buffer;
		try {
			orderData = decryptOrderData(segments, res.transactionKey());
		} catch (error) {
			const redeliveryRequested = await this.requestRedelivery(order, transactionId);

			throw new EbicsClientError(
				EbicsClientErrorCode.ORDER_DATA_UNREADABLE,
				`Downloaded order data could not be decrypted or decompressed (${(error as Error)?.message ?? error}); ${redeliveryRequested
					? 'the bank was asked to deliver it again'
					: 'ReceiptCode 1 could not be sent, the transaction stays open until the bank times it out'}`,
				{ ...this.errorContext(order), phase: 'transfer', segmentNumber: undefined, transactionId, redeliveryRequested, cause: error },
			);
		}

		try {
			await this.sendReceipt(order, transactionId, 0);
		} catch (error) {
			// The bank may have processed the receipt and will then not deliver the data again: hand
			// the data to the caller together with the error instead of dropping it.
			throw new EbicsClientError(
				EbicsClientErrorCode.RECEIPT_FAILED,
				`Order data was downloaded, but the receipt was not confirmed: ${(error as Error)?.message ?? error}`,
				{
					...this.errorContext(order),
					phase: 'receipt',
					transactionId,
					technicalCode: (error as EbicsClientError)?.technicalCode,
					businessCode: (error as EbicsClientError)?.businessCode,
					rawResponse: (error as EbicsClientError)?.rawResponse,
					requestSent: (error as EbicsClientError)?.requestSent,
					orderData,
					cause: error,
				},
			);
		}

		return { ...result, numSegments: segments.length, orderData, receiptCode: 0 };
	}

	/**
	 * Collect the encrypted order data segments of a download, starting with the one in the
	 * initialisation answer. Returns the bank's answer instead when it rejects a transfer.
	 */
	private async downloadSegments(
		order: OrderLike,
		init: any,
		transactionId: string,
		numSegments: number,
	): Promise<string[] | { response: any; segmentNumber: number }> {
		const segments: string[] = [init.orderDataSegment()];
		let lastSegment: boolean = !init.isSegmented() || init.isLastSegment();
		this.assertSegmentNumber(order, init, 1);

		while (!lastSegment) {
			const segmentNumber = segments.length + 1;
			if (segmentNumber > (numSegments || MAX_DOWNLOAD_SEGMENTS))
				throw this.segmentMismatch(order, init, `Bank announced ${numSegments || 'no'} segment(s) but keeps sending more`, segmentNumber);

			if (this.tracesStorage)
				this.tracesStorage.connect().ofType('TRANSFER.ORDER.DOWNLOAD');
			order.phase = 'transfer';
			order.segmentNumber = segmentNumber;
			order.lastSegment = numSegments > 0 && segmentNumber === numSegments;
			const transfer = await this.ebicsRequest(order);
			this.assertSameTransaction(order, transfer, transactionId);

			if (!isAccepted(transfer)) return { response: transfer, segmentNumber };

			this.assertSegmentNumber(order, transfer, segmentNumber);
			segments.push(transfer.orderDataSegment());
			lastSegment = transfer.isLastSegment();
		}

		if (numSegments && segments.length !== numSegments)
			throw this.segmentMismatch(order, init, `Bank announced ${numSegments} segment(s) but delivered ${segments.length}`, segments.length);

		return segments;
	}

	async upload(order: OrderLike): Promise<EbicsUploadResponse & { 0: string; 1: string; [Symbol.iterator](): Generator<string> }> {
		if (this.tracesStorage) this.tracesStorage.new().ofType('ORDER.UPLOAD');
		resetTransactionState(order);
		// A fresh transaction key for every upload: EBICS encrypts with a fixed zero IV, so a reused
		// key would encrypt equal leading bytes of two orders to equal ciphertext.
		attachUploadTransaction(order, prepareUploadTransaction(order.document, this.segmentSize));
		const numSegments = order.segments!.length;
		order.numSegments = numSegments;

		try {
			order.phase = 'initialisation';
			let res = await this.ebicsRequest(order);
			const transactionId: string = res.transactionId();
			let orderId: string = res.orderId();
			let phase: EbicsTransactionPhase = 'initialisation';
			let segmentNumber: number | undefined;

			if (isAccepted(res)) {
				// Without a TransactionID the order data cannot be transferred — the bank would never
				// see the order, however "successful" the initialisation looked.
				if (!transactionId) throw this.missingTransactionId(order, res);

				order.transactionId = transactionId;
				order.phase = 'transfer';
				phase = 'transfer';

				for (segmentNumber = 1; segmentNumber <= numSegments; segmentNumber++) {
					order.segmentNumber = segmentNumber;
					if (this.tracesStorage)
						this.tracesStorage.connect().ofType('TRANSFER.ORDER.UPLOAD');
					res = await this.ebicsRequest(order);
					this.assertSameTransaction(order, res, transactionId);
					orderId = res.orderId() || orderId;

					// The bank rejected this segment — report its verdict, send nothing more.
					if (!isAccepted(res)) break;
				}
				segmentNumber = Math.min(segmentNumber, numSegments);
			}
			// else: the bank rejected the initialisation — report that verdict, transfer nothing.

			return {
				...verdictOf(res, phase),
				transactionId: transactionId || undefined,
				orderId,
				numSegments,
				segmentNumber,

				// for backwards compatibility with the earlier return value [transactionId, orderId]:
				0: transactionId,
				1: orderId,
				[Symbol.iterator]: function* iterator() {
					yield transactionId;
					yield orderId;
				},
			};
		} finally {
			// The key has served its one transaction; do not keep it around on the caller's object.
			delete order.transactionKey;
			delete order.segments;
		}
	}

	produceOrderXml(order: OrderLike): Promise<string> {
		return Promise.resolve(serializer.use(order, this)).then(serializedOrder => (serializedOrder as { toXML: () => string }).toXML());
	}

	async ebicsRequest(order: OrderLike): Promise<any> {
		const { version } = order;
		const keys = await this.keys();
		const unsignedXml = await this.produceOrderXml(order);
		const signedXml = signer
			.version(version)
			.sign(unsignedXml, keys!.x()!);

		if (this.tracesStorage)
			this.tracesStorage
				.label(`REQUEST.${orderTypeOf(order)}`)
				.data(signedXml)
				.persist();

		const { res, data } = await this.post(signedXml, order);
		const raw = {
			body: data ? data.toString('utf-8') : '',
			httpStatus: res?.statusCode,
			contentType: res?.headers?.['content-type'],
		};
		const context = this.errorContext(order);

		// Persist the RAW body (not a re-serialisation) before validating it, so a
		// rejected response — an HTML error page, an empty body — is still on record.
		if (this.tracesStorage)
			this.tracesStorage
				.label(`RESPONSE.${orderTypeOf(order)}`)
				.connect()
				.data(raw.body || `<!-- empty response body (HTTP ${raw.httpStatus ?? 'unknown'}) -->`)
				.persist();

		assertEbicsResponse(version, raw, context);
		const ebicsResponse = response.version(version)(raw.body, keys!);
		assertReturnCodes(
			{ technicalCode: ebicsResponse.technicalCode(), businessCode: ebicsResponse.businessCode() },
			raw,
			context,
		);

		return ebicsResponse;
	}

	/** One HTTP POST to the bank, bounded by {@link timeout}. */
	private post(body: string, order: OrderLike): Promise<{ res: { statusCode?: number; headers?: { 'content-type'?: string } }; data: Buffer }> {
		return new Promise((resolve, reject) => {
			const url = new URL(this.url);
			const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : undefined;
			if (!transport) {
				reject(new Error(`Unsupported protocol ${url.protocol} in EBICS URL`));
				return;
			}

			let timer: NodeJS.Timeout | undefined;
			let settled = false;
			const settle = (outcome: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				outcome();
			};

			const req = transport.request(url, {
				method: 'POST',
				agent: this.agent ?? isolatedAgents[url.protocol as keyof typeof isolatedAgents],
				headers: {
					'content-type': 'text/xml;charset=UTF-8',
					'content-length': Buffer.byteLength(body),
				},
			}, (res: IncomingMessage) => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk));
				res.on('error', error => settle(() => reject(error)));
				res.on('close', () => {
					if (!res.complete) settle(() => reject(new Error('Connection closed before the response was complete')));
				});
				res.on('end', () => settle(() => {
					try {
						resolve({
							res: { statusCode: res.statusCode, headers: { 'content-type': res.headers['content-type'] } },
							data: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']),
						});
					} catch (error) {
						reject(error as Error);
					}
				}));
			});

			req.on('error', error => settle(() => reject(error)));

			if (this.timeout > 0)
				timer = setTimeout(() => settle(() => {
					// `writableFinished`: the whole body was handed to the operating system.
					const requestSent = req.writableFinished;
					req.destroy();

					const outcome = requestSent && order.phase !== 'initialisation'
						? 'the request was sent completely, so the bank may have processed it — the outcome is unknown'
						: requestSent ? 'the request was sent completely' : 'the request was not sent completely';
					reject(new EbicsClientError(
						EbicsClientErrorCode.TIMEOUT,
						`No answer from the bank within ${this.timeout} ms; ${outcome}`,
						{ ...this.errorContext(order), transactionId: order.transactionId, requestSent },
					));
				}), this.timeout);

			req.end(body);
		});
	}

	/** Where in the transaction a request sits, for error reports. */
	private errorContext(order: OrderLike): Pick<EbicsClientErrorDetails, 'phase' | 'orderType' | 'segmentNumber' | 'numSegments'> {
		return {
			phase: order.phase,
			orderType: orderTypeOf(order),
			segmentNumber: order.phase === 'transfer' ? order.segmentNumber : undefined,
			numSegments: order.numSegments,
		};
	}

	/** Acknowledge a download: ReceiptCode 0 confirms receipt, 1 asks the bank to deliver the data again. */
	private async sendReceipt(order: OrderLike, transactionId: string, receiptCode: 0 | 1): Promise<void> {
		if (this.tracesStorage)
			this.tracesStorage.connect().ofType('RECEIPT.ORDER.DOWNLOAD');

		order.phase = 'receipt';
		order.receiptCode = receiptCode;
		const receipt = await this.ebicsRequest(order);
		this.assertSameTransaction(order, receipt, transactionId);

		// A confirmed receipt is answered with 011000 EBICS_DOWNLOAD_POSTPROCESS_DONE (some banks send 000000).
		if (receiptCode === 0 && (!RECEIPT_CONFIRMED.has(receipt.technicalCode()) || receipt.businessCode() !== EBICS_OK))
			throw new EbicsClientError(EbicsClientErrorCode.RECEIPT_FAILED, 'Bank did not confirm the receipt', {
				...this.errorContext(order),
				technicalCode: receipt.technicalCode(),
				businessCode: receipt.businessCode(),
				transactionId,
				rawResponse: receipt.toXML(),
			});
	}

	/** Best effort: answer ReceiptCode 1 so the bank delivers the order data again. Whether it went through. */
	private async requestRedelivery(order: OrderLike, transactionId: string): Promise<boolean> {
		try {
			await this.sendReceipt(order, transactionId, 1);
			return true;
		} catch {
			return false;
		}
	}

	/** A segment answer that names its number must name the segment requested. */
	private assertSegmentNumber(order: OrderLike, res: any, expected: number): void {
		const returned: number = res.segmentNumber();
		if (!returned || returned === expected) return;

		throw this.segmentMismatch(order, res, `Expected segment ${expected}, response carries segment ${returned}`, expected);
	}

	private segmentMismatch(order: OrderLike, res: any, message: string, segmentNumber: number): EbicsClientError {
		return new EbicsClientError(EbicsClientErrorCode.SEGMENT_MISMATCH, message, {
			...this.errorContext(order),
			segmentNumber,
			technicalCode: res.technicalCode(),
			businessCode: res.businessCode(),
			transactionId: order.transactionId,
			rawResponse: res.toXML(),
		});
	}

	private missingTransactionId(order: OrderLike, res: any): EbicsClientError {
		return new EbicsClientError(
			EbicsClientErrorCode.MISSING_TRANSACTION_ID,
			'Bank accepted the initialisation but assigned no TransactionID',
			{
				phase: 'initialisation',
				orderType: orderTypeOf(order),
				technicalCode: res.technicalCode(),
				businessCode: res.businessCode(),
				rawResponse: res.toXML(),
			},
		);
	}

	/** A follow-up response that names a TransactionID must name the one in progress. */
	private assertSameTransaction(order: OrderLike, res: any, transactionId: string): void {
		const returned: string = res.transactionId();
		if (!returned || returned === transactionId) return;

		throw new EbicsClientError(
			EbicsClientErrorCode.TRANSACTION_ID_MISMATCH,
			`Expected TransactionID ${transactionId}, response names ${returned}`,
			{
				...this.errorContext(order),
				technicalCode: res.technicalCode(),
				businessCode: res.businessCode(),
				transactionId,
				rawResponse: res.toXML(),
			},
		);
	}

	async signOrder(order: OrderLike): Promise<string> {
		const { version } = order;
		const keys = await this.keys();
		return signer
			.version(version)
			.sign(((await serializer.use(order, this)) as { toXML: () => string }).toXML(), keys!.x()!);
	}

	async keys(): Promise<Keys | null> {
		try {
			const keysString = await this._readKeys();
			return new Keys(JSON.parse(this.keyEncryptor.decrypt(keysString)));
		} catch {
			return null;
		}
	}

	async generateKeys(certificateOptions?: CertificateOptions, whichKeys?: Array<'A006' | 'E002' | 'X002' | 'bankE002' | 'bankX002'>): Promise<Keys | null> {
		const keysObject = Keys.generate(certificateOptions, whichKeys);
		await this._writeKeys(keysObject);

		return this.keys();
	}

	async _generateKeys(): Promise<void> {
		await this.generateKeys();
	}

	async setKeys(keys: Partial<Record<'A006' | 'E002' | 'X002' | 'bankE002' | 'bankX002', unknown>>): Promise<void> {
		let keysObject = await this.keys();
		if (!keysObject) keysObject = new Keys({});
		keysObject.setKeys(keys as never);
		await this._writeKeys(keysObject);
	}

	async setBankKeys(bankKeys: BankKeys): Promise<void> {
		await this.setKeys(bankKeys);
	}

	_readKeys(): Promise<string> {
		return this.keyStorage.read();
	}

	_writeKeys(keysObject: Keys): Promise<void> {
		return this.keyStorage.write(
			this.keyEncryptor.encrypt(stringifyKeys(keysObject.keys as unknown as Record<string, unknown>)),
		);
	}
}
