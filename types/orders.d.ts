import {
	DownloadOrderH004,
	KeyManagementOrderH004,
	OrderH004,
	UploadOrderH004,
} from "./ordersH004";
import {
	DownloadOrderH005,
	KeyManagementOrderH005,
	OrderH005,
	UploadOrderH005,
} from "./ordersH005";

export type Order = OrderH004 | OrderH005;
export type KeyManagementOrder =
	| KeyManagementOrderH004
	| KeyManagementOrderH005;
export type DownloadOrder = DownloadOrderH004 | DownloadOrderH005;
export type UploadOrder = UploadOrderH004 | UploadOrderH005;
