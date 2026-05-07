import type { PredefinedUploadFunctionH004, UploadOrderH004 } from './types.js';

const XCT: PredefinedUploadFunctionH004 = (document) => ({
	version: 'h004',
	orderDetails: { OrderType: 'XCT', OrderAttribute: 'OZHNN', StandardOrderParams: {} },
	operation: 'upload',
	document,
} as UploadOrderH004);

export default XCT;
