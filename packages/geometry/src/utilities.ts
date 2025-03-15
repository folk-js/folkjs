export const EPSILON = 0.000001;

export const DEGREE = Math.PI / 180;

export const RADIAN = 180 / Math.PI;

export const PI2 = Math.PI * 2;

export const TAU = Math.PI / 2;

export const round = (value: number, decimal = 0) => Math.round(value * decimal) / decimal;

export const toDOMPrecision = (value: number) => Math.round(value * 1e4) / 1e4;

export const toRadian = (a: number) => a * DEGREE;

export const toDegree = (a: number) => a * RADIAN;
