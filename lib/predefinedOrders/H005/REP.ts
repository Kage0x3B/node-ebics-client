import genericDownload from './generic-download.js';
import type { PredefinedDownloadFunctionH005 } from './types.js';

const REP: PredefinedDownloadFunctionH005 = (options) => genericDownload({
	serviceName: 'REP',
	msgName: 'camt.054',
	containerType: 'ZIP',
	...options,
});

export default REP;
