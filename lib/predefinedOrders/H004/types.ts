export interface KeyManagementOrderH004 {
	version: 'h004';
	orderDetails: {
		OrderType: string;
		OrderAttribute: 'DZNNN' | 'DZHNN' | 'OZHNN';
	};
	operation: 'ini' | 'upload' | 'download';
}

export interface UploadOrderH004 {
	version: 'h004';
	orderDetails: {
		OrderType: string;
		OrderAttribute: 'OZHNN';
	};
	document: string | Buffer;
	operation: 'upload';
}

export interface DownloadOrderH004 {
	orderDetails: {
		OrderType: string;
		OrderAttribute: 'DZHNN';
		StandardOrderParams: {
			Start: string;
			End: string;
		};
	};
	operation: 'download';
}

export type OrderH004 =
	| KeyManagementOrderH004
	| UploadOrderH004
	| DownloadOrderH004;

export interface PredefinedUploadFunctionH004 {
	(document: string | Buffer): UploadOrderH004;
}

export interface PredefinedDownloadFunctionH004 {
	(start: string | Date, end: string | Date): DownloadOrderH004;
}
