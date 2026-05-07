import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const XG1: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'XG1', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default XG1;
