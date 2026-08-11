import Car from './classes/car';
import NeuralNetwork from './classes/network';
import Street from './classes/street';
import Visualizer from './classes/visualizer';

const START_Y = 100;
const ROAD_WIDTH = 320;
const TICKS_PER_SECOND = 60;
const DURATION_TICKS = {
	short: 15 * TICKS_PER_SECOND,
	standard: 25 * TICKS_PER_SECOND,
	long: 45 * TICKS_PER_SECOND,
	smart: 25 * TICKS_PER_SECOND,
};
const SMART_EXTENSION_TICKS = 15 * TICKS_PER_SECOND;
const SMART_MAX_TICKS = 60 * TICKS_PER_SECOND;
const MIN_GENERATION_TICKS = 240;
const MAX_SAMPLES = 80;

const cloneBrain = (brain) => JSON.parse(JSON.stringify(brain));
const signed = (value, sign = '+') => `${sign}${Math.round(Math.max(0, value))}`;
const randomSeed = () => {
	if (globalThis.crypto?.getRandomValues) {
		return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
	}
	return Math.floor(Math.random() * 4294967296);
};

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

const chartPath = (values, bounds = {}) => {
	if (!values.length) return { line: '', area: '' };
	const width = 320;
	const height = 100;
	const minimum = bounds.min ?? Math.min(0, ...values);
	const maximum = bounds.max ?? Math.max(1, ...values);
	const range = Math.max(0.001, maximum - minimum);
	const points = values.map((value, index) => {
		const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
		const y = height - ((value - minimum) / range) * (height - 8) - 4;
		return [x, Math.max(4, Math.min(height - 4, y))];
	});
	const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
	const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${height} L${points[0][0].toFixed(1)} ${height} Z`;
	return { line, area };
};

export const qualifiesForSmartExtension = ({
	mode,
	atMaximum,
	damaged,
	paceRatio,
	passes,
	laneChanges,
	tailingRatio,
	idleRatio,
	nonProgressQuality,
	extensionCount,
}) =>
	mode === 'smart' &&
	!atMaximum &&
	!damaged &&
	paceRatio >= 0.82 &&
	passes >= 2 + extensionCount * 2 &&
	laneChanges >= Math.min(2, extensionCount + 1) &&
	tailingRatio < 0.12 &&
	idleRatio < 0.18 &&
	nonProgressQuality >= 520 + extensionCount * 260;

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
	#generationLimit = DURATION_TICKS.smart;
	#smartExtensions = 0;
	#trafficSeed = 0;
	#animation = 0;
	#running = false;
	#recoveries = 0;
	#stableFrames = 0;
	#sampleIndex = 0;
	#lastSampleKey = '';
	#series = { fitness: [], average: [], survival: [], pace: [] };
	#settings = {
		speed: 2,
		duration: 'smart',
		mutation: 0.12,
		pace: 3.2,
		acceleration: 1.6,
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
			dashboard: {
				generation: document.getElementById('dashboard-generation'),
				sample: document.getElementById('dashboard-sample'),
				best: document.getElementById('dashboard-best'),
				average: document.getElementById('dashboard-average'),
				alive: document.getElementById('dashboard-alive'),
				pace: document.getElementById('dashboard-pace'),
				passes: document.getElementById('dashboard-passes'),
				window: document.getElementById('dashboard-window'),
				seed: document.getElementById('dashboard-seed'),
				progressReward: document.getElementById('reward-progress'),
				paceReward: document.getElementById('reward-pace'),
				passesReward: document.getElementById('reward-passes'),
				tailingPenalty: document.getElementById('penalty-tailing'),
				idlePenalty: document.getElementById('penalty-idle'),
				collisionPenalty: document.getElementById('penalty-collision'),
				charts: {
					fitness: {
						value: document.getElementById('fitness-chart-value'),
						line: document.getElementById('fitness-chart-line'),
						area: document.getElementById('fitness-chart-area'),
					},
					average: {
						value: document.getElementById('average-chart-value'),
						line: document.getElementById('average-chart-line'),
						area: document.getElementById('average-chart-area'),
					},
					survival: {
						value: document.getElementById('survival-chart-value'),
						line: document.getElementById('survival-chart-line'),
						area: document.getElementById('survival-chart-area'),
					},
					pace: {
						value: document.getElementById('pace-chart-value'),
						line: document.getElementById('pace-chart-line'),
						area: document.getElementById('pace-chart-area'),
					},
				},
			},
		};
	}

	#generateCars() {
		return Array.from(
			{ length: this.#settings.population },
			() => new Car(this.#street.getCenterLane(1), START_Y, 50, 80, 'AI', {
				maxSpeed: this.#settings.pace,
				accelerationFactor: this.#settings.acceleration,
			})
		);
	}

	#generateTraffic() {
		const profiles = {
			sparse: { gap: 520, rows: 30, secondCarChance: 0.2 },
			standard: { gap: 430, rows: 36, secondCarChance: 0.48 },
			dense: { gap: 350, rows: 42, secondCarChance: 0.72 },
		};
		const profile = profiles[this.#settings.traffic] ?? profiles.standard;
		const random = seededRandom(this.#trafficSeed);
		const traffic = [];

		for (let row = 0; row < profile.rows; row++) {
			const firstLane = Math.floor(random() * this.#street.laneCount);
			const secondLane = (firstLane + 1 + Math.floor(random() * 2)) % this.#street.laneCount;
			const y = -620 - row * profile.gap - random() * profile.gap * 0.32;
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

	#laneIndexFor(x) {
		const laneWidth = this.#street.width / this.#street.laneCount;
		return Math.max(0, Math.min(this.#street.laneCount - 1, Math.floor((x - this.#street.left) / laneWidth)));
	}

	#scoreBreakdown(car) {
		const metric = this.#metricFor(car);
		if (!metric) {
			return { progress: 0, pace: 0, passing: 0, tailing: 0, idle: 0, collision: 0, total: Number.NEGATIVE_INFINITY, averageSpeed: 0 };
		}

		const progress = Math.max(0, START_Y - car.y);
		const averageSpeed = metric.ticks ? metric.speedTotal / metric.ticks : 0;
		const paceRatio = Math.min(1.15, Math.max(0, averageSpeed) / this.#settings.pace);
		const pace = paceRatio * 190;
		const passing = metric.passes * 260;
		const tailing = metric.followingTicks * 0.16;
		const idle = metric.idleTicks * 0.12;
		const collision = car.damaged ? 900 : 0;

		return {
			progress,
			pace,
			passing,
			tailing,
			idle,
			collision,
			averageSpeed,
			total: progress + pace + passing - tailing - idle - collision,
		};
	}

	#score(car) {
		return this.#scoreBreakdown(car).total;
	}

	#recordMetrics(car) {
		const metric = this.#metricFor(car);
		if (!metric || car.damaged) return;

		metric.ticks += 1;
		metric.speedTotal += Math.max(0, car.speed);
		if (car.speed < this.#settings.pace * 0.52) metric.idleTicks += 1;
		const laneIndex = this.#laneIndexFor(car.x);
		if (laneIndex !== metric.lastLane) {
			metric.lastLane = laneIndex;
			metric.laneChanges += 1;
		}

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

	#baseDurationTicks() {
		return DURATION_TICKS[this.#settings.duration] ?? DURATION_TICKS.smart;
	}

	#shouldExtendSmartRun() {
		if (this.#settings.duration !== 'smart' || this.#generationLimit >= SMART_MAX_TICKS) return false;
		const metric = this.#metricFor(this.#bestCar);
		const breakdown = this.#scoreBreakdown(this.#bestCar);
		if (!metric?.ticks || this.#bestCar.damaged) return false;

		const paceRatio = breakdown.averageSpeed / Math.max(0.1, this.#settings.pace);
		const tailingRatio = metric.followingTicks / metric.ticks;
		const idleRatio = metric.idleTicks / metric.ticks;
		const nonProgressQuality = breakdown.pace + breakdown.passing - breakdown.tailing - breakdown.idle;

		return qualifiesForSmartExtension({
			mode: this.#settings.duration,
			atMaximum: this.#generationLimit >= SMART_MAX_TICKS,
			damaged: this.#bestCar.damaged,
			paceRatio,
			passes: metric.passes,
			laneChanges: metric.laneChanges,
			tailingRatio,
			idleRatio,
			nonProgressQuality,
			extensionCount: this.#smartExtensions,
		});
	}

	#extendSmartRun() {
		if (!this.#shouldExtendSmartRun()) return false;
		this.#generationLimit = Math.min(SMART_MAX_TICKS, this.#generationLimit + SMART_EXTENSION_TICKS);
		this.#smartExtensions += 1;
		this.#ui.status.textContent = `SMART WINDOW EXTENDED · ${Math.round(this.#generationLimit / TICKS_PER_SECOND)}S`;
		return true;
	}

	#startGeneration({ keepElite = true, status = null } = {}) {
		if (keepElite && NeuralNetwork.isValid(this.#bestCar?.brain)) {
			this.#championBrain = cloneBrain(this.#bestCar.brain);
		}
		if (!NeuralNetwork.isValid(this.#championBrain)) this.#championBrain = null;

		this.#generation += 1;
		this.#generationTick = 0;
		this.#generationLimit = this.#baseDurationTicks();
		this.#smartExtensions = 0;
		this.#trafficSeed = randomSeed();
		this.#lastSampleKey = '';
		this.#traffic = this.#generateTraffic();
		this.#cars = this.#generateCars();
		this.#metrics = new Map(
			this.#cars.map((car) => [
				car,
				{
					ticks: 0,
					speedTotal: 0,
					idleTicks: 0,
					followingTicks: 0,
					passes: 0,
					passed: new Set(),
					lastLane: 1,
					laneChanges: 0,
				},
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
		this.#bestCar.sensor?.update(this.#street.borders, this.#traffic);
		this.#ui.status.textContent = status ?? (this.#championBrain ? 'EVOLVING ELITE' : 'SEARCHING FROM RANDOM');
	}

	#loadSavedBrain() {
		const saved = localStorage.getItem('bestBrain');
		if (!saved) return { brain: null, status: null };
		try {
			const brain = JSON.parse(saved);
			if (NeuralNetwork.isValid(brain)) return { brain, status: null };
		} catch (error) {
			console.warn('Saved champion could not be parsed.', error);
		}
		localStorage.removeItem('bestBrain');
		return { brain: null, status: 'STALE CHAMPION CLEARED · RANDOM RESTART' };
	}

	#resetPopulation = () => {
		const saved = this.#loadSavedBrain();
		this.#championBrain = saved.brain;
		this.#generation = 0;
		this.#bestCar = null;
		this.#series = { fitness: [], average: [], survival: [], pace: [] };
		this.#sampleIndex = 0;
		this.#startGeneration({ keepElite: false, status: saved.status });
		if (!this.#running) {
			this.#running = true;
			this.#animation = window.requestAnimationFrame(this.#animate);
		}
	};

	#nextGeneration = () => {
		this.#startGeneration({ keepElite: true });
	};

	#save = () => {
		if (!NeuralNetwork.isValid(this.#bestCar?.brain)) return;
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
		const duration = document.getElementById('episode-duration');
		const mutation = document.getElementById('mutation-rate');
		const mutationOutput = document.getElementById('mutation-output');
		const pace = document.getElementById('pace-target');
		const paceOutput = document.getElementById('pace-output');
		const acceleration = document.getElementById('acceleration-factor');
		const accelerationOutput = document.getElementById('acceleration-output');
		const trafficDensity = document.getElementById('traffic-density');
		const population = document.getElementById('population-size');
		const autoEvolve = document.getElementById('auto-evolve');

		this.#settings.speed = Number(speed.value);
		this.#settings.duration = duration.value;
		this.#settings.mutation = Number(mutation.value);
		this.#settings.pace = Number(pace.value);
		this.#settings.acceleration = Number(acceleration.value);
		this.#settings.traffic = trafficDensity.value;
		this.#settings.population = Number(population.value);
		this.#settings.autoEvolve = autoEvolve.checked;

		speed.onchange = () => (this.#settings.speed = Number(speed.value));
		duration.onchange = () => {
			this.#settings.duration = duration.value;
			this.#smartExtensions = 0;
			this.#generationLimit = Math.max(this.#generationTick + TICKS_PER_SECOND, this.#baseDurationTicks());
			this.#ui.status.textContent = `RUN WINDOW · ${duration.options[duration.selectedIndex].text}`;
		};
		mutation.oninput = () => {
			this.#settings.mutation = Number(mutation.value);
			mutationOutput.value = `${Math.round(this.#settings.mutation * 100)}%`;
		};
		pace.oninput = () => {
			this.#settings.pace = Number(pace.value);
			paceOutput.value = this.#settings.pace.toFixed(1);
			for (const car of this.#cars) car.maxSpeed = this.#settings.pace;
		};
		acceleration.oninput = () => {
			this.#settings.acceleration = Number(acceleration.value);
			accelerationOutput.value = `${this.#settings.acceleration.toFixed(1)}×`;
			for (const car of this.#cars) car.accelerationFactor = this.#settings.acceleration;
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
		const finished = this.#generationTick >= this.#generationLimit;
		const exhausted = activeCars === 0 && this.#generationTick >= MIN_GENERATION_TICKS;
		if (this.#settings.autoEvolve && exhausted) {
			this.#nextGeneration();
		} else if (this.#settings.autoEvolve && finished && !this.#extendSmartRun()) {
			this.#nextGeneration();
		}
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

		if (document.body.dataset.view !== 'fitness') {
			if (!NeuralNetwork.isValid(this.#bestCar.brain)) throw new Error('Champion brain schema is invalid.');
			this.#netCtx.lineDashOffset = -time / 60;
			Visualizer.drawNetwork(this.#netCtx, this.#bestCar.brain);
		}
	}

	#snapshot() {
		const breakdown = this.#scoreBreakdown(this.#bestCar);
		const scores = this.#cars.map((car) => Math.max(0, this.#score(car)));
		const active = this.#cars.reduce((count, car) => count + (car.damaged ? 0 : 1), 0);
		const average = scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length);
		return {
			breakdown,
			active,
			alivePercent: (active / Math.max(1, this.#cars.length)) * 100,
			average,
			passes: this.#metricFor(this.#bestCar)?.passes ?? 0,
		};
	}

	#renderChart(chart, values, bounds) {
		const path = chartPath(values, bounds);
		chart.line.setAttribute('d', path.line);
		chart.area.setAttribute('d', path.area);
	}

	#updateDashboard(snapshot) {
		const dashboard = this.#ui.dashboard;
		const { breakdown } = snapshot;
		dashboard.generation.textContent = String(this.#generation).padStart(2, '0');
		dashboard.best.textContent = String(Math.max(0, Math.round(breakdown.total)));
		dashboard.average.textContent = String(Math.round(snapshot.average));
		dashboard.alive.textContent = `${Math.round(snapshot.alivePercent)}%`;
		dashboard.pace.textContent = `${breakdown.averageSpeed.toFixed(1)} / ${this.#settings.pace.toFixed(1)}`;
		dashboard.passes.textContent = String(snapshot.passes);
		dashboard.window.textContent = `${Math.round(this.#generationLimit / TICKS_PER_SECOND)} S${this.#smartExtensions ? ` · +${this.#smartExtensions}` : ''}`;
		dashboard.seed.textContent = this.#trafficSeed.toString(16).toUpperCase().padStart(8, '0').slice(-8);
		dashboard.progressReward.textContent = signed(breakdown.progress);
		dashboard.paceReward.textContent = signed(breakdown.pace);
		dashboard.passesReward.textContent = signed(breakdown.passing);
		dashboard.tailingPenalty.textContent = signed(breakdown.tailing, '−');
		dashboard.idlePenalty.textContent = signed(breakdown.idle, '−');
		dashboard.collisionPenalty.textContent = signed(breakdown.collision, '−');

		const sampleKey = `${this.#generation}:${Math.floor(this.#generationTick / 30)}`;
		if (sampleKey !== this.#lastSampleKey) {
			this.#lastSampleKey = sampleKey;
			this.#sampleIndex += 1;
			this.#series.fitness.push(Math.max(0, breakdown.total));
			this.#series.average.push(snapshot.average);
			this.#series.survival.push(snapshot.alivePercent);
			this.#series.pace.push(breakdown.averageSpeed);
			for (const values of Object.values(this.#series)) {
				if (values.length > MAX_SAMPLES) values.shift();
			}

			this.#renderChart(dashboard.charts.fitness, this.#series.fitness);
			this.#renderChart(dashboard.charts.average, this.#series.average);
			this.#renderChart(dashboard.charts.survival, this.#series.survival, { min: 0, max: 100 });
			this.#renderChart(dashboard.charts.pace, this.#series.pace, { min: 0, max: this.#settings.pace * 1.1 });
		}
		dashboard.sample.textContent = String(this.#sampleIndex).padStart(3, '0');

		dashboard.charts.fitness.value.textContent = String(Math.max(0, Math.round(breakdown.total)));
		dashboard.charts.average.value.textContent = String(Math.round(snapshot.average));
		dashboard.charts.survival.value.textContent = `${Math.round(snapshot.alivePercent)}%`;
		dashboard.charts.pace.value.textContent = breakdown.averageSpeed.toFixed(1);
	}

	#updateUi() {
		const snapshot = this.#snapshot();
		this.#ui.generation.textContent = String(this.#generation).padStart(2, '0');
		this.#ui.active.textContent = String(snapshot.active);
		this.#ui.score.textContent = String(Math.max(0, Math.round(snapshot.breakdown.total)));
		this.#ui.passes.textContent = String(snapshot.passes).padStart(2, '0');
		this.#ui.progress.value = Math.min(1, this.#generationTick / this.#generationLimit);
		this.#updateDashboard(snapshot);
	}

	#recover(error) {
		console.error('Neural-car runtime recovered from an invalid frame.', error);
		this.#recoveries += 1;
		this.#stableFrames = 0;
		if (!NeuralNetwork.isValid(this.#bestCar?.brain)) localStorage.removeItem('bestBrain');
		this.#championBrain = null;

		if (this.#recoveries > 2) {
			this.#running = false;
			this.#ui.status.textContent = 'PAUSED AFTER REPEATED ERROR · RESET RUN';
			return;
		}

		this.#startGeneration({ keepElite: false, status: 'FRAME RECOVERED · NEW RANDOM POPULATION' });
	}

	#animate = (time) => {
		if (!this.#running) return;
		try {
			for (let tick = 0; tick < this.#settings.speed; tick++) this.#simulateTick();
			this.#draw(time);
			this.#updateUi();
			this.#stableFrames += 1;
			if (this.#stableFrames > 120) this.#recoveries = 0;
		} catch (error) {
			this.#recover(error);
		} finally {
			if (this.#running) this.#animation = window.requestAnimationFrame(this.#animate);
		}
	};

	#roadWidth() {
		return ROAD_WIDTH;
	}

	init = () => {
		this.#street = new Street(this.#width / 2, this.#roadWidth());
		this.#bindControls();
		this.#running = true;
		this.#resetPopulation();
		this.#animation = window.requestAnimationFrame(this.#animate);
	};

	resize({ width, height, netWidth }) {
		const horizontalShift = width / 2 - this.#width / 2;
		if (Number.isFinite(horizontalShift) && horizontalShift !== 0) {
			for (const car of this.#cars) car.x += horizontalShift;
			for (const obstacle of this.#traffic) obstacle.x += horizontalShift;
		}
		this.#width = width;
		this.#height = height;
		this.#netWidth = netWidth;
		this.#street = new Street(this.#width / 2, this.#roadWidth());
	}

	stop() {
		this.#running = false;
		window.cancelAnimationFrame(this.#animation);
	}
}
