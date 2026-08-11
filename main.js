import Car from './classes/car';
import NeuralNetwork from './classes/network';
import { DEFAULT_SENSOR_CONFIG } from './classes/sensor';
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
const MAX_SAMPLES = 120;
const MAX_PAST_RUNS = 4;
const LAB_STATE_KEY = 'pinoniteNeuralLabV2';
const LAB_STATE_VERSION = 3;
const CHECKPOINT_INTERVAL_MS = 1500;
const REWARD_DEFAULTS = Object.freeze({
	progress: 1,
	pace: 190,
	passing: 260,
	tailing: 0.16,
	idle: 0.12,
	collision: 900,
});
const DIFFICULTIES = Object.freeze([
	{ label: 'STRAIGHT / TRAFFIC', unlockLabel: 'STRAIGHT', curveAmplitude: 0, curveWavelength: 5200, laneChanges: false, milestone: 0 },
	{ label: 'CURVED ROAD / TRAFFIC', unlockLabel: 'CURVES', curveAmplitude: 58, curveWavelength: 5200, laneChanges: false, milestone: 8500 },
	{ label: 'CURVES + LANE CHANGES', unlockLabel: 'LANE CHANGES', curveAmplitude: 72, curveWavelength: 4800, laneChanges: true, milestone: 16000 },
	{ label: 'DYNAMIC TRAFFIC', unlockLabel: 'DYNAMIC', curveAmplitude: 82, curveWavelength: 4100, laneChanges: true, milestone: 26000 },
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
const cloneSensors = (sensors) => sensors.map((sensor) => ({ ...sensor }));

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
	#trafficStates = new Map();
	#metrics = new Map();
	#championBrain = null;
	#championFitness = 0;
	#difficulty = DIFFICULTIES[0];
	#activeSensors = cloneSensors(DEFAULT_SENSOR_CONFIG);
	#pendingSensors = cloneSensors(DEFAULT_SENSOR_CONFIG);
	#maxSensorReach = 200;
	#smartDifficultyIndex = 0;
	#manualDifficultyIndex = 0;
	#generation = 0;
	#generationTick = 0;
	#generationLimit = DURATION_TICKS.smart;
	#smartExtensions = 0;
	#trafficSeed = 0;
	#animation = 0;
	#running = false;
	#recoveries = 0;
	#stableFrames = 0;
	#lastSampleKey = '';
	#lastCheckpointAt = 0;
	#runFinalized = false;
	#currentSeries = { fitness: [], average: [], survival: [], pace: [] };
	#pastRuns = [];
	#completedRunCount = 0;
	#settings = {
		speed: 2,
		duration: 'smart',
		mutation: 0.12,
		pace: 3.2,
		acceleration: 1.6,
		traffic: 'standard',
		population: 120,
		autoEvolve: true,
		promotionMode: 'smart',
		rewards: { ...REWARD_DEFAULTS },
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
				difficulty: document.getElementById('dashboard-difficulty'),
				memory: document.getElementById('dashboard-memory'),
				promotion: document.getElementById('dashboard-promotion'),
				nextUnlock: document.getElementById('dashboard-next-unlock'),
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
						history: document.getElementById('fitness-chart-history'),
					},
					average: {
						value: document.getElementById('average-chart-value'),
						line: document.getElementById('average-chart-line'),
						history: document.getElementById('average-chart-history'),
					},
					survival: {
						value: document.getElementById('survival-chart-value'),
						line: document.getElementById('survival-chart-line'),
						history: document.getElementById('survival-chart-history'),
					},
					pace: {
						value: document.getElementById('pace-chart-value'),
						line: document.getElementById('pace-chart-line'),
						history: document.getElementById('pace-chart-history'),
					},
				},
			},
		};
	}

	#generateCars() {
		return Array.from(
			{ length: this.#settings.population },
			() => new Car(this.#street.getCenterLane(1, START_Y), START_Y, 50, 80, 'AI', {
				maxSpeed: this.#settings.pace,
				accelerationFactor: this.#settings.acceleration,
				sensors: this.#activeSensors,
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
		this.#trafficStates = new Map();

		for (let row = 0; row < profile.rows; row++) {
			const firstLane = Math.floor(random() * this.#street.laneCount);
			const secondLane = (firstLane + 1 + Math.floor(random() * 2)) % this.#street.laneCount;
			const y = -620 - row * profile.gap - random() * profile.gap * 0.32;
			const firstCar = new Car(this.#street.getCenterLane(firstLane, y), y, 50, 80, 'DUMMY', {
					maxSpeed: 1.9 + random() * 0.28,
				});
			traffic.push(firstCar);
			this.#trafficStates.set(firstCar, {
				lane: firstLane,
				lanePosition: firstLane,
				change: null,
				nextChangeTick: 900 + Math.floor(random() * 1200),
				changeAffinity: random(),
				random,
			});

			if (random() < profile.secondCarChance) {
				const secondY = y - 120 - random() * 130;
				const secondCar = new Car(this.#street.getCenterLane(secondLane, secondY), secondY, 50, 80, 'DUMMY', {
						maxSpeed: 1.85 + random() * 0.28,
					});
				traffic.push(secondCar);
				this.#trafficStates.set(secondCar, {
					lane: secondLane,
					lanePosition: secondLane,
					change: null,
					nextChangeTick: 900 + Math.floor(random() * 1200),
					changeAffinity: random(),
					random,
				});
			}
		}

		return traffic;
	}

	#difficultyIndexForFitness(fitness = this.#championFitness) {
		for (let index = DIFFICULTIES.length - 1; index >= 0; index--) {
			if (fitness >= DIFFICULTIES[index].milestone) return index;
		}
		return 0;
	}

	#safeDifficultyIndex(index, fallback = 0) {
		const value = Number(index);
		return Number.isInteger(value) ? Math.max(0, Math.min(DIFFICULTIES.length - 1, value)) : fallback;
	}

	#difficultyFor() {
		const index = this.#settings.promotionMode === 'manual'
			? this.#manualDifficultyIndex
			: this.#smartDifficultyIndex;
		return DIFFICULTIES[this.#safeDifficultyIndex(index)];
	}

	#nextDifficulty() {
		const index = DIFFICULTIES.indexOf(this.#difficulty);
		return DIFFICULTIES[index + 1] ?? null;
	}

	#smartPromotionProgress() {
		const next = DIFFICULTIES[this.#smartDifficultyIndex + 1];
		if (!next) return 2;
		let consecutive = 0;
		for (let index = this.#pastRuns.length - 1; index >= 0; index--) {
			if (this.#pastRuns[index].interrupted || this.#pastRuns[index].score < next.milestone) break;
			consecutive += 1;
			if (consecutive >= 2) break;
		}
		return consecutive;
	}

	#createStreet() {
		const curvePhase = (this.#trafficSeed % 10000) - 5000;
		return new Street(this.#width / 2, this.#roadWidth(), 3, {
			curveAmplitude: this.#difficulty.curveAmplitude,
			curveWavelength: this.#difficulty.curveWavelength,
			curvePhase,
		});
	}

	#laneIsClear(obstacle, lane) {
		const targetX = this.#street.getCenterLane(lane, obstacle.y);
		return !this.#traffic.some(
			(other) =>
				other !== obstacle &&
				Math.abs(other.y - obstacle.y) < 260 &&
				Math.abs(other.x - targetX) < 64
		);
	}

	#advanceTraffic(obstacle) {
		const state = this.#trafficStates.get(obstacle);
		if (!state) return;

		const affinityThreshold = this.#difficulty.milestone >= 26000 ? 0.5 : 0.3;
		if (
			this.#difficulty.laneChanges &&
			!state.change &&
			this.#generationTick >= state.nextChangeTick &&
			state.changeAffinity <= affinityThreshold
		) {
			const direction = state.lane <= 0 ? 1 : state.lane >= this.#street.laneCount - 1 ? -1 : state.random() < 0.5 ? -1 : 1;
			const targetLane = Math.max(0, Math.min(this.#street.laneCount - 1, state.lane + direction));
			if (this.#laneIsClear(obstacle, targetLane)) {
				state.change = {
					from: state.lane,
					to: targetLane,
					progress: 0,
					duration: 220 + Math.floor(state.random() * 120),
				};
			}
		}

		if (this.#generationTick >= state.nextChangeTick && !state.change) {
			const minimumWait = this.#difficulty.milestone >= 26000 ? 720 : 1100;
			state.nextChangeTick = this.#generationTick + minimumWait + Math.floor(state.random() * 1100);
		}

		if (state.change) {
			state.change.progress = Math.min(1, state.change.progress + 1 / state.change.duration);
			const progress = state.change.progress;
			const eased = progress * progress * (3 - 2 * progress);
			state.lanePosition = state.change.from + (state.change.to - state.change.from) * eased;
			if (progress >= 1) {
				state.lane = state.change.to;
				state.lanePosition = state.lane;
				state.change = null;
				const minimumWait = this.#difficulty.milestone >= 26000 ? 720 : 1100;
				state.nextChangeTick = this.#generationTick + minimumWait + Math.floor(state.random() * 1100);
			}
		}

		const speed = Math.min(obstacle.maxSpeed, obstacle.speed + obstacle.acceleration * 0.32);
		const nextY = obstacle.y - speed;
		const nextX = this.#street.getCenterLane(state.lanePosition, nextY);
		const angle = Math.atan2(-(nextX - obstacle.x), Math.max(0.1, obstacle.y - nextY));
		obstacle.followPath({ x: nextX, y: nextY, angle, speed });
	}

	#nearbyTrafficFor(car) {
		const verticalRange = this.#maxSensorReach + 130;
		const horizontalRange = this.#street.width * 0.8;
		return this.#traffic.filter(
			(obstacle) => Math.abs(obstacle.y - car.y) <= verticalRange && Math.abs(obstacle.x - car.x) <= horizontalRange
		);
	}

	#metricFor(car) {
		return this.#metrics.get(car);
	}

	#laneIndexFor(x, y) {
		const laneWidth = this.#street.width / this.#street.laneCount;
		return Math.max(0, Math.min(this.#street.laneCount - 1, Math.floor((x - this.#street.leftAt(y)) / laneWidth)));
	}

	#scoreBreakdown(car) {
		const metric = this.#metricFor(car);
		if (!metric) {
			return { progress: 0, pace: 0, passing: 0, tailing: 0, idle: 0, collision: 0, total: Number.NEGATIVE_INFINITY, averageSpeed: 0 };
		}

		const rewards = this.#settings.rewards;
		const progress = Math.max(0, START_Y - car.y) * rewards.progress;
		const averageSpeed = metric.ticks ? metric.speedTotal / metric.ticks : 0;
		const paceRatio = Math.min(1.15, Math.max(0, averageSpeed) / this.#settings.pace);
		const pace = paceRatio * rewards.pace;
		const passing = metric.passes * rewards.passing;
		const tailing = metric.followingTicks * rewards.tailing;
		const idle = metric.idleTicks * rewards.idle;
		const collision = car.damaged ? rewards.collision : 0;

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

	#recordMetrics(car, nearbyTraffic) {
		const metric = this.#metricFor(car);
		if (!metric || car.damaged) return;

		metric.ticks += 1;
		metric.speedTotal += Math.max(0, car.speed);
		if (car.speed < this.#settings.pace * 0.52) metric.idleTicks += 1;
		const laneIndex = this.#laneIndexFor(car.x, car.y);
		if (laneIndex !== metric.lastLane) {
			metric.lastLane = laneIndex;
			metric.laneChanges += 1;
		}

		let nearestAhead = Number.POSITIVE_INFINITY;
		for (const obstacle of nearbyTraffic) {
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

	#emptySeries() {
		return { fitness: [], average: [], survival: [], pace: [] };
	}

	#validSeries(series) {
		if (!series || typeof series !== 'object') return this.#emptySeries();
		return Object.fromEntries(
			Object.keys(this.#emptySeries()).map((key) => [
				key,
				Array.isArray(series[key])
					? series[key].filter(Number.isFinite).slice(-MAX_SAMPLES)
					: [],
			])
		);
	}

	#safeRewards(rewards) {
		const clean = { ...REWARD_DEFAULTS };
		for (const key of Object.keys(clean)) {
			const value = Number(rewards?.[key]);
			if (Number.isFinite(value) && value >= 0) clean[key] = value;
		}
		return clean;
	}

	#safeSensors(sensors) {
		if (!Array.isArray(sensors)) return cloneSensors(DEFAULT_SENSOR_CONFIG);
		const seen = new Set();
		const clean = sensors.slice(0, 12).flatMap((sensor) => {
			const id = String(sensor?.id || '');
			const angle = Number(sensor?.angle);
			const length = Number(sensor?.length);
			if (!id || seen.has(id) || !Number.isFinite(angle) || !Number.isFinite(length)) return [];
			seen.add(id);
			return [{ id, angle: Math.max(-80, Math.min(80, angle)), length: Math.max(80, Math.min(360, length)) }];
		});
		return clean.length ? clean : cloneSensors(DEFAULT_SENSOR_CONFIG);
	}

	#sensorsChanged() {
		return JSON.stringify(this.#activeSensors) !== JSON.stringify(this.#pendingSensors);
	}

	#safeStoredRun(run, { interrupted = Boolean(run?.interrupted) } = {}) {
		if (!run || typeof run !== 'object') return null;
		return {
			generation: Math.max(0, Math.floor(Number(run.generation) || 0)),
			seed: Number(run.seed) >>> 0,
			difficulty: String(run.difficulty || DIFFICULTIES[0].label),
			score: Math.max(0, Number(run.score) || 0),
			series: this.#validSeries(run.series),
			interrupted,
		};
	}

	#safeActiveRun(run) {
		const safe = this.#safeStoredRun(run, { interrupted: true });
		if (!safe || safe.generation < 1) return null;
		return {
			...safe,
			tick: Math.max(0, Math.floor(Number(run.tick) || 0)),
			limit: Math.max(0, Math.floor(Number(run.limit) || 0)),
			extensions: Math.max(0, Math.floor(Number(run.extensions) || 0)),
			checkpointedAt: Math.max(0, Math.floor(Number(run.checkpointedAt) || 0)),
		};
	}

	#activeRunState() {
		if (this.#runFinalized || !this.#bestCar || this.#generation < 1) return null;
		return {
			generation: this.#generation,
			tick: this.#generationTick,
			limit: this.#generationLimit,
			extensions: this.#smartExtensions,
			seed: this.#trafficSeed,
			difficulty: this.#difficulty.label,
			score: Math.max(0, this.#score(this.#bestCar)),
			series: this.#validSeries(this.#currentSeries),
			checkpointedAt: Date.now(),
		};
	}

	#archiveInterruptedRun(run) {
		const interrupted = this.#safeActiveRun(run);
		if (!interrupted) return false;
		const hasSamples = Object.values(interrupted.series).some((series) => series.length);
		if (!hasSamples) return false;
		this.#pastRuns.push(interrupted);
		this.#pastRuns = this.#pastRuns.slice(-MAX_PAST_RUNS);
		return true;
	}

	#loadLabState() {
		let parsed = null;
		try {
			parsed = JSON.parse(localStorage.getItem(LAB_STATE_KEY) || 'null');
		} catch (error) {
			console.warn('Training state could not be parsed.', error);
		}

		const legacy = this.#loadSavedBrain();
		const savedVersion = Math.max(0, Math.floor(Number(parsed?.version) || 0));
		const stateBrain = savedVersion >= 2 && NeuralNetwork.isValid(parsed.champion)
			? parsed.champion
			: legacy.brain;
		const runs = Array.isArray(parsed?.completedRuns)
			? parsed.completedRuns.slice(-MAX_PAST_RUNS).map((run) => this.#safeStoredRun(run)).filter(Boolean)
			: [];
		if (savedVersion < LAB_STATE_VERSION) {
			let previousGeneration = 0;
			for (const run of runs) {
				run.generation = run.generation > previousGeneration ? run.generation : previousGeneration + 1;
				previousGeneration = run.generation;
			}
		}
		const activeRun = savedVersion >= LAB_STATE_VERSION ? this.#safeActiveRun(parsed?.activeRun) : null;
		const latestStoredGeneration = Math.max(0, ...runs.map((run) => run.generation), activeRun?.generation || 0);
		const generationCount = Math.max(latestStoredGeneration, Math.floor(Number(parsed?.generationCount) || 0));
		const completedRunCount = savedVersion >= LAB_STATE_VERSION
			? Math.max(runs.filter((run) => !run.interrupted).length, Math.floor(Number(parsed?.completedRunCount) || 0))
			: Math.max(runs.length, generationCount);
		const championFitness = Math.max(0, Number(parsed?.championFitness) || 0);
		const inferredDifficultyIndex = this.#difficultyIndexForFitness(championFitness);
		const promotionMode = parsed?.progression?.mode === 'manual' ? 'manual' : 'smart';

		return {
			brain: stateBrain,
			championFitness,
			completedRuns: runs,
			completedRunCount,
			generationCount,
			activeRun,
			rewards: this.#safeRewards(parsed?.rewards),
			activeSensors: this.#safeSensors(parsed?.activeSensors),
			pendingSensors: this.#safeSensors(parsed?.pendingSensors ?? parsed?.activeSensors),
			promotionMode,
			smartDifficultyIndex: this.#safeDifficultyIndex(parsed?.progression?.smartDifficultyIndex, inferredDifficultyIndex),
			manualDifficultyIndex: this.#safeDifficultyIndex(parsed?.progression?.manualDifficultyIndex, inferredDifficultyIndex),
			status: legacy.status,
		};
	}

	#persistLabState() {
		try {
			const state = {
				version: LAB_STATE_VERSION,
				champion: NeuralNetwork.isValid(this.#championBrain) ? this.#championBrain : null,
				championFitness: this.#championFitness,
				completedRuns: this.#pastRuns.slice(-MAX_PAST_RUNS),
				completedRunCount: this.#completedRunCount,
				generationCount: this.#generation,
				activeRun: this.#activeRunState(),
				rewards: this.#settings.rewards,
				activeSensors: this.#activeSensors,
				pendingSensors: this.#pendingSensors,
				progression: {
					mode: this.#settings.promotionMode,
					smartDifficultyIndex: this.#smartDifficultyIndex,
					manualDifficultyIndex: this.#manualDifficultyIndex,
				},
			};
			localStorage.setItem(LAB_STATE_KEY, JSON.stringify(state));
			if (state.champion) localStorage.setItem('bestBrain', JSON.stringify(state.champion));
			else localStorage.removeItem('bestBrain');
			return true;
		} catch (error) {
			console.warn('Training state could not be persisted.', error);
			this.#ui.status.textContent = 'LOCAL SAVE FULL · RUN CONTINUES';
			return false;
		}
	}

	#completeGeneration({ forceChampion = false } = {}) {
		if (!this.#bestCar || this.#generationTick < 1) return false;
		const score = Math.max(0, this.#score(this.#bestCar));
		this.#pastRuns.push({
			generation: this.#generation,
			seed: this.#trafficSeed,
			difficulty: this.#difficulty.label,
			score,
			series: this.#validSeries(this.#currentSeries),
			interrupted: false,
		});
		this.#pastRuns = this.#pastRuns.slice(-MAX_PAST_RUNS);
		this.#completedRunCount += 1;
		this.#runFinalized = true;

		if ((forceChampion || score >= this.#championFitness) && NeuralNetwork.isValid(this.#bestCar.brain)) {
			this.#championBrain = cloneBrain(this.#bestCar.brain);
			this.#championFitness = score;
		}
		let promoted = false;
		if (
			this.#settings.promotionMode === 'smart' &&
			this.#smartDifficultyIndex < DIFFICULTIES.length - 1 &&
			this.#smartPromotionProgress() >= 2
		) {
			this.#smartDifficultyIndex += 1;
			promoted = true;
		}
		this.#persistLabState();
		return promoted;
	}

	#startGeneration({ keepElite = true, status = null } = {}) {
		if (this.#championBrain && !NeuralNetwork.isValid(this.#championBrain, [this.#activeSensors.length, 6, 4])) {
			this.#championBrain = null;
		}
		if (this.#sensorsChanged()) {
			if (this.#championBrain) {
				this.#championBrain = NeuralNetwork.reconcileInputs(
					this.#championBrain,
					this.#activeSensors.map((sensor) => sensor.id),
					this.#pendingSensors.map((sensor) => sensor.id)
				);
			}
			this.#activeSensors = cloneSensors(this.#pendingSensors);
			this.#persistLabState();
		}

		this.#generation += 1;
		this.#generationTick = 0;
		this.#generationLimit = this.#baseDurationTicks();
		this.#smartExtensions = 0;
		this.#trafficSeed = randomSeed();
		this.#lastSampleKey = '';
		this.#currentSeries = this.#emptySeries();
		this.#runFinalized = false;
		this.#difficulty = this.#difficultyFor();
		this.#maxSensorReach = Math.max(80, ...this.#activeSensors.map((sensor) => sensor.length));
		this.#street = this.#createStreet();
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
		document.body.dataset.sensorCount = String(this.#activeSensors.length);
		if (document.body.dataset.view === 'network') {
			document.getElementById('view-legend-secondary').textContent = `${this.#activeSensors.length} INPUTS → 6 HIDDEN → 4 OUTPUTS`;
		}
		this.#bestCar.sensor?.update(
			this.#street.bordersNear(this.#bestCar.y, this.#maxSensorReach + 100),
			this.#nearbyTrafficFor(this.#bestCar)
		);
		this.#ui.status.textContent = status ?? (this.#championBrain ? `EVOLVING SAVED CHAMPION · ${this.#difficulty.label}` : 'SEARCHING FROM RANDOM');
		this.#renderGarage();
		this.#syncPromotionControls();
		this.#lastCheckpointAt = Date.now();
		this.#persistLabState();
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
		if (this.#bestCar) this.#persistLabState();
		const saved = this.#loadLabState();
		this.#championBrain = saved.brain;
		this.#championFitness = saved.championFitness;
		this.#pastRuns = saved.completedRuns;
		const restoredInterruptedRun = this.#archiveInterruptedRun(saved.activeRun);
		this.#completedRunCount = saved.completedRunCount;
		this.#settings.rewards = saved.rewards;
		this.#settings.promotionMode = saved.promotionMode;
		this.#smartDifficultyIndex = saved.smartDifficultyIndex;
		this.#manualDifficultyIndex = saved.manualDifficultyIndex;
		this.#activeSensors = saved.activeSensors;
		this.#pendingSensors = saved.pendingSensors;
		this.#syncRewardInputs();
		this.#syncPromotionControls();
		this.#generation = saved.generationCount;
		this.#bestCar = null;
		const memoryStatus = saved.generationCount > 0 || saved.completedRunCount > 0
			? `RESTORED ${saved.completedRunCount} RUNS · CONTINUING AT GEN ${saved.generationCount + 1}${restoredInterruptedRun ? ' · LAST TRACE SAVED' : ''}`
			: saved.status;
		this.#startGeneration({ keepElite: false, status: memoryStatus });
		if (!this.#running) {
			this.#running = true;
			this.#animation = window.requestAnimationFrame(this.#animate);
		}
	};

	#nextGeneration = () => {
		const promoted = this.#completeGeneration();
		this.#startGeneration({
			keepElite: true,
			status: promoted ? `SMART PROMOTION · ${DIFFICULTIES[this.#smartDifficultyIndex].label}` : null,
		});
	};

	#syncRewardInputs() {
		for (const [key, value] of Object.entries(this.#settings.rewards)) {
			const input = document.getElementById(`weight-${key}`);
			if (input) input.value = String(value);
		}
	}

	#syncPromotionControls() {
		const mode = document.getElementById('promotion-mode');
		const promote = document.getElementById('promote-difficulty');
		if (!mode || !promote) return;
		mode.value = this.#settings.promotionMode;
		const currentIndex = this.#settings.promotionMode === 'manual'
			? this.#manualDifficultyIndex
			: this.#smartDifficultyIndex;
		const next = DIFFICULTIES[currentIndex + 1] ?? null;
		promote.disabled = this.#settings.promotionMode !== 'manual' || !next;
		promote.textContent = this.#settings.promotionMode === 'smart'
			? next ? `SMART · ${this.#smartPromotionProgress()}/2 RUNS` : 'MAX TIER'
			: next ? `PROMOTE TO ${next.unlockLabel} ↑` : 'MAX TIER';
		promote.title = this.#settings.promotionMode === 'smart'
			? 'Smart promotion requires two consecutive runs above the next fitness milestone'
			: next ? `Complete this run and start ${next.label}` : 'The course is already at its highest tier';
	}

	#promoteDifficulty = () => {
		if (this.#settings.promotionMode !== 'manual' || this.#manualDifficultyIndex >= DIFFICULTIES.length - 1) return;
		this.#completeGeneration();
		this.#manualDifficultyIndex += 1;
		this.#persistLabState();
		this.#startGeneration({
			keepElite: true,
			status: `MANUAL PROMOTION · ${DIFFICULTIES[this.#manualDifficultyIndex].label}`,
		});
		this.#syncPromotionControls();
	};

	#bindRewards() {
		const keys = Object.keys(REWARD_DEFAULTS);
		for (const key of keys) {
			const input = document.getElementById(`weight-${key}`);
			input.addEventListener('change', () => {
				const value = Number(input.value);
				this.#settings.rewards[key] = Number.isFinite(value) && value >= 0 ? value : REWARD_DEFAULTS[key];
				input.value = String(this.#settings.rewards[key]);
				this.#persistLabState();
				this.#ui.status.textContent = 'FITNESS WEIGHTS UPDATED';
			});
		}
		document.getElementById('reset-rewards').onclick = () => {
			this.#settings.rewards = { ...REWARD_DEFAULTS };
			this.#syncRewardInputs();
			this.#persistLabState();
			this.#ui.status.textContent = 'FITNESS WEIGHTS RESET';
		};
	}

	#stageSensorChange(mutator) {
		const next = cloneSensors(this.#pendingSensors);
		mutator(next);
		this.#pendingSensors = this.#safeSensors(next);
		this.#persistLabState();
		this.#renderGarage();
		this.#ui.status.textContent = 'SENSOR EDITS QUEUED · NEXT GENERATION';
	}

	#renderGarage() {
		const rows = document.getElementById('sensor-rows');
		const rays = document.getElementById('sensor-preview-rays');
		if (!rows || !rays) return;
		rows.replaceChildren();
		rays.replaceChildren();
		const changed = this.#sensorsChanged();
		document.getElementById('garage-status').textContent = changed ? 'CHANGES PENDING · NEXT RUN' : 'CURRENT CONFIGURATION';
		document.getElementById('sensor-count').textContent = `${this.#pendingSensors.length} INPUT NODE${this.#pendingSensors.length === 1 ? '' : 'S'}`;

		this.#pendingSensors.forEach((sensor, index) => {
			const row = document.createElement('div');
			row.className = 'sensor-row';
			const name = document.createElement('strong');
			name.textContent = `R${String(index + 1).padStart(2, '0')} · ${sensor.id.startsWith('ray-new') ? 'NEWBORN' : 'WEIGHTED'}`;

			const createRange = (property, min, max, step, suffix) => {
				const label = document.createElement('label');
				const input = document.createElement('input');
				input.type = 'range';
				input.min = String(min);
				input.max = String(max);
				input.step = String(step);
				input.value = String(sensor[property]);
				input.setAttribute('aria-label', `${property} for sensor ${index + 1}`);
				const output = document.createElement('output');
				output.textContent = `${Number(sensor[property]).toFixed(property === 'angle' ? 0 : 0)}${suffix}`;
				input.oninput = () => {
					const value = Number(input.value);
					output.textContent = `${value.toFixed(0)}${suffix}`;
					this.#pendingSensors[index][property] = value;
					this.#persistLabState();
					this.#drawSensorPreview();
					document.getElementById('garage-status').textContent = 'CHANGES PENDING · NEXT RUN';
				};
				label.append(input, output);
				return label;
			};

			const remove = document.createElement('button');
			remove.type = 'button';
			remove.textContent = '×';
			remove.title = 'Delete this sensor';
			remove.disabled = this.#pendingSensors.length <= 1;
			remove.onclick = () => this.#stageSensorChange((sensors) => sensors.splice(index, 1));
			row.append(name, createRange('angle', -80, 80, 1, '°'), createRange('length', 80, 360, 10, ''), remove);
			rows.append(row);
		});
		this.#drawSensorPreview();
	}

	#drawSensorPreview() {
		const rays = document.getElementById('sensor-preview-rays');
		if (!rays) return;
		rays.replaceChildren();
		const origin = { x: 210, y: 260 };
		this.#pendingSensors.forEach((sensor, index) => {
			const angle = (sensor.angle * Math.PI) / 180;
			const scaledLength = sensor.length * 0.62;
			const end = { x: origin.x - Math.sin(angle) * scaledLength, y: origin.y - Math.cos(angle) * scaledLength };
			const line = document.createElementNS(SVG_NS, 'line');
			line.setAttribute('class', 'sensor-ray');
			line.setAttribute('x1', origin.x);
			line.setAttribute('y1', origin.y);
			line.setAttribute('x2', end.x);
			line.setAttribute('y2', end.y);
			const dot = document.createElementNS(SVG_NS, 'circle');
			dot.setAttribute('class', 'sensor-ray-end');
			dot.setAttribute('cx', end.x);
			dot.setAttribute('cy', end.y);
			dot.setAttribute('r', 4);
			const label = document.createElementNS(SVG_NS, 'text');
			label.setAttribute('class', 'sensor-ray-label');
			label.setAttribute('x', end.x + 7);
			label.setAttribute('y', end.y + 3);
			label.textContent = `R${index + 1}`;
			rays.append(line, dot, label);
		});
	}

	#bindGarage() {
		document.getElementById('add-sensor').onclick = () => {
			if (this.#pendingSensors.length >= 12) {
				this.#ui.status.textContent = 'SENSOR LIMIT · 12 INPUTS';
				return;
			}
			this.#stageSensorChange((sensors) => sensors.push({
				id: `ray-new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
				angle: 0,
				length: 200,
			}));
		};
		document.getElementById('reset-sensors').onclick = () => {
			this.#pendingSensors = cloneSensors(DEFAULT_SENSOR_CONFIG);
			this.#persistLabState();
			this.#renderGarage();
			this.#ui.status.textContent = 'FIVE-RAY ARRAY QUEUED · NEXT GENERATION';
		};
		this.#renderGarage();
	}

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
		const promotionMode = document.getElementById('promotion-mode');

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
		promotionMode.onchange = () => {
			const currentIndex = DIFFICULTIES.indexOf(this.#difficulty);
			this.#settings.promotionMode = promotionMode.value === 'manual' ? 'manual' : 'smart';
			if (this.#settings.promotionMode === 'manual') this.#manualDifficultyIndex = currentIndex;
			else this.#smartDifficultyIndex = currentIndex;
			this.#persistLabState();
			this.#syncPromotionControls();
			this.#ui.status.textContent = `${this.#settings.promotionMode.toUpperCase()} PROMOTION · APPLIES NEXT RUN`;
		};

		document.getElementById('next-generation').onclick = this.#nextGeneration;
		document.getElementById('reset-run').onclick = this.#resetPopulation;
		document.getElementById('promote-difficulty').onclick = this.#promoteDifficulty;
		this.#bindRewards();
		this.#bindGarage();
	}

	#simulateTick() {
		for (const obstacle of this.#traffic) {
			this.#advanceTraffic(obstacle);
		}
		for (const car of this.#cars) {
			if (car.damaged) continue;
			const nearbyTraffic = this.#nearbyTrafficFor(car);
			car.update(
				this.#street.bordersNear(car.y, this.#maxSensorReach + 100),
				nearbyTraffic
			);
			this.#recordMetrics(car, nearbyTraffic);
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
		const visibleTop = this.#bestCar.y - this.#height * 0.7;
		const visibleBottom = this.#bestCar.y + this.#height * 0.5;
		this.#street.draw(this.#ctx, visibleTop - 180, visibleBottom + 180);
		for (const obstacle of this.#traffic) {
			if (obstacle.y >= visibleTop - 120 && obstacle.y <= visibleBottom + 120) obstacle.draw(this.#ctx, false);
		}

		this.#ctx.globalAlpha = 0.16;
		for (const car of this.#cars) {
			if (car.y >= visibleTop - 120 && car.y <= visibleBottom + 120) car.draw(this.#ctx, false);
		}
		this.#ctx.globalAlpha = 1;
		this.#bestCar.draw(this.#ctx, true, true);
		this.#ctx.restore();

		if (document.body.dataset.view === 'drive' || document.body.dataset.view === 'network') {
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

	#renderChart(chart, metric, bounds) {
		const values = this.#currentSeries[metric];
		const histories = this.#pastRuns.map((run) => run.series[metric]).filter((series) => series.length);
		const combined = [...histories.flat(), ...values];
		const sharedBounds = bounds ?? {
			min: Math.min(0, ...combined),
			max: Math.max(1, ...combined),
		};
		chart.history.replaceChildren();
		histories.forEach((series, index) => {
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', chartPath(series, sharedBounds).area);
			path.setAttribute('opacity', String(0.055 + ((index + 1) / histories.length) * 0.17));
			chart.history.append(path);
		});
		chart.line.setAttribute('d', chartPath(values, sharedBounds).line);
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
		dashboard.memory.textContent = `${this.#completedRunCount} SAVED`;
		dashboard.difficulty.textContent = this.#difficulty.label;
		dashboard.promotion.textContent = this.#settings.promotionMode === 'smart' ? 'SMART / 2 RUNS' : 'MANUAL / USER';
		const nextDifficulty = this.#nextDifficulty();
		dashboard.nextUnlock.textContent = nextDifficulty
			? `${nextDifficulty.unlockLabel} · ${this.#settings.promotionMode === 'smart'
				? `${nextDifficulty.milestone >= 10000 ? `${Math.round(nextDifficulty.milestone / 1000)}K` : `${(nextDifficulty.milestone / 1000).toFixed(1)}K`} · ${this.#smartPromotionProgress()}/2`
				: 'READY'}`
			: 'MAX TIER';
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
			this.#currentSeries.fitness.push(Math.max(0, breakdown.total));
			this.#currentSeries.average.push(snapshot.average);
			this.#currentSeries.survival.push(snapshot.alivePercent);
			this.#currentSeries.pace.push(breakdown.averageSpeed);
			for (const values of Object.values(this.#currentSeries)) {
				if (values.length > MAX_SAMPLES) values.shift();
			}

			this.#renderChart(dashboard.charts.fitness, 'fitness');
			this.#renderChart(dashboard.charts.average, 'average');
			this.#renderChart(dashboard.charts.survival, 'survival', { min: 0, max: 100 });
			this.#renderChart(dashboard.charts.pace, 'pace', { min: 0, max: this.#settings.pace * 1.1 });
			const now = Date.now();
			if (now - this.#lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
				this.#lastCheckpointAt = now;
				this.#persistLabState();
			}
		}
		dashboard.sample.textContent = String(this.#currentSeries.fitness.length).padStart(3, '0');

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
		this.#archiveInterruptedRun(this.#activeRunState());
		this.#runFinalized = true;
		this.#recoveries += 1;
		this.#stableFrames = 0;
		if (!NeuralNetwork.isValid(this.#bestCar?.brain)) {
			this.#championBrain = null;
			this.#championFitness = 0;
			this.#persistLabState();
		}
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
		this.#street = this.#createStreet();
		this.#bindControls();
		this.#running = true;
		this.#resetPopulation();
		this.#animation = window.requestAnimationFrame(this.#animate);
	};

	checkpoint = () => this.#persistLabState();

	resize({ width, height, netWidth }) {
		const horizontalShift = width / 2 - this.#width / 2;
		if (Number.isFinite(horizontalShift) && horizontalShift !== 0) {
			for (const car of this.#cars) car.x += horizontalShift;
			for (const obstacle of this.#traffic) obstacle.x += horizontalShift;
		}
		this.#width = width;
		this.#height = height;
		this.#netWidth = netWidth;
		this.#street = this.#createStreet();
	}

	stop() {
		this.#running = false;
		window.cancelAnimationFrame(this.#animation);
	}
}
