import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const XE3: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'XE3', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default XE3;
