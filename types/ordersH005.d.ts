// Key management orders
export interface KeyManagementOrderH005 {
	version: "h005";
	orderDetails: {
		AdminOrderType: "INI" | "HIA" | "HPB";
	};
	operation: "ini";
}

// Upload and download orders
interface UploadOrderParamsH005 {
	Service: {
		ServiceName: string;
		Scope?: string;
		ServiceOption?: string;
	};
	Container?: {
		"@": {
			containerType: string;
		};
	};
	MsgName: {
		"#": string;
		"@": {
			version?: string;
			variant?: string;
			format?: string;
		};
	};
}

interface DownloadOrderParamsH005 extends UploadOrderParamsH005 {
	DateRange?: {
		Start?: string;
		End?: string;
	};
}

export interface UploadOrderH005 {
	version: "h005";
	orderDetails: {
		AdminOrderType: "BTU";
		BTUOrderParams: UploadOrderParamsH005;
	};
	operation: "upload";
}

export interface DownloadOrderH005 {
	version: "h005";
	orderDetails: {
		AdminOrderType: "BTD";
		BTDOrderParams: DownloadOrderParamsH005;
	};
	operation: "download";
}

// All orders
export type OrderH005 =
	| KeyManagementOrderH005
	| UploadOrderH005
	| DownloadOrderH005;

// Order factory options & predefined orders
interface GenericCommonOrderOptionsH005 {
	serviceName: string;
	msgName: string;
	msgVersion?: string;
	msgVariant?: string;
	msgFormat?: string;
	scope?: string;
	serviceOption?: string;
	containerType?: string;
}

export interface GenericUploadOrderOptionsH005 extends GenericCommonOrderOptionsH005 {
	signatureFlag?: string;
	requestEDS?: boolean;
}

export interface GenericDownloadOrderOptionsH005 extends GenericCommonOrderOptionsH005 {
	start?: string | Date;
	end?: string | Date;
}

export type PredefinedUploadOrderOptionsH005 = Omit<
	GenericUploadOrderOptionsH005,
	"serviceName" | "msgName"
>;
export type PredefinedDownloadOrderOptionsH005 = Omit<
	GenericDownloadOrderOptionsH005,
	"serviceName" | "msgName"
>;

export interface PredefinedUploadFunctionH005 {
	(
		document: string | Buffer,
		options?: PredefinedUploadOrderOptionsH005
	): UploadOrderH005;
}

export interface PredefinedDownloadFunctionH005 {
	(options?: PredefinedDownloadOrderOptionsH005): DownloadOrderH005;
}

export namespace OrdersH005 {
	export const INI: KeyManagementOrderH005;
	export const HIA: KeyManagementOrderH005;
	export const HPB: KeyManagementOrderH005;

	export const DCT: PredefinedUploadFunctionH005;
	export const DDD: PredefinedUploadFunctionH005;
	export const MCT: PredefinedUploadFunctionH005;
	export const SCT: PredefinedUploadFunctionH005;
	export const SDD: PredefinedUploadFunctionH005;
	export const XCT: PredefinedUploadFunctionH005;

	export const EOP: PredefinedDownloadFunctionH005;
	export const PSR: PredefinedDownloadFunctionH005;
	export const REP: PredefinedDownloadFunctionH005;
	export const STM: PredefinedDownloadFunctionH005;

	export function genericUpload(
		document: string | Buffer,
		options: GenericUploadOrderOptionsH005
	): UploadOrderH005;
	export function genericDownload(
		options: GenericDownloadOrderOptionsH005
	): DownloadOrderH005;
}
