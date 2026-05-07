import { expectType, expectAssignable } from 'tsd';
import {
	Client,
	OrdersH004,
	OrdersH005,
	BankLetter,
	fsKeysStorage,
	inMemoryKeysStorage,
	tracesStorage,
	Orders,
} from '../../dist/esm/index.mjs';
import type {
	ClientOptions,
	EbicsBaseResponse,
	EbicsUploadResponse,
	EbicsKeyManagementResponse,
	EbicsDownloadResponse,
	BankKeys,
} from '../../dist/esm/index.mjs';
import type { CertificateOptions } from '../../dist/esm/index.mjs';
import type { BankLetterOptions } from '../../dist/esm/index.mjs';
import type { FsKeysStorage, TracesStorage } from '../../dist/esm/index.mjs';

// Construction surface
expectAssignable<ClientOptions>({
	url: 'https://x',
	partnerId: 'p',
	userId: 'u',
	hostId: 'h',
	passphrase: 'pw',
	keyStorage: fsKeysStorage('/tmp/k'),
});

const c = new Client({
	url: 'https://x',
	partnerId: 'p',
	userId: 'u',
	hostId: 'h',
	passphrase: 'pw',
	keyStorage: fsKeysStorage('/tmp/k'),
});

// Storage helpers
expectType<FsKeysStorage>(fsKeysStorage('/tmp/k'));
expectType<FsKeysStorage>(inMemoryKeysStorage());
expectAssignable<TracesStorage>(tracesStorage('/tmp'));

// Generate keys
const certOpts: CertificateOptions = { subject: 'CN=test' };
expectAssignable<Promise<unknown>>(c.generateKeys(certOpts, ['A006', 'E002']));

// Bank letter
expectAssignable<BankLetterOptions>({ client: c, bankName: 'B', template: '<x/>' });

// OrdersH004 surface
expectAssignable<{ version: 'h004' }>(OrdersH004.INI);
expectAssignable<{ version: 'h004' }>(OrdersH004.HIA);
expectAssignable<{ version: 'h004' }>(OrdersH004.HPB);
const azv = OrdersH004.AZV(Buffer.from(''));
expectAssignable<{ version: 'h004'; operation: 'upload' }>(azv);
const sta = OrdersH004.STA('2024-01-01', '2024-12-31');
expectAssignable<{ operation: 'download' }>(sta);
expectAssignable<{ operation: 'download' }>(OrdersH004.HAA);

// OrdersH005 surface
expectAssignable<{ version: 'h005' }>(OrdersH005.INI);
const sct = OrdersH005.SCT(Buffer.from(''));
expectAssignable<{ version: 'h005'; operation: 'upload' }>(sct);
const eop = OrdersH005.EOP();
expectAssignable<{ version: 'h005'; operation: 'download' }>(eop);

// genericUpload / genericDownload exist
const gu = OrdersH005.genericUpload(Buffer.from(''), {
	serviceName: 'SCT',
	msgName: 'pain.001',
});
expectAssignable<{ operation: 'upload' }>(gu);
const gd = OrdersH005.genericDownload({ serviceName: 'STM', msgName: 'camt.052' });
expectAssignable<{ operation: 'download' }>(gd);

// Deprecated alias
expectType<typeof OrdersH004>(Orders);

// Response shapes (sample)
declare const r: EbicsBaseResponse;
expectType<string>(r.orderId);
expectType<string>(r.technicalCode);
declare const u: EbicsUploadResponse;
expectAssignable<EbicsBaseResponse>(u);
declare const dl: EbicsDownloadResponse;
expectType<Buffer>(dl.orderData);
declare const km: EbicsKeyManagementResponse;
expectType<string>(km.orderData);
expectType<BankKeys>(km.bankKeys);

// BankLetter is a class
expectType<typeof BankLetter>(BankLetter);
