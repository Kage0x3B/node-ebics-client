import genericUpload from './generic-upload.js';
import type { PredefinedUploadFunctionH005 } from './types.js';

const DDD: PredefinedUploadFunctionH005 = (document, options) => genericUpload(document, {
	serviceName: 'DDD',
	msgName: 'pain.008',
	...options,
});

export default DDD;
