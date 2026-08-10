import Main from './main.js';

let animation;
let mainEvent;

window.onload = () => {
	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	const netCanvas = document.getElementById('network');
	const netCtx = netCanvas.getContext('2d');
	const dimensions = () => {
		canvas.width = Math.max(280, Math.round(window.innerWidth * 0.38));
		canvas.height = window.innerHeight;
		netCanvas.width = Math.max(320, window.innerWidth - canvas.width);
		netCanvas.height = window.innerHeight;
	};
	const start = () => {
		dimensions();
		mainEvent?.stop();
		mainEvent = new Main({
			ctx,
			width: canvas.width,
			height: canvas.height,
			animation,
			netCtx,
			netWidth: netCanvas.width,
		});
		mainEvent.init();
	};

	// change canvas size as browser window resizes
	window.addEventListener('resize', start);

	// initiate simulation
	start();
};
