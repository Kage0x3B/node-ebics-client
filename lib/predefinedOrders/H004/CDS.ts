import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const CDS: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'CDS', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default CDS;
