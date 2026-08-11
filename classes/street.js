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
		this.borderRows = this.#buildBorderRows();
		this.borders = this.borderRows.flat();
		this.borderCache = new Map();
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

	#buildBorderRows() {
		const rows = [];
		for (let y = this.top; y < this.bottom; y += SEGMENT_LENGTH) {
			const nextY = Math.min(this.bottom, y + SEGMENT_LENGTH);
			rows.push([
				[this.#pointAt(y, 0), this.#pointAt(nextY, 0)],
				[this.#pointAt(y, 1), this.#pointAt(nextY, 1)],
			]);
		}
		return rows;
	}

	bordersNear(y, range = 480) {
		const first = Math.max(0, Math.floor((y - range - this.top) / SEGMENT_LENGTH));
		const last = Math.min(this.borderRows.length - 1, Math.ceil((y + range - this.top) / SEGMENT_LENGTH));
		const key = `${first}:${last}`;
		if (!this.borderCache.has(key)) {
			this.borderCache.set(key, this.borderRows.slice(first, last + 1).flat());
		}
		return this.borderCache.get(key);
	}

	#drawCourseLine(ctx, across, dashed, fromY, toY) {
		ctx.setLineDash(dashed ? [40, 50] : []);
		ctx.beginPath();
		const start = Math.max(this.top, Math.floor(fromY / (SEGMENT_LENGTH / 2)) * (SEGMENT_LENGTH / 2));
		const end = Math.min(this.bottom, toY);
		for (let y = start, first = true; y <= end; y += SEGMENT_LENGTH / 2) {
			const point = this.#pointAt(y, across);
			if (first) ctx.moveTo(point.x, point.y);
			else ctx.lineTo(point.x, point.y);
			first = false;
		}
		ctx.stroke();
	}

	draw(ctx, fromY = this.top, toY = this.bottom) {
		ctx.lineWidth = 5;
		ctx.strokeStyle = this.color;

		for (let lane = 1; lane < this.laneCount; lane++) {
			this.#drawCourseLine(ctx, lane / this.laneCount, true, fromY, toY);
		}
		this.#drawCourseLine(ctx, 0, false, fromY, toY);
		this.#drawCourseLine(ctx, 1, false, fromY, toY);
		ctx.setLineDash([]);
	}
}
