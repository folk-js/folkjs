export const { PI, hypot, cos, sin, atan2, abs, acos, sign } = Math;

export const EPSILON = 0.000001;

export const DEGREE = PI / 180;

export const RADIAN = 180 / PI;

export const TAU = PI * 2;

export const HALF_PI = PI / 2;

export const approximatelyEqual = (a: number, b: number) => abs(a - b) <= EPSILON * Math.max(1.0, abs(a), abs(b));

export const clampRotation = (radians: number) => (TAU + radians) % TAU;

export const lerpValue = (a: number, b: number, alpha: number): number => a + (b - a) * alpha;

export const round = (value: number, decimal = 0) => Math.round(value * decimal) / decimal;

export const toDegree = (a: number) => a * RADIAN;

export const toDOMPrecision = (value: number) => Math.round(value * 1e4) / 1e4;

export const toRadian = (a: number) => a * DEGREE;

export const isNumber = (num: unknown): num is number => typeof num === 'number';

export const isObject = (obj: unknown): obj is Record<string, any> => obj != null && typeof obj === 'object';
