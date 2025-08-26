export interface KeyManagementOrderH004 {
	version: "h004";
	orderDetails: {
		OrderType: string;
		OrderAttribute: "DZNNN" | "DZHNN" | "OZHNN";
	};
	operation: "ini" | "upload" | "download";
}

export interface UploadOrderH004 {
	version: "h004";
	orderDetails: {
		OrderType: string;
		OrderAttribute: "OZHNN";
	};
	document: string | Buffer;
	operation: "upload";
}

export interface DownloadOrderH004 {
	orderDetails: {
		OrderType: string;
		OrderAttribute: "DZHNN";
		StandardOrderParams: {
			Start: string;
			End: string;
		};
	};
	operation: "download";
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

export namespace OrdersH004 {
	export const INI: KeyManagementOrderH004;
	export const HIA: KeyManagementOrderH004;
	export const HPB: KeyManagementOrderH004;
	export const Z53: PredefinedDownloadFunctionH004;

	export const AZV: PredefinedUploadFunctionH004;
	export const CD1: PredefinedUploadFunctionH004;
	export const CDB: PredefinedUploadFunctionH004;
	export const CDD: PredefinedUploadFunctionH004;
	export const CDS: PredefinedUploadFunctionH004;
	export const CCT: PredefinedUploadFunctionH004;
	export const CCS: PredefinedUploadFunctionH004;
	export const XE3: PredefinedUploadFunctionH004;
	export const XCT: PredefinedUploadFunctionH004;
	export const XG1: PredefinedUploadFunctionH004;
	export const G1V: PredefinedUploadFunctionH004;
	export const G1R: PredefinedUploadFunctionH004;

	export const STA: PredefinedDownloadFunctionH004;
	export const VMK: PredefinedDownloadFunctionH004;
	export const HAA: DownloadOrderH004;
	export const HTD: DownloadOrderH004;
	export const HPD: DownloadOrderH004;
	export const HKD: DownloadOrderH004;
	export const PTK: PredefinedDownloadFunctionH004;
	export const HAC: PredefinedDownloadFunctionH004;
	export const DKI: PredefinedDownloadFunctionH004;
	export const C52: PredefinedDownloadFunctionH004;
	export const C53: PredefinedDownloadFunctionH004;
	export const G52: PredefinedDownloadFunctionH004;
	export const G53: PredefinedDownloadFunctionH004;
	export const G02: PredefinedDownloadFunctionH004;
}
