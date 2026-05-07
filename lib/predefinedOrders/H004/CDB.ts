import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const CDB: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'CDB', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default CDB;
