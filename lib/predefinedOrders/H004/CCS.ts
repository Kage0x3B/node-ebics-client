import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const CCS: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'CCS', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default CCS;
