import { BankKeys } from "./keys";
import {
	DownloadOrder,
	KeyManagementOrder,
	Order,
	UploadOrder,
} from "./orders";
import { FsKeysStorage, TracesStorage } from "./storages";
import { Agent } from "http";

export interface ClientOptions {
	url: string;
	partnerId: string;
	userId: string;
	hostId: string;
	passphrase: string | Buffer;
	iv: string | Buffer;
	keyStorage: FsKeysStorage;
	tracesStorage?: TracesStorage;
	bankName?: string;
	bankShortName?: string;
	languageCode?: string;
	storageLocation?: string;
	agent?: Agent;
}

export class Client {
	constructor(options: ClientOptions);
	send(order: KeyManagementOrder): Promise<EbicsKeyManagementResponse>;
	send(order: UploadOrder): Promise<EbicsUploadResponse>;
	send(order: DownloadOrder): Promise<EbicsDownloadResponse>;
	send(order: Order): Promise<EbicsBaseResponse>;
	setKeys(keys: Partial<Keys>): Promise<void>;
	setBankKeys(bankKeys: BankKeys): Promise<void>;
	generateKeys(): Promise<Keys>;
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

export interface EbicsUploadResponse extends EbicsBaseResponse {}

export interface EbicsKeyManagementResponse extends EbicsBaseResponse {
	orderData: string;
	bankKeys: BankKeys;
}

export interface EbicsDownloadResponse extends EbicsBaseResponse {
	orderData: Buffer;
}
