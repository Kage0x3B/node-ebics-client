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
	document?: string | Buffer;
	needsExistingKeys?: boolean;
	[k: string]: unknown;
}

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
		const res = await this.ebicsRequest(order);
		const xml = res.orderData();

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			orderData: xml.length ? xml.toString() : xml,
			orderId: res.orderId(),

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
		const res = await this.ebicsRequest(order);

		order.transactionId = res.transactionId();

		if (res.isSegmented() && res.isLastSegment()) {
			if (this.tracesStorage)
				this.tracesStorage.connect().ofType('RECEIPT.ORDER.DOWNLOAD');

			await this.ebicsRequest(order);
		}

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			orderData: res.orderData(),
			transactionId: res.transactionId(),
			orderId: res.orderId(),

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
		let res = await this.ebicsRequest(order);
		const transactionId = res.transactionId();
		const orderId = res.orderId();

		order.transactionId = transactionId;

		if (this.tracesStorage)
			this.tracesStorage.connect().ofType('TRANSFER.ORDER.UPLOAD');
		res = await this.ebicsRequest(order);

		const returnedTechnicalCode = res.technicalCode();
		const returnedBusinessCode = res.businessCode();

		return {
			transactionId,
			orderId,

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
						.label(`REQUEST.${order.orderDetails.AdminOrderType || order.orderDetails.OrderType}`)
						.data(signedXml)
						.persist();

				rock({
					method: 'POST',
					url: this.url,
					body: signedXml,
					headers: { 'content-type': 'text/xml;charset=UTF-8' },
					agent: this.agent,
				},
				(err, _res, data) => {
					if (err) {
						reject(err);
						return;
					}

					const ebicsResponse = response.version(version)(data.toString('utf-8'), keys!);

					if (this.tracesStorage)
						this.tracesStorage
							.label(`RESPONSE.${order.orderDetails.AdminOrderType || order.orderDetails.OrderType}`)
							.connect()
							.data(ebicsResponse.toXML())
							.persist();

					resolve(ebicsResponse);
				});
			} catch (err) {
				reject(err as Error);
			}
		});
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
