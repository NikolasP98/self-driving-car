import Main from './main.js';

let mainEvent;

const ES = {
	'SOURCE LAB': 'LABORATORIO', 'FIVE RAYS INTO FOUR DECISIONS': 'CINCO RAYOS EN CUATRO DECISIONES',
	'DRIVE': 'CONDUCCIÓN', 'NETWORK': 'RED', 'FITNESS': 'APTITUD', 'GARAGE': 'GARAJE',
	'EVOLUTIONARY DRIVING · LIVE': 'CONDUCCIÓN EVOLUTIVA · EN VIVO', 'Simulation view': 'Vista de simulación',
	'Road simulation with neural cars and traffic': 'Simulación vial con autos neuronales y tráfico',
	'Neural network and fitness inspection': 'Inspección de red neuronal y aptitud', 'Driving configuration': 'Configuración de conducción',
	'RUN CONFIGURATION': 'CONFIGURACIÓN DE EJECUCIÓN', 'THE ROAD STAYS FULL-SIZE WHILE THE POLICY CONTROLS MOVE HERE': 'LA VÍA CONSERVA SU TAMAÑO Y LOS CONTROLES SE MUEVEN AQUÍ',
	'Live evolutionary fitness dashboard': 'Panel evolutivo de aptitud en vivo', 'EVOLUTION MONITOR': 'MONITOR EVOLUTIVO', 'COMPOSITE FITNESS / LIVE': 'APTITUD COMPUESTA / EN VIVO',
	'CURRENT': 'ACTUAL', 'PAST RUNS': 'EJECUCIONES ANTERIORES', 'LEARNING STATE': 'ESTADO DE APRENDIZAJE',
	'CHAMPION': 'CAMPEÓN', 'AVERAGE': 'PROMEDIO', 'ALIVE': 'ACTIVOS', 'PACE': 'RITMO', 'OVERTAKES': 'ADELANTAMIENTOS', 'WINDOW': 'VENTANA',
	'RUN MEMORY': 'MEMORIA DE EJECUCIONES', 'DIFFICULTY': 'DIFICULTAD', 'PROMOTION': 'PROMOCIÓN', 'NEXT UNLOCK': 'SIGUIENTE DESBLOQUEO', 'TRAFFIC SEED': 'SEMILLA DE TRÁFICO',
	'FITNESS LEDGER': 'REGISTRO DE APTITUD', 'RESET VALUES': 'REINICIAR VALORES', 'FORWARD / PX': 'AVANCE / PX', 'PACE / RUN': 'RITMO / EJECUCIÓN', 'PASS / CAR': 'ADELANTAR / AUTO', 'TAIL / TICK': 'SEGUIR / PASO', 'IDLE / TICK': 'INACTIVO / PASO', 'COLLISION': 'COLISIÓN',
	'CHAMPION FITNESS': 'APTITUD DEL CAMPEÓN', 'AVERAGE FITNESS': 'APTITUD PROMEDIO', 'POPULATION ALIVE': 'POBLACIÓN ACTIVA', 'CHAMPION PACE': 'RITMO DEL CAMPEÓN',
	'SENSOR GARAGE': 'GARAJE DE SENSORES', "EDIT THE NEXT GENERATION'S FIELD OF VIEW": 'EDITA EL CAMPO VISUAL DE LA SIGUIENTE GENERACIÓN', 'CURRENT CONFIGURATION': 'CONFIGURACIÓN ACTUAL',
	'Existing ray IDs retain their learned weights. New rays enter with newborn random weights.': 'Los rayos existentes conservan sus pesos aprendidos. Los nuevos empiezan con pesos aleatorios.',
	'RAY': 'RAYO', 'ANGLE': 'ÁNGULO', 'REACH': 'ALCANCE', '+ ADD SENSOR': '+ AÑADIR SENSOR', 'RESET FIVE-RAY ARRAY': 'REINICIAR CINCO RAYOS', 'Changes are staged and applied when the next generation begins.': 'Los cambios quedan pendientes y se aplican al iniciar la siguiente generación.',
	'GEN': 'GEN', 'ACTIVE': 'ACTIVOS', 'PASSES': 'ADELANTAMIENTOS', 'RESOURCE PRESET': 'RECURSOS', 'AUTO / READER': 'AUTO / LECTURA', 'CONSERVE': 'AHORRO', 'BALANCED': 'EQUILIBRADO', 'FULL LAB': 'LABORATORIO COMPLETO',
	'SIM SPEED': 'VELOCIDAD', 'RUN WINDOW': 'DURACIÓN', 'SMART': 'INTELIGENTE', 'MUTATION': 'MUTACIÓN', 'PACE TARGET': 'RITMO OBJETIVO', 'ACCEL': 'ACELERACIÓN', 'TRAFFIC': 'TRÁFICO', 'POPULATION': 'POBLACIÓN', 'SPARSE': 'LIGERO', 'STANDARD': 'ESTÁNDAR', 'DENSE': 'DENSO', 'AUTO': 'AUTO',
	'PROMOTION POLICY': 'POLÍTICA DE PROMOCIÓN', 'SMART / CONSISTENT': 'INTELIGENTE / CONSISTENTE', 'MANUAL / HOLD': 'MANUAL / MANTENER', 'SMART PROMOTION': 'PROMOCIÓN INTELIGENTE', 'NEXT GENERATION ↗': 'SIGUIENTE GENERACIÓN ↗', 'RESET RUN': 'REINICIAR EJECUCIÓN'
	,'SMART WINDOW EXTENDED': 'VENTANA INTELIGENTE EXTENDIDA', 'LOCAL SAVE FULL · RUN CONTINUES': 'MEMORIA LOCAL LLENA · LA EJECUCIÓN CONTINÚA', 'EVOLVING SAVED CHAMPION': 'EVOLUCIONANDO CAMPEÓN GUARDADO', 'SEARCHING FROM RANDOM': 'BUSCANDO DESDE EL AZAR', 'FITNESS WEIGHTS UPDATED': 'PESOS DE APTITUD ACTUALIZADOS', 'FITNESS WEIGHTS RESET': 'PESOS DE APTITUD REINICIADOS', 'SENSOR EDITS QUEUED · NEXT GENERATION': 'CAMBIOS DE SENSORES PENDIENTES · SIGUIENTE GENERACIÓN', 'CHANGES PENDING · NEXT RUN': 'CAMBIOS PENDIENTES · SIGUIENTE EJECUCIÓN', 'INPUT NODE': 'NODO DE ENTRADA', 'INPUT NODES': 'NODOS DE ENTRADA', 'NEWBORN': 'NUEVO', 'WEIGHTED': 'PONDERADO', 'SENSOR LIMIT · 12 INPUTS': 'LÍMITE DE SENSORES · 12 ENTRADAS', 'FIVE-RAY ARRAY QUEUED · NEXT GENERATION': 'CINCO RAYOS PENDIENTES · SIGUIENTE GENERACIÓN', 'PAUSED AFTER REPEATED ERROR · RESET RUN': 'PAUSA TRAS ERRORES REPETIDOS · REINICIA',
	'STRAIGHT / TRAFFIC': 'RECTA / TRÁFICO', 'CURVED ROAD / TRAFFIC': 'CURVAS / TRÁFICO', 'CURVES + LANE CHANGES': 'CURVAS + CAMBIOS DE CARRIL', 'DYNAMIC TRAFFIC': 'TRÁFICO DINÁMICO', 'STRAIGHT': 'RECTA', 'CURVES': 'CURVAS', 'LANE CHANGES': 'CAMBIOS DE CARRIL', 'DYNAMIC': 'DINÁMICO'
};
let locale = 'en';
window.pnT = (text) => locale === 'es' ? (ES[text] || text) : text;
const localizeDocument = () => {
	document.documentElement.lang = locale;
	document.querySelectorAll('body *').forEach((element) => {
		for (const node of element.childNodes) {
			if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
			const source = node.__pinoniteSource || node.textContent.trim();
			node.__pinoniteSource = source;
			const translated = window.pnT(source);
			node.textContent = node.textContent.replace(node.textContent.trim(), translated);
		}
		for (const name of ['aria-label', 'title']) {
			const source = element.dataset[`i18n${name === 'title' ? 'Title' : 'Aria'}`] || element.getAttribute(name);
			if (!source) continue;
			element.dataset[`i18n${name === 'title' ? 'Title' : 'Aria'}`] = source;
			element.setAttribute(name, window.pnT(source));
		}
	});
};

window.onload = () => {
	const body = document.body;
	const params = new URLSearchParams(window.location.search);
	locale = params.get('lang') === 'es' ? 'es' : 'en';
	localizeDocument();
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
		if (message.type === 'pinonite-lab:set-locale') {
			locale = message.locale === 'es' ? 'es' : 'en';
			localizeDocument();
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
