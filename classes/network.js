import { lerp } from './utils';

export default class NeuralNetwork {
	constructor(neuronCounts) {
		this.levels = [];
		for (let i = 0; i < neuronCounts.length - 1; i++) {
			this.levels.push(new Level(neuronCounts[i], neuronCounts[i + 1]));
		}
	}

	static feedForward(givenInputs, network) {
		let outputs = Level.feedForward(givenInputs, network.levels[0]);
		for (let i = 1; i < network.levels.length; i++) {
			outputs = Level.feedForward(outputs, network.levels[i]);
		}
		return outputs;
	}

	static isValid(network, neuronCounts = null) {
		if (!network || !Array.isArray(network.levels)) return false;
		if (!neuronCounts) {
			const inputCount = network.levels[0]?.inputs?.length;
			if (!Number.isInteger(inputCount) || inputCount < 1 || inputCount > 12) return false;
			neuronCounts = [inputCount, 6, 4];
		}
		if (network.levels.length !== neuronCounts.length - 1) return false;

		return network.levels.every((level, levelIndex) => {
			const inputCount = neuronCounts[levelIndex];
			const outputCount = neuronCounts[levelIndex + 1];
			if (
				!level ||
				!Array.isArray(level.inputs) ||
				!Array.isArray(level.outputs) ||
				!Array.isArray(level.biases) ||
				!Array.isArray(level.weights) ||
				level.inputs.length !== inputCount ||
				level.outputs.length !== outputCount ||
				level.biases.length !== outputCount ||
				level.weights.length !== inputCount
			) {
				return false;
			}

			if (!level.biases.every(Number.isFinite)) return false;
			return level.weights.every(
				(row) =>
					Array.isArray(row) && row.length === outputCount && row.every(Number.isFinite)
			);
		});
	}

	static reconcileInputs(network, previousIds, nextIds) {
		if (!NeuralNetwork.isValid(network, [previousIds.length, 6, 4])) {
			return new NeuralNetwork([nextIds.length, 6, 4]);
		}
		const reconciled = JSON.parse(JSON.stringify(network));
		const firstLevel = reconciled.levels[0];
		const weightById = new Map(previousIds.map((id, index) => [id, firstLevel.weights[index]]));
		firstLevel.inputs = new Array(nextIds.length);
		firstLevel.weights = nextIds.map((id) => {
			const existing = weightById.get(id);
			return existing ? [...existing] : firstLevel.outputs.map(() => Math.random() * 2 - 1);
		});
		return reconciled;
	}

	static mutate(network, amount = 1) {
		network.levels.forEach((level) => {
			for (let i = 0; i < level.biases.length; i++) {
				level.biases[i] = lerp(
					level.biases[i],
					Math.random() * 2 - 1,
					amount
				);
			}
			for (let i = 0; i < level.weights.length; i++) {
				for (let j = 0; j < level.weights[i].length; j++) {
					level.weights[i][j] = lerp(
						level.weights[i][j],
						Math.random() * 2 - 1,
						amount
					);
				}
			}
		});
	}
}

class Level {
	constructor(inputCount, outputCount) {
		this.inputs = new Array(inputCount);
		this.outputs = new Array(outputCount);
		this.biases = new Array(outputCount);

		this.weights = [];

		for (let i = 0; i < inputCount; i++) {
			this.weights[i] = new Array(outputCount);
		}

		Level.#randomize(this);
	}

	static #randomize(level) {
		for (let i = 0; i < level.inputs.length; i++) {
			for (let j = 0; j < level.outputs.length; j++) {
				level.weights[i][j] = Math.random() * 2 - 1;
			}
		}

		for (let i = 0; i < level.biases.length; i++) {
			level.biases[i] = Math.random() * 2 - 1;
		}
	}

	static feedForward(givenInputs, level) {
		for (let i = 0; i < level.inputs.length; i++) {
			level.inputs[i] = givenInputs[i];
		}

		for (let i = 0; i < level.outputs.length; i++) {
			let sum = 0;
			for (let j = 0; j < level.inputs.length; j++) {
				sum += level.inputs[j] * level.weights[j][i];
			}

			if (sum > level.biases[i]) {
				level.outputs[i] = 1;
			} else {
				level.outputs[i] = 0;
			}
		}

		return level.outputs;
	}
}
