import Client from './lib/Client.js';
import OrdersH004 from './lib/predefinedOrders/H004/index.js';
import OrdersH005 from './lib/predefinedOrders/H005/index.js';
import fsKeysStorage from './lib/storages/fsKeysStorage.js';
import inMemoryKeysStorage from './lib/storages/inMemoryKeysStorage.js';
import tracesStorage from './lib/storages/tracesStorage.js';
import BankLetter from './lib/BankLetter.js';

export {
	Client,
	OrdersH004,
	OrdersH005,
	BankLetter,
	fsKeysStorage,
	inMemoryKeysStorage,
	tracesStorage,
};

/** @deprecated Use OrdersH004 or OrdersH005 instead */
export const Orders = OrdersH004;

export type { ClientOptions, EbicsBaseResponse, EbicsUploadResponse, EbicsKeyManagementResponse, EbicsDownloadResponse, BankKeys } from './lib/Client.js';
export type { CertificateOptions } from './lib/keymanagers/Key.js';
export type { BankLetterOptions } from './lib/BankLetter.js';
export type { FsKeysStorage } from './lib/storages/fsKeysStorage.js';
export type { TracesStorage } from './lib/storages/tracesStorage.js';

export default {
	Client,
	Orders: OrdersH004,
	OrdersH004,
	OrdersH005,
	BankLetter,
	fsKeysStorage,
	inMemoryKeysStorage,
	tracesStorage,
};
