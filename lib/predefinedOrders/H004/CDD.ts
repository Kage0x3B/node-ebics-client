import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const CDD: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'CDD', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default CDD;
