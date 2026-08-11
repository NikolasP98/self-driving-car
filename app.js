import Main from './main.js';

let mainEvent;

window.onload = () => {
	const body = document.body;
	const params = new URLSearchParams(window.location.search);
	const mode = params.get('mode') === 'blog' ? 'blog' : 'expanded';
	const session = (params.get('session') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
	const resourcePreset = params.get('preset') || (mode === 'blog' ? 'reader' : 'full');
	body.dataset.mode = mode;
	body.dataset.session = session;
	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	const netCanvas = document.getElementById('network');
	const netCtx = netCanvas.getContext('2d');
	const inspection = document.getElementById('inspection-panel');
	const validViews = new Set(['drive', 'network', 'fitness', 'garage']);
	const requestedView = params.get('view');
	const tuning = document.querySelector('.tuning');
	const tuningHome = document.getElementById('tuning-home-anchor');
	const driveControls = document.getElementById('drive-controls-slot');
	let currentView = validViews.has(requestedView) ? requestedView : mode === 'blog' ? 'garage' : 'drive';
	let embeddedActive = true;

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

	const placeControls = (view) => {
		if (mode === 'expanded' && view === 'drive') driveControls.append(tuning);
		else tuningHome.after(tuning);
	};

	const syncPlayback = () => {
		const pageVisible = document.visibilityState !== 'hidden';
		const viewCanPlay = !(mode === 'blog' && currentView === 'garage');
		mainEvent?.setPlaying(pageVisible && embeddedActive && viewCanPlay);
	};

	const setView = (view, updateUrl = true) => {
		const nextView = validViews.has(view) ? view : 'drive';
		currentView = nextView;
		body.dataset.view = nextView;
		for (const button of document.querySelectorAll('[data-view-button]')) {
			button.setAttribute('aria-pressed', String(button.dataset.viewButton === nextView));
		}
		placeControls(nextView);

		if (updateUrl && mode === 'expanded') {
			const url = new URL(window.location.href);
			url.searchParams.set('view', nextView);
			window.history.replaceState({}, '', url);
		}

		window.requestAnimationFrame(() => {
			resize();
			syncPlayback();
		});
	};

	for (const button of document.querySelectorAll('[data-view-button]')) {
		button.addEventListener('click', () => setView(button.dataset.viewButton));
	}

	setView(currentView, false);
	const initialSize = dimensions();
	mainEvent = new Main({
		ctx,
		width: initialSize.width,
		height: initialSize.height,
		netCtx,
		netWidth: initialSize.netWidth,
		stateKey: session ? `pinoniteNeuralLabV2:${session}` : undefined,
		resourcePreset,
	});
	mainEvent.init();
	syncPlayback();
	const checkpoint = () => mainEvent?.checkpoint();
	window.addEventListener('pagehide', checkpoint);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') checkpoint();
		syncPlayback();
	});

	window.addEventListener('message', (event) => {
		if (mode !== 'blog' || event.source !== window.parent) return;
		const message = event.data;
		if (!message || typeof message !== 'object' || !String(message.type).startsWith('pinonite-lab:')) return;
		if (message.session && message.session !== session) return;
		if (message.type === 'pinonite-lab:set-view' && validViews.has(message.view)) setView(message.view, false);
		if (message.type === 'pinonite-lab:set-active') {
			embeddedActive = Boolean(message.active);
			syncPlayback();
		}
	});

	if (mode === 'blog' && window.parent !== window) {
		window.parent.postMessage({ type: 'pinonite-lab:ready', session, view: currentView }, '*');
	}

	let resizeTimer;
	window.addEventListener('resize', () => {
		window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(resize, 120);
	});
};
