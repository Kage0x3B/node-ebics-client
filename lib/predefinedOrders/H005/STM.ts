import genericDownload from './generic-download.js';
import type { PredefinedDownloadFunctionH005 } from './types.js';

const STM: PredefinedDownloadFunctionH005 = (options) => genericDownload({
	serviceName: 'STM',
	msgName: 'camt.052',
	containerType: 'ZIP',
	...options,
});

export default STM;
