import { lerp } from './utils';

const COURSE_TOP = -52000;
const COURSE_BOTTOM = 3200;
const SEGMENT_LENGTH = 220;

export default class Street {
	constructor(x, w, laneCount = 3, options = {}) {
		this.x = x;
		this.width = w;
		this.laneCount = laneCount;
		this.color = '#fff';
		this.curveAmplitude = options.curveAmplitude ?? 0;
		this.curveWavelength = options.curveWavelength ?? 4200;
		this.curvePhase = options.curvePhase ?? 0;
		this.top = COURSE_TOP;
		this.bottom = COURSE_BOTTOM;
		this.left = x - w / 2;
		this.right = x + w / 2;
		this.borders = this.#buildBorders();
	}

	centerAt(y) {
		if (!this.curveAmplitude) return this.x;
		return this.x + Math.sin((y + this.curvePhase) / this.curveWavelength * Math.PI * 2) * this.curveAmplitude;
	}

	leftAt(y) {
		return this.centerAt(y) - this.width / 2;
	}

	rightAt(y) {
		return this.centerAt(y) + this.width / 2;
	}

	getCenterLane(laneIndex, y = 0) {
		const laneWidth = this.width / this.laneCount;
		return (
			this.leftAt(y) +
			laneWidth / 2 +
			Math.min(Math.max(0, laneIndex), this.laneCount - 1) * laneWidth
		);
	}

	#pointAt(y, across) {
		return { x: lerp(this.leftAt(y), this.rightAt(y), across), y };
	}

	#buildBorders() {
		const borders = [];
		for (let y = this.top; y < this.bottom; y += SEGMENT_LENGTH) {
			const nextY = Math.min(this.bottom, y + SEGMENT_LENGTH);
			borders.push([this.#pointAt(y, 0), this.#pointAt(nextY, 0)]);
			borders.push([this.#pointAt(y, 1), this.#pointAt(nextY, 1)]);
		}
		return borders;
	}

	#drawCourseLine(ctx, across, dashed = false) {
		ctx.setLineDash(dashed ? [40, 50] : []);
		ctx.beginPath();
		for (let y = this.top, first = true; y <= this.bottom; y += SEGMENT_LENGTH / 2) {
			const point = this.#pointAt(y, across);
			if (first) ctx.moveTo(point.x, point.y);
			else ctx.lineTo(point.x, point.y);
			first = false;
		}
		ctx.stroke();
	}

	draw(ctx) {
		ctx.lineWidth = 5;
		ctx.strokeStyle = this.color;

		for (let lane = 1; lane < this.laneCount; lane++) {
			this.#drawCourseLine(ctx, lane / this.laneCount, true);
		}
		this.#drawCourseLine(ctx, 0);
		this.#drawCourseLine(ctx, 1);
		ctx.setLineDash([]);
	}
}
