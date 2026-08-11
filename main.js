import Car from './classes/car';
import NeuralNetwork from './classes/network';
import Street from './classes/street';
import Visualizer from './classes/visualizer';

const START_Y = 100;
const GENERATION_TICKS = 1500;
const MIN_GENERATION_TICKS = 240;

const cloneBrain = (brain) => JSON.parse(JSON.stringify(brain));

const seededRandom = (seed) => {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
};

export default class Main {
	#ctx;
	#netCtx;
	#width;
	#height;
	#netWidth;
	#cars = [];
	#street;
	#bestCar;
	#traffic = [];
	#metrics = new Map();
	#championBrain = null;
	#generation = 0;
	#generationTick = 0;
	#animation = 0;
	#running = false;
	#settings = {
		speed: 2,
		mutation: 0.12,
		pace: 3.2,
		traffic: 'standard',
		population: 120,
		autoEvolve: true,
	};
	#ui;

	constructor({ ctx, width, height, netCtx, netWidth }) {
		this.#ctx = ctx;
		this.#netCtx = netCtx;
		this.#width = width;
		this.#height = height;
		this.#netWidth = netWidth;
		this.#ui = {
			generation: document.getElementById('generation-value'),
			active: document.getElementById('active-value'),
			score: document.getElementById('score-value'),
			passes: document.getElementById('passes-value'),
			progress: document.getElementById('generation-progress'),
			status: document.getElementById('run-status'),
		};
	}

	#generateCars() {
		return Array.from(
			{ length: this.#settings.population },
			() => new Car(this.#street.getCenterLane(1), START_Y, 50, 80, 'AI', {
				maxSpeed: this.#settings.pace,
			})
		);
	}

	#generateTraffic() {
		const profiles = {
			sparse: { gap: 520, rows: 30, secondCarChance: 0.2 },
			standard: { gap: 430, rows: 36, secondCarChance: 0.48 },
			dense: { gap: 350, rows: 42, secondCarChance: 0.72 },
		};
		const profile = profiles[this.#settings.traffic];
		const random = seededRandom(9801);
		const traffic = [];

		for (let row = 0; row < profile.rows; row++) {
			const firstLane = Math.floor(random() * this.#street.laneCount);
			const secondLane = (firstLane + 1 + Math.floor(random() * 2)) % this.#street.laneCount;
			const y = -620 - row * profile.gap;
			traffic.push(
				new Car(this.#street.getCenterLane(firstLane), y, 50, 80, 'DUMMY', {
					maxSpeed: 1.9 + random() * 0.28,
				})
			);

			if (random() < profile.secondCarChance) {
				traffic.push(
					new Car(this.#street.getCenterLane(secondLane), y - 120 - random() * 130, 50, 80, 'DUMMY', {
						maxSpeed: 1.85 + random() * 0.28,
					})
				);
			}
		}

		return traffic;
	}

	#metricFor(car) {
		return this.#metrics.get(car);
	}

	#score(car) {
		const metric = this.#metricFor(car);
		if (!metric) return Number.NEGATIVE_INFINITY;

		const progress = Math.max(0, START_Y - car.y);
		const averageSpeed = metric.ticks ? metric.speedTotal / metric.ticks : 0;
		const paceRatio = Math.min(1.15, Math.max(0, averageSpeed) / this.#settings.pace);
		return (
			progress +
			metric.passes * 260 +
			paceRatio * 190 -
			metric.followingTicks * 0.16 -
			metric.idleTicks * 0.12 -
			(car.damaged ? 900 : 0)
		);
	}

	#recordMetrics(car) {
		const metric = this.#metricFor(car);
		if (!metric || car.damaged) return;

		metric.ticks += 1;
		metric.speedTotal += Math.max(0, car.speed);
		if (car.speed < this.#settings.pace * 0.52) metric.idleTicks += 1;

		let nearestAhead = Number.POSITIVE_INFINITY;
		for (const obstacle of this.#traffic) {
			const gap = car.y - obstacle.y;
			if (gap > 0 && Math.abs(car.x - obstacle.x) < 72) {
				nearestAhead = Math.min(nearestAhead, gap);
			}
			if (!metric.passed.has(obstacle) && car.y < obstacle.y - 28) {
				metric.passed.add(obstacle);
				metric.passes += 1;
			}
		}
		if (nearestAhead < 175 && car.speed < this.#settings.pace * 0.86) {
			metric.followingTicks += 1;
		}
	}

	#selectBest() {
		let leader = this.#cars[0];
		let leaderScore = this.#score(leader);
		for (let index = 1; index < this.#cars.length; index++) {
			const score = this.#score(this.#cars[index]);
			if (score > leaderScore) {
				leader = this.#cars[index];
				leaderScore = score;
			}
		}
		this.#bestCar = leader;
	}

	#startGeneration({ keepElite = true } = {}) {
		if (keepElite && this.#bestCar?.brain) this.#championBrain = cloneBrain(this.#bestCar.brain);
		this.#generation += 1;
		this.#generationTick = 0;
		this.#traffic = this.#generateTraffic();
		this.#cars = this.#generateCars();
		this.#metrics = new Map(
			this.#cars.map((car) => [
				car,
				{ ticks: 0, speedTotal: 0, idleTicks: 0, followingTicks: 0, passes: 0, passed: new Set() },
			])
		);

		if (this.#championBrain) {
			for (let index = 0; index < this.#cars.length; index++) {
				this.#cars[index].brain = cloneBrain(this.#championBrain);
				if (index !== 0) {
					const spread = 0.65 + (index / this.#cars.length) * 0.7;
					NeuralNetwork.mutate(this.#cars[index].brain, this.#settings.mutation * spread);
				}
			}
		}
		this.#bestCar = this.#cars[0];
		this.#ui.status.textContent = this.#championBrain ? 'EVOLVING ELITE' : 'SEARCHING FROM RANDOM';
	}

	#resetPopulation = () => {
		const saved = localStorage.getItem('bestBrain');
		this.#championBrain = saved ? JSON.parse(saved) : null;
		this.#generation = 0;
		this.#bestCar = null;
		this.#startGeneration({ keepElite: false });
	};

	#nextGeneration = () => {
		this.#startGeneration({ keepElite: true });
	};

	#save = () => {
		if (!this.#bestCar?.brain) return;
		localStorage.setItem('bestBrain', JSON.stringify(this.#bestCar.brain));
		this.#championBrain = cloneBrain(this.#bestCar.brain);
		this.#ui.status.textContent = 'CHAMPION SAVED LOCALLY';
	};

	#discard = () => {
		localStorage.removeItem('bestBrain');
		this.#ui.status.textContent = 'SAVED CHAMPION DISCARDED';
	};

	#bindControls() {
		const speed = document.getElementById('sim-speed');
		const mutation = document.getElementById('mutation-rate');
		const mutationOutput = document.getElementById('mutation-output');
		const pace = document.getElementById('pace-target');
		const paceOutput = document.getElementById('pace-output');
		const trafficDensity = document.getElementById('traffic-density');
		const population = document.getElementById('population-size');
		const autoEvolve = document.getElementById('auto-evolve');

		this.#settings.speed = Number(speed.value);
		this.#settings.mutation = Number(mutation.value);
		this.#settings.pace = Number(pace.value);
		this.#settings.traffic = trafficDensity.value;
		this.#settings.population = Number(population.value);
		this.#settings.autoEvolve = autoEvolve.checked;

		speed.onchange = () => (this.#settings.speed = Number(speed.value));
		mutation.oninput = () => {
			this.#settings.mutation = Number(mutation.value);
			mutationOutput.value = `${Math.round(this.#settings.mutation * 100)}%`;
		};
		pace.oninput = () => {
			this.#settings.pace = Number(pace.value);
			paceOutput.value = this.#settings.pace.toFixed(1);
			for (const car of this.#cars) car.maxSpeed = this.#settings.pace;
		};
		trafficDensity.onchange = () => {
			this.#settings.traffic = trafficDensity.value;
			this.#nextGeneration();
		};
		population.onchange = () => {
			this.#settings.population = Number(population.value);
			this.#nextGeneration();
		};
		autoEvolve.onchange = () => (this.#settings.autoEvolve = autoEvolve.checked);

		document.getElementById('next-generation').onclick = this.#nextGeneration;
		document.getElementById('reset-run').onclick = this.#resetPopulation;
		document.getElementById('save-brain').onclick = this.#save;
		document.getElementById('delete-brain').onclick = this.#discard;
	}

	#simulateTick() {
		for (const obstacle of this.#traffic) obstacle.update(this.#street.borders, []);
		for (const car of this.#cars) {
			car.update(this.#street.borders, this.#traffic);
			this.#recordMetrics(car);
		}
		this.#generationTick += 1;
		this.#selectBest();

		const activeCars = this.#cars.reduce((count, car) => count + (car.damaged ? 0 : 1), 0);
		const finished = this.#generationTick >= GENERATION_TICKS;
		const exhausted = activeCars === 0 && this.#generationTick >= MIN_GENERATION_TICKS;
		if (this.#settings.autoEvolve && (finished || exhausted)) this.#nextGeneration();
	}

	#draw(time) {
		this.#ctx.clearRect(0, 0, this.#width, this.#height);
		this.#netCtx.clearRect(0, 0, this.#netWidth, this.#height);
		this.#ctx.fillStyle = '#e8e5db';
		this.#ctx.fillRect(0, 0, this.#width, this.#height);

		this.#ctx.save();
		this.#ctx.translate(0, -this.#bestCar.y + this.#height * 0.62);
		this.#street.draw(this.#ctx);
		for (const obstacle of this.#traffic) obstacle.draw(this.#ctx, false);

		this.#ctx.globalAlpha = 0.16;
		for (const car of this.#cars) car.draw(this.#ctx, false);
		this.#ctx.globalAlpha = 1;
		this.#bestCar.draw(this.#ctx, true, true);
		this.#ctx.restore();

		this.#netCtx.lineDashOffset = -time / 60;
		Visualizer.drawNetwork(this.#netCtx, this.#bestCar.brain);
	}

	#updateUi() {
		const metric = this.#metricFor(this.#bestCar);
		const activeCars = this.#cars.reduce((count, car) => count + (car.damaged ? 0 : 1), 0);
		this.#ui.generation.textContent = String(this.#generation).padStart(2, '0');
		this.#ui.active.textContent = String(activeCars);
		this.#ui.score.textContent = String(Math.max(0, Math.round(this.#score(this.#bestCar))));
		this.#ui.passes.textContent = String(metric?.passes ?? 0).padStart(2, '0');
		this.#ui.progress.value = Math.min(1, this.#generationTick / GENERATION_TICKS);
	}

	#animate = (time) => {
		if (!this.#running) return;
		for (let tick = 0; tick < this.#settings.speed; tick++) this.#simulateTick();
		this.#draw(time);
		this.#updateUi();
		this.#animation = window.requestAnimationFrame(this.#animate);
	};

	init = () => {
		this.#street = new Street(this.#width / 2, this.#width * 0.86);
		this.#bindControls();
		this.#resetPopulation();
		this.#running = true;
		this.#animation = window.requestAnimationFrame(this.#animate);
	};

	stop() {
		this.#running = false;
		window.cancelAnimationFrame(this.#animation);
	}
}
