import Main from './main.js';

let mainEvent;

window.onload = () => {
	const body = document.body;
	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	const netCanvas = document.getElementById('network');
	const netCtx = netCanvas.getContext('2d');
	const inspection = document.getElementById('inspection-panel');
	const legendPrimary = document.getElementById('view-legend-primary');
	const legendSecondary = document.getElementById('view-legend-secondary');
	const validViews = new Set(['drive', 'network', 'fitness', 'garage']);
	const legendCopy = {
		drive: ['ROAD + FIVE RAYS', 'POLICY RUNNING LIVE'],
		network: ['LIVE ACTIVATIONS', '5 INPUTS → 6 HIDDEN → 4 OUTPUTS'],
		fitness: ['COMPOSITE FITNESS', 'PACE + PASSES − PENALTIES'],
		garage: ['SENSOR ARRAY', 'STAGED FOR NEXT GENERATION'],
	};
	const requestedView = new URLSearchParams(window.location.search).get('view');

	const dimensions = () => {
		const roadRect = canvas.getBoundingClientRect();
		const inspectionRect = inspection.getBoundingClientRect();
		const width = Math.max(220, Math.round(roadRect.width));
		const height = Math.max(180, Math.round(roadRect.height));
		const netWidth = Math.max(260, Math.round(inspectionRect.width));

		if (canvas.width !== width) canvas.width = width;
		if (canvas.height !== height) canvas.height = height;
		if (netCanvas.width !== netWidth) netCanvas.width = netWidth;
		if (netCanvas.height !== height) netCanvas.height = height;

		return { width, height, netWidth };
	};

	const resize = () => {
		const size = dimensions();
		mainEvent?.resize(size);
	};

	const setView = (view, updateUrl = true) => {
		const nextView = validViews.has(view) ? view : 'drive';
		body.dataset.view = nextView;
		[legendPrimary.textContent, legendSecondary.textContent] = legendCopy[nextView];
		for (const button of document.querySelectorAll('[data-view-button]')) {
			button.setAttribute('aria-pressed', String(button.dataset.viewButton === nextView));
		}

		if (nextView === 'network') {
			legendSecondary.textContent = `${body.dataset.sensorCount ?? '5'} INPUTS → 6 HIDDEN → 4 OUTPUTS`;
		}

		if (updateUrl) {
			const url = new URL(window.location.href);
			url.searchParams.set('view', nextView);
			window.history.replaceState({}, '', url);
		}

		window.requestAnimationFrame(resize);
	};

	for (const button of document.querySelectorAll('[data-view-button]')) {
		button.addEventListener('click', () => setView(button.dataset.viewButton));
	}

	setView(validViews.has(requestedView) ? requestedView : 'drive', false);
	const initialSize = dimensions();
	mainEvent = new Main({
		ctx,
		width: initialSize.width,
		height: initialSize.height,
		netCtx,
		netWidth: initialSize.netWidth,
	});
	mainEvent.init();
	const checkpoint = () => mainEvent?.checkpoint();
	window.addEventListener('pagehide', checkpoint);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') checkpoint();
	});

	let resizeTimer;
	window.addEventListener('resize', () => {
		window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(resize, 120);
	});
};
