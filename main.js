import Car from './classes/car';
import NeuralNetwork from './classes/network';
import Street from './classes/street';
import Visualizer from './classes/visualizer';

let cars;
let street;
let bestCar;
const traffic = [];

const saveButton = document.getElementById('save-brain');
const deleteButton = document.getElementById('delete-brain');

export default class Main {
	#ctx;
	#netCtx;
	#width;
	#height;
	#netWidth;

	constructor({ ctx, width, height, animation, netCtx, netWidth }) {
		this.#ctx = ctx;
		this.#netCtx = netCtx;
		this.#width = width;
		this.#height = height;
		this.#netWidth = netWidth;

		this.animation = animation;
	}

	#generateCars(N) {
		const cars = [];
		for (let i = 0; i < N; i++) {
			cars.push(new Car(street.getCenterLane(1), 100, 50, 80, 'AI'));
		}
		return cars;
	}

	save() {
		localStorage.setItem('bestBrain', JSON.stringify(bestCar.brain));
	}

	discard() {
		localStorage.removeItem('bestBrain');
	}

	// setup function runs once before animation begins
	init = () => {
		traffic.length = 0;
		saveButton.onclick = () => this.save();
		deleteButton.onclick = () => this.discard();

		street = new Street(this.#width / 2, this.#width * 0.9);
		const N = 100;
		cars = this.#generateCars(N);
		bestCar = cars[0];
		if (localStorage.getItem('bestBrain')) {
			for (let i = 0; i < cars.length; i++) {
				cars[i].brain = JSON.parse(localStorage.getItem('bestBrain'));
				if (i != 0) {
					NeuralNetwork.mutate(cars[i].brain, 0.1);
				}
			}
		}

		const K = 50;

		for (let i = 0; i < K; i++) {
			const lane1 = Math.floor(Math.random() * street.laneCount);
			const lane2 = Math.floor(Math.random() * street.laneCount);
			traffic.push(
				new Car(
					street.getCenterLane(lane1),
					500 * -i - 600,
					50,
					80,
					'DUMMY'
				)
			);
			if (lane1 !== lane2) {
				traffic.push(
					new Car(
						street.getCenterLane(lane2),
						300 * -i - 600,
						50,
						80,
						'DUMMY'
					)
				);
			}
		}

		window.requestAnimationFrame(this.#animate);
	};

	// animation loop runs indefinitely
	#animate = (time) => {
		this.#ctx.clearRect(0, 0, this.#width, this.#height);
		this.#netCtx.clearRect(0, 0, this.#netWidth, this.#height);

		// ----- MAIN ANIMATION CODE START -----

		this.#ctx.fillStyle = '#e8e5db';
		this.#ctx.fillRect(0, 0, this.#width, this.#height);
		this.#ctx.strokeStyle = 'transparent';

		bestCar = cars.find((c) => c.y == Math.min(...cars.map((c) => c.y)));

		this.#ctx.save();
		this.#ctx.translate(0, -bestCar.y + this.#height * 0.7);
		street.draw(this.#ctx);

		for (let i = 0; i < traffic.length; i++) {
			traffic[i].animate(this.#ctx, street.borders, []);
		}

		this.#ctx.globalAlpha = 0.2;

		for (let i = 0; i < cars.length; i++) {
			cars[i].animate(this.#ctx, street.borders, traffic);
		}
		this.#ctx.globalAlpha = 1;

		bestCar.animate(this.#ctx, street.borders, traffic, true);

		this.#ctx.restore();

		this.#netCtx.lineDashOffset = -time / 60;
		Visualizer.drawNetwork(this.#netCtx, bestCar.brain);

		// ----- MAIN ANIMATION CODE END -----

		this.animation = window.requestAnimationFrame(this.#animate.bind(this));
	};

	stop() {
		cancelAnimationFrame(this.animation);
	}
}
