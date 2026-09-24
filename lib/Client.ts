import rock from 'rock-req';
import type { Agent as HttpAgent } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';

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
import EbicsClientError, { EbicsClientErrorCode, type EbicsTransactionPhase } from './EbicsClientError.js';

const EBICS_OK = '000000';

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
	agent?: HttpAgent | HttpsAgent;
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
	orderId: string;
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

export type EbicsUploadResponse = EbicsBaseResponse;

export interface EbicsKeyManagementResponse extends EbicsBaseResponse {
	orderData: string;
	bankKeys: BankKeys;
}

export interface EbicsDownloadResponse extends EbicsBaseResponse {
	orderData: Buffer;
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
	[k: string]: unknown;
}

const orderTypeOf = (order: OrderLike): string =>
	String(order.orderDetails.AdminOrderType || order.orderDetails.OrderType || 'UNKNOWN');

/** Both return codes report success — the bank accepted this step. */
const isAccepted = (res: { technicalCode(): string; businessCode(): string }): boolean =>
	res.technicalCode() === EBICS_OK && res.businessCode() === EBICS_OK;

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
		const xml = res.orderData();

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			orderData: xml.length ? xml.toString() : xml,
			orderId: res.orderId(),
			phase: 'initialisation',

			technicalCode: returnedTechnicalCode,
			technicalCodeSymbol: res.technicalSymbol(),
			technicalCodeShortText: res.technicalShortText(
				returnedTechnicalCode,
			),
			technicalCodeMeaning: res.technicalMeaning(returnedTechnicalCode),

			businessCode: returnedBusinessCode,
			businessCodeSymbol: res.businessSymbol(returnedBusinessCode),
			businessCodeShortText: res.businessShortText(returnedBusinessCode),
			businessCodeMeaning: res.businessMeaning(returnedBusinessCode),

			bankKeys: res.bankKeys(),
		};
	}

	async download(order: OrderLike): Promise<EbicsDownloadResponse> {
		if (this.tracesStorage)
			this.tracesStorage.new().ofType('ORDER.DOWNLOAD');
		order.phase = 'initialisation';
		const res = await this.ebicsRequest(order);

		const transactionId: string = res.transactionId();
		// An accepted download always opens a transaction; without its ID no receipt can be sent.
		if (isAccepted(res) && !transactionId)
			throw this.missingTransactionId(order, res);

		order.transactionId = transactionId;

		if (res.isSegmented() && res.isLastSegment()) {
			if (this.tracesStorage)
				this.tracesStorage.connect().ofType('RECEIPT.ORDER.DOWNLOAD');

			order.phase = 'receipt';
			const receipt = await this.ebicsRequest(order);
			this.assertSameTransaction(order, receipt, transactionId);
		}

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			orderData: res.orderData(),
			transactionId,
			orderId: res.orderId(),
			phase: 'initialisation',

			technicalCode: returnedTechnicalCode,
			technicalCodeSymbol: res.technicalSymbol(),
			technicalCodeShortText: res.technicalShortText(
				returnedTechnicalCode,
			),
			technicalCodeMeaning: res.technicalMeaning(returnedTechnicalCode),

			businessCode: returnedBusinessCode,
			businessCodeSymbol: res.businessSymbol(returnedBusinessCode),
			businessCodeShortText: res.businessShortText(returnedBusinessCode),
			businessCodeMeaning: res.businessMeaning(returnedBusinessCode),
		};
	}

	async upload(order: OrderLike): Promise<EbicsUploadResponse & { 0: string; 1: string; [Symbol.iterator](): Generator<string> }> {
		if (this.tracesStorage) this.tracesStorage.new().ofType('ORDER.UPLOAD');
		order.phase = 'initialisation';
		let res = await this.ebicsRequest(order);
		const transactionId: string = res.transactionId();
		const orderId: string = res.orderId();
		let phase: EbicsTransactionPhase = 'initialisation';

		if (isAccepted(res)) {
			// Without a TransactionID the order data cannot be transferred — the bank would never
			// see the order, however "successful" the initialisation looked.
			if (!transactionId) throw this.missingTransactionId(order, res);

			order.transactionId = transactionId;
			order.phase = 'transfer';
			phase = 'transfer';

			if (this.tracesStorage)
				this.tracesStorage.connect().ofType('TRANSFER.ORDER.UPLOAD');
			res = await this.ebicsRequest(order);
			this.assertSameTransaction(order, res, transactionId);
		}
		// else: the bank rejected the initialisation — report that verdict, transfer nothing.

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			transactionId: transactionId || undefined,
			orderId,
			phase,

			technicalCode: returnedTechnicalCode,
			technicalCodeSymbol: res.technicalSymbol(),
			technicalCodeShortText: res.technicalShortText(
				returnedTechnicalCode,
			),
			technicalCodeMeaning: res.technicalMeaning(returnedTechnicalCode),

			businessCode: returnedBusinessCode,
			businessCodeSymbol: res.businessSymbol(returnedBusinessCode),
			businessCodeShortText: res.businessShortText(returnedBusinessCode),
			businessCodeMeaning: res.businessMeaning(returnedBusinessCode),

			// for backwards compatibility with the earlier return value [transactionId, orderId]:
			0: transactionId,
			1: orderId,
			[Symbol.iterator]: function* iterator() {
				yield transactionId;
				yield orderId;
			},
		};
	}

	produceOrderXml(order: OrderLike): Promise<string> {
		return Promise.resolve(serializer.use(order, this)).then(serializedOrder => (serializedOrder as { toXML: () => string }).toXML());
	}

	ebicsRequest(order: OrderLike): Promise<any> {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise(async (resolve, reject) => {
			try {
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

				rock({
					method: 'POST',
					url: this.url,
					body: signedXml,
					headers: { 'content-type': 'text/xml;charset=UTF-8' },
					agent: this.agent,
				},
				(err, res, data) => {
					if (err) {
						reject(err);
						return;
					}

					try {
						const raw = {
							body: data ? data.toString('utf-8') : '',
							httpStatus: res?.statusCode,
							contentType: res?.headers?.['content-type'],
						};
						const context = { phase: order.phase, orderType: orderTypeOf(order) };

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

						resolve(ebicsResponse);
					} catch (validationError) {
						reject(validationError as Error);
					}
				});
			} catch (err) {
				reject(err as Error);
			}
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
				phase: order.phase,
				orderType: orderTypeOf(order),
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
