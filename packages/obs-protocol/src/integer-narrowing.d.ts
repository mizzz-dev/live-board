export {};

declare global {
  interface NumberConstructor {
    isInteger(value: unknown): value is number;
  }
}
