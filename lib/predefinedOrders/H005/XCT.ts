import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const XCT: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'XCT',
	msgName: 'pain.001',
	...options,
});

export default XCT;
