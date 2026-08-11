import Controls from './controls';
import Sensor from './sensor';
import { polysIntersect } from './utils';
import NeuralNetwork from './network';

export default class Car {
	#ROT_ANGLE = 0.015;

	constructor(x, y, w, h, controlType, options = {}) {
		this.x = x;
		this.y = y;
		this.width = w;
		this.height = h;
		this.angle = 0;

		this.color = 'yellow';

		this.speed = 0;

		this.maxSpeed = options.maxSpeed ?? 2;
		this.acceleration = 0.2;
		this.accelerationFactor = options.accelerationFactor ?? 1;
		this.friction = 0.05;

		this.useBrain = controlType == 'AI';

		if (controlType != 'DUMMY') {
			this.sensor = new Sensor(this);
			this.brain = new NeuralNetwork([this.sensor.rayCount, 6, 4]);
			this.maxSpeed = options.maxSpeed ?? 2.5;
			this.color = 'green';
		}
		this.controls = new Controls(controlType);

		this.damaged = false;
		this.polygon = this.#createPolygon();
	}

	#assessDamage(roadBorders, traffic) {
		for (let i = 0; i < roadBorders.length; i++) {
			if (polysIntersect(this.polygon, roadBorders[i])) {
				return true;
			}
		}
		for (let i = 0; i < traffic.length; i++) {
			if (polysIntersect(this.polygon, traffic[i].polygon)) {
				return true;
			}
		}
		return false;
	}

	#createPolygon() {
		const points = [];

		const rad = Math.hypot(this.width, this.height) / 2;
		const alpha = Math.atan2(this.width, this.height);

		points.push({
			x: this.x - Math.sin(this.angle - alpha) * rad,
			y: this.y - Math.cos(this.angle - alpha) * rad,
		});
		points.push({
			x: this.x - Math.sin(this.angle + alpha) * rad,
			y: this.y - Math.cos(this.angle + alpha) * rad,
		});
		points.push({
			x: this.x - Math.sin(Math.PI + this.angle - alpha) * rad,
			y: this.y - Math.cos(Math.PI + this.angle - alpha) * rad,
		});
		points.push({
			x: this.x - Math.sin(Math.PI + this.angle + alpha) * rad,
			y: this.y - Math.cos(Math.PI + this.angle + alpha) * rad,
		});

		return points;
	}

	#move() {
		// Reverse acts as an intentional brake before it becomes reverse thrust.
		// Releasing both pedals preserves momentum and lets rolling drag slow the car.
		if (this.controls.reverse) {
			if (this.speed > 0) {
				this.speed -= this.acceleration * this.accelerationFactor * 1.35;
			} else {
				this.speed -= this.acceleration * this.accelerationFactor * 0.75;
			}
		} else if (this.controls.forward) {
			this.speed += this.acceleration * this.accelerationFactor;
		} else if (this.speed > 0) {
			this.speed = Math.max(0, this.speed - this.friction * 0.45);
		} else if (this.speed < 0) {
			this.speed = Math.min(0, this.speed + this.friction * 0.45);
		}

		// Handle max speed
		if (this.speed > this.maxSpeed) {
			this.speed = this.maxSpeed;
		}
		if (this.speed < -this.maxSpeed / 2) {
			this.speed = -this.maxSpeed / 2;
		}

		// Settle tiny floating-point motion only after coasting has nearly stopped.
		if (!this.controls.forward && !this.controls.reverse && Math.abs(this.speed) < this.friction * 0.45) {
			this.speed = 0;
		}

		// Handle Horizontal movement
		if (this.speed != 0) {
			const flip = this.speed > 0 ? 1 : -1;
			if (this.controls.left) {
				this.angle += this.#ROT_ANGLE * flip;
			}
			if (this.controls.right) {
				this.angle -= this.#ROT_ANGLE * flip;
			}
		}

		this.y -= Math.cos(this.angle) * this.speed;
		this.x -= Math.sin(this.angle) * this.speed;
	}

	update(roadBorders, traffic) {
		if (!this.damaged) {
			this.#move();
			this.polygon = this.#createPolygon();
			this.damaged = this.#assessDamage(roadBorders, traffic);
		}

		if (this.sensor) {
			this.sensor.update(roadBorders, traffic);
			const offsets = this.sensor.readings.map((s) =>
				s == null ? 0 : 1 - s.offset
			);
			const outputs = NeuralNetwork.feedForward(offsets, this.brain);

			if (this.useBrain) {
				this.controls.forward = outputs[0];
				this.controls.left = outputs[1];
				this.controls.right = outputs[2];
				this.controls.reverse = outputs[3];
			}
		}
	}

	draw(ctx, drawSensors, highlight = false) {
		ctx.fillStyle = this.color;
		if (highlight) ctx.fillStyle = '#d6f05f';

		if (this.damaged) {
			ctx.fillStyle = 'red';
		}

		ctx.beginPath();
		ctx.moveTo(this.polygon[0].x, this.polygon[0].y);

		for (let i = 1; i < this.polygon.length; i++) {
			ctx.lineTo(this.polygon[i].x, this.polygon[i].y);
		}

		ctx.closePath();
		ctx.fill();

		if (this.sensor && drawSensors) {
			this.sensor.draw(ctx);
		}
	}

	animate(ctx, roadBorders, traffic, drawSensors = false) {
		this.update(roadBorders, traffic);
		this.draw(ctx, drawSensors);
	}
}
