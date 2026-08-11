import { lerp, getIntersection } from './utils';

export default class Sensor {
	constructor(car) {
		this.car = car;

		this.rayCount = 5;
		this.rayLength = 200;
		this.raySpread = Math.PI / 2;

		this.rays = [];
		this.readings = [];
	}

	#getReading(ray, roadBorder, traffic) {
		let touches = [];

		for (let i = 0; i < roadBorder.length; i++) {
			const touch = getIntersection(
				ray[0],
				ray[1],
				roadBorder[i][0],
				roadBorder[i][1]
			);
			if (touch) {
				touches.push(touch);
			}
		}

		for (let i = 0; i < traffic.length; i++) {
			const poly = traffic[i].polygon;

			for (let j = 0; j < poly.length; j++) {
				const value = getIntersection(
					ray[0],
					ray[1],
					poly[j],
					poly[(j + 1) % poly.length]
				);
				if (value) {
					touches.push(value);
				}
			}
		}

		if (touches.length == 0) {
			return null;
		} else {
			const offsets = touches.map((e) => e.offset);
			const minOffset = Math.min(...offsets);
			return touches.find((e) => e.offset == minOffset);
		}
	}

	#castRays() {
		this.rays = [];
		for (let i = 0; i < this.rayCount; i++) {
			const rayAngle =
				lerp(
					this.raySpread / 2,
					-this.raySpread / 2,
					this.rayCount == 1 ? 0.5 : i / (this.rayCount - 1)
				) + this.car.angle;

			const startPoint = { x: this.car.x, y: this.car.y };
			const endPoint = {
				x: this.car.x - Math.sin(rayAngle) * this.rayLength,
				y: this.car.y - Math.cos(rayAngle) * this.rayLength,
			};

			this.rays.push([startPoint, endPoint]);
		}
	}

	update(roadBorders, traffic) {
		this.#castRays();
		this.readings = [];
		for (let i = 0; i < this.rayCount; i++) {
			const reading = this.#getReading(
				this.rays[i],
				roadBorders,
				traffic
			);
			this.readings.push(reading);
		}
	}

	draw(ctx) {
		for (let i = 0; i < this.rayCount; i++) {
			if (!this.rays[i]) continue;
			let end = this.rays[i][1];
			if (this.readings[i]) {
				end = this.readings[i];
			}
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'yellow';

			ctx.beginPath();
			ctx.moveTo(this.rays[i][0].x, this.rays[i][0].y);
			ctx.lineTo(end.x, end.y);
			// ctx.lineTo(this.rays[i][1].x, this.rays[i][1].y);
			ctx.stroke();

			ctx.beginPath();
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'black';
			ctx.moveTo(this.rays[i][1].x, this.rays[i][1].y);
			ctx.lineTo(end.x, end.y);
			// ctx.lineTo(this.rays[i][1].x, this.rays[i][1].y);
			ctx.stroke();
			ctx.closePath();
		}
	}
}
