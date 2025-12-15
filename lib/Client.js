'use strict';

const rock = require('rock-req');

const constants = require('./consts');
const Keys = require('./keymanagers/Keys');
const defaultKeyEncryptor = require('./keymanagers/defaultKeyEncryptor');

const signer = require('./middleware/signer');
const serializer = require('./middleware/serializer');
const response = require('./middleware/response');

const stringifyKeys = (keys) => {
	Object.keys(keys).map((key) => {
		keys[key] = keys[key] === null ? null : keys[key].toPems();
		return key;
	});

	return JSON.stringify(keys);
};

/**
 * Keys persistent object
 * @typedef {Object} KeysObject
 * @property {string} A006 - PEM representation of the A006 private key
 * @property {string} E002 - PEM representation of the E002 private key
 * @property {string} X002 - PEM representation of the X002 private key
 * @property {string} bankX002 - PEM representation of the bankX002 public key
 * @property {string} bankE002 - PEM representation of the bankE002 public key
 */

/**
 * Key storage implementation
 * @typedef {Object} KeyStorage
 * @property {(data: KeysObject):Promise<void>} write - writes the keys to storage
 * @property {():Promise<KeysObject>} read - reads the keys from storage
 */

/**
 * Client initialization options
 * @typedef {Object} EbicClientOptions
 * @property {string} url - EBICS URL provided by the bank
 * @property {string} partnerId - PARTNERID provided by the bank
 * @property {string} hostId - HOSTID provided by the bank
 * @property {string} userId - USERID provided by the bank
 * @property {string|Buffer} passphrase - passphrase or key for keys encryption
 * @property {string|Buffer} iv - Initialization Vector for keys encryption
 * @property {KeyStorage} keyStorage - keyStorage implementation
 * @property {object} [tracesStorage] - traces (logs) storage implementation
 * @property {string} bankName - Full name of the bank to be used in the bank INI letters.
 * @property {string} bankShortName - Short name of the bank to be used in folders, filenames etc.
 * @property {string} languageCode - Language code to be used in the bank INI letters ("de", "en" and "fr" are currently supported).
 * @property {string} storageLocation - Location where to store the files that are downloaded. This can be a network share for example.
 */
module.exports = class Client {
	/**
	 *Creates an instance of Client.
	 * @param {EbicClientOptions} clientOptions
	 */
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
	}) {
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

	async send(order) {
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

	async initialization(order) {
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

	async download(order) {
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

	async upload(order) {
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

	ebicsRequest(order) {
		return new Promise(async (resolve, reject) => {
			try {
				const { version } = order;
				const keys = await this.keys();
				const unsignedXml = (await serializer.use(order, this)).toXML();
				const signedXml = signer
					.version(version)
					.sign(unsignedXml, keys.x());

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
				(err, res, data) => {
					if (err) {
						reject(err);
						return;
					}

					const ebicsResponse = response.version(version)(data.toString('utf-8'), keys);

					if (this.tracesStorage)
						this.tracesStorage
							.label(`RESPONSE.${order.orderDetails.AdminOrderType || order.orderDetails.OrderType}`)
							.connect()
							.data(ebicsResponse.toXML())
							.persist();

					resolve(ebicsResponse);
				});
			} catch (err) {
				reject(err);
			}
		});
	}

	async signOrder(order) {
		const { version } = order;
		const keys = await this.keys();
		return signer
			.version(version)
			.sign((await serializer.use(order, this)).toXML(), keys.x());
	}

	async keys() {
		try {
			const keysString = await this._readKeys();
			return new Keys(JSON.parse(this.keyEncryptor.decrypt(keysString)));
		} catch (err) {
			return null;
		}
	}

	async generateKeys(certificateOptions, whichKeys) {
		const keysObject = Keys.generate(certificateOptions, whichKeys);
		await this._writeKeys(keysObject);

		return this.keys();
	}

	async _generateKeys() {
		await this.generateKeys();
	}

	async setKeys(keys) {
		let keysObject = await this.keys();
		if (!keysObject) keysObject = new Keys({});
		keysObject.setKeys(keys);
		await this._writeKeys(keysObject);
	}

	async setBankKeys(bankKeys) {
		await this.setKeys(bankKeys);
	}

	_readKeys() {
		return this.keyStorage.read();
	}

	_writeKeys(keysObject) {
		return this.keyStorage.write(
			this.keyEncryptor.encrypt(stringifyKeys(keysObject.keys)),
		);
	}
};
